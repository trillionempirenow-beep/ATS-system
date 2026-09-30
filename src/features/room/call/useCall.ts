import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { RtcConfigDto } from '@shared/api/interviews';
import { joinChannel, type Channel, type ConnectionStatus, type RealtimeDriver } from '@/lib/realtime';

export type ParticipantRole = 'interviewer' | 'staff' | 'candidate' | 'guest';

export interface ParticipantMeta {
  id: string;
  name: string;
  role: ParticipantRole;
  /** Final-interview guests: the position they entered, shown next to their name. */
  position?: string;
  mic: boolean;
  cam: boolean;
  screen: boolean;
  hand: boolean;
}

export interface RemotePeer {
  meta: ParticipantMeta;
  stream: MediaStream;
  hasVideo: boolean;
  state: RTCPeerConnectionState | 'new';
}

export interface ChatMessage { id: string; from: string; name: string; text: string; at: string; mine: boolean }

interface Signal {
  from: string;
  to: string;
  sid: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
}

interface PeerEntry {
  id: string;
  sid: string;
  remoteSid: string | null;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  remote: MediaStream;
  senders: { audio?: RTCRtpSender; video?: RTCRtpSender };
  dropTimer?: number;
  /** Incoming-video watchdog: frames decoded so far, checks without progress, restarts asked for. */
  watch: { frames: number; stalls: number; kicks: number; lastKick: number };
}

export interface CallOptions {
  driver: RealtimeDriver;
  /** The room channel; null until the API grants it. */
  channel: string | null;
  rtc: RtcConfigDto | null;
  self: { id: string; name: string; role: ParticipantRole; position?: string };
  stream: MediaStream | null;
  screen: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  hand: boolean;
  onEnded?: (payload: { endedBy?: string; endedById?: number }) => void;
  onFirstConnection?: () => void;
}

export interface Call {
  status: ConnectionStatus;
  peers: RemotePeer[];
  messages: ChatMessage[];
  sendChat: (text: string) => void;
  /** Some peer lost its media connection and is trying again. */
  reconnecting: boolean;
}

const EV_SIGNAL = 'rtc:signal';
const EV_CHAT = 'chat:message';
const EV_ENDED = 'room:ended';
/** Who is here, sent as a broadcast too, so the call still connects if presence stalls. */
const EV_HELLO = 'rtc:hello';
const EV_BYE = 'rtc:bye';
/** "Your camera is on but no picture reaches me": the sender restarts its video. */
const EV_VIDEO_KICK = 'rtc:video-kick';
const WATCH_EVERY_MS = 3000;
const STALLS_BEFORE_KICK = 2;
const MAX_KICKS = 3;
const KICK_GAP_MS = 10_000;
const HELLO_EVERY_MS = 15_000;
const HELLO_TTL_MS = 40_000;
const DROP_GRACE_MS = 8000;

/** Why media did not connect, in the console: which kinds of routes each side found. */
async function logFailure(id: string, pc: RTCPeerConnection, servers: RTCIceServer[]): Promise<void> {
  try {
    const stats = await pc.getStats();
    const kinds = { local: new Set<string>(), remote: new Set<string>() };
    stats.forEach((r: { type: string; candidateType?: string }) => {
      if (r.type === 'local-candidate' && r.candidateType) kinds.local.add(r.candidateType);
      if (r.type === 'remote-candidate' && r.candidateType) kinds.remote.add(r.candidateType);
    });
    const hasTurn = servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.startsWith('turn')));
    console.warn(`[call] media to ${id} failed. Local routes: ${[...kinds.local].join(', ') || 'none'}; remote routes: ${[...kinds.remote].join(', ') || 'none'}; TURN configured: ${hasTurn}.`
      + (kinds.local.has('relay') ? '' : ' No relay route: add a TURN server so calls work across networks.'));
  } catch { /* stats are best effort */ }
}

/** One console line per connection: bytes and frames each way, and what the other side says about its devices. */
async function logMedia(id: string, pc: RTCPeerConnection, remote: MediaStream, meta: ParticipantMeta | undefined): Promise<void> {
  if (pc.connectionState === 'closed') return;
  try {
    const stats = await pc.getStats();
    const kb = (n: unknown) => `${Math.round(Number(n ?? 0) / 1024)}KB`;
    const parts: string[] = [];
    const codec = (r: Record<string, unknown>) => {
      const c = typeof r.codecId === 'string' ? (stats.get(r.codecId) as { mimeType?: string } | undefined) : undefined;
      return c?.mimeType ? ` ${c.mimeType.replace(/^video\//, '')}` : '';
    };
    stats.forEach((r: Record<string, unknown>) => {
      if (r.type === 'inbound-rtp') {
        parts.push(`in ${String(r.kind)} ${kb(r.bytesReceived)}${r.kind === 'video' ? ` ${Number(r.framesDecoded ?? 0)} frames ${Number(r.frameWidth ?? 0)}x${Number(r.frameHeight ?? 0)}${codec(r)}` : ''}`);
      }
      if (r.type === 'outbound-rtp') {
        parts.push(`out ${String(r.kind)} ${kb(r.bytesSent)}${r.kind === 'video' ? ` ${Number(r.framesEncoded ?? 0)} frames${codec(r)}` : ''}`);
      }
    });
    const tracks = remote.getTracks().map((t) => `${t.kind}:${t.readyState}${t.muted ? '/muted' : ''}`).join(' ') || 'none';
    const says = meta ? `mic ${meta.mic ? 'on' : 'off'}, cam ${meta.cam ? 'on' : 'off'}` : 'no hello yet';
    console.info(`[call] ${id} media: ${parts.join(' · ') || 'no rtp'} | remote tracks ${tracks} | they say ${says}`);
  } catch { /* stats are best effort */ }
}

const nonce = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, '').slice(0, 16);

/**
 * A small mesh call over the realtime channel: one RTCPeerConnection per other
 * participant, "perfect negotiation" so either side may renegotiate, and a
 * per-connection session id so a participant who reloads gets a fresh
 * connection instead of a confused old one.
 */
export function useCall(opts: CallOptions): Call {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [presenceMetas, setPresenceMetas] = useState<Map<string, ParticipantMeta>>(new Map());
  const hellos = useRef(new Map<string, { meta: ParticipantMeta; at: number }>());
  const [helloVersion, bumpHello] = useReducer((x: number) => x + 1, 0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Connections live in refs; bump() re-renders when one of them changes.
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const channelRef = useRef<Channel<ParticipantMeta> | null>(null);
  const peers = useRef(new Map<string, PeerEntry>());
  const outStream = useRef(new MediaStream());
  const media = useRef({ stream: opts.stream, screen: opts.screen });
  const callbacks = useRef({ onEnded: opts.onEnded, onFirstConnection: opts.onFirstConnection });
  const connectedOnce = useRef(false);
  const selfMetaRef = useRef<ParticipantMeta | null>(null);
  const metasRef = useRef<Map<string, ParticipantMeta>>(new Map());
  const selfId = opts.self.id;

  media.current = { stream: opts.stream, screen: opts.screen };
  callbacks.current = { onEnded: opts.onEnded, onFirstConnection: opts.onFirstConnection };

  // Every status poll hands us a fresh rtc object, and TURN credentials rotate. The
  // call must survive both: the channel only depends on having a config at all, and
  // new servers are applied to open connections in place (see the effect below).
  const hasRtc = Boolean(opts.rtc);
  const rtcKey = opts.rtc ? JSON.stringify(opts.rtc.iceServers) : '';
  const iceServers = useRef<RTCIceServer[]>([]);
  iceServers.current = opts.rtc?.iceServers ?? [];
  const turnStatus = opts.rtc?.turnStatus;
  useEffect(() => {
    if (!turnStatus) return;
    const relays = iceServers.current.filter((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.startsWith('turn'))).length;
    (relays ? console.info : console.warn)(`[call] relay (TURN): ${turnStatus} · ${relays} relay server(s) in use`);
  }, [turnStatus]);

  const signal = useCallback((entry: PeerEntry, body: Omit<Signal, 'from' | 'to' | 'sid'>) => {
    channelRef.current?.send(EV_SIGNAL, { ...body, from: selfId, to: entry.id, sid: entry.sid } satisfies Signal);
  }, [selfId]);

  const syncTracks = useCallback((entry: PeerEntry) => {
    const audio = media.current.stream?.getAudioTracks()[0] ?? null;
    const video = media.current.screen?.getVideoTracks()[0] ?? media.current.stream?.getVideoTracks()[0] ?? null;
    for (const [kind, track] of [['audio', audio], ['video', video]] as const) {
      const sender = entry.senders[kind];
      if (sender) {
        if (sender.track !== track) void sender.replaceTrack(track).catch(() => undefined);
      } else if (track) {
        entry.senders[kind] = entry.pc.addTrack(track, outStream.current);
      }
    }
  }, []);

  /**
   * The other side gets no picture from us although our camera is on. First swap the
   * track out and back in (restarts the encoder, sends a fresh keyframe); if that did
   * not help, drop the video sender and add a new one, which renegotiates the video.
   */
  const restartVideo = useCallback((entry: PeerEntry, attempt: number) => {
    const sender = entry.senders.video;
    const track = sender?.track ?? media.current.screen?.getVideoTracks()[0] ?? media.current.stream?.getVideoTracks()[0] ?? null;
    console.info(`[call] ${entry.id} gets no video from us: restarting it (attempt ${attempt})`);
    if (!sender || !track) { syncTracks(entry); return; }
    if (attempt <= 1) {
      void sender.replaceTrack(null)
        .then(() => new Promise((r) => window.setTimeout(r, 300)))
        .then(() => sender.replaceTrack(track))
        .catch(() => undefined);
      return;
    }
    try {
      entry.pc.removeTrack(sender);
    } catch { /* connection closed meanwhile */ }
    entry.senders.video = undefined;
    syncTracks(entry);
  }, [syncTracks]);

  const closePeer = useCallback((id: string) => {
    const entry = peers.current.get(id);
    if (!entry) return;
    window.clearTimeout(entry.dropTimer);
    entry.pc.close();
    peers.current.delete(id);
    bump();
  }, []);

  const createPeer = useCallback((id: string): PeerEntry => {
    const pc = new RTCPeerConnection({ iceServers: iceServers.current });
    const entry: PeerEntry = { id, sid: nonce(), remoteSid: null, pc, polite: selfId > id, makingOffer: false, ignoreOffer: false, remote: new MediaStream(), senders: {},
      watch: { frames: 0, stalls: 0, kicks: 0, lastKick: 0 } };
    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) signal(entry, { description: pc.localDescription.toJSON() });
      } catch {
        /* the next negotiationneeded retries */
      } finally {
        entry.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => signal(entry, { candidate: candidate ? candidate.toJSON() : null });
    pc.ontrack = ({ track }) => {
      // A new stream object (rather than adding to the old one) makes the <video>
      // element re-bind and start playing the new audio or video track.
      const kept = entry.remote.getTracks().filter((t) => t.kind !== track.kind);
      entry.remote = new MediaStream([...kept, track]);
      track.onmute = bump;
      track.onunmute = bump;
      track.onended = bump;
      bump();
    };
    pc.onconnectionstatechange = () => {
      console.info(`[call] ${id}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') {
        void logFailure(id, pc, iceServers.current);
        pc.restartIce();
      }
      if (pc.connectionState === 'connected') {
        // What is actually flowing each way, to tell "not sent" from "not shown".
        for (const ms of [5000, 20000]) window.setTimeout(() => void logMedia(id, pc, entry.remote, hellos.current.get(id)?.meta), ms);
      }
      if (pc.connectionState === 'connected' && !connectedOnce.current) {
        connectedOnce.current = true;
        callbacks.current.onFirstConnection?.();
      }
      bump();
    };
    peers.current.set(id, entry);
    syncTracks(entry);
    bump();
    return entry;
  }, [selfId, signal, syncTracks]);

  const ensurePeer = useCallback((id: string) => peers.current.get(id) ?? createPeer(id), [createPeer]);

  const onSignal = useCallback(async (raw: unknown) => {
    const s = raw as Signal;
    if (!s || s.to !== selfId || s.from === selfId) return;
    let entry = ensurePeer(s.from);
    if (entry.remoteSid && entry.remoteSid !== s.sid) {
      // The other side started a new connection (reload or reconnect): start over with it.
      closePeer(s.from);
      entry = createPeer(s.from);
    }
    entry.remoteSid = s.sid;
    const pc = entry.pc;
    try {
      if (s.description) {
        const collision = s.description.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
        entry.ignoreOffer = !entry.polite && collision;
        if (entry.ignoreOffer) return;
        await pc.setRemoteDescription(s.description);
        if (s.description.type === 'offer') {
          await pc.setLocalDescription();
          if (pc.localDescription) signal(entry, { description: pc.localDescription.toJSON() });
        }
      } else if (s.candidate !== undefined) {
        try {
          await pc.addIceCandidate(s.candidate ?? undefined);
        } catch (e) {
          if (!entry.ignoreOffer) throw e;
        }
      }
    } catch {
      bump();
    }
  }, [closePeer, createPeer, ensurePeer, selfId, signal]);

  // Join the room channel once it is granted.
  useEffect(() => {
    if (!opts.channel || !hasRtc) return undefined;
    const ch = joinChannel<ParticipantMeta>(opts.driver, opts.channel, selfId);
    channelRef.current = ch;
    const offs = [
      ch.onStatus(setStatus),
      ch.on(EV_SIGNAL, (p) => { void onSignal(p); }),
      ch.on(EV_CHAT, (p) => {
        const m = p as Omit<ChatMessage, 'mine'>;
        if (m && typeof m.text === 'string') setMessages((list) => [...list, { ...m, text: m.text.slice(0, 2000), mine: false }].slice(-200));
      }),
      ch.on(EV_ENDED, (p) => callbacks.current.onEnded?.((p ?? {}) as { endedBy?: string; endedById?: number })),
      ch.on(EV_HELLO, (p) => {
        const meta = p as ParticipantMeta | null;
        if (!meta || typeof meta.id !== 'string' || meta.id === selfId || typeof meta.name !== 'string') return;
        const isNew = !hellos.current.has(meta.id);
        hellos.current.set(meta.id, { meta, at: Date.now() });
        bumpHello();
        // Someone new: answer at once so they learn about us without waiting.
        if (isNew && selfMetaRef.current) ch.send(EV_HELLO, selfMetaRef.current);
      }),
      ch.on(EV_BYE, (p) => {
        const id = (p as { id?: unknown } | null)?.id;
        if (typeof id === 'string' && hellos.current.delete(id)) bumpHello();
      }),
      ch.on(EV_VIDEO_KICK, (p) => {
        const k = p as { from?: unknown; to?: unknown; attempt?: unknown } | null;
        if (!k || k.to !== selfId || typeof k.from !== 'string') return;
        const entry = peers.current.get(k.from);
        if (entry) restartVideo(entry, Math.min(MAX_KICKS, Math.max(1, Number(k.attempt) || 1)));
      }),
      ch.onPresence((state) => {
        const next = new Map<string, ParticipantMeta>();
        for (const [key, list] of Object.entries(state)) {
          const meta = list[list.length - 1];
          if (key !== selfId && meta && typeof meta === 'object' && 'name' in meta) next.set(key, { ...meta, id: key });
        }
        setPresenceMetas(next);
      }),
    ];
    const current = peers.current;
    const helloMap = hellos.current;
    const helloTimer = window.setInterval(() => {
      if (selfMetaRef.current) ch.send(EV_HELLO, selfMetaRef.current);
      bumpHello(); // also expires hellos that stopped arriving
    }, HELLO_EVERY_MS);
    return () => {
      window.clearInterval(helloTimer);
      offs.forEach((off) => off());
      ch.send(EV_BYE, { id: selfId });
      helloMap.clear();
      ch.close();
      channelRef.current = null;
      for (const id of [...current.keys()]) {
        current.get(id)?.pc.close();
        current.delete(id);
      }
    };
  }, [opts.channel, opts.driver, hasRtc, selfId, onSignal, restartVideo]);

  // Rotated TURN credentials: hand them to open connections without renegotiating.
  useEffect(() => {
    for (const entry of peers.current.values()) {
      try {
        entry.pc.setConfiguration({ ...entry.pc.getConfiguration(), iceServers: iceServers.current });
      } catch { /* a closed connection keeps its old servers */ }
    }
  }, [rtcKey]);

  // Presence (who) plus recent hellos (who, and their mic/camera/hand state) decide who is in the room.
  const metas = useMemo(() => {
    const next = new Map<string, ParticipantMeta>();
    // Until their hello arrives we do not know their camera state: show whatever video
    // actually arrives rather than hiding it (a switched-off camera sends no picture anyway).
    for (const [id, m] of presenceMetas) next.set(id, { ...m, mic: m.mic ?? true, cam: m.cam ?? true, screen: m.screen ?? false, hand: m.hand ?? false, id });
    const now = Date.now();
    for (const [id, h] of hellos.current) {
      if (now - h.at > HELLO_TTL_MS) hellos.current.delete(id);
      else next.set(id, { ...h.meta, id });
    }
    return next;
    // helloVersion stands in for changes to the hellos ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenceMetas, helloVersion]);

  metasRef.current = metas;

  // Watchdog: someone says their camera is on, we are connected, yet no new video
  // frames arrive. Ask them to restart their video, a few times at most.
  useEffect(() => {
    const t = window.setInterval(() => {
      for (const [id, entry] of peers.current) {
        const meta = metasRef.current.get(id);
        if (entry.pc.connectionState !== 'connected' || !(meta?.cam || meta?.screen)) { entry.watch.stalls = 0; continue; }
        void entry.pc.getStats().then((stats) => {
          let frames = 0;
          stats.forEach((r: { type: string; kind?: string; framesDecoded?: number }) => {
            if (r.type === 'inbound-rtp' && r.kind === 'video') frames += r.framesDecoded ?? 0;
          });
          const w = entry.watch;
          if (frames > w.frames) { w.frames = frames; w.stalls = 0; return; }
          w.stalls++;
          if (w.stalls < STALLS_BEFORE_KICK || w.kicks >= MAX_KICKS || Date.now() - w.lastKick < KICK_GAP_MS) return;
          w.kicks++;
          w.lastKick = Date.now();
          w.stalls = 0;
          console.warn(`[call] no video from ${id} for ${(STALLS_BEFORE_KICK * WATCH_EVERY_MS) / 1000}s although their camera is on: asking them to restart it (attempt ${w.kicks})`);
          channelRef.current?.send(EV_VIDEO_KICK, { from: selfId, to: id, attempt: w.kicks });
        }).catch(() => undefined);
      }
    }, WATCH_EVERY_MS);
    return () => window.clearInterval(t);
  }, [selfId]);

  // Presence decides who we connect to. A short grace period rides out reconnects.
  useEffect(() => {
    for (const id of metas.keys()) {
      const entry = ensurePeer(id);
      window.clearTimeout(entry.dropTimer);
      entry.dropTimer = undefined;
    }
    for (const [id, entry] of peers.current) {
      if (!metas.has(id) && entry.dropTimer === undefined) entry.dropTimer = window.setTimeout(() => closePeer(id), DROP_GRACE_MS);
    }
  }, [metas, ensurePeer, closePeer]);

  // Publish our own state to everyone in the room.
  const selfMeta = useMemo<ParticipantMeta>(() => ({
    id: selfId, name: opts.self.name, role: opts.self.role, ...(opts.self.position ? { position: opts.self.position } : {}),
    mic: opts.micOn && Boolean(opts.stream?.getAudioTracks().length),
    cam: opts.camOn && Boolean(opts.stream?.getVideoTracks().length),
    screen: Boolean(opts.screen), hand: opts.hand,
  }), [selfId, opts.self.name, opts.self.role, opts.self.position, opts.micOn, opts.camOn, opts.stream, opts.screen, opts.hand]);
  selfMetaRef.current = selfMeta;

  // Supabase allows a client only 5 presence updates per 30 seconds and closes the
  // whole channel (signalling included) past that. So presence carries only who we
  // are, sent once; mic, camera, hand and screen changes go out as broadcasts.
  const { name: selfName, role: selfRole, position: selfPosition } = opts.self;
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || status !== 'connected') return;
    ch.track({ id: selfId, name: selfName, role: selfRole, ...(selfPosition ? { position: selfPosition } : {}) } as ParticipantMeta);
  }, [selfId, selfName, selfRole, selfPosition, status]);

  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || status !== 'connected') return;
    ch.send(EV_HELLO, selfMeta);
  }, [selfMeta, status]);

  // New camera, microphone or screen: swap the outgoing tracks on every connection.
  useEffect(() => {
    for (const entry of peers.current.values()) syncTracks(entry);
  }, [opts.stream, opts.screen, syncTracks]);

  const sendChat = useCallback((text: string) => {
    const clean = text.trim().slice(0, 2000);
    if (!clean) return;
    const msg = { id: nonce(), from: selfId, name: opts.self.name, text: clean, at: new Date().toISOString() };
    channelRef.current?.send(EV_CHAT, msg);
    setMessages((list) => [...list, { ...msg, mine: true }].slice(-200));
  }, [selfId, opts.self.name]);

  const remotePeers: RemotePeer[] = [...metas.values()].map((meta) => {
    const entry = peers.current.get(meta.id);
    const stream = entry?.remote ?? new MediaStream();
    const videoTrack = stream.getVideoTracks()[0];
    return {
      meta,
      stream,
      hasVideo: Boolean(videoTrack && videoTrack.readyState === 'live' && !videoTrack.muted && (meta.cam || meta.screen)),
      state: entry?.pc.connectionState ?? 'new',
    };
  });

  const reconnecting = status === 'disconnected' || remotePeers.some((p) => p.state === 'disconnected' || p.state === 'failed');

  return { status, peers: remotePeers, messages, sendChat, reconnecting };
}

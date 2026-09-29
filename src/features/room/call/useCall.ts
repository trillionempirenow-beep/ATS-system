import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
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
const DROP_GRACE_MS = 8000;

const nonce = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, '').slice(0, 16);

/**
 * A small mesh call over the realtime channel: one RTCPeerConnection per other
 * participant, "perfect negotiation" so either side may renegotiate, and a
 * per-connection session id so a participant who reloads gets a fresh
 * connection instead of a confused old one.
 */
export function useCall(opts: CallOptions): Call {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [metas, setMetas] = useState<Map<string, ParticipantMeta>>(new Map());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Connections live in refs; bump() re-renders when one of them changes.
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const channelRef = useRef<Channel<ParticipantMeta> | null>(null);
  const peers = useRef(new Map<string, PeerEntry>());
  const outStream = useRef(new MediaStream());
  const media = useRef({ stream: opts.stream, screen: opts.screen });
  const callbacks = useRef({ onEnded: opts.onEnded, onFirstConnection: opts.onFirstConnection });
  const connectedOnce = useRef(false);
  const selfId = opts.self.id;

  media.current = { stream: opts.stream, screen: opts.screen };
  callbacks.current = { onEnded: opts.onEnded, onFirstConnection: opts.onFirstConnection };

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

  const closePeer = useCallback((id: string) => {
    const entry = peers.current.get(id);
    if (!entry) return;
    window.clearTimeout(entry.dropTimer);
    entry.pc.close();
    peers.current.delete(id);
    bump();
  }, []);

  const createPeer = useCallback((id: string): PeerEntry => {
    const pc = new RTCPeerConnection({ iceServers: opts.rtc?.iceServers ?? [] });
    const entry: PeerEntry = { id, sid: nonce(), remoteSid: null, pc, polite: selfId > id, makingOffer: false, ignoreOffer: false, remote: new MediaStream(), senders: {} };
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
      entry.remote.getTracks().filter((t) => t.kind === track.kind && t !== track).forEach((t) => entry.remote.removeTrack(t));
      if (!entry.remote.getTracks().includes(track)) entry.remote.addTrack(track);
      track.onmute = bump;
      track.onunmute = bump;
      track.onended = bump;
      bump();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
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
  }, [opts.rtc, selfId, signal, syncTracks]);

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
    if (!opts.channel || !opts.rtc) return undefined;
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
      ch.onPresence((state) => {
        const next = new Map<string, ParticipantMeta>();
        for (const [key, list] of Object.entries(state)) {
          const meta = list[list.length - 1];
          if (key !== selfId && meta && typeof meta === 'object' && 'name' in meta) next.set(key, { ...meta, id: key });
        }
        setMetas(next);
      }),
    ];
    const current = peers.current;
    return () => {
      offs.forEach((off) => off());
      ch.close();
      channelRef.current = null;
      for (const id of [...current.keys()]) {
        current.get(id)?.pc.close();
        current.delete(id);
      }
    };
  }, [opts.channel, opts.driver, opts.rtc, selfId, onSignal]);

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
  useEffect(() => {
    channelRef.current?.track({
      id: selfId, name: opts.self.name, role: opts.self.role, ...(opts.self.position ? { position: opts.self.position } : {}),
      mic: opts.micOn && Boolean(opts.stream?.getAudioTracks().length),
      cam: opts.camOn && Boolean(opts.stream?.getVideoTracks().length),
      screen: Boolean(opts.screen), hand: opts.hand,
    });
  }, [selfId, opts.self.name, opts.self.role, opts.self.position, opts.micOn, opts.camOn, opts.stream, opts.screen, opts.hand, status]);

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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordingGrantDto } from '@shared/api/interviews';
import { api, errorMessage } from '@/lib/api';
import type { ParticipantRole, RemotePeer } from './useCall';

/** Each part is a complete file of about five minutes (~14 MB), well under the 25 MB limit. */
const PART_SECONDS = 5 * 60;
const WIDTH = 960;
const HEIGHT = 540;
const FPS = 15;

function pickMime(): string {
  for (const m of ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export type RecorderState = 'off' | 'recording' | 'error';

/** One person in the recording: what to show and what to hear. */
interface Person {
  id: string;
  name: string;
  tag: string;
  /** The video to draw (camera, or the shared screen). */
  video: MediaStream | null;
  /** The microphone to mix in. */
  audio: MediaStream | null;
  showVideo: boolean;
  /** Interviewer or candidate: the two the meeting is about. */
  lead: boolean;
  presenting: boolean;
  self: boolean;
}
interface Graph {
  ctx: AudioContext;
  dest: MediaStreamAudioDestinationNode;
  sources: Map<string, MediaStreamAudioSourceNode>;
  sinks: Map<string, HTMLAudioElement>;
  videos: Map<string, HTMLVideoElement>;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const TILE_BG = '#1b2336';
const PAD = 16;
const GAP = 10;
const SMALL_W = 164;
const SMALL_H = 103;

/** The same arrangement the call screen uses: the two leads large, everyone else small underneath. */
function arrange(list: Person[]) {
  const me = list.find((x) => x.self)!;
  const peers = list.filter((x) => !x.self);
  const sharing = peers.find((x) => x.presenting) ?? null;
  const leads = peers.filter((x) => x.lead);
  const audience = peers.filter((x) => !x.lead);
  if (!sharing && (audience.length > 0 || !me.lead)) {
    return { main: [...leads, ...(me.lead ? [me] : [])], strip: [...audience, ...(me.lead ? [] : [me])], pip: null as Person | null };
  }
  const presenter = sharing ?? peers[0] ?? null;
  return { main: presenter ? [presenter] : [], strip: peers.filter((x) => x !== presenter), pip: me };
}

function drawTile(c: CanvasRenderingContext2D, p: Person, el: HTMLVideoElement | undefined, x: number, y: number, w: number, h: number, small: boolean) {
  c.save();
  c.beginPath(); c.roundRect(x, y, w, h, small ? 10 : 14); c.clip();
  c.fillStyle = TILE_BG;
  c.fillRect(x, y, w, h);
  if (p.showVideo && el && el.readyState >= 2 && el.videoWidth) {
    const vw = el.videoWidth; const vh = el.videoHeight;
    if (small) {
      const scale = Math.max(w / vw, h / vh);
      const sw = w / scale; const sh = h / scale;
      c.drawImage(el, (vw - sw) / 2, (vh - sh) / 2, sw, sh, x, y, w, h);
    } else {
      const scale = Math.min(w / vw, h / vh);
      c.drawImage(el, x + (w - vw * scale) / 2, y + (h - vh * scale) / 2, vw * scale, vh * scale);
    }
  } else {
    const r = Math.min(w, h) * (small ? 0.22 : 0.16);
    c.fillStyle = '#2d3648';
    c.beginPath(); c.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e6e9ec';
    c.font = `600 ${Math.round(r * 0.8)}px system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(initials(p.name), x + w / 2, y + h / 2);
  }
  c.restore();
  const size = small ? 11 : 15;
  c.font = `500 ${size}px system-ui, sans-serif`;
  c.textAlign = 'left'; c.textBaseline = 'middle';
  const full = p.tag ? `${p.name} · ${p.tag}` : p.name;
  const label = full.length > 44 ? `${full.slice(0, 43)}…` : full;
  const lh = small ? 20 : 28; const off = small ? 6 : 12;
  const lw = Math.min(w - off * 2, c.measureText(label).width + 20);
  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.beginPath(); c.roundRect(x + off, y + h - off - lh, lw, lh, 8); c.fill();
  c.fillStyle = '#ffffff';
  c.fillText(label, x + off + 10, y + h - off - lh / 2 + 1, lw - 14);
}

function drawStage(c: CanvasRenderingContext2D, list: Person[], videos: Map<string, HTMLVideoElement>, waitingFor: string) {
  c.fillStyle = '#0a0e17';
  c.fillRect(0, 0, WIDTH, HEIGHT);
  const { main, strip, pip } = arrange(list);
  const stripH = strip.length ? SMALL_H : 0;
  const mainX = PAD; const mainY = PAD;
  const mainW = WIDTH - PAD * 2;
  const mainH = HEIGHT - PAD * 2 - (stripH ? stripH + GAP : 0);
  if (main.length) {
    const tw = (mainW - GAP * (main.length - 1)) / main.length;
    main.forEach((p, i) => drawTile(c, p, videos.get(p.id), mainX + i * (tw + GAP), mainY, tw, mainH, false));
  } else {
    c.fillStyle = TILE_BG;
    c.beginPath(); c.roundRect(mainX, mainY, mainW, mainH, 14); c.fill();
    c.fillStyle = '#2d3648';
    c.beginPath(); c.arc(mainX + mainW / 2, mainY + mainH / 2 - 26, 46, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e6e9ec';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '600 34px system-ui, sans-serif';
    c.fillText(initials(waitingFor), mainX + mainW / 2, mainY + mainH / 2 - 26);
    c.font = '600 18px system-ui, sans-serif';
    c.fillText(`Waiting for ${waitingFor}`, mainX + mainW / 2, mainY + mainH / 2 + 50);
    c.font = '400 13px system-ui, sans-serif';
    c.fillStyle = 'rgba(230,233,236,0.7)';
    c.fillText('They have not joined yet.', mainX + mainW / 2, mainY + mainH / 2 + 74);
  }
  if (pip) drawTile(c, pip, videos.get(pip.id), mainX + mainW - SMALL_W - 12, mainY + mainH - SMALL_H - 12, SMALL_W, SMALL_H, true);
  if (strip.length) {
    const w = Math.min(SMALL_W, (mainW - GAP * (strip.length - 1)) / strip.length);
    const h = Math.round(w * (SMALL_H / SMALL_W));
    const total = strip.length * w + GAP * (strip.length - 1);
    const x0 = (WIDTH - total) / 2;
    const y = HEIGHT - PAD - stripH + (stripH - h) / 2;
    strip.forEach((p, i) => drawTile(c, p, videos.get(p.id), x0 + i * (w + GAP), y, w, h, true));
  }
}

const TAGS: Record<string, string> = { interviewer: 'Interviewer', candidate: 'Candidate', staff: 'Hiring team' };

/**
 * Records the meeting in the interviewer's browser: the call stage (the big
 * tiles with the small ones underneath, no panels or controls) drawn on one
 * canvas plus everyone's sound, uploaded in five-minute parts. Only runs while
 * `enabled`; closing the tab ends it.
 */
export function useMeetingRecorder(opts: {
  interviewId: number;
  enabled: boolean;
  self: { name: string; role: ParticipantRole; stream: MediaStream | null; screen: MediaStream | null; cam: boolean };
  peers: RemotePeer[];
  /** Shown on the stage until the candidate joins. */
  waitingFor: string;
  initialParts: number;
}) {
  const [state, setState] = useState<RecorderState>('off');
  const [error, setError] = useState<string | null>(null);
  const [parts, setParts] = useState(opts.initialParts);
  const graph = useRef<Graph | null>(null);
  const people = useRef<Person[]>([]);
  const waiting = useRef(opts.waitingFor);
  waiting.current = opts.waitingFor;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const stopRef = useRef<(() => void) | null>(null);

  const lead = (role: ParticipantRole) => role === 'interviewer' || role === 'candidate';
  people.current = [
    {
      id: 'self', name: opts.self.name, tag: TAGS[opts.self.role] ?? '', video: opts.self.screen ?? opts.self.stream, audio: opts.self.stream,
      showVideo: Boolean(opts.self.screen || (opts.self.stream?.getVideoTracks().length && opts.self.cam)), lead: lead(opts.self.role), presenting: false, self: true,
    },
    ...opts.peers.map((p) => ({
      id: p.meta.id, name: p.meta.name, tag: p.meta.role === 'guest' ? p.meta.position ?? 'Guest' : TAGS[p.meta.role] ?? '',
      video: p.stream, audio: p.stream, showVideo: p.hasVideo && (p.meta.cam || p.meta.screen), lead: lead(p.meta.role), presenting: p.meta.screen, self: false,
    })),
  ];

  const upload = useCallback((blob: Blob, mime: string, startedAt: string, seconds: number) => {
    if (blob.size < 4000) return;
    const base = mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
    queue.current = queue.current.then(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const g = await api.post<RecordingGrantDto>(`/interviews/${opts.interviewId}/recordings/grant`, { mime: base });
          const put = await fetch(g.uploadUrl, { method: 'PUT', headers: { ...g.headers, 'Content-Type': base }, body: blob });
          if (!put.ok) throw new Error(`The recording part did not upload (${put.status}).`);
          const r = await api.post<{ parts: number }>(`/interviews/${opts.interviewId}/recordings`, {
            path: g.path, token: g.token, mime: base, sizeBytes: blob.size, durationSec: seconds, startedAt,
          });
          setParts(r.parts);
          setError(null);
          return;
        } catch (e) {
          if (attempt === 1) setError(errorMessage(e));
        }
      }
    });
  }, [opts.interviewId]);

  useEffect(() => {
    if (!opts.enabled) { setState('off'); return undefined; }
    const mime = pickMime();
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH; canvas.height = HEIGHT;
    const c = canvas.getContext('2d');
    if (!mime || !c || typeof canvas.captureStream !== 'function') {
      setState('error'); setError('This browser cannot record the meeting. Use Chrome or Edge.');
      return undefined;
    }
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    graph.current = { ctx, dest, sources: new Map(), sinks: new Map(), videos: new Map() };
    void ctx.resume().catch(() => undefined);

    // Timers keep drawing in a background tab, where animation frames stop.
    const draw = window.setInterval(() => {
      const g = graph.current; if (!g) return;
      drawStage(c, people.current, g.videos, waiting.current);
    }, 1000 / FPS);

    const video = canvas.captureStream(FPS).getVideoTracks()[0]!;
    const mixed = new MediaStream([video, ...dest.stream.getAudioTracks()]);
    let stopped = false;
    let recorder: MediaRecorder | null = null;
    let timer: number | undefined;
    const part = () => {
      if (stopped) return;
      const chunks: Blob[] = [];
      const startedAt = new Date().toISOString();
      const t0 = Date.now();
      recorder = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 400_000, audioBitsPerSecond: 32_000 });
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => upload(new Blob(chunks, { type: mime }), mime, startedAt, Math.round((Date.now() - t0) / 1000));
      recorder.start(10_000);
      timer = window.setTimeout(() => { recorder?.stop(); part(); }, PART_SECONDS * 1000);
    };
    part();
    setState('recording');

    const stop = () => {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(timer);
      window.clearInterval(draw);
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      video.stop();
      const g = graph.current;
      for (const a of g?.sinks.values() ?? []) a.srcObject = null;
      for (const v of g?.videos.values() ?? []) v.srcObject = null;
      graph.current = null;
      void ctx.close().catch(() => undefined);
    };
    stopRef.current = stop;
    return () => { stop(); stopRef.current = null; };
  }, [opts.enabled, upload]);

  // Keep the picture and the mix in step with who is in the room.
  const key = people.current.map((t) => `${t.id}:${t.audio?.getAudioTracks()[0]?.id ?? ''}:${t.video?.getVideoTracks()[0]?.id ?? ''}`).join('|');
  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    const wantedAudio = new Map<string, MediaStreamTrack>();
    const wantedVideo = new Map<string, MediaStream>();
    for (const t of people.current) {
      const a = t.audio?.getAudioTracks()[0];
      if (a) wantedAudio.set(`${t.id}:${a.id}`, a);
      const v = t.video?.getVideoTracks()[0];
      if (v) wantedVideo.set(t.id, new MediaStream([v]));
    }
    for (const [k, node] of g.sources) {
      if (wantedAudio.has(k)) continue;
      node.disconnect(); g.sources.delete(k);
      const sink = g.sinks.get(k); if (sink) { sink.srcObject = null; g.sinks.delete(k); }
    }
    for (const [k, t] of wantedAudio) {
      if (g.sources.has(k)) continue;
      const stream = new MediaStream([t]);
      // Chrome gives Web Audio silence for a remote track unless an element also plays it.
      if (!k.startsWith('self:')) {
        const sink = new Audio(); sink.muted = true; sink.srcObject = stream;
        void sink.play().catch(() => undefined);
        g.sinks.set(k, sink);
      }
      const node = g.ctx.createMediaStreamSource(stream);
      node.connect(g.dest);
      g.sources.set(k, node);
    }
    for (const [id, el] of g.videos) {
      const want = wantedVideo.get(id);
      const have = (el.srcObject as MediaStream | null)?.getVideoTracks()[0];
      if (!want || have?.id !== want.getVideoTracks()[0]!.id) { el.srcObject = null; g.videos.delete(id); }
    }
    for (const [id, stream] of wantedVideo) {
      if (g.videos.has(id)) continue;
      const el = document.createElement('video');
      el.muted = true; el.playsInline = true; el.srcObject = stream;
      void el.play().catch(() => undefined);
      g.videos.set(id, el);
    }
    // The people list is captured by key.
  }, [key, state]);

  /** Stop and wait (briefly) for the last part to reach storage, before the meeting ends. */
  const finish = useCallback(async () => {
    stopRef.current?.();
    // onstop fires asynchronously; give it a moment to queue the last part.
    await new Promise((r) => window.setTimeout(r, 300));
    await Promise.race([queue.current, new Promise((r) => window.setTimeout(r, 30_000))]);
  }, []);

  return { state, error, parts, finish };
}

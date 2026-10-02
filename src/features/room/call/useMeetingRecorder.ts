import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordingGrantDto } from '@shared/api/interviews';
import { api, errorMessage } from '@/lib/api';
import type { RemotePeer } from './useCall';

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

interface Tile { id: string; name: string; stream: MediaStream | null; video: boolean }
interface Graph {
  ctx: AudioContext;
  dest: MediaStreamAudioDestinationNode;
  sources: Map<string, MediaStreamAudioSourceNode>;
  sinks: Map<string, HTMLAudioElement>;
  videos: Map<string, HTMLVideoElement>;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** Draws one tile: the camera, cropped to fill, or the person's initials when it is off. */
function drawTile(c: CanvasRenderingContext2D, t: Tile, el: HTMLVideoElement | undefined, x: number, y: number, w: number, h: number) {
  c.fillStyle = '#1b1f24';
  c.fillRect(x, y, w, h);
  if (t.video && el && el.readyState >= 2 && el.videoWidth) {
    const scale = Math.max(w / el.videoWidth, h / el.videoHeight);
    const sw = w / scale; const sh = h / scale;
    c.drawImage(el, (el.videoWidth - sw) / 2, (el.videoHeight - sh) / 2, sw, sh, x, y, w, h);
  } else {
    const r = Math.min(w, h) * 0.16;
    c.fillStyle = '#2d343c';
    c.beginPath(); c.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e6e9ec';
    c.font = `600 ${Math.round(r * 0.8)}px system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(initials(t.name), x + w / 2, y + h / 2);
  }
  c.font = '500 14px system-ui, sans-serif';
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  const label = t.name.length > 40 ? `${t.name.slice(0, 39)}…` : t.name;
  const tw = c.measureText(label).width;
  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.fillRect(x + 8, y + h - 30, tw + 16, 22);
  c.fillStyle = '#ffffff';
  c.fillText(label, x + 16, y + h - 14);
}

/**
 * Records the meeting in the interviewer's browser: every camera tile drawn on
 * one canvas (no screen, no controls) plus everyone's sound, uploaded in
 * five-minute parts. Only runs while `enabled`; closing the tab ends it.
 */
export function useMeetingRecorder(opts: {
  interviewId: number;
  enabled: boolean;
  self: { id: string; name: string; stream: MediaStream | null; cam: boolean };
  peers: RemotePeer[];
  initialParts: number;
}) {
  const [state, setState] = useState<RecorderState>('off');
  const [error, setError] = useState<string | null>(null);
  const [parts, setParts] = useState(opts.initialParts);
  const graph = useRef<Graph | null>(null);
  const tiles = useRef<Tile[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const stopRef = useRef<(() => void) | null>(null);

  tiles.current = [
    { id: 'self', name: opts.self.name, stream: opts.self.stream, video: opts.self.cam },
    ...opts.peers.map((p) => ({ id: p.meta.id, name: p.meta.name, stream: p.stream, video: p.hasVideo && p.meta.cam })),
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
      const list = tiles.current;
      const cols = Math.ceil(Math.sqrt(list.length));
      const rows = Math.ceil(list.length / cols);
      const gap = 6;
      const w = (WIDTH - gap * (cols + 1)) / cols;
      const h = (HEIGHT - gap * (rows + 1)) / rows;
      c.fillStyle = '#0d0f12';
      c.fillRect(0, 0, WIDTH, HEIGHT);
      list.forEach((t, i) => {
        const r = Math.floor(i / cols);
        const inRow = r === rows - 1 ? list.length - r * cols : cols;
        const offset = (WIDTH - (inRow * w + (inRow + 1) * gap)) / 2;
        drawTile(c, t, g.videos.get(t.id), offset + gap + (i % cols) * (w + gap), gap + r * (h + gap), w, h);
      });
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
      recorder = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 350_000, audioBitsPerSecond: 32_000 });
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
  const key = tiles.current.map((t) => `${t.id}:${t.stream?.id ?? ''}:${t.stream?.getTracks().map((x) => x.id).join(',') ?? ''}`).join('|');
  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    const wantedAudio = new Map<string, MediaStreamTrack>();
    const wantedVideo = new Map<string, MediaStream>();
    for (const t of tiles.current) {
      const a = t.stream?.getAudioTracks()[0];
      if (a) wantedAudio.set(`${t.id}:${a.id}`, a);
      const v = t.stream?.getVideoTracks()[0];
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
    // The tile list is captured by key.
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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiNoteDto } from '@shared/api/interviews';
import { api, errorMessage } from '@/lib/api';
import type { RemotePeer } from './useCall';

/** Seconds of sound per piece sent for notes. */
const PIECE_SECONDS = 30;

function pickMime(): string {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

const toBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

export type AiNotesState = 'off' | 'starting' | 'listening' | 'error';

/**
 * The interviewer's AI notes. While on, the meeting's sound (the interviewer's
 * microphone mixed with everyone they hear) is recorded in ~30-second pieces;
 * each piece goes to the ATS, which has it transcribed and turned into notes.
 * Nothing is recorded while off, and pieces are not kept in the browser.
 */
export function useAiNotes(opts: {
  interviewId: number;
  enabled: boolean;
  initial: AiNoteDto[];
  mic: MediaStream | null;
  peers: RemotePeer[];
  elapsedSeconds: () => number;
}) {
  const [notes, setNotes] = useState<AiNoteDto[]>(opts.initial);
  const [state, setState] = useState<AiNotesState>(opts.enabled ? 'starting' : 'off');
  const [error, setError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);
  /** What the last pieces sounded like, so the interviewer can see it is listening before any note appears. */
  const [heard, setHeard] = useState<Array<{ atSecond: number; text: string }>>([]);
  const [silent, setSilent] = useState(false);
  const graph = useRef<{ ctx: AudioContext; dest: MediaStreamAudioDestinationNode; sources: Map<string, MediaStreamAudioSourceNode>; sinks: Map<string, HTMLAudioElement> } | null>(null);
  const elapsed = useRef(opts.elapsedSeconds);
  elapsed.current = opts.elapsedSeconds;

  const send = useCallback(async (blob: Blob, atSecond: number, mime: string) => {
    if (blob.size < 2000) return; // silence or a stopped piece
    try {
      const audio = await toBase64(blob);
      const r = await api.post<{ notes: AiNoteDto[]; heard?: string }>(`/interviews/${opts.interviewId}/assistant/chunk`, { audio, audioMime: mime, atSecond });
      if (r.notes.length) setNotes((list) => [...list, ...r.notes]);
      const words = (r.heard ?? '').trim();
      setSilent(!words);
      if (words) setHeard((list) => [...list, { atSecond, text: words }].slice(-3));
      setLastAt(new Date().toISOString());
      setError(null);
      setState('listening');
    } catch (e) {
      // One failed piece is skipped; the next one tries again.
      setError(errorMessage(e));
    }
  }, [opts.interviewId]);

  // Record while enabled: one AudioContext mixing every voice, restarted every piece
  // so each upload is a complete audio file.
  useEffect(() => {
    if (!opts.enabled) { setState('off'); return undefined; }
    const mime = pickMime();
    if (!mime) { setState('error'); setError('This browser cannot record audio for AI notes. Use Chrome or Edge.'); return undefined; }
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    graph.current = { ctx, dest, sources: new Map(), sinks: new Map() };
    let stopped = false;
    let recorder: MediaRecorder | null = null;
    let timer: number | undefined;
    const piece = () => {
      if (stopped) return;
      const parts: Blob[] = [];
      const atSecond = elapsed.current();
      recorder = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 32_000 });
      recorder.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      recorder.onstop = () => { void send(new Blob(parts, { type: mime }), atSecond, mime); };
      recorder.start();
      timer = window.setTimeout(() => { recorder?.stop(); piece(); }, PIECE_SECONDS * 1000);
    };
    void ctx.resume().catch(() => undefined);
    piece();
    setState('listening');
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      for (const a of graph.current?.sinks.values() ?? []) a.srcObject = null;
      graph.current = null;
      void ctx.close().catch(() => undefined);
    };
  }, [opts.enabled, send]);

  // Keep the mix in step with who is talking in the room.
  const tracks = [
    ...(opts.mic?.getAudioTracks().slice(0, 1).map((t) => ['self', t] as const) ?? []),
    ...opts.peers.flatMap((p) => p.stream.getAudioTracks().slice(0, 1).map((t) => [p.meta.id, t] as const)),
  ];
  const key = tracks.map(([id, t]) => `${id}:${t.id}`).join('|');
  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    const wanted = new Map(tracks.map(([id, t]) => [`${id}:${t.id}`, t]));
    for (const [k, node] of g.sources) {
      if (!wanted.has(k)) {
        node.disconnect(); g.sources.delete(k);
        const sink = g.sinks.get(k); if (sink) { sink.srcObject = null; g.sinks.delete(k); }
      }
    }
    for (const [k, t] of wanted) {
      if (g.sources.has(k)) continue;
      const stream = new MediaStream([t]);
      // Chrome hands Web Audio silence for a remote call track unless a media element is
      // also playing it; a muted element keeps the candidate's voice in the recording.
      if (!k.startsWith('self:')) {
        const sink = new Audio();
        sink.muted = true;
        sink.srcObject = stream;
        void sink.play().catch(() => undefined);
        g.sinks.set(k, sink);
      }
      const node = g.ctx.createMediaStreamSource(stream);
      node.connect(g.dest);
      g.sources.set(k, node);
    }
    // The track list is captured by key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, state]);

  return { notes, state, error, lastAt, heard, silent };
}

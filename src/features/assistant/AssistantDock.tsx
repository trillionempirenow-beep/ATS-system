import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantActionDto, AssistantConfirmDto, AssistantReplyDto } from '@shared/api/assistant';
import { Icon, type IconName } from '@/components/icon/Icon';
import { Button, IconButton } from '@/components/ui/Button';
import { Avatar, Badge } from '@/components/ui/Display';
import { api, errorMessage } from '@/lib/api';
import { cx } from '@/lib/cx';
import { useMe } from '@/app/providers/AuthProvider';
import { ActionPreview } from './ActionPreview';
import s from './AssistantDock.module.css';

/**
 * Acme assistant: the recruiting helper docked bottom-right of the staff app.
 * Each turn goes to the "ats-assistant" n8n workflow through the API. Changes
 * it prepares come back as cards; nothing happens until the person confirms.
 * Hold the mic to talk; letting go sends the recording, and the reply is spoken.
 */

/** The robot's head: the assistant's mark on its top-bar button and in the panel. */
const HEAD_SRC = '/acme-assistant-head.webp';
/** Shorter than this is a tap, not speech. */
const MIN_RECORDING_MS = 600;
const MAX_RECORDING_MS = 60_000;
/** Dragging this far off the mic while holding cancels the recording. */
const CANCEL_DISTANCE = 64;

const SUGGESTIONS: { icon: IconName; label: string }[] = [
  { icon: 'interviews', label: "Show today's interviews" },
  { icon: 'pipeline', label: 'Who is in screening right now?' },
  { icon: 'mail', label: 'Draft a follow-up email to an applicant' },
  { icon: 'checkcircle', label: "What's waiting for approval?" },
];

interface Message {
  id: number;
  from: 'me' | 'bot';
  text: string;
  at: Date;
  voice?: boolean;
  error?: boolean;
  actions?: AssistantActionDto[];
}

type ActionState =
  | { status: 'busy' }
  | { status: 'done'; result: AssistantConfirmDto; undoing?: boolean; undone?: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

/** One hold-to-talk recording, from the press until it is sent or dropped. */
interface Recording {
  recorder: MediaRecorder | null;
  stream: MediaStream | null;
  chunks: Blob[];
  since: number;
  /** Still held down; false once let go (possibly before the mic was even allowed). */
  held: boolean;
  cancel: boolean;
  stopTimer: number;
  meter: number;
  ctx: AudioContext | null;
}

const clock = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const recordingType = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
const elapsed = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** A change the assistant prepared: what it will do, and Confirm / Cancel. */
function ActionCard({ action, state, onConfirm, onCancel, onUndo }: {
  action: AssistantActionDto; state: ActionState | undefined;
  onConfirm: () => void; onCancel: () => void; onUndo: () => void;
}) {
  const [main, ...rest] = action.lines;
  const [previewing, setPreviewing] = useState(false);
  const pending = !state || state.status === 'busy';
  return (
    <div className={cx(s.card, s.action)}>
      {action.preview ? (
        <ActionPreview
          preview={action.preview}
          confirmLabel={action.confirmLabel}
          open={previewing}
          busy={state?.status === 'busy'}
          onClose={() => setPreviewing(false)}
          onConfirm={() => { setPreviewing(false); onConfirm(); }}
        />
      ) : null}
      <div className={s.actionBody}>
        <div className={s.actionTitle}>{action.title}</div>
        {main ? <div className={s.actionLine}>{main}</div> : null}
        {rest.map((l, i) => <div key={i} className={cx(s.actionLine, s.actionMuted)}>{l}</div>)}
      </div>
      <div className={s.actionFoot}>
        {pending ? (
          <>
            {action.preview ? <Button size="sm" variant="ghost" icon="eye" onClick={() => setPreviewing(true)} className={s.actionPreviewBtn}>Preview</Button> : null}
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={state?.status === 'busy'}>Cancel</Button>
            <Button size="sm" onClick={onConfirm} loading={state?.status === 'busy'}>{action.confirmLabel}</Button>
          </>
        ) : state.status === 'cancelled' ? (
          <span className={s.actionNote}>Cancelled. Nothing was changed.</span>
        ) : state.status === 'error' ? (
          <>
            <span className={cx(s.actionNote, s.actionError)}>{state.message}</span>
            <Button size="sm" variant="ghost" onClick={onConfirm}>Try again</Button>
          </>
        ) : (
          <>
            <span className={cx(s.actionNote, s.actionDone)}><Icon name="check" size={14} />{state.undone ?? state.result.message}</span>
            {state.result.undoToken && !state.undone ? <Button size="sm" variant="ghost" onClick={onUndo} loading={state.undoing}>Undo</Button> : null}
            {state.result.link ? <Link className={s.actionLink} to={state.result.link}>Open</Link> : null}
          </>
        )}
      </div>
    </div>
  );
}

const ASSISTANT_TOGGLE = 'acme:assistant-toggle';
const ASSISTANT_STATE = 'acme:assistant-state';

/** The assistant's launcher, placed in the top bar so it never sits on top of page content. */
export function AssistantButton({ className, labelClassName }: { className?: string; labelClassName?: string }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onState = (e: Event) => setOpen(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(ASSISTANT_STATE, onState);
    return () => window.removeEventListener(ASSISTANT_STATE, onState);
  }, []);
  if (/\/interviews\/[^/]+\/room/.test(location.pathname)) return null;
  return (
    <button type="button" className={className} aria-expanded={open} aria-label="Acme assistant"
      onClick={(e) => window.dispatchEvent(new CustomEvent(ASSISTANT_TOGGLE, { detail: e.currentTarget }))}>
      <img src={HEAD_SRC} alt="" width={24} height={24} draggable={false} />
      <span className={labelClassName}>Assistant</span>
    </button>
  );
}

export function AssistantDock() {
  const me = useMe();
  const location = useLocation();
  const queryClient = useQueryClient();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [recording, setRecording] = useState<{ since: number; cancel: boolean } | null>(null);
  const [now, setNow] = useState(0);
  const [level, setLevel] = useState(0);
  const [micNote, setMicNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const micRef = useRef<HTMLButtonElement>(null);
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const rec = useRef<Recording | null>(null);
  const turn = useRef(0);
  const canRecord = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  const firstName = me.name.trim().split(/\s+/)[0] ?? '';

  // Calls fill the screen; the assistant stays out of the way there.
  const hidden = /\/interviews\/[^/]+\/room/.test(location.pathname);

  // React 18 has no `inert` prop: keep the closed panel out of the tab order and the accessibility tree.
  useEffect(() => { panelRef.current?.toggleAttribute('inert', !open); }, [open, hidden]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 260);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking, actionStates]);

  // Grow the composer with its text, up to four lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // scrollHeight leaves out the border; without it the box is 2px short and shows a scrollbar.
    const full = el.scrollHeight + el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(full, 104)}px`;
    el.style.overflowY = full > 104 ? 'auto' : 'hidden';
  }, [draft, recording]);

  // The recording timer.
  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(t);
  }, [recording]);

  // Let go of the mic and the speaker when the dock goes away.
  useEffect(() => () => { releaseMic(); voiceRef.current?.pause(); }, []);

  // The launcher lives in the top bar (AssistantButton); it asks the dock to open or close.
  useEffect(() => {
    const onToggle = (e: Event) => {
      openerRef.current = (e as CustomEvent<HTMLElement | null>).detail ?? null;
      setOpen((v) => !v);
    };
    window.addEventListener(ASSISTANT_TOGGLE, onToggle);
    return () => window.removeEventListener(ASSISTANT_TOGGLE, onToggle);
  }, []);
  useEffect(() => { window.dispatchEvent(new CustomEvent(ASSISTANT_STATE, { detail: open })); }, [open]);

  if (hidden) return null;

  function close() {
    setOpen(false);
    voiceRef.current?.pause();
    openerRef.current?.focus();
  }

  function reset() {
    turn.current += 1; // drops a reply that is still on its way
    setThinking(false);
    setMessages([]);
    setActionStates({});
    voiceRef.current?.pause();
    inputRef.current?.focus();
  }

  const history = () => messages.filter((m) => !m.error && m.text).slice(-10).map((m) => ({ role: m.from === 'me' ? 'user' as const : 'assistant' as const, text: m.text.slice(0, 4000) }));

  async function ask(input: { text?: string; audio?: string; audioMime?: string }, placeholderId: number) {
    const myTurn = ++turn.current;
    setThinking(true);
    try {
      const res = await api.post<AssistantReplyDto>('/assistant/message', { ...input, history: history(), page: location.pathname });
      if (myTurn !== turn.current) return;
      setMessages((m) => [
        // A spoken message shows what was heard.
        ...m.map((x) => (x.id === placeholderId && res.transcript ? { ...x, text: res.transcript } : x)),
        { id: Date.now(), from: 'bot', text: res.reply, at: new Date(), actions: res.actions },
      ]);
      if (res.audio) {
        voiceRef.current?.pause();
        voiceRef.current = new Audio(`data:${res.audioMime ?? 'audio/mpeg'};base64,${res.audio}`);
        void voiceRef.current.play().catch(() => undefined);
      }
    } catch (e) {
      if (myTurn !== turn.current) return;
      setMessages((m) => [
        ...m.map((x) => (x.id === placeholderId && x.voice && !x.text ? { ...x, text: '(voice message)' } : x)),
        { id: Date.now(), from: 'bot', text: errorMessage(e), at: new Date(), error: true },
      ]);
    } finally {
      if (myTurn === turn.current) setThinking(false);
    }
  }

  function send(text: string) {
    const clean = text.trim();
    if (!clean || thinking) return;
    const id = Date.now();
    setMessages((m) => [...m, { id, from: 'me', text: clean, at: new Date() }]);
    setDraft('');
    void ask({ text: clean }, id);
  }

  async function confirmAction(a: AssistantActionDto) {
    setActionStates((st) => ({ ...st, [a.token]: { status: 'busy' } }));
    try {
      const result = await api.post<AssistantConfirmDto>('/assistant/actions/confirm', { token: a.token });
      setActionStates((st) => ({ ...st, [a.token]: { status: 'done', result } }));
      // Boards, lists and counts on screen catch up straight away.
      void queryClient.invalidateQueries();
    } catch (e) {
      setActionStates((st) => ({ ...st, [a.token]: { status: 'error', message: errorMessage(e) } }));
    }
  }

  async function undoAction(a: AssistantActionDto) {
    const state = actionStates[a.token];
    if (state?.status !== 'done' || !state.result.undoToken) return;
    setActionStates((st) => ({ ...st, [a.token]: { ...state, undoing: true } }));
    try {
      const res = await api.post<AssistantConfirmDto>('/assistant/actions/undo', { token: state.result.undoToken });
      setActionStates((st) => ({ ...st, [a.token]: { ...state, undoing: false, undone: res.message } }));
      void queryClient.invalidateQueries();
    } catch (e) {
      setActionStates((st) => ({ ...st, [a.token]: { status: 'error', message: errorMessage(e) } }));
    }
  }

  // ---- Hold to talk -------------------------------------------------------------

  function releaseMic() {
    const r = rec.current;
    if (!r) return;
    window.clearTimeout(r.stopTimer);
    cancelAnimationFrame(r.meter);
    r.stream?.getTracks().forEach((t) => t.stop());
    void r.ctx?.close().catch(() => undefined);
    rec.current = null;
    setRecording(null);
    setLevel(0);
  }

  async function startRecording() {
    if (rec.current || thinking || !canRecord) return;
    setMicNote(null);
    voiceRef.current?.pause();
    const r: Recording = { recorder: null, stream: null, chunks: [], since: Date.now(), held: true, cancel: false, stopTimer: 0, meter: 0, ctx: null };
    rec.current = r;
    try {
      r.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      rec.current = null;
      setMicNote('Allow the microphone for this site, then hold the mic to talk.');
      return;
    }
    // Let go while the browser was still asking for the mic: nothing to send.
    if (!r.held || rec.current !== r) { r.stream.getTracks().forEach((t) => t.stop()); if (rec.current === r) rec.current = null; return; }
    const type = recordingType();
    r.recorder = new MediaRecorder(r.stream, type ? { mimeType: type } : undefined);
    r.recorder.ondataavailable = (e) => { if (e.data.size) r.chunks.push(e.data); };
    r.recorder.onstop = () => void finishRecording(r);
    r.recorder.start();
    r.since = Date.now();
    r.stopTimer = window.setTimeout(() => stopRecording(), MAX_RECORDING_MS);
    setNow(Date.now());
    setRecording({ since: r.since, cancel: false });
    // A small level meter so it is clear the mic hears them.
    try {
      r.ctx = new AudioContext();
      const analyser = r.ctx.createAnalyser();
      analyser.fftSize = 256;
      r.ctx.createMediaStreamSource(r.stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        r.meter = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* the meter is only decoration */ }
  }

  function stopRecording(cancel = false) {
    const r = rec.current;
    if (!r) return;
    r.held = false;
    r.cancel = r.cancel || cancel;
    // finishRecording runs on stop. Without a recorder the mic was not allowed yet; startRecording drops it.
    if (r.recorder && r.recorder.state !== 'inactive') r.recorder.stop();
  }

  async function finishRecording(r: Recording) {
    const length = Date.now() - r.since;
    const type = r.recorder?.mimeType || 'audio/webm';
    releaseMic();
    if (r.cancel) return;
    if (length < MIN_RECORDING_MS) { setMicNote('Hold the mic while you talk, then let go to send.'); return; }
    const blob = new Blob(r.chunks, { type });
    if (!blob.size) return;
    const audio = await toBase64(blob);
    const id = Date.now();
    setMessages((m) => [...m, { id, from: 'me', text: '', at: new Date(), voice: true }]);
    void ask({ audio, audioMime: type }, id);
  }

  const micDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    void startRecording();
  };
  const micMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const r = rec.current;
    if (!r || !micRef.current) return;
    const b = micRef.current.getBoundingClientRect();
    const away = Math.max(b.left - e.clientX, e.clientX - b.right, b.top - e.clientY, e.clientY - b.bottom) > CANCEL_DISTANCE;
    if (away !== r.cancel) { r.cancel = away; setRecording((x) => (x ? { ...x, cancel: away } : x)); }
  };
  const micUp = () => stopRecording();
  const micKey = (e: ReactKeyboardEvent<HTMLButtonElement>, down: boolean) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (down && !e.repeat) void startRecording();
    if (!down) stopRecording();
  };

  const onComposerKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  const botHead = <img className={s.head} src={HEAD_SRC} alt="" />;

  return (
    <div className={cx(s.dock, open && s.dockOpen)} data-assistant-dock>
      <section ref={panelRef} id={panelId} className={s.panel} role="dialog" aria-label="Acme assistant" aria-hidden={!open}>
        <header className={s.top}>
          <img className={s.topHead} src={HEAD_SRC} alt="" />
          <div className={s.topText}>
            <div className={s.topTitle}>Acme assistant <Badge tone="neutral" size="sm">Beta</Badge></div>
            <div className={s.topSub}>Jobs, candidates and interviews</div>
          </div>
          <IconButton icon="refresh" label="New conversation" size={32} variant="ghost" onClick={reset} disabled={!messages.length && !thinking} />
          <IconButton icon="close" label="Close assistant" size={32} variant="ghost" onClick={close} />
        </header>

        <div ref={scrollRef} className={s.body}>
          <ol className={s.feed} aria-live="polite">
            <li className={s.entry}>
              {botHead}
              <div className={s.entryMain}>
                <div className={s.meta}><strong>Acme assistant</strong></div>
                <p className={s.text}>Hi {firstName || 'there'}. Ask me about your jobs, candidates and interviews, or tell me what to do, like moving an applicant or scheduling an interview. Hold the mic to talk.</p>
              </div>
            </li>

            {messages.map((m) => (
              <li key={m.id} className={cx(s.entry, m.from === 'me' && s.entryMe)}>
                {m.from === 'bot' ? botHead : <Avatar name={me.name} src={me.avatarUrl} size={28} />}
                <div className={s.entryMain}>
                  <div className={s.meta}><strong>{m.from === 'bot' ? 'Acme assistant' : 'You'}</strong><span>{clock(m.at)}</span>{m.voice ? <Icon name="mic" size={12} className={s.metaIcon} /> : null}</div>
                  {m.text ? <p className={cx(s.text, m.error && s.textError)}>{m.text}</p> : <p className={cx(s.text, s.textPending)}>Listening back…</p>}
                  {m.actions?.map((a) => (
                    <ActionCard
                      key={a.token}
                      action={a}
                      state={actionStates[a.token]}
                      onConfirm={() => void confirmAction(a)}
                      onCancel={() => setActionStates((st) => ({ ...st, [a.token]: { status: 'cancelled' } }))}
                      onUndo={() => void undoAction(a)}
                    />
                  ))}
                </div>
              </li>
            ))}

            {thinking ? (
              <li className={s.entry}>
                {botHead}
                <div className={s.entryMain}>
                  <div className={s.meta}><strong>Acme assistant</strong></div>
                  <span className={s.typing} aria-label="Acme assistant is working on it"><i /><i /><i /></span>
                </div>
              </li>
            ) : null}
          </ol>

          {messages.length === 0 && !thinking ? (
            <div className={s.suggest}>
              <div className={s.suggestLabel}>Try asking</div>
              {SUGGESTIONS.map((q) => (
                <button key={q.label} type="button" className={s.suggestion} onClick={() => send(q.label)}>
                  <Icon name={q.icon} size={16} />
                  <span>{q.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <form className={s.composer} onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          {recording ? (
            <div className={cx(s.recBar, recording.cancel && s.recCancel)} role="status">
              <span className={s.recDot} aria-hidden="true" />
              <span className={s.recTime}>{elapsed(Math.max(0, now - recording.since))}</span>
              <span className={s.recLevel} aria-hidden="true">
                {[0.5, 0.8, 1, 0.8, 0.5].map((k, i) => <i key={i} style={{ transform: `scaleY(${0.2 + Math.min(1, level * 1.6 * k)})` }} />)}
              </span>
              <span className={s.recHint}>{recording.cancel ? 'Let go to cancel' : 'Let go to send'}</span>
            </div>
          ) : (
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKey}
              placeholder={micNote ?? 'Write a message'}
              aria-label="Message the assistant"
            />
          )}
          {canRecord ? (
            <button
              ref={micRef}
              type="button"
              className={cx(s.mic, recording && s.micOn)}
              aria-label="Hold to talk"
              title="Hold to talk"
              disabled={thinking}
              onPointerDown={micDown}
              onPointerMove={micMove}
              onPointerUp={micUp}
              onPointerCancel={() => stopRecording(true)}
              onKeyDown={(e) => micKey(e, true)}
              onKeyUp={(e) => micKey(e, false)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <Icon name="mic" size={18} />
            </button>
          ) : null}
          {!recording ? (
            <button type="submit" className={s.send} disabled={!draft.trim() || thinking} aria-label="Send">
              <Icon name="send" size={16} />
            </button>
          ) : null}
        </form>
      </section>

    </div>
  );
}

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icon/Icon';
import { IconButton } from '@/components/ui/Button';
import { Avatar, Badge } from '@/components/ui/Display';
import { cx } from '@/lib/cx';
import { useMe } from '@/app/providers/AuthProvider';
import s from './AssistantDock.module.css';

/**
 * Acme assistant: the recruiting helper docked bottom-right of the staff app.
 * A visual mock for now: replies are canned and the sample cards are not live
 * workspace data. Swap `replyTo` for a real call when the assistant is built.
 */

const BOT_SRC = '/acme-assistant.webp';
const HEAD_SRC = '/acme-assistant-head.webp';
const TYPING_MS = 900;

type ActionKey = 'interviews' | 'shortlist' | 'email' | 'approvals';

const SUGGESTIONS: { key: ActionKey; icon: IconName; label: string; prompt: string }[] = [
  { key: 'interviews', icon: 'interviews', label: "Show today's interviews", prompt: "Show today's interviews" },
  { key: 'shortlist', icon: 'candidates', label: 'Shortlist candidates for Data Analyst II', prompt: 'Shortlist candidates for Data Analyst II' },
  { key: 'email', icon: 'mail', label: 'Draft a rejection email', prompt: 'Draft a rejection email for a final-round candidate' },
  { key: 'approvals', icon: 'checkcircle', label: "What's waiting for approval?", prompt: "What's waiting for approval?" },
];

interface Message {
  id: number;
  from: 'me' | 'bot';
  text: string;
  at: Date;
  card?: ActionKey;
}

const clock = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function SampleCard({ kind }: { kind: ActionKey }) {
  let body: ReactNode;
  if (kind === 'interviews') {
    body = ([
      ['10:00 AM', 'Maria Santos', 'Data Analyst II', 'Screening', 'info'],
      ['2:30 PM', 'Paolo Reyes', 'Barista Trainer', 'Final interview', 'purple'],
    ] as const).map(([time, name, job, stage, tone]) => (
      <div key={name} className={s.row}>
        <span className={s.rowTime}>{time}</span>
        <span className={s.rowMain}><strong>{name}</strong><span>{job}</span></span>
        <Badge tone={tone} size="sm">{stage}</Badge>
      </div>
    ));
  } else if (kind === 'shortlist') {
    body = ([
      ['Maria Santos', 'SQL, Power BI, Python', 92],
      ['Jen Villanueva', 'Excel, Tableau, SQL', 84],
      ['Karl Mendoza', 'Python, BigQuery', 77],
    ] as const).map(([name, skills, score]) => (
      <div key={name} className={s.row}>
        <Avatar name={name} size={28} />
        <span className={s.rowMain}><strong>{name}</strong><span>{skills}</span></span>
        <span className={s.score}>{score}<small>%</small></span>
      </div>
    ));
  } else if (kind === 'email') {
    body = (
      <div className={s.draft}>
        <div className={s.draftSubject}>Your application for Data Analyst II</div>
        <p>Hi Maria, thank you for the time you gave us through every round. It was a close decision, and we have chosen to move forward with another candidate for this role…</p>
      </div>
    );
  } else {
    body = ([
      ['Data Analyst II', 'Job posting · Operations', '2d'],
      ['j.cruz@acme.example', 'Account request', '5h'],
    ] as const).map(([what, type, age]) => (
      <div key={what} className={s.row}>
        <span className={s.rowMain}><strong>{what}</strong><span>{type}</span></span>
        <span className={s.age}>{age}</span>
      </div>
    ));
  }
  return (
    <div className={s.card}>
      {body}
      <div className={s.cardFoot}>Sample data</div>
    </div>
  );
}

function replyTo(card?: ActionKey): Message {
  const lead: Record<ActionKey, string> = {
    interviews: 'You have two interviews today.',
    shortlist: 'Top matches for Data Analyst II, by the required skills:',
    email: 'Here is a draft. You can edit it before it goes out.',
    approvals: 'Two items are waiting on you.',
  };
  return {
    id: Date.now(),
    from: 'bot',
    at: new Date(),
    text: card ? lead[card] : "I can't act on that yet. I'm not connected to your workspace, so for now I only show examples.",
    card,
  };
}

export function AssistantDock() {
  const me = useMe();
  const location = useLocation();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const timer = useRef(0);
  const firstName = me.name.trim().split(/\s+/)[0] ?? '';

  // Calls fill the screen; the assistant stays out of the way there.
  const hidden = /\/interviews\/[^/]+\/room/.test(location.pathname);

  useEffect(() => () => window.clearTimeout(timer.current), []);

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
  }, [messages, typing]);

  // Grow the composer with its text, up to four lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 104)}px`;
  }, [draft]);

  if (hidden) return null;

  function close() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  function reset() {
    window.clearTimeout(timer.current);
    setTyping(false);
    setMessages([]);
    inputRef.current?.focus();
  }

  function send(text: string, card?: ActionKey) {
    const clean = text.trim();
    if (!clean || typing) return;
    setMessages((m) => [...m, { id: Date.now(), from: 'me', text: clean, at: new Date() }]);
    setDraft('');
    setTyping(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setTyping(false);
      setMessages((m) => [...m, replyTo(card)]);
    }, TYPING_MS);
  }

  const onComposerKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  const botHead = <img className={s.head} src={HEAD_SRC} alt="" />;

  return (
    <div className={cx(s.dock, open && s.dockOpen)}>
      <section ref={panelRef} id={panelId} className={s.panel} role="dialog" aria-label="Acme assistant" aria-hidden={!open}>
        <header className={s.top}>
          <img className={s.topHead} src={HEAD_SRC} alt="" />
          <div className={s.topText}>
            <div className={s.topTitle}>Acme assistant <Badge tone="neutral" size="sm">Beta</Badge></div>
            <div className={s.topSub}>Jobs, candidates and interviews</div>
          </div>
          <IconButton icon="refresh" label="New conversation" size={32} variant="ghost" onClick={reset} disabled={!messages.length && !typing} />
          <IconButton icon="close" label="Close assistant" size={32} variant="ghost" onClick={close} />
        </header>

        <div ref={scrollRef} className={s.body}>
          <ol className={s.feed} aria-live="polite">
            <li className={s.entry}>
              {botHead}
              <div className={s.entryMain}>
                <div className={s.meta}><strong>Acme assistant</strong></div>
                <p className={s.text}>Hi {firstName || 'there'}. I can look things up across your jobs, candidates and interviews, and draft messages to applicants.</p>
              </div>
            </li>

            {messages.map((m) => (
              <li key={m.id} className={cx(s.entry, m.from === 'me' && s.entryMe)}>
                {m.from === 'bot' ? botHead : <Avatar name={me.name} src={me.avatarUrl} size={28} />}
                <div className={s.entryMain}>
                  <div className={s.meta}><strong>{m.from === 'bot' ? 'Acme assistant' : 'You'}</strong><span>{clock(m.at)}</span></div>
                  <p className={s.text}>{m.text}</p>
                  {m.card ? <SampleCard kind={m.card} /> : null}
                </div>
              </li>
            ))}

            {typing ? (
              <li className={s.entry}>
                {botHead}
                <div className={s.entryMain}>
                  <div className={s.meta}><strong>Acme assistant</strong></div>
                  <span className={s.typing} aria-label="Acme assistant is typing"><i /><i /><i /></span>
                </div>
              </li>
            ) : null}
          </ol>

          {messages.length === 0 && !typing ? (
            <div className={s.suggest}>
              <div className={s.suggestLabel}>Try asking</div>
              {SUGGESTIONS.map((q) => (
                <button key={q.key} type="button" className={s.suggestion} onClick={() => send(q.prompt, q.key)}>
                  <Icon name={q.icon} size={16} />
                  <span>{q.label}</span>
                  <Icon name="arrowr" size={14} className={s.suggestArrow} />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <form className={s.composer} onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKey}
            placeholder="Write a message"
            aria-label="Message the assistant"
          />
          <button type="submit" className={s.send} disabled={!draft.trim() || typing} aria-label="Send">
            <Icon name="send" size={16} />
          </button>
        </form>
      </section>

      <button
        ref={launcherRef}
        type="button"
        className={s.launcher}
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Open Acme assistant"
        tabIndex={open ? -1 : 0}
      >
        <img className={s.robot} src={BOT_SRC} alt="" draggable={false} />
        <img className={s.chipHead} src={HEAD_SRC} alt="" draggable={false} />
      </button>
    </div>
  );
}

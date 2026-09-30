import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icon/Icon';
import { cx } from '@/lib/cx';
import { useMe } from '@/app/providers/AuthProvider';
import s from './AssistantDock.module.css';

/**
 * Acme assistant: the recruiting helper docked bottom-right of the staff app.
 * A visual mock for now: replies are canned and the sample cards are not live
 * workspace data. Swap `replyTo` for a real call when the assistant is built.
 */

const BOT_SRC = '/acme-assistant.webp';
const TYPING_MS = 900;

type ActionKey = 'interviews' | 'shortlist' | 'email' | 'approvals';

const ACTIONS: { key: ActionKey; icon: IconName; title: string; hint: string; prompt: string }[] = [
  { key: 'interviews', icon: 'interviews', title: "Today's interviews", hint: 'Who, when, and which stage', prompt: 'What interviews do I have today?' },
  { key: 'shortlist', icon: 'candidates', title: 'Shortlist for a job', hint: 'Best matches from the pipeline', prompt: 'Shortlist the strongest candidates for Data Analyst II.' },
  { key: 'email', icon: 'mail', title: 'Draft an email', hint: 'Invites, updates, rejections', prompt: 'Draft a kind rejection email for a final-round candidate.' },
  { key: 'approvals', icon: 'checkcircle', title: 'Waiting on approval', hint: 'Postings and requests', prompt: 'What is waiting for approval?' },
];

interface Message {
  id: number;
  from: 'me' | 'bot';
  text: string;
  card?: ActionKey;
}

function SampleCard({ kind }: { kind: ActionKey }) {
  let body: ReactNode;
  if (kind === 'interviews') {
    body = [
      ['10:00', 'Maria Santos', 'Data Analyst II', 'Screening'],
      ['14:30', 'Paolo Reyes', 'Barista Trainer', 'Final interview'],
    ].map(([time, name, job, stage]) => (
      <div key={name} className={s.row}>
        <span className={s.rowTime}>{time}</span>
        <span className={s.rowMain}><strong>{name}</strong><span>{job}</span></span>
        <span className={s.chip}>{stage}</span>
      </div>
    ));
  } else if (kind === 'shortlist') {
    body = [
      ['Maria Santos', 'SQL · Power BI · Python', 92],
      ['Jen Villanueva', 'Excel · Tableau · SQL', 84],
      ['Karl Mendoza', 'Python · BigQuery', 77],
    ].map(([name, skills, score]) => (
      <div key={name} className={s.row}>
        <span className={s.initials} aria-hidden="true">{String(name).split(' ').map((p) => p[0]).join('')}</span>
        <span className={s.rowMain}><strong>{name}</strong><span>{skills}</span></span>
        <span className={s.match}><span style={{ width: `${score}%` }} />{score}%</span>
      </div>
    ));
  } else if (kind === 'email') {
    body = (
      <div className={s.draft}>
        <div className={s.draftSubject}>Subject: Your application for Data Analyst II</div>
        <p>Hi Maria, thank you for the time you gave us through every round. It was a close decision, and we have chosen to move forward with another candidate for this role…</p>
      </div>
    );
  } else {
    body = [
      ['Job posting', 'Data Analyst II · Operations', '2 days'],
      ['Account request', 'j.cruz@acme.example', '5 hours'],
    ].map(([type, what, age]) => (
      <div key={what} className={s.row}>
        <span className={s.rowMain}><strong>{what}</strong><span>{type}</span></span>
        <span className={s.age}>{age}</span>
      </div>
    ));
  }
  return (
    <div className={s.card}>
      {body}
      <div className={s.cardFoot}>Sample data. The assistant is not connected to your workspace yet.</div>
    </div>
  );
}

function replyTo(text: string, card?: ActionKey): Message {
  const lead: Record<ActionKey, string> = {
    interviews: 'Here is how your day would look:',
    shortlist: 'These would be my top matches, ranked by the job\'s required skills:',
    email: 'Here is a starting draft. You would be able to edit it before sending:',
    approvals: 'Two items would be waiting on you:',
  };
  return {
    id: Date.now(),
    from: 'bot',
    text: card ? lead[card] : `I am still a preview, so I cannot answer "${text.length > 80 ? `${text.slice(0, 80)}…` : text}" yet. Soon I will work from your live jobs, candidates and interviews.`,
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
    const t = window.setTimeout(() => inputRef.current?.focus(), 220);
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
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [draft]);

  if (hidden) return null;

  function close() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  function send(text: string, card?: ActionKey) {
    const clean = text.trim();
    if (!clean || typing) return;
    setMessages((m) => [...m, { id: Date.now(), from: 'me', text: clean }]);
    setDraft('');
    setTyping(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setTyping(false);
      setMessages((m) => [...m, replyTo(clean, card)]);
    }, TYPING_MS);
  }

  const onComposerKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  return (
    <div className={cx(s.dock, open && s.dockOpen)}>
      <section
        ref={panelRef}
        id={panelId}
        className={s.panel}
        role="dialog"
        aria-label="Acme assistant"
        aria-hidden={!open}
      >
        <header className={s.head}>
          <span className={s.avatar}><img src={BOT_SRC} alt="" /></span>
          <span className={s.headText}>
            <strong>Acme assistant</strong>
            <span><i className={s.dot} />Recruiting desk · preview</span>
          </span>
          {messages.length ? (
            <button type="button" className={s.headBtn} onClick={() => { window.clearTimeout(timer.current); setTyping(false); setMessages([]); }} aria-label="Start a new chat" title="New chat">
              <Icon name="refresh" size={17} />
            </button>
          ) : null}
          <button type="button" className={s.headBtn} onClick={close} aria-label="Minimize assistant" title="Minimize">
            <Icon name="chevron" size={18} />
          </button>
        </header>

        <div ref={scrollRef} className={s.body}>
          <div className={s.hello}>
            <p className={s.helloTitle}>Hi{firstName ? ` ${firstName}` : ''}, what are we working on?</p>
            <p className={s.helloText}>I help with the day-to-day of hiring: interviews, shortlists, candidate emails and approvals.</p>
          </div>

          {messages.length === 0 ? (
            <div className={s.actions}>
              {ACTIONS.map((a, i) => (
                <button key={a.key} type="button" className={s.action} style={{ animationDelay: `${80 + i * 50}ms` }} onClick={() => send(a.prompt, a.key)}>
                  <span className={s.actionIcon}><Icon name={a.icon} size={17} /></span>
                  <span className={s.actionTitle}>{a.title}</span>
                  <span className={s.actionHint}>{a.hint}</span>
                </button>
              ))}
            </div>
          ) : null}

          <ol className={s.thread} aria-live="polite">
            {messages.map((m) => (
              <li key={m.id} className={cx(s.msg, m.from === 'me' ? s.msgMe : s.msgBot)}>
                {m.from === 'bot' ? <span className={s.msgAvatar}><img src={BOT_SRC} alt="" /></span> : null}
                <div className={s.msgStack}>
                  <div className={s.bubble}>{m.text}</div>
                  {m.card ? <SampleCard kind={m.card} /> : null}
                </div>
              </li>
            ))}
            {typing ? (
              <li className={cx(s.msg, s.msgBot)}>
                <span className={s.msgAvatar}><img src={BOT_SRC} alt="" /></span>
                <div className={cx(s.bubble, s.typing)} aria-label="Assistant is typing"><i /><i /><i /></div>
              </li>
            ) : null}
          </ol>
        </div>

        <form className={s.composer} onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          <div className={s.field}>
            <button type="button" className={s.attach} disabled aria-label="Attach a file (coming soon)" title="Attachments coming soon">
              <Icon name="plus" size={18} />
            </button>
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKey}
              placeholder="Ask about jobs, candidates…"
              aria-label="Message the assistant"
            />
            <button type="submit" className={s.send} disabled={!draft.trim() || typing} aria-label="Send">
              <Icon name="send" size={16} />
            </button>
          </div>
          <p className={s.note}>Preview. Replies are placeholders for now.</p>
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
        <span className={s.tag} aria-hidden="true">
          <svg className={s.swoosh} viewBox="0 0 60 58">
            <path d="M2 57 C 4 38, 14 24, 34 22" />
          </svg>
          <span className={s.tagName}>acme assistant</span>
          <span className={s.tagHint}>Ask me about hiring</span>
        </span>
        <span className={s.bot}>
          <img src={BOT_SRC} alt="" draggable={false} />
        </span>
      </button>
    </div>
  );
}

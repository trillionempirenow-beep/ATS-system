import { useEffect, useRef, useState } from 'react';
import type { AiNoteDto, StaffRoomDto } from '@shared/api/interviews';
import { Icon } from '@/components/icon/Icon';
import { api, errorMessage } from '@/lib/api';
import { mmss, timeAgo } from '@/lib/format';
import { scoreBand, suggestedScore } from '../interviews/ReviewForm';
import { useSaveScorecard } from '../interviews/api';
import s from './Room.module.css';

export type DockTab = 'assist' | 'score' | 'notes';
export type SaveState = { kind: 'idle' | 'saving' | 'saved' | 'error'; at?: string; message?: string };

/** Debounced autosave of the interviewer's live notes. flush() saves immediately (used before ending). */
export function useLiveNotes(interviewId: number, initial: string | null) {
  const [text, setText] = useState(initial ?? '');
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const timer = useRef<number>();
  const latest = useRef(text);
  const saved = useRef(initial ?? '');

  const persist = async () => {
    window.clearTimeout(timer.current);
    const value = latest.current;
    if (value === saved.current) return;
    setSave({ kind: 'saving' });
    try {
      const r = await api.post<{ savedAt: string }>(`/interviews/${interviewId}/notes`, { liveNotes: value });
      saved.current = value;
      setSave({ kind: 'saved', at: r.savedAt });
    } catch (e) {
      setSave({ kind: 'error', message: errorMessage(e) });
    }
  };

  const change = (value: string) => {
    setText(value);
    latest.current = value;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persist(), 900);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { text, change, save, flush: persist, current: () => latest.current };
}

export function useScorecardDraft(interviewId: number, initial: Record<string, number | null>) {
  const [ratings, setRatings] = useState(initial);
  const mutation = useSaveScorecard(interviewId);
  const pending = useRef<Record<string, number | null>>({});
  const timer = useRef<number>();
  const rate = (criterion: string, value: number | null) => {
    setRatings((r) => ({ ...r, [criterion]: value }));
    pending.current[criterion] = value;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const batch = pending.current;
      pending.current = {};
      mutation.mutate(batch);
    }, 500);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { ratings, rate };
}

interface Props {
  room: StaffRoomDto;
  tab: DockTab;
  onTab: (t: DockTab) => void;
  notes: ReturnType<typeof useLiveNotes>;
  scorecard: ReturnType<typeof useScorecardDraft>;
  moments: StaffRoomDto['moments'];
  onFlag: (label: string) => Promise<void>;
  elapsedSeconds: () => number;
  ai: AiNotesPanel;
}

export interface AiNotesPanel {
  on: boolean;
  toggling: boolean;
  onToggle: () => void;
  notes: AiNoteDto[];
  state: 'off' | 'starting' | 'listening' | 'error';
  error: string | null;
  lastAt: string | null;
}

export function StaffDock({ room, tab, onTab, notes, scorecard, moments, onFlag, elapsedSeconds, ai }: Props) {
  const live = suggestedScore(scorecard.ratings);
  const [flagLabel, setFlagLabel] = useState('');
  const [flagging, setFlagging] = useState(false);
  const criteria = room.scorecard.criteria;

  const flag = async () => {
    setFlagging(true);
    try {
      await onFlag(flagLabel.trim() || 'Flagged moment');
      setFlagLabel('');
    } finally {
      setFlagging(false);
    }
  };

  const tabs: Array<{ key: DockTab; label: string }> = [
    { key: 'assist', label: 'AI notes' },
    { key: 'score', label: 'Scorecard' },
    { key: 'notes', label: 'My notes' },
  ];

  return (
    <>
      <div className={s.sideTabs} role="tablist" aria-label="Interview tools">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={s.sideTab} onClick={() => onTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'assist' ? (
        <div className={s.sideBody} role="tabpanel">
          <div className={s.assistState}>
            <span><Icon name="sparkle" size={20} /></span>
            <div>
              <strong>{!room.assistant.canUse ? 'AI notes are the interviewer\'s' : !room.assistant.configured ? 'AI notes are not connected' : ai.on ? 'AI notes are on' : 'AI notes are off'}</strong>
              <small>{!room.assistant.canUse ? 'Only the interviewer sees them. Use My notes and the scorecard.'
                : !room.assistant.configured ? 'Ask your admin to connect the "Interview notes" flow (SETUP.md). Type your own notes meanwhile.'
                  : ai.on ? (ai.lastAt ? `Listening · last update ${timeAgo(ai.lastAt)}` : 'Listening · first notes in about 30 seconds')
                    : 'Understands Tagalog, English and Taglish. Notes are written in English. Everyone in the room sees that it is on.'}</small>
            </div>
            {room.assistant.canUse && room.assistant.configured ? (
              <button type="button" className={ai.on ? s.darkBtn : s.lightBtn} onClick={ai.onToggle} disabled={ai.toggling}>{ai.on ? 'Stop' : 'Start'}</button>
            ) : null}
          </div>
          {ai.error && ai.on ? <p className={s.assistError} role="status">{ai.error} The next piece tries again.</p> : null}
          {room.assistant.canUse ? (
            <div className={s.darkCard}>
              <span className={s.overline}>Notes so far</span>
              {ai.notes.length
                ? ai.notes.map((n, i) => (
                  <div key={i} className={s.moment}><time>{mmss(n.atSecond)}</time><span>{n.topic ? <b className={s.noteTopic}>{n.topic}</b> : null}{n.text}</span></div>
                ))
                : <p>{ai.on ? 'Notes appear here as the conversation goes.' : 'Start AI notes to have the important points written down for you.'}</p>}
            </div>
          ) : null}
          <div className={s.darkCard}>
            <span className={s.overline}>Flag this moment</span>
            <p>Mark something worth coming back to. Flags are saved with the interview for the review.</p>
            <input className={s.chatInput} value={flagLabel} onChange={(e) => setFlagLabel(e.target.value)} maxLength={200} placeholder="What happened? (optional)" aria-label="Moment label" />
            <div><button type="button" className={s.darkBtn} onClick={() => void flag()} disabled={flagging}><Icon name="flag" size={16} />Flag moment · {mmss(elapsedSeconds())}</button></div>
            {moments.map((m) => <div key={m.id} className={s.moment}><time>{mmss(m.atSecond)}</time><span>{m.label}</span></div>)}
          </div>
          <div className={s.darkCard}>
            <span className={s.overline}>Who can read the notes</span>
            <p>Only the hiring team on this interview. Notes, flags and your scorecard draft are saved with it.</p>
          </div>
        </div>
      ) : null}

      {tab === 'score' ? (
        <div className={s.sideBody} role="tabpanel">
          <div className={s.liveScore}>
            <strong>{live.score ?? '—'}</strong>
            <div>
              <span>out of 100 · <b>{scoreBand(live.score)}</b></span>
              <small>{live.count} of {criteria.length} criteria rated. Updates as you rate.</small>
            </div>
          </div>
          {criteria.map((c) => (
            <div key={c} className={s.rate} role="radiogroup" aria-label={c}>
              <span>{c}</span>
              <span className={s.rateScale}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={scorecard.ratings[c] === n} className={s.rateBtn}
                    onClick={() => scorecard.rate(c, scorecard.ratings[c] === n ? null : n)}>{n}</button>
                ))}
              </span>
            </div>
          ))}
          <p className={s.sideEmpty}>Draft only you can see. Score = 20 × average rating. The final score comes from the review form.</p>
        </div>
      ) : null}

      {tab === 'notes' ? (
        <div className={s.sideBody} role="tabpanel">
          <div>
            <strong>Your private notes</strong>
            <p className={s.sideEmpty}>Only the hiring team sees this. Saves as you type.</p>
          </div>
          <textarea className={s.notesArea} value={notes.text} onChange={(e) => notes.change(e.target.value)} maxLength={20000} aria-label="Interview notes" placeholder="Type as you go…" />
          <div className={s.notesMeta} aria-live="polite">
            <span>
              {notes.save.kind === 'saving' ? 'Saving…'
                : notes.save.kind === 'saved' ? `Saved ${timeAgo(notes.save.at)}`
                  : notes.save.kind === 'error' ? `Not saved: ${notes.save.message}` : room.interview.notesUpdatedAt ? `Saved ${timeAgo(room.interview.notesUpdatedAt)}` : 'Nothing saved yet'}
            </span>
            {notes.save.kind === 'error' ? <button type="button" className={s.darkBtn} onClick={() => void notes.flush()}>Retry</button> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

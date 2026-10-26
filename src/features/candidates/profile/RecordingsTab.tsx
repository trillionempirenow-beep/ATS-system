import { useMemo, useState, type ReactNode } from 'react';
import type { CandidateProfileDto, RecordingDto } from '@shared/api/candidates';
import { Icon } from '@/components/icon/Icon';
import { Badge } from '@/components/ui/Display';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { TextInput } from '@/components/ui/Form';
import { Card, CardHeader } from '@/components/ui/Surface';
import { formatDate, formatTime } from '@/lib/format';
import { cx } from '@/lib/cx';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { useAuth } from '@/app/providers/AuthProvider';
import { Recording as VideoPlayer } from '../../library/LibraryFileView';
import { staffRecordingUrl } from '../../library/api';
import { useRecordings } from '../api';
import s from './Recordings.module.css';

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const TYPE_LABEL: Record<string, string> = { phone: 'Phone call', video: 'Video call', onsite: 'Onsite', panel: 'Panel' };

/** Wrap each match of the search in <mark>. */
function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((p, i) => (p.toLowerCase() === q.toLowerCase() ? <mark key={i}>{p}</mark> : p));
}

/** Where the flagged moments fall in the meeting, as dots on a line. */
function MomentsTrack({ rec }: { rec: RecordingDto }) {
  const lastTalk = Math.max(0, ...rec.transcript.map((t) => t.atSecond), ...rec.moments.map((m) => m.atSecond));
  const total = Math.max((rec.durationMinutes ?? 0) * 60, lastTalk + 30, 60);
  return (
    <div className={s.track} role="img" aria-label={`${rec.moments.length} flagged moment${rec.moments.length === 1 ? '' : 's'} across ${clock(total)}`}>
      <span className={s.trackLine} />
      {rec.moments.map((m) => (
        <span key={m.id} className={s.trackDot} style={{ left: `${Math.min(98, (m.atSecond / total) * 100)}%` }} title={`${clock(m.atSecond)} · ${m.label}`} />
      ))}
      <span className={s.trackEnd}>{clock(total)}</span>
    </div>
  );
}

function Recording({ rec, query, applicationId, canPlay }: { rec: RecordingDto; query: string; applicationId: number; canPlay: boolean }) {
  const [open, setOpen] = useState(false);
  const matches = query ? rec.transcript.filter((t) => t.text.toLowerCase().includes(query.toLowerCase())) : rec.transcript;
  const showTranscript = open || Boolean(query);
  const when = rec.startedAt ?? rec.startsAt;
  const d = new Date(when);

  return (
    <article className={s.rec}>
      <header className={s.recHead}>
        <div className={s.dateTile} aria-hidden>
          <span>{d.toLocaleDateString('en-US', { month: 'short' })}</span>
          <strong>{d.getDate()}</strong>
        </div>
        <div className={s.recTitle}>
          <h3>{rec.meetingType === 'screening' ? 'Screening' : 'Interview'} · {TYPE_LABEL[rec.interviewType] ?? rec.interviewType}</h3>
          <p>
            {formatDate(when)} · {formatTime(when)}
            {rec.durationMinutes ? ` · ${rec.durationMinutes} min` : ''}
            {rec.interviewerName ? ` · with ${rec.interviewerName}` : ''}
          </p>
        </div>
        <div className={s.recBadges}>
          {rec.summary ? <Badge tone="purple" icon="sparkle" size="sm">AI summary</Badge> : <Badge tone="neutral" size="sm">No summary</Badge>}
          {rec.parts.length ? <Badge tone="success" icon="video" size="sm">Video</Badge> : null}
          {rec.transcript.length ? <Badge tone="info" size="sm">{rec.transcript.length} transcript parts</Badge> : null}
        </div>
      </header>

      {rec.parts.length ? (
        <section className={s.block} aria-label="Video">
          {canPlay ? (
            <VideoPlayer
              parts={rec.parts.map((p) => ({ id: p.id, seq: p.seq, durationSec: p.durationSec, sizeBytes: p.sizeBytes, startedAt: p.startedAt }))}
              actions={{ documentUrl: () => Promise.reject(new Error('Not used here')), recordingUrl: (id) => staffRecordingUrl(applicationId, id), allowDownload: false }}
            />
          ) : <p className={s.locked}><Icon name="lock" size={14} />This meeting was recorded. Watching recordings needs the Library permission, which your account does not have.</p>}
        </section>
      ) : null}

      {rec.summary ? (
        <section className={s.block} aria-label="Summary">
          <p className={s.summaryText}>{rec.summary.summary}</p>
          {rec.summary.keyAnswers.length ? (
            <dl className={s.facts}>
              {rec.summary.keyAnswers.map((k) => (
                <div key={k.label}><dt>{k.label}</dt><dd>{k.value}</dd></div>
              ))}
            </dl>
          ) : null}
          <div className={s.lists}>
            {rec.summary.strengths.length ? (
              <div><h4><Icon name="checkcircle" size={14} />Strengths</h4><ul>{rec.summary.strengths.map((x) => <li key={x}>{x}</li>)}</ul></div>
            ) : null}
            {rec.summary.concerns.length ? (
              <div><h4><Icon name="alert" size={14} />Concerns</h4><ul>{rec.summary.concerns.map((x) => <li key={x}>{x}</li>)}</ul></div>
            ) : null}
            {rec.summary.followUps.length ? (
              <div><h4><Icon name="arrowr" size={14} />Follow up</h4><ul>{rec.summary.followUps.map((x) => <li key={x}>{x}</li>)}</ul></div>
            ) : null}
          </div>
        </section>
      ) : null}

      {rec.moments.length ? (
        <section className={s.block} aria-label="Flagged moments">
          <h4 className={s.blockTitle}>Flagged moments</h4>
          <MomentsTrack rec={rec} />
          <ul className={s.moments}>
            {rec.moments.map((m) => (
              <li key={m.id}><span className={s.stamp}>{clock(m.atSecond)}</span><span>{m.label}</span>{m.author ? <em>{m.author}</em> : null}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {rec.notes.length ? (
        <section className={s.block} aria-label="Notes taken during the meeting">
          <h4 className={s.blockTitle}>Notes from the meeting</h4>
          <ul className={s.notes}>
            {rec.notes.map((n, i) => (
              <li key={`${n.atSecond}-${i}`}><span className={s.stamp}>{clock(n.atSecond)}</span><span>{n.topic ? <b>{n.topic}: </b> : null}{highlight(n.text, query)}</span></li>
            ))}
          </ul>
        </section>
      ) : null}

      {rec.detailLocked ? (
        <p className={s.locked}><Icon name="lock" size={14} />The transcript and meeting notes are only visible to the interviewer{rec.interviewerName ? `, ${rec.interviewerName}` : ''}.</p>
      ) : rec.transcript.length ? (
        <section className={s.block} aria-label="Transcript">
          <button type="button" className={s.toggle} aria-expanded={showTranscript} onClick={() => setOpen((o) => !o)}>
            <Icon name="chevron" size={14} className={cx(s.chev, showTranscript && s.chevOpen)} />
            {showTranscript ? 'Hide transcript' : 'Show transcript'}
            {query ? <span className={s.matchCount}>{matches.length} match{matches.length === 1 ? '' : 'es'}</span> : null}
          </button>
          {showTranscript ? (
            matches.length ? (
              <ol className={s.transcript}>
                {matches.map((t, i) => (
                  <li key={`${t.atSecond}-${i}`}><span className={s.stamp}>{clock(t.atSecond)}</span><p>{highlight(t.text, query)}</p></li>
                ))}
              </ol>
            ) : <p className={s.none}>Nothing in this transcript matches “{query}”.</p>
          ) : null}
        </section>
      ) : (
        <p className={s.none}>No transcript was kept for this meeting.</p>
      )}
    </article>
  );
}

/** A library of what was kept from this candidate's meetings: summary, flagged moments and what was said. */
export function RecordingsTab({ c }: { c: CandidateProfileDto }) {
  const q = useRecordings(c.applicationId, true);
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const query = search.trim();

  const shown = useMemo(() => {
    const items = q.data?.items ?? [];
    if (!query) return items;
    const needle = query.toLowerCase();
    return items.filter((r) => r.transcript.some((t) => t.text.toLowerCase().includes(needle)) || r.notes.some((n) => n.text.toLowerCase().includes(needle))
      || (r.summary?.summary ?? '').toLowerCase().includes(needle) || r.moments.some((m) => m.label.toLowerCase().includes(needle)));
  }, [q.data, query]);

  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading) return <Card><Skeleton height={220} /></Card>;
  const items = q.data?.items ?? [];

  return (
    <Card>
      <CardHeader
        title="Recordings"
        subtitle={`${items.length} meeting${items.length === 1 ? '' : 's'} on record for ${c.firstName}: the video when it was recorded, the summary, flagged moments and what was said.`}
      />
      {items.length === 0 ? (
        <EmptyState compact icon="video" title="No recordings yet" text="After a meeting in the Acme Room, its recording (if it was recorded), summary, flagged moments and transcript are kept here, for this candidate only." />
      ) : (
        <div className={s.lib}>
          <div className={s.search}>
            <TextInput icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search what was said, notes and moments" aria-label="Search recordings" />
          </div>
          {shown.length ? shown.map((r) => <Recording key={r.interviewId} rec={r} query={query} applicationId={c.applicationId} canPlay={can.permission('library')} />) : <p className={s.none}>No meeting matches “{query}”.</p>}
        </div>
      )}
    </Card>
  );
}

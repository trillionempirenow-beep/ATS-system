import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { AiSummary, StaffRoomDto } from '@shared/api/interviews';
import { RECOMMENDATIONS } from '@shared/domain/interviews';
import { Icon } from '@/components/icon/Icon';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Avatar, Badge, StatusBadge } from '@/components/ui/Display';
import { EmptyState, Notice, Skeleton } from '@/components/ui/Feedback';
import { Card, CardHeader, DescriptionList, PageHeader } from '@/components/ui/Surface';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { formatDateTime, formatTime, formatWeekday, mmss, plural } from '@/lib/format';
import { useInterview } from './api';
import { FORMAT_LABELS } from './ScheduleDrawer';
import { ReviewForm, ScoreSummary, ScorecardRatings } from './ReviewForm';
import w from '../workspace.module.css';
import s from './Interviews.module.css';

/** What the AI took from the whole meeting, written once it ended. */
function AiSummaryCard({ summary }: { summary: AiSummary }) {
  const list = (title: string, items: string[]) => (items.length ? (
    <div>
      <div className={w.overline}>{title}</div>
      <ul className={s.summaryList}>{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  ) : null);
  return (
    <Card>
      <CardHeader title="AI summary" subtitle="From everything said in the meeting" actions={<Badge tone="purple" icon="sparkle" size="sm">AI-generated</Badge>} />
      <div className={w.stack}>
        <p>{summary.summary}</p>
        {summary.keyAnswers.length ? <DescriptionList items={summary.keyAnswers.map((k) => [k.label, k.value])} /> : null}
        {list('Strengths', summary.strengths)}
        {list('Concerns', summary.concerns)}
        {list('Follow up on', summary.followUps)}
        <p className={w.faint}>Check it against your own notes before deciding. The AI can mishear names and numbers.</p>
      </div>
    </Card>
  );
}

function durationMinutes(iv: StaffRoomDto['interview']): number | null {
  if (!iv.startedAt || !iv.endedAt) return null;
  return Math.max(1, Math.round((Date.parse(iv.endedAt) - Date.parse(iv.startedAt)) / 60_000));
}

export function InterviewReviewPage() {
  const id = Number(useParams().id);
  const room = useInterview(id);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [prefill, setPrefill] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => { document.title = 'Interview review · Acme People'; }, []);
  // The AI summary is written in the background right after the meeting: check back for a few minutes.
  const d = room.data;
  const summaryPending = Boolean(d && !d.aiSummary && d.assistant.notes.length && d.interview.endedAt && Date.now() - Date.parse(d.interview.endedAt) < 180_000);
  const refetch = room.refetch;
  useEffect(() => {
    if (!summaryPending) return undefined;
    const t = window.setInterval(() => void refetch(), 5000);
    return () => window.clearInterval(t);
  }, [summaryPending, refetch]);

  if (room.isError) return <QueryErrorPage error={room.error} onRetry={() => void room.refetch()} />;
  if (!room.data) {
    return <div className={w.page}><Skeleton height={36} width={280} /><div className={w.cols21}><Skeleton height={420} /><Skeleton height={420} /></div></div>;
  }
  const data = room.data;
  const iv = data.interview;
  const minutes = durationMinutes(iv);
  const reviewed = iv.state === 'reviewed';
  const kind = `${iv.meetingType === 'screening' ? 'Screening' : 'Interview'} · ${FORMAT_LABELS[iv.interviewType]}`;
  const crumbs = [{ label: 'Recruiting', to: '/app' }, { label: 'Interviews', to: '/app/interviews' }, { label: 'Review' }];
  const assistNotes = data.assistant.notes;

  const header = reviewed
    ? { title: 'Review submitted', description: justSubmitted ? 'Thanks. The interview is now reviewed.' : `Reviewed${iv.reviewerName ? ` by ${iv.reviewerName}` : ''}${iv.reviewedAt ? ` · ${formatDateTime(iv.reviewedAt)}` : ''}.` }
    : iv.acceptsReview
      ? { title: 'Meeting ended', description: 'The meeting has ended and is waiting for a score and review.' }
      : { title: 'Not ready for review', description: 'The meeting has not ended yet. Reviews open once it is over.' };

  const identity = (
    <div className={s.banner}>
      <div className={w.person}>
        <Avatar name={iv.candidateName} src={iv.avatarUrl} size={44} />
        <div className={w.personText}>
          <span className={w.personName}>{iv.candidateName}</span>
          <span className={w.personSub}>{iv.jobTitle} · {kind}</span>
        </div>
      </div>
      <StatusBadge kind="interview" value={iv.state} />
    </div>
  );

  return (
    <div className={w.page}>
      <PageHeader title={header.title} description={header.description} crumbs={crumbs}
        actions={<ButtonLink variant="secondary" icon="user" to={`/app/candidates/${iv.applicationId}`}>Open candidate</ButtonLink>} />
      {justSubmitted ? <Notice tone="success">Interview review saved to the candidate profile.</Notice> : null}

      <div className={w.cols21}>
        <div className={w.stack}>
          <Card>
            <div className={w.stack}>
              {identity}
              <div className={s.facts}>
                <div className={s.fact}><strong>{minutes !== null ? `${minutes} min` : '—'}</strong><span>Duration</span></div>
                <div className={s.fact}><strong>{assistNotes.length}</strong><span>AI notes</span></div>
                <div className={s.fact}><strong>{data.moments.length}</strong><span>Flagged moments</span></div>
              </div>
              <DescriptionList items={[
                ['Scheduled', `${formatWeekday(iv.startsAt)} · ${formatTime(iv.startsAt)}`],
                ['Ended', iv.endedAt ? `${formatTime(iv.endedAt)}${minutes !== null ? ` · ${plural(minutes, 'minute')}` : ''}` : '—'],
                ['Interviewer', iv.interviewerName ?? '—'],
              ]} />
            </div>
          </Card>

          {data.aiSummary ? <AiSummaryCard summary={data.aiSummary} /> : summaryPending ? (
            <Card><CardHeader title="AI summary" subtitle="Writing it from the meeting… this takes up to a minute." actions={<Badge tone="purple" icon="sparkle" size="sm">AI-generated</Badge>} /></Card>
          ) : null}

          {assistNotes.length ? (
            <Card>
              <CardHeader title="Notes from Acme Assist" subtitle="Written during the meeting" actions={<Badge tone="purple" icon="sparkle" size="sm">AI-generated</Badge>} />
              <div className={s.assist}>
                {assistNotes.map((n, i) => (
                  <div key={i} className={s.assistNote}><small>{mmss(n.atSecond)}{n.topic ? ` · ${n.topic}` : ''}</small>{n.text}</div>
                ))}
                {!reviewed && iv.acceptsReview ? (
                  <Button variant="secondary" size="sm" icon="plus" className={w.selfStart}
                    onClick={() => setPrefill(assistNotes.map((n) => `${n.topic ? `${n.topic}: ` : ''}${n.text}`).join('\n'))}>Use in my review</Button>
                ) : null}
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Notes recorded during the meeting" actions={iv.liveNotes && iv.liveNotes.length > 600
              ? <Button variant="ghost" size="sm" onClick={() => setShowNotes((v) => !v)}>{showNotes ? 'Show less' : 'View my notes'}</Button> : null} />
            {iv.liveNotes ? <p className={w.pre}>{showNotes || iv.liveNotes.length <= 600 ? iv.liveNotes : `${iv.liveNotes.slice(0, 600)}…`}</p>
              : <EmptyState compact icon="edit" title="No notes were recorded" text="Notes typed in the room are saved here automatically." />}
          </Card>

          {data.moments.length ? (
            <Card>
              <CardHeader title="Flagged moments" />
              <ul className={w.list}>
                {data.moments.map((m) => (
                  <li key={m.id} className={w.listItem}><span className="mono">{mmss(m.atSecond)}</span><span>{m.label}</span><span className={w.faint}>{m.author ?? ''}</span></li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className={w.stack}>
          <Card>
            <CardHeader title="Score and review" subtitle="Only the hiring team sees this" />
            {reviewed ? (
              <div className={w.stack}>
                <ScoreSummary ratings={data.scorecard.myRatings} criteriaCount={data.scorecard.criteria.length} />
                <ScorecardRatings criteria={data.scorecard.criteria} ratings={data.scorecard.myRatings} readOnly />
                <DescriptionList items={[
                  ['Overall score', iv.score !== null ? `${iv.score} out of 100` : '—'],
                  ['Recommendation', iv.recommendation ? RECOMMENDATIONS[iv.recommendation] : '—'],
                  ['Submitted', iv.reviewedAt ? formatDateTime(iv.reviewedAt) : '—'],
                ]} />
                {iv.feedback ? <div className={w.noteCard}><div className={w.overline}>Review</div><p className={`${w.pre} ${w.mt6}`}>{iv.feedback}</p></div> : null}
              </div>
            ) : iv.acceptsReview ? (
              <ReviewForm room={data} prefillReview={prefill} onSubmitted={() => { setJustSubmitted(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
            ) : (
              <div className={w.stack8}>
                <Notice tone="info">End the meeting from the room before submitting a score and review.</Notice>
                {iv.builtInRoom ? <ButtonLink icon="video" to={`/app/interviews/${iv.id}/room`}>Open room</ButtonLink> : null}
              </div>
            )}
          </Card>

          {reviewed ? (
            <Card>
              <CardHeader title="What happens next" />
              <ul className={s.next}>
                <li><span><Icon name="checkcircle" size={18} /></span><span><strong>Review saved to the candidate profile</strong><small>{iv.score !== null ? `Score ${iv.score} out of 100` : 'No score'}{iv.recommendation ? ' and your recommendation' : ''}</small></span></li>
                <li><span><Icon name="checkcircle" size={18} /></span><span><strong>Candidate stays in the {iv.meetingType === 'screening' ? 'Screening' : 'Interview'} stage</strong><small>Nothing moves on its own</small></span></li>
                <li><span><Icon name="checkcircle" size={18} /></span><span><strong>Move them when you are ready</strong><small>Use the pipeline, then confirm the move</small></span></li>
              </ul>
              <div className={`${w.row} ${w.mt16} ${w.gap8} ${w.wrapRow}`}>
                <ButtonLink to={`/app/candidates/${iv.applicationId}`}>Open candidate</ButtonLink>
                <ButtonLink variant="secondary" to="/app/interviews">Back to interviews</ButtonLink>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

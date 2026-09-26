import type { CandidateProfileDto } from '@shared/api/candidates';
import { RECOMMENDATIONS } from '@shared/domain/interviews';
import { ButtonLink } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Display';
import { EmptyState } from '@/components/ui/Feedback';
import { Card, CardHeader } from '@/components/ui/Surface';
import { formatTime, formatWeekday } from '@/lib/format';
import w from '../../workspace.module.css';
import s from './Profile.module.css';

export function InterviewsTab({ c }: { c: CandidateProfileDto }) {
  const canSchedule = c.stage !== 'hired' && c.stage !== 'rejected' && c.applicationStatus === 'active';
  return (
    <Card>
      <CardHeader title="Interview history" subtitle={`${c.interviews.length} on record`}
        actions={canSchedule ? <ButtonLink to={`/app/interviews?schedule=${c.applicationId}`} size="sm" icon="calendar">Schedule interview</ButtonLink> : null} />
      {c.interviews.length === 0 ? (
        <EmptyState compact icon="interviews" title="No interviews yet" text="Screenings and interviews scheduled for this candidate appear here with their notes and reviews." />
      ) : (
        <div className={w.stack}>
          {c.interviews.map((iv) => {
            const live = iv.state === 'scheduled' || iv.state === 'ready' || iv.state === 'in_progress';
            return (
              <article key={iv.id} className={s.ivCard}>
                <div className={s.ivHead}>
                  <div className={w.stack8} style={{ gap: 2 }}>
                    <strong>{iv.meetingType === 'screening' ? 'Screening' : 'Interview'} · {iv.interviewType.charAt(0).toUpperCase() + iv.interviewType.slice(1)}</strong>
                    <span className={w.faint}>{formatWeekday(iv.startsAt)} · {formatTime(iv.startsAt)}{iv.interviewerName ? ` · with ${iv.interviewerName}` : ''}{iv.jobTitle !== c.job.title ? ` · ${iv.jobTitle}` : ''}</span>
                  </div>
                  <div className={w.row} style={{ gap: 8 }}>
                    <StatusBadge kind="interview" value={iv.state} size="sm" />
                    {iv.score !== null ? <strong className="num">{iv.score} / 100</strong> : null}
                  </div>
                </div>
                {live || iv.state === 'review_pending' ? (
                  <div className={w.row} style={{ gap: 8, flexWrap: 'wrap' }}>
                    {iv.roomCode && live ? <ButtonLink to={`/app/interviews/${iv.id}/room`} size="sm" icon="video">Open room</ButtonLink> : null}
                    {iv.state === 'review_pending' ? <ButtonLink to={`/app/interviews/${iv.id}/review`} size="sm">Score and review</ButtonLink> : null}
                    {live ? <ButtonLink to={`/app/interviews?focus=${iv.id}`} size="sm" variant="secondary">Reschedule</ButtonLink> : null}
                    {iv.roomCode ? <span className={w.faint}>Room code <span className="mono">{iv.roomCode}</span></span> : null}
                  </div>
                ) : null}
                {iv.liveNotes ? <div className={w.noteCard}><div className={w.overline}>Notes recorded during the meeting</div><p className={w.pre} style={{ marginTop: 6 }}>{iv.liveNotes}</p></div> : null}
                {iv.feedback || iv.recommendation ? (
                  <div className={w.noteCard}>
                    <div className={w.overline}>Final review{iv.reviewerName ? ` · Submitted by ${iv.reviewerName}` : ''}</div>
                    {iv.feedback ? <p className={w.pre} style={{ marginTop: 6 }}>{iv.feedback}</p> : null}
                    {iv.recommendation ? <p className={w.strong} style={{ marginTop: 6 }}>Recommendation: {RECOMMENDATIONS[iv.recommendation]}</p> : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </Card>
  );
}

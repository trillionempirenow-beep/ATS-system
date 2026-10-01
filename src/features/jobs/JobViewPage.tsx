import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { JobViewDto } from '@shared/api/jobs';
import { EMPLOYMENT_TYPE_LABELS } from '@shared/domain/jobs';
import { Icon } from '@/components/icon/Icon';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Avatar, Badge, StatusBadge } from '@/components/ui/Display';
import { EmptyState, Notice, Skeleton } from '@/components/ui/Feedback';
import { Card, CardHeader, PageHeader } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { errorMessage } from '@/lib/api';
import { cx } from '@/lib/cx';
import { formatDate, formatDateTime } from '@/lib/format';
import c from '@/features/careers/Careers.module.css';
import { Bullets, Tags } from '@/features/careers/PostingSections';
import { useJobView, useRunMatching } from './api';
import w from '../workspace.module.css';
import s from './JobView.module.css';

type Match = JobViewDto['matches'][number];

function Score({ value }: { value: number }) {
  return (
    <div className={s.score} data-high={value >= 80 ? '' : undefined} aria-label={`${value}% match`}>
      <strong className="num">{value}%</strong>
      <span className={s.scoreBar}><span style={{ width: `${value}%` }} /></span>
    </div>
  );
}

function MatchItem({ m }: { m: Match }) {
  const name = m.applicationId
    ? <Link className={s.matchName} to={`/app/candidates/${m.applicationId}`}>{m.name}</Link>
    : <span className={s.matchName}>{m.name}</span>;
  return (
    <li className={s.match}>
      <div className={s.matchHead}>
        <Avatar name={m.name} size={34} />
        <div className={w.personText}>
          {name}
          <span className={w.personSub}>{m.currentTitle ?? 'No current title'}</span>
        </div>
        <Score value={m.score} />
      </div>
      {m.appliedHere ? <Badge tone="success" size="sm" icon="check">Applied here</Badge> : null}
      {m.reason ? <p className={s.reason}>{m.reason}</p> : null}
      {m.matched.length ? <p className={s.skills}><span>Has</span>{m.matched.slice(0, 5).join(' · ')}</p> : null}
      {m.missing.length ? <p className={s.skills} data-missing=""><span>Missing</span>{m.missing.slice(0, 4).join(' · ')}</p> : null}
    </li>
  );
}

function MatchPanel({ d, jobId }: { d: JobViewDto; jobId: number }) {
  const toast = useToast();
  const run = useRunMatching(jobId);
  const busy = d.matchingNow || run.isPending;
  let body;
  if (!d.matchingEnabled) {
    body = <p className={w.faint}>AI matching is not connected yet. Once it is, every registered applicant can be scored against this role.</p>;
  } else if (busy) {
    body = <p className={s.running}><span className={s.spinner} aria-hidden />Scoring every registered applicant. This takes up to a minute.</p>;
  } else if (!d.matchedAt) {
    body = <p className={w.faint}>Score every registered applicant against this role and see who fits.</p>;
  } else if (!d.matches.length) {
    body = <p className={w.faint}>{d.scored ? `Scored ${d.scored} applicant${d.scored === 1 ? '' : 's'}; none reached 60% for this role.` : 'No registered applicants to score yet.'}</p>;
  } else {
    body = <ul className={s.matches}>{d.matches.map((m) => <MatchItem key={m.candidateId} m={m} />)}</ul>;
  }
  return (
    <Card className={s.panel}>
      <CardHeader title={<span className={s.panelTitle}><Icon name="sparkle" size={16} />Matching applicants</span>}
        subtitle="All registered applicants · 60%+"
        actions={d.matchingEnabled ? (
          <Button size="sm" variant={d.matchedAt ? 'secondary' : 'primary'} icon={d.matchedAt ? 'refresh' : 'sparkle'} loading={busy}
            onClick={() => run.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })}>
            {d.matchedAt ? 'Run again' : 'Find matches'}
          </Button>
        ) : null} />
      {d.matchingError && !busy ? <Notice tone="warning">The last run did not finish: {d.matchingError} Try again.</Notice> : null}
      {body}
      {d.matchedAt && !busy ? <p className={s.panelFoot}>Last scored {formatDateTime(d.matchedAt)}</p> : null}
    </Card>
  );
}

export function JobViewPage() {
  const { id = '' } = useParams();
  const jobId = Number(id);
  const q = useJobView(jobId);
  useEffect(() => { if (q.data) document.title = `${q.data.job.title} · Jobs`; }, [q.data]);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) {
    return (
      <div className={w.page}>
        <Skeleton height={16} width={140} />
        <div className={w.aside340}><Skeleton height={520} radius={12} /><Skeleton height={320} radius={12} /></div>
      </div>
    );
  }
  const d = q.data;
  const j = d.job;
  const actions = (
    <>
      {j.state === 'published' ? <ButtonLink variant="secondary" icon="external" to={`/jobs/${j.slug}`} target="_blank" rel="noopener noreferrer">View live</ButtonLink> : null}
      {j.canEdit ? <ButtonLink icon="edit" to={`/app/jobs/${j.id}/edit`}>Edit</ButtonLink> : null}
    </>
  );

  return (
    <div className={w.page}>
      <PageHeader title={j.title} crumbs={[{ label: 'Jobs', to: '/app/jobs/mine' }, { label: j.title }]} actions={actions}
        description={<span className={s.meta}>
          <StatusBadge kind="job" value={j.state} size="sm" />
          <span>Created by {j.mine ? 'you' : (j.creatorName ?? 'someone who left')} · {formatDate(j.createdAt)}</span>
        </span>} />
      <div className={w.aside340}>
        <div className={w.stack}>
          <Card>
            <article className={s.posting}>
              <header className={c.detailHead}>
                <div className={c.cardBadges}>
                  {j.department ? <Badge tone="neutral">{j.department}</Badge> : null}
                  <Badge tone="info">{EMPLOYMENT_TYPE_LABELS[j.employmentType]}</Badge>
                  {j.isUrgent ? <Badge tone="danger">Urgent</Badge> : null}
                </div>
                <div className={c.detailMeta}>
                  <span><Icon name="pin" size={15} />{j.location || 'Location flexible'}</span>
                  {j.salaryInfo ? <span className={c.salary}>{j.salaryInfo}</span> : null}
                  <span><Icon name="candidates" size={15} />{j.applications}{j.applicantLimit ? ` / ${j.applicantLimit}` : ''} applicants</span>
                </div>
              </header>
              {j.description ? (
                <section className={c.block}>
                  <h2 className={c.blockTitle}>About the role</h2>
                  <p className={c.prose}>{j.description}</p>
                </section>
              ) : null}
              <Bullets title="Responsibilities" text={j.responsibilities} />
              <Bullets title="Qualifications" text={j.qualifications} />
              <Tags title="Required skills" text={j.requirements} />
              <Tags title="Preferred skills" text={j.preferredSkills} />
              {j.experienceRequired || j.educationRequired ? (
                <section className={c.block}>
                  <h2 className={c.blockTitle}>Experience and education</h2>
                  <ul className={c.bullets}>
                    {j.experienceRequired ? <li>{j.experienceRequired}</li> : null}
                    {j.educationRequired ? <li>{j.educationRequired}</li> : null}
                  </ul>
                </section>
              ) : null}
            </article>
          </Card>
          <Card>
            <CardHeader title="Applied to this job" subtitle={d.applicants.length ? `${d.applicants.length} active` : undefined} />
            {d.applicants.length ? (
              <ul className={cx(w.list, s.applicants)}>
                {d.applicants.map((a) => (
                  <li key={a.applicationId} className={w.listItem}>
                    <Link to={`/app/candidates/${a.applicationId}`} className={w.person} style={{ flex: 1 }}>
                      <Avatar name={a.name} size={32} />
                      <span className={w.personText}>
                        <span className={w.personName}>{a.name}</span>
                        <span className={w.personSub}>Applied {formatDate(a.appliedAt, { month: 'short', day: 'numeric' })}{a.aiScore !== null ? ` · AI ${a.aiScore}%` : ''}</span>
                      </span>
                    </Link>
                    <StatusBadge kind="stage" value={a.stage} size="sm" />
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="candidates" title="No applicants yet" text="People who apply on the careers site show up here." />}
          </Card>
        </div>
        <MatchPanel d={d} jobId={jobId} />
      </div>
      {j.state === 'draft' && !j.mine ? <Notice tone="info">This is a draft. Only its author and Admins can see it.</Notice> : null}
    </div>
  );
}

import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EMPLOYMENT_TYPE_LABELS } from '@shared/domain/jobs';
import { Icon } from '@/components/icon/Icon';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Display';
import { ErrorState, Notice, ProgressBar, Skeleton } from '@/components/ui/Feedback';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { usePublicJob } from './api';
import { JobCard } from './JobCard';
import { RoleNotFound } from './RoleNotFound';
import s from './Careers.module.css';

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className={s.block}>
      <h2 className={s.blockTitle}>{title}</h2>
      <ul className={s.bullets}>{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </section>
  );
}

function TagBlock({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className={s.block}>
      <h2 className={s.blockTitle}>{title}</h2>
      <div className={s.tags}>{items.map((t) => <span key={t} className={s.tag}>{t}</span>)}</div>
    </section>
  );
}

export function JobDetailPage() {
  const { slug = '' } = useParams();
  const job = usePublicJob(slug);
  useEffect(() => { if (job.data) document.title = `${job.data.title} · Careers`; }, [job.data]);

  if (job.error instanceof ApiError && job.error.status === 404) return <RoleNotFound />;
  if (job.isError) return <ErrorState onRetry={() => void job.refetch()} />;
  if (!job.data) {
    return (
      <div className={s.detail}>
        <div className={s.detailMain}><Skeleton height={36} width="60%" /><Skeleton height={18} width="40%" /><Skeleton height={160} /><Skeleton height={120} /></div>
        <Skeleton height={220} radius={14} />
      </div>
    );
  }
  const j = job.data;
  const requirementsAreSkills = j.requirements.every((r) => r.length <= 28) && j.requirements.length > 0 && j.tags.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Link to="/jobs" className={s.back}><Icon name="arrowl" size={16} />Back to roles</Link>
      <div className={s.detail}>
        <article className={s.detailMain}>
          <header className={s.detailHead}>
            <div className={s.cardBadges}>
              <Badge tone="neutral">{j.department ?? 'Acme'}</Badge>
              {j.isUrgent ? <Badge tone="warning" icon="flag">Urgent hiring</Badge> : null}
              <Badge tone="info">{EMPLOYMENT_TYPE_LABELS[j.employmentType]}</Badge>
            </div>
            <h1 className={s.displayS} style={{ fontSize: 36, lineHeight: '44px' }}>{j.title}</h1>
            <div className={s.detailMeta}>
              <span><Icon name="pin" size={15} />{j.location || 'Location flexible'}</span>
              <span><Icon name="clock" size={15} />Posted {formatDate(j.postedAt)}</span>
              {j.salaryInfo ? <span className={s.salary}>{j.salaryInfo}</span> : null}
            </div>
          </header>
          {j.description ? (
            <section className={s.block}>
              <h2 className={s.blockTitle}>About the role</h2>
              <p className={s.prose}>{j.description}</p>
            </section>
          ) : null}
          <Bullets title="Responsibilities" items={j.responsibilities} />
          <Bullets title="Qualifications" items={j.qualifications} />
          {requirementsAreSkills ? <TagBlock title="Required skills" items={j.requirements} /> : <Bullets title="Requirements" items={j.requirements} />}
          <TagBlock title="Preferred skills" items={j.preferredSkills} />
          {j.experienceRequired || j.educationRequired ? (
            <section className={s.block}>
              <h2 className={s.blockTitle}>Experience and education</h2>
              <ul className={s.bullets}>
                {j.experienceRequired ? <li>{j.experienceRequired}</li> : null}
                {j.educationRequired ? <li>{j.educationRequired}</li> : null}
              </ul>
            </section>
          ) : null}
          {!requirementsAreSkills && j.tags.length ? <TagBlock title="Skills" items={j.tags} /> : null}
        </article>

        <aside className={s.aside}>
          <div className={s.applyCard}>
            {j.acceptingApplications ? (
              <ButtonLink to={`/jobs/${j.slug}/apply`} size="lg" fullWidth icon="send">Apply for this role</ButtonLink>
            ) : (
              <>
                <Notice tone={j.full ? 'danger' : 'warning'} title={j.full ? 'Applications closed' : 'Not accepting applications'}>{j.closedReason}</Notice>
                <Button size="lg" fullWidth disabled icon="limit">{j.full ? 'Role is full' : 'Applications closed'}</Button>
              </>
            )}
            <ButtonLink to="/refer" variant="secondary" fullWidth icon="users">Refer someone</ButtonLink>
            <div className={s.meter}>
              <div className={s.meterRow}>
                <span>{j.applicantLimit !== null ? `${j.applications} of ${j.applicantLimit} spots taken` : 'Open to all applicants'}</span>
                <strong className="num">{j.applications} applied</strong>
              </div>
              {j.applicantLimit !== null ? <ProgressBar value={j.applications} max={j.applicantLimit} label="Applicant spots taken" /> : null}
            </div>
          </div>
          <div className={s.softCard}>
            <strong>Already applied?</strong>
            <span style={{ color: 'var(--text2)' }}>Check where you are in the process.</span>
            <ButtonLink to="/status" variant="ghost" size="sm" iconRight="arrowr" style={{ alignSelf: 'flex-start', paddingLeft: 0 }}>Check application status</ButtonLink>
          </div>
        </aside>
      </div>
      {j.related.length ? (
        <section style={{ marginTop: 24 }}>
          <div className={s.sectionHead}><h2 className={s.h2}>Other open roles</h2></div>
          <div className={s.grid}>{j.related.map((r) => <JobCard key={r.id} job={r} />)}</div>
        </section>
      ) : null}
    </div>
  );
}

import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EMPLOYMENT_TYPE_LABELS } from '@shared/domain/jobs';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Display';
import { ErrorState, Notice, ProgressBar, Skeleton } from '@/components/ui/Feedback';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { usePublicJob } from './api';
import { RoleList } from './RoleList';
import { RoleNotFound } from './RoleNotFound';
import { Crumbs } from './Crumbs';
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
      <ul className={s.tags}>{items.map((t) => <li key={t} className={s.tag}>{t}</li>)}</ul>
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
      <div className={s.container} aria-busy="true">
        <Skeleton height={14} width={160} />
        <div className={s.detail}>
          <div className={s.detailMain}><Skeleton height={34} width="60%" /><Skeleton height={16} width="35%" /><Skeleton height={140} /><Skeleton height={120} /></div>
          <Skeleton height={260} />
        </div>
      </div>
    );
  }
  const j = job.data;
  const requirementsAreSkills = j.requirements.every((r) => r.length <= 28) && j.requirements.length > 0 && j.tags.length > 0;
  const facts: Array<[string, string]> = [
    ['Team', j.department ?? 'Not specified'],
    ['Location', j.location || 'Location flexible'],
    ['Type', EMPLOYMENT_TYPE_LABELS[j.employmentType]],
    ...(j.salaryInfo ? [['Salary', j.salaryInfo] as [string, string]] : []),
    ['Posted', formatDate(j.postedAt)],
  ];

  return (
    <div className={s.container}>
      <Crumbs items={[{ label: 'Open roles', to: '/jobs' }, ...(j.department ? [{ label: j.department, to: `/jobs?dept=${encodeURIComponent(j.department)}` }] : []), { label: j.title }]} />
      <div className={s.detail}>
        <article className={s.detailMain}>
          <header className={s.detailHead}>
            <h1 className={s.title}>{j.title}</h1>
            <p className={s.detailMeta}>
              {[j.department, j.location || 'Location flexible', EMPLOYMENT_TYPE_LABELS[j.employmentType]].filter(Boolean).join(', ')}
            </p>
            {j.isUrgent ? <span><Badge tone="warning">Hiring urgently</Badge></span> : null}
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

        <aside className={s.aside} aria-label="Apply">
          <div className={s.sheet}>
            <dl className={s.facts}>
              {facts.map(([k, v]) => <div key={k} className={s.factRow}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
            <div className={s.sheetBody}>
              {j.acceptingApplications ? (
                <ButtonLink to={`/jobs/${j.slug}/apply`} size="lg" fullWidth>Apply for this role</ButtonLink>
              ) : (
                <>
                  <Notice tone={j.full ? 'danger' : 'warning'} title={j.full ? 'Applications are full' : 'Not accepting applications'}>{j.closedReason}</Notice>
                  <Button size="lg" fullWidth disabled>{j.full ? 'Applications full' : 'Applications closed'}</Button>
                </>
              )}
              <div className={s.meter}>
                <div className={s.meterRow}>
                  <span>{j.applicantLimit !== null ? `${j.applications} of ${j.applicantLimit} places taken` : 'No limit on applicants'}</span>
                  <span className="num">{j.applications} applied</span>
                </div>
                {j.applicantLimit !== null ? <ProgressBar value={j.applications} max={j.applicantLimit} label="Applicant places taken" /> : null}
              </div>
            </div>
            <div className={s.sheetFoot}>
              <Link to="/refer" className={s.textLink}>Refer someone for this role</Link>
              <Link to="/status" className={s.textLink}>Check an application you sent</Link>
            </div>
          </div>
        </aside>
      </div>
      {j.related.length ? (
        <section className={s.section} aria-labelledby="related-title">
          <div className={s.sectionHead}><h2 id="related-title" className={s.h2}>Other open roles</h2></div>
          <RoleList jobs={j.related} grouped={false} />
        </section>
      ) : null}
    </div>
  );
}

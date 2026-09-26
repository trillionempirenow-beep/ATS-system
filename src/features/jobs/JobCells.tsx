import type { JobRowDto } from '@shared/api/jobs';
import { Badge } from '@/components/ui/Display';
import s from './Jobs.module.css';

export function RoleCell({ job }: { job: Pick<JobRowDto, 'title' | 'isUrgent' | 'tags'> }) {
  return (
    <div className={s.role}>
      <span className={s.roleTitle}>{job.title}{job.isUrgent ? <Badge tone="danger" size="sm">Urgent</Badge> : null}</span>
      {job.tags.length ? <span className={s.tags}>{job.tags.slice(0, 4).map((t) => <span key={t} className={s.tag}>{t}</span>)}</span> : null}
    </div>
  );
}

export function ApplicantsCell({ job }: { job: Pick<JobRowDto, 'applications' | 'applicantLimit'> }) {
  const full = job.applicantLimit !== null && job.applicantLimit > 0 && job.applications >= job.applicantLimit;
  return (
    <div className={s.applicants}>
      <strong className="num">{job.applications}</strong>
      <span>{job.applicantLimit ? `/ ${job.applicantLimit}` : 'Unlimited'}</span>
      {full ? <Badge tone="warning" size="sm">Limit reached</Badge> : null}
    </div>
  );
}

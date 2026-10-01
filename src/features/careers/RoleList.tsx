import { Link } from 'react-router-dom';
import type { PublicJobCardDto } from '@shared/api/public';
import { EMPLOYMENT_TYPE_LABELS } from '@shared/domain/jobs';
import { Badge } from '@/components/ui/Display';
import { Skeleton } from '@/components/ui/Feedback';
import { formatDate } from '@/lib/format';
import { cx } from '@/lib/cx';
import s from './Careers.module.css';

/**
 * Open roles as a ruled list: the posting board. Grouped by team unless the list
 * is already narrowed to one, so a candidate scans titles, not cards.
 */

function RoleRow({ job }: { job: PublicJobCardDto }) {
  const spots = job.full ? null : job.spotsRemaining !== null && job.spotsRemaining <= 5 ? job.spotsRemaining : null;
  return (
    <li>
      <Link to={`/jobs/${job.slug}`} className={cx(s.role, job.full && s.roleFull)}>
        <span className={s.roleMain}>
          <span className={s.roleTitle}>{job.title}</span>
          {job.tags.length ? <span className={s.roleTags}>{job.tags.join(', ')}</span> : null}
        </span>
        <span className={s.roleFlags}>
          {job.isUrgent ? <Badge tone="warning" size="sm">Hiring urgently</Badge> : null}
          {job.full ? <Badge tone="neutral" size="sm">Applications full</Badge> : null}
          {spots !== null ? <Badge tone="neutral" size="sm">{spots === 1 ? '1 place left' : `${spots} places left`}</Badge> : null}
        </span>
        <span className={s.roleWhere}>{job.location || 'Location flexible'}</span>
        <span className={s.roleType}>{EMPLOYMENT_TYPE_LABELS[job.employmentType]}</span>
        <span className={s.rolePosted}>Posted {formatDate(job.postedAt, { month: 'short', day: 'numeric' })}</span>
      </Link>
    </li>
  );
}

export function RoleList({ jobs, grouped = true }: { jobs: PublicJobCardDto[]; grouped?: boolean }) {
  if (!grouped) {
    return <div className={s.board}><ul className={s.roles}>{jobs.map((j) => <RoleRow key={j.id} job={j} />)}</ul></div>;
  }
  const groups = new Map<string, PublicJobCardDto[]>();
  for (const j of jobs) {
    const key = j.department ?? 'Other teams';
    groups.set(key, [...(groups.get(key) ?? []), j]);
  }
  return (
    <div className={s.board}>
      {[...groups].map(([team, list]) => (
        <section key={team} aria-label={team}>
          <h3 className={s.team}><span>{team}</span><span className={s.teamCount}>{list.length === 1 ? '1 role' : `${list.length} roles`}</span></h3>
          <ul className={s.roles}>{list.map((j) => <RoleRow key={j.id} job={j} />)}</ul>
        </section>
      ))}
    </div>
  );
}

export function RoleListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className={s.board} aria-busy="true" aria-label="Loading roles">
      <div className={s.team}><Skeleton height={14} width={120} /></div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={s.roleSkeleton}><Skeleton height={16} width="45%" /><Skeleton height={12} width="25%" /></div>
      ))}
    </div>
  );
}

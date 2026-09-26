import { Link } from 'react-router-dom';
import type { PublicJobCardDto } from '@shared/api/public';
import { EMPLOYMENT_TYPE_LABELS } from '@shared/domain/jobs';
import { Icon } from '@/components/icon/Icon';
import { Badge } from '@/components/ui/Display';
import { formatDate } from '@/lib/format';
import { cx } from '@/lib/cx';
import s from './Careers.module.css';

export function JobCard({ job }: { job: PublicJobCardDto }) {
  return (
    <Link to={`/jobs/${job.slug}`} className={cx(s.card, job.full && s.cardFull)} aria-label={`${job.title}, ${job.department ?? 'Acme'}, ${job.location ?? 'Location flexible'}`}>
      <div className={s.cardTop}>
        <div className={s.cardBadges}>
          <Badge tone="neutral">{job.department ?? 'Acme'}</Badge>
          {job.isUrgent ? <Badge tone="warning" icon="flag">Urgent hiring</Badge> : null}
          {job.full ? <Badge tone="danger" icon="limit">Full</Badge> : job.spotsRemaining !== null && job.spotsRemaining <= 5 ? <Badge tone="warning">{job.spotsRemaining} spots left</Badge> : null}
        </div>
        <h3 className={s.cardTitle}>{job.title}</h3>
        <span className={s.cardMeta}>{job.location || 'Location flexible'} · {EMPLOYMENT_TYPE_LABELS[job.employmentType]}</span>
        {job.tags.length ? (
          <div className={s.tags}>{job.tags.map((t) => <span key={t} className={s.tag}><Icon name="tag" size={11} />{t}</span>)}</div>
        ) : null}
      </div>
      <div className={s.cardFoot}>
        <span><Icon name="clock" size={13} />Posted {formatDate(job.postedAt)}</span>
        <span><Icon name="candidates" size={13} />{job.applications} applied</span>
      </div>
    </Link>
  );
}

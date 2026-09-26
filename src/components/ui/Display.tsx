import { useState, type ReactNode } from 'react';
import { STAGE_LABELS, STAGE_TONES, type Stage, type Tone } from '@shared/domain/pipeline';
import { INTERVIEW_STATE_LABELS, INTERVIEW_STATE_TONES, type DisplayInterviewState } from '@shared/domain/interviews';
import { JOB_STATE_LABELS, JOB_STATE_TONES, type JobState } from '@shared/domain/jobs';
import { ACCOUNT_STATUS_LABELS, type AccountStatus } from '@shared/domain/access';
import { ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_TONES, EMPLOYEE_STATUS_LABELS, EMPLOYEE_STATUS_TONES, type AttendanceStatus, type EmployeeStatus } from '@shared/domain/people';
import { Icon, type IconName } from '../icon/Icon';
import { cx } from '@/lib/cx';
import { initials } from '@/lib/format';
import s from './Display.module.css';

export function Badge({ tone = 'neutral', icon, dot, size = 'md', children }: { tone?: Tone; icon?: IconName; dot?: boolean; size?: 'sm' | 'md'; children: ReactNode }) {
  return (
    <span className={cx(s.badge, s[tone], size === 'sm' && s.badgeSm)}>
      {dot ? <span className={s.dot} aria-hidden /> : icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

const ACCOUNT_TONES: Record<AccountStatus, Tone> = {
  pending: 'warning', active: 'success', rejected: 'danger', suspended: 'danger', disabled: 'neutral', pending_reactivation: 'purple',
};

type StatusBadgeProps =
  | { kind: 'stage'; value: Stage }
  | { kind: 'interview'; value: DisplayInterviewState }
  | { kind: 'job'; value: JobState }
  | { kind: 'account'; value: AccountStatus }
  | { kind: 'attendance'; value: AttendanceStatus }
  | { kind: 'employee'; value: EmployeeStatus };

/** Status is never colour alone: the text always names it, and terminal states carry an icon. */
export function StatusBadge(props: StatusBadgeProps & { size?: 'sm' | 'md' }) {
  let label: string;
  let tone: Tone;
  let icon: IconName | undefined;
  switch (props.kind) {
    case 'stage':
      label = STAGE_LABELS[props.value]; tone = STAGE_TONES[props.value];
      icon = props.value === 'hired' ? 'checkcircle' : props.value === 'rejected' ? 'xcircle' : undefined;
      break;
    case 'interview':
      label = INTERVIEW_STATE_LABELS[props.value]; tone = INTERVIEW_STATE_TONES[props.value];
      icon = props.value === 'reviewed' ? 'checkcircle' : props.value === 'cancelled' || props.value === 'no_show' ? 'xcircle' : undefined;
      break;
    case 'job':
      label = JOB_STATE_LABELS[props.value]; tone = JOB_STATE_TONES[props.value];
      icon = props.value === 'published' ? 'checkcircle' : props.value === 'rejected' ? 'xcircle' : undefined;
      break;
    case 'account':
      label = ACCOUNT_STATUS_LABELS[props.value]; tone = ACCOUNT_TONES[props.value];
      break;
    case 'attendance':
      label = ATTENDANCE_STATUS_LABELS[props.value]; tone = ATTENDANCE_STATUS_TONES[props.value];
      break;
    case 'employee':
      label = EMPLOYEE_STATUS_LABELS[props.value]; tone = EMPLOYEE_STATUS_TONES[props.value];
      break;
  }
  return <Badge tone={tone} icon={icon} dot={!icon} size={props.size}>{label}</Badge>;
}

export function Chip({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return <span className={s.chip}>{icon ? <Icon name={icon} size={12} /> : null}{children}</span>;
}

const AVATAR_TONES: Array<[string, string]> = [
  ['var(--info-bg)', 'var(--info-fg)'], ['var(--teal-bg)', 'var(--teal-fg)'], ['var(--purple-bg)', 'var(--purple-fg)'],
  ['var(--warning-bg)', 'var(--warning-fg)'], ['var(--success-bg)', 'var(--success-fg)'], ['var(--neutral-bg)', 'var(--neutral-fg)'],
];

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATAR_TONES[hash % AVATAR_TONES.length]!;
  return (
    <span className={s.avatar} style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.max(10, Math.round(size / 2.7)) }} aria-hidden={!src}>
      {src && !broken ? <img src={src} alt={name} onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}

export function Rating({ value, size = 16, onChange, label = 'Rating' }: { value: number; size?: number; onChange?: (n: number) => void; label?: string }) {
  if (!onChange) {
    return (
      <span className={s.rating} role="img" aria-label={`${label}: ${value} of 5`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={cx(s.star, n <= value && s.starOn)}><Icon name="star" size={size} style={n <= value ? { fill: 'currentColor' } : undefined} /></span>
        ))}
      </span>
    );
  }
  return (
    <span className={s.rating} role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === value}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          className={cx(s.star, s.starBtn, n <= value && s.starOn)}
          onClick={() => onChange(n === value ? 0 : n)}
        >
          <Icon name="star" size={size} style={n <= value ? { fill: 'currentColor' } : undefined} />
        </button>
      ))}
    </span>
  );
}

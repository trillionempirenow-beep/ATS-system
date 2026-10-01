import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from '../icon/Icon';
import { cx } from '@/lib/cx';
import { Button } from './Button';
import s from './Feedback.module.css';

type NoticeTone = 'info' | 'success' | 'warning' | 'danger';
const NOTICE_ICONS: Record<NoticeTone, IconName> = { info: 'info', success: 'checkcircle', warning: 'alert', danger: 'xcircle' };

export function Notice({ tone = 'info', title, children, action, className }: { tone?: NoticeTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx(s.notice, s[tone], className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={NOTICE_ICONS[tone]} size={18} />
      <div className={s.noticeText}>
        {title ? <div className={s.noticeTitle}>{title}</div> : null}
        {children ? <div className={s.noticeBody}>{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon = 'layers', title, text, actions, compact }: { icon?: IconName; title: ReactNode; text?: ReactNode; actions?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx(s.state, compact && s.stateCompact)}>
      <span className={s.stateIcon}><Icon name={icon} size={28} /></span>
      <h3 className={s.stateTitle}>{title}</h3>
      {text ? <p className={s.stateText}>{text}</p> : null}
      {actions ? <div className={s.stateActions}>{actions}</div> : null}
    </div>
  );
}

export function ErrorState({ title = 'This could not be loaded', text = 'The request did not finish. Check your connection, then try again.', onRetry, compact }: { title?: string; text?: ReactNode; onRetry?: () => void; compact?: boolean }) {
  return (
    <div className={cx(s.state, compact && s.stateCompact)} role="alert">
      <span className={cx(s.stateIcon, s.stateIconDanger)}><Icon name="alert" size={28} /></span>
      <h3 className={s.stateTitle}>{title}</h3>
      <p className={s.stateText}>{text}</p>
      {onRetry ? (
        <div className={s.stateActions}>
          <Button variant="secondary" icon="refresh" onClick={onRetry}>Try again</Button>
        </div>
      ) : null}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 16, radius, style }: { width?: number | string; height?: number | string; radius?: number; style?: CSSProperties }) {
  return <span className={s.skeleton} style={{ width, height, borderRadius: radius, ...style }} aria-hidden />;
}

export function Spinner({ size = 20, label = 'Loading' }: { size?: number; label?: string }) {
  return <span className={s.spinner} style={{ width: size, height: size }} role="status" aria-label={label} />;
}

export function PageSpinner() {
  return <div className={s.center}><Spinner size={28} /></div>;
}

export interface StepItem { key: string; label: string; done: boolean; current: boolean }

export function Stepper({ steps, rejected }: { steps: StepItem[]; rejected?: boolean }) {
  return (
    <ol className={s.stepper} aria-label="Progress">
      {steps.map((st, i) => (
        <li key={st.key} className={cx(s.step, st.done && !st.current && s.stepDone, st.current && !rejected && s.stepCurrent, st.current && rejected && s.stepRejected)} aria-current={st.current ? 'step' : undefined}>
          <span className={s.stepDot}>{st.done && !st.current ? <Icon name="check" size={14} /> : st.current && rejected ? <Icon name="close" size={14} /> : i + 1}</span>
          <span className={s.stepLabel}>{st.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function Timeline({ items }: { items: Array<{ key: string | number; title: ReactNode; sub?: ReactNode; done?: boolean; icon?: IconName }> }) {
  return (
    <ul className={s.timeline}>
      {items.map((it) => (
        <li key={it.key} className={s.tlItem}>
          <span className={cx(s.tlDot, it.done && s.tlDone)}><Icon name={it.icon ?? (it.done ? 'check' : 'clock')} size={13} /></span>
          <div className={s.tlText}>
            <div className={s.tlTitle}>{it.title}</div>
            {it.sub ? <div className={s.tlSub}>{it.sub}</div> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ProgressBar({ value, max = 100, label }: { value: number; max?: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
  return (
    <div className={s.progressTrack} role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={s.progressFill} style={{ width: `${pct}%` }} />
    </div>
  );
}

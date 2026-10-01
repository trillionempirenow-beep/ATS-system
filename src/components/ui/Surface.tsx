import { Fragment, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../icon/Icon';
import { cx } from '@/lib/cx';
import { Skeleton } from './Feedback';
import s from './Surface.module.css';

export const surfaceStyles = s;

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 0 | 16 | 20 | 24;
}

export function Card({ padding = 20, className, children, ...rest }: CardProps) {
  return (
    <div className={cx(s.card, padding === 16 && s.pad16, padding === 20 && s.pad20, padding === 24 && s.pad24, padding === 0 && s.flush, className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, actions, flush, as: Tag = 'h2' }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; flush?: boolean; as?: 'h2' | 'h3' }) {
  return (
    <div className={cx(s.cardHeader, flush && s.cardHeaderFlush)}>
      <div className={s.cardHeadText}>
        <Tag className={s.cardTitle}>{title}</Tag>
        {subtitle ? <p className={s.cardSub}>{subtitle}</p> : null}
      </div>
      {actions ? <div className={s.cardActions}>{actions}</div> : null}
    </div>
  );
}

export interface Crumb { label: string; to?: string }

export function PageHeader({ title, description, crumbs, actions }: { title: ReactNode; description?: ReactNode; crumbs?: Crumb[]; actions?: ReactNode }) {
  return (
    <header className={s.pageHeader}>
      <div className={s.pageHeadText}>
        {crumbs?.length ? (
          <nav className={s.crumbs} aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <Fragment key={`${c.label}-${i}`}>
                {i > 0 ? <span className={s.crumbSep} aria-hidden>/</span> : null}
                {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span className={i === crumbs.length - 1 ? s.crumbCurrent : undefined}>{c.label}</span>}
              </Fragment>
            ))}
          </nav>
        ) : null}
        <h1 className={s.pageTitle}>{title}</h1>
        {description ? <p className={s.pageDesc}>{description}</p> : null}
      </div>
      {actions ? <div className={s.pageActions}>{actions}</div> : null}
    </header>
  );
}

/**
 * One figure in the stats strip: label, value, and a plain-words note. `delta` is the
 * change since the same day last week. `icon` is kept for callers but not drawn: the
 * label says what the number is.
 */
export function StatCard({ label, value, delta, hint, loading }: { icon?: IconName; label: string; value: ReactNode; delta?: number | null; hint?: string; loading?: boolean }) {
  const note = typeof delta === 'number'
    ? (delta === 0 ? <span>No change since last week</span>
      : <span><span className={delta > 0 ? s.deltaUp : s.deltaDown}>{delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}</span> since last week</span>)
    : hint ? <span>{hint}</span> : null;
  return (
    <div className={s.stat} role="group" aria-label={label}>
      <div className={s.statLabel}>{label}</div>
      {loading ? <Skeleton width={56} height={30} /> : <div className={s.statValue}>{value}</div>}
      {note ? <div className={s.statNote}>{note}</div> : null}
    </div>
  );
}

export function StatGrid({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className={s.statGrid} style={style}>{children}</div>;
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  width?: number | string;
  /** Shown as the heading of the stacked card on mobile. */
  primary?: boolean;
  label?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  selectedKey?: string | number | null;
  loading?: boolean;
  skeletonRows?: number;
  empty?: ReactNode;
  caption?: string;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, selectedKey, loading, skeletonRows = 6, empty, caption }: DataTableProps<T>) {
  if (!loading && rows.length === 0 && empty) return <>{empty}</>;
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (onRowClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRowClick(row); }
  };
  return (
    <div className={s.tableWrap}>
      <table className={cx(s.table, s.responsive)}>
        {caption ? <caption className="visually-hidden">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.align === 'right' ? s.alignRight : undefined} style={c.width ? { width: c.width } : undefined}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={`sk-${i}`}>
                  {columns.map((c) => <td key={c.key}><Skeleton height={14} width={c.primary ? '70%' : '50%'} /></td>)}
                </tr>
              ))
            : rows.map((row) => {
                const key = rowKey(row);
                return (
                  <tr
                    key={key}
                    className={cx(onRowClick && s.rowClickable, selectedKey === key && s.rowSelected)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={onRowClick ? (e) => onKey(e, row) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={c.align === 'right' ? s.alignRight : undefined}
                        data-label={c.primary ? undefined : (c.label ?? (typeof c.header === 'string' ? c.header : undefined))}
                        data-primary={c.primary ? '' : undefined}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}

export interface TabItem<K extends string> { key: K; label: string; count?: number; lead?: ReactNode }

export function Tabs<K extends string>({ items, value, onChange, label }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className={s.tabs} role="tablist" aria-label={label}>
      {items.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.key === value} className={s.tab} onClick={() => onChange(t.key)}>
          {t.label}
          {typeof t.count === 'number' ? <span className={s.tabCount}>{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function PillTabs<K extends string>({ items, value, onChange, label }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className={s.pills} role="group" aria-label={label}>
      {items.map((t) => (
        <button key={t.key} type="button" className={s.pill} aria-pressed={t.key === value} onClick={() => onChange(t.key)}>
          {t.lead}{t.label}
          {typeof t.count === 'number' ? <span className={s.pillCount}>{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageCount, total, pageSize, onChange }: { page: number; pageCount: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  if (pageCount <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1);
  return (
    <nav className={s.pagination} aria-label="Pagination">
      <span className="num">{first}–{last} of {total}</span>
      <div className={s.pageButtons}>
        <button type="button" className={s.pageBtn} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page"><Icon name="chevronl" size={14} /></button>
        {pages.map((p, i) => (
          <Fragment key={p}>
            {i > 0 && p - (pages[i - 1] ?? p) > 1 ? <span className={s.pageGap}>…</span> : null}
            <button type="button" className={s.pageBtn} aria-current={p === page ? 'page' : undefined} onClick={() => onChange(p)}>{p}</button>
          </Fragment>
        ))}
        <button type="button" className={s.pageBtn} disabled={page >= pageCount} onClick={() => onChange(page + 1)} aria-label="Next page"><Icon name="chevronr" size={14} /></button>
      </div>
    </nav>
  );
}

export function DescriptionList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className={s.dl}>
      {items.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>
      ))}
    </dl>
  );
}

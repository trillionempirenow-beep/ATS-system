import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AssistantCell, AssistantView, AssistantViewColumn } from '@shared/api/assistant';
import { stageRank, type Stage, type Tone } from '@shared/domain/pipeline';
import { Icon, type IconName } from '@/components/icon/Icon';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Overlay';
import { StageTag } from '@/components/ui/Stage';
import { cx } from '@/lib/cx';
import s from './AssistantViews.module.css';

/**
 * What the assistant looked up, as a table. In the chat it is a small card (the
 * first rows and a button); the button opens the whole list in a window the
 * person can search and sort, with each row linking to its record.
 */

const ICONS: Record<string, IconName> = {
  Candidates: 'candidates', Interviews: 'interviews', Jobs: 'briefcase', 'Waiting for approval': 'checkcircle',
  Pipeline: 'pipeline', Departments: 'building', Interviewers: 'users',
};

const TONES: Record<string, Tone> = {
  open: 'success', confirmed: 'success', completed: 'success', scheduled: 'info', draft: 'neutral', closed: 'neutral',
  paused: 'warning', 'waiting for approval': 'warning', cancelled: 'danger', no_show: 'danger',
};

const words = (v: string) => { const t = v.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
const asText = (v: AssistantCell | undefined) => (v === null || v === undefined ? '' : String(v));
const plural = (n: number) => `${n} ${n === 1 ? 'result' : 'results'}`;
const linkOf = (row: Record<string, AssistantCell>) => (typeof row._link === 'string' ? row._link : null);

function Cell({ col, row }: { col: AssistantViewColumn; row: Record<string, AssistantCell> }) {
  const value = row[col.key];
  if (value === null || value === undefined || value === '') return <span className={s.empty}>—</span>;
  if (col.kind === 'stage') return <StageTag stage={value as Stage} size="sm" />;
  if (col.kind === 'badge') return <Badge tone={TONES[String(value).toLowerCase()] ?? 'neutral'} size="sm">{words(String(value))}</Badge>;
  if (col.kind === 'count') return <span className={s.count}>{value}</span>;
  if (col.kind === 'date') return <span className={s.date}>{value}</span>;
  const sub = col.sub ? asText(row[col.sub]) : '';
  return (
    <span className={s.primary}>
      <span className={s.primaryText}>{value}</span>
      {sub ? <span className={s.sub}>{sub}</span> : null}
    </span>
  );
}

/** One column of a row as plain text, for searching and sorting. */
function plain(col: AssistantViewColumn, row: Record<string, AssistantCell>): string {
  return [asText(row[col.key]), col.sub ? asText(row[col.sub]) : ''].join(' ').trim().toLowerCase();
}

function compare(col: AssistantViewColumn, a: Record<string, AssistantCell>, b: Record<string, AssistantCell>): number {
  const [x, y] = [a[col.key], b[col.key]];
  if ((x === null || x === '') !== (y === null || y === '')) return x === null || x === '' ? 1 : -1; // blanks last
  if (col.kind === 'stage') return stageRank(x as Stage) - stageRank(y as Stage);
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return asText(x).localeCompare(asText(y), undefined, { numeric: true, sensitivity: 'base' });
}

export function ViewModal({ view, open, onClose }: { view: AssistantView; open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const hasLinks = view.rows.some((r) => linkOf(r));

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = q ? view.rows.filter((r) => view.columns.some((c) => plain(c, r).includes(q))) : view.rows;
    const col = sort ? view.columns.find((c) => c.key === sort.key) : undefined;
    if (col && sort) out = [...out].sort((a, b) => compare(col, a, b) * (sort.dir === 'asc' ? 1 : -1));
    return out;
  }, [view, query, sort]);

  function toggle(key: string) {
    setSort((cur) => (cur?.key !== key ? { key, dir: 'asc' } : cur.dir === 'asc' ? { key, dir: 'desc' } : null));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={view.title}
      subtitle={[plural(view.rows.length), view.subtitle].filter(Boolean).join(' · ')}
      width={940}
      footer={
        <>
          <span className={s.footNote} aria-live="polite">{query ? `${rows.length} of ${view.rows.length} shown` : `${view.rows.length} in total`}</span>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </>
      }
    >
      {view.rows.length > 5 ? (
        <label className={s.search}>
          <Icon name="search" size={16} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${view.title.toLowerCase()}`} aria-label={`Search ${view.title}`} data-autofocus />
        </label>
      ) : null}
      <div className={s.scroll}>
        <table className={s.table}>
          <caption className="sr-only">{view.title}</caption>
          <thead>
            <tr>
              {view.columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" className={cx(c.kind === 'count' && s.right)} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className={cx(s.sortBtn, active && s.sortOn)} onClick={() => toggle(c.key)}>
                      {c.label}
                      <Icon name={active ? (sort.dir === 'asc' ? 'chevronu' : 'chevron') : 'sort'} size={12} />
                    </button>
                  </th>
                );
              })}
              {hasLinks ? <th scope="col" className={s.linkCol}><span className="sr-only">Open</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const link = linkOf(r);
              return (
                <tr key={i}>
                  {view.columns.map((c) => <td key={c.key} className={cx(c.kind === 'count' && s.right)}><Cell col={c} row={r} /></td>)}
                  {hasLinks ? (
                    <td className={s.linkCol}>
                      {link ? <Link to={link} className={s.open} onClick={onClose}>Open<Icon name="arrowr" size={13} /></Link> : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <p className={s.none}>Nothing matches “{query}”.</p> : null}
      </div>
    </Modal>
  );
}

/** The chat's small version of a list: the first few rows, and a button for all of it. */
export function ViewCard({ view, onOpen }: { view: AssistantView; onOpen: () => void }) {
  const [first] = view.columns;
  // What goes beside each name: its stage or status if the list has one, else the next column.
  const second = view.columns.find((c) => c.kind === 'stage' || c.kind === 'badge') ?? view.columns[1];
  const top = view.rows.slice(0, 3);
  const more = view.rows.length - top.length;
  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <span className={s.cardIcon}><Icon name={ICONS[view.title] ?? 'layers'} size={16} /></span>
        <div className={s.cardTitle}>
          <strong>{view.title}</strong>
          <span>{[plural(view.rows.length), view.subtitle].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      {first ? (
        <ul className={s.cardRows}>
          {top.map((r, i) => (
            <li key={i}>
              <span className={s.cardName}>{asText(r[first.key])}</span>
              {second ? <span className={s.cardMeta}><Cell col={second} row={r} /></span> : null}
            </li>
          ))}
          {more > 0 ? <li className={s.cardMore}>and {more} more</li> : null}
        </ul>
      ) : null}
      <Button size="sm" variant="secondary" icon="expand" onClick={onOpen} className={s.cardBtn}>View all {view.rows.length}</Button>
    </div>
  );
}

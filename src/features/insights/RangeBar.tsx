import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from '@shared/domain/people';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Form';
import s from './Insights.module.css';

export interface RangeParams { range: RangeKey; from?: string; to?: string; user?: string; view?: string }

/** Range, custom dates and subject live in the URL so a report can be shared or reloaded. */
export function useRangeParams(): [RangeParams, (patch: Partial<RangeParams>) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('range');
  const value: RangeParams = {
    range: raw && (RANGE_KEYS as readonly string[]).includes(raw) ? (raw as RangeKey) : 'month',
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    user: params.get('user') ?? undefined,
    view: params.get('view') ?? undefined,
  };
  const update = (patch: Partial<RangeParams>) => setParams((prev) => {
    const n = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
    if (n.get('range') !== 'custom') { n.delete('from'); n.delete('to'); }
    return n;
  }, { replace: true });
  return [value, update];
}

export function RangeBar({ value, onApply, actions }: { value: RangeParams; onApply: (v: Pick<RangeParams, 'range' | 'from' | 'to'>) => void; actions?: ReactNode }) {
  const [range, setRange] = useState<RangeKey>(value.range);
  const [from, setFrom] = useState(value.from ?? '');
  const [to, setTo] = useState(value.to ?? '');
  useEffect(() => { setRange(value.range); setFrom(value.from ?? ''); setTo(value.to ?? ''); }, [value.range, value.from, value.to]);
  const custom = range === 'custom';
  const invalid = custom && (!from || !to || from > to);
  return (
    <form className={s.rangeBar} onSubmit={(e) => { e.preventDefault(); if (!invalid) onApply({ range, from: custom ? from : undefined, to: custom ? to : undefined }); }}>
      <Field label="Reporting period">
        <Select value={range} onChange={(e) => setRange(e.target.value as RangeKey)} options={RANGE_KEYS.map((k) => ({ value: k, label: RANGE_LABELS[k] }))} />
      </Field>
      {custom ? (
        <>
          <Field label="From"><TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </>
      ) : null}
      <Button type="submit" disabled={invalid}>Apply</Button>
      {actions ? <span className={s.rangeActions}>{actions}</span> : null}
    </form>
  );
}

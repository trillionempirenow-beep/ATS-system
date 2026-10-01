import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AuditCategory, AuditLogDto } from '@shared/api/admin';
import { ROLE_LABELS, ROLES, type Role } from '@shared/domain/access';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Display';
import type { Tone } from '@shared/domain/pipeline';
import { Field, Select, TextInput } from '@/components/ui/Form';
import { EmptyState, Notice } from '@/components/ui/Feedback';
import { Card, CardHeader, DataTable, PageHeader, Pagination, StatCard, StatGrid, type Column } from '@/components/ui/Surface';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { api, qs } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { adminKeys } from './api';
import w from '../workspace.module.css';
import s from './Admin.module.css';

type Row = AuditLogDto['rows'][number];
const CATEGORY_TONES: Record<AuditCategory, Tone> = {
  security: 'danger', approval: 'purple', interview: 'info', candidate: 'teal', job: 'warning', account: 'neutral', system: 'neutral',
};
const FILTER_KEYS = ['q', 'user', 'role', 'action', 'from', 'to'] as const;
type Filters = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

const actionLabel = (a: string) => a.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const applied: Filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined]));
  const page = params.get('page') ?? '1';
  const [draft, setDraft] = useState<Filters>(applied);
  const key = { ...applied, page };
  const q = useQuery({ queryKey: adminKeys.audit(key), queryFn: () => api.get<AuditLogDto>(`/audit-logs${qs(key)}`), placeholderData: (prev) => prev });
  useEffect(() => { document.title = 'Audit trail · Acme People'; }, []);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const filtered = FILTER_KEYS.some((k) => applied[k]);
  const set = (k: keyof Filters, v: string) => setDraft((cur) => ({ ...cur, [k]: v || undefined }));
  const apply = () => setParams(Object.fromEntries(Object.entries(draft).filter(([, v]) => v)) as Record<string, string>, { replace: true });
  const clear = () => { setDraft({}); setParams({}, { replace: true }); };
  const invalidRange = Boolean(draft.from && draft.to && draft.from > draft.to);

  const columns: Column<Row>[] = [
    { key: 'when', header: 'Date / time', cell: (r) => <span className={s.when}>{formatDate(r.createdAt)} · {formatTime(r.createdAt)}</span>, label: 'Date / time' },
    { key: 'user', header: 'User', cell: (r) => r.userName ?? 'System', primary: true },
    { key: 'role', header: 'Role', cell: (r) => (r.userRole ? ROLE_LABELS[r.userRole] : '—'), label: 'Role' },
    { key: 'action', header: 'Action', cell: (r) => <span className={s.actionCell}><Badge tone={CATEGORY_TONES[r.category]} size="sm">{r.category}</Badge>{actionLabel(r.action)}</span>, label: 'Action' },
    { key: 'related', header: 'Related', cell: (r) => (r.entityType && r.entityId ? `${actionLabel(r.entityType)} #${r.entityId}` : '—'), label: 'Related' },
    { key: 'detail', header: 'Details', cell: (r) => <span className={s.detail}>{[r.subject, r.detail].filter(Boolean).join(' · ') || '—'}</span>, label: 'Details' },
  ];

  return (
    <div className={w.page}>
      <PageHeader title="Audit trail" description={d?.ownOnly ? 'Your own recorded activity.' : 'Review system activity without cluttering Job management.'}
        crumbs={[{ label: 'Administration' }, { label: 'Audit trail' }]}
        actions={<ButtonLink variant="secondary" icon="download" to={`/api/v1/audit-logs.csv${qs(applied)}`} reloadDocument>Export CSV</ButtonLink>} />
      <StatGrid>
        <StatCard icon="layers" label="Total events" value={d?.stats.total.toLocaleString() ?? 0} loading={!d} />
        <StatCard icon="calendar" label="Today" value={d?.stats.today ?? 0} loading={!d} />
        <StatCard icon="users" label="Users with activity" value={d?.stats.actors ?? 0} loading={!d} />
        <StatCard icon="shield" label="Security events" value={d?.stats.security ?? 0} loading={!d} />
      </StatGrid>
      <Card>
        <form className={s.filters} onSubmit={(e) => { e.preventDefault(); if (!invalidRange) apply(); }}>
          <Field label="Search"><TextInput icon="search" value={draft.q ?? ''} onChange={(e) => set('q', e.target.value)} placeholder="Name, job, candidate or detail" /></Field>
          <Field label="Action">
            <Select value={draft.action ?? ''} onChange={(e) => set('action', e.target.value)} placeholder="All actions" options={(d?.options.actions ?? []).map((a) => ({ value: a, label: actionLabel(a) }))} />
          </Field>
          {!d?.ownOnly ? (
            <>
              <Field label="User"><Select value={draft.user ?? ''} onChange={(e) => set('user', e.target.value)} placeholder="All users" options={(d?.options.users ?? []).map((u) => ({ value: u.id, label: u.name }))} /></Field>
              <Field label="Role"><Select value={draft.role ?? ''} onChange={(e) => set('role', e.target.value)} placeholder="All roles" options={ROLES.map((r: Role) => ({ value: r, label: ROLE_LABELS[r] }))} /></Field>
            </>
          ) : null}
          <Field label="From"><TextInput type="date" value={draft.from ?? ''} onChange={(e) => set('from', e.target.value)} /></Field>
          <Field label="To"><TextInput type="date" value={draft.to ?? ''} onChange={(e) => set('to', e.target.value)} /></Field>
          <div className={s.filterButtons}>
            <Button type="submit" disabled={invalidRange}>Apply filters</Button>
            <Button type="button" variant="ghost" onClick={clear} disabled={!filtered && !Object.values(draft).some(Boolean)}>Clear</Button>
          </div>
        </form>
        {invalidRange ? <Notice tone="warning" className={w.mt12}>The start date must be on or before the end date.</Notice> : null}
      </Card>
      <Card padding={0}>
        <div className={s.tableHead}><CardHeader title="Activity history" subtitle={d ? `${d.total.toLocaleString()} matching event${d.total === 1 ? '' : 's'}` : undefined} /></div>
        <DataTable columns={columns} rows={d?.rows ?? []} rowKey={(r) => r.id} loading={!d} caption="Activity history"
          empty={<EmptyState compact icon="search" title="No matching activity" text="No audit events match these filters. Try clearing the search or widening the date range."
            actions={filtered ? <Button variant="secondary" onClick={clear}>Clear filters</Button> : null} />} />
        {d && d.pageCount > 1 ? (
          <div className={s.pager}>
            <Pagination page={d.page} pageCount={d.pageCount} total={d.total} pageSize={d.pageSize}
              onChange={(p) => setParams((prev) => { const n = new URLSearchParams(prev); n.set('page', String(p)); return n; }, { replace: true })} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}

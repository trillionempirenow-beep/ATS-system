import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { STAGE_LABELS, STAGES, type Stage } from '@shared/domain/pipeline';
import { Icon } from '@/components/icon/Icon';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Avatar, Rating, StatusBadge } from '@/components/ui/Display';
import { Select, TextInput } from '@/components/ui/Form';
import { EmptyState } from '@/components/ui/Feedback';
import { Card, DataTable, PageHeader, Pagination, PillTabs } from '@/components/ui/Surface';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { formatDate } from '@/lib/format';
import { useDebouncedParam, useUrlParams } from '@/lib/urlState';
import { useCandidates } from './api';
import w from '../workspace.module.css';

const SORTS = [
  { value: 'recent', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'role', label: 'Role' },
];
const RATINGS = [
  { value: '', label: 'Any rating' },
  { value: '4', label: '4 stars and up' },
  { value: '3', label: '3 stars and up' },
  { value: 'unrated', label: 'Unrated' },
];

export function CandidatesPage() {
  const [params, set] = useUrlParams();
  const navigate = useNavigate();
  const filters = {
    q: params.get('q') ?? undefined,
    stage: params.get('stage') ?? undefined,
    job: params.get('job') ?? undefined,
    owner: params.get('owner') ?? undefined,
    rating: params.get('rating') ?? undefined,
    sort: params.get('sort') ?? undefined,
    page: params.get('page') ?? undefined,
  };
  const [search, setSearch] = useDebouncedParam('q', 'page');
  const list = useCandidates(filters);
  useEffect(() => { document.title = 'Candidates · Acme People'; }, []);
  const clear = () => { setSearch(''); set(Object.fromEntries([...params.keys()].map((k) => [k, null]))); };

  if (list.isError) return <QueryErrorPage error={list.error} onRetry={() => void list.refetch()} />;
  const d = list.data;
  const total = d ? Object.values(d.stageCounts).reduce((a, b) => a + (b ?? 0), 0) : 0;
  const active = d ? total - (d.stageCounts.hired ?? 0) - (d.stageCounts.rejected ?? 0) : 0;
  const anyFilter = Boolean(filters.q || filters.stage || filters.job || filters.owner || filters.rating || (filters.sort && filters.sort !== 'recent'));

  return (
    <div className={w.page}>
      <PageHeader
        crumbs={[{ label: 'Recruiting' }, { label: 'Candidates' }]}
        title="Candidates"
        description={d ? `${active} active · ${total} in total` : undefined}
        actions={<><ButtonLink to="/app/pipeline" variant="secondary" icon="pipeline">View pipeline</ButtonLink><ButtonLink to="/app/candidates/new" icon="plus">Add candidate</ButtonLink></>}
      />
      <PillTabs
        label="Stage"
        value={(filters.stage ?? 'all') as Stage | 'all'}
        onChange={(k) => set({ stage: k === 'all' ? null : k, page: null })}
        items={[{ key: 'all' as const, label: 'All', count: d ? total : undefined }, ...STAGES.map((st) => ({ key: st, label: STAGE_LABELS[st], count: d?.stageCounts[st] ?? (d ? 0 : undefined) }))]}
      />
      <Card padding={0}>
        <div className={w.filterBar} role="search">
          <div className={w.filterSearch}><TextInput icon="search" placeholder="Search name, email, skills or resume text…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search candidates" /></div>
          <div className={w.filterSelect}><Select aria-label="Role" value={filters.job ?? ''} onChange={(e) => set({ job: e.target.value || null, page: null })} placeholder="All roles" options={(d?.options.jobs ?? []).map((j) => ({ value: j.id, label: j.title }))} /></div>
          <div className={w.filterSelect}><Select aria-label="Assigned to" value={filters.owner ?? ''} onChange={(e) => set({ owner: e.target.value || null, page: null })} placeholder="Anyone" options={(d?.options.owners ?? []).map((o) => ({ value: o.id, label: o.name }))} /></div>
          <div className={w.filterSelect}><Select aria-label="Rating" value={filters.rating ?? ''} onChange={(e) => set({ rating: e.target.value || null, page: null })} options={RATINGS} /></div>
          <div className={w.filterSelect}><Select aria-label="Sort" value={filters.sort ?? 'recent'} onChange={(e) => set({ sort: e.target.value === 'recent' ? null : e.target.value })} options={SORTS} /></div>
          {anyFilter ? <Button variant="ghost" onClick={clear}>Clear</Button> : null}
        </div>
        <DataTable
          caption="Candidates"
          loading={list.isLoading}
          rows={d?.rows ?? []}
          rowKey={(r) => r.applicationId}
          onRowClick={(r) => navigate(`/app/candidates/${r.applicationId}`)}
          empty={
            anyFilter
              ? <EmptyState icon="search" title="No candidates found" text="No candidates match your search. Try a different name, role or stage, or clear the filters." actions={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
              : <EmptyState icon="candidates" title="No candidates yet" text="Applications from the careers site and candidates you add manually will appear here." actions={<ButtonLink to="/app/candidates/new" icon="plus">Add candidate</ButtonLink>} />
          }
          columns={[
            { key: 'c', header: 'Candidate', primary: true, cell: (r) => (
              <span className={w.person}><Avatar name={r.name} src={r.avatarUrl} size={32} /><span className={w.personText}><span className={w.personName}>{r.name}</span><span className={w.personSub}>{r.email}</span></span></span>
            ) },
            { key: 'r', header: 'Role', cell: (r) => r.jobTitle },
            { key: 's', header: 'Stage', cell: (r) => <StatusBadge kind="stage" value={r.stage} size="sm" /> },
            { key: 'o', header: 'Assigned to', cell: (r) => r.ownerName ? <span className={w.person}><Avatar name={r.ownerName} size={24} />{r.ownerName}</span> : <span className={w.faint}>Unassigned</span> },
            { key: 'a', header: 'Applied', cell: (r) => <span className="num">{formatDate(r.appliedAt, { month: 'short', day: 'numeric' })}</span> },
            { key: 'g', header: 'Rating', cell: (r) => r.rating ? <Rating value={r.rating} size={13} /> : <span className={w.faint}>—</span> },
            { key: 'd', header: 'Resume', label: 'Resume', align: 'right', cell: (r) => r.primaryDocumentId
              ? <a href={`/api/v1/documents/${r.primaryDocumentId}/download?inline=1`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`Open ${r.name}'s resume`} className={w.link}><Icon name="doc" size={16} /></a>
              : <span className={w.faint}>—</span> },
          ]}
        />
        {d ? <Pagination page={d.page} pageCount={d.pageCount} total={d.total} pageSize={25} onChange={(p) => set({ page: p > 1 ? String(p) : null })} /> : null}
      </Card>
    </div>
  );
}

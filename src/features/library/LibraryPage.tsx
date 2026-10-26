import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LibraryRowDto } from '@shared/api/library';
import { STAGE_LABELS, STAGES } from '@shared/domain/pipeline';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Display';
import { Select, TextInput } from '@/components/ui/Form';
import { EmptyState } from '@/components/ui/Feedback';
import { Card, DataTable, PageHeader, Pagination } from '@/components/ui/Surface';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { formatDate, plural } from '@/lib/format';
import { useDebouncedParam, useUrlParams } from '@/lib/urlState';
import { useLibrary } from './api';
import w from '../workspace.module.css';
import s from './Library.module.css';

const HAS = [
  { value: '', label: 'Everything' },
  { value: 'summary', label: 'Has interview summary' },
  { value: 'recording', label: 'Has recording' },
  { value: 'shared', label: 'Shared right now' },
];

function Counts({ r }: { r: LibraryRowDto }) {
  const parts = [
    r.documents ? plural(r.documents, 'CV', 'CVs') : null,
    r.summaries ? plural(r.summaries, 'summary', 'summaries') : null,
    r.recordings ? plural(r.recordings, 'recording part', 'recording parts') : null,
  ].filter(Boolean);
  return <span className={s.counts}>{parts.length ? parts.map((p) => <span key={p}>{p}</span>) : <span>No files yet</span>}</span>;
}

export function LibraryPage() {
  const [params, set] = useUrlParams();
  const navigate = useNavigate();
  const filters = {
    q: params.get('q') ?? undefined, job: params.get('job') ?? undefined, stage: params.get('stage') ?? undefined,
    has: params.get('has') ?? undefined, page: params.get('page') ?? undefined,
  };
  const [search, setSearch] = useDebouncedParam('q', 'page');
  const list = useLibrary(filters);
  useEffect(() => { document.title = 'Library · Acme People'; }, []);
  const anyFilter = Boolean(filters.q || filters.job || filters.stage || filters.has);
  const clear = () => { setSearch(''); set({ q: null, job: null, stage: null, has: null, page: null }); };

  if (list.isError) return <QueryErrorPage error={list.error} onRetry={() => void list.refetch()} />;
  const d = list.data;

  return (
    <div className={w.page}>
      <PageHeader
        crumbs={[{ label: 'Recruiting' }, { label: 'Library' }]}
        title="Library"
        description="Every applicant's file in one place: CV, details, notes, interview summaries and recordings. Open a file to share a view-only copy by email."
      />
      <Card padding={0}>
        <div className={w.filterGrid} role="search">
          <div className={w.filterSearch}><TextInput icon="search" placeholder="Search name, email or role" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the library" /></div>
          <div className={w.filterSelect}><Select aria-label="Role" value={filters.job ?? ''} onChange={(e) => set({ job: e.target.value || null, page: null })} placeholder="All roles" options={(d?.jobs ?? []).map((j) => ({ value: j.id, label: j.title }))} /></div>
          <div className={w.filterSelect}><Select aria-label="Stage" value={filters.stage ?? ''} onChange={(e) => set({ stage: e.target.value || null, page: null })} placeholder="All stages" options={STAGES.map((st) => ({ value: st, label: STAGE_LABELS[st] }))} /></div>
          <div className={w.filterSelect}><Select aria-label="Contents" value={filters.has ?? ''} onChange={(e) => set({ has: e.target.value || null, page: null })} options={HAS} /></div>
          <span className={w.filterSelect} />
          <span className={w.filterClear}>{anyFilter ? <Button variant="ghost" onClick={clear}>Clear</Button> : null}</span>
        </div>
        <DataTable
          caption="Applicant files"
          loading={list.isLoading}
          rows={d?.rows ?? []}
          rowKey={(r) => r.applicationId}
          onRowClick={(r) => navigate(`/app/library/${r.applicationId}`)}
          empty={<EmptyState icon="doc" title={anyFilter ? 'No files match these filters' : 'No applicant files yet'} text={anyFilter ? 'Try another search, or clear the filters.' : 'Files appear here as soon as someone applies or is added.'} />}
          columns={[
            { key: 'n', header: 'Applicant', primary: true, cell: (r) => <span className={w.personText}><span className={w.personName} title={r.name}>{r.name}</span><span className={w.personSub}>{r.email}</span></span> },
            { key: 'j', header: 'Role', cell: (r) => r.jobTitle },
            { key: 's', header: 'Stage', cell: (r) => (r.withdrawn ? <span className={w.faint}>Withdrawn</span> : <StatusBadge kind="stage" value={r.stage} size="sm" />) },
            { key: 'f', header: 'In the file', cell: (r) => <Counts r={r} /> },
            { key: 'sh', header: 'Shared', cell: (r) => (r.activeShares ? plural(r.activeShares, 'person', 'people') : <span className={w.faint}>Not shared</span>) },
            { key: 'a', header: 'Applied', cell: (r) => <span className="num">{formatDate(r.appliedAt, { month: 'short', day: 'numeric', year: 'numeric' })}</span> },
          ]}
        />
        {d ? <Pagination page={d.page} pageCount={Math.ceil(d.total / d.pageSize)} total={d.total} pageSize={d.pageSize} onChange={(p) => set({ page: p === 1 ? null : String(p) })} /> : null}
      </Card>
    </div>
  );
}

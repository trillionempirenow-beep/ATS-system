import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Select, TextInput } from '@/components/ui/Form';
import { EmptyState, ErrorState, Notice, Skeleton } from '@/components/ui/Feedback';
import { surfaceStyles } from '@/components/ui/Surface';
import { usePublicConfig } from '@/app/layouts/PublicLayout';
import { useDebouncedParam, useUrlParams } from '@/lib/urlState';
import { usePublicJobs } from './api';
import { JobCard } from './JobCard';
import s from './Careers.module.css';

const QUICK = ['Remote', 'Manila', 'Hybrid'];

export function RolesPage() {
  const [params, set] = useUrlParams();
  const config = usePublicConfig();
  const filters = {
    q: params.get('q') ?? undefined,
    dept: params.get('dept') ?? undefined,
    loc: params.get('loc') ?? undefined,
    tag: params.get('tag') ?? undefined,
    urgent: params.get('urgent') ?? undefined,
  };
  const [search, setSearch] = useDebouncedParam('q');
  const jobs = usePublicJobs(filters);
  useEffect(() => { document.title = 'Open roles · Careers'; }, []);

  const update = (key: string, value: string | null) => set({ [key]: value });
  const clear = () => { setSearch(''); set(Object.fromEntries([...params.keys()].map((k) => [k, null]))); };

  const accepting = config.data?.acceptingApplications ?? true;
  const data = jobs.data;
  const anyFilter = Boolean(filters.q || filters.dept || filters.loc || filters.tag || filters.urgent);

  return (
    <div className={`${s.container} ${s.containerTight}`}>
      <header className={s.pageHead}>
        <span className={surfaceStyles.eyebrow}>Open roles</span>
        <h1 className={s.displayS}>Find your place here.</h1>
        <p className={s.lead}>
          {!accepting ? 'Applications are closed for now.'
            : data ? `${data.total} open position${data.total === 1 ? '' : 's'} right now. Search the roles where your work can have an outsized impact.`
              : 'Search the roles where your work can have an outsized impact.'}
        </p>
      </header>

      {!accepting ? (
        <Notice tone="warning" title={config.data?.closedMessage || 'We are not accepting applications at the moment.'}>
          Please check back soon. Roles stay visible so you can see what is coming.
        </Notice>
      ) : null}

      <div>
        <div className={s.filters} role="search">
          <div className={s.filterRow}>
            <TextInput icon="search" placeholder="Search jobs, tags, locations…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search roles" />
            <Select aria-label="Department" value={filters.dept ?? ''} onChange={(e) => update('dept', e.target.value || null)} placeholder="All departments"
              options={(data?.facets.departments ?? []).map((d) => ({ value: d, label: d }))} />
            <Select aria-label="Location" value={filters.loc ?? ''} onChange={(e) => update('loc', e.target.value || null)} placeholder="All locations"
              options={(data?.facets.locations ?? []).map((l) => ({ value: l, label: l }))} />
          </div>
          <div className={s.chips} role="group" aria-label="Quick filters">
            {QUICK.map((q) => {
              const active = filters.loc === q;
              return <button key={q} type="button" className={surfaceStyles.pill} aria-pressed={active} onClick={() => update('loc', active ? null : q)}>{q}</button>;
            })}
            <button type="button" className={surfaceStyles.pill} aria-pressed={filters.urgent === '1'} onClick={() => update('urgent', filters.urgent === '1' ? null : '1')}>Urgent hiring</button>
            {filters.tag ? <button type="button" className={surfaceStyles.pill} aria-pressed onClick={() => update('tag', null)}>#{filters.tag} ×</button> : null}
          </div>
        </div>

        {data && data.jobs.length > 0 ? (
          <div className={s.resultMeta}>
            <span className="num">{data.jobs.length} of {data.total} roles</span>
            {anyFilter ? <Button size="sm" variant="ghost" onClick={clear}>Clear filters</Button> : null}
          </div>
        ) : <div style={{ height: 20 }} />}

        {jobs.isLoading ? <div className={s.grid}>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={208} radius={14} />)}</div> : null}
        {jobs.isError ? <ErrorState onRetry={() => void jobs.refetch()} /> : null}
        {data && data.jobs.length === 0 && data.total > 0 ? (
          <EmptyState icon="search" title="No roles match your search" text="Try a different keyword, or clear the filters to see every open role."
            actions={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
        ) : null}
        {data && data.total === 0 ? (
          <EmptyState icon="briefcase" title="No open roles right now." text="New opportunities will appear here when the recruiting team publishes them." />
        ) : null}
        {data && data.jobs.length > 0 ? <div className={s.grid}>{data.jobs.map((j) => <JobCard key={j.id} job={j} />)}</div> : null}
      </div>
    </div>
  );
}

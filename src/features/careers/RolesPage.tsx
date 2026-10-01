import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Select, TextInput } from '@/components/ui/Form';
import { EmptyState, ErrorState, Notice } from '@/components/ui/Feedback';
import { surfaceStyles } from '@/components/ui/Surface';
import { usePublicConfig } from '@/app/layouts/PublicLayout';
import { useDebouncedParam, useUrlParams } from '@/lib/urlState';
import { usePublicJobs } from './api';
import { RoleList, RoleListSkeleton } from './RoleList';
import s from './Careers.module.css';

const QUICK = ['Remote', 'Manila', 'Hybrid'];

/** Search, filters and the role list. The filters live in the URL, so a filtered list can be shared. */
export function RoleBoard({ headingId }: { headingId?: string }) {
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
  const update = (key: string, value: string | null) => set({ [key]: value });
  const clear = () => { setSearch(''); set({ q: null, dept: null, loc: null, tag: null, urgent: null }); };

  const accepting = config.data?.acceptingApplications ?? true;
  const data = jobs.data;
  const anyFilter = Boolean(filters.q || filters.dept || filters.loc || filters.tag || filters.urgent);

  return (
    <div className={s.boardWrap}>
      {!accepting ? (
        <Notice tone="warning" title={config.data?.closedMessage || 'We are not accepting applications at the moment.'}>
          Roles stay listed so you can see what is open. Check back soon to apply.
        </Notice>
      ) : null}
      <div className={s.filters} role="search" aria-labelledby={headingId}>
        <div className={s.filterSearch}>
          <TextInput icon="search" placeholder="Search by title, skill or location" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search roles" />
        </div>
        <Select aria-label="Team" value={filters.dept ?? ''} onChange={(e) => update('dept', e.target.value || null)} placeholder="All teams"
          options={(data?.facets.departments ?? []).map((d) => ({ value: d, label: d }))} />
        <Select aria-label="Location" value={filters.loc ?? ''} onChange={(e) => update('loc', e.target.value || null)} placeholder="All locations"
          options={(data?.facets.locations ?? []).map((l) => ({ value: l, label: l }))} />
      </div>
      <div className={s.filterFoot}>
        <div className={surfaceStyles.pills} role="group" aria-label="Quick filters">
          {QUICK.map((q) => {
            const active = filters.loc === q;
            return <button key={q} type="button" className={surfaceStyles.pill} aria-pressed={active} onClick={() => update('loc', active ? null : q)}>{q}</button>;
          })}
          <button type="button" className={surfaceStyles.pill} aria-pressed={filters.urgent === '1'} onClick={() => update('urgent', filters.urgent === '1' ? null : '1')}>Hiring urgently</button>
          {filters.tag ? <button type="button" className={surfaceStyles.pill} aria-pressed onClick={() => update('tag', null)} aria-label={`Remove skill filter ${filters.tag}`}>Skill: {filters.tag}</button> : null}
        </div>
        <span className={s.resultCount} aria-live="polite">
          {data ? (anyFilter ? `${data.jobs.length} of ${data.total} roles` : `${data.total} ${data.total === 1 ? 'role' : 'roles'}`) : ''}
          {anyFilter ? <Button size="sm" variant="ghost" onClick={clear}>Clear filters</Button> : null}
        </span>
      </div>

      {jobs.isLoading ? <RoleListSkeleton /> : null}
      {jobs.isError ? <div className={s.board}><ErrorState onRetry={() => void jobs.refetch()} /></div> : null}
      {data && data.jobs.length === 0 && data.total > 0 ? (
        <div className={s.board}>
          <EmptyState icon="search" title="No roles match these filters" text="Try another keyword or location, or clear the filters to see every open role."
            actions={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
        </div>
      ) : null}
      {data && data.total === 0 ? (
        <div className={s.board}>
          <EmptyState icon="briefcase" title="No roles are open right now" text="New roles appear here as soon as the hiring team publishes them. If you already applied, you can still check your application." />
        </div>
      ) : null}
      {data && data.jobs.length > 0 ? <RoleList jobs={data.jobs} grouped={!filters.dept} /> : null}
    </div>
  );
}

export function RolesPage() {
  const config = usePublicConfig();
  const company = config.data?.companyName ?? 'Acme';
  useEffect(() => { document.title = `Open roles · ${company} careers`; }, [company]);
  return (
    <div className={s.container}>
      <header className={s.intro}>
        <h1 id="roles-title" className={s.title}>Open roles</h1>
        <p className={s.lead}>Every role {company} is hiring for. Pick one to read the full posting and apply with your CV.</p>
      </header>
      <RoleBoard headingId="roles-title" />
    </div>
  );
}

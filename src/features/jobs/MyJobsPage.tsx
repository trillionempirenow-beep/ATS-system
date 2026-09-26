import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { JobRowDto } from '@shared/api/jobs';
import { ButtonLink } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Display';
import { EmptyState } from '@/components/ui/Feedback';
import { Card, CardHeader, DataTable, PageHeader, StatCard, StatGrid, type Column } from '@/components/ui/Surface';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { useMyJobs } from './api';
import { ApplicantsCell, RoleCell } from './JobCells';
import w from '../workspace.module.css';
import s from './Jobs.module.css';

export function MyJobsPage() {
  const q = useMyJobs();
  const navigate = useNavigate();
  useEffect(() => { document.title = 'My jobs · Acme People'; }, []);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;

  const action = (j: JobRowDto) => {
    if (j.state === 'published') return <ButtonLink size="sm" variant="ghost" icon="external" to={`/jobs/${j.slug}`} target="_blank" rel="noopener noreferrer">View live</ButtonLink>;
    if (j.state === 'pending') return <span className={w.faint}>With an Admin for review</span>;
    if (j.canEdit) return <ButtonLink size="sm" variant="secondary" icon="edit" to={`/app/jobs/${j.id}/edit`}>Edit</ButtonLink>;
    return <span className={w.faint}>—</span>;
  };

  const columns: Column<JobRowDto>[] = [
    { key: 'role', header: 'Role', cell: (j) => <RoleCell job={j} />, primary: true },
    { key: 'dept', header: 'Department', cell: (j) => j.department ?? '—', label: 'Department' },
    { key: 'apps', header: 'Applicants', cell: (j) => <ApplicantsCell job={j} />, label: 'Applicants' },
    {
      key: 'status', header: 'Status', label: 'Status',
      cell: (j) => (
        <div className={s.statusCell}>
          <StatusBadge kind="job" value={j.state} size="sm" />
          {j.reviewNote && (j.state === 'changes_requested' || j.state === 'rejected') ? <span className={s.reviewNote}>“{j.reviewNote}”</span> : null}
        </div>
      ),
    },
    { key: 'actions', header: 'Actions', cell: action, align: 'right' },
  ];

  const attention = (d?.byState.changes_requested ?? 0) + (d?.byState.rejected ?? 0);
  const create = d?.canPost ? <ButtonLink icon="plus" to="/app/jobs/new">Create job posting</ButtonLink> : null;

  return (
    <div className={w.page}>
      <PageHeader title="My job postings" description="Drafts stay private to you. Once submitted, an Admin decides whether a posting goes live."
        crumbs={[{ label: 'Jobs' }, { label: 'My jobs' }]} actions={create} />
      {d && d.jobs.length === 0 ? (
        <Card><EmptyState icon="briefcase" title="No job postings yet" text="Drafts stay private to you until you submit them for approval." actions={create} /></Card>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="briefcase" label="Total postings" value={d?.jobs.length ?? 0} loading={!d} />
            <StatCard icon="clock" label="Pending approval" value={d?.byState.pending ?? 0} loading={!d} />
            <StatCard icon="public" label="Published" value={d?.byState.published ?? 0} loading={!d} />
            <StatCard icon="alert" label="Needs your attention" value={attention} loading={!d} />
          </StatGrid>
          <Card padding={0}>
            <div className={s.tableHead}><CardHeader title="All of your postings" subtitle="Newest first" /></div>
            <DataTable columns={columns} rows={d?.jobs ?? []} rowKey={(j) => j.id} loading={!d} caption="My job postings"
              onRowClick={(j) => { if (j.canEdit) navigate(`/app/jobs/${j.id}/edit`); }} />
          </Card>
        </>
      )}
    </div>
  );
}

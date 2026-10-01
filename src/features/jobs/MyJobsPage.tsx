import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { JobRowDto } from '@shared/api/jobs';
import { ButtonLink } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Display';
import { EmptyState } from '@/components/ui/Feedback';
import { Card, CardHeader, DataTable, PageHeader, StatCard, StatGrid, type Column } from '@/components/ui/Surface';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { useMyJobs } from './api';
import { ApplicantsCell, CreatorCell, RoleCell } from './JobCells';
import w from '../workspace.module.css';
import s from './Jobs.module.css';

export function MyJobsPage() {
  const q = useMyJobs();
  const navigate = useNavigate();
  useEffect(() => { document.title = 'Job postings · Acme People'; }, []);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;

  const action = (j: JobRowDto) => {
    if (j.state === 'published') return <ButtonLink size="sm" variant="ghost" icon="external" to={`/jobs/${j.slug}`} target="_blank" rel="noopener noreferrer">View live</ButtonLink>;
    if (j.state === 'pending') return <span className={w.faint}>With an Admin for review</span>;
    if (!j.mine) return <span className={w.faint}>—</span>;
    if (j.canEdit) return <ButtonLink size="sm" variant="secondary" icon="edit" to={`/app/jobs/${j.id}/edit`}>Edit</ButtonLink>;
    return <span className={w.faint}>—</span>;
  };

  const columns: Column<JobRowDto>[] = [
    { key: 'role', header: 'Role', cell: (j) => <RoleCell job={j} />, primary: true },
    { key: 'dept', header: 'Department', cell: (j) => j.department ?? '—', label: 'Department' },
    { key: 'apps', header: 'Applicants', cell: (j) => <ApplicantsCell job={j} />, label: 'Applicants' },
    { key: 'creator', header: 'Created by', cell: (j) => <CreatorCell job={j} />, label: 'Created by' },
    {
      key: 'status', header: 'Status', label: 'Status',
      cell: (j) => (
        <div className={s.statusCell}>
          <StatusBadge kind="job" value={j.state} size="sm" />
          {j.reviewNote && (j.state === 'changes_requested' || j.state === 'rejected') ? <span className={s.reviewNote}>“{j.reviewNote}”</span> : null}
        </div>
      ),
    },
    {
      key: 'actions', header: 'Actions', align: 'right',
      cell: (j) => <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{action(j)}</div>,
    },
  ];

  const attention = (d?.byState.changes_requested ?? 0) + (d?.byState.rejected ?? 0);
  const create = d?.canPost ? <ButtonLink icon="plus" to="/app/jobs/new">Create job posting</ButtonLink> : null;

  return (
    <div className={w.page}>
      <PageHeader title="Job postings" description="Every posting in the workspace. Your drafts stay private to you until you submit them for approval."
        crumbs={[{ label: 'Jobs' }, { label: 'Job postings' }]} actions={create} />
      {d && d.jobs.length === 0 ? (
        <Card><EmptyState icon="briefcase" title="No job postings yet" text="Drafts stay private to you until you submit them for approval." actions={create} /></Card>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="briefcase" label="All postings" value={d?.jobs.length ?? 0} loading={!d} />
            <StatCard icon="clock" label="Yours pending approval" value={d?.byState.pending ?? 0} loading={!d} />
            <StatCard icon="public" label="Yours published" value={d?.byState.published ?? 0} loading={!d} />
            <StatCard icon="alert" label="Needs your attention" value={attention} loading={!d} />
          </StatGrid>
          <Card padding={0}>
            <div className={s.tableHead}><CardHeader title="All postings" subtitle="Newest first · open one for details and matching applicants" /></div>
            <DataTable columns={columns} rows={d?.jobs ?? []} rowKey={(j) => j.id} loading={!d} caption="Job postings"
              onRowClick={(j) => navigate(`/app/jobs/${j.id}`)} />
          </Card>
        </>
      )}
    </div>
  );
}

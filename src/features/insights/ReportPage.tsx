import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReportDto, TeamRow } from '@shared/api/insights';
import { ROLE_LABELS } from '@shared/domain/access';
import { ButtonLink } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Display';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { Card, CardHeader, DataTable, PageHeader, StatCard, StatGrid, type Column } from '@/components/ui/Surface';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { api, qs } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { RangeBar, useRangeParams } from './RangeBar';
import w from '../workspace.module.css';
import s from './Insights.module.css';

export function ReportPage() {
  const [params, update] = useRangeParams();
  const query = qs({ range: params.range, from: params.from, to: params.to, user: params.user });
  const q = useQuery({ queryKey: ['analytics-report', params], queryFn: () => api.get<ReportDto>(`/analytics/report${query}`), placeholderData: (prev) => prev });
  useEffect(() => { document.title = 'HR / Recruiter report · Acme People'; }, []);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const csv = <ButtonLink variant="secondary" icon="download" to={`/api/v1/analytics/report.csv${query}`} reloadDocument>Export CSV</ButtonLink>;

  const columns: Column<TeamRow>[] = [
    {
      key: 'who', header: 'HR / Recruiter', primary: true,
      cell: (r) => (
        <span className={w.person}>
          <Avatar name={r.user.name} size={30} />
          <span className={w.personText}><span className={w.personName}>{r.user.name}</span><span className={w.personSub}>{ROLE_LABELS[r.user.role]}</span></span>
        </span>
      ),
    },
    { key: 'c', header: 'Candidates', cell: (r) => r.candidates, align: 'right', label: 'Candidates' },
    { key: 'p', header: 'Processing', cell: (r) => r.processing, align: 'right', label: 'Processing' },
    { key: 'i', header: 'Interviews', cell: (r) => r.interviews, align: 'right', label: 'Interviews' },
    { key: 'd', header: 'Completed', cell: (r) => r.completed, align: 'right', label: 'Completed' },
    { key: 'h', header: 'Hired', cell: (r) => r.hired, align: 'right', label: 'Hired' },
    { key: 'r', header: 'Rejected', cell: (r) => r.rejected, align: 'right', label: 'Rejected' },
    { key: 's', header: 'Avg. score', cell: (r) => r.avgScore ?? '—', align: 'right', label: 'Avg. score' },
  ];

  return (
    <div className={w.page}>
      <PageHeader title="HR / Recruiter report"
        description={d ? `Reporting period: ${d.range.label} · generated ${formatDate(new Date().toISOString())}` : undefined}
        crumbs={[{ label: 'Recruiting' }, { label: 'Analytics', to: '/app/analytics' }, { label: 'Report' }]}
        actions={<><ButtonLink variant="secondary" to="/app/analytics">Back to analytics</ButtonLink>{csv}</>} />
      <Card><RangeBar value={params} onApply={(v) => update(v)} /></Card>
      {!d ? <Skeleton height={320} /> : d.allMembers.length === 0 ? (
        <Card><EmptyState icon="users" title="Nothing to report" text="There are no HR / Recruiters under your account yet, so there is no workload to summarise."
          actions={<ButtonLink to="/app/admin/users">Create HR / Recruiter</ButtonLink>} /></Card>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="candidates" label="Candidate workload" value={d.totals.candidates} />
            <StatCard icon="interviews" label="Interview workload" value={d.totals.interviews} />
            <StatCard icon="checkcircle" label="Hires" value={d.totals.hired} />
            <StatCard icon="pipeline" label="Still in pipeline" value={d.totals.processing} />
          </StatGrid>
          <Card padding={0}>
            <div className={s.tableHead}><CardHeader title="Per person" /></div>
            <DataTable columns={columns} rows={d.rows} rowKey={(r) => r.user.id} caption="Per person" />
          </Card>
        </>
      )}
    </div>
  );
}

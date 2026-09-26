import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ApprovalQueueDto } from '@shared/api/jobs';
import { ButtonLink } from '@/components/ui/Button';
import { Avatar, Badge, StatusBadge } from '@/components/ui/Display';
import { EmptyState } from '@/components/ui/Feedback';
import { Card, CardHeader, DataTable, PageHeader, type Column } from '@/components/ui/Surface';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { formatDate } from '@/lib/format';
import { useApprovalQueue } from './api';
import w from '../workspace.module.css';
import s from './Jobs.module.css';

type Queued = ApprovalQueueDto['queue'][number];
type Decided = ApprovalQueueDto['decided'][number];

function Person({ name }: { name: string | null }) {
  if (!name) return <span className={w.faint}>Former user</span>;
  return <span className={w.person}><Avatar name={name} size={28} /><span className={w.personName}>{name}</span></span>;
}

export function ApprovalsPage() {
  const q = useApprovalQueue();
  const navigate = useNavigate();
  useEffect(() => { document.title = 'Job approvals · Acme People'; }, []);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;

  const queueCols: Column<Queued>[] = [
    {
      key: 'role', header: 'Role', primary: true,
      cell: (j) => (
        <div className={s.role}>
          <span className={s.roleTitle}>{j.title}</span>
          <span className={s.tags}><span className={s.tag}>{j.department ?? 'No department'}</span></span>
        </div>
      ),
    },
    { key: 'by', header: 'Created by', cell: (j) => <Person name={j.submitterName ?? j.creatorName} />, label: 'Created by' },
    { key: 'submitted', header: 'Submitted', cell: (j) => formatDate(j.submittedAt ?? j.createdAt), label: 'Submitted' },
    { key: 'limit', header: 'Applicant limit', cell: (j) => j.applicantLimit ?? 'Unlimited', label: 'Applicant limit' },
    { key: 'review', header: <span className="sr-only">Review</span>, align: 'right', cell: (j) => <ButtonLink size="sm" to={`/app/jobs/approvals/${j.id}`}>Review</ButtonLink> },
  ];
  const decidedCols: Column<Decided>[] = [
    { key: 'role', header: 'Role', cell: (j) => j.title, primary: true },
    { key: 'reviewer', header: 'Reviewer', cell: (j) => <Person name={j.reviewerName} />, label: 'Reviewer' },
    { key: 'when', header: 'When', cell: (j) => formatDate(j.reviewedAt), label: 'When' },
    { key: 'outcome', header: 'Outcome', cell: (j) => <StatusBadge kind="job" value={j.state} size="sm" />, label: 'Outcome' },
  ];

  return (
    <div className={w.page}>
      <PageHeader title="Job posting approvals" description="Nothing an HR / Recruiter writes reaches the careers site until it passes through here."
        crumbs={[{ label: 'Jobs' }, { label: 'Job approvals' }]} />
      <Card padding={0}>
        <div className={s.tableHead}>
          <CardHeader title="Waiting for review" actions={d ? <Badge tone={d.queue.length ? 'warning' : 'neutral'}>{d.queue.length} posting{d.queue.length === 1 ? '' : 's'}</Badge> : null} />
        </div>
        <DataTable columns={queueCols} rows={d?.queue ?? []} rowKey={(j) => j.id} loading={!d} caption="Postings waiting for review"
          onRowClick={(j) => navigate(`/app/jobs/approvals/${j.id}`)}
          empty={<EmptyState compact icon="checkcircle" title="Nothing is waiting for approval right now." text="New postings from HR / Recruiters will appear here for review." />} />
      </Card>
      <Card padding={0}>
        <div className={s.tableHead}><CardHeader title="Recently decided" /></div>
        <DataTable columns={decidedCols} rows={d?.decided ?? []} rowKey={(j) => j.id} loading={!d} caption="Recently decided postings"
          empty={<EmptyState compact icon="layers" title="No decisions yet" />} />
      </Card>
    </div>
  );
}

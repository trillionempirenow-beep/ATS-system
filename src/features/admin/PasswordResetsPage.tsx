import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PasswordResetRowDto, PasswordResetsDto, ResetDecisionResultDto } from '@shared/api/admin';
import { ROLE_LABELS } from '@shared/domain/access';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge } from '@/components/ui/Display';
import { Field, TextInput } from '@/components/ui/Form';
import { EmptyState, Notice, Skeleton } from '@/components/ui/Feedback';
import { Card, CardHeader, DataTable, PageHeader, type Column } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { api, errorMessage } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { adminKeys, useAdminMutation } from './api';
import w from '../workspace.module.css';
import s from './Admin.module.css';

const OUTCOME_TONES = { approved: 'success', rejected: 'danger', used: 'info', expired: 'neutral', pending: 'warning' } as const;
const OUTCOME_LABELS = { approved: 'Approved', rejected: 'Rejected', used: 'Used', expired: 'Expired', pending: 'Pending' } as const;

function PendingRequest({ r, onIssued }: { r: PasswordResetRowDto; onIssued: (name: string, result: ResetDecisionResultDto) => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const decide = useAdminMutation((decision: 'approved' | 'rejected') => api.post<ResetDecisionResultDto>(`/password-resets/${r.id}/decision`, { decision, note: note.trim() }));
  const run = (decision: 'approved' | 'rejected') => decide.mutate(decision, {
    onSuccess: (res) => {
      if (res.status === 'approved') onIssued(r.accountName, res);
      else toast.success(`Request from ${r.accountName} rejected.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <article className={s.resetCard}>
      <div className={w.rowBetween}>
        <span className={w.person}>
          <Avatar name={r.accountName} size={36} />
          <span className={w.personText}><span className={w.personName}>{r.accountName}</span><span className={w.personSub}>{r.accountEmail} · {ROLE_LABELS[r.accountRole]}</span></span>
        </span>
        <span className={w.faint}>{timeAgo(r.createdAt)}</span>
      </div>
      {r.reason ? <p className={s.quote}>“{r.reason}”</p> : null}
      <div className={s.resetActions}>
        <Field label="Note" optional><TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} inputSize="sm" /></Field>
        <Button size="sm" loading={decide.isPending && decide.variables === 'approved'} disabled={decide.isPending} onClick={() => run('approved')}>Approve</Button>
        <Button size="sm" variant="dangerGhost" loading={decide.isPending && decide.variables === 'rejected'} disabled={decide.isPending} onClick={() => run('rejected')}>Reject</Button>
      </div>
    </article>
  );
}

export function PasswordResetsPage() {
  const q = useQuery({ queryKey: adminKeys.resets, queryFn: () => api.get<PasswordResetsDto>('/password-resets') });
  const toast = useToast();
  const [issued, setIssued] = useState<{ name: string; result: ResetDecisionResultDto } | null>(null);
  useEffect(() => { document.title = 'Password resets · Acme People'; }, []);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;

  const columns: Column<PasswordResetRowDto>[] = [
    { key: 'who', header: 'Account', cell: (r) => <span className={w.person}><Avatar name={r.accountName} size={28} /><span className={w.personName}>{r.accountName}</span></span>, primary: true },
    { key: 'role', header: 'Role', cell: (r) => ROLE_LABELS[r.accountRole], label: 'Role' },
    { key: 'outcome', header: 'Outcome', cell: (r) => <Badge tone={OUTCOME_TONES[r.status]} size="sm">{OUTCOME_LABELS[r.status]}</Badge>, label: 'Outcome' },
    { key: 'by', header: 'Decided by', cell: (r) => r.decidedBy ?? '—', label: 'Decided by' },
    { key: 'when', header: 'When', cell: (r) => formatDate(r.decidedAt, { month: 'short', day: 'numeric' }), label: 'When' },
  ];

  const copy = () => {
    if (!issued?.result.resetLink) return;
    void navigator.clipboard.writeText(issued.result.resetLink).then(() => toast.success('Link copied.'), () => toast.error('Copy failed. Select the link and copy it by hand.'));
  };

  return (
    <div className={w.page}>
      <PageHeader title="Password reset requests" description="Approve a request to issue a one-time reset link. Applicants never need one."
        crumbs={[{ label: 'Administration' }, { label: 'Password resets' }]} />
      {issued?.result.resetLink ? (
        <Notice tone="success" title={`One-time reset link for ${issued.name}`}
          action={<Button size="sm" icon="copy" onClick={copy}>Copy link</Button>}>
          {issued.result.email === 'sent' ? 'It was also emailed to them. ' : 'Copy it and send it to the person directly. '}
          It works once{issued.result.expiresInHours ? ` and expires in ${issued.result.expiresInHours} hours` : ''}. It is shown only now.
          <code className={s.link}>{issued.result.resetLink}</code>
        </Notice>
      ) : null}
      <Card>
        <CardHeader title="Waiting for a decision" actions={d ? <Badge tone={d.pending.length ? 'warning' : 'neutral'}>{d.pending.length} pending</Badge> : null} />
        {!d ? <Skeleton height={160} /> : d.pending.length === 0 ? (
          <EmptyState compact icon="key" title="No password reset requests are waiting." text="Requests from staff who cannot sign in appear here for a decision." />
        ) : (
          <div className={w.stack}>{d.pending.map((r) => <PendingRequest key={r.id} r={r} onIssued={(name, result) => setIssued({ name, result })} />)}</div>
        )}
        {d ? <p className={w.faint} style={{ marginTop: 12 }}>Approved links stay valid for {d.windowHours} hours.</p> : null}
      </Card>
      <Card padding={0}>
        <div className={s.tableHead}><CardHeader title="Recent decisions" /></div>
        <DataTable columns={columns} rows={d?.decided ?? []} rowKey={(r) => r.id} loading={!d} caption="Recent decisions"
          empty={<EmptyState compact icon="layers" title="No decisions yet" />} />
      </Card>
    </div>
  );
}

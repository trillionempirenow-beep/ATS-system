import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AccountDto, AdminsOverviewDto } from '@shared/api/admin';
import { ADMIN_GRANTABLE_PERMISSIONS, ADMIN_PERMISSION_CATALOG, type PermissionKey } from '@shared/domain/access';
import { JOB_APPROVAL_ACTION_LABELS, type JobApprovalAction } from '@shared/domain/jobs';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Avatar, StatusBadge } from '@/components/ui/Display';
import { Checkbox, Field, TextInput, formStyles } from '@/components/ui/Form';
import { EmptyState, Notice, Skeleton } from '@/components/ui/Feedback';
import { Card, CardHeader, PageHeader, StatCard, StatGrid } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { ApiError, api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog';
import { adminKeys, useAdminMutation } from './api';
import w from '../workspace.module.css';
import s from './Admin.module.css';

function AdminCard({ admin, onConfirm }: { admin: AccountDto; onConfirm: (r: ConfirmRequest) => void }) {
  const toast = useToast();
  const [perms, setPerms] = useState<Set<PermissionKey>>(new Set(admin.permissions));
  const [limit, setLimit] = useState(String(admin.hrAccountLimit));
  useEffect(() => { setPerms(new Set(admin.permissions)); setLimit(String(admin.hrAccountLimit)); }, [admin.permissions, admin.hrAccountLimit]);
  const savePerms = useAdminMutation((input: { hrAccountLimit: number; permissions: PermissionKey[] }) => api.put(`/admin/admins/${admin.id}/permissions`, input));
  const setStatus = useAdminMutation((input: { status: string; note: string }) => api.patch(`/admin/admins/${admin.id}/status`, input));
  const n = Number(limit);
  const limitOk = limit.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 999;
  const dirty = limitOk && (n !== admin.hrAccountLimit || perms.size !== admin.permissions.length || admin.permissions.some((p) => !perms.has(p)));
  const available = Math.max(0, admin.hrAccountLimit - admin.seatsUsed);

  const confirmSave = () => onConfirm({
    title: `Save permissions for ${admin.name}?`,
    confirmLabel: 'Save permissions',
    body: (
      <ul className={s.confirmList}>
        {ADMIN_GRANTABLE_PERMISSIONS.map((k) => <li key={k}>{ADMIN_PERMISSION_CATALOG[k].label}: <b>{perms.has(k) ? 'on' : 'off'}</b></li>)}
        <li>HR / Recruiter seat limit: <b>{n}</b>{n < admin.seatsUsed ? ` (below the ${admin.seatsUsed} seats in use; no one loses access, but no new accounts can be added)` : ''}</li>
      </ul>
    ),
    run: async () => {
      await savePerms.mutateAsync({ hrAccountLimit: n, permissions: ADMIN_GRANTABLE_PERMISSIONS.filter((k) => perms.has(k)) });
      toast.success(`Permissions saved for ${admin.name}.`);
    },
  });

  const confirmStatus = (status: 'active' | 'suspended' | 'disabled') => onConfirm({
    title: status === 'active' ? `Reactivate ${admin.name}?` : `${status === 'suspended' ? 'Suspend' : 'Disable'} ${admin.name}?`,
    confirmLabel: status === 'active' ? 'Reactivate' : status === 'suspended' ? 'Suspend' : 'Disable',
    danger: status !== 'active',
    body: status === 'active' ? 'They can sign in again straight away.' : 'They are signed out everywhere and cannot sign in. Their HR / Recruiters keep working.',
    note: status === 'active' ? undefined : { label: 'Reason' },
    run: async (note) => {
      await setStatus.mutateAsync({ status, note });
      toast.success(`${admin.name} is now ${status === 'active' ? 'active' : status}.`);
    },
  });

  return (
    <article className={s.adminCard}>
      <header className={s.adminHead}>
        <span className={w.person}>
          <Avatar name={admin.name} src={admin.avatarUrl} size={40} />
          <span className={w.personText}><span className={w.personName}>{admin.name}</span><span className={w.personSub}>{admin.email}</span></span>
        </span>
        <span className={s.adminStatus}>
          <StatusBadge kind="account" value={admin.accountStatus} size="sm" />
          {admin.accountStatus === 'active' ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => confirmStatus('suspended')}>Suspend</Button>
              <Button size="sm" variant="dangerGhost" onClick={() => confirmStatus('disabled')}>Disable</Button>
            </>
          ) : admin.accountStatus === 'suspended' || admin.accountStatus === 'disabled' ? (
            <Button size="sm" variant="secondary" onClick={() => confirmStatus('active')}>Reactivate</Button>
          ) : null}
        </span>
      </header>
      {admin.statusNote && admin.accountStatus !== 'active' ? <Notice tone="warning">{admin.statusNote}</Notice> : null}
      <div className={s.permGrid}>
        {ADMIN_GRANTABLE_PERMISSIONS.map((k) => (
          <Checkbox key={k} checked={perms.has(k)} label={ADMIN_PERMISSION_CATALOG[k].label} description={ADMIN_PERMISSION_CATALOG[k].description}
            onChange={(e) => setPerms((cur) => { const next = new Set(cur); if (e.target.checked) next.add(k); else next.delete(k); return next; })} />
        ))}
      </div>
      <div className={s.seatRow}>
        <div className={s.seatInfo}>
          <span className={w.overline}>HR / Recruiter seat limit</span>
          <strong className="num">{admin.seatsUsed} / {admin.hrAccountLimit}</strong>
          <span className={w.faint}>{available} seat{available === 1 ? '' : 's'} available</span>
        </div>
        <Field label="Seat limit" hint="How many HR / Recruiter accounts this Admin may hold at once." error={limitOk ? undefined : 'Use a whole number from 0 to 999.'}>
          <TextInput type="number" min={0} max={999} value={limit} onChange={(e) => setLimit(e.target.value)} inputSize="sm" />
        </Field>
      </div>
      <footer className={s.adminFoot}>
        <span className={w.faint}>Changes are confirmed before they save.</span>
        <Button size="sm" disabled={!dirty} onClick={confirmSave}>Save permissions</Button>
      </footer>
    </article>
  );
}

function CreateAdmin() {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [limit, setLimit] = useState('3');
  const [perms, setPerms] = useState<Set<PermissionKey>>(new Set(['job_management', 'job_posting']));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useAdminMutation(() => api.post('/admin/admins', {
    name: name.trim(), email: email.trim(), password, hrAccountLimit: Number(limit) || 0, permissions: ADMIN_GRANTABLE_PERMISSIONS.filter((k) => perms.has(k)),
  }));
  const submit = () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Name is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'That email address is not valid.';
    if (password.length < 8) next.password = 'The temporary password must be at least 8 characters.';
    if (!/^\d{1,3}$/.test(limit)) next.hrAccountLimit = 'Use a whole number from 0 to 999.';
    setErrors(next);
    if (Object.keys(next).length) return;
    create.mutate(undefined, {
      onSuccess: () => { toast.success(`${name.trim()} can now sign in with the temporary password.`, 'Admin created'); setName(''); setEmail(''); setPassword(''); },
      onError: (e) => setErrors(e instanceof ApiError && Object.keys(e.fields).length ? e.fields : { form: errorMessage(e) }),
    });
  };
  return (
    <Card>
      <CardHeader title="Create an Admin" subtitle="They sign in with the temporary password and choose their own." />
      <div className={formStyles.stack}>
        {errors.form ? <Notice tone="danger">{errors.form}</Notice> : null}
        <Field label="Full name" required error={errors.name}><TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
        <Field label="Email" required error={errors.email}><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Field>
        <Field label="Temporary password" required hint="At least 8 characters" error={errors.password}><TextInput type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="HR / Recruiter seat limit" hint="How many HR / Recruiter accounts this Admin may hold at once." error={errors.hrAccountLimit}>
          <TextInput type="number" min={0} max={999} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <fieldset className={s.fieldset}>
          <legend>Starting permissions</legend>
          {ADMIN_GRANTABLE_PERMISSIONS.map((k) => (
            <Checkbox key={k} checked={perms.has(k)} label={ADMIN_PERMISSION_CATALOG[k].label}
              onChange={(e) => setPerms((cur) => { const next = new Set(cur); if (e.target.checked) next.add(k); else next.delete(k); return next; })} />
          ))}
        </fieldset>
        <Button onClick={submit} loading={create.isPending}>Create Admin account</Button>
      </div>
    </Card>
  );
}

const activityVerb = (a: string) => (a in JOB_APPROVAL_ACTION_LABELS ? JOB_APPROVAL_ACTION_LABELS[a as JobApprovalAction].toLowerCase() : a.replace(/_/g, ' '));

export function AdminsPage() {
  const q = useQuery({ queryKey: adminKeys.admins, queryFn: () => api.get<AdminsOverviewDto>('/admin/admins') });
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  useEffect(() => { document.title = 'Admins and permissions · Acme People'; }, []);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const jobs = d?.stats.jobs ?? {};
  const waiting = (d?.stats.pendingAccounts ?? 0) + (d?.stats.pendingReactivations ?? 0);

  return (
    <div className={w.page}>
      <PageHeader title="Admins and permissions" description="Delegate hiring work to Admins, and decide what they can grant on."
        crumbs={[{ label: 'Administration' }, { label: 'Admins' }]}
        actions={<>
          <ButtonLink variant="secondary" to="/app/admin/audit">Audit trail</ButtonLink>
          <ButtonLink to="/app/admin/users">Open HR / Recruiters</ButtonLink>
        </>} />
      <StatGrid>
        <StatCard icon="users" label="Admins" value={d?.admins.length ?? 0} loading={!d} />
        <StatCard icon="candidates" label="HR / Recruiters" value={d?.stats.seatsUsed ?? 0} loading={!d} />
        <StatCard icon="limit" label="Seats used" value={d ? `${d.stats.seatsUsed} / ${d.stats.seatsTotal}` : '—'} loading={!d} />
        <StatCard icon="alert" label="Decisions waiting" value={waiting} loading={!d} hint={waiting ? 'Needs you' : undefined} />
      </StatGrid>
      {waiting ? (
        <Notice tone="warning" title={`${waiting} decision${waiting === 1 ? '' : 's'} waiting`} action={<ButtonLink size="sm" to="/app/admin/users?status=pending">Review accounts</ButtonLink>}>
          {d?.stats.pendingAccounts ? `${d.stats.pendingAccounts} new HR / Recruiter account${d.stats.pendingAccounts === 1 ? '' : 's'} to approve. ` : ''}
          {d?.stats.pendingReactivations ? `${d.stats.pendingReactivations} reactivation request${d.stats.pendingReactivations === 1 ? '' : 's'}.` : ''}
        </Notice>
      ) : null}
      <div className={w.cols21}>
        <div className={w.stack}>
          <Card>
            <CardHeader title="Admin permissions" subtitle="Changes are confirmed before they save." />
            {!d ? <Skeleton height={320} /> : d.admins.length === 0 ? (
              <EmptyState icon="users" title="No Admin accounts yet" text="There are no Admin accounts yet. Create one to start delegating recruiter accounts." />
            ) : (
              <div className={w.stack}>{d.admins.map((a) => <AdminCard key={a.id} admin={a} onConfirm={setConfirm} />)}</div>
            )}
          </Card>
          <Card>
            <CardHeader title="Job approval activity" subtitle="Across all Admins" />
            <div className={s.jobStats}>
              <div><strong className="num">{jobs.pending ?? 0}</strong><span>Pending approval</span></div>
              <div><strong className="num">{jobs.approved ?? 0}</strong><span>Approved, not yet published</span></div>
              <div><strong className="num">{jobs.rejected ?? 0}</strong><span>Rejected</span></div>
              <div><strong className="num">{jobs.published ?? 0}</strong><span>Published</span></div>
            </div>
            {d?.recentActivity.length ? (
              <ul className={w.list} style={{ marginTop: 16 }}>
                {d.recentActivity.map((a) => (
                  <li key={a.id} className={w.listItem}>
                    <span>{a.actorName ?? 'Someone'} {activityVerb(a.action)} “{a.jobTitle}”{a.note ? <span className={w.faint}> · {a.note}</span> : null}</span>
                    <span className={w.faint}>{timeAgo(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className={w.faint} style={{ marginTop: 12 }}>No approval activity yet.</p>}
          </Card>
        </div>
        <div className={w.stack}>
          <CreateAdmin />
          <Card>
            <CardHeader title="All accounts" subtitle="Every HR / Recruiter across all Admins, with approvals and reactivation requests." />
            <ButtonLink variant="secondary" to="/app/admin/users">Open HR / Recruiters</ButtonLink>
          </Card>
        </div>
      </div>
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

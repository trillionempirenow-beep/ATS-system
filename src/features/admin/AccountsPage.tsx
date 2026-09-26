import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AccountDto, HrAccountsDto } from '@shared/api/admin';
import {
  ACCOUNT_STATUS_LABELS, ACCOUNT_STATUSES, ADMIN_PERMISSION_CATALOG, RECRUITER_PERMISSION_CATALOG, RECRUITER_PERMISSION_KEYS, isRecruiterPermission,
  type AccountStatus, type PermissionKey, type RecruiterPermissionKey,
} from '@shared/domain/access';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge, StatusBadge } from '@/components/ui/Display';
import { Checkbox, Field, TextInput, formStyles } from '@/components/ui/Form';
import { EmptyState, Notice, ProgressBar } from '@/components/ui/Feedback';
import { Drawer } from '@/components/ui/Overlay';
import { Card, DataTable, PageHeader, PillTabs, type Column, type TabItem } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { useAuth } from '@/app/providers/AuthProvider';
import { ApiError, api, errorMessage, qs } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog';
import { adminKeys, useAdminMutation } from './api';
import w from '../workspace.module.css';
import s from './Admin.module.css';

type RecruiterPermission = RecruiterPermissionKey;
const permissionLabel = (p: PermissionKey) => (isRecruiterPermission(p) ? RECRUITER_PERMISSION_CATALOG[p].label : ADMIN_PERMISSION_CATALOG[p].label);
const TABS: Array<AccountStatus | 'all'> = ['all', 'active', 'pending', 'suspended', 'disabled', 'pending_reactivation', 'rejected'];

function useGrantable(): RecruiterPermission[] {
  const { user, can } = useAuth();
  if (can.superAdmin) return [...RECRUITER_PERMISSION_KEYS];
  return RECRUITER_PERMISSION_KEYS.filter((k) => user?.permissions.includes(k));
}

function PermissionPicker({ value, onChange, grantable }: { value: Set<RecruiterPermission>; onChange: (v: Set<RecruiterPermission>) => void; grantable: RecruiterPermission[] }) {
  return (
    <fieldset className={s.fieldset}>
      <legend>Permissions</legend>
      {grantable.length === 0 ? <p className={w.faint}>You do not hold any permissions you can pass on.</p> : null}
      {grantable.map((k) => (
        <Checkbox key={k} checked={value.has(k)} label={RECRUITER_PERMISSION_CATALOG[k].label} description={RECRUITER_PERMISSION_CATALOG[k].description}
          onChange={(e) => { const next = new Set(value); if (e.target.checked) next.add(k); else next.delete(k); onChange(next); }} />
      ))}
      <p className={w.faint}>You can only grant permissions you hold.</p>
    </fieldset>
  );
}

function CreateDrawer({ onClose, iAmSuper }: { onClose: () => void; iAmSuper: boolean }) {
  const toast = useToast();
  const grantable = useGrantable();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [perms, setPerms] = useState<Set<RecruiterPermission>>(() => new Set(grantable.filter((k) => k === 'job_posting')));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useAdminMutation(() => api.post('/users', { name: name.trim(), email: email.trim(), password, permissions: [...perms] }));
  const submit = () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Name is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'That email address is not valid.';
    if (password.length < 8) next.password = 'The temporary password must be at least 8 characters.';
    setErrors(next);
    if (Object.keys(next).length) return;
    create.mutate(undefined, {
      onSuccess: () => { toast.success(iAmSuper ? `${name.trim()} can sign in now.` : `${name.trim()} was created and is waiting for Super Admin approval.`); onClose(); },
      onError: (e) => setErrors(e instanceof ApiError && Object.keys(e.fields).length ? e.fields : { form: errorMessage(e) }),
    });
  };
  return (
    <Drawer open onClose={onClose} title="Create HR / Recruiter"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={create.isPending}>Create HR / Recruiter</Button></>}>
      <div className={formStyles.stack}>
        {errors.form ? <Notice tone="danger">{errors.form}</Notice> : null}
        <Field label="Full name" required error={errors.name}><TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
        <Field label="Email" required error={errors.email}><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Field>
        <Field label="Temporary password" required hint="At least 8 characters" error={errors.password}><TextInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
        <PermissionPicker value={perms} onChange={setPerms} grantable={grantable} />
        {!iAmSuper ? <Notice tone="info">The account is pending and can only sign in once a Super Admin approves it.</Notice> : null}
      </div>
    </Drawer>
  );
}

function ManageDrawer({ account, onClose, onConfirm, iAmSuper }: { account: AccountDto | null; onClose: () => void; onConfirm: (r: ConfirmRequest) => void; iAmSuper: boolean }) {
  const toast = useToast();
  const grantable = useGrantable();
  const [perms, setPerms] = useState<Set<RecruiterPermission>>(new Set());
  useEffect(() => { if (account) setPerms(new Set(account.permissions.filter(isRecruiterPermission))); }, [account]);
  const id = account?.id ?? 0;
  const savePerms = useAdminMutation(() => api.put(`/users/${id}/permissions`, { permissions: [...perms] }));
  const setStatus = useAdminMutation((input: { status: string; note: string }) => api.patch(`/users/${id}/status`, input));
  const release = useAdminMutation(() => api.post(`/users/${id}/release-seat`));
  const remove = useAdminMutation(() => api.delete(`/users/${id}`));
  if (!account) return null;
  const a = account;
  const held = a.permissions.filter(isRecruiterPermission);
  const dirty = perms.size !== held.length || held.some((p) => !perms.has(p));

  const status = (next: 'suspended' | 'disabled') => onConfirm({
    title: `${next === 'suspended' ? 'Suspend' : 'Disable'} ${a.name}?`, confirmLabel: next === 'suspended' ? 'Suspend' : 'Disable', danger: true,
    body: 'They are signed out everywhere and cannot sign in. Reactivating later needs Super Admin approval. Their candidates stay in the pipeline.',
    note: { label: 'Reason' },
    run: async (note) => { await setStatus.mutateAsync({ status: next, note }); toast.success(`${a.name} is now ${next}.`); onClose(); },
  });

  return (
    <Drawer open onClose={onClose} title={`Manage · ${a.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button disabled={!dirty} loading={savePerms.isPending} onClick={() => savePerms.mutate(undefined, {
        onSuccess: () => toast.success('Permissions saved.'), onError: (e) => toast.error(errorMessage(e)),
      })}>Save permissions</Button></>}>
      <div className={formStyles.stack}>
        <div className={w.person}>
          <Avatar name={a.name} src={a.avatarUrl} size={44} />
          <div className={w.personText}><span className={w.personName}>{a.name}</span><span className={w.personSub}>{a.email}</span></div>
          <StatusBadge kind="account" value={a.accountStatus} size="sm" />
        </div>
        {a.createdByName && iAmSuper ? <p className={w.faint}>Seat held under {a.createdByName}{a.seatReleased ? ' · seat released' : ''}.</p> : null}
        <PermissionPicker value={perms} onChange={setPerms} grantable={grantable} />
        {a.accountStatus === 'active' ? (
          <div className={s.dangerZone}>
            <span className={w.overline}>Account status</span>
            <div className={w.row} style={{ gap: 8 }}>
              <Button size="sm" variant="secondary" onClick={() => status('suspended')}>Suspend</Button>
              <Button size="sm" variant="dangerGhost" onClick={() => status('disabled')}>Disable</Button>
            </div>
          </div>
        ) : null}
        {iAmSuper && a.createdById && !a.seatReleased && a.accountStatus !== 'active' && a.accountStatus !== 'pending' ? (
          <div className={s.dangerZone}>
            <span className={w.overline}>Release seat</span>
            <p className={w.faint}>Release the seat this account holds so another person can use it.</p>
            <Button size="sm" variant="secondary" loading={release.isPending} onClick={() => release.mutate(undefined, {
              onSuccess: () => { toast.success('Seat released.'); onClose(); }, onError: (e) => toast.error(errorMessage(e)),
            })}>Release seat</Button>
          </div>
        ) : null}
        <div className={s.dangerZone}>
          <span className={w.overline}>Delete account and free seat</span>
          <p className={w.faint}>Their candidates stay in the pipeline. This cannot be undone.</p>
          <Button size="sm" variant="danger" onClick={() => onConfirm({
            title: `Delete ${a.name}?`, confirmLabel: 'Delete account', danger: true,
            body: 'The account is removed and its seat is freed. Candidates, interviews and audit history they created are kept. This cannot be undone.',
            run: async () => { await remove.mutateAsync(undefined); toast.success(`${a.name} was deleted.`); onClose(); },
          })}>Delete account</Button>
        </div>
      </div>
    </Drawer>
  );
}

export function AccountsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const tab: AccountStatus | 'all' = raw && (ACCOUNT_STATUSES as readonly string[]).includes(raw) ? (raw as AccountStatus) : 'all';
  const q = useQuery({
    queryKey: adminKeys.users(tab === 'all' ? undefined : tab),
    queryFn: () => api.get<HrAccountsDto>(`/users${qs({ status: tab === 'all' ? undefined : tab })}`),
    placeholderData: (prev) => prev,
  });
  const toast = useToast();
  const grantable = useGrantable();
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<AccountDto | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  useEffect(() => { document.title = 'HR / Recruiters · Acme People'; }, []);

  const statusMutation = useAdminMutation((input: { id: number; status: string; note: string }) => api.patch(`/users/${input.id}/status`, { status: input.status, note: input.note }));
  const reactivation = useAdminMutation((input: { id: number; reason: string }) => api.post(`/users/${input.id}/reactivation`, { reason: input.reason }));
  const decision = useAdminMutation((input: { id: number; decision: 'approved' | 'rejected'; note: string }) => api.post(`/account-requests/${input.id}/decision`, { decision: input.decision, note: input.note }));

  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const iAmSuper = d?.iAmSuper ?? false;
  const seats = d?.seats;
  const full = seats ? seats.available <= 0 : false;

  const approve = (a: AccountDto, ok: boolean) => setConfirm({
    title: `${ok ? 'Approve' : 'Reject'} ${a.name}?`, confirmLabel: ok ? 'Approve account' : 'Reject account', danger: !ok,
    body: ok ? 'They can sign in with their temporary password straight away.' : 'They will not be able to sign in. A rejected account does not hold a seat.',
    note: ok ? undefined : { label: 'Reason' },
    run: async (note) => { await statusMutation.mutateAsync({ id: a.id, status: ok ? 'active' : 'rejected', note }); toast.success(`${a.name} was ${ok ? 'approved' : 'rejected'}.`); },
  });
  const requestReactivation = (a: AccountDto) => setConfirm({
    title: `Request reactivation for ${a.name}?`, confirmLabel: 'Send request',
    body: 'A Super Admin decides. You will be notified of the outcome.', note: { label: 'Reason' },
    run: async (reason) => { await reactivation.mutateAsync({ id: a.id, reason }); toast.success('Reactivation requested.'); },
  });
  const decide = (a: AccountDto, ok: boolean) => setConfirm({
    title: `${ok ? 'Reactivate' : 'Keep inactive'} ${a.name}?`, confirmLabel: ok ? 'Approve reactivation' : 'Reject request', danger: !ok,
    body: a.openRequest?.reason ? `Reason given: “${a.openRequest.reason}”${a.openRequest.requestedBy ? ` (${a.openRequest.requestedBy})` : ''}` : 'No reason was given.',
    note: { label: 'Note' },
    run: async (note) => { await decision.mutateAsync({ id: a.openRequest!.id, decision: ok ? 'approved' : 'rejected', note }); toast.success(ok ? `${a.name} is active again.` : 'Request rejected.'); },
  });
  const reactivateDirect = (a: AccountDto) => setConfirm({
    title: `Reactivate ${a.name}?`, confirmLabel: 'Reactivate', body: 'They can sign in again straight away.',
    run: async () => { await statusMutation.mutateAsync({ id: a.id, status: 'active', note: '' }); toast.success(`${a.name} is active again.`); },
  });

  const action = (a: AccountDto) => {
    const stop = (fn: () => void) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); fn(); };
    if (a.accountStatus === 'pending') {
      return iAmSuper
        ? <span className={s.rowActions}><Button size="sm" onClick={stop(() => approve(a, true))}>Approve</Button><Button size="sm" variant="dangerGhost" onClick={stop(() => approve(a, false))}>Reject</Button></span>
        : <span className={w.faint}>Waiting for Super Admin</span>;
    }
    if (a.accountStatus === 'pending_reactivation' || a.openRequest) {
      return iAmSuper && a.openRequest
        ? <span className={s.rowActions}><Button size="sm" onClick={stop(() => decide(a, true))}>Approve</Button><Button size="sm" variant="dangerGhost" onClick={stop(() => decide(a, false))}>Reject</Button></span>
        : <span className={w.faint}>Reactivation requested</span>;
    }
    if (a.accountStatus === 'suspended' || a.accountStatus === 'disabled') {
      if (!a.canManage) return null;
      return iAmSuper
        ? <Button size="sm" variant="secondary" onClick={stop(() => reactivateDirect(a))}>Reactivate</Button>
        : <Button size="sm" variant="secondary" onClick={stop(() => requestReactivation(a))}>Request reactivation</Button>;
    }
    if (a.accountStatus === 'rejected') return <span className={w.faint}>Not approved</span>;
    return a.canManage ? <Button size="sm" variant="ghost" onClick={stop(() => setManaging(a))}>Manage</Button> : null;
  };

  const columns: Column<AccountDto>[] = [
    {
      key: 'who', header: 'HR / Recruiter', primary: true,
      cell: (a) => (
        <span className={w.person}>
          <Avatar name={a.name} src={a.avatarUrl} size={32} />
          <span className={w.personText}><span className={w.personName}>{a.name}</span><span className={w.personSub}>{a.email}{iAmSuper && a.createdByName ? ` · under ${a.createdByName}` : ''}</span></span>
        </span>
      ),
    },
    {
      key: 'status', header: 'Status', label: 'Status',
      cell: (a) => (
        <span className={s.statusCell}>
          <StatusBadge kind="account" value={a.accountStatus} size="sm" />
          {a.accountStatus === 'pending' ? <span className={w.faint}>Cannot sign in until approved</span> : null}
        </span>
      ),
    },
    {
      key: 'perms', header: 'Permissions', label: 'Permissions',
      cell: (a) => a.accountStatus === 'pending' ? <span className={w.faint}>Not active yet</span>
        : a.permissions.length ? <span className={s.permChips}>{a.permissions.map((p) => <Badge key={p} tone="neutral" size="sm">{permissionLabel(p)}</Badge>)}</span>
          : <span className={w.faint}>None</span>,
    },
    { key: 'created', header: 'Created', cell: (a) => formatDate(a.createdAt, { month: 'short', day: 'numeric' }), label: 'Created' },
    { key: 'action', header: <span className="sr-only">Actions</span>, cell: action, align: 'right' },
  ];

  const tabs: TabItem<AccountStatus | 'all'>[] = TABS.map((k) => ({
    key: k, label: k === 'all' ? 'All' : ACCOUNT_STATUS_LABELS[k],
    count: d ? (k === 'all' ? Object.values(d.counts).reduce((x, y) => x + (y ?? 0), 0) : d.counts[k] ?? 0) : undefined,
  })).filter((t) => t.key === 'all' || t.key === 'active' || t.key === 'pending' || t.key === 'suspended' || t.key === 'disabled' || (t.count ?? 0) > 0);

  return (
    <div className={w.page}>
      <PageHeader title="HR / Recruiters" description="Create recruiter accounts, choose what each one can do, and manage their status."
        crumbs={[{ label: 'Administration' }, { label: 'HR / Recruiters' }]}
        actions={<Button icon="plus" onClick={() => setCreating(true)} disabled={!d || (!iAmSuper && full)}>Create HR / Recruiter</Button>} />
      <div className={seats ? w.cols11 : undefined}>
        {seats ? (
          <Card>
            <div className={s.seats}>
              <div className={w.rowBetween}><span className={w.overline}>Seats used</span><strong className="num">{seats.used} / {seats.limit}</strong></div>
              <ProgressBar value={seats.used} max={Math.max(1, seats.limit)} label="Seats used" />
              <span className={full ? s.full : w.faint}>{full ? 'No available HR / Recruiter seats. Release a seat to add someone new.' : `${seats.available} seat${seats.available === 1 ? '' : 's'} available`}</span>
            </div>
          </Card>
        ) : null}
        <Card>
          <div className={s.seats}>
            <span className={w.overline}>{iAmSuper ? 'Super Admin' : 'Admin permissions'}</span>
            <span>{iAmSuper ? 'You approve new accounts and reactivations across every Admin.' : `You can grant: ${grantable.length ? grantable.map((k) => RECRUITER_PERMISSION_CATALOG[k].label).join(', ') : 'nothing yet'}`}</span>
          </div>
        </Card>
      </div>
      <PillTabs label="Filter by status" value={tab} onChange={(k) => setParams(k === 'all' ? {} : { status: k }, { replace: true })} items={tabs} />
      <Card padding={0}>
        <DataTable columns={columns} rows={d?.accounts ?? []} rowKey={(a) => a.id} loading={!d} caption="HR / Recruiter accounts"
          onRowClick={(a) => { if (a.canManage && a.accountStatus === 'active') setManaging(a); }}
          empty={<EmptyState compact icon="users" title={tab === 'all' ? 'No HR / Recruiters yet' : `No ${ACCOUNT_STATUS_LABELS[tab].toLowerCase()} accounts`}
            text={tab === 'all' ? 'Create the first recruiter account to start delegating hiring work.' : undefined}
            actions={tab === 'all' ? <Button icon="plus" onClick={() => setCreating(true)} disabled={!iAmSuper && full}>Create HR / Recruiter</Button> : null} />} />
      </Card>
      {creating ? <CreateDrawer onClose={() => setCreating(false)} iAmSuper={iAmSuper} /> : null}
      <ManageDrawer account={managing} onClose={() => setManaging(null)} onConfirm={setConfirm} iAmSuper={iAmSuper} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

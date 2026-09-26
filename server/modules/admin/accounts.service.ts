import type { z } from 'zod';
import {
  ACCOUNT_STATUS_LABELS, PERMISSIONS, RECRUITER_PERMISSION_KEYS, SEAT_HOLDING_STATUSES, hasPermission, isSuperAdmin,
  type AccountStatus, type PermissionKey, type Role,
} from '../../../shared/domain/access.js';
import { jobState, type ApprovalStatus, type JobStatus } from '../../../shared/domain/jobs.js';
import type {
  AccountDto, AdminsOverviewDto, HrAccountsDto,
  accountStatusSchema, adminPermissionsSchema, createAdminSchema, createHrSchema, decisionSchema, hrPermissionsSchema,
} from '../../../shared/api/admin.js';
import { sql, transaction, type Db } from '../../db/client.js';
import { audit } from '../../core/audit.js';
import { notify, notifyMany, superAdminIds } from '../../core/notifications.js';
import type { CurrentUser } from '../../http/context.js';
import { AppError, conflict, forbidden, isUniqueViolation, notFound, validationFailed } from '../../http/errors.js';
import { hashPassword } from '../../lib/crypto.js';
import { isoOrThrow } from '../../lib/format.js';
import { emitN8nEvent } from '../../integrations/n8n/n8n.client.js';
import { avatarUrlForUser } from '../media/media.urls.js';
import { deleteUserSessions } from '../auth/session.repository.js';

type Ctx = { user: CurrentUser; ip: string | null };

interface AccountRow {
  id: number; name: string; email: string; role: Role; account_status: AccountStatus; job_title: string | null; profile_image: string | null;
  created_at: Date; created_by: number | null; creator_name: string | null; seat_released: boolean; status_note: string | null;
  hr_account_limit: number; permissions: PermissionKey[];
}

const ACCOUNT_SELECT = sql`
  select u.id, u.name, u.email::text, u.role, u.account_status, u.job_title, u.profile_image, u.created_at, u.created_by, c.name as creator_name,
         u.seat_released, u.status_note, u.hr_account_limit,
         coalesce((select array_agg(p.permission order by p.permission) from user_permissions p where p.user_id = u.id), '{}') as permissions
  from users u left join users c on c.id = u.created_by`;

export async function seatsUsed(adminId: number, db: Db = sql): Promise<number> {
  const [r] = await db<{ n: number }[]>`
    select count(*)::int as n from users where created_by = ${adminId} and role = 'recruiter' and not seat_released
    and account_status in ${sql(SEAT_HOLDING_STATUSES as AccountStatus[])}`;
  return r?.n ?? 0;
}

async function seatLimit(adminId: number, db: Db = sql): Promise<number> {
  const [r] = await db<{ hr_account_limit: number }[]>`select hr_account_limit from users where id = ${adminId}`;
  return r?.hr_account_limit ?? 0;
}

/** Recruiters an Admin may manage: only the ones they created. Super Admin manages all; nobody manages themselves. */
function canManage(target: { id: number; role: Role; created_by: number | null }, user: CurrentUser): boolean {
  if (target.id === user.id) return false;
  if (isSuperAdmin(user)) return true;
  if (user.role !== 'admin' || !hasPermission(user, 'manage_accounts')) return false;
  return target.role === 'recruiter' && target.created_by === user.id;
}

async function openRequests() {
  const rows = await sql<{ id: number; user_id: number; reason: string | null; requester: string | null; created_at: Date }[]>`
    select ar.id, ar.user_id, ar.reason, rq.name as requester, ar.created_at from account_requests ar left join users rq on rq.id = ar.requested_by
    where ar.status = 'pending'`;
  return new Map(rows.map((r) => [r.user_id, { id: r.id, reason: r.reason, requestedBy: r.requester, createdAt: isoOrThrow(r.created_at) }]));
}

async function toAccount(r: AccountRow, user: CurrentUser, requests: Awaited<ReturnType<typeof openRequests>>): Promise<AccountDto> {
  return {
    id: r.id, name: r.name, email: r.email, role: r.role, accountStatus: r.account_status, permissions: r.permissions, jobTitle: r.job_title,
    avatarUrl: avatarUrlForUser(r.id, r.profile_image), createdAt: isoOrThrow(r.created_at), createdByName: r.creator_name, createdById: r.created_by,
    seatReleased: r.seat_released, statusNote: r.status_note, hrAccountLimit: r.hr_account_limit,
    seatsUsed: r.role === 'admin' ? await seatsUsed(r.id) : 0, canManage: canManage(r, user), openRequest: requests.get(r.id) ?? null,
  };
}

async function setPermissions(db: Db, userId: number, requested: readonly string[], allowed: readonly PermissionKey[], grantedBy: number) {
  const want = [...new Set(requested)].filter((p): p is PermissionKey => (allowed as readonly string[]).includes(p));
  const current = (await db<{ permission: PermissionKey }[]>`select permission from user_permissions where user_id = ${userId}`)
    .map((r) => r.permission).filter((p) => allowed.includes(p));
  const added = want.filter((p) => !current.includes(p));
  const removed = current.filter((p) => !want.includes(p));
  for (const p of added) await db`insert into user_permissions (user_id, permission, granted_by) values (${userId}, ${p}, ${grantedBy}) on conflict do nothing`;
  for (const p of removed) await db`delete from user_permissions where user_id = ${userId} and permission = ${p}`;
  return { added, removed };
}

async function applyStatus(db: Db, userId: number, status: AccountStatus, actorId: number, note: string | null): Promise<void> {
  await db`update users set account_status = ${status}, active = ${status === 'active'}, approved_by = ${actorId},
             approved_at = case when ${status} in ('active','rejected') then now() else approved_at end, status_note = ${note} where id = ${userId}`;
  if (status !== 'active') await deleteUserSessions(userId, undefined, db);
}

// ---------------------------------------------------------------------------
// Super Admin: Admins, permissions and seat limits
// ---------------------------------------------------------------------------

export async function adminsOverview(user: CurrentUser): Promise<AdminsOverviewDto> {
  const [admins, requests, [counts], jobRows, activity] = await Promise.all([
    sql<AccountRow[]>`${ACCOUNT_SELECT} where u.role = 'admin' order by u.name`,
    openRequests(),
    sql<{ pending: number; reactivations: number }[]>`
      select (select count(*)::int from users where role = 'recruiter' and account_status = 'pending') as pending,
             (select count(*)::int from account_requests where status = 'pending') as reactivations`,
    sql<{ status: JobStatus; approval_status: ApprovalStatus; n: number }[]>`select status, approval_status, count(*)::int as n from jobs group by status, approval_status`,
    sql<{ id: number; action: string; note: string | null; title: string; actor_name: string | null; created_at: Date }[]>`
      select ja.id, ja.action, ja.note, j.title, u.name as actor_name, ja.created_at from job_approvals ja join jobs j on j.id = ja.job_id
      left join users u on u.id = ja.actor_id order by ja.created_at desc limit 8`,
  ]);
  const accounts = await Promise.all(admins.map((a) => toAccount(a, user, requests)));
  const jobs: AdminsOverviewDto['stats']['jobs'] = {};
  for (const r of jobRows) { const s = jobState(r); jobs[s] = (jobs[s] ?? 0) + r.n; }
  return {
    admins: accounts,
    stats: {
      pendingAccounts: counts?.pending ?? 0,
      pendingReactivations: counts?.reactivations ?? 0,
      seatsTotal: accounts.reduce((s, a) => s + a.hrAccountLimit, 0),
      seatsUsed: accounts.reduce((s, a) => s + a.seatsUsed, 0),
      jobs,
    },
    recentActivity: activity.map((a) => ({ id: a.id, action: a.action, note: a.note, jobTitle: a.title, actorName: a.actor_name, createdAt: isoOrThrow(a.created_at) })),
  };
}

export async function createAdmin(input: z.infer<typeof createAdminSchema>, ctx: Ctx): Promise<{ id: number }> {
  const hash = await hashPassword(input.password);
  try {
    const id = await transaction(async (tx) => {
      const [u] = await tx<{ id: number }[]>`
        insert into users (name, email, password_hash, role, active, account_status, created_by, hr_account_limit, approved_by, approved_at)
        values (${input.name}, ${input.email}, ${hash}, 'admin', true, 'active', ${ctx.user.id}, ${input.hrAccountLimit}, ${ctx.user.id}, now()) returning id`;
      await setPermissions(tx, u!.id, input.permissions, PERMISSIONS, ctx.user.id);
      await audit({ userId: ctx.user.id, action: 'admin_create', entityType: 'user', entityId: u!.id, details: { admin: input.name, seat_limit: input.hrAccountLimit }, ip: ctx.ip }, tx);
      return u!.id;
    });
    emitN8nEvent('account.created', { userId: id, role: 'admin', status: 'active' });
    return { id };
  } catch (e) {
    if (isUniqueViolation(e)) throw validationFailed({ email: 'An account with that email already exists.' });
    throw e;
  }
}

export async function setAdminPermissions(adminId: number, input: z.infer<typeof adminPermissionsSchema>, ctx: Ctx): Promise<void> {
  const [admin] = await sql<{ id: number; name: string; hr_account_limit: number }[]>`select id, name, hr_account_limit from users where id = ${adminId} and role = 'admin'`;
  if (!admin) throw notFound('That Admin account no longer exists.');
  const used = await seatsUsed(adminId);
  if (input.hrAccountLimit < used) {
    throw validationFailed({ hrAccountLimit: `That Admin is using ${used} seats. Delete or release some before lowering the seat limit to ${input.hrAccountLimit}.` });
  }
  const oldLimit = admin.hr_account_limit;
  const { added, removed } = await transaction(async (tx) => {
    if (oldLimit !== input.hrAccountLimit) await tx`update users set hr_account_limit = ${input.hrAccountLimit} where id = ${adminId}`;
    const diff = await setPermissions(tx, adminId, input.permissions, PERMISSIONS, ctx.user.id);
    if (oldLimit !== input.hrAccountLimit || diff.added.length || diff.removed.length) {
      await audit({ userId: ctx.user.id, action: 'admin_permissions_update', entityType: 'user', entityId: adminId, details: {
        admin: admin.name, seat_limit: oldLimit !== input.hrAccountLimit ? `${oldLimit} → ${input.hrAccountLimit}` : '',
        granted: diff.added.join(', '), revoked: diff.removed.join(', '),
      }, ip: ctx.ip }, tx);
    }
    if (oldLimit !== input.hrAccountLimit) {
      await audit({ userId: ctx.user.id, action: 'seat_limit_changed', entityType: 'user', entityId: adminId, details: { admin: admin.name, seats: `${oldLimit} → ${input.hrAccountLimit}` }, ip: ctx.ip }, tx);
    }
    return diff;
  });
  if (oldLimit !== input.hrAccountLimit) {
    await notify({ userId: adminId, actorId: ctx.user.id, type: 'seat_limit', title: 'Your seat limit changed',
      body: `${ctx.user.name} changed your HR/Recruiter seat limit from ${oldLimit} to ${input.hrAccountLimit}.`, link: '/app/admin/users', actionLabel: 'Open accounts', entityType: 'user', entityId: adminId });
  }
  if (added.length || removed.length) {
    await notify({ userId: adminId, actorId: ctx.user.id, type: 'permissions', title: 'Your permissions were updated',
      body: `${ctx.user.name} changed what your account can do.`, link: '/app/admin/users', actionLabel: 'Open accounts', entityType: 'user', entityId: adminId });
  }
}

export async function setAdminStatus(adminId: number, input: z.infer<typeof accountStatusSchema>, ctx: Ctx): Promise<void> {
  if (adminId === ctx.user.id) throw forbidden('You cannot change the status of your own account.');
  const [admin] = await sql<{ id: number; name: string }[]>`select id, name from users where id = ${adminId} and role = 'admin'`;
  if (!admin) throw notFound('That Admin account no longer exists.');
  await transaction(async (tx) => {
    await applyStatus(tx, adminId, input.status, ctx.user.id, input.note || null);
    await audit({ userId: ctx.user.id, action: 'admin_status_change', entityType: 'user', entityId: adminId, details: { admin: admin.name, status: ACCOUNT_STATUS_LABELS[input.status] }, ip: ctx.ip }, tx);
  });
  emitN8nEvent('account.status_changed', { userId: adminId, status: input.status });
}

// ---------------------------------------------------------------------------
// HR / Recruiter accounts (manage_accounts; Super Admin sees all)
// ---------------------------------------------------------------------------

export async function hrAccounts(user: CurrentUser, status?: AccountStatus): Promise<HrAccountsDto> {
  const iAmSuper = isSuperAdmin(user);
  const rows = await sql<AccountRow[]>`
    ${ACCOUNT_SELECT} where u.role = 'recruiter'
    ${iAmSuper ? sql`` : sql`and u.created_by = ${user.id}`}
    ${status ? sql`and u.account_status = ${status}` : sql``}
    order by array_position(array['pending','pending_reactivation','active','suspended','disabled','rejected'], u.account_status), u.name`;
  const all = await sql<{ account_status: AccountStatus; n: number }[]>`
    select account_status, count(*)::int as n from users where role = 'recruiter' ${iAmSuper ? sql`` : sql`and created_by = ${user.id}`} group by account_status`;
  const requests = await openRequests();
  let seats: HrAccountsDto['seats'] = null;
  if (!iAmSuper) {
    const [limit, used] = await Promise.all([seatLimit(user.id), seatsUsed(user.id)]);
    seats = { limit, used, available: Math.max(0, limit - used) };
  }
  return {
    accounts: await Promise.all(rows.map((r) => toAccount(r, user, requests))),
    iAmSuper, seats, counts: Object.fromEntries(all.map((r) => [r.account_status, r.n])),
  };
}

export async function createHr(input: z.infer<typeof createHrSchema>, ctx: Ctx): Promise<{ id: number; status: AccountStatus }> {
  const iAmSuper = isSuperAdmin(ctx.user);
  const hash = await hashPassword(input.password);
  const status: AccountStatus = iAmSuper ? 'active' : 'pending';
  let id: number;
  try {
    id = await transaction(async (tx) => {
      if (!iAmSuper) {
        await tx`select id from users where id = ${ctx.user.id} for update`;
        if ((await seatLimit(ctx.user.id, tx)) - (await seatsUsed(ctx.user.id, tx)) < 1) {
          throw new AppError(409, 'conflict', 'No available HR/Recruiter seats. Please contact the Super Admin to increase your seat limit.');
        }
      }
      const [u] = await tx<{ id: number }[]>`
        insert into users (name, email, password_hash, role, active, account_status, created_by, approved_by, approved_at)
        values (${input.name}, ${input.email}, ${hash}, 'recruiter', ${status === 'active'}, ${status}, ${ctx.user.id},
                ${iAmSuper ? ctx.user.id : null}, ${iAmSuper ? new Date() : null}) returning id`;
      await setPermissions(tx, u!.id, input.permissions, RECRUITER_PERMISSION_KEYS, ctx.user.id);
      await audit({ userId: ctx.user.id, action: 'hr_account_create', entityType: 'user', entityId: u!.id, details: { account: input.name, status: ACCOUNT_STATUS_LABELS[status], created_by: ctx.user.name }, ip: ctx.ip }, tx);
      return u!.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw validationFailed({ email: 'An account with that email already exists.' });
    throw e;
  }
  if (status === 'pending') {
    await notifyMany(await superAdminIds(), { actorId: ctx.user.id, type: 'account_approval', title: 'HR/Recruiter account needs approval',
      body: `${ctx.user.name} created an account for ${input.name}.`, link: '/app/admin/users?status=pending', actionLabel: 'Review account', entityType: 'user', entityId: id });
  }
  emitN8nEvent('account.created', { userId: id, role: 'recruiter', status });
  return { id, status };
}

async function loadRecruiter(id: number, db: Db = sql) {
  const [t] = await db<{ id: number; name: string; email: string; role: Role; created_by: number | null; account_status: AccountStatus; seat_released: boolean }[]>`
    select id, name, email::text, role, created_by, account_status, seat_released from users where id = ${id} and role = 'recruiter'`;
  if (!t) throw notFound('That account no longer exists.');
  return t;
}

export async function setHrPermissions(id: number, permissions: z.infer<typeof hrPermissionsSchema>['permissions'], ctx: Ctx): Promise<void> {
  const target = await loadRecruiter(id);
  if (!canManage(target, ctx.user)) throw forbidden('You can only change permissions for HR/Recruiter accounts you manage.');
  const diff = await transaction(async (tx) => {
    const d = await setPermissions(tx, id, permissions, RECRUITER_PERMISSION_KEYS, ctx.user.id);
    if (d.added.length || d.removed.length) {
      await audit({ userId: ctx.user.id, action: 'hr_permissions_update', entityType: 'user', entityId: id, details: { account: target.name, granted: d.added.join(', '), revoked: d.removed.join(', ') }, ip: ctx.ip }, tx);
    }
    return d;
  });
  if (diff.added.length || diff.removed.length) {
    await notify({ userId: id, actorId: ctx.user.id, type: 'permissions', title: 'Your permissions were updated', body: `${ctx.user.name} changed what your account can do.`, link: '/app' });
  }
}

export async function setHrStatus(id: number, input: z.infer<typeof accountStatusSchema>, ctx: Ctx): Promise<void> {
  const iAmSuper = isSuperAdmin(ctx.user);
  const note = input.note || null;
  const target = await transaction(async (tx) => {
    const target = await loadRecruiter(id, tx);
    if (['active', 'rejected'].includes(input.status) && target.account_status === 'pending' && !iAmSuper) {
      throw forbidden('Only a Super Admin can approve or reject a new HR/Recruiter account.');
    }
    if (!iAmSuper && !canManage(target, ctx.user)) throw forbidden('You can only change accounts you manage.');
    if (input.status === 'active' && ['suspended', 'disabled', 'pending_reactivation'].includes(target.account_status) && !iAmSuper) {
      throw forbidden('Reactivating an account needs Super Admin approval. Use "Request reactivation" instead.');
    }
    if (input.status === 'active' && !['pending', 'active'].includes(target.account_status) && target.created_by && target.seat_released) {
      const [owner] = await tx<{ role: Role }[]>`select role from users where id = ${target.created_by}`;
      if (owner?.role === 'admin' && (await seatLimit(target.created_by, tx)) - (await seatsUsed(target.created_by, tx)) < 1) {
        throw conflict('That Admin has no available seats. Increase their seat limit first.');
      }
      await tx`update users set seat_released = false where id = ${id}`;
    }
    await applyStatus(tx, id, input.status, ctx.user.id, note);
    await tx`update account_requests set status = 'approved', decided_by = ${ctx.user.id}, decided_at = now(), decision_note = ${note} where user_id = ${id} and status = 'pending'`;
    await audit({ userId: ctx.user.id, action: 'hr_account_status', entityType: 'user', entityId: id, details: { account: target.name, email: target.email, status: ACCOUNT_STATUS_LABELS[input.status], reason: note ?? '' }, ip: ctx.ip }, tx);
    return target;
  });
  if (input.status === 'suspended' || input.status === 'disabled') {
    await notifyMany(await superAdminIds(), {
      actorId: ctx.user.id, type: input.status === 'suspended' ? 'account_suspended' : 'account_disabled',
      title: `HR/Recruiter ${input.status}`, body: `${ctx.user.name} ${input.status} ${target.name} (${target.email})${note ? ` — reason: ${note}` : '.'}`,
      link: `/app/admin/users?status=${input.status}`, actionLabel: 'Review account', entityType: 'user', entityId: id,
    });
  }
  await notify({ userId: id, actorId: ctx.user.id, type: 'account', title: `Your account is now ${ACCOUNT_STATUS_LABELS[input.status].toLowerCase()}`, body: note, link: '/app' });
  emitN8nEvent('account.status_changed', { userId: id, status: input.status });
}

export async function requestReactivation(id: number, reason: string, ctx: Ctx): Promise<void> {
  const requestId = await transaction(async (tx) => {
    const target = await loadRecruiter(id, tx);
    if (!isSuperAdmin(ctx.user) && !canManage(target, ctx.user)) throw forbidden('You can only request reactivation for accounts you manage.');
    if (!['suspended', 'disabled'].includes(target.account_status)) throw conflict('Only a suspended or disabled account can be reactivated.');
    const [open] = await tx<{ id: number }[]>`select id from account_requests where user_id = ${id} and status = 'pending'`;
    if (open) throw conflict('A reactivation request for that account is already waiting for the Super Admin.');
    const [r] = await tx<{ id: number }[]>`insert into account_requests (user_id, requested_by, request_type, reason) values (${id}, ${ctx.user.id}, 'reactivation', ${reason || null}) returning id`;
    await applyStatus(tx, id, 'pending_reactivation', ctx.user.id, reason || null);
    await audit({ userId: ctx.user.id, action: 'reactivation_requested', entityType: 'user', entityId: id, details: { account: target.name, email: target.email, requested_by: ctx.user.name, reason }, ip: ctx.ip }, tx);
    return { id: r!.id, name: target.name };
  });
  await notifyMany(await superAdminIds(), { actorId: ctx.user.id, type: 'reactivation_request', title: 'HR account reactivation request',
    body: `${ctx.user.name} requested reactivation of ${requestId.name}'s account${reason ? ` — ${reason}` : '.'}`,
    link: '/app/admin/users?status=pending_reactivation', actionLabel: 'Review request', entityType: 'account_request', entityId: requestId.id });
}

export async function decideReactivation(requestId: number, input: z.infer<typeof decisionSchema>, ctx: Ctx): Promise<void> {
  const note = input.note || null;
  const req = await transaction(async (tx) => {
    const [r] = await tx<{ id: number; user_id: number; requested_by: number | null; account_name: string; owner_id: number | null; seat_released: boolean; requester_name: string | null }[]>`
      select ar.id, ar.user_id, ar.requested_by, u.name as account_name, u.created_by as owner_id, u.seat_released, rq.name as requester_name
      from account_requests ar join users u on u.id = ar.user_id left join users rq on rq.id = ar.requested_by
      where ar.id = ${requestId} and ar.status = 'pending' for update of ar`;
    if (!r) throw conflict('That request has already been decided.');
    if (input.decision === 'approved') {
      if (r.owner_id) {
        const [owner] = await tx<{ role: Role }[]>`select role from users where id = ${r.owner_id}`;
        // A released seat has to be found again; an unreleased one is already counted.
        const needed = r.seat_released ? 1 : 0;
        if (owner?.role === 'admin' && (await seatLimit(r.owner_id, tx)) - (await seatsUsed(r.owner_id, tx)) < needed) {
          throw conflict('That Admin has no available seats. Increase their seat limit before approving.');
        }
      }
      await tx`update users set seat_released = false where id = ${r.user_id}`;
      await applyStatus(tx, r.user_id, 'active', ctx.user.id, note);
    } else {
      await applyStatus(tx, r.user_id, 'disabled', ctx.user.id, note);
    }
    await tx`update account_requests set status = ${input.decision}, decided_by = ${ctx.user.id}, decided_at = now(), decision_note = ${note} where id = ${requestId}`;
    await audit({ userId: ctx.user.id, action: input.decision === 'approved' ? 'reactivation_approved' : 'reactivation_rejected', entityType: 'user', entityId: r.user_id,
      details: { account: r.account_name, requested_by: r.requester_name ?? '', decided_by: ctx.user.name, reason: note ?? '' }, ip: ctx.ip }, tx);
    return r;
  });
  if (req.requested_by) {
    await notify({ userId: req.requested_by, actorId: ctx.user.id, type: input.decision === 'approved' ? 'reactivation_approved' : 'reactivation_rejected',
      title: `Reactivation ${input.decision}`, body: `${req.account_name}'s account was ${input.decision} by ${ctx.user.name}${note ? ` — ${note}` : '.'}`,
      link: '/app/admin/users', actionLabel: 'Open accounts', entityType: 'user', entityId: req.user_id });
  }
  await notify({ userId: req.user_id, actorId: ctx.user.id, type: 'account', title: input.decision === 'approved' ? 'Your account was reactivated' : 'Your reactivation was not approved', body: note, link: '/app' });
}

export async function releaseSeat(id: number, ctx: Ctx): Promise<void> {
  const target = await loadRecruiter(id);
  if (target.account_status === 'active') throw conflict('Suspend or disable the account before releasing its seat.');
  await transaction(async (tx) => {
    await tx`update users set seat_released = true where id = ${id}`;
    await audit({ userId: ctx.user.id, action: 'seat_released', entityType: 'user', entityId: id, details: { account: target.name }, ip: ctx.ip }, tx);
  });
}

/** Their work survives: jobs, notes, interviews and audit history only lose the reference. */
export async function deleteHr(id: number, ctx: Ctx): Promise<void> {
  const target = await loadRecruiter(id);
  if (!isSuperAdmin(ctx.user) && !canManage(target, ctx.user)) throw forbidden('You can only delete accounts you manage.');
  await transaction(async (tx) => {
    await tx`delete from users where id = ${id}`;
    await audit({ userId: ctx.user.id, action: 'hr_account_delete', entityType: 'user', details: { account: target.name, email: target.email, seat: 'released' }, ip: ctx.ip }, tx);
  });
  await notifyMany(await superAdminIds(), { actorId: ctx.user.id, type: 'account', title: 'HR/Recruiter account deleted',
    body: `${ctx.user.name} deleted ${target.name} (${target.email}). The seat is now free.`, link: '/app/admin/users', actionLabel: 'Open accounts' });
}


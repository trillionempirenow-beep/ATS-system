import type { z } from 'zod';
import {
  ADMIN_PERMISSION_CATALOG, RECRUITER_PERMISSION_CATALOG, ROLE_LABELS, canPublishJobs, isSuperAdmin, passwordProblems, passwordRulesSentence,
  type PermissionKey,
} from '../../../shared/domain/access.js';
import { NOTIFICATION_FILTERS, type NotificationCategory, type NotificationPriority } from '../../../shared/domain/people.js';
import type { NotificationsDto, ProfileDto, ShellSummaryDto, changePasswordSchema, notificationsQuerySchema, profileSchema } from '../../../shared/api/me.js';
import { sql, transaction } from '../../db/client.js';
import { audit } from '../../core/audit.js';
import type { CurrentUser, SessionInfo } from '../../http/context.js';
import { isUniqueViolation, validationFailed } from '../../http/errors.js';
import { hashPassword, verifyPassword } from '../../lib/crypto.js';
import { iso, isoOrThrow } from '../../lib/format.js';
import { BUCKETS, storage } from '../../storage/storage.js';
import { avatarUrlForUser } from '../media/media.urls.js';
import { consumeUpload } from '../uploads/uploads.service.js';
import { deleteUserSessions } from '../auth/session.repository.js';
import { myLiveMeeting } from '../interviews/interviews.service.js';

type Ctx = { user: CurrentUser; ip: string | null };

export async function notifications(user: CurrentUser, q: z.infer<typeof notificationsQuerySchema>): Promise<NotificationsDto> {
  const types = q.filter && q.filter !== 'unread' ? NOTIFICATION_FILTERS[q.filter].types : null;
  const rows = await sql<{ id: number; type: string; category: NotificationCategory; priority: NotificationPriority; title: string; body: string | null; link: string | null; action_label: string | null; actor_name: string | null; read_at: Date | null; created_at: Date }[]>`
    select n.id, n.type, n.category, n.priority, n.title, n.body, n.link, n.action_label, a.name as actor_name, n.read_at, n.created_at
    from notifications n left join users a on a.id = n.actor_id
    where n.user_id = ${user.id}
      ${q.filter === 'unread' ? sql`and n.read_at is null` : sql``}
      ${types ? sql`and n.type in ${sql(types as unknown as string[])}` : sql``}
    order by (n.read_at is not null), n.created_at desc limit ${q.limit}`;
  return {
    items: rows.map((r) => ({ id: r.id, type: r.type, category: r.category, priority: r.priority, title: r.title, body: r.body, link: r.link, actionLabel: r.action_label, actorName: r.actor_name, read: r.read_at !== null, createdAt: isoOrThrow(r.created_at) })),
    unread: await unreadCount(user.id),
  };
}

async function unreadCount(userId: number): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from notifications where user_id = ${userId} and read_at is null`;
  return r?.n ?? 0;
}

export async function markRead(user: CurrentUser, ids: number[] | undefined, all: boolean | undefined): Promise<void> {
  if (all) await sql`update notifications set read_at = now() where user_id = ${user.id} and read_at is null`;
  else if (ids?.length) await sql`update notifications set read_at = now() where user_id = ${user.id} and id in ${sql(ids)} and read_at is null`;
}

export async function clearRead(user: CurrentUser): Promise<void> {
  await sql`delete from notifications where user_id = ${user.id} and read_at is not null`;
}

export async function shellSummary(user: CurrentUser): Promise<ShellSummaryDto> {
  const superAdmin = isSuperAdmin(user);
  const [unread, [counts], live] = await Promise.all([
    unreadCount(user.id),
    sql<{ approvals: number; accounts: number; resets: number }[]>`
      select (select count(*)::int from jobs where approval_status = 'pending') as approvals,
             (select count(*)::int from account_requests where status = 'pending') + (select count(*)::int from users where role = 'recruiter' and account_status = 'pending') as accounts,
             (select count(*)::int from password_reset_requests where status = 'pending') as resets`,
    ['admin', 'recruiter', 'hiring_manager'].includes(user.role) ? myLiveMeeting(user) : Promise.resolve(null),
  ]);
  return {
    unread,
    badges: {
      pendingApprovals: canPublishJobs(user) && !superAdmin ? counts?.approvals ?? 0 : 0,
      accountRequests: superAdmin ? counts?.accounts ?? 0 : 0,
      passwordResets: superAdmin ? counts?.resets ?? 0 : 0,
    },
    liveMeeting: live,
  };
}

// ---------------------------------------------------------------------------
// Own profile: a person may edit who they are, never what they may do.
// ---------------------------------------------------------------------------

export async function profile(user: CurrentUser): Promise<ProfileDto> {
  const [row] = await sql<{ id: number; name: string; email: string; job_title: string | null; profile_image: string | null; account_status: string; created_at: Date; password_changed_at: Date | null; creator: string | null }[]>`
    select u.id, u.name, u.email::text, u.job_title, u.profile_image, u.account_status, u.created_at, u.password_changed_at, c.name as creator
    from users u left join users c on c.id = u.created_by where u.id = ${user.id}`;
  const catalog: Record<string, { label: string; description: string }> = { ...RECRUITER_PERMISSION_CATALOG, ...(user.role === 'recruiter' ? {} : ADMIN_PERMISSION_CATALOG) };
  const missing: string[] = [];
  if (!row!.profile_image) missing.push('Profile photo');
  if (!row!.job_title) missing.push('Job title');
  return {
    id: row!.id, name: row!.name, email: row!.email, jobTitle: row!.job_title, role: user.role, roleLabel: ROLE_LABELS[user.role],
    accountStatus: row!.account_status, avatarUrl: avatarUrlForUser(row!.id, row!.profile_image),
    permissions: user.permissions.map((p: PermissionKey) => ({ key: p, label: catalog[p]?.label ?? p, description: catalog[p]?.description ?? '' })),
    createdAt: isoOrThrow(row!.created_at), passwordChangedAt: iso(row!.password_changed_at), createdByName: row!.creator,
    completeness: { percent: Math.round(((4 - missing.length) / 4) * 100), missing },
  };
}

export async function updateProfile(input: z.infer<typeof profileSchema>, ctx: Ctx): Promise<void> {
  const [me] = await sql<{ name: string; email: string; job_title: string | null; profile_image: string | null }[]>`
    select name, email::text, job_title, profile_image from users where id = ${ctx.user.id}`;
  let image = me!.profile_image;
  if (input.photoUploadId) image = (await consumeUpload(input.photoUploadId, 'user_photo', ctx.user, `users/${ctx.user.id}`, 'photo')).path;
  else if (input.removePhoto) image = null;
  const changed: Record<string, string> = {};
  if (input.name !== me!.name) changed.name = `${me!.name} → ${input.name}`;
  if (input.email !== me!.email) changed.email = `${me!.email} → ${input.email}`;
  if ((input.jobTitle || null) !== me!.job_title) changed.job_title = input.jobTitle || '(cleared)';
  if (image !== me!.profile_image) changed.profile_photo = image ? 'updated' : 'removed';
  try {
    await transaction(async (tx) => {
      await tx`update users set name = ${input.name}, email = ${input.email}, job_title = ${input.jobTitle || null}, profile_image = ${image} where id = ${ctx.user.id}`;
      if (Object.keys(changed).length) await audit({ userId: ctx.user.id, action: 'profile_updated', entityType: 'user', entityId: ctx.user.id, details: changed, ip: ctx.ip }, tx);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw validationFailed({ email: 'Another account already uses that email address.' });
    throw e;
  }
  if (me!.profile_image && image !== me!.profile_image) await storage.remove(BUCKETS.photos, [me!.profile_image]).catch(() => undefined);
}

/** The current password is checked first; other sessions are signed out afterwards. */
export async function changePassword(input: z.infer<typeof changePasswordSchema>, ctx: Ctx, session: SessionInfo): Promise<void> {
  const [row] = await sql<{ password_hash: string }[]>`select password_hash from users where id = ${ctx.user.id}`;
  if (!(await verifyPassword(input.current, row!.password_hash))) throw validationFailed({ current: 'Your current password is not correct.' });
  if (await verifyPassword(input.password, row!.password_hash)) throw validationFailed({ password: 'Your new password must be different from your current one.' });
  const problems = passwordProblems(input.password, input.confirm);
  if (problems.length) throw validationFailed({ password: passwordRulesSentence(problems) });
  const hash = await hashPassword(input.password);
  await transaction(async (tx) => {
    await tx`update users set password_hash = ${hash}, password_changed_at = now() where id = ${ctx.user.id}`;
    await deleteUserSessions(ctx.user.id, session.id, tx);
    await audit({ userId: ctx.user.id, action: 'password_changed', entityType: 'user', entityId: ctx.user.id, details: { account: ctx.user.name }, ip: ctx.ip }, tx);
  });
}

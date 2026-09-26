import { BLOCKED_SIGN_IN_MESSAGES, ROLE_LABELS, landingPathFor, passwordProblems, passwordRulesSentence } from '../../../shared/domain/access.js';
import type { MeDto } from '../../../shared/api/auth.js';
import { env } from '../../config/env.js';
import { sql, transaction } from '../../db/client.js';
import { audit } from '../../core/audit.js';
import { notify, superAdminIds } from '../../core/notifications.js';
import { hashPassword, sha256, verifyPassword } from '../../lib/crypto.js';
import { AppError, validationFailed } from '../../http/errors.js';
import type { AuthContext } from '../../http/context.js';
import { channels } from '../../realtime/channels.js';
import { emitN8nEvent } from '../../integrations/n8n/n8n.client.js';
import { avatarUrlForUser } from '../media/media.urls.js';
import * as repo from './session.repository.js';

// Compared against when the email is unknown, so both paths cost one bcrypt check.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password-1'));

export async function authenticate(email: string, password: string, ip: string | null) {
  const user = await repo.findUserByEmail(email);
  const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !ok) {
    if (user) await audit({ userId: user.id, action: 'login_failed', entityType: 'user', entityId: user.id, ip });
    throw new AppError(401, 'unauthenticated', 'Invalid email or password.', { password: 'Invalid email or password.' });
  }
  if (!user.active || user.account_status !== 'active') {
    const status = user.account_status === 'active' ? 'disabled' : user.account_status;
    throw new AppError(403, 'account_blocked', BLOCKED_SIGN_IN_MESSAGES[status], undefined, { accountStatus: status });
  }
  await audit({ userId: user.id, action: 'login', entityType: 'user', entityId: user.id, ip });
  return user;
}

export function toMe(auth: AuthContext): MeDto {
  const u = auth.user;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    roleLabel: ROLE_LABELS[u.role],
    accountStatus: u.accountStatus,
    permissions: u.permissions,
    jobTitle: u.jobTitle,
    avatarUrl: avatarUrlForUser(u.id, u.profileImage),
    csrfToken: auth.session.csrfToken,
    landingPath: landingPathFor(u.role),
    realtime: { driver: env.REALTIME_DRIVER, userChannel: channels.user(u.id) },
  };
}

/**
 * A request, not a reset. Only staff accounts can ask, one open request per
 * account, and the reply never reveals whether the address exists.
 */
export async function requestPasswordReset(email: string, reason: string, ip: string | null): Promise<void> {
  const [user] = await sql<{ id: number; name: string; role: keyof typeof ROLE_LABELS }[]>`
    select id, name, role from users
    where email = ${email} and role in ('super_admin','admin','recruiter','hiring_manager') limit 1`;
  if (!user) return;
  const [open] = await sql<{ id: number }[]>`select id from password_reset_requests where user_id = ${user.id} and status = 'pending' limit 1`;
  if (open) return;

  const [created] = await sql<{ id: number }[]>`
    insert into password_reset_requests (user_id, reason, requested_ip)
    values (${user.id}, ${reason ? reason.slice(0, 500) : null}, ${ip}) returning id`;
  if (!created) return;
  await audit({ userId: user.id, action: 'password_reset_requested', entityType: 'user', entityId: user.id, details: { account: user.name, reason }, ip });
  for (const sid of await superAdminIds()) {
    await notify({
      userId: sid,
      actorId: user.id,
      type: 'password_reset',
      title: 'Password reset request',
      body: `${user.name} (${ROLE_LABELS[user.role]}) requested a password reset${reason ? ` — ${reason}` : '.'}`,
      link: '/app/admin/password-resets',
      actionLabel: 'Review request',
      entityType: 'password_reset',
      entityId: created.id,
    });
  }
  emitN8nEvent('password_reset.requested', { requestId: created.id, userId: user.id });
}

interface ResetRow { id: number; user_id: number; name: string; email: string; token_expires_at: Date | null }

/** Expired links are marked expired so they cannot be retried. */
export async function findValidReset(token: string): Promise<ResetRow | null> {
  const [row] = await sql<ResetRow[]>`
    select r.id, r.user_id, u.name, u.email::text, r.token_expires_at
    from password_reset_requests r join users u on u.id = r.user_id
    where r.reset_token_hash = ${sha256(token.toLowerCase())} and r.status = 'approved' limit 1`;
  if (!row) return null;
  if (row.token_expires_at && row.token_expires_at.getTime() < Date.now()) {
    await sql`update password_reset_requests set status = 'expired', reset_token_hash = null where id = ${row.id}`;
    return null;
  }
  return row;
}

export async function completePasswordReset(token: string, password: string, confirm: string, ip: string | null): Promise<void> {
  const row = await findValidReset(token);
  if (!row) throw new AppError(410, 'not_found', 'This reset link is not valid or has expired.');
  const problems = passwordProblems(password, confirm);
  if (problems.length) throw validationFailed({ password: passwordRulesSentence(problems) });
  const hash = await hashPassword(password);
  await transaction(async (tx) => {
    await tx`update users set password_hash = ${hash}, password_changed_at = now() where id = ${row.user_id}`;
    await tx`update password_reset_requests set status = 'used', reset_token_hash = null, token_expires_at = null where id = ${row.id}`;
    await repo.deleteUserSessions(row.user_id, undefined, tx);
    await audit({ userId: row.user_id, action: 'password_reset_completed', entityType: 'user', entityId: row.user_id, details: { account: row.name }, ip }, tx);
  });
}

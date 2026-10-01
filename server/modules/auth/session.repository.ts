import { sql, type Db } from '../../db/client.js';
import type { AccountStatus, PermissionKey, Role } from '../../../shared/domain/access.js';
import type { CurrentUser } from '../../http/context.js';

export interface SessionRow {
  id: string;
  user_id: number;
  csrf_token: string;
  remember: boolean;
  expires_at: Date;
  last_seen_at: Date;
}

export interface UserAuthRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  active: boolean;
  account_status: AccountStatus;
  profile_image: string | null;
  job_title: string | null;
  created_by: number | null;
}

export async function findUserByEmail(email: string): Promise<UserAuthRow | null> {
  const [row] = await sql<UserAuthRow[]>`
    select id, name, email::text, password_hash, role, active, account_status, profile_image, job_title, created_by
    from users where email = ${email} limit 1`;
  return row ?? null;
}

export async function permissionsFor(userId: number, db: Db = sql): Promise<PermissionKey[]> {
  const rows = await db<{ permission: PermissionKey }[]>`select permission from user_permissions where user_id = ${userId}`;
  return rows.map((r) => r.permission);
}

/** Permissions are read fresh on every request, so a change applies on the next call. */
export async function loadActiveUser(userId: number): Promise<CurrentUser | null> {
  const [row] = await sql<(UserAuthRow & { permissions: PermissionKey[] })[]>`
    select u.id, u.name, u.email::text, u.role, u.active, u.account_status, u.profile_image, u.job_title, u.created_by,
           coalesce(array_agg(p.permission) filter (where p.permission is not null), '{}') as permissions
    from users u left join user_permissions p on p.user_id = u.id
    where u.id = ${userId} and u.active
    group by u.id`;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    accountStatus: row.account_status,
    permissions: row.role === 'super_admin'
      ? ['manage_accounts', 'job_management', 'job_posting', 'audit_trail', 'applicant_portal']
      // Account management is the Super Admin's alone, whatever older grants say.
      : row.permissions.filter((p) => p !== 'manage_accounts'),
    profileImage: row.profile_image,
    jobTitle: row.job_title,
    createdBy: row.created_by,
  };
}

export async function createSession(s: {
  id: string; userId: number; csrfToken: string; remember: boolean; expiresAt: Date; ip: string | null; userAgent: string | null;
}): Promise<void> {
  await sql`insert into sessions (id, user_id, csrf_token, remember, expires_at, ip_address, user_agent)
            values (${s.id}, ${s.userId}, ${s.csrfToken}, ${s.remember}, ${s.expiresAt}, ${s.ip}, ${s.userAgent})`;
}

export async function findSession(id: string): Promise<SessionRow | null> {
  const [row] = await sql<SessionRow[]>`
    select id, user_id, csrf_token, remember, expires_at, last_seen_at from sessions where id = ${id} limit 1`;
  return row ?? null;
}

export async function touchSession(id: string, expiresAt: Date): Promise<void> {
  await sql`update sessions set last_seen_at = now(), expires_at = ${expiresAt} where id = ${id}`;
}

export async function deleteSession(id: string): Promise<void> {
  await sql`delete from sessions where id = ${id}`;
}

export async function deleteUserSessions(userId: number, exceptId?: string, db: Db = sql): Promise<void> {
  if (exceptId) await db`delete from sessions where user_id = ${userId} and id <> ${exceptId}`;
  else await db`delete from sessions where user_id = ${userId}`;
}

export async function pruneExpiredSessions(): Promise<void> {
  await sql`delete from sessions where expires_at < now()`;
}

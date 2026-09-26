import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type postgres from 'postgres';

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * Creates the first Super Admin with a generated temporary password.
 * Returns the password, or null when a Super Admin already exists.
 */
export async function createSuperAdmin(sql: postgres.Sql, email: string, name: string): Promise<string | null> {
  const [existing] = await sql<{ count: number }[]>`select count(*)::int as count from users where role = 'super_admin'`;
  if ((existing?.count ?? 0) > 0) return null;
  // Letters and digits only, so it is easy to type once; it always includes both, as the password rules require.
  const password = `${randomBytes(9).toString('base64url').replace(/[-_]/g, 'x')}A7`;
  const hash = await bcrypt.hash(password, 12);
  await sql`insert into users (name, email, password_hash, role, active, account_status)
            values (${name}, ${email.toLowerCase()}, ${hash}, 'super_admin', true, 'active')`;
  return password;
}

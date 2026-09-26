/**
 * Creates the first Super Admin in a fresh database, so you can sign in after deploying.
 * It refuses when a Super Admin already exists. (`npm run setup` does this for you.)
 *
 *   npm run db:create-super-admin -- --email you@company.com --name "Your Name"
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { createSuperAdmin, isEmail } from './lib/super-admin.js';
import { connectTarget } from './lib/target-db.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
const email = values.email?.trim().toLowerCase();
const name = values.name?.trim();
if (!email || !isEmail(email) || !name) {
  console.error('Usage: npm run db:create-super-admin -- --email you@company.com --name "Your Name"');
  process.exit(1);
}

const { sql, host } = connectTarget();
try {
  const password = await createSuperAdmin(sql, email, name);
  if (password === null) {
    console.error(`[super-admin] refused: ${host} already has a Super Admin. Use the app to manage accounts.`);
    process.exitCode = 1;
  } else {
    console.log(`[super-admin] created on ${host}`);
    console.log(`  email:              ${email}`);
    console.log(`  temporary password: ${password}`);
    console.log('  Sign in, then change it under My profile → Change password.');
  }
} catch (e) {
  console.error('[super-admin] failed:', e instanceof Error ? e.message : e);
  console.error('[super-admin] run "npm run db:migrate" first if the tables do not exist yet.');
  process.exitCode = 1;
} finally {
  await sql.end();
}

/**
 * Applies pending SQL migrations from supabase/migrations to DATABASE_URL.
 * Each file runs in its own transaction and is recorded in schema_migrations,
 * so running this twice is safe.
 *
 *   npm run db:migrate
 */
import 'dotenv/config';
import { runMigrations } from './lib/migrations.js';
import { connectTarget } from './lib/target-db.js';

const { sql, executor, host } = connectTarget();
try {
  console.log(`[migrate] target ${host}`);
  const applied = await runMigrations(executor, (m) => console.log(`[migrate] ${m}`));
  console.log(applied ? `[migrate] ${applied} migration(s) applied` : '[migrate] already up to date');
} catch (e) {
  console.error('[migrate] failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end();
}

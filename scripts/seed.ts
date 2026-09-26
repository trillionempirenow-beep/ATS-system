/**
 * Loads the development seed (supabase/seed.sql: demo users, jobs and candidates)
 * into DATABASE_URL. It refuses to touch a database that already has users, and
 * it refuses outright when NODE_ENV=production, so real data is never overwritten.
 *
 *   npm run db:seed
 */
import 'dotenv/config';
import { readSeed } from './lib/migrations.js';
import { connectTarget } from './lib/target-db.js';

if (process.env.NODE_ENV === 'production') {
  console.error('[seed] refused: NODE_ENV=production. The seed is demo data for development only.');
  process.exit(1);
}

const { sql, host } = connectTarget();
try {
  const [row] = await sql<{ count: number }[]>`select count(*)::int as count from users`;
  if ((row?.count ?? 0) > 0) {
    console.error(`[seed] refused: ${host} already has ${row!.count} user(s). The seed only loads into an empty database.`);
    process.exitCode = 1;
  } else {
    await sql.begin(async (tx) => { await tx.unsafe(await readSeed()); });
    console.log(`[seed] demo data loaded into ${host}. Every demo account uses the password "password".`);
  }
} catch (e) {
  console.error('[seed] failed:', e instanceof Error ? e.message : e);
  console.error('[seed] run "npm run db:migrate" first if the tables do not exist yet.');
  process.exitCode = 1;
} finally {
  await sql.end();
}

/**
 * Development-only database: PGlite (Postgres compiled to WASM) exposed over the
 * Postgres wire protocol, so the API connects with the same driver and SQL it
 * uses against Supabase in production. Data lives in .data/pglite.
 *
 *   npm run dev:db              start (migrate + seed on first run)
 *   npm run dev:db -- --reset   wipe .data/pglite first
 */
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { readSeed, runMigrations } from './lib/migrations.js';

const port = Number(process.env.DEV_DB_PORT ?? 54329);
const dataDir = process.env.DEV_DB_DIR ?? '.data/pglite';

if (process.argv.includes('--reset')) {
  await rm(dataDir, { recursive: true, force: true });
  console.log(`[db] wiped ${dataDir}`);
}

await mkdir(path.dirname(dataDir), { recursive: true });
const db = await PGlite.create({ dataDir, extensions: { citext } });

const applied = await runMigrations({
  exec: async (sql) => { await db.exec(sql); },
  query: async <T>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params)).rows,
}, (m) => console.log(`[db] ${m}`));

const [{ count }] = (await db.query<{ count: number }>('select count(*)::int as count from users')).rows as [{ count: number }];
if (count === 0) {
  await db.exec(await readSeed());
  console.log('[db] loaded development seed data (supabase/seed.sql)');
}

const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 8 });
await server.start();
console.log(`[db] PGlite ready on postgres://postgres@127.0.0.1:${port}/postgres (${applied} new migrations)`);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

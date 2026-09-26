import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readSeed, runMigrations } from '../../scripts/lib/migrations.js';

/** One throwaway in-memory Postgres per test run, with the real migrations and seed. */
export default async function setup() {
  const db = await PGlite.create({ extensions: { citext } });
  await runMigrations({
    exec: async (s) => { await db.exec(s); },
    query: async <T>(s: string, p?: unknown[]) => (await db.query<T>(s, p)).rows,
  }, () => undefined);
  await db.exec(await readSeed());
  const port = 54400 + Math.floor(Math.random() * 500);
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 4 });
  await server.start();
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  return async () => {
    await server.stop();
    await db.close();
  };
}

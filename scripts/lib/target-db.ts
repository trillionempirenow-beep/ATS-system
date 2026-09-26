import postgres from 'postgres';
import type { SqlExecutor } from './migrations.js';

/** A direct connection for maintenance scripts. Only DATABASE_URL is needed, not the full app config. */
export function connectTarget(options: { timeZone?: string } = {}) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Point it at the Postgres database to work on (see .env.example).');
    process.exit(1);
  }
  const host = new URL(url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    ssl: local ? false : 'require',
    onnotice: () => undefined,
    connection: options.timeZone ? { TimeZone: options.timeZone } : undefined,
  });
  const executor: SqlExecutor = {
    exec: async (text) => { await sql.unsafe(text); },
    query: async <T>(text: string, params: unknown[] = []) => (await sql.unsafe(text, params as never[])) as unknown as T[],
  };
  return { sql, executor, host: new URL(url).host };
}

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase/migrations');

export async function runMigrations(db: SqlExecutor, log: (msg: string) => void = console.log): Promise<number> {
  await db.exec(`create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )`);
  const applied = new Set((await db.query<{ version: string }>('select version from schema_migrations')).map((r) => r.version));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.exec(`begin;\n${sql}\ninsert into schema_migrations (version) values ('${version}');\ncommit;`);
    log(`applied ${version}`);
    count++;
  }
  return count;
}

export async function readSeed(): Promise<string> {
  return readFile(path.resolve(process.cwd(), 'supabase/seed.sql'), 'utf8');
}

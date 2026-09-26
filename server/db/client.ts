import postgres from 'postgres';
import { env } from '../config/env.js';

/**
 * One pool per process (per warm serverless instance on Vercel). Against
 * Supabase use the transaction pooler URL, which requires prepare: false.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_MAX,
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: env.DATABASE_SSL ? 'require' : undefined,
  types: {
    // Identity keys and count(*) are int8; every value in this schema fits a JS number.
    bigint: {
      to: 20,
      from: [20],
      parse: (value: string) => Number(value),
      serialize: (value: number) => String(value),
    },
  },
  onnotice: () => {},
});

export type Sql = typeof sql;
export type Tx = postgres.TransactionSql;
export type Db = Sql | Tx;

export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(fn) as Promise<T>;
}

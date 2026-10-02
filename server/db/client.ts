import postgres from 'postgres';
import { env } from '../config/env.js';

const connect = () => postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_MAX,
  prepare: false,
  // One query at a time per connection. Pipelining through Supabase's transaction
  // pooler let replies go missing (requests hung until the 30s function timeout)
  // or land on the wrong query (rows of one query returned for another).
  // A supported option that postgres.js 3.4 leaves out of its types.
  ...({ max_pipeline: 1 } as object),
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

type Pool = ReturnType<typeof connect>;

/**
 * Vercel freezes an instance between requests. Connections left open across a
 * freeze can be dead when it thaws, and a query sent on one waits until the
 * function times out. Opening new connections on every request is slow too
 * (each one is a TLS handshake and a sign-in at the pooler), so after a quiet
 * spell the first request checks the connections with a quick query and only
 * replaces them when they do not answer. After a long freeze they are replaced
 * straight away: the network drops idle connections after a few minutes.
 */
const CHECK_AFTER_MS = 5_000;
const REPLACE_AFTER_MS = 4 * 60_000;
const CHECK_TIMEOUT_MS = 1_500;
let pool: Pool = connect();
let lastActivity = Date.now();
let inFlight = 0;

function swapPool(graceSeconds: number): void {
  const old = pool;
  pool = connect();
  void old.end({ timeout: graceSeconds }).catch(() => undefined);
}

/**
 * A request that is still waiting long after it should have answered is almost
 * always stuck on a dead connection. Replace the pool now, so the requests that
 * follow get fresh connections instead of queueing behind the dead ones.
 */
let lastReset = 0;
export function resetDbPool(): void {
  // Several requests stuck together need one fresh pool, not one each.
  if (Date.now() - lastReset < 5_000) return;
  lastReset = Date.now();
  console.warn('[db] a request got stuck; starting fresh connections');
  // The old pool keeps serving the requests already running on it; only
  // connections still busy after 30s (the stuck ones) are closed.
  swapPool(30);
}

let checking: Promise<void> | null = null;

/** Call (and await) before beginDbRequest: makes sure the pool answers after a quiet spell. */
export function prepareDb(): Promise<void> {
  if (checking) return checking;
  const idle = Date.now() - lastActivity;
  if (inFlight > 0 || idle <= CHECK_AFTER_MS) return Promise.resolve();
  if (idle > REPLACE_AFTER_MS) {
    // Background work that outlived its request gets a few seconds to finish.
    swapPool(5);
    return Promise.resolve();
  }
  checking = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answered = await Promise.race([
      Promise.resolve(pool`select 1`).then(() => true, () => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS); }),
    ]);
    clearTimeout(timer);
    if (!answered) {
      console.warn('[db] connections did not answer after a pause; starting fresh ones');
      swapPool(5);
    }
    lastActivity = Date.now();
  })().finally(() => { checking = null; });
  return checking;
}

/** Call at the start of each request; call the returned function when it finishes. */
export function beginDbRequest(): () => void {
  inFlight++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    inFlight--;
    lastActivity = Date.now();
  };
}

/** One pool per process, swapped by beginDbRequest; callers use it like the plain postgres.js instance. */
export const sql = new Proxy((() => undefined) as unknown as Pool, {
  apply: (_target, _this, args: unknown[]) => Reflect.apply(pool as unknown as (...a: unknown[]) => unknown, undefined, args),
  get: (_target, prop) => {
    const value = Reflect.get(pool, prop) as unknown;
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(pool) : value;
  },
});

export type Sql = Pool;
export type Tx = postgres.TransactionSql;
export type Db = Sql | Tx;

export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(fn) as Promise<T>;
}

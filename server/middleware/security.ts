import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { sql } from '../db/client.js';
import { safeEqual } from '../lib/crypto.js';
import { AppError, tooManyRequests } from '../http/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const allowedOrigin = new URL(env.APP_URL).origin;

/**
 * Two layers for every state-changing request:
 *  1. The Origin (or Referer) must be this app — stops cross-site form posts,
 *     including on the public endpoints that have no session.
 *  2. With a session, the X-CSRF-Token header must match the session's token.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  // Cron calls carry CRON_SECRET; local storage PUTs carry a signed grant.
  if (req.path.startsWith('/v1/cron/') || req.path.startsWith('/v1/uploads/local/')) return next();

  const origin = req.get('origin') ?? (req.get('referer') ? new URL(req.get('referer') as string).origin : null);
  const selfOrigin = `${req.protocol}://${req.get('host')}`;
  if (origin && origin !== allowedOrigin && origin !== selfOrigin) {
    return next(new AppError(403, 'csrf_failed', 'This request came from another site and was blocked.'));
  }
  if (req.auth) {
    const header = req.get('x-csrf-token') ?? '';
    if (!header || !safeEqual(header, req.auth.session.csrfToken)) {
      return next(new AppError(403, 'csrf_failed', 'Your session token is out of date. Reload the page and try again.'));
    }
  }
  next();
}

/**
 * Fixed-window limiter stored in Postgres, so it holds across serverless
 * instances. One upsert per request that uses it.
 */
export function rateLimit(opts: { name: string; max: number; windowSeconds: number; key?: (req: Request) => string }) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const who = opts.key ? opts.key(req) : (req.ip ?? 'unknown');
    const bucket = `${opts.name}:${who}`;
    const [row] = await sql<{ hits: number }[]>`
      insert into rate_limits (bucket, window_start, hits) values (${bucket}, now(), 1)
      on conflict (bucket) do update set
        hits = case when rate_limits.window_start < now() - make_interval(secs => ${opts.windowSeconds}) then 1 else rate_limits.hits + 1 end,
        window_start = case when rate_limits.window_start < now() - make_interval(secs => ${opts.windowSeconds}) then now() else rate_limits.window_start end
      returning hits`;
    if ((row?.hits ?? 0) > opts.max) return next(tooManyRequests());
    next();
  };
}

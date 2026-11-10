import type { Request, Response } from 'express';

/**
 * Server-Timing for every API response, so the browser's Network tab (Timing) shows
 * where a slow request spent its time:
 *   dbcheck  checking the database connections after a pause (prepareDb)
 *   session  loading the signed-in user from the session cookie
 *   app      the route itself (its queries and work)
 *   total    everything the server did, from first byte in to headers out
 *   cold     present on the first request a new server instance answers
 *   region   where the function ran (VERCEL_REGION), to confirm it sits next to the database
 * Durations only: no data, ids or query text.
 */

let coldStart = true;
const REGION = process.env.VERCEL_REGION ?? 'local';

interface Marks { start: number; dbcheck: number; session: number; cold: boolean }

const now = () => performance.now();

/** Call first thing in the request. Returns helpers for the later marks. */
export function startTiming(_req: Request, res: Response): { afterDbCheck: () => void } {
  const marks: Marks = { start: now(), dbcheck: 0, session: 0, cold: coldStart };
  coldStart = false;
  res.locals.timing = marks;

  // Write the header at the last moment before the status line goes out.
  const writeHead = res.writeHead;
  res.writeHead = function patched(this: Response, ...args: Parameters<Response['writeHead']>) {
    if (!res.headersSent) {
      const total = now() - marks.start;
      const app = Math.max(0, total - marks.dbcheck - marks.session);
      const parts = [
        `total;dur=${total.toFixed(1)}`,
        `dbcheck;dur=${marks.dbcheck.toFixed(1)}`,
        `session;dur=${marks.session.toFixed(1)}`,
        `app;dur=${app.toFixed(1)}`,
        `region;desc="${REGION}"`,
      ];
      if (marks.cold) parts.push('cold;desc="new server instance"');
      res.setHeader('Server-Timing', parts.join(', '));
    }
    return writeHead.apply(this, args) as Response;
  } as Response['writeHead'];

  return { afterDbCheck: () => { marks.dbcheck = now() - marks.start; } };
}

/**
 * Runs a middleware and reports the time until it hands on (calls next) as `name`.
 * Only "session" is used: it measures the session lookup, not the route after it.
 */
export function timed(
  mw: (req: Request, res: Response, next: (err?: unknown) => void) => unknown,
): (req: Request, res: Response, next: (err?: unknown) => void) => unknown {
  return (req, res, next) => {
    const t0 = now();
    return mw(req, res, (err?: unknown) => {
      const marks = res.locals.timing as Marks | undefined;
      if (marks) marks.session = now() - t0;
      next(err);
    });
  };
}

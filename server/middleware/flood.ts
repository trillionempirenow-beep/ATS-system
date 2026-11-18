import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '../../shared/api/envelope.js';

const WINDOW_MS = 60_000;
/** Past this many addresses the table is cleared rather than grown: a spoofed-address flood cannot exhaust memory. */
const MAX_TRACKED = 50_000;

/**
 * A request budget per IP address, kept in this server instance's memory. It runs
 * before anything touches the database, so a flood is turned away cheaply instead
 * of becoming database load. The per-route limits in security.ts (stored in the
 * database, shared by every instance) still guard sign-in and other sensitive actions.
 *
 * This is the app's own last line. Volumetric attacks are the hosting platform's job:
 * see docs/SECURITY.md for the Vercel Firewall settings.
 */
export function floodGuard(perMinute: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let sweepAt = Date.now() + WINDOW_MS;
  return (req: Request, res: Response, next: NextFunction): void => {
    if (perMinute <= 0) return next();
    const now = Date.now();
    if (now > sweepAt) {
      for (const [ip, e] of hits) if (e.resetAt <= now) hits.delete(ip);
      sweepAt = now + WINDOW_MS;
    }
    if (hits.size > MAX_TRACKED) hits.clear();
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    let entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      hits.set(ip, entry);
    }
    entry.count++;
    if (entry.count > perMinute) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      res.set('Cache-Control', 'no-store');
      res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' } } satisfies ApiErrorBody);
      return;
    }
    next();
  };
}

import { env } from '../../config/env.js';
import { hmac, safeEqual } from '../../lib/crypto.js';

/**
 * Signed, expiring tokens for the assistant, so nothing needs storing between
 * the n8n run and the person's Confirm:
 *  - run:    lets the n8n workflow call the lookup and propose tools as this person, for a few minutes.
 *  - action: a change the assistant prepared; confirming it runs it as the same person.
 *  - undo:   reverses a confirmed stage move.
 * Format: "ats1.<payload>.<signature>"; the payload is readable JSON, the signature stops edits.
 */
type Purpose = 'run' | 'action' | 'undo';

const SECRET = () => `${env.SESSION_SECRET}:assistant`;
const LIFETIME: Record<Purpose, number> = { run: 5 * 60, action: 30 * 60, undo: 30 * 60 };

export const TOKEN_PATTERN = /ats1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

export function signToken<T extends object>(purpose: Purpose, userId: number, data: T): string {
  const payload = Buffer.from(JSON.stringify({ p: purpose, u: userId, x: Math.floor(Date.now() / 1000) + LIFETIME[purpose], d: data })).toString('base64url');
  return `ats1.${payload}.${hmac(payload, SECRET())}`;
}

/** The data, or null when the token is forged, expired, for another purpose or another person. */
export function readToken<T>(token: string, purpose: Purpose, userId?: number): (T & { userId: number }) | null {
  const [v, payload, sig] = token.split('.');
  if (v !== 'ats1' || !payload || !sig || !safeEqual(sig, hmac(payload, SECRET()))) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { p: Purpose; u: number; x: number; d: T };
    if (body.p !== purpose || body.x < Date.now() / 1000) return null;
    if (userId !== undefined && body.u !== userId) return null;
    return { ...body.d, userId: body.u };
  } catch {
    return null;
  }
}

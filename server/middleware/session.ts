import type { NextFunction, Request, Response } from 'express';
import { isProduction } from '../config/env.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import * as sessions from '../modules/auth/session.repository.js';
import type { SessionInfo } from '../http/context.js';

export const SESSION_COOKIE = isProduction ? '__Host-acme_sid' : 'acme_sid';
const SHORT_TTL_MS = 12 * 60 * 60 * 1000;
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

const ttl = (remember: boolean) => (remember ? REMEMBER_TTL_MS : SHORT_TTL_MS);

function setCookie(res: Response, token: string, expires: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    expires,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
}

/** Issues a fresh session (a new id on every sign in defeats fixation). */
export async function startSession(req: Request, res: Response, userId: number, remember: boolean): Promise<SessionInfo> {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const expiresAt = new Date(Date.now() + ttl(remember));
  const id = sha256(token);
  await sessions.createSession({
    id,
    userId,
    csrfToken: csrf,
    remember,
    expiresAt,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
  });
  setCookie(res, token, expiresAt);
  return { id, csrfToken: csrf, remember, expiresAt };
}

/** Loads req.auth when a valid session cookie is present. Never rejects on its own. */
export async function loadSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length < 20) return next();

  const id = sha256(token);
  const row = await sessions.findSession(id);
  if (!row || row.expires_at.getTime() < Date.now()) {
    if (row) await sessions.deleteSession(id);
    clearSessionCookie(res);
    req.sessionExpired = true;
    return next();
  }
  const user = await sessions.loadActiveUser(row.user_id);
  if (!user) {
    await sessions.deleteSession(id);
    clearSessionCookie(res);
    req.sessionExpired = true;
    return next();
  }

  let expiresAt = row.expires_at;
  if (Date.now() - row.last_seen_at.getTime() > TOUCH_EVERY_MS) {
    expiresAt = new Date(Date.now() + ttl(row.remember));
    await sessions.touchSession(id, expiresAt);
    setCookie(res, token, expiresAt);
  }
  req.auth = { user, session: { id, csrfToken: row.csrf_token, remember: row.remember, expiresAt } };
  next();
}

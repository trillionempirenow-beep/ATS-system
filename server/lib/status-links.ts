import { appLink } from '../email/brand.js';
import { hmac, safeEqual } from './crypto.js';

/**
 * Applicants have no account, so their status page is opened with a signed link: the
 * application ID and email alone are not enough (anyone may know someone's email, and IDs
 * are sequential). The key is an HMAC with the server secret, so it cannot be guessed and
 * never needs storing. Rotating SESSION_SECRET retires every key; applicants then request
 * fresh links on the status page.
 */
export const statusKey = (applicationId: number, email: string): string =>
  hmac(`status:${applicationId}:${email.trim().toLowerCase()}`).slice(0, 32);

export const statusKeyValid = (applicationId: number, email: string, key: string): boolean =>
  key.length > 0 && safeEqual(key, statusKey(applicationId, email));

/** The path within the app, e.g. for a redirect right after applying. */
export const statusPath = (applicationId: number, email: string): string =>
  `/status?email=${encodeURIComponent(email)}&id=${applicationId}&k=${statusKey(applicationId, email)}`;

/** The full link, for emails and calendar invites. */
export const statusLink = (applicationId: number, email: string): string => appLink(statusPath(applicationId, email));

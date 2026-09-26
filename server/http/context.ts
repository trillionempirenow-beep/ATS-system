import type { Request } from 'express';
import type { PermissionKey, Role, AccountStatus } from '../../shared/domain/access.js';

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  accountStatus: AccountStatus;
  permissions: PermissionKey[];
  profileImage: string | null;
  jobTitle: string | null;
  createdBy: number | null;
}

export interface SessionInfo {
  id: string;
  csrfToken: string;
  remember: boolean;
  expiresAt: Date;
}

export interface AuthContext {
  user: CurrentUser;
  session: SessionInfo;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    /** Set when a session cookie was sent but has expired or was revoked. */
    sessionExpired?: boolean;
  }
}

export function clientIp(req: Request): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

/** For handlers behind requireAuth. */
export function currentUser(req: Request): CurrentUser {
  if (!req.auth) throw new Error('currentUser() used on a route without requireAuth');
  return req.auth.user;
}

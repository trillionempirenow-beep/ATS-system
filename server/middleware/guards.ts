import type { NextFunction, Request, Response } from 'express';
import {
  ADMIN_PERMISSION_CATALOG,
  ROLE_LABELS,
  canPublishJobs,
  hasPermission,
  isAdminLevel,
  isSuperAdmin,
  roleAllowed,
  type PermissionKey,
  type Role,
} from '../../shared/domain/access.js';
import { AppError, forbidden } from '../http/errors.js';

type Handler = (req: Request, res: Response, next: NextFunction) => void;

export const requireAuth: Handler = (req, _res, next) => {
  if (req.auth) return next();
  next(
    req.sessionExpired
      ? new AppError(401, 'session_expired', 'Your session has ended. Please sign in again.')
      : new AppError(401, 'unauthenticated', 'Please sign in to continue.'),
  );
};

/** require_login([...]) — a Super Admin passes every role gate, as in the PHP app. */
export function requireRoles(...roles: Role[]): Handler {
  return (req, _res, next) => {
    const user = req.auth?.user;
    if (!user) return requireAuth(req, _res, next);
    if (roleAllowed(user, roles)) return next();
    next(forbidden(`This area is limited to: ${roles.map((r) => ROLE_LABELS[r]).join(', ')}.`, { kind: 'role', roles }));
  };
}

export const STAFF = ['admin', 'recruiter', 'hiring_manager'] as const satisfies Role[];
export const requireStaff = requireRoles(...STAFF);

export function requirePermission(permission: PermissionKey): Handler {
  return (req, _res, next) => {
    const user = req.auth?.user;
    if (!user) return requireAuth(req, _res, next);
    if (hasPermission(user, permission)) return next();
    const label = ADMIN_PERMISSION_CATALOG[permission].label;
    next(forbidden(`This area requires the "${label}" permission, which has not been granted to your account.`, { kind: 'permission', permission }));
  };
}

export function requireAnyPermission(...permissions: PermissionKey[]): Handler {
  return (req, _res, next) => {
    const user = req.auth?.user;
    if (!user) return requireAuth(req, _res, next);
    if (permissions.some((p) => hasPermission(user, p))) return next();
    next(forbidden('You do not have the permission this area needs.', { kind: 'permission', permission: permissions[0] }));
  };
}

export const requireSuperAdmin: Handler = (req, _res, next) => {
  const user = req.auth?.user;
  if (!user) return requireAuth(req, _res, next);
  if (isSuperAdmin(user)) return next();
  next(forbidden('Only a Super Admin can open this area.', { kind: 'super_admin' }));
};

export const requireAdminLevel: Handler = (req, _res, next) => {
  const user = req.auth?.user;
  if (!user) return requireAuth(req, _res, next);
  if (isAdminLevel(user)) return next();
  next(forbidden('Only an Admin or Super Admin can open this area.', { kind: 'admin_level' }));
};

export const requireCanPublish: Handler = (req, _res, next) => {
  const user = req.auth?.user;
  if (!user) return requireAuth(req, _res, next);
  if (canPublishJobs(user)) return next();
  next(forbidden('Reviewing and publishing job postings is limited to Admins with the "Job posting" permission.', { kind: 'publish' }));
};

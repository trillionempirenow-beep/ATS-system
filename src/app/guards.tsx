import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { PermissionKey, Role } from '@shared/domain/access';
import { PageSpinner } from '@/components/ui/Feedback';
import { useAuth } from './providers/AuthProvider';
import { START_PAGE_PATHS, usePreferences } from './providers/PreferencesProvider';
import { ForbiddenPage } from './system/StatusPages';

/**
 * Client guards mirror the server's require_*() checks so people see the right
 * screen. They are a courtesy: every API call is authorised again on the server.
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { user, loading, signedOut } = useAuth();
  const location = useLocation();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to={signedOut ? '/login' : `/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children ?? <Outlet />}</>;
}

export function RequireRoles({ roles, children }: { roles: Role[]; children?: ReactNode }) {
  const { can } = useAuth();
  if (!can.roles(...roles)) return <ForbiddenPage reason={{ kind: 'role' }} />;
  return <>{children ?? <Outlet />}</>;
}

export function RequirePermission({ permission, children }: { permission: PermissionKey; children?: ReactNode }) {
  const { can } = useAuth();
  if (!can.permission(permission)) return <ForbiddenPage reason={{ kind: 'permission', permission }} />;
  return <>{children ?? <Outlet />}</>;
}

export function RequireAnyPermission({ permissions, children }: { permissions: PermissionKey[]; children?: ReactNode }) {
  const { can } = useAuth();
  if (!permissions.some((p) => can.permission(p))) return <ForbiddenPage reason={{ kind: 'permission', permission: permissions[0]! }} />;
  return <>{children ?? <Outlet />}</>;
}

export function RequireSuperAdmin({ children }: { children?: ReactNode }) {
  const { can } = useAuth();
  if (!can.superAdmin) return <ForbiddenPage reason={{ kind: 'super_admin' }} />;
  return <>{children ?? <Outlet />}</>;
}

export function RequireAdminLevel({ children }: { children?: ReactNode }) {
  const { can } = useAuth();
  if (!can.adminLevel) return <ForbiddenPage reason={{ kind: 'admin_level' }} />;
  return <>{children ?? <Outlet />}</>;
}

export function RequireCanPublish({ children }: { children?: ReactNode }) {
  const { can } = useAuth();
  if (!can.publish) return <ForbiddenPage reason={{ kind: 'publish' }} />;
  return <>{children ?? <Outlet />}</>;
}

const START_FLAG = 'acme-start-page-used';
const startPageUsed = () => { try { return Boolean(sessionStorage.getItem(START_FLAG)); } catch { return true; } };
const markStartPageUsed = () => { try { sessionStorage.setItem(START_FLAG, '1'); } catch { /* nothing to remember */ } };

/** /app itself: each role lands on its own home. */
export function RoleLanding({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { prefs } = usePreferences();
  const navigate = useNavigate();
  // Once per sign-in, staff land on the page they chose in Settings. After that "Overview" means the overview.
  const [redirecting] = useState(() => prefs.startPage !== 'overview' && !startPageUsed());
  useEffect(() => {
    if (!redirecting) return;
    markStartPageUsed();
    navigate(START_PAGE_PATHS[prefs.startPage], { replace: true });
  }, [redirecting, navigate, prefs.startPage]);
  if (user?.role === 'super_admin') return <Navigate to="/app/admin/admins" replace />;
  if (user?.role === 'employee') return <Navigate to="/app/attendance" replace />;
  return redirecting ? null : <>{children}</>;
}

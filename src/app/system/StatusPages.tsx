import type { ReactNode } from 'react';
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';
import { ADMIN_PERMISSION_CATALOG, type PermissionKey } from '@shared/domain/access';
import { Button, ButtonLink } from '@/components/ui/Button';
import { useAuth } from '../providers/AuthProvider';
import { ApiError } from '@/lib/api';
import { cx } from '@/lib/cx';
import s from './System.module.css';

function StatusCard({ code, title, text, note, actions }: { code: 403 | 404 | 500; title: string; text: ReactNode; note?: ReactNode; actions: ReactNode }) {
  return (
    <div className={s.wrap}>
      <div className={s.card}>
        <span className={cx(s.code, s[`code${code}`])}>Error {code}</span>
        <h1 className={s.title}>{title}</h1>
        <p className={s.text}>{text}</p>
        {note ? <p className={s.note}>{note}</p> : null}
        <div className={s.actions}>{actions}</div>
      </div>
    </div>
  );
}

function useHome(): { to: string; label: string } {
  const { user } = useAuth();
  if (!user) return { to: '/', label: 'Back to careers' };
  if (user.role === 'super_admin') return { to: '/app/admin/admins', label: 'Back to administration' };
  if (user.role === 'employee') return { to: '/app/attendance', label: 'Back to attendance' };
  return { to: '/app', label: 'Back to overview' };
}

export type ForbiddenKind = { kind: 'permission'; permission: PermissionKey } | { kind: 'admin_level' } | { kind: 'super_admin' } | { kind: 'role' } | { kind: 'publish' };

export function ForbiddenPage({ reason, message }: { reason: ForbiddenKind; message?: string }) {
  const home = useHome();
  const { can } = useAuth();
  const text =
    message ??
    (reason.kind === 'permission'
      ? `This area requires the “${ADMIN_PERMISSION_CATALOG[reason.permission].label}” permission, which has not been granted to your account.`
      : reason.kind === 'admin_level'
        ? 'Only an Admin or Super Admin can open this area.'
        : reason.kind === 'super_admin'
          ? 'Only a Super Admin can open this area.'
          : reason.kind === 'publish'
            ? 'Reviewing job postings is limited to Admins with the “Job posting” permission.'
            : 'Your role does not include this area.');
  return (
    <StatusCard
      code={403}
      title="Not authorised"
      text={text}
      note={`If you believe you should have access, ask your ${can.adminLevel ? 'Super Admin' : 'Admin'} to grant the matching permission.`}
      actions={<ButtonLink variant="secondary" to={home.to}>{home.label}</ButtonLink>}
    />
  );
}

export function NotFoundPage() {
  const home = useHome();
  const { can } = useAuth();
  return (
    <StatusCard
      code={404}
      title="We could not find that page"
      text="The link may be out of date, or the record was removed. Check the address or go back."
      actions={
        <>
          <ButtonLink variant="secondary" to={home.to}>{home.label}</ButtonLink>
          {can.roles('admin', 'recruiter', 'hiring_manager') ? <ButtonLink variant="ghost" to="/app/candidates">Go to candidates</ButtonLink> : null}
        </>
      }
    />
  );
}

export function ServerErrorPage({ onRetry }: { onRetry?: () => void }) {
  const home = useHome();
  return (
    <StatusCard
      code={500}
      title="Something went wrong"
      text="The page could not load. Your data is safe. Try again, and if it keeps happening tell your Admin what you were doing."
      actions={
        <>
          <Button variant="primary" icon="refresh" onClick={onRetry ?? (() => window.location.reload())}>Try again</Button>
          <ButtonLink variant="secondary" to={home.to}>{home.label}</ButtonLink>
        </>
      }
    />
  );
}

/** Maps an API error from a page's main query to the matching full-page state. */
export function QueryErrorPage({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      const d = error.details as { kind?: string; permission?: PermissionKey };
      const reason: ForbiddenKind = d.kind === 'permission' && d.permission ? { kind: 'permission', permission: d.permission }
        : d.kind === 'super_admin' ? { kind: 'super_admin' } : d.kind === 'admin_level' ? { kind: 'admin_level' } : d.kind === 'publish' ? { kind: 'publish' } : { kind: 'role' };
      return <ForbiddenPage reason={reason} message={error.message} />;
    }
    if (error.status === 404) return <NotFoundPage />;
  }
  return <ServerErrorPage onRetry={onRetry} />;
}

/** Route-level error element: a thrown component never takes the shell down with it. */
export function RouteErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  console.error(error);
  return <ServerErrorPage onRetry={() => navigate(0)} />;
}

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { loginSchema, type LoginInput, type MeDto } from '@shared/api/auth';
import type { AccountStatus } from '@shared/domain/access';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, PasswordInput, TextInput } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Feedback';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/app/providers/AuthProvider';
import s from './Auth.module.css';

const BLOCKED: Record<Exclude<AccountStatus, 'active'>, [string, string]> = {
  pending: ['Your account is waiting for approval.', 'A Super Admin has to approve it before you can sign in.'],
  suspended: ['This account is suspended.', 'Ask your Admin to request reactivation.'],
  disabled: ['This account has been disabled.', 'Please contact your Admin.'],
  rejected: ['This account was not approved.', 'Please contact your Admin.'],
  pending_reactivation: ['Reactivation is waiting for approval.', 'A Super Admin has to approve the reactivation before you can sign in.'],
};

/** Only same-app paths are followed after sign in. */
function safeNext(next: string | null, fallback: string): string {
  return next && next.startsWith('/app') && !next.startsWith('//') ? next : fallback;
}

export function LoginPage() {
  const { user, setUser } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<{ title: string; body: string } | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', remember: false },
  });

  if (user) return <Navigate to={safeNext(params.get('next'), user.landingPath)} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setProblem(null);
    try {
      const me = await api.post<MeDto>('/auth/login', values);
      setUser(me);
      navigate(safeNext(params.get('next'), me.landingPath), { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'account_blocked') {
        const status = (e.details.accountStatus as Exclude<AccountStatus, 'active'>) ?? 'disabled';
        const [title, body] = BLOCKED[status] ?? [e.message, ''];
        setProblem({ title, body });
      } else if (e instanceof ApiError && e.status === 401) {
        setProblem({ title: 'Email or password is incorrect.', body: 'Check your details and try again.' });
      } else if (e instanceof ApiError && e.code === 'rate_limited') {
        setProblem({ title: 'Too many attempts.', body: 'Wait a few minutes before trying again.' });
      } else {
        setProblem({ title: 'We could not sign you in.', body: e instanceof Error ? e.message : 'Please try again.' });
      }
    }
  });

  return (
    <>
      <div className={s.head}>
        <h2 className={s.title}>Sign in</h2>
        <p className={s.sub}>For authorised Acme recruiting and HR staff.</p>
      </div>
      {problem ? <Notice tone="danger" title={problem.title}>{problem.body}</Notice> : null}
      <form className={s.form} onSubmit={onSubmit} noValidate>
        <Field label="Email address" error={errors.email?.message}>
          <TextInput type="email" icon="mail" autoComplete="username" placeholder="you@acme.test" {...register('email')} data-autofocus />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <PasswordInput autoComplete="current-password" placeholder="Your password" {...register('password')} />
        </Field>
        <div className={s.row}>
          <Checkbox label="Remember me" {...register('remember')} />
          <Link to="/forgot-password" className={s.link}>Forgot password?</Link>
        </div>
        <Button type="submit" fullWidth loading={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      <p className={s.foot}>Password resets for staff accounts are approved by a Super Admin.</p>
    </>
  );
}

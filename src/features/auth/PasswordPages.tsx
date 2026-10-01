import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { forgotPasswordSchema, newPasswordFields, type ForgotPasswordInput, type ResetTokenCheckDto } from '@shared/api/auth';
import { PASSWORD_RULES_HINT, passwordProblems, passwordRulesSentence } from '@shared/domain/access';
import { Icon } from '@/components/icon/Icon';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Field, PasswordInput, TextInput, Textarea } from '@/components/ui/Form';
import { Notice, Spinner } from '@/components/ui/Feedback';
import { api, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { useAuth } from '@/app/providers/AuthProvider';
import s from './Auth.module.css';

function BackToSignIn() {
  return <Link to="/login" className={s.back}><Icon name="arrowl" size={16} />Back to sign in</Link>;
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  if (sent) {
    return (
      <>
        <div className={s.head}>
          <h2 className={s.title}>Request sent</h2>
          <p className={s.sub}>A Super Admin will review your request. If it is approved, they will send you a one-time reset link.</p>
        </div>
        <BackToSignIn />
      </>
    );
  }
  return (
    <>
      <div className={s.head}>
        <h2 className={s.title}>Forgotten password</h2>
        <p className={s.sub}>Ask a Super Admin to approve a one-time reset link.</p>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <form className={s.form} noValidate onSubmit={handleSubmit(async (v) => {
        setError(null);
        try { await api.post('/auth/forgot-password', v); setSent(true); } catch (e) { setError(errorMessage(e)); }
      })}>
        <Field label="Email" required error={errors.email?.message}>
          <TextInput type="email" icon="mail" autoComplete="email" {...register('email')} data-autofocus />
        </Field>
        <Field label="Reason" optional hint="For example: locked out after changing phones." error={errors.reason?.message}>
          <Textarea rows={3} maxLength={500} {...register('reason')} />
        </Field>
        <Button type="submit" fullWidth loading={isSubmitting}>Submit request</Button>
      </form>
      <p className={s.foot}>Applicants do not need an account. Use “Check your application” on the careers site instead.</p>
      <BackToSignIn />
    </>
  );
}

const resetFormSchema = z.object(newPasswordFields).superRefine((v, ctx) => {
  const problems = passwordProblems(v.password, v.confirm);
  if (problems.length) ctx.addIssue({ code: 'custom', path: [problems.includes('match the confirmation field') && problems.length === 1 ? 'confirm' : 'password'], message: passwordRulesSentence(problems) });
});
type ResetForm = z.infer<typeof resetFormSchema>;

export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const check = useQuery({ queryKey: ['reset-check', token], queryFn: () => api.get<ResetTokenCheckDto>(`/auth/reset-password/${encodeURIComponent(token)}`), retry: false });
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<ResetForm>({ resolver: zodResolver(resetFormSchema) });

  if (check.isLoading) return <div className={s.center}><Spinner /></div>;
  if (done) {
    return (
      <>
        <div className={s.head}>
          <h2 className={s.title}>Password updated</h2>
          <p className={s.sub}>You can sign in with your new password now.</p>
        </div>
        <Button fullWidth onClick={() => navigate('/login')}>Go to sign in</Button>
      </>
    );
  }
  if (!check.data?.valid) {
    return (
      <>
        <div className={s.head}>
          <h2 className={s.title}>This link is not valid</h2>
          <p className={s.sub}>It may have expired or already been used. Reset links work once.</p>
        </div>
        <ButtonLink to="/forgot-password" fullWidth>Request a reset</ButtonLink>
        <BackToSignIn />
      </>
    );
  }
  return (
    <>
      <div className={s.head}>
        <h2 className={s.title}>Set a new password</h2>
        <p className={s.sub}>You are setting a new password for <strong>{check.data.email}</strong>. This link works once.</p>
      </div>
      {formError ? <Notice tone="danger">{formError}</Notice> : null}
      <form className={s.form} noValidate onSubmit={handleSubmit(async (v) => {
        setFormError(null);
        try {
          await api.post('/auth/reset-password', { token, ...v });
          setDone(true);
        } catch (e) {
          setFormError(applyServerErrors(e, setError, ['password', 'confirm']));
        }
      })}>
        <Field label="New password" hint={PASSWORD_RULES_HINT} error={errors.password?.message}>
          <PasswordInput autoComplete="new-password" {...register('password')} data-autofocus />
        </Field>
        <Field label="Confirm new password" error={errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...register('confirm')} />
        </Field>
        <Button type="submit" fullWidth loading={isSubmitting}>Set new password</Button>
      </form>
    </>
  );
}

/** E07: shown in place of the app when the API reports the session is gone. */
export function SessionEndedPage() {
  const { clearSessionEnded } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div className={s.head}>
        <h2 className={s.title}>You were signed out</h2>
        <p className={s.sub}>Your session ended after a period of inactivity. Sign in again to pick up where you left off. Nothing you saved was lost.</p>
      </div>
      <Button fullWidth onClick={() => { clearSessionEnded(); navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`); }}>Sign in again</Button>
      <p className={s.foot}>You will return to the page you were on.</p>
    </>
  );
}

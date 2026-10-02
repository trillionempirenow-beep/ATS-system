import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { referralSchema } from '@shared/api/public';
import { Icon } from '@/components/icon/Icon';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Field, Select, TextInput, Textarea, formStyles } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Feedback';
import { Card } from '@/components/ui/Surface';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { usePublicJobs } from './api';
import s from './Careers.module.css';

const formSchema = referralSchema.omit({ jobId: true }).extend({ jobId: z.string().optional() });
type FormValues = z.input<typeof formSchema>;

export function ReferPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobs = usePublicJobs({});
  useEffect(() => { document.title = 'Refer someone · Careers'; }, []);
  const { register, handleSubmit, setError: setFieldError, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  if (sent) {
    return (
      <div className={s.result} role="status">
        <span className={s.resultIcon}><Icon name="checkcircle" size={28} /></span>
        <h1 className={s.resultTitle}>Thanks for the referral!</h1>
        <p style={{ color: 'var(--text2)' }}>We appreciate you helping us find great people. We will reach out to them soon.</p>
        <ButtonLink to="/jobs">Back to jobs</ButtonLink>
      </div>
    );
  }
  return (
    <div className={s.narrow}>
      <header className={s.pageHead} style={{ alignItems: 'center', textAlign: 'center' }}>
        <h1 className={s.statusTitle} style={{ fontSize: 36, lineHeight: '44px' }}>Know someone great?</h1>
        <p className={s.lead}>Send them a role that could be the start of something meaningful.</p>
      </header>
      <Card padding={24}>
        <form className={formStyles.stack} noValidate onSubmit={handleSubmit(async (v) => {
          setError(null);
          try {
            await api.post('/public/referrals', { ...v, jobId: v.jobId ? Number(v.jobId) : null });
            setSent(true);
          } catch (e) {
            setError(applyServerErrors(e, setFieldError, ['referrerName', 'referrerEmail', 'candidateName', 'candidateEmail', 'note']));
          }
        })}>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <div className={formStyles.grid2}>
            <Field label="Your name" required error={errors.referrerName?.message}><TextInput autoComplete="name" {...register('referrerName')} /></Field>
            <Field label="Your email" required error={errors.referrerEmail?.message}><TextInput type="email" autoComplete="email" {...register('referrerEmail')} /></Field>
            <Field label="Friend’s name" required error={errors.candidateName?.message}><TextInput {...register('candidateName')} /></Field>
            <Field label="Friend’s email" required error={errors.candidateEmail?.message}><TextInput type="email" {...register('candidateEmail')} /></Field>
          </div>
          <Field label="Position they’re a fit for">
            <Select {...register('jobId')} placeholder="General / not sure" options={(jobs.data?.jobs ?? []).map((j) => ({ value: j.id, label: j.title }))} />
          </Field>
          <Field label="Note" optional error={errors.note?.message}><Textarea rows={4} maxLength={2000} {...register('note')} /></Field>
          <Button type="submit" fullWidth loading={isSubmitting} icon="send">Send referral</Button>
        </form>
      </Card>
    </div>
  );
}

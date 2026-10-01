import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { referralSchema } from '@shared/api/public';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Field, Select, TextInput, Textarea, formStyles } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Feedback';
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
  const { register, handleSubmit, reset, setError: setFieldError, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  if (sent) {
    return (
      <div className={s.narrow} role="status">
        <header className={s.intro}>
          <h1 className={s.title}>Referral sent</h1>
          <p className={s.lead}>Thank you. A recruiter will contact them about the role.</p>
        </header>
        <div className={s.actions}><ButtonLink to="/jobs">See open roles</ButtonLink><Button variant="secondary" onClick={() => { reset(); setSent(false); }}>Refer someone else</Button></div>
      </div>
    );
  }
  return (
    <div className={s.narrow}>
      <header className={s.intro}>
        <h1 className={s.title}>Refer someone</h1>
        <p className={s.lead}>Know someone who would do well here? Send us their details and a recruiter will get in touch with them.</p>
      </header>
      <div className={s.formCard}>
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
            <Select {...register('jobId')} placeholder="Not sure yet" options={(jobs.data?.jobs ?? []).map((j) => ({ value: j.id, label: j.title }))} />
          </Field>
          <Field label="Note" optional error={errors.note?.message}><Textarea rows={4} maxLength={2000} {...register('note')} /></Field>
          <Button type="submit" loading={isSubmitting}>Send referral</Button>
        </form>
      </div>
    </div>
  );
}

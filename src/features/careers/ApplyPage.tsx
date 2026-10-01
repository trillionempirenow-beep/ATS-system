import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { applyFieldsSchema, refineApply, type ApplyInput, type ApplyResultDto } from '@shared/api/public';
import { APPLY_SOURCES } from '@shared/domain/pipeline';
import { PHONE_COUNTRIES } from '@shared/domain/phone';
import { UPLOAD_RULES, formatBytes } from '@shared/api/uploads';
import { Icon } from '@/components/icon/Icon';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Display';
import { Checkbox, Dropzone, Field, FilePickButton, FileRow, Select, TextInput, Textarea, formStyles } from '@/components/ui/Form';
import { surfaceStyles } from '@/components/ui/Surface';
import { usePublicConfig } from '@/app/layouts/PublicLayout';
import { ErrorState, Notice, Skeleton } from '@/components/ui/Feedback';
import { api, ApiError, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { uploadFile } from '@/lib/upload';
import { cx } from '@/lib/cx';
import { usePublicJob } from './api';
import { RoleNotFound } from './RoleNotFound';
import { Crumbs } from './Crumbs';
import s from './Careers.module.css';

const formSchema = applyFieldsSchema.omit({ resumeUploadId: true, photoUploadId: true, confirm: true }).extend({ confirm: z.boolean() }).superRefine(refineApply);
type FormValues = z.input<typeof formSchema>;

interface UploadState { name: string; size: number; progress: number | null; id: string | null; error: string | null }

function useUpload(purpose: 'resume' | 'candidate_photo') {
  const [state, setState] = useState<UploadState | null>(null);
  const pick = async (file: File) => {
    setState({ name: file.name, size: file.size, progress: 0, id: null, error: null });
    try {
      const id = await uploadFile(purpose, file, (p) => setState((st) => (st ? { ...st, progress: p } : st)));
      setState({ name: file.name, size: file.size, progress: null, id, error: null });
    } catch (e) {
      setState({ name: file.name, size: file.size, progress: null, id: null, error: errorMessage(e) });
    }
  };
  return { state, pick, clear: () => setState(null) };
}

export function ApplyPage() {
  const { slug = '' } = useParams();
  const job = usePublicJob(slug);
  const company = usePublicConfig().data?.companyName ?? 'Acme';
  const resume = useUpload('resume');
  const photo = useUpload('candidate_photo');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResultDto | null>(null);
  const { register, handleSubmit, control, setError, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', email: '', phoneCountry: 'PH', phoneNumber: '', coverLetter: '', whyUs: '', source: undefined, sourceOther: '', portfolio: '', confirm: false },
  });
  const v = useWatch({ control });
  useEffect(() => { if (job.data) document.title = `Apply · ${job.data.title}`; }, [job.data]);
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);

  const progress = useMemo(() => [
    { label: 'Name', done: Boolean(v.name?.trim()) },
    { label: 'Email', done: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email ?? '') },
    { label: 'Cover letter', done: Boolean(v.coverLetter?.trim()) },
    { label: 'How you heard about us', done: Boolean(v.source) && (v.source !== 'other' || Boolean(v.sourceOther?.trim())) },
    { label: 'Resume', done: Boolean(resume.state?.id) },
  ], [v, resume.state]);
  const doneCount = progress.filter((p) => p.done).length;

  if (job.error instanceof ApiError && job.error.status === 404) return <RoleNotFound />;
  if (job.isError) return <ErrorState onRetry={() => void job.refetch()} />;
  if (!job.data) return <div className={s.applyGrid}><Skeleton height={640} radius={14} /><Skeleton height={360} radius={14} /></div>;
  const j = job.data;

  if (result) {
    return (
      <div className={s.narrow} role="status">
        <header className={s.intro}>
          <h1 className={s.title}>Application sent</h1>
          <p className={s.lead}>
            {result.confirmationEmail === 'sent'
              ? <>We emailed a confirmation to <strong>{result.email}</strong>. Use your application ID with that email to check where you are in the process.</>
              : <>Use your application ID with the email you applied with (<strong>{result.email}</strong>) to check where you are in the process.</>}
          </p>
        </header>
        <dl className={s.idBox}><dt>Application ID</dt><dd>{result.applicationId}</dd><dt>Role</dt><dd className={s.idRole}>{j.title}</dd></dl>
        <div className={s.actions}>
          <ButtonLink to={`/status?email=${encodeURIComponent(result.email)}&id=${result.applicationId}`}>View application status</ButtonLink>
          <ButtonLink to="/jobs" variant="secondary">See other open roles</ButtonLink>
        </div>
      </div>
    );
  }

  if (!j.acceptingApplications) {
    return (
      <div className={s.narrow}>
        <Notice tone="warning" title={j.full ? 'This role is full' : 'Applications are closed'}>{j.closedReason}</Notice>
        <ButtonLink to="/jobs" variant="secondary">See other open roles</ButtonLink>
      </div>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    let bad = false;
    if (!resume.state?.id) { setResumeError('Attach your resume to continue.'); bad = true; } else setResumeError(null);
    if (!values.confirm) { setConfirmError('Please confirm your details are accurate before submitting.'); bad = true; } else setConfirmError(null);
    if (bad) return;
    try {
      const payload: ApplyInput = { ...values, confirm: true, resumeUploadId: resume.state!.id!, photoUploadId: photo.state?.id ?? null } as ApplyInput;
      const res = await api.post<ApplyResultDto>(`/public/jobs/${encodeURIComponent(j.slug)}/apply`, payload);
      setResult(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      if (e instanceof ApiError && (e.fields.resume || e.fields.resumeUploadId)) {
        setResumeError(e.fields.resume ?? e.fields.resumeUploadId ?? e.message);
        resume.clear();
      }
      setFormError(applyServerErrors(e, setError, ['name', 'email', 'phoneNumber', 'coverLetter', 'whyUs', 'source', 'sourceOther', 'portfolio']));
    }
  });

  return (
    <div className={s.container}>
      <header className={s.applyHead}>
        <Crumbs items={[{ label: 'Open roles', to: '/jobs' }, { label: j.title, to: `/jobs/${j.slug}` }, { label: 'Apply' }]} />
        <h1 className={s.title}>Apply for {j.title}</h1>
        <p className={s.detailMeta}>{[j.department, j.location || 'Location flexible'].filter(Boolean).join(', ')}</p>
      </header>
      <form className={s.applyGrid} onSubmit={onSubmit} noValidate>
        <div className={s.formCard}>
          {formError ? <Notice tone="danger">{formError}</Notice> : null}
          <div className={formStyles.grid2}>
            <Field label="Full name" required error={errors.name?.message}><TextInput autoComplete="name" {...register('name')} /></Field>
            <Field label="Email" required error={errors.email?.message}><TextInput type="email" autoComplete="email" {...register('email')} /></Field>
          </div>
          <Field label="Phone" optional error={errors.phoneNumber?.message}>
            <div className={s.phoneRow}>
              <Select aria-label="Country code" {...register('phoneCountry')} options={PHONE_COUNTRIES.map(([iso, , dial]) => ({ value: iso, label: `${iso} (+${dial})` }))} />
              <TextInput type="tel" autoComplete="tel-national" placeholder="917 555 0199" {...register('phoneNumber')} aria-label="Phone number" />
            </div>
          </Field>
          <div className={formStyles.grid2}>
            <Field label="How did you hear about us?" required error={errors.source?.message}>
              <Select placeholder="Select an option" {...register('source')} options={Object.entries(APPLY_SOURCES).map(([value, label]) => ({ value, label }))} />
            </Field>
            {v.source === 'other' ? (
              <Field label="Tell us where" required error={errors.sourceOther?.message}><TextInput maxLength={70} {...register('sourceOther')} /></Field>
            ) : <div />}
          </div>
          <Field label="Cover letter" required error={errors.coverLetter?.message}>
            <Textarea rows={6} maxLength={8000} showCount {...register('coverLetter')} />
          </Field>
          <Field label={`Why do you want to work at ${company}?`} required error={errors.whyUs?.message}>
            <Textarea rows={4} maxLength={4000} {...register('whyUs')} />
          </Field>
          <Field label="Portfolio URL" optional error={errors.portfolio?.message}>
            <TextInput type="url" icon="link" placeholder="https://yourportfolio.com" {...register('portfolio')} />
          </Field>

          <div className={formStyles.field}>
            <span className={formStyles.label}>Profile picture <span className={formStyles.optional}>optional</span></span>
            <div className={s.photoRow}>
              <Avatar name={v.name || 'You'} src={photoPreview} size={56} />
              <div className={s.photoText}>
                <span className={s.hint}>JPG, PNG or WEBP, up to 3 MB</span>
                <div className={s.actions}>
                  <FilePickButton accept="image/jpeg,image/png,image/webp" icon="image" label={photo.state ? 'Change photo' : 'Upload photo'}
                    onFile={(f) => { setPhotoPreview(URL.createObjectURL(f)); void photo.pick(f); }} />
                  {photo.state ? <Button size="sm" variant="ghost" onClick={() => { photo.clear(); setPhotoPreview(null); }}>Remove</Button> : null}
                </div>
                {photo.state?.error ? <span className={formStyles.error}><Icon name="alert" size={14} />{photo.state.error}</span> : null}
              </div>
            </div>
          </div>

          <div className={formStyles.field}>
            <span className={formStyles.label}>Resume <span className={formStyles.req} aria-hidden>*</span></span>
            {resume.state && !resume.state.error ? (
              <FileRow name={resume.state.name} progress={resume.state.progress}
                sub={resume.state.progress !== null ? `Uploading… ${resume.state.progress}%` : `${formatBytes(resume.state.size)}, uploaded`}
                onRemove={() => resume.clear()} />
            ) : (
              <Dropzone accept=".pdf,.doc,.docx" error={Boolean(resumeError || resume.state?.error)} title="Drop your resume here, or browse" hint={UPLOAD_RULES.resume.label}
                onFile={(f) => { setResumeError(null); void resume.pick(f); }} />
            )}
            {resume.state?.error || resumeError ? <span className={formStyles.error} role="alert"><Icon name="alert" size={14} />{resume.state?.error ?? resumeError}</span> : null}
          </div>
        </div>

        <aside className={s.aside}>
          <div className={s.applyCard}>
            <div className={s.sheetHead}>
              <strong>Before you submit</strong>
              <span className="num">{doneCount} of {progress.length} done</span>
            </div>
            <ul className={s.progressList}>
              {progress.map((p) => (
                <li key={p.label} className={cx(s.progressItem, p.done && s.progressDone)}><Icon name={p.done ? 'checkcircle' : 'check'} size={16} />{p.label}</li>
              ))}
            </ul>
            <hr className={surfaceStyles.divider} />
            <dl className={s.summary}>
              <dt>Name</dt><dd>{v.name?.trim() || '—'}</dd>
              <dt>Email</dt><dd>{v.email?.trim() || '—'}</dd>
              <dt>Resume</dt><dd>{resume.state?.id ? 'Uploaded' : 'Not uploaded'}</dd>
              <dt>Cover letter</dt><dd className="num">{(v.coverLetter ?? '').length} chars</dd>
              <dt>Portfolio</dt><dd>{v.portfolio?.trim() ? 'Provided' : 'Not provided'}</dd>
            </dl>
            <Checkbox label="I confirm the information above is accurate and I consent to reviewing my application." {...register('confirm')} />
            {confirmError ? <span className={formStyles.error}><Icon name="alert" size={14} />{confirmError}</span> : null}
            <Button type="submit" size="lg" fullWidth loading={isSubmitting} disabled={resume.state?.progress !== null && resume.state?.progress !== undefined}>
              {isSubmitting ? 'Submitting…' : 'Submit application'}
            </Button>
          </div>
          {j.related.length ? (
            <div className={s.softCard}>
              <strong>Other open roles</strong>
              <div className={s.otherRoles}>
                {j.related.map((r) => (
                  <Link key={r.id} to={`/jobs/${r.slug}`} className={s.otherRole}><span>{r.title}</span><span className={s.hint}>{r.department}</span></Link>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </form>
    </div>
  );
}

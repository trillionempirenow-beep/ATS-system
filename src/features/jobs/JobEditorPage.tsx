import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import type { ExtractPdfResultDto, JobEditorDto, SaveJobInput } from '@shared/api/jobs';
import { UPLOAD_RULES } from '@shared/api/uploads';
import { EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES, JOB_APPROVAL_ACTION_LABELS, jobTags, type EmploymentType } from '@shared/domain/jobs';
import { Button, ButtonLink } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Display';
import { Checkbox, Dropzone, Field, FileRow, Select, TextInput, Textarea, formStyles } from '@/components/ui/Form';
import { Notice, Skeleton, Timeline } from '@/components/ui/Feedback';
import { Card, CardHeader, PageHeader } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { useAuth } from '@/app/providers/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { formatDate } from '@/lib/format';
import { uploadFile } from '@/lib/upload';
import { useJobEditor, useSaveJob } from './api';
import w from '../workspace.module.css';
import s from './Jobs.module.css';

interface Values {
  title: string;
  departmentId: string;
  employmentType: EmploymentType;
  location: string;
  salaryInfo: string;
  description: string;
  responsibilities: string;
  qualifications: string;
  requirements: string;
  preferredSkills: string;
  experienceRequired: string;
  educationRequired: string;
  tags: string;
  applicantLimit: string;
  isUrgent: boolean;
}
type TextField = Exclude<keyof Values, 'isUrgent' | 'employmentType'>;
const KNOWN: Array<keyof Values> = ['title', 'departmentId', 'location', 'description', 'tags', 'applicantLimit', 'salaryInfo'];

function toValues(d: JobEditorDto): Values {
  const j = d.job;
  return {
    title: j?.title ?? '', departmentId: j?.departmentId ? String(j.departmentId) : '', employmentType: j?.employmentType ?? 'full_time',
    location: j?.location ?? '', salaryInfo: j?.salaryInfo ?? '', description: j?.description ?? '', responsibilities: j?.responsibilities ?? '',
    qualifications: j?.qualifications ?? '', requirements: j?.requirements ?? '', preferredSkills: j?.preferredSkills ?? '',
    experienceRequired: j?.experienceRequired ?? '', educationRequired: j?.educationRequired ?? '', tags: j?.tagsRaw ?? '',
    applicantLimit: j ? (j.applicantLimit ? String(j.applicantLimit) : '') : d.defaultApplicantLimit ? String(d.defaultApplicantLimit) : '',
    isUrgent: j?.isUrgent ?? false,
  };
}

type Pdf = { state: 'idle' } | { state: 'working'; name: string; pct: number } | { state: 'done'; name: string; size: string; result: ExtractPdfResultDto } | { state: 'failed'; message: string };

export function JobEditorPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const q = useJobEditor(id);
  useEffect(() => { document.title = `${id ? 'Edit job posting' : 'Create job posting'} · Acme People`; }, [id]);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <div className={w.page}><Skeleton height={36} width={280} /><div className={w.aside340}><Skeleton height={640} /><Skeleton height={320} /></div></div>;
  return <Editor key={id ?? 'new'} id={id} data={q.data} />;
}

function Editor({ id, data }: { id: number | null; data: JobEditorDto }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const save = useSaveJob(id);
  const { register, handleSubmit, setValue, setError, watch, formState: { errors } } = useForm<Values>({ defaultValues: toValues(data) });
  const [pdf, setPdf] = useState<Pdf>({ state: 'idle' });
  const [sourcePdfPath, setSourcePdfPath] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const job = data.job;
  const listPath = user?.role === 'admin' ? '/app/jobs' : '/app/jobs/mine';
  const returned = job && (job.state === 'changes_requested' || job.state === 'rejected');
  const tagCount = jobTags(watch('tags')).length;

  if (job && !job.canEdit) {
    return (
      <div className={w.page}>
        <PageHeader title="Edit job posting" crumbs={[{ label: 'Jobs', to: listPath }, { label: 'Edit posting' }]} />
        <Notice tone="info" title="This posting cannot be edited right now">It is {job.state === 'pending' ? 'waiting for an Admin to review it' : 'past the stage where you can change it'}.</Notice>
        <ButtonLink variant="secondary" to={listPath}>Back to jobs</ButtonLink>
      </div>
    );
  }

  async function onPdf(file: File) {
    setPdf({ state: 'working', name: file.name, pct: 0 });
    try {
      const uploadId = await uploadFile('job_pdf', file, (pct) => setPdf({ state: 'working', name: file.name, pct }));
      const result = await api.post<ExtractPdfResultDto>('/jobs/extract-pdf', { uploadId });
      setSourcePdfPath(result.sourcePdfPath);
      const f = result.fields;
      if (f) {
        const set = (k: TextField, v: string) => { if (v) setValue(k, v, { shouldDirty: true }); };
        set('title', f.title); set('location', f.location); set('description', f.description); set('responsibilities', f.responsibilities);
        set('qualifications', f.qualifications); set('requirements', f.requirements); set('preferredSkills', f.preferredSkills);
        set('experienceRequired', f.experienceRequired); set('educationRequired', f.educationRequired); set('salaryInfo', f.salaryInfo); set('tags', f.tags);
        setValue('employmentType', f.employmentType);
        if (f.departmentId) setValue('departmentId', String(f.departmentId));
        else if (f.departmentText) setError('departmentId', { message: 'Pick a department.' });
      }
      setPdf({ state: 'done', name: file.name, size: `${Math.max(1, Math.round(file.size / 1024))} KB`, result });
    } catch (e) {
      setPdf({ state: 'failed', message: errorMessage(e) });
    }
  }

  const submit = (action: SaveJobInput['action']) => handleSubmit((v) => {
    setFormError(null);
    let bad = false;
    if (!v.title.trim()) { setError('title', { message: 'A job title is required.' }); bad = true; }
    if (!v.departmentId) { setError('departmentId', { message: 'Please choose a department.' }); bad = true; }
    if (action !== 'save_draft' && !v.description.trim()) { setError('description', { message: 'Describe the role before submitting it.' }); bad = true; }
    const limit = v.applicantLimit.trim() ? Number(v.applicantLimit) : null;
    if (limit !== null && (!Number.isInteger(limit) || limit < 0)) { setError('applicantLimit', { message: 'Use a whole number, or leave blank for unlimited.' }); bad = true; }
    if (tagCount > 6) { setError('tags', { message: 'Use at most 6 tags.' }); bad = true; }
    if (bad) return;
    save.mutate({
      action,
      title: v.title.trim(), departmentId: Number(v.departmentId), employmentType: v.employmentType, location: v.location, salaryInfo: v.salaryInfo,
      description: v.description, responsibilities: v.responsibilities, qualifications: v.qualifications, requirements: v.requirements,
      preferredSkills: v.preferredSkills, experienceRequired: v.experienceRequired, educationRequired: v.educationRequired,
      tags: v.tags, applicantLimit: limit, isUrgent: v.isUrgent, sourcePdfPath: sourcePdfPath ?? undefined,
    }, {
      onSuccess: () => {
        toast.success(action === 'publish' ? 'The posting is live on the careers site.' : action === 'submit' ? 'Submitted. An Admin will review it.' : 'Draft saved. Only you can see it.');
        navigate(listPath);
      },
      onError: (e) => setFormError(applyServerErrors(e, setError, KNOWN)),
    });
  });

  const reviewEvent = [...data.history].reverse().find((h) => h.action === 'changes_requested' || h.action === 'rejected');
  const deptWarning = pdf.state === 'done' && pdf.result.fields && !pdf.result.fields.departmentId && pdf.result.fields.departmentText;

  return (
    <div className={w.page}>
      <PageHeader
        title={job ? 'Edit job posting' : 'Create job posting'}
        description={job ? `${job.title}${returned ? ' · reviewed by an Admin' : ''}` : 'Write it once. Approved postings publish to the careers site.'}
        crumbs={[{ label: 'Jobs', to: listPath }, { label: job ? 'Edit posting' : 'Create job' }]}
        actions={<ButtonLink variant="secondary" to={listPath}>All jobs</ButtonLink>} />

      {returned ? (
        <Notice tone={job?.state === 'rejected' ? 'danger' : 'warning'} title={`${job?.state === 'rejected' ? 'Rejected' : 'Changes requested'}${reviewEvent?.actorName ? ` by ${reviewEvent.actorName}` : job?.reviewerName ? ` by ${job.reviewerName}` : ''}`}>
          {job?.reviewNote ? `“${job.reviewNote}” ` : ''}Edit the posting below and submit it again. You do not need to start over.
        </Notice>
      ) : null}
      {deptWarning ? <Notice tone="warning" title="Check the department">The PDF said “{pdf.result.fields?.departmentText}”. No matching department exists yet, so please pick one.</Notice> : null}
      {formError ? <Notice tone="danger">{formError}</Notice> : null}

      <div className={w.aside340}>
        <form className={w.stack} noValidate onSubmit={(e) => { e.preventDefault(); void submit(data.canPublish ? 'publish' : 'submit')(); }}>
          <Card>
            <CardHeader title="Role basics" />
            <div className={formStyles.stack}>
              <Field label="Job title" required error={errors.title?.message}><TextInput {...register('title')} maxLength={180} /></Field>
              <div className={formStyles.grid2}>
                <Field label="Department" required error={errors.departmentId?.message}>
                  <Select {...register('departmentId')} placeholder="Choose a department…" options={data.departments.map((d) => ({ value: d.id, label: d.name }))} />
                </Field>
                <Field label="Employment type"><Select {...register('employmentType')} options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_TYPE_LABELS[t] }))} /></Field>
                <Field label="Location" error={errors.location?.message}><TextInput {...register('location')} maxLength={160} placeholder="City, or Remote" /></Field>
                <Field label="Salary information" optional error={errors.salaryInfo?.message}><TextInput {...register('salaryInfo')} maxLength={255} /></Field>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="The posting" />
            <div className={formStyles.stack}>
              <Field label="Description" required error={errors.description?.message}><Textarea rows={6} maxLength={20000} {...register('description')} /></Field>
              <div className={formStyles.grid2}>
                <Field label="Responsibilities" hint="One per line"><Textarea rows={5} {...register('responsibilities')} /></Field>
                <Field label="Qualifications" hint="One per line"><Textarea rows={5} {...register('qualifications')} /></Field>
                <Field label="Required skills" hint="One per line. Shown publicly as requirements."><Textarea rows={5} {...register('requirements')} /></Field>
                <Field label="Preferred skills" optional hint="One per line"><Textarea rows={5} {...register('preferredSkills')} /></Field>
                <Field label="Experience required"><TextInput {...register('experienceRequired')} maxLength={255} /></Field>
                <Field label="Education required"><TextInput {...register('educationRequired')} maxLength={255} /></Field>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Listing options" />
            <div className={formStyles.stack}>
              <div className={formStyles.grid2}>
                <Field label="Tags" hint={`Comma-separated, max 6 · ${tagCount} used`} error={errors.tags?.message}><TextInput {...register('tags')} /></Field>
                <Field label="Applicant limit" optional hint="Leave blank for unlimited." error={errors.applicantLimit?.message}><TextInput type="number" min={0} {...register('applicantLimit')} /></Field>
              </div>
              <Checkbox {...register('isUrgent')} label="Mark as Urgent Hiring" description="Featured at the top of the public careers site" />
            </div>
          </Card>
          <div className={w.stickyActions}>
            <Button type="button" variant="secondary" disabled={save.isPending} loading={save.isPending && save.variables?.action === 'save_draft'} onClick={() => void submit('save_draft')()}>
              {job?.state === 'published' ? 'Unpublish and save as draft' : 'Save as draft'}
            </Button>
            {data.canPublish
              ? <Button type="submit" icon="public" loading={save.isPending && save.variables?.action === 'publish'} disabled={save.isPending}>{job?.state === 'published' ? 'Save changes' : 'Save and publish'}</Button>
              : <Button type="submit" icon="send" loading={save.isPending && save.variables?.action === 'submit'} disabled={save.isPending}>Submit for approval</Button>}
          </div>
        </form>

        <div className={w.stack}>
          <Card>
            <CardHeader title="Job description to job posting" subtitle="Upload a PDF and we will pre-fill the form." />
            {pdf.state === 'working' ? <FileRow name={pdf.name} progress={pdf.pct} sub={pdf.pct < 100 ? `Uploading… ${pdf.pct}%` : 'Reading the PDF…'} /> : null}
            {pdf.state === 'done' ? (
              <div className={w.stack8}>
                <FileRow name={pdf.name} sub={`Attached · ${pdf.size}`} />
                {pdf.result.qualityWarning ? <Notice tone="warning">{pdf.result.qualityWarning}</Notice> : null}
                {!pdf.result.ok && pdf.result.message ? <Notice tone="warning">{pdf.result.message}</Notice> : null}
                <Button variant="secondary" size="sm" onClick={() => setPdf({ state: 'idle' })} style={{ alignSelf: 'flex-start' }}>Extract again</Button>
              </div>
            ) : null}
            {pdf.state === 'idle' || pdf.state === 'failed' ? (
              <div className={w.stack8}>
                <Dropzone accept=".pdf" title="Drop a job description here, or click to browse" hint={`Supports ${UPLOAD_RULES.job_pdf.label}`} error={pdf.state === 'failed'} onFile={(f) => void onPdf(f)} />
                {pdf.state === 'failed' ? <Notice tone="danger">{pdf.message}</Notice> : null}
                {job?.sourcePdf ? <a className={w.link} href={`/api/v1/jobs/${job.id}/source-pdf`} target="_blank" rel="noopener noreferrer">Open the attached source PDF</a> : null}
              </div>
            ) : null}
          </Card>
          <Card>
            <CardHeader title="What happens next" />
            <ol className={s.flow}>
              <li><strong>Save as draft</strong><span>Private to you</span></li>
              {data.canPublish ? <li><strong>Publish</strong><span>Visible on the careers site straight away</span></li> : (
                <>
                  <li><strong>Submit for approval</strong><span>An Admin reviews the posting</span></li>
                  <li><strong>Admin decision</strong><span>Approve, request changes or reject</span></li>
                  <li><strong>Published</strong><span>Visible on the careers site</span></li>
                </>
              )}
            </ol>
          </Card>
          {job ? (
            <Card>
              <CardHeader title="History" actions={<StatusBadge kind="job" value={job.state} size="sm" />} />
              {data.history.length ? (
                <Timeline items={[...data.history].reverse().map((h) => ({
                  key: h.id, title: JOB_APPROVAL_ACTION_LABELS[h.action], done: true,
                  sub: `${h.actorName ?? 'Former user'} · ${formatDate(h.createdAt)}${h.note ? ` · “${h.note}”` : ''}`,
                }))} />
              ) : <p className={w.faint}>Created {formatDate(job.createdAt)}{job.creatorName ? ` by ${job.creatorName}` : ''}. No approval activity yet.</p>}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

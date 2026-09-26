import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddCandidateInput, AddCandidateResultDto, ParseCvResultDto } from '@shared/api/candidates';
import { UPLOAD_RULES } from '@shared/api/uploads';
import {
  CONFIGURABLE_CANDIDATE_FIELDS, EXPERIENCE_LEVEL_LABELS, EXPERIENCE_LEVELS, MANUAL_SOURCES,
  type ConfigurableCandidateField, type ExperienceLevel, type ManualSource,
} from '@shared/domain/pipeline';
import { Button } from '@/components/ui/Button';
import { Checkbox, Dropzone, Field, FileRow, Select, TextInput, Textarea, formStyles } from '@/components/ui/Form';
import { Notice, Skeleton } from '@/components/ui/Feedback';
import { Card, CardHeader, PageHeader } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { useAuth } from '@/app/providers/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { uploadFile } from '@/lib/upload';
import { SkillsInput } from './SkillsInput';
import w from '../../workspace.module.css';
import s from './AddCandidate.module.css';

interface FormOptions { required: string[]; jobs: Array<{ id: number; title: string }> }

interface Values {
  fullName: string;
  email: string;
  phone: string;
  currentTitle: string;
  experienceLevel: ExperienceLevel | '';
  skills: string[];
  education: string;
  source: ManualSource;
  jobId: string;
  notes: string;
}

const FIELD_KEYS: Record<string, keyof Values> = {
  full_name: 'fullName', email: 'email', phone: 'phone', current_title: 'currentTitle', experience_level: 'experienceLevel',
  skills: 'skills', education: 'education', source: 'source', job_id: 'jobId',
};
const KNOWN = Object.values(FIELD_KEYS) as string[];
const EMPTY: Values = { fullName: '', email: '', phone: '', currentTitle: '', experienceLevel: '', skills: [], education: '', source: 'direct', jobId: '', notes: '' };

type Parse = { state: 'idle' } | { state: 'working'; name: string; pct: number } | { state: 'done'; result: ParseCvResultDto } | { state: 'failed'; message: string };

export function AddCandidatePage() {
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const options = useQuery({ queryKey: ['candidate-form-options'], queryFn: () => api.get<FormOptions>('/candidates/form-options') });
  const form = useForm<Values>({ defaultValues: EMPTY });
  const { register, handleSubmit, setError, setValue, control, formState: { errors } } = form;
  const [parse, setParse] = useState<Parse>({ state: 'idle' });
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => { document.title = 'Add candidate · Acme People'; }, []);

  const save = useMutation({
    mutationFn: (input: AddCandidateInput) => api.post<AddCandidateResultDto>('/candidates', input),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['candidates'] });
      void qc.invalidateQueries({ queryKey: ['pipeline'] });
      if (r.draft) {
        toast.success('Saved as a draft. Only you can see it until it is submitted.');
        navigate('/app/candidates');
      } else if (r.applicationId) {
        toast.success('Candidate added to the pipeline at Applied.');
        navigate(`/app/candidates/${r.applicationId}`);
      } else {
        toast.success('Candidate added to the talent pool.');
        navigate('/app/candidates');
      }
    },
  });

  if (options.isError) return <QueryErrorPage error={options.error} onRetry={() => void options.refetch()} />;
  const required = new Set(options.data?.required ?? ['full_name', 'email']);
  const isRequired = (field: string) => required.has(field);

  async function onCv(file: File) {
    setParse({ state: 'working', name: file.name, pct: 0 });
    try {
      const uploadId = await uploadFile('resume', file, (pct) => setParse({ state: 'working', name: file.name, pct }));
      const result = await api.post<ParseCvResultDto>('/candidates/parse-cv', { uploadId });
      const f = result.fields;
      const fill = (key: 'fullName' | 'email' | 'phone' | 'currentTitle' | 'education', value: string | undefined) => {
        if (value) setValue(key, value, { shouldDirty: true });
      };
      fill('fullName', f.full_name);
      fill('email', f.email);
      fill('phone', f.phone);
      fill('currentTitle', f.current_title);
      if (f.experience_level && (EXPERIENCE_LEVELS as readonly string[]).includes(f.experience_level)) setValue('experienceLevel', f.experience_level as ExperienceLevel);
      if (f.skills) setValue('skills', f.skills.split(',').map((x) => x.trim()).filter(Boolean));
      fill('education', f.education);
      setParse({ state: 'done', result });
    } catch (e) {
      setParse({ state: 'failed', message: errorMessage(e) });
    }
  }

  function submit(action: 'submit' | 'draft') {
    return handleSubmit((v) => {
      setFormError(null);
      const needed = action === 'draft' ? ['full_name'] : [...required];
      let missing = false;
      for (const key of needed) {
        const field = FIELD_KEYS[key];
        if (!field) continue;
        const value = v[field];
        if (Array.isArray(value) ? value.length === 0 : !String(value).trim()) {
          const label = key === 'full_name' ? 'the candidate’s full name' : key === 'email' ? 'an email address' : CONFIGURABLE_CANDIDATE_FIELDS[key as ConfigurableCandidateField].toLowerCase();
          setError(field, { type: 'required', message: `Enter ${label}.` });
          missing = true;
        }
      }
      if (v.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) {
        setError('email', { type: 'pattern', message: 'Enter a valid email address.' });
        missing = true;
      }
      if (missing) return;
      const doc = parse.state === 'done' ? parse.result : null;
      save.mutate({
        action,
        fullName: v.fullName.trim(),
        email: v.email.trim(),
        phone: v.phone.trim(),
        currentTitle: v.currentTitle.trim(),
        experienceLevel: v.experienceLevel,
        skills: v.skills.join(', '),
        education: v.education.trim(),
        source: v.source,
        jobId: v.jobId ? Number(v.jobId) : null,
        notes: v.notes.trim(),
        documentId: doc?.document.id ?? null,
        resumeText: doc?.resumeText ?? '',
        cvParsed: Boolean(doc?.ok),
      }, { onError: (e) => setFormError(applyServerErrors(e, setError, KNOWN)) });
    });
  }

  const label = (key: string, text: string) => <>{text}{isRequired(key) ? <span className={formStyles.req} aria-hidden="true">*</span> : null}</>;

  return (
    <div className={w.page}>
      <PageHeader title="Add a candidate" description="Upload a CV to pre-fill details, or enter them by hand." crumbs={[{ label: 'Recruiting', to: '/app' }, { label: 'Add candidate' }]} />
      <div className={w.aside340}>
        <form className={w.stack} noValidate onSubmit={(e) => { e.preventDefault(); void submit('submit')(); }}>
          <Card>
            <CardHeader title="Upload CV / resume to auto-fill" subtitle="Nothing is saved until you review the suggestions and submit." />
            {parse.state === 'working' ? <FileRow name={parse.name} progress={parse.pct} sub={parse.pct < 100 ? `Uploading… ${parse.pct}%` : 'Reading the document…'} /> : null}
            {parse.state === 'done' ? (
              <div className={w.stack8}>
                <FileRow name={parse.result.document.originalName} sub={parse.result.document.sizeLabel} onRemove={() => setParse({ state: 'idle' })} />
                <Notice tone={parse.result.ok ? (parse.result.partial ? 'warning' : 'success') : 'warning'}>
                  {parse.result.ok && parse.result.filled.length
                    ? `We read the file and filled in ${parse.result.filled.length} field${parse.result.filled.length === 1 ? '' : 's'}. Review them before you submit.`
                    : parse.result.message}
                </Notice>
              </div>
            ) : null}
            {parse.state === 'idle' || parse.state === 'failed' ? (
              <div className={w.stack8}>
                <Dropzone accept=".pdf,.doc,.docx" title="Drop a CV here, or click to browse" hint={`Supports ${UPLOAD_RULES.resume.label}`} error={parse.state === 'failed'} onFile={(f) => void onCv(f)} />
                {parse.state === 'failed' ? <Notice tone="danger">{parse.message}</Notice> : null}
              </div>
            ) : null}
          </Card>

          <Card>
            {formError ? <Notice tone="danger" style={{ marginBottom: 16 }}>{formError}</Notice> : null}
            <fieldset className={s.section}>
              <legend className={s.legend}>Personal details</legend>
              <Field label={label('full_name', 'Full name')} error={errors.fullName?.message}><TextInput autoComplete="off" {...register('fullName')} /></Field>
              <div className={formStyles.grid2}>
                <Field label={label('email', 'Email address')} error={errors.email?.message}><TextInput type="email" autoComplete="off" {...register('email')} /></Field>
                <Field label={label('phone', 'Phone number')} error={errors.phone?.message}><TextInput type="tel" autoComplete="off" {...register('phone')} /></Field>
              </div>
            </fieldset>
            <fieldset className={s.section}>
              <legend className={s.legend}>Professional details</legend>
              <div className={formStyles.grid2}>
                <Field label={label('current_title', 'Current role')} error={errors.currentTitle?.message}><TextInput {...register('currentTitle')} /></Field>
                <Field label={label('experience_level', 'Experience level')} error={errors.experienceLevel?.message}>
                  <Select {...register('experienceLevel')} placeholder="Not specified" options={EXPERIENCE_LEVELS.map((l) => ({ value: l, label: EXPERIENCE_LEVEL_LABELS[l] }))} />
                </Field>
              </div>
              <Controller control={control} name="skills" render={({ field }) => (
                <Field label={label('skills', 'Skills')} hint="Press Enter or comma to add. Click a chip to remove it." error={errors.skills?.message}>
                  <SkillsInput value={field.value} onChange={field.onChange} />
                </Field>
              )} />
              <Field label={label('education', 'Education')} error={errors.education?.message}><TextInput {...register('education')} /></Field>
            </fieldset>
            <fieldset className={s.section}>
              <legend className={s.legend}>Application</legend>
              <div className={formStyles.grid2}>
                <Field label={label('source', 'Source')} error={errors.source?.message}>
                  <Select {...register('source')} options={Object.entries(MANUAL_SOURCES).map(([value, text]) => ({ value, label: text }))} />
                </Field>
                <Field label={label('job_id', 'Target position')} hint="Only published roles appear here. Leave blank to add them to the pool." error={errors.jobId?.message}>
                  {options.isLoading ? <Skeleton height={40} /> : <Select {...register('jobId')} placeholder="No position yet" options={(options.data?.jobs ?? []).map((j) => ({ value: j.id, label: j.title }))} />}
                </Field>
              </div>
              <Field label="Recruiter notes" optional><Textarea rows={3} maxLength={5000} {...register('notes')} /></Field>
            </fieldset>
            <div className={w.stickyActions}>
              <Button type="button" variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
              <Button type="button" variant="secondary" loading={save.isPending && save.variables?.action === 'draft'} disabled={save.isPending || parse.state === 'working'} onClick={() => void submit('draft')()}>Save as draft</Button>
              <Button type="submit" loading={save.isPending && save.variables?.action === 'submit'} disabled={save.isPending || parse.state === 'working'}>Submit candidate</Button>
            </div>
          </Card>
        </form>

        <div className={w.stack}>
          {can.adminLevel && options.data ? <FieldSettings required={options.data.required} /> : null}
          <Card>
            <CardHeader title="Before you submit" />
            <ol className={s.steps}>
              <li>Draft candidates are private to you.</li>
              <li>Submitting adds them to the pipeline at Applied.</li>
              <li>Leaving Target position blank adds them to the talent pool.</li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

function FieldSettings({ required }: { required: string[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [picked, setPicked] = useState(() => new Set(required.filter((f) => f in CONFIGURABLE_CANDIDATE_FIELDS)));
  const save = useMutation({
    mutationFn: () => api.put('/candidates/required-fields', { required: [...picked] }),
    onSuccess: () => { toast.success('Field settings saved.'); void qc.invalidateQueries({ queryKey: ['candidate-form-options'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = (f: string, on: boolean) => setPicked((prev) => { const n = new Set(prev); if (on) n.add(f); else n.delete(f); return n; });
  return (
    <Card>
      <CardHeader title="Field settings" subtitle="Admins choose which fields are required." />
      <div className={w.stack8}>
        <Checkbox label="Full name" checked disabled readOnly />
        <Checkbox label="Email address" checked disabled readOnly />
        {Object.entries(CONFIGURABLE_CANDIDATE_FIELDS).map(([key, text]) => (
          <Checkbox key={key} label={text} checked={picked.has(key)} onChange={(e) => toggle(key, e.target.checked)} />
        ))}
        <Button variant="secondary" size="sm" loading={save.isPending} onClick={() => save.mutate()} style={{ alignSelf: 'flex-start', marginTop: 8 }}>Save field settings</Button>
      </div>
    </Card>
  );
}

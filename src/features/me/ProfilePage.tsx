import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProfileDto } from '@shared/api/me';
import { UPLOAD_RULES, uploadProblem } from '@shared/api/uploads';
import {
  ADMIN_PERMISSION_CATALOG, PERMISSIONS, RECRUITER_PERMISSION_CATALOG, RECRUITER_PERMISSION_KEYS, isRecruiterPermission, passwordProblems, type PermissionKey,
} from '@shared/domain/access';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge } from '@/components/ui/Display';
import { Field, FilePickButton, PasswordInput, TextInput, formStyles } from '@/components/ui/Form';
import { Notice, ProgressBar, Skeleton } from '@/components/ui/Feedback';
import { Card, CardHeader, DescriptionList, PageHeader } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { ME_KEY } from '@/app/providers/AuthProvider';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { uploadFile } from '@/lib/upload';
import w from '../workspace.module.css';
import s from './Me.module.css';

const KEY = ['profile'] as const;

export function ProfilePage() {
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<ProfileDto>('/profile') });
  useEffect(() => { document.title = 'My profile · Acme People'; }, []);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  return (
    <div className={w.page}>
      <PageHeader title="My profile" description="Your details, what your account can do, and your password." crumbs={[{ label: 'Account' }, { label: 'My profile' }]} />
      {!p ? <div className={w.cols12}><Skeleton height={420} /><Skeleton height={520} /></div> : (
        <div className={w.cols12}>
          <Summary p={p} />
          <div className={w.stack}>
            <EditProfile key={`${p.name}|${p.email}|${p.avatarUrl ?? ''}`} p={p} />
            <ChangePassword />
          </div>
        </div>
      )}
    </div>
  );
}

function Summary({ p }: { p: ProfileDto }) {
  const granted = new Set(p.permissions.map((x) => x.key));
  // Only what this role can be granted at all, in the wording its granter sees.
  const relevant: readonly PermissionKey[] = p.role === 'admin' ? PERMISSIONS : p.role === 'recruiter' ? RECRUITER_PERMISSION_KEYS : [];
  const label = (k: PermissionKey) => (p.role === 'recruiter' && isRecruiterPermission(k) ? RECRUITER_PERMISSION_CATALOG[k].label : ADMIN_PERMISSION_CATALOG[k].label);
  return (
    <Card>
      <div className={s.identity}>
        <Avatar name={p.name} src={p.avatarUrl} size={64} />
        <div><h2>{p.name}</h2><span>{p.jobTitle ? `${p.jobTitle} · ` : ''}{p.roleLabel}</span></div>
      </div>
      {p.completeness.percent < 100 ? (
        <div className={s.complete}>
          <ProgressBar value={p.completeness.percent} label="Profile completeness" />
          <span>{p.completeness.percent}% complete · add {p.completeness.missing.join(', ').toLowerCase()}</span>
        </div>
      ) : null}
      <DescriptionList items={[
        ['Email', p.email],
        ['Role', p.roleLabel],
        ['Account status', p.accountStatus.charAt(0).toUpperCase() + p.accountStatus.slice(1).replace(/_/g, ' ')],
        ['Member since', formatDate(p.createdAt)],
        ['Password changed', p.passwordChangedAt ? formatDate(p.passwordChangedAt) : 'Never'],
        ...(p.createdByName ? [['Seat owner', p.createdByName] as [string, string]] : []),
      ]} />
      {relevant.length ? (
        <div className={s.perms}>
          <span className={w.overline}>What your account can do</span>
          <ul>
            {relevant.map((k) => (
              <li key={k} data-off={!granted.has(k) || undefined}>
                <Icon name={granted.has(k) ? 'checkcircle' : 'xcircle'} size={16} />
                {label(k)}{granted.has(k) ? '' : ' · not granted'}
              </li>
            ))}
          </ul>
          <p className={w.faint}>{p.createdByName ? `Granted by your Admin, ${p.createdByName}.` : 'Granted by your administrator.'} Ask them if you need something changed.</p>
        </div>
      ) : null}
    </Card>
  );
}

function EditProfile({ p }: { p: ProfileDto }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(p.name);
  const [email, setEmail] = useState(p.email);
  const [jobTitle, setJobTitle] = useState(p.jobTitle ?? '');
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);

  const save = useMutation({
    mutationFn: async () => {
      const photoUploadId = photo ? await uploadFile('user_photo', photo.file) : null;
      await api.put('/profile', { name: name.trim(), email: email.trim(), jobTitle: jobTitle.trim(), photoUploadId, removePhoto: removePhoto && !photo });
    },
    onSuccess: () => {
      toast.success('Profile saved.');
      setPhoto(null);
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ME_KEY });
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields);
      else setFormError(errorMessage(e));
    },
  });

  const pick = (file: File) => {
    const problem = uploadProblem('user_photo', file);
    if (problem) { setErrors({ photo: problem }); return; }
    setErrors({});
    setRemovePhoto(false);
    setPhoto({ file, preview: URL.createObjectURL(file) });
  };

  const submit = () => {
    setFormError(null);
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Your name cannot be blank.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'That email address is not valid.';
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };

  const shown = photo?.preview ?? (removePhoto ? null : p.avatarUrl);
  return (
    <Card>
      <CardHeader title="Edit profile" />
      <div className={formStyles.stack}>
        {formError ? <Notice tone="danger">{formError}</Notice> : null}
        <div className={s.photoRow}>
          <Avatar name={name || p.name} src={shown} size={56} />
          <div className={s.photoText}><strong>Profile picture</strong><span>{UPLOAD_RULES.user_photo.label}</span>{errors.photo ? <span className={s.err}>{errors.photo}</span> : null}</div>
          <FilePickButton accept=".jpg,.jpeg,.png,.webp" label="Upload" onFile={pick} />
          {shown ? <Button size="sm" variant="ghost" onClick={() => { setPhoto(null); setRemovePhoto(true); }}>Remove</Button> : null}
        </div>
        <Field label="Full name" required error={errors.name}><TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" /></Field>
        <Field label="Email" hint="You sign in with this address." error={errors.email}><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
        <Field label="Job title" optional error={errors.jobTitle}><TextInput value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={120} /></Field>
        <p className={w.faint}>Only your administrator can change your role, permissions or account status.</p>
        <div className={w.formActions}><Button onClick={submit} loading={save.isPending}>Save profile</Button></div>
      </div>
    </Card>
  );
}

function ChangePassword() {
  const toast = useToast();
  const qc = useQueryClient();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.put('/profile/password', { current, password, confirm }),
    onSuccess: () => {
      toast.success('Password updated. Other devices were signed out.');
      setCurrent(''); setPassword(''); setConfirm(''); setErrors({});
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => setErrors(e instanceof ApiError && Object.keys(e.fields).length ? e.fields : { form: errorMessage(e) }),
  });
  const submit = () => {
    const next: Record<string, string> = {};
    if (!current) next.current = 'Enter your current password.';
    const problems = passwordProblems(password, confirm);
    if (!password) next.password = 'Enter a new password.';
    else if (problems.length) next.password = problems[0]!;
    if (password && confirm && password !== confirm) next.confirm = 'The passwords do not match.';
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };
  return (
    <Card>
      <CardHeader title="Change password" />
      <div className={formStyles.stack}>
        {errors.form ? <Notice tone="danger">{errors.form}</Notice> : null}
        <Field label="Current password" error={errors.current}><PasswordInput value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="New password" hint={errors.password ? undefined : 'At least 8 characters, including a letter and a number.'} error={errors.password}>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" error={errors.confirm}><PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
        <div className={w.formActions}><Button onClick={submit} loading={save.isPending}>Update password</Button></div>
        {save.isSuccess ? <Badge tone="success" icon="checkcircle" size="sm">Password updated</Badge> : null}
      </div>
    </Card>
  );
}

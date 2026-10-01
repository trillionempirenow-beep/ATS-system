import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettingsDto, SettingsInput } from '@shared/api/admin';
import { BrandMark, Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/Button';
import { Field, TextInput, Textarea, formStyles } from '@/components/ui/Form';
import { Notice, Skeleton } from '@/components/ui/Feedback';
import { Card, CardHeader, DescriptionList, PageHeader } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { ApiError, api, errorMessage } from '@/lib/api';
import { cx } from '@/lib/cx';
import { adminKeys, useAdminMutation } from './api';
import w from '../workspace.module.css';
import s from './Admin.module.css';

type Draft = { [K in keyof SettingsInput]-?: string };

const toDraft = (d: SettingsDto): Draft => ({
  companyName: d.companyName, careersHeadline: d.careersHeadline, logoPath: d.logoPath, defaultApplicantLimit: d.defaultApplicantLimit,
  interviewJoinWindowMinutes: String(d.interviewJoinWindowMinutes), passwordResetHours: String(d.passwordResetHours),
  interviewReminderMinutes: String(d.interviewReminderMinutes), attendanceTimezone: d.attendanceTimezone,
  attendanceGraceMinutes: String(d.attendanceGraceMinutes), iceServers: d.iceServers,
});

const NUMBER_RULES: Array<{ key: keyof Draft; min: number; max: number }> = [
  { key: 'interviewJoinWindowMinutes', min: 0, max: 240 },
  { key: 'passwordResetHours', min: 1, max: 168 },
  { key: 'interviewReminderMinutes', min: 5, max: 1440 },
  { key: 'attendanceGraceMinutes', min: 0, max: 120 },
];

export function SettingsPage() {
  const q = useQuery({ queryKey: adminKeys.settings, queryFn: () => api.get<SettingsDto>('/settings') });
  useEffect(() => { document.title = 'Settings · Acme People'; }, []);
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div className={w.page}>
      <PageHeader title="Settings" description="Workspace branding and hiring defaults." crumbs={[{ label: 'Administration' }, { label: 'Settings' }]} />
      {q.data ? <SettingsForm key={JSON.stringify(q.data)} data={q.data} /> : <Skeleton height={480} />}
    </div>
  );
}

function SettingsForm({ data }: { data: SettingsDto }) {
  const toast = useToast();
  const qc = useQueryClient();
  const initial = toDraft(data);
  const [f, setF] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const dirty = (Object.keys(f) as Array<keyof Draft>).some((k) => f[k] !== initial[k]);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => { setSaved(false); setF((cur) => ({ ...cur, [k]: e.target.value })); };

  const save = useAdminMutation(() => api.put('/settings', {
    ...f,
    interviewJoinWindowMinutes: Number(f.interviewJoinWindowMinutes), passwordResetHours: Number(f.passwordResetHours),
    interviewReminderMinutes: Number(f.interviewReminderMinutes), attendanceGraceMinutes: Number(f.attendanceGraceMinutes),
  }));

  const submit = () => {
    const next: Record<string, string> = {};
    if (!f.companyName.trim()) next.companyName = 'Company name is required.';
    if (!/^\d*$/.test(f.defaultApplicantLimit.trim())) next.defaultApplicantLimit = 'Use a whole number or leave blank.';
    for (const r of NUMBER_RULES) {
      const n = Number(f[r.key]);
      if (!/^\d+$/.test(f[r.key].trim()) || n < r.min || n > r.max) next[r.key] = `Use a whole number from ${r.min} to ${r.max}.`;
    }
    try { if (!Array.isArray(JSON.parse(f.iceServers))) throw new Error(); } catch { next.iceServers = 'Enter a JSON array such as [{"urls":"stun:stun.l.google.com:19302"}].'; }
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate(undefined, {
      onSuccess: () => { setSaved(true); toast.success('Settings saved.'); void qc.invalidateQueries({ queryKey: ['public'] }); },
      onError: (e) => { if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields); else toast.error(errorMessage(e)); },
    });
  };

  const logoOk = /^https:\/\//.test(f.logoPath) || /^\/?[\w\-./]+\.(png|jpg|jpeg|svg|webp)$/i.test(f.logoPath);

  return (
    <div className={w.cols21}>
      <div className={w.stack}>
        <Card>
          <CardHeader title="Branding" subtitle="Shown on the careers site, emails and the sign-in page." />
          <div className={formStyles.stack}>
            <Field label="Logo image path or URL" hint="An https:// image URL, or leave blank to use the Acme mark." error={errors.logoPath}><TextInput value={f.logoPath} onChange={set('logoPath')} maxLength={500} /></Field>
            <div className={formStyles.grid2}>
              <Field label="Company name" required error={errors.companyName}><TextInput value={f.companyName} onChange={set('companyName')} maxLength={120} /></Field>
              <Field label="Careers page headline" error={errors.careersHeadline}><TextInput value={f.careersHeadline} onChange={set('careersHeadline')} maxLength={160} /></Field>
            </div>
            <div className={s.logoPreview}>
              {f.logoPath && logoOk ? <img src={f.logoPath} alt="" /> : <BrandMark size={32} label={`${f.companyName || 'Acme'} logo`} />}
              <strong>{f.companyName || 'Acme'}</strong>
              <span className={w.faint}>Logo preview</span>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Hiring defaults" />
          <div className={formStyles.stack}>
            <Field label="Default applicant limit for new roles" optional hint="Applies to new postings. Each role can override it." error={errors.defaultApplicantLimit}>
              <TextInput inputMode="numeric" value={f.defaultApplicantLimit} onChange={set('defaultApplicantLimit')} />
            </Field>
            <div className={formStyles.grid2}>
              <Field label="Interview room opens (minutes before start)" error={errors.interviewJoinWindowMinutes}><TextInput inputMode="numeric" value={f.interviewJoinWindowMinutes} onChange={set('interviewJoinWindowMinutes')} /></Field>
              <Field label="Interview reminder (minutes before start)" error={errors.interviewReminderMinutes}><TextInput inputMode="numeric" value={f.interviewReminderMinutes} onChange={set('interviewReminderMinutes')} /></Field>
              <Field label="Password reset link lifetime (hours)" error={errors.passwordResetHours}><TextInput inputMode="numeric" value={f.passwordResetHours} onChange={set('passwordResetHours')} /></Field>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Attendance" />
          <div className={formStyles.grid2}>
            <Field label="Timezone" hint="IANA name, for example Asia/Manila." error={errors.attendanceTimezone}><TextInput value={f.attendanceTimezone} onChange={set('attendanceTimezone')} maxLength={60} /></Field>
            <Field label="Late after (grace minutes)" error={errors.attendanceGraceMinutes}><TextInput inputMode="numeric" value={f.attendanceGraceMinutes} onChange={set('attendanceGraceMinutes')} /></Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Interview room connectivity" subtitle="STUN and TURN servers used for video calls." />
          <Field label="ICE servers (JSON)" hint="Add a TURN server for candidates behind strict firewalls." error={errors.iceServers}>
            <Textarea rows={4} className="mono" value={f.iceServers} onChange={set('iceServers')} />
          </Field>
        </Card>
        <div className={w.stickyActions}>
          <span className={cx(w.stickyStatus, saved && !dirty && w.stickyStatusOk)} role="status">
            {save.isPending ? 'Saving…' : dirty ? 'You have unsaved changes.' : saved ? <><Icon name="checkcircle" size={14} />All changes saved.</> : 'No changes yet.'}
          </span>
          <Button variant="ghost" disabled={!dirty} onClick={() => { setF(initial); setErrors({}); }}>Discard</Button>
          <Button disabled={!dirty} loading={save.isPending} onClick={submit}>Save settings</Button>
        </div>
      </div>
      <Card>
        <CardHeader title="Integrations" subtitle="Configured through environment variables on the server." />
        <DescriptionList items={[
          ['Email', data.integrations.email === 'none' ? 'Off' : data.integrations.email],
          ['n8n automation', data.integrations.n8n ? 'On' : 'Off'],
          ['File storage', data.integrations.storage],
          ['Realtime', data.integrations.realtime],
        ]} />
        {data.integrations.email === 'log' || data.integrations.email === 'none'
          ? <Notice tone="info" className={w.mt12}>Emails are not delivered to real inboxes in this environment.</Notice> : null}
      </Card>
    </div>
  );
}

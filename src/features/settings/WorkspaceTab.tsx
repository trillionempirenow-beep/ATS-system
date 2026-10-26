import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettingsDto } from '@shared/api/admin';
import { BrandMark, Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Form';
import { Skeleton } from '@/components/ui/Feedback';
import { Card, CardHeader } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { ApiError, api, errorMessage } from '@/lib/api';
import { cx } from '@/lib/cx';
import { adminKeys, useAdminMutation } from '../admin/api';
import w from '../workspace.module.css';
import s from './Settings.module.css';

/** The values people edit. Technical ones (video-call servers, reset-link lifetime) are not shown and are left as they are. */
interface Draft {
  companyName: string;
  careersHeadline: string;
  logoPath: string;
  defaultApplicantLimit: string;
  interviewJoinWindowMinutes: string;
  interviewReminderMinutes: string;
  attendanceTimezone: string;
  attendanceGraceMinutes: string;
  recordingRetentionDays: string;
}

const toDraft = (d: SettingsDto): Draft => ({
  companyName: d.companyName,
  careersHeadline: d.careersHeadline,
  logoPath: d.logoPath,
  defaultApplicantLimit: d.defaultApplicantLimit,
  interviewJoinWindowMinutes: String(d.interviewJoinWindowMinutes),
  interviewReminderMinutes: String(d.interviewReminderMinutes),
  attendanceTimezone: d.attendanceTimezone,
  attendanceGraceMinutes: String(d.attendanceGraceMinutes),
  recordingRetentionDays: String(d.recordingRetentionDays),
});

const NUMBER_RULES: Array<{ key: keyof Draft; min: number; max: number; label: string }> = [
  { key: 'interviewJoinWindowMinutes', min: 0, max: 240, label: 'Room opening time' },
  { key: 'interviewReminderMinutes', min: 5, max: 1440, label: 'Reminder time' },
  { key: 'attendanceGraceMinutes', min: 0, max: 120, label: 'Grace period' },
  { key: 'recordingRetentionDays', min: 1, max: 3650, label: 'Recording retention' },
];

const TIMEZONES = [
  'Asia/Manila', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Hong_Kong', 'Asia/Kolkata', 'Asia/Dubai',
  'Australia/Sydney', 'Pacific/Auckland', 'Europe/London', 'Europe/Berlin', 'Europe/Paris',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC',
];

const JOIN_WINDOWS = [0, 5, 10, 15, 30, 60];
const REMINDERS = [15, 30, 60, 120, 240, 1440];
const GRACES = [0, 5, 10, 15, 30];
const RETENTION = [30, 60, 90, 180, 365];

const minutesLabel = (m: number) => (m === 0 ? 'Exactly at start time' : m >= 1440 ? '1 day before' : m >= 60 && m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'} before` : `${m} minutes before`);

export function WorkspaceTab() {
  const q = useQuery({ queryKey: adminKeys.settings, queryFn: () => api.get<SettingsDto>('/settings') });
  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  return q.data ? <WorkspaceForm key={JSON.stringify(q.data)} data={q.data} /> : <Skeleton height={480} />;
}

function WorkspaceForm({ data }: { data: SettingsDto }) {
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
    interviewJoinWindowMinutes: Number(f.interviewJoinWindowMinutes),
    interviewReminderMinutes: Number(f.interviewReminderMinutes),
    attendanceGraceMinutes: Number(f.attendanceGraceMinutes),
    recordingRetentionDays: Number(f.recordingRetentionDays),
  }));

  const submit = () => {
    const next: Record<string, string> = {};
    if (!f.companyName.trim()) next.companyName = 'Company name is required.';
    if (!/^\d*$/.test(f.defaultApplicantLimit.trim())) next.defaultApplicantLimit = 'Use a whole number or leave blank.';
    for (const r of NUMBER_RULES) {
      const n = Number(f[r.key]);
      if (!/^\d+$/.test(f[r.key].trim()) || n < r.min || n > r.max) next[r.key] = `${r.label}: use a whole number from ${r.min} to ${r.max}.`;
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate(undefined, {
      onSuccess: () => { setSaved(true); toast.success('Settings saved.'); void qc.invalidateQueries({ queryKey: ['public'] }); },
      onError: (e) => { if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields); else toast.error(errorMessage(e)); },
    });
  };

  const logoOk = /^https:\/\//.test(f.logoPath) || /^\/?[\w\-./]+\.(png|jpg|jpeg|svg|webp)$/i.test(f.logoPath);
  const zones = TIMEZONES.includes(f.attendanceTimezone) ? TIMEZONES : [f.attendanceTimezone, ...TIMEZONES];
  const withCurrent = (list: number[], value: string) => (list.includes(Number(value)) || !/^\d+$/.test(value) ? list : [...list, Number(value)].sort((a, b) => a - b));

  return (
    <div className={s.layout}>
      <div className={s.col}>
        <Card>
          <CardHeader title="Company" subtitle="Shown on the careers site, in emails and on the sign-in page." />
          <div className={s.preview}>
            {f.logoPath && logoOk ? <img src={f.logoPath} alt="" /> : <BrandMark size={44} label={`${f.companyName || 'Acme'} logo`} />}
            <div>
              <strong>{f.companyName || 'Your company'}</strong>
              <span>{f.careersHeadline || 'Your careers headline appears here'}</span>
            </div>
          </div>
          <div className={s.fields}>
            <div className={s.pair}>
              <Field label="Company name" required error={errors.companyName}><TextInput value={f.companyName} onChange={set('companyName')} maxLength={120} /></Field>
              <Field label="Careers headline" error={errors.careersHeadline}><TextInput value={f.careersHeadline} onChange={set('careersHeadline')} maxLength={160} /></Field>
            </div>
            <Field label="Logo image" optional hint="Paste an https:// image address. Leave blank to use the default mark." error={errors.logoPath}>
              <TextInput value={f.logoPath} onChange={set('logoPath')} maxLength={500} placeholder="https://" />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Hiring" subtitle="Defaults for every new job posting." />
          <Field label="Applicant limit" optional hint="Stop accepting applications after this many. Each role can use its own number." error={errors.defaultApplicantLimit}>
            <TextInput inputMode="numeric" value={f.defaultApplicantLimit} onChange={set('defaultApplicantLimit')} placeholder="No limit" />
          </Field>
        </Card>

        <Card>
          <CardHeader title="Interviews" subtitle="When people can enter the room and when they are reminded." />
          <div className={s.pair}>
            <Field label="Room opens" error={errors.interviewJoinWindowMinutes} hint="Candidates and interviewers can enter from this time.">
              <Select
                value={f.interviewJoinWindowMinutes}
                onChange={set('interviewJoinWindowMinutes')}
                options={withCurrent(JOIN_WINDOWS, f.interviewJoinWindowMinutes).map((m) => ({ value: String(m), label: minutesLabel(m) }))}
              />
            </Field>
            <Field label="Reminder email" error={errors.interviewReminderMinutes} hint="Sent to the candidate and the interviewer.">
              <Select
                value={f.interviewReminderMinutes}
                onChange={set('interviewReminderMinutes')}
                options={withCurrent(REMINDERS, f.interviewReminderMinutes).map((m) => ({ value: String(m), label: minutesLabel(m) }))}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Meeting recordings" subtitle="How long recorded meetings are kept before they are deleted." />
          <Field label="Keep recordings for" error={errors.recordingRetentionDays} hint="Counted from the day of the meeting. Deleted recordings cannot be brought back.">
            <Select
              value={f.recordingRetentionDays}
              onChange={set('recordingRetentionDays')}
              options={withCurrent(RETENTION, f.recordingRetentionDays).map((d) => ({ value: String(d), label: d === 365 ? '1 year' : `${d} days` }))}
            />
          </Field>
        </Card>

        <Card>
          <CardHeader title="Attendance" subtitle="How employee check-ins are timed." />
          <div className={s.pair}>
            <Field label="Time zone" error={errors.attendanceTimezone} hint="Used for working days and late marks.">
              <Select value={f.attendanceTimezone} onChange={set('attendanceTimezone')} options={zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))} />
            </Field>
            <Field label="Grace period" error={errors.attendanceGraceMinutes} hint="Check-ins within this time are not marked late.">
              <Select
                value={f.attendanceGraceMinutes}
                onChange={set('attendanceGraceMinutes')}
                options={withCurrent(GRACES, f.attendanceGraceMinutes).map((m) => ({ value: String(m), label: m === 0 ? 'None' : `${m} minutes` }))}
              />
            </Field>
          </div>
        </Card>

        <div className={w.stickyActions}>
          <span className={cx(w.stickyStatus, saved && !dirty && w.stickyStatusOk)} role="status">
            {save.isPending ? 'Saving…' : dirty ? 'You have unsaved changes.' : saved ? <><Icon name="checkcircle" size={14} />All changes saved.</> : 'No changes yet.'}
          </span>
          <Button variant="ghost" disabled={!dirty} onClick={() => { setF(initial); setErrors({}); }}>Discard</Button>
          <Button disabled={!dirty} loading={save.isPending} onClick={submit}>Save changes</Button>
        </div>
      </div>

      <div className={s.col}>
        <Card>
          <CardHeader title="Who can change this" />
          <p className={s.note}>Only Admins and Super Admins can edit workspace settings. Every change is written to the audit trail with who made it.</p>
        </Card>
      </div>
    </div>
  );
}

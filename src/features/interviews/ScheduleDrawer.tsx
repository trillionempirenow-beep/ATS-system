import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { ScheduleOptionsDto } from '@shared/api/interviews';
import { INTERVIEW_TYPES, type InterviewType, type MeetingType } from '@shared/domain/interviews';
import { STAGE_LABELS } from '@shared/domain/pipeline';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, SegmentedControl, Select, TextInput, Textarea, formStyles } from '@/components/ui/Form';
import { Notice, Skeleton } from '@/components/ui/Feedback';
import { Drawer } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/app/providers/AuthProvider';
import { applyServerErrors } from '@/lib/forms';
import { deliveryNote } from '@/lib/delivery';
import { formatTime, fromLocalInput, toLocalInput } from '@/lib/format';
import { useScheduleInterview, useScheduleOptions } from './api';

export const FORMAT_LABELS: Record<InterviewType, string> = { video: 'Video', phone: 'Phone', panel: 'Panel', onsite: 'On-site' };
const PROVIDERS = ['Zoom', 'Google Meet', 'Microsoft Teams', 'Other'];

interface Values {
  applicationId: string;
  meetingType: MeetingType;
  interviewType: InterviewType;
  interviewerId: string;
  meetingMode: 'builtin' | 'external';
  meetingProvider: string;
  meetingUrl: string;
  location: string;
  startsAt: string;
  endsAt: string;
  notes: string;
  sendInvite: boolean;
}
const KNOWN = ['applicationId', 'interviewerId', 'meetingUrl', 'location', 'startsAt', 'endsAt'];

function nextHalfHour(offsetMinutes = 0): string {
  const d = new Date(Date.now() + 24 * 3600_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return toLocalInput(new Date(d.getTime() + offsetMinutes * 60_000).toISOString());
}

/** Soft clash warning: the server only refuses the exact same start time. */
function nearbyBooking(options: ScheduleOptionsDto | undefined, interviewerId: string, startsAt: string): string | null {
  if (!options || !interviewerId || !startsAt) return null;
  const at = new Date(startsAt).getTime();
  const hit = options.busySlots.find((b) => String(b.interviewerId) === interviewerId && Math.abs(new Date(b.startsAt).getTime() - at) < 60 * 60_000);
  return hit ? hit.startsAt : null;
}

export function ScheduleDrawer({ open, applicationId, onClose }: { open: boolean; applicationId?: number | null; onClose: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const options = useScheduleOptions(open);
  const schedule = useScheduleInterview();
  const [formError, setFormError] = useState<string | null>(null);
  const defaults = useMemo<Values>(() => ({
    applicationId: applicationId ? String(applicationId) : '',
    meetingType: 'interview', interviewType: 'video', interviewerId: user ? String(user.id) : '',
    meetingMode: 'builtin', meetingProvider: 'Zoom', meetingUrl: '', location: '',
    startsAt: nextHalfHour(), endsAt: nextHalfHour(45), notes: '', sendInvite: true,
  }), [applicationId, user]);
  const { register, handleSubmit, control, watch, reset, setError, setValue, formState: { errors } } = useForm<Values>({ defaultValues: defaults });

  useEffect(() => { if (open) { reset(defaults); setFormError(null); } }, [open, defaults, reset]);

  const opts = options.data;
  const appId = watch('applicationId');
  const selectedApp = opts?.applications.find((a) => String(a.id) === appId);
  useEffect(() => {
    if (selectedApp) setValue('meetingType', selectedApp.stage === 'new' || selectedApp.stage === 'screening' ? 'screening' : 'interview');
  }, [selectedApp, setValue]);
  const mode = watch('meetingMode');
  const format = watch('interviewType');
  const interviewerId = watch('interviewerId');
  const clash = nearbyBooking(opts, interviewerId, watch('startsAt'));
  const clashName = opts?.interviewers.find((i) => String(i.id) === interviewerId)?.name;
  const interviewerKnown = opts?.interviewers.some((i) => String(i.id) === interviewerId);

  const onSubmit = handleSubmit((v) => {
    setFormError(null);
    let bad = false;
    if (!v.applicationId) { setError('applicationId', { message: 'Please select an application.' }); bad = true; }
    if (!v.startsAt) { setError('startsAt', { message: 'Choose when the interview starts.' }); bad = true; }
    if (v.endsAt && v.startsAt && new Date(v.endsAt) <= new Date(v.startsAt)) { setError('endsAt', { message: 'The end time must be after the start time.' }); bad = true; }
    if (v.meetingMode === 'external' && v.meetingUrl && !/^https?:\/\//i.test(v.meetingUrl)) { setError('meetingUrl', { message: 'Enter a full link that starts with https://.' }); bad = true; }
    if (v.interviewType === 'onsite' && !v.location.trim()) { setError('location', { message: 'Add the address for an onsite interview.' }); bad = true; }
    if (bad) return;
    const onsite = v.interviewType === 'onsite';
    const external = !onsite && v.meetingMode === 'external';
    schedule.mutate({
      applicationId: Number(v.applicationId),
      meetingType: v.meetingType,
      interviewType: v.interviewType,
      interviewerId: v.interviewerId ? Number(v.interviewerId) : undefined,
      meetingMode: onsite || external ? 'external' : 'builtin',
      meetingProvider: onsite ? 'On-site' : external ? v.meetingProvider : '',
      meetingUrl: external ? v.meetingUrl.trim() : '',
      location: v.location.trim(),
      startsAt: fromLocalInput(v.startsAt),
      endsAt: v.endsAt ? fromLocalInput(v.endsAt) : null,
      notes: v.notes.trim(),
      sendInvite: v.sendInvite,
    }, {
      onSuccess: (r) => {
        toast.success(`Interview scheduled.${v.sendInvite ? deliveryNote(r) : ''}`, 'Saved');
        onClose();
      },
      onError: (e) => setFormError(applyServerErrors(e, setError, KNOWN)),
    });
  });

  return (
    <Drawer open={open} onClose={onClose} width={520} title="Schedule interview" subtitle="Pick the candidate, set the time, and choose how the meeting happens."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => void onSubmit()} loading={schedule.isPending} disabled={!opts}>Save interview</Button>
      </>}>
      {!opts ? (
        options.isError ? <Notice tone="danger">The scheduling options could not be loaded. Close this panel and try again.</Notice>
          : <div className={formStyles.stack}>{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={44} />)}</div>
      ) : (
        <form className={formStyles.stack} noValidate onSubmit={(e) => { e.preventDefault(); void onSubmit(); }}>
          {formError ? <Notice tone="danger">{formError}</Notice> : null}
          {opts.applications.length === 0 ? <Notice tone="info">There are no active applications to schedule. Candidates who are hired or rejected cannot be scheduled.</Notice> : null}
          <Field label="Candidate / role" required error={errors.applicationId?.message}>
            <Select {...register('applicationId')} placeholder="Select application"
              options={opts.applications.map((a) => ({ value: a.id, label: `${a.candidateName} · ${a.jobTitle} (${STAGE_LABELS[a.stage]})` }))} />
          </Field>
          <Controller control={control} name="meetingType" render={({ field }) => (
            <Field label="Meeting type"><SegmentedControl label="Meeting type" value={field.value} onChange={field.onChange} options={[{ value: 'screening', label: 'Screening' }, { value: 'interview', label: 'Interview' }]} /></Field>
          )} />
          <Controller control={control} name="interviewType" render={({ field }) => (
            <Field label="Format"><SegmentedControl label="Format" value={field.value} onChange={field.onChange} options={INTERVIEW_TYPES.map((t) => ({ value: t, label: FORMAT_LABELS[t] }))} /></Field>
          )} />
          <Field label="Interviewer" required error={errors.interviewerId?.message}>
            <Select {...register('interviewerId')}
              options={[
                ...(!interviewerKnown && user ? [{ value: user.id, label: `${user.name} (you)` }] : []),
                ...opts.interviewers.map((i) => ({ value: i.id, label: `${i.name} (${i.upcomingCount} upcoming)` })),
              ]} />
          </Field>
          {format === 'onsite' ? (
            <Field label="Address" required error={errors.location?.message}><TextInput {...register('location')} placeholder="Office, floor and room" /></Field>
          ) : (
            <Controller control={control} name="meetingMode" render={({ field }) => (
              <Field label="Meeting"><SegmentedControl label="Meeting" value={field.value} onChange={field.onChange} options={[{ value: 'builtin', label: 'Built-in Acme Room' }, { value: 'external', label: 'External link' }]} /></Field>
            )} />
          )}
          {format !== 'onsite' && mode === 'external' ? (
            <div className={formStyles.grid2}>
              <Field label="External provider"><Select {...register('meetingProvider')} options={PROVIDERS.map((p) => ({ value: p, label: p }))} /></Field>
              <Field label="Meeting link" hint="Enter a full link that starts with https://." error={errors.meetingUrl?.message}><TextInput type="url" {...register('meetingUrl')} placeholder="https://" /></Field>
            </div>
          ) : null}
          <div className={formStyles.grid2}>
            <Field label="Starts at" required error={errors.startsAt?.message}><TextInput type="datetime-local" {...register('startsAt')} /></Field>
            <Field label="Ends at" required error={errors.endsAt?.message}><TextInput type="datetime-local" {...register('endsAt')} /></Field>
          </div>
          {clash ? <Notice tone="warning" title={`${clashName ?? 'This interviewer'} already has an interview at ${formatTime(clash)}.`}>You can still save. Check that the times do not overlap.</Notice> : null}
          <Field label="Notes" optional><Textarea rows={3} maxLength={2000} {...register('notes')} /></Field>
          <Checkbox {...register('sendInvite')} label="Email the invitation to the candidate" description={mode === 'builtin' && format !== 'onsite' ? 'Includes their private link to the Acme Room.' : 'Includes the time, format and meeting details.'} />
        </form>
      )}
    </Drawer>
  );
}

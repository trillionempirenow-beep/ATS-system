import { useEffect, useRef, useState } from 'react';
import type { InterviewListItemDto, UpdateInterviewInput } from '@shared/api/interviews';
import { INTERVIEW_TYPES, type InterviewType } from '@shared/domain/interviews';
import { Button } from '@/components/ui/Button';
import { useConfirm, useDiscardGuard } from '@/components/ui/DiscardGuard';
import { Avatar, StatusBadge } from '@/components/ui/Display';
import { Checkbox, Field, Select, TextInput, formStyles } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Feedback';
import { Drawer } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api';
import { deliveryNote } from '@/lib/delivery';
import { fromLocalInput, toLocalInput } from '@/lib/format';
import { useScheduleOptions, useUpdateInterview } from './api';
import { FORMAT_LABELS } from './ScheduleDrawer';
import w from '../workspace.module.css';

type FieldErrors = { startsAt?: string; endsAt?: string; location?: string };
const FORM_ID = 'reschedule-interview-form';

/** Move, reassign, cancel or mark a no-show. The candidate is emailed about changes unless unticked. */
export function RescheduleDrawer({ interview, onClose }: { interview: InterviewListItemDto | null; onClose: () => void }) {
  const toast = useToast();
  const options = useScheduleOptions(Boolean(interview));
  const update = useUpdateInterview(interview?.id ?? 0);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [interviewerId, setInterviewerId] = useState('');
  const [type, setType] = useState<InterviewType>('video');
  const [location, setLocation] = useState('');
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const startsRef = useRef<HTMLInputElement>(null);
  const endsRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);

  const initial = interview ? {
    startsAt: toLocalInput(interview.startsAt),
    endsAt: interview.endsAt ? toLocalInput(interview.endsAt) : '',
    interviewerId: interview.interviewerId ? String(interview.interviewerId) : '',
    type: interview.interviewType,
    location: interview.location ?? '',
  } : null;
  const dirty = Boolean(initial) && !update.isPending && (
    startsAt !== initial!.startsAt || endsAt !== initial!.endsAt || interviewerId !== initial!.interviewerId
    || type !== initial!.type || location.trim() !== initial!.location
  );
  const discard = useDiscardGuard(dirty);
  const confirm = useConfirm({
    title: 'Cancel this interview?',
    body: <p>The interview is marked as cancelled{notify ? ' and the candidate is emailed' : ''}. This can&rsquo;t be undone; you would need to schedule a new one.</p>,
    confirmLabel: 'Cancel interview',
  });
  const confirmNoShow = useConfirm({
    title: 'Mark as a no-show?',
    body: <p>This records that the candidate didn&rsquo;t attend{notify ? ' and emails them about it' : ''}.</p>,
    confirmLabel: 'Mark as no-show',
  });

  useEffect(() => {
    if (!interview) return;
    setStartsAt(toLocalInput(interview.startsAt));
    setEndsAt(interview.endsAt ? toLocalInput(interview.endsAt) : '');
    setInterviewerId(interview.interviewerId ? String(interview.interviewerId) : '');
    setType(interview.interviewType);
    setLocation(interview.location ?? '');
    setNotify(true);
    setError(null);
    setFieldErrors({});
  }, [interview]);

  if (!interview) return null;

  const close = () => discard.guard(onClose);
  const run = (input: UpdateInterviewInput, done: string) => {
    setError(null);
    update.mutate({ ...input, notifyCandidate: notify }, {
      onSuccess: (r) => { toast.success(`${done}${notify ? deliveryNote(r) : ''}`); onClose(); },
      onError: (e) => setError(errorMessage(e)),
    });
  };
  const save = () => {
    const next: FieldErrors = {};
    if (!startsAt) next.startsAt = 'Choose when the interview starts.';
    else if (endsAt && new Date(endsAt) <= new Date(startsAt)) next.endsAt = 'The end time must be after the start time.';
    if (type === 'onsite' && !location.trim()) next.location = 'Add the address for an onsite interview.';
    setFieldErrors(next);
    // Take the user to the first problem, in page order.
    if (next.startsAt) return startsRef.current?.focus();
    if (next.endsAt) return endsRef.current?.focus();
    if (next.location) return locationRef.current?.focus();
    run({
      startsAt: fromLocalInput(startsAt),
      endsAt: endsAt ? fromLocalInput(endsAt) : null,
      interviewerId: interviewerId ? Number(interviewerId) : undefined,
      interviewType: type,
      location: location.trim(),
    }, 'Interview updated.');
  };

  return (
    <Drawer open onClose={close} width={500} title="Reschedule interview" subtitle="Changes are saved to the interview and the candidate’s history."
      footer={<>
        <Button variant="dangerGhost" onClick={() => confirm.ask(() => run({ status: 'cancelled' }, 'Interview cancelled.'))} disabled={update.isPending}>Cancel interview</Button>
        <span className={w.grow} />
        <Button variant="ghost" onClick={close}>Close</Button>
        <Button type="submit" form={FORM_ID} loading={update.isPending}>Save changes</Button>
      </>}>
      <form id={FORM_ID} className={formStyles.stack} noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className={w.person}>
          <Avatar name={interview.candidateName} src={interview.avatarUrl} size={40} />
          <div className={w.personText}>
            <span className={w.personName}>{interview.candidateName}</span>
            <span className={w.personSub}>{interview.jobTitle} · {interview.meetingType === 'screening' ? 'Screening' : 'Interview'}</span>
          </div>
          <StatusBadge kind="interview" value={interview.state} size="sm" />
        </div>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className={formStyles.grid2}>
          <Field label="Starts at" required error={fieldErrors.startsAt}><TextInput ref={startsRef} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></Field>
          <Field label="Ends at" error={fieldErrors.endsAt}><TextInput ref={endsRef} type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></Field>
        </div>
        <div className={formStyles.grid2}>
          <Field label="Interviewer">
            <Select value={interviewerId} onChange={(e) => setInterviewerId(e.target.value)}
              options={(options.data?.interviewers ?? (interview.interviewerId ? [{ id: interview.interviewerId, name: interview.interviewerName ?? 'Current interviewer', upcomingCount: 0, roleLabel: '' }] : []))
                .map((i) => ({ value: i.id, label: i.name }))} />
          </Field>
          <Field label="Format"><Select value={type} onChange={(e) => setType(e.target.value as InterviewType)} options={INTERVIEW_TYPES.map((t) => ({ value: t, label: FORMAT_LABELS[t] }))} /></Field>
        </div>
        {type === 'onsite' ? <Field label="Address" required error={fieldErrors.location}><TextInput ref={locationRef} value={location} onChange={(e) => setLocation(e.target.value)} /></Field> : null}
        <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} label="Email the candidate about this change" />
        {interview.state !== 'no_show' && new Date(interview.startsAt).getTime() < Date.now() ? (
          <Button variant="secondary" size="sm" className={w.selfStart} disabled={update.isPending}
            onClick={() => confirmNoShow.ask(() => run({ status: 'no_show' }, 'Marked as a no-show.'))}>Mark as no-show</Button>
        ) : null}
      </form>
      {discard.dialog}
      {confirm.dialog}
      {confirmNoShow.dialog}
    </Drawer>
  );
}

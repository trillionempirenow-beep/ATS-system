import { useEffect, useState } from 'react';
import type { InterviewListItemDto, UpdateInterviewInput } from '@shared/api/interviews';
import { INTERVIEW_TYPES, type InterviewType } from '@shared/domain/interviews';
import { Button } from '@/components/ui/Button';
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

  useEffect(() => {
    if (!interview) return;
    setStartsAt(toLocalInput(interview.startsAt));
    setEndsAt(interview.endsAt ? toLocalInput(interview.endsAt) : '');
    setInterviewerId(interview.interviewerId ? String(interview.interviewerId) : '');
    setType(interview.interviewType);
    setLocation(interview.location ?? '');
    setNotify(true);
    setError(null);
  }, [interview]);

  if (!interview) return null;

  const run = (input: UpdateInterviewInput, done: string) => {
    setError(null);
    update.mutate({ ...input, notifyCandidate: notify }, {
      onSuccess: (r) => { toast.success(`${done}${notify ? deliveryNote(r) : ''}`); onClose(); },
      onError: (e) => setError(errorMessage(e)),
    });
  };
  const save = () => {
    if (!startsAt) return setError('Choose when the interview starts.');
    if (endsAt && new Date(endsAt) <= new Date(startsAt)) return setError('The end time must be after the start time.');
    if (type === 'onsite' && !location.trim()) return setError('Add the address for an onsite interview.');
    run({
      startsAt: fromLocalInput(startsAt),
      endsAt: endsAt ? fromLocalInput(endsAt) : null,
      interviewerId: interviewerId ? Number(interviewerId) : undefined,
      interviewType: type,
      location: location.trim(),
    }, 'Interview updated.');
  };

  return (
    <Drawer open onClose={onClose} width={500} title="Reschedule interview" subtitle="Changes are saved to the interview and the candidate’s history."
      footer={<>
        <Button variant="dangerGhost" onClick={() => run({ status: 'cancelled' }, 'Interview cancelled.')} disabled={update.isPending}>Cancel interview</Button>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button onClick={save} loading={update.isPending}>Save changes</Button>
      </>}>
      <div className={formStyles.stack}>
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
          <Field label="Starts at" required><TextInput type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></Field>
          <Field label="Ends at"><TextInput type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></Field>
        </div>
        <div className={formStyles.grid2}>
          <Field label="Interviewer">
            <Select value={interviewerId} onChange={(e) => setInterviewerId(e.target.value)}
              options={(options.data?.interviewers ?? (interview.interviewerId ? [{ id: interview.interviewerId, name: interview.interviewerName ?? 'Current interviewer', upcomingCount: 0, roleLabel: '' }] : []))
                .map((i) => ({ value: i.id, label: i.name }))} />
          </Field>
          <Field label="Format"><Select value={type} onChange={(e) => setType(e.target.value as InterviewType)} options={INTERVIEW_TYPES.map((t) => ({ value: t, label: FORMAT_LABELS[t] }))} /></Field>
        </div>
        {type === 'onsite' ? <Field label="Address" required><TextInput value={location} onChange={(e) => setLocation(e.target.value)} /></Field> : null}
        <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} label="Email the candidate about this change" />
        {interview.state !== 'no_show' && new Date(interview.startsAt).getTime() < Date.now() ? (
          <Button variant="secondary" size="sm" style={{ alignSelf: 'flex-start' }} onClick={() => run({ status: 'no_show' }, 'Marked as a no-show.')} disabled={update.isPending}>Mark as no-show</Button>
        ) : null}
      </div>
    </Drawer>
  );
}

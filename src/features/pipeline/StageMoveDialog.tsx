import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { STAGE_LABELS, classifyMove, isStageSkip, transitionMessage, type Stage } from '@shared/domain/pipeline';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/Button';
import { Avatar, StatusBadge } from '@/components/ui/Display';
import { Checkbox } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/app/providers/AuthProvider';
import { ApiError, errorMessage } from '@/lib/api';
import { deliveryNote } from '@/lib/delivery';
import { useMoveStage } from './api';
import w from '../workspace.module.css';
import s from './Pipeline.module.css';

export interface PendingMove {
  applicationId: number;
  name: string;
  jobTitle: string;
  avatarUrl: string | null;
  from: Stage;
  to: Stage;
}

type Step = 'move' | 'confirm' | 'blocked' | 'override';

function StageArrow({ from, to }: { from: Stage; to: Stage }) {
  return (
    <div className={s.dialogTransition}>
      <StatusBadge kind="stage" value={from} />
      <Icon name="arrowr" size={16} />
      <StatusBadge kind="stage" value={to} />
    </div>
  );
}

function Transition({ move }: { move: PendingMove }) {
  return (
    <div className={s.dialogBody}>
      <div className={s.dialogPerson}>
        <Avatar name={move.name} src={move.avatarUrl} size={36} />
        <div className={w.personText}><span className={w.personName}>{move.name}</span><span className={w.personSub}>{move.jobTitle}</span></div>
      </div>
      <StageArrow from={move.from} to={move.to} />
    </div>
  );
}

/**
 * The two-step stage change (R12 → R13): Move, then Confirm. Skipping forward is
 * blocked for HR / Recruiters (R14) and offered as an override to Admins (R15).
 * The server enforces the same rule.
 */
export function StageMoveDialog({ move, onClose }: { move: PendingMove | null; onClose: () => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const toast = useToast();
  const mutation = useMoveStage();
  const [step, setStep] = useState<Step>('move');
  const [confirmed, setConfirmed] = useState(false);
  const [notify, setNotify] = useState(false);
  const [override, setOverride] = useState(false);

  useEffect(() => {
    if (!move) return;
    const skip = isStageSkip(move.from, move.to);
    setStep(skip ? (isAdmin ? 'override' : 'blocked') : 'move');
    setConfirmed(false);
    setOverride(false);
    setNotify(['rejected', 'offer', 'hired'].includes(move.to));
  }, [move, isAdmin]);

  if (!move) return null;
  const kind = classifyMove(move.from, move.to);

  const submit = async () => {
    try {
      const res = await mutation.mutateAsync({ applicationId: move.applicationId, stage: move.to, override, notifyApplicant: notify });
      toast.success(`${move.name} moved to ${STAGE_LABELS[move.to]}.${deliveryNote(res, 'The applicant')}`, 'Stage updated');
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'skip_blocked') setStep('blocked');
      else toast.error(errorMessage(e), 'Stage not changed');
    }
  };

  if (step === 'blocked') {
    return (
      <Modal open title="Stage cannot be skipped" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Back to pipeline</Button>}>
        <div className={s.dialogBody}>
          <Transition move={move} />
          <Notice tone="danger" title="This candidate cannot skip stages.">Complete the required recruitment stages first, or ask an Admin to override.</Notice>
        </div>
      </Modal>
    );
  }
  if (step === 'override') {
    return (
      <Modal open title="This move skips a stage" onClose={onClose}
        footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => { setOverride(true); setStep('confirm'); }}>Override and continue</Button></>}>
        <div className={s.dialogBody}>
          <Transition move={move} />
          <Notice tone="warning" title={transitionMessage(move.from, move.to)}>As an admin, you can override this. The override is written to the audit trail.</Notice>
        </div>
      </Modal>
    );
  }
  if (step === 'move') {
    return (
      <Modal open title={kind === 'reject' ? 'Reject candidate?' : 'Move candidate?'} onClose={onClose}
        footer={<>
          <Link to={`/app/candidates/${move.applicationId}`} className={w.link} style={{ marginRight: 'auto', alignSelf: 'center' }}>View candidate profile</Link>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => setStep('confirm')}>Continue</Button>
        </>}>
        <div className={s.dialogBody}>
          <Transition move={move} />
          <p className={w.muted}>
            {transitionMessage(move.from, move.to)} {kind !== 'reject' ? 'Everyone following this candidate is notified.' : ''}
          </p>
        </div>
      </Modal>
    );
  }
  return (
    <Modal open title="Confirm stage change" onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={() => setStep(override ? 'override' : 'move')}>Back</Button>
        <Button variant={kind === 'reject' ? 'danger' : 'primary'} disabled={!confirmed} loading={mutation.isPending} onClick={() => void submit()}>
          {kind === 'reject' ? 'Confirm and reject' : 'Confirm and move'}
        </Button>
      </>}>
      <div className={s.dialogBody}>
        <div className={w.row} style={{ gap: 8 }}><span className={w.faint}>Candidate:</span><strong>{move.name}</strong></div>
        <StageArrow from={move.from} to={move.to} />
        {move.to !== 'new' ? (
          <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} label="Email the applicant about this update" description="Sends a short, branded status email. Leave unticked to update the record only." />
        ) : null}
        <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} label={kind === 'reject' ? 'I confirm that I want to reject this candidate.' : 'I confirm that I want to move this candidate.'} />
      </div>
    </Modal>
  );
}

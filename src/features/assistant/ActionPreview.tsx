import type { AssistantPreview, PreviewEmail } from '@shared/api/assistant';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Overlay';
import c from '@/features/careers/Careers.module.css';
import { Bullets, Tags } from '@/features/careers/PostingSections';
import s from './AssistantDock.module.css';
import w from '../workspace.module.css';

/**
 * What a job posting or new applicant the assistant prepared will look like,
 * before anything is saved. The job uses the careers page's own styles.
 */

/** The email as the recipient's inbox shows it: header, then the real HTML in a sandboxed frame. */
function EmailPreview({ email }: { email: PreviewEmail }) {
  return (
    <div className={s.previewMail}>
      <div className={s.previewMailHead}>
        <div><span>To</span>{email.to}</div>
        <div><span>Subject</span><strong>{email.subject}</strong></div>
      </div>
      {/* No scripts, no same-origin: the frame only draws the email. */}
      <iframe className={s.previewMailBody} title={`Email: ${email.subject}`} sandbox="" srcDoc={email.html} />
    </div>
  );
}

function StagePreview({ p }: { p: Extract<AssistantPreview, { type: 'stage' }> }) {
  return (
    <div className={s.previewCandidate}>
      <div>
        <div className={s.previewName}>{p.candidate}</div>
        <div className={s.previewSub}>{p.job}</div>
      </div>
      <ol className={s.previewTrack} aria-label="Pipeline">
        {p.stages.map((st) => (
          <li key={st} className={st === p.to ? s.trackTo : st === p.from ? s.trackFrom : undefined}>
            {st}{st === p.from ? <small>now</small> : st === p.to ? <small>moves here</small> : null}
          </li>
        ))}
      </ol>
      {p.email ? (
        <section className={c.block}>
          <h2 className={c.blockTitle}>Email to the applicant</h2>
          <EmailPreview email={p.email} />
        </section>
      ) : <p className={s.previewSub}>No email goes to the applicant for this move.</p>}
    </div>
  );
}

function InterviewPreview({ p }: { p: Extract<AssistantPreview, { type: 'interview' }> }) {
  const rows: Array<[string, string]> = [
    ['Candidate', `${p.candidate} · ${p.job}`],
    ['When', `${p.when} (${p.duration})`],
    ['Type', `${p.kind} · ${p.format}`],
    ['Interviewer', p.interviewer],
    ...(p.location ? [['Location', p.location] as [string, string]] : []),
  ];
  return (
    <div className={s.previewCandidate}>
      <dl className={s.previewRows}>
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <section className={c.block}>
        <h2 className={c.blockTitle}>Invitation the applicant receives</h2>
        <EmailPreview email={p.email} />
      </section>
    </div>
  );
}

function JobPreview({ p }: { p: Extract<AssistantPreview, { type: 'job' }> }) {
  return (
    <article className={s.previewJob}>
      {p.notice ? <p className={s.previewNotice}>{p.notice}</p> : null}
      <header className={c.detailHead}>
        <div className={c.cardBadges}>
          <Badge tone="neutral">{p.department}</Badge>
          {p.employmentType ? <Badge tone="info">{p.employmentType}</Badge> : null}
        </div>
        <h1 className={c.statusTitle}>{p.title}</h1>
        <div className={c.detailMeta}>
          <span><Icon name="pin" size={15} />{p.location || 'Location flexible'}</span>
          {p.salary ? <span className={c.salary}>{p.salary}</span> : null}
        </div>
      </header>
      {p.description ? (
        <section className={c.block}>
          <h2 className={c.blockTitle}>About the role</h2>
          <p className={c.prose}>{p.description}</p>
        </section>
      ) : null}
      <Bullets title="Responsibilities" text={p.responsibilities} />
      <Bullets title="Qualifications" text={p.qualifications} />
      <Tags title="Required skills" text={p.requirements} />
      <Tags title="Preferred skills" text={p.preferredSkills} />
      {p.experience || p.education ? (
        <section className={c.block}>
          <h2 className={c.blockTitle}>Experience and education</h2>
          <ul className={c.bullets}>
            {p.experience ? <li>{p.experience}</li> : null}
            {p.education ? <li>{p.education}</li> : null}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function CandidatePreview({ p }: { p: Extract<AssistantPreview, { type: 'candidate' }> }) {
  const rows: Array<[string, string]> = [
    ['Email', p.email || 'Not given'],
    ['Phone', p.phone || 'Not given'],
    ['Applies for', p.job ?? 'No job yet'],
    ['Source', p.source],
    ['Education', p.education || 'Not given'],
  ];
  return (
    <div className={s.previewCandidate}>
      <header className={s.previewPerson}>
        <Avatar name={p.fullName} size={56} />
        <div>
          <div className={s.previewName}>{p.fullName}</div>
          <div className={s.previewSub}>{p.currentTitle || 'No current title'}</div>
          <div className={`${c.cardBadges} ${w.mt8}`}>
            <Badge tone="neutral">Applied</Badge>
            {p.experienceLevel ? <Badge tone="info">{p.experienceLevel}</Badge> : null}
          </div>
        </div>
      </header>
      <dl className={s.previewRows}>
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <Tags title="Skills" text={p.skills} />
      {p.notes ? (
        <section className={c.block}>
          <h2 className={c.blockTitle}>Notes</h2>
          <p className={c.prose}>{p.notes}</p>
        </section>
      ) : null}
    </div>
  );
}

const HEAD: Record<AssistantPreview['type'], { title: string; width: number }> = {
  job: { title: 'Job posting preview', width: 760 },
  candidate: { title: 'Applicant preview', width: 560 },
  email: { title: 'Email preview', width: 720 },
  stage: { title: 'Stage move preview', width: 720 },
  interview: { title: 'Interview preview', width: 720 },
};

function noteFor(p: AssistantPreview): string {
  switch (p.type) {
    case 'job':
      return p.notice ? 'The posting being reviewed, as it looks on the careers site.'
        : p.publish ? 'This is how it will look on the careers site. It goes live when you confirm.'
        : 'This is how it will look on the careers site once an Admin approves it.';
    case 'candidate':
      return p.existing ? `This email already belongs to ${p.existing}; confirming updates their record.` : 'This is the applicant that will be added. Nothing is saved until you confirm.';
    case 'email': return 'Exactly what the applicant will receive. Nothing is sent until you confirm.';
    case 'stage': return 'Where the candidate moves on the board. Nothing changes until you confirm.';
    case 'interview': return 'The interview and the invitation email. The room link is created when you confirm.';
  }
}

export function ActionPreview({ preview, confirmLabel, open, busy, onClose, onConfirm }: {
  preview: AssistantPreview; confirmLabel: string; open: boolean; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const head = HEAD[preview.type];
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={head.width}
      title={head.title}
      subtitle={noteFor(preview)}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={onConfirm} loading={busy} variant={preview.type === 'job' && preview.notice ? 'danger' : 'primary'}>{confirmLabel}</Button>
        </>
      )}
    >
      {preview.type === 'job' ? <JobPreview p={preview} />
        : preview.type === 'candidate' ? <CandidatePreview p={preview} />
        : preview.type === 'email' ? <EmailPreview email={preview.email} />
        : preview.type === 'stage' ? <StagePreview p={preview} />
        : <InterviewPreview p={preview} />}
    </Modal>
  );
}

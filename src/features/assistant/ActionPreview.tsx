import type { AssistantPreview } from '@shared/api/assistant';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Overlay';
import c from '@/features/careers/Careers.module.css';
import s from './AssistantDock.module.css';

/**
 * What a job posting or new applicant the assistant prepared will look like,
 * before anything is saved. The job uses the careers page's own styles.
 */

const lines = (v: string) => v.split(/\r?\n/).map((l) => l.replace(/^[\s•\-*]+/, '').trim()).filter(Boolean);
const tags = (v: string) => v.split(/\r?\n|,\s*/).map((t) => t.trim()).filter(Boolean);

function Bullets({ title, text }: { title: string; text: string }) {
  const items = lines(text);
  if (!items.length) return null;
  return (
    <section className={c.block}>
      <h2 className={c.blockTitle}>{title}</h2>
      <ul className={c.bullets}>{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </section>
  );
}

function Tags({ title, text }: { title: string; text: string }) {
  const items = tags(text);
  if (!items.length) return null;
  return (
    <section className={c.block}>
      <h2 className={c.blockTitle}>{title}</h2>
      <div className={c.tags}>{items.map((t) => <span key={t} className={c.tag}>{t}</span>)}</div>
    </section>
  );
}

function JobPreview({ p }: { p: Extract<AssistantPreview, { type: 'job' }> }) {
  return (
    <article className={s.previewJob}>
      <header className={c.detailHead}>
        <div className={c.cardBadges}>
          <Badge tone="neutral">{p.department}</Badge>
          {p.employmentType ? <Badge tone="info">{p.employmentType}</Badge> : null}
        </div>
        <h1 className={c.displayS} style={{ fontSize: 28, lineHeight: '36px' }}>{p.title}</h1>
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
          <div className={c.cardBadges} style={{ marginTop: 8 }}>
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

export function ActionPreview({ preview, confirmLabel, open, busy, onClose, onConfirm }: {
  preview: AssistantPreview; confirmLabel: string; open: boolean; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const job = preview.type === 'job';
  const note = job
    ? (preview.publish ? 'This is how it will look on the careers site. It goes live when you confirm.' : 'This is how it will look on the careers site once an Admin approves it.')
    : preview.existing
      ? `This email already belongs to ${preview.existing}; confirming updates their record.`
      : 'This is the applicant that will be added. Nothing is saved until you confirm.';
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={job ? 760 : 560}
      title={job ? 'Job posting preview' : 'Applicant preview'}
      subtitle={note}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </>
      )}
    >
      {preview.type === 'job' ? <JobPreview p={preview} /> : <CandidatePreview p={preview} />}
    </Modal>
  );
}

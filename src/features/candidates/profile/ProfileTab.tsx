import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { CandidateProfileDto, StageReviewDto } from '@shared/api/candidates';
import { profileUpdateSchema } from '@shared/api/candidates';
import { EMPLOYMENT_TYPE_LABELS } from '@shared/domain/jobs';
import { EXPERIENCE_LEVEL_LABELS, EXPERIENCE_LEVELS, REVIEW_STAGE_LABELS, STAGE_LABELS, STAGE_ORDER, stageRank, type ReviewStage } from '@shared/domain/pipeline';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge, Chip } from '@/components/ui/Display';
import { Field, Select, TextInput, Textarea, formStyles } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Feedback';
import { Drawer } from '@/components/ui/Overlay';
import { Card, CardHeader, DescriptionList } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { api, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { formatDate, formatDateTime } from '@/lib/format';
import { cx } from '@/lib/cx';
import { useCandidateAction } from '../api';
import { ConvertEmployeeCard } from './ConvertEmployeeCard';
import w from '../../workspace.module.css';
import s from './Profile.module.css';

function StageReviewCard({ c, type, review, locked }: { c: CandidateProfileDto; type: ReviewStage; review: StageReviewDto | null; locked: boolean }) {
  const toast = useToast();
  const [rating, setRating] = useState<number | null>(review?.rating ?? null);
  const [feedback, setFeedback] = useState(review?.feedback ?? '');
  const save = useCandidateAction(c.applicationId, () => api.put(`/candidates/${c.applicationId}/stage-reviews/${type}`, { rating, feedback, notes: review?.notes ?? '' }));
  const label = REVIEW_STAGE_LABELS[type];
  const status = review ? <Badge tone="success" icon="checkcircle">Saved</Badge> : locked ? <Badge tone="neutral" icon="lock">Locked until {label.toLowerCase()}</Badge> : <Badge tone="warning" dot>In progress</Badge>;
  return (
    <Card>
      <CardHeader title={`${label} review`} actions={status} />
      <div className={cx(s.reviewForm, locked && s.reviewLocked)} aria-disabled={locked}>
        <Field label={`${label} feedback`}>
          <Textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} disabled={locked} maxLength={5000} />
        </Field>
        <Field label={`${label} rating 0–100`}>
          <div className={s.scoreRow}>
            <input type="range" min={0} max={100} value={rating ?? 0} onChange={(e) => setRating(Number(e.target.value))} disabled={locked} aria-label={`${label} rating`} />
            <span className={s.scoreOut}>{rating ?? '—'}</span>
          </div>
        </Field>
        {review?.notes ? <div className={w.noteCard}><div className={w.overline}>Notes from the meeting</div><p className={w.pre} style={{ marginTop: 6 }}>{review.notes}</p></div> : null}
        {review ? <span className={w.faint}>Last saved by {review.reviewer ?? 'a team member'} · {formatDateTime(review.updatedAt)}</span> : null}
        <div className={w.formActions}>
          <Button variant="secondary" loading={save.isPending} disabled={locked}
            onClick={() => save.mutate(undefined, { onSuccess: () => toast.success(`${label} review saved.`), onError: (e) => toast.error(errorMessage(e)) })}>
            Save {label.toLowerCase()} review
          </Button>
        </div>
      </div>
    </Card>
  );
}

function NotesCard({ c }: { c: CandidateProfileDto }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const add = useCandidateAction(c.applicationId, (text: string) => api.post(`/candidates/${c.applicationId}/notes`, { note: text }));
  return (
    <Card>
      <CardHeader title="Recruiter notes" subtitle="Visible to the hiring team only." />
      <div className={w.stack}>
        {c.notes.length === 0 ? <p className={w.faint}>No notes yet.</p> : c.notes.map((n) => (
          <div key={n.id} className={w.noteCard}>
            <div className={w.rowBetween}><span className={w.person}><Avatar name={n.author ?? 'Former user'} size={24} /><strong>{n.author ?? 'Former user'}</strong></span><span className={w.faint}>{formatDateTime(n.createdAt)}</span></div>
            <p className={w.pre} style={{ marginTop: 8 }}>{n.note}</p>
          </div>
        ))}
        <Field label="Add a note">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} placeholder="What should the team know?" />
        </Field>
        <div className={w.formActions}>
          <Button loading={add.isPending} disabled={!note.trim()} onClick={() => add.mutate(note.trim(), { onSuccess: () => { setNote(''); toast.success('Note added.'); }, onError: (e) => toast.error(errorMessage(e)) })}>Add note</Button>
        </div>
      </div>
    </Card>
  );
}

const editSchema = profileUpdateSchema.extend({ experienceLevel: z.enum(['', ...EXPERIENCE_LEVELS]).optional() });
type EditValues = z.input<typeof editSchema>;

function EditProfileDrawer({ c, open, onClose }: { c: CandidateProfileDto; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const save = useCandidateAction(c.applicationId, (v: EditValues) => api.patch(`/candidates/${c.applicationId}`, { ...v, experienceLevel: v.experienceLevel || null }));
  const { register, handleSubmit, setError: setFieldError, formState: { errors } } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone ?? '', currentTitle: c.currentTitle ?? '',
      experienceLevel: c.experienceLevel ?? '', skills: c.skills ?? '', education: c.education ?? '', portfolioUrl: c.portfolioUrl ?? '',
    },
  });
  const submit = handleSubmit((v) => save.mutate(v, {
    onSuccess: () => { toast.success('Profile updated.'); onClose(); },
    onError: (e) => setError(applyServerErrors(e, setFieldError, Object.keys(v))),
  }));
  return (
    <Drawer open={open} onClose={onClose} title="Edit profile" subtitle={c.name}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => void submit()}>Save changes</Button></>}>
      <form className={formStyles.stack} onSubmit={submit} noValidate>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className={formStyles.grid2}>
          <Field label="First name" required error={errors.firstName?.message}><TextInput {...register('firstName')} /></Field>
          <Field label="Last name" error={errors.lastName?.message}><TextInput {...register('lastName')} /></Field>
        </div>
        <Field label="Email" required error={errors.email?.message}><TextInput type="email" {...register('email')} /></Field>
        <Field label="Phone" error={errors.phone?.message}><TextInput type="tel" {...register('phone')} /></Field>
        <Field label="Current role" error={errors.currentTitle?.message}><TextInput {...register('currentTitle')} /></Field>
        <Field label="Experience level"><Select {...register('experienceLevel')} placeholder="Not set" options={EXPERIENCE_LEVELS.map((l) => ({ value: l, label: EXPERIENCE_LEVEL_LABELS[l] }))} /></Field>
        <Field label="Skills" hint="Separate with commas." error={errors.skills?.message}><TextInput {...register('skills')} /></Field>
        <Field label="Education" error={errors.education?.message}><TextInput {...register('education')} /></Field>
        <Field label="Portfolio URL" error={errors.portfolioUrl?.message}><TextInput type="url" {...register('portfolioUrl')} /></Field>
      </form>
    </Drawer>
  );
}

export function ProfileTab({ c }: { c: CandidateProfileDto }) {
  const [editing, setEditing] = useState(false);
  const rank = stageRank(c.stage);
  const moves = c.activity.filter((a) => a.action === 'pipeline_stage_move').reverse();
  const reachedAt = (st: string) => moves.find((m) => (m.details as { to?: string } | null)?.to === st);
  const skills = (c.skills ?? '').split(',').map((x) => x.trim()).filter(Boolean);

  return (
    <div className={w.cols21}>
      <div className={w.stack}>
        {c.stage === 'hired' ? <ConvertEmployeeCard c={c} /> : null}
        <Card>
          <CardHeader title="Profile and contact" actions={<Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(true)}>Edit</Button>} />
          <DescriptionList items={[
            ['Email', <a key="e" href={`mailto:${c.email}`} className={w.link}>{c.email}</a>],
            ['Phone', c.phone ?? '—'],
            ['Source', c.sourceLabel],
            ['Current role', c.currentTitle ?? '—'],
            ['Experience', c.experienceLevel ? EXPERIENCE_LEVEL_LABELS[c.experienceLevel] : '—'],
            ['Education', c.education ?? '—'],
            ['Portfolio', c.portfolioUrl ? <a key="p" href={c.portfolioUrl} target="_blank" rel="noopener noreferrer" className={w.link}>{c.portfolioUrl}</a> : '—'],
            ['Consent given', c.consentAt ? `Yes · ${formatDate(c.consentAt)}` : 'Not recorded'],
          ]} />
          {skills.length ? <div style={{ marginTop: 16 }}><div className={w.overline} style={{ marginBottom: 8 }}>Skills</div><div className={s.chipRow}>{skills.map((sk) => <Chip key={sk}>{sk}</Chip>)}</div></div> : null}
        </Card>
        {c.coverLetter || c.whyUs ? (
          <Card>
            <CardHeader title="Application answers" />
            <div className={w.stack}>
              {c.coverLetter ? <div><div className={w.overline} style={{ marginBottom: 6 }}>Cover letter</div><p className={w.pre}>{c.coverLetter}</p></div> : null}
              {c.whyUs ? <div><div className={w.overline} style={{ marginBottom: 6 }}>Why they want to work here</div><p className={w.pre}>{c.whyUs}</p></div> : null}
            </div>
          </Card>
        ) : null}
        <StageReviewCard key={`s-${c.screeningReview?.updatedAt ?? 'none'}`} c={c} type="screening" review={c.screeningReview} locked={false} />
        <StageReviewCard key={`i-${c.interviewReview?.updatedAt ?? 'none'}`} c={c} type="interview" review={c.interviewReview} locked={!c.interviewReview && (c.stage === 'rejected' || rank < stageRank('interview'))} />
        {/* The final round is optional: its card appears once the candidate reaches it or it has a review. */}
        {c.finalInterviewReview || rank >= stageRank('final_interview') ? (
          <StageReviewCard key={`f-${c.finalInterviewReview?.updatedAt ?? 'none'}`} c={c} type="final_interview" review={c.finalInterviewReview} locked={false} />
        ) : null}
        <NotesCard c={c} />
      </div>
      <div className={w.stack}>
        <Card>
          <CardHeader title="Application" />
          <dl className={w.kv}>
            <dt>Position</dt><dd>{c.job.title}</dd>
            <dt>Department</dt><dd>{c.job.department ?? '—'}</dd>
            <dt>Location</dt><dd>{c.job.location ?? '—'}</dd>
            <dt>Employment type</dt><dd>{EMPLOYMENT_TYPE_LABELS[c.job.employmentType]}</dd>
            <dt>Assigned to</dt><dd>{c.assignedTo ? c.assignedTo.name : 'Unassigned'}</dd>
            <dt>Status</dt><dd>{c.applicationStatus === 'withdrawn' ? 'Withdrawn' : 'Active'}</dd>
            <dt>Record</dt><dd>Submitted {formatDate(c.appliedAt)}</dd>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Stage history" />
          <ul className={s.stageHistory}>
            {STAGE_ORDER.map((st) => {
              const r = stageRank(st);
              const hit = st === 'new' ? { createdAt: c.appliedAt, actor: null } : reachedAt(st);
              const reached = st === 'new' || (c.stage !== 'rejected' && r <= rank) || Boolean(hit);
              return (
                <li key={st}>
                  <span style={reached ? { fontWeight: 600 } : { color: 'var(--text3)' }}>{STAGE_LABELS[st]}</span>
                  <span className={w.faint}>{hit ? `${formatDate(hit.createdAt)}${hit.actor ? ` · ${hit.actor}` : st === 'new' ? ` · ${c.sourceLabel}` : ''}` : reached ? 'Reached' : 'Not reached'}</span>
                </li>
              );
            })}
            {c.stage === 'rejected' ? <li><span style={{ fontWeight: 600, color: 'var(--danger-fg)' }}>Rejected</span><span className={w.faint}>{reachedAt('rejected') ? formatDate(reachedAt('rejected')!.createdAt) : ''}</span></li> : null}
          </ul>
        </Card>
        {c.otherApplications.length ? (
          <Card>
            <CardHeader title="Other applications" />
            <div className={w.list}>
              {c.otherApplications.map((o) => (
                <Link key={o.applicationId} to={`/app/candidates/${o.applicationId}`} className={`${w.listItem} ${w.listItemLink}`}>
                  <span className={w.strong} style={{ flex: 1 }}>{o.jobTitle}</span>
                  {o.withdrawn ? <Badge tone="neutral">Withdrawn</Badge> : <Badge tone="info">{STAGE_LABELS[o.stage]}</Badge>}
                </Link>
              ))}
            </div>
          </Card>
        ) : null}
        {c.candidateNotes ? (
          <Card><CardHeader title="Notes from intake" /><p className={w.pre}>{c.candidateNotes}</p></Card>
        ) : null}
      </div>
      <EditProfileDrawer c={c} open={editing} onClose={() => setEditing(false)} />
    </div>
  );
}

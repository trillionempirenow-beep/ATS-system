import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ApprovalDecisionInput } from '@shared/api/jobs';
import { EMPLOYMENT_TYPE_LABELS, JOB_APPROVAL_ACTION_LABELS, splitLines } from '@shared/domain/jobs';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge, StatusBadge } from '@/components/ui/Display';
import { Field, Textarea } from '@/components/ui/Form';
import { Notice, Skeleton, Timeline } from '@/components/ui/Feedback';
import { Card, CardHeader, DescriptionList, PageHeader } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApprovalDetail, useDecide } from './api';
import w from '../workspace.module.css';
import s from './Jobs.module.css';

type Decision = ApprovalDecisionInput['decision'];

function Section({ title, text, list }: { title: string; text: string | null; list?: boolean }) {
  if (!text?.trim()) return null;
  const lines = splitLines(text);
  return (
    <section className={s.section}>
      <h3>{title}</h3>
      {list && lines.length > 1 ? <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p className={w.pre}>{text}</p>}
    </section>
  );
}

export function ApprovalReviewPage() {
  const id = Number(useParams().id);
  const q = useApprovalDetail(id);
  const decide = useDecide(id);
  const toast = useToast();
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => { document.title = 'Review posting · Acme People'; }, []);

  if (q.isError) return <QueryErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <div className={w.page}><Skeleton height={36} width={300} /><div className={w.aside340}><Skeleton height={520} /><Skeleton height={400} /></div></div>;
  const { job, history } = q.data;
  const pending = job.approvalStatus === 'pending';

  const run = (decision: Decision) => {
    setNoteError(null);
    setFormError(null);
    if ((decision === 'reject' || decision === 'request_changes') && !note.trim()) {
      setNoteError('Add a note before rejecting or requesting changes.');
      return;
    }
    decide.mutate({ decision, note: note.trim() }, {
      onSuccess: () => {
        toast.success(decision === 'approve_publish' ? `${job.title} is live on the careers site.`
          : decision === 'approve_only' ? `${job.title} was approved. It is not published yet.`
            : decision === 'reject' ? `${job.title} was rejected.` : 'Changes requested. The author has been notified.');
        navigate('/app/jobs/approvals');
      },
      onError: (e) => setFormError(errorMessage(e)),
    });
  };

  return (
    <div className={w.page}>
      <PageHeader title="Review posting" description={`${job.title}${job.submitterName ? ` · submitted by ${job.submitterName}` : ''}`}
        crumbs={[{ label: 'Jobs' }, { label: 'Job approvals', to: '/app/jobs/approvals' }, { label: 'Review' }]}
        actions={<ButtonLink variant="secondary" to="/app/jobs/approvals">Back to the queue</ButtonLink>} />
      {!pending ? <Notice tone="info" title="Already decided">This posting is no longer waiting for approval. Its current status is shown below.</Notice> : null}
      <div className={w.aside340}>
        <Card>
          <div className={s.jobHead}>
            <div className={`${w.row} ${w.gap8} ${w.wrapRow}`}>
              {job.department ? <Badge tone="neutral">{job.department}</Badge> : null}
              <Badge tone="info">{EMPLOYMENT_TYPE_LABELS[job.employmentType]}</Badge>
              {job.isUrgent ? <Badge tone="danger">Urgent</Badge> : null}
            </div>
            <h2>{job.title}</h2>
            <p className={w.muted}>{[job.location, job.salaryInfo].filter(Boolean).join(' · ') || 'No location or salary stated'}</p>
          </div>
          <Section title="Description" text={job.description} />
          <Section title="Responsibilities" text={job.responsibilities} list />
          <Section title="Qualifications" text={job.qualifications} list />
          {job.requirements?.trim() ? (
            <section className={s.section}>
              <h3>Required skills</h3>
              <div className={s.tags}>{splitLines(job.requirements).map((r) => <span key={r} className={s.tag}>{r}</span>)}</div>
            </section>
          ) : null}
          <Section title="Preferred skills" text={job.preferredSkills} list />
          <Section title="Experience required" text={job.experienceRequired} />
          <Section title="Education required" text={job.educationRequired} />
        </Card>
        <div className={w.stack}>
          {pending ? (
            <Card>
              <CardHeader title="Decision" />
              <div className={w.stack8}>
                {formError ? <Notice tone="danger">{formError}</Notice> : null}
                <Field label="Note" hint={noteError ? undefined : 'Note required when rejecting or requesting changes'} error={noteError ?? undefined}>
                  <Textarea rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <Button fullWidth icon="public" loading={decide.isPending && decide.variables?.decision === 'approve_publish'} disabled={decide.isPending} onClick={() => run('approve_publish')}>Approve and publish</Button>
                <Button fullWidth variant="secondary" loading={decide.isPending && decide.variables?.decision === 'approve_only'} disabled={decide.isPending} onClick={() => run('approve_only')}>Approve without publishing</Button>
                <Button fullWidth variant="secondary" loading={decide.isPending && decide.variables?.decision === 'request_changes'} disabled={decide.isPending} onClick={() => run('request_changes')}>Request changes</Button>
                <Button fullWidth variant="dangerGhost" loading={decide.isPending && decide.variables?.decision === 'reject'} disabled={decide.isPending} onClick={() => run('reject')}>Reject</Button>
              </div>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Details" actions={<StatusBadge kind="job" value={job.state} size="sm" />} />
            <DescriptionList items={[
              ['Created by', job.creatorName ?? 'Former user'],
              ['Submitted by', job.submitterName ?? '—'],
              ['Date created', formatDate(job.createdAt)],
              ['Submitted', formatDate(job.submittedAt)],
              ['Salary', job.salaryInfo || 'Not stated'],
              ['Applicant limit', job.applicantLimit ? String(job.applicantLimit) : 'Unlimited'],
            ]} />
            {job.sourcePdf ? <p className={`${w.faint} ${w.mt12}`}>Generated from an uploaded job description. <a className={w.link} href={`/api/v1/jobs/${job.id}/source-pdf`} target="_blank" rel="noopener noreferrer">Open the PDF</a></p> : null}
          </Card>
          <Card>
            <CardHeader title="History" />
            <Timeline items={[
              ...[...history].reverse().map((h) => ({ key: h.id, title: JOB_APPROVAL_ACTION_LABELS[h.action], done: true, sub: `${h.actorName ?? 'Former user'} · ${formatDate(h.createdAt)}${h.note ? ` · “${h.note}”` : ''}` })),
              { key: 'created', title: 'Draft created', done: true, sub: `${job.creatorName ?? 'Former user'} · ${formatDate(job.createdAt)}` },
            ]} />
          </Card>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { ApplicationStatusDto, CandidateInterviewDto, StatusLookupDto } from '@shared/api/public';
import { FEEDBACK_FIT_LABELS, type FeedbackFit } from '@shared/domain/pipeline';
import { type INTERVIEW_TYPES, JOIN_STATE_HEADLINES } from '@shared/domain/interviews';
import { Icon } from '@/components/icon/Icon';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge, StatusBadge } from '@/components/ui/Display';
import { Field, TextInput } from '@/components/ui/Form';
import { Notice, Skeleton, Timeline } from '@/components/ui/Feedback';
import { StageRail, StageTag } from '@/components/ui/Stage';
import { Modal } from '@/components/ui/Overlay';
import { Card, CardHeader, DescriptionList } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDate, formatTime, formatWeekday } from '@/lib/format';
import { cx } from '@/lib/cx';
import s from './Careers.module.css';

const lookupForm = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  applicationId: z.string().trim().regex(/^\d*$/, 'Application IDs are numbers.').optional(),
});
type LookupForm = z.infer<typeof lookupForm>;

const TYPE_LABEL: Record<(typeof INTERVIEW_TYPES)[number], string> = { phone: 'Phone', video: 'Video', onsite: 'Onsite', panel: 'Panel' };

function InterviewCard({ iv }: { iv: CandidateInterviewDto }) {
  const room = iv.room;
  const live = room && ['interviewer_ready', 'admitted', 'available', 'waiting', 'requested'].includes(room.joinState);
  return (
    <Card>
      <CardHeader title="Your interview" actions={room ? <Badge tone={room.canJoin ? 'success' : 'neutral'} dot>{room.canJoin ? 'Ready to join' : JOIN_STATE_HEADLINES[room.joinState]}</Badge> : <StatusBadge kind="interview" value={iv.state} />} />
      <DescriptionList items={[
        ['Interview type', `${iv.meetingType === 'screening' ? 'Screening' : 'Interview'} · ${TYPE_LABEL[iv.interviewType]}`],
        ['Interviewer', iv.interviewerName ?? 'To be confirmed'],
        ['Date', formatWeekday(iv.startsAt)],
        ['Time', formatTime(iv.startsAt)],
        ...(iv.location ? [['Location', iv.location] as [string, string]] : []),
      ]} />
      <div className={s.ivFoot}>
        {room ? (
          <>
            <div className={s.joinBox}>
              <span className={cx(s.liveDot, live && s.liveDotOn)} aria-hidden />
              <span className={s.muted}>{room.message}</span>
            </div>
            {room.canJoin
              ? <ButtonLink to={room.url} icon="video" fullWidth>{room.joinState === 'interviewer_ready' || room.joinState === 'admitted' ? 'Join now' : 'Join interview'}</ButtonLink>
              : <Button icon="video" fullWidth disabled>Join interview</Button>}
          </>
        ) : iv.externalUrl ? (
          <a href={iv.externalUrl} target="_blank" rel="noopener noreferrer" className={s.textLink}>Open meeting link</a>
        ) : (
          <p className={s.muted}>Your recruiter will share joining details closer to the time.</p>
        )}
      </div>
    </Card>
  );
}

function SuggestionsCard({ app }: { app: ApplicationStatusDto }) {
  const many = app.suggestions.length > 1;
  return (
    <Card>
      <CardHeader
        title={app.rejected ? (many ? 'Roles that might suit you' : 'A role that might suit you') : (many ? 'Other roles that could fit you' : 'Another role that could fit you')}
        subtitle={app.suggestions.every((sg) => sg.fromAi)
          ? (app.rejected ? 'Based on your CV and application.' : 'Based on your CV. Your current application stays as it is, and applying is up to you.')
          : 'Suggested by the hiring team based on your application.'}
      />
      <div className={s.suggestions}>
        {app.suggestions.map((sg) => (
          <div key={`${sg.title}-${sg.slug ?? ''}`} className={s.suggestion}>
            <p className={s.strong}>{sg.title}</p>
            {sg.note ? <p className={s.prewrap}>{sg.note}</p> : null}
            <div className={s.suggestionAction}>
              {sg.alreadyApplied ? <Badge tone="success" icon="checkcircle">You applied for this role</Badge>
                : sg.slug ? <ButtonLink to={`/jobs/${sg.slug}`} size="sm" variant={app.rejected ? 'primary' : 'secondary'}>View role</ButtonLink>
                  : <span className={s.hint}>This role is no longer open.</span>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SubmissionCard({ app }: { app: ApplicationStatusDto }) {
  const { coverLetter, whyUs, portfolio, source, resumeName } = app.submission;
  const details: Array<[string, ReactNode]> = [
    ['Role', app.jobTitle],
    ['Applied', formatDate(app.appliedAt)],
    ...(resumeName ? [['Resume', resumeName] as [string, ReactNode]] : []),
    ...(portfolio ? [['Portfolio', /^https?:\/\//i.test(portfolio)
      ? <a href={portfolio} target="_blank" rel="noopener noreferrer" className={s.textLink}>{portfolio}</a>
      : portfolio] as [string, ReactNode]] : []),
    ...(source ? [['How you heard about us', source] as [string, ReactNode]] : []),
  ];
  return (
    <Card>
      <CardHeader title="Your application" subtitle="What you sent us. Contact your recruiter if something needs to change." />
      <DescriptionList items={details} />
      {coverLetter ? (
        <div className={s.answer}>
          <h3 className={s.answerTitle}>About you</h3>
          <p className={s.prewrap}>{coverLetter}</p>
        </div>
      ) : null}
      {whyUs ? (
        <div className={s.answer}>
          <h3 className={s.answerTitle}>Why you want to work here</h3>
          <p className={s.prewrap}>{whyUs}</p>
        </div>
      ) : null}
    </Card>
  );
}

function ApplicationView({ app, email }: { app: ApplicationStatusDto; email: string }) {
  const [confirm, setConfirm] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const withdraw = useMutation({
    mutationFn: () => api.post('/public/status/withdraw', { email, applicationId: app.id }),
    onSuccess: () => { setConfirm(false); toast.success('Your application was withdrawn.'); void qc.invalidateQueries({ queryKey: ['status'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className={s.statusGrid}>
      <div className={s.statusMain}>
        <div className={s.statusHead}>
          <div className={s.statusHeadText}>
            <span className={s.muted}>Hi {app.firstName}, you applied on {formatDate(app.appliedAt)}.</span>
            <h1 className={s.title}>{app.jobTitle}</h1>
            <span className={s.hint}>
              {[app.jobDepartment, app.jobLocation].filter(Boolean).join(', ')}{app.jobDepartment || app.jobLocation ? '. ' : ''}Application ID <span className="mono">{app.id}</span>
            </span>
          </div>
        </div>
        <Card>
          <StageRail label="Your application progress"
            steps={app.withdrawn || app.rejected
              ? app.timeline.filter((t) => t.key === 'new' || (app.withdrawn && t.reached)).map((t) => ({ stage: t.key, reached: true }))
              : app.timeline.map((t) => ({ stage: t.key, reached: t.reached }))}
            current={app.withdrawn || app.rejected ? null : app.stage}
            end={app.withdrawn ? { kind: 'withdrawn', label: 'Withdrawn', note: 'By you' }
              : app.rejected ? { kind: 'rejected', label: 'Not moving forward', note: 'Application closed' } : null} />
        </Card>
        {app.withdrawn ? (
          <Notice tone="info" title="Withdrawn">You withdrew this application. You can apply again at any time.</Notice>
        ) : app.rejected ? (
          <Notice tone="danger" title="Application closed">Thank you for your interest. We will not be moving forward with this application.</Notice>
        ) : null}
        {app.rejected && app.feedback ? (
          <Card>
            <CardHeader title="Feedback from the team" subtitle={FEEDBACK_FIT_LABELS[app.feedback.fit as FeedbackFit] ?? undefined} />
            <p className={s.prewrap}>{app.feedback.notes || 'The team did not add further notes.'}</p>
          </Card>
        ) : null}
        {/* After a rejection the next step is another role, so it comes first; while the application is open, its progress does. */}
        {app.rejected && app.suggestions.length ? <SuggestionsCard app={app} /> : null}
        <Card>
          <CardHeader title="Progress" />
          <Timeline items={app.events.map((e, i) => ({ key: e.key, title: e.title, sub: `${formatDate(e.at)}${e.note ? ` · ${e.note}` : ''}`, done: i > 0 || e.title === 'Application received' }))} />
        </Card>
        {!app.rejected && app.suggestions.length ? <SuggestionsCard app={app} /> : null}
        <SubmissionCard app={app} />
      </div>
      <aside className={s.statusAside}>
        {app.interviews.length ? app.interviews.map((iv) => <InterviewCard key={iv.id} iv={iv} />) : (
          <Card>
            <CardHeader title={app.withdrawn || app.rejected ? 'No upcoming interview' : 'Interview details'} />
            <p className={s.muted}>{app.withdrawn || app.rejected ? 'There is nothing to join right now.' : 'Your recruiter will share joining details closer to the time.'}</p>
          </Card>
        )}
        {app.withdrawn || app.rejected ? (
          <div className={s.stack8}>
            {app.withdrawn ? <ButtonLink to="/jobs" fullWidth>Apply again</ButtonLink> : null}
            <ButtonLink to="/jobs" variant="secondary" fullWidth>Browse open positions</ButtonLink>
          </div>
        ) : app.stage !== 'hired' ? (
          <Button variant="dangerGhost" icon="close" onClick={() => setConfirm(true)}>Withdraw application</Button>
        ) : null}
      </aside>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Withdraw application?" role="alertdialog"
        footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>Withdraw</Button></>}>
        <p className={s.muted}>Are you sure you want to withdraw your application for {app.jobTitle}? Your recruiter is notified, and you can apply again later.</p>
      </Modal>
    </div>
  );
}

export function StatusPage() {
  const [params, setParams] = useSearchParams();
  const email = params.get('email') ?? '';
  const id = params.get('id') ?? '';
  const { register, handleSubmit, formState: { errors } } = useForm<LookupForm>({ resolver: zodResolver(lookupForm), defaultValues: { email, applicationId: id } });
  useEffect(() => { document.title = 'Application status · Careers'; }, []);

  const lookup = useQuery({
    queryKey: ['status', email.toLowerCase(), id],
    queryFn: () => api.post<StatusLookupDto>('/public/status', { email, applicationId: id ? Number(id) : undefined }),
    enabled: Boolean(email),
    retry: false,
    refetchInterval: (q) => (q.state.data?.kind === 'application' ? 20_000 : false),
  });
  const notFound = lookup.error instanceof ApiError && lookup.error.status === 404;

  if (lookup.data?.kind === 'application') {
    return (
      <div className={s.container}>
        <Link to={`/status?email=${encodeURIComponent(email)}`} className={s.back}><Icon name="arrowl" size={16} />All applications for this email</Link>
        <ApplicationView app={lookup.data.application} email={email} />
      </div>
    );
  }

  return (
    <div className={s.narrow}>
      <header className={s.intro}>
        <h1 className={s.title}>Check your application</h1>
        <p className={s.lead}>Enter the email you applied with. Add your application ID to go straight to one application.</p>
      </header>
      <div className={s.formCard}>
        <form className={s.formStack} noValidate
          onSubmit={handleSubmit((v) => setParams({ email: v.email.trim(), ...(v.applicationId ? { id: v.applicationId } : {}) }))}>
          <Field label="Email" required error={errors.email?.message ?? (notFound ? (id ? 'We could not find an application for that email and ID.' : 'We could not find any applications under that email.') : undefined)}>
            <TextInput type="email" icon="mail" autoComplete="email" {...register('email')} />
          </Field>
          <Field label="Application ID" optional error={errors.applicationId?.message}>
            <TextInput inputMode="numeric" {...register('applicationId')} />
          </Field>
          <Button type="submit" loading={lookup.isFetching}>Check status</Button>
        </form>
      </div>
      {notFound ? <Notice tone="info" title="Applied in the last few minutes?">New applications can take a minute to appear. Check the email address matches the one you applied with.</Notice> : null}
      {lookup.isError && !notFound ? <Notice tone="danger">{errorMessage(lookup.error)}</Notice> : null}
      {lookup.isLoading && email ? <Skeleton height={120} /> : null}
      {lookup.data?.kind === 'list' ? (
        <Card padding={0}>
          <CardHeader flush title="Your applications" subtitle={`${lookup.data.applications.length} under ${email}`} />
          {lookup.data.applications.map((a) => (
            <Link key={a.id} to={`/status?email=${encodeURIComponent(email)}&id=${a.id}`} className={s.listRow}>
              <span className={s.listText}>
                <strong>{a.jobTitle}</strong>
                <span className={s.hint}>Applied {formatDate(a.appliedAt)}, ID <span className="mono">{a.id}</span></span>
              </span>
              {a.withdrawn ? <Badge tone="neutral">Withdrawn</Badge> : <StageTag stage={a.stage} label={a.stage === 'rejected' ? 'Not moving forward' : undefined} />}
            </Link>
          ))}
        </Card>
      ) : null}
    </div>
  );
}

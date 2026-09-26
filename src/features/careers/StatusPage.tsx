import { useEffect, useState } from 'react';
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
import { Notice, Skeleton, Stepper, Timeline } from '@/components/ui/Feedback';
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
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {room ? (
          <>
            <div className={s.joinBox}>
              <span className={cx(s.liveDot, live && s.liveDotOn)} aria-hidden />
              <span style={{ color: 'var(--text2)' }}>{room.message}</span>
            </div>
            {room.canJoin
              ? <ButtonLink to={room.url} icon="video" fullWidth>{room.joinState === 'interviewer_ready' || room.joinState === 'admitted' ? 'Join now' : 'Join interview'}</ButtonLink>
              : <Button icon="video" fullWidth disabled>Join interview</Button>}
          </>
        ) : iv.externalUrl ? (
          <a href={iv.externalUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>Open meeting link</a>
        ) : (
          <p style={{ color: 'var(--text2)' }}>Joining details will be shared by your recruiter closer to the time.</p>
        )}
      </div>
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
  const statusBadge = app.withdrawn ? <Badge tone="neutral" icon="xcircle">Withdrawn</Badge>
    : app.rejected ? <Badge tone="danger" icon="xcircle">Not moving forward</Badge>
      : app.stage === 'hired' ? <Badge tone="success" icon="checkcircle">Hired</Badge>
        : <Badge tone="info" dot>In progress</Badge>;

  return (
    <div className={s.statusGrid}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
        <div className={s.statusHead}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: 'var(--text2)' }}>Hi {app.firstName}, you applied on {formatDate(app.appliedAt)}.</span>
            <h1 className={s.statusTitle}>{app.jobTitle}</h1>
            <span style={{ color: 'var(--text3)', fontSize: 13 }}>
              {[app.jobDepartment, app.jobLocation].filter(Boolean).join(' · ')}{app.jobDepartment || app.jobLocation ? ' · ' : ''}Application ID <span className="mono">{app.id}</span>
            </span>
          </div>
          {statusBadge}
        </div>
        {app.withdrawn ? (
          <Notice tone="info" title="Withdrawn">You withdrew this application. You can apply again at any time.</Notice>
        ) : app.rejected ? (
          <Notice tone="danger" title="Application closed">Thank you for your interest. We will not be moving forward with this application.</Notice>
        ) : (
          <Card><Stepper steps={app.timeline.map((t) => ({ key: t.key, label: t.label, done: t.reached, current: t.current }))} /></Card>
        )}
        {app.rejected && app.feedback ? (
          <Card>
            <CardHeader title="Feedback from the team" subtitle={FEEDBACK_FIT_LABELS[app.feedback.fit as FeedbackFit] ?? undefined} />
            <p style={{ color: 'var(--text2)', whiteSpace: 'pre-line' }}>{app.feedback.notes || 'The team did not add further notes.'}</p>
          </Card>
        ) : null}
        {app.rejected && app.suggestion ? (
          <Card>
            <CardHeader title="A role that might suit you" />
            <p style={{ fontWeight: 650 }}>{app.suggestion.title}</p>
            {app.suggestion.note ? <p style={{ color: 'var(--text2)', marginTop: 4 }}>{app.suggestion.note}</p> : null}
            {app.suggestion.slug ? <div style={{ marginTop: 12 }}><ButtonLink to={`/jobs/${app.suggestion.slug}`} size="sm" iconRight="arrowr">View role</ButtonLink></div> : null}
          </Card>
        ) : null}
        <Card>
          <CardHeader title="Progress" />
          <Timeline items={app.events.map((e, i) => ({ key: e.key, title: e.title, sub: `${formatDate(e.at)}${e.note ? ` · ${e.note}` : ''}`, done: i > 0 || e.title === 'Application received' }))} />
        </Card>
      </div>
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {app.interviews.length ? app.interviews.map((iv) => <InterviewCard key={iv.id} iv={iv} />) : (
          <Card>
            <CardHeader title={app.withdrawn || app.rejected ? 'No upcoming interview' : 'Interview details'} />
            <p style={{ color: 'var(--text2)' }}>{app.withdrawn || app.rejected ? 'There is nothing to join right now.' : 'Joining details will be shared by your recruiter closer to the time.'}</p>
          </Card>
        )}
        {app.withdrawn || app.rejected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {app.withdrawn ? <ButtonLink to="/jobs" fullWidth>Apply again</ButtonLink> : null}
            <ButtonLink to="/jobs" variant="secondary" fullWidth>Browse open positions</ButtonLink>
          </div>
        ) : app.stage !== 'hired' ? (
          <Button variant="dangerGhost" icon="close" onClick={() => setConfirm(true)}>Withdraw application</Button>
        ) : null}
      </aside>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Withdraw application?" role="alertdialog"
        footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>Withdraw</Button></>}>
        <p style={{ color: 'var(--text2)' }}>Are you sure you want to withdraw your application for {app.jobTitle}? Your recruiter is notified, and you can apply again later.</p>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Link to={`/status?email=${encodeURIComponent(email)}`} className={s.back}><Icon name="arrowl" size={16} />All applications for this email</Link>
        <ApplicationView app={lookup.data.application} email={email} />
      </div>
    );
  }

  return (
    <div className={s.narrow}>
      <header className={s.pageHead} style={{ alignItems: 'center', textAlign: 'center' }}>
        <h1 className={s.statusTitle} style={{ fontSize: 36, lineHeight: '44px' }}>Track your application.</h1>
        <p className={s.lead}>Enter the email you applied with. Your application ID is optional and narrows the search.</p>
      </header>
      <Card padding={24}>
        <form style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate
          onSubmit={handleSubmit((v) => setParams({ email: v.email.trim(), ...(v.applicationId ? { id: v.applicationId } : {}) }))}>
          <Field label="Email" required error={errors.email?.message ?? (notFound ? (id ? 'We could not find an application for that email and ID.' : 'We could not find any applications under that email.') : undefined)}>
            <TextInput type="email" icon="mail" autoComplete="email" {...register('email')} />
          </Field>
          <Field label="Application ID" optional error={errors.applicationId?.message}>
            <TextInput inputMode="numeric" {...register('applicationId')} />
          </Field>
          <Button type="submit" fullWidth loading={lookup.isFetching}>Check application status</Button>
        </form>
      </Card>
      {notFound ? <Notice tone="info" title="Applied recently? It can take a minute to appear." action={<ButtonLink to="/jobs" size="sm" variant="secondary">Browse open positions</ButtonLink>} /> : null}
      {lookup.isError && !notFound ? <Notice tone="danger">{errorMessage(lookup.error)}</Notice> : null}
      {lookup.isLoading && email ? <Skeleton height={120} radius={12} /> : null}
      {lookup.data?.kind === 'list' ? (
        <Card padding={0}>
          <CardHeader flush title="Your applications" subtitle={`${lookup.data.applications.length} under ${email}`} />
          {lookup.data.applications.map((a) => (
            <Link key={a.id} to={`/status?email=${encodeURIComponent(email)}&id=${a.id}`} className={s.listRow}>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <strong>{a.jobTitle}</strong>
                <span style={{ fontSize: 13, color: 'var(--text3)' }}>Applied {formatDate(a.appliedAt)} · ID <span className="mono">{a.id}</span></span>
              </span>
              {a.withdrawn ? <Badge tone="neutral">Withdrawn</Badge> : <StatusBadge kind="stage" value={a.stage} />}
            </Link>
          ))}
        </Card>
      ) : null}
    </div>
  );
}

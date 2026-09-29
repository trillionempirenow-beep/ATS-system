import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { InterviewListItemDto } from '@shared/api/interviews';
import { Icon } from '@/components/icon/Icon';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { Avatar, Badge, StatusBadge } from '@/components/ui/Display';
import { EmptyState, Notice, Skeleton } from '@/components/ui/Feedback';
import { Drawer, Menu } from '@/components/ui/Overlay';
import { Card, CardHeader, DataTable, PageHeader, StatCard, StatGrid, type Column } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { formatTime, formatWeekday, plural } from '@/lib/format';
import { useUrlParams } from '@/lib/urlState';
import { useInterview, useInterviews } from './api';
import { FORMAT_LABELS, ScheduleDrawer } from './ScheduleDrawer';
import { RescheduleDrawer } from './RescheduleDrawer';
import { ReviewForm } from './ReviewForm';
import w from '../workspace.module.css';
import s from './Interviews.module.css';

const LIVE = new Set(['ready', 'in_progress']);
const typeLabel = (iv: InterviewListItemDto) =>
  `${iv.meetingType === 'screening' ? 'Screening' : iv.finalInterview ? 'Final interview' : 'Interview'} · ${FORMAT_LABELS[iv.interviewType]}`;

function When({ iv }: { iv: InterviewListItemDto }) {
  return (
    <div className={s.when}>
      <strong className="num">{formatTime(iv.startsAt)}</strong>
      <span>{formatWeekday(iv.startsAt)}</span>
    </div>
  );
}

function Person({ iv }: { iv: InterviewListItemDto }) {
  return (
    <Link to={`/app/candidates/${iv.applicationId}`} className={w.person} onClick={(e) => e.stopPropagation()}>
      <Avatar name={iv.candidateName} src={iv.avatarUrl} size={32} />
      <span className={w.personText}>
        <span className={w.personName}>{iv.candidateName}</span>
        <span className={w.personSub}>{iv.jobTitle}</span>
      </span>
    </Link>
  );
}

export function InterviewsPage() {
  const [params, setUrl] = useUrlParams();
  const navigate = useNavigate();
  const toast = useToast();
  const list = useInterviews();
  const [rescheduling, setRescheduling] = useState<InterviewListItemDto | null>(null);
  const [reviewing, setReviewing] = useState<number | null>(null);

  useEffect(() => { document.title = 'Interviews · Acme People'; }, []);

  const scheduleParam = params.get('schedule');
  const scheduleOpen = scheduleParam !== null;
  const prefill = scheduleParam && /^\d+$/.test(scheduleParam) ? Number(scheduleParam) : null;

  const all = useMemo(() => list.data ? [...list.data.today, ...list.data.upcoming, ...list.data.past] : [], [list.data]);
  const focusId = params.get('focus');
  useEffect(() => {
    if (!focusId || !all.length) return;
    const hit = all.find((i) => String(i.id) === focusId);
    if (hit) setRescheduling(hit);
    setUrl({ focus: null });
  }, [focusId, all, setUrl]);

  if (list.isError) return <QueryErrorPage error={list.error} onRetry={() => void list.refetch()} />;
  const d = list.data;

  const openRoom = (iv: InterviewListItemDto) => navigate(`/app/interviews/${iv.id}/room`);
  const copyExternal = (iv: InterviewListItemDto) => {
    if (!iv.meetingUrl) return;
    void navigator.clipboard.writeText(iv.meetingUrl).then(() => toast.success('Meeting link copied.'));
  };

  const action = (iv: InterviewListItemDto) => {
    if (iv.state === 'review_pending') return <Button size="sm" onClick={(e) => { e.stopPropagation(); setReviewing(iv.id); }}>Score and review</Button>;
    if (LIVE.has(iv.state) && iv.builtInRoom) {
      return <Button size="sm" icon="video" onClick={(e) => { e.stopPropagation(); openRoom(iv); }}>{iv.candidateWaiting ? 'Admit candidate' : 'Join room'}</Button>;
    }
    if (LIVE.has(iv.state) && iv.meetingUrl) return <ButtonLink size="sm" variant="secondary" icon="external" to={iv.meetingUrl} target="_blank" rel="noopener noreferrer">Open link</ButtonLink>;
    return <ButtonLink size="sm" variant="ghost" to={`/app/candidates/${iv.applicationId}`}>View candidate</ButtonLink>;
  };

  const menu = (iv: InterviewListItemDto) => (
    <Menu
      trigger={(p) => <IconButton icon="more" label={`More actions for ${iv.candidateName}`} size={32} variant="ghost" {...p} />}
      items={[
        { label: 'Reschedule', icon: 'calendar', onSelect: () => setRescheduling(iv), hidden: iv.state === 'reviewed' || iv.state === 'review_pending' || iv.state === 'ended' },
        { label: 'Open room', icon: 'video', onSelect: () => openRoom(iv), hidden: !iv.builtInRoom || iv.state === 'cancelled' },
        { label: 'Copy meeting link', icon: 'copy', onSelect: () => copyExternal(iv), hidden: !iv.meetingUrl },
        { label: 'Open review', icon: 'edit', onSelect: () => navigate(`/app/interviews/${iv.id}/review`), hidden: iv.state !== 'review_pending' && iv.state !== 'reviewed' },
        { label: 'View candidate', icon: 'user', onSelect: () => navigate(`/app/candidates/${iv.applicationId}`) },
      ]}
    />
  );

  const baseColumns: Column<InterviewListItemDto>[] = [
    { key: 'when', header: 'When', cell: (iv) => <When iv={iv} />, width: 120 },
    { key: 'candidate', header: 'Candidate', cell: (iv) => <Person iv={iv} />, primary: true },
    { key: 'type', header: 'Type', cell: (iv) => typeLabel(iv), label: 'Type' },
    { key: 'interviewer', header: 'Interviewer', cell: (iv) => iv.interviewerName ?? '—', label: 'Interviewer' },
    {
      key: 'status', header: 'Status', label: 'Status',
      cell: (iv) => <span className={w.row} style={{ gap: 6 }}><StatusBadge kind="interview" value={iv.state} size="sm" />{iv.candidateWaiting ? <Badge tone="warning" size="sm" dot>Waiting</Badge> : null}</span>,
    },
  ];
  const upcomingColumns: Column<InterviewListItemDto>[] = [
    ...baseColumns,
    { key: 'action', header: <span className="sr-only">Action</span>, cell: action, align: 'right' },
    { key: 'menu', header: <span className="sr-only">More</span>, cell: menu, align: 'right', width: 48 },
  ];
  const pastColumns: Column<InterviewListItemDto>[] = [
    ...baseColumns,
    {
      key: 'review', header: 'Review', label: 'Review',
      cell: (iv) => iv.state === 'review_pending' ? action(iv) : iv.score !== null ? <strong className="num">{iv.score} / 100</strong> : <span className={w.faint}>None</span>,
    },
    { key: 'menu', header: <span className="sr-only">More</span>, cell: menu, align: 'right', width: 48 },
  ];

  const scheduleButton = <Button icon="plus" onClick={() => setUrl({ schedule: 'new' })}>Schedule interview</Button>;
  const todayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date());

  return (
    <div className={w.page}>
      <PageHeader title="Interviews" description="Today’s conversations, what is coming up, and which interviews still need a score." actions={scheduleButton} />

      <StatGrid>
        <StatCard icon="calendar" label="Today" value={d?.counts.today ?? 0} loading={!d} />
        <StatCard icon="clock" label="Next 7 days" value={d?.counts.thisWeek ?? 0} loading={!d} />
        <StatCard icon="interviews" label="Upcoming" value={d?.counts.upcoming ?? 0} loading={!d} />
        <StatCard icon="edit" label="Awaiting review" value={d?.counts.awaitingReview ?? 0} loading={!d} />
      </StatGrid>

      <Card>
        <CardHeader title="Today" subtitle={`${todayLabel} · ${d ? plural(d.today.length, 'interview') : '…'} scheduled`} />
        {!d ? <Skeleton height={64} /> : d.today.length === 0 ? (
          <EmptyState compact icon="calendar" title="Nothing scheduled for today."
            text={`Upcoming interviews are listed below. Meeting rooms open ${d.joinWindowMinutes} minutes before the start time.`} />
        ) : (
          <div className={s.todayList}>
            {d.today.map((iv) => (
              <div key={iv.id} className={s.todayItem}>
                <When iv={iv} />
                <Person iv={iv} />
                <span className={s.todayMeta}>{typeLabel(iv)}{iv.interviewerName ? ` · ${iv.interviewerName}` : ''}</span>
                <StatusBadge kind="interview" value={iv.state} size="sm" />
                {iv.candidateWaiting ? <Badge tone="warning" dot size="sm">Candidate waiting</Badge> : null}
                <span className={s.todayAction}>{action(iv)}{menu(iv)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card padding={0}>
        <div className={s.tableHead}>
          <CardHeader title="Upcoming" subtitle={d ? `${d.upcoming.length} scheduled` : undefined} actions={<Button variant="secondary" size="sm" icon="plus" onClick={() => setUrl({ schedule: 'new' })}>Schedule interview</Button>} />
        </div>
        <DataTable columns={upcomingColumns} rows={d?.upcoming ?? []} rowKey={(iv) => iv.id} loading={!d} caption="Upcoming interviews"
          onRowClick={(iv) => navigate(`/app/candidates/${iv.applicationId}`)}
          empty={<EmptyState compact icon="interviews" title="No upcoming interviews" text="Schedule one from here or from a candidate’s profile." actions={scheduleButton} />} />
      </Card>

      <Card padding={0}>
        <div className={s.tableHead}><CardHeader title="Past interviews" subtitle={d ? `${d.past.length} on record` : undefined} /></div>
        <DataTable columns={pastColumns} rows={d?.past ?? []} rowKey={(iv) => iv.id} loading={!d} caption="Past interviews"
          onRowClick={(iv) => navigate(iv.state === 'review_pending' || iv.state === 'reviewed' ? `/app/interviews/${iv.id}/review` : `/app/candidates/${iv.applicationId}`)}
          empty={<EmptyState compact icon="layers" title="No past interviews yet" text="Finished interviews and their reviews collect here." />} />
      </Card>

      <ScheduleDrawer open={scheduleOpen} applicationId={prefill} onClose={() => setUrl({ schedule: null })} />
      <RescheduleDrawer interview={rescheduling} onClose={() => setRescheduling(null)} />
      <ReviewDrawer id={reviewing} onClose={() => setReviewing(null)} />
    </div>
  );
}

function ReviewDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  return (
    <Drawer open={id !== null} onClose={onClose} width={560} title="Score and review" subtitle="Recorded against the candidate’s interview history.">
      {id !== null ? <ReviewDrawerBody id={id} onClose={onClose} /> : null}
    </Drawer>
  );
}

function ReviewDrawerBody({ id, onClose }: { id: number; onClose: () => void }) {
  const toast = useToast();
  const room = useInterview(id);
  if (room.isError) return <Notice tone="danger">This interview could not be loaded.</Notice>;
  if (!room.data) return <div className={w.stack8}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={48} />)}</div>;
  const iv = room.data.interview;
  return (
    <div className={w.stack}>
      <div className={w.person}>
        <Avatar name={iv.candidateName} src={iv.avatarUrl} size={40} />
        <div className={w.personText}>
          <span className={w.personName}>{iv.candidateName}</span>
          <span className={w.personSub}>{iv.jobTitle} · {typeLabel(iv)}</span>
        </div>
        <StatusBadge kind="interview" value={iv.state} size="sm" />
      </div>
      {iv.liveNotes ? (
        <div className={w.noteCard}><div className={w.overline}>Notes recorded during the meeting</div><p className={w.pre} style={{ marginTop: 6 }}>{iv.liveNotes}</p></div>
      ) : null}
      {iv.acceptsReview ? (
        <ReviewForm room={room.data} onCancel={onClose} onSubmitted={() => { toast.success('Interview review saved to the candidate profile.', 'Review submitted'); onClose(); }} />
      ) : (
        <Notice tone="info" title="This interview has not ended yet">End the meeting from the room before submitting a score and review.</Notice>
      )}
      <Link to={`/app/interviews/${id}/review`} className={w.link}><Icon name="external" size={14} /> Open the full review page</Link>
    </div>
  );
}

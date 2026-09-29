import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { GuestDto, GuestRequestDto, PresenceResultDto, StaffRoomDto } from '@shared/api/interviews';
import { Icon } from '@/components/icon/Icon';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Avatar, StatusBadge } from '@/components/ui/Display';
import { EmptyState, Notice, Skeleton } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Overlay';
import { TextInput } from '@/components/ui/Form';
import { Card, CardHeader, DescriptionList, PageHeader } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { QueryErrorPage } from '@/app/system/StatusPages';
import { api, errorMessage } from '@/lib/api';
import { formatTime, formatWeekday, plural } from '@/lib/format';
import { joinChannel } from '@/lib/realtime';
import { interviewKeys, useInterview } from '../interviews/api';
import { FORMAT_LABELS } from '../interviews/ScheduleDrawer';
import { suggestedScore } from '../interviews/ReviewForm';
import { CallStage, type SidePanel } from './CallStage';
import { DeviceCheck } from './DeviceCheck';
import { GuestAdmissions, copyText, type GuestDecision } from './GuestAdmissions';
import { StaffDock, useLiveNotes, useScorecardDraft, type DockTab } from './StaffDock';
import { useCall } from './call/useCall';
import { useLocalMedia } from './call/useLocalMedia';
import w from '../workspace.module.css';
import s from './Room.module.css';

type Phase = 'summary' | 'check' | 'call' | 'ended';

export function StaffRoomPage() {
  const id = Number(useParams().id);
  const room = useInterview(id);
  const [phase, setPhase] = useState<Phase>('summary');
  const [endedAt, setEndedAt] = useState<string | null>(null);
  // Owned here so the devices chosen in the check carry straight into the call.
  const media = useLocalMedia();

  useEffect(() => { document.title = 'Interview room · Acme People'; }, []);

  if (room.isError) return <QueryErrorPage error={room.error} onRetry={() => void room.refetch()} />;
  if (!room.data) return <div className={w.page}><Skeleton height={36} width={320} /><Skeleton height={320} /></div>;
  const data = room.data;
  const over = data.interview.state === 'review_pending' || data.interview.state === 'reviewed' || data.interview.state === 'ended';

  if (phase === 'ended' || (over && phase !== 'call')) return <EndedScreen room={data} endedAt={endedAt ?? data.interview.endedAt} />;
  if (phase === 'call') return <LiveRoom room={data} media={media} onEnded={(at) => { media.stopAll(); setEndedAt(at); setPhase('ended'); }} />;
  return <PreCall room={data} media={media} phase={phase} onPhase={setPhase} />;
}

function roomTitle(room: StaffRoomDto) {
  const iv = room.interview;
  return {
    title: `${iv.finalInterview ? 'Final interview' : 'Interview'} with ${iv.candidateName}`,
    subtitle: `${iv.jobTitle}${iv.roomCode ? ` · Room code ${iv.roomCode}` : ''}`,
  };
}

type Media = ReturnType<typeof useLocalMedia>;

function PreCall({ room, media, phase, onPhase }: { room: StaffRoomDto; media: Media; phase: Phase; onPhase: (p: Phase) => void }) {
  const navigate = useNavigate();
  const iv = room.interview;
  const { title, subtitle } = roomTitle(room);
  const cancelled = iv.state === 'cancelled' || iv.state === 'no_show';
  const crumbs = [{ label: 'Recruiting', to: '/app' }, { label: 'Interviews', to: '/app/interviews' }, { label: iv.roomCode ? `Room ${iv.roomCode}` : 'Room' }];

  if (!iv.builtInRoom) {
    return (
      <div className={w.page}>
        <PageHeader title={title} description={subtitle} crumbs={crumbs} />
        <Card><EmptyState icon="external" title="This interview uses an external meeting"
          text={iv.meetingUrl ? `It takes place on ${iv.meetingProvider}. Open the link to join.` : 'No built-in room was created for it.'}
          actions={iv.meetingUrl ? <ButtonLink to={iv.meetingUrl} target="_blank" rel="noopener noreferrer" icon="external">Open meeting link</ButtonLink> : null} /></Card>
      </div>
    );
  }

  if (phase === 'check') {
    return (
      <div className={w.page}>
        <DeviceCheck name={room.me.name} media={media} joinLabel="Join interview room"
          context={(
            <div className={w.person}>
              <Avatar name={iv.candidateName} src={iv.avatarUrl} size={40} />
              <div className={w.personText}><span className={w.personName}>Interview with {iv.candidateName}</span><span className={w.personSub}>{subtitle}</span></div>
              <StatusBadge kind="interview" value={iv.state} size="sm" />
            </div>
          )}
          onBack={() => { media.stopAll(); onPhase('summary'); }}
          onJoin={() => onPhase('call')} />
      </div>
    );
  }

  return (
    <div className={w.page}>
      <PageHeader title={title} description={subtitle} crumbs={crumbs}
        actions={<>
          <Button variant="secondary" onClick={() => navigate(-1)}>Back</Button>
          <Button icon="video" disabled={cancelled} onClick={() => onPhase('check')}>Join interview room</Button>
        </>} />
      {cancelled ? <Notice tone="warning" title="This interview is not taking place">It was {iv.state === 'no_show' ? 'marked as a no-show' : 'cancelled'}. Reschedule it from Interviews to use the room again.</Notice> : null}
      <div className={w.cols21}>
        <Card>
          <CardHeader title="Meeting details" actions={<StatusBadge kind="interview" value={iv.state} />} />
          <DescriptionList items={[
            ['Position', iv.jobTitle],
            ['Type', `${iv.meetingType === 'screening' ? 'Screening' : 'Interview'} · ${FORMAT_LABELS[iv.interviewType]}`],
            ['When', `${formatWeekday(iv.startsAt)} · ${formatTime(iv.startsAt)}${iv.endsAt ? ` – ${formatTime(iv.endsAt)}` : ''}`],
            ['Interviewer', iv.interviewerName ?? '—'],
            ['Room', 'Built-in Acme Room'],
            ['Room code', <span key="c" className="mono">{iv.roomCode}</span>],
            ['Notes', 'Your own notes and scorecard, hiring team only'],
          ]} />
          <p className={w.faint} style={{ marginTop: 16 }}>You will check your camera and microphone before entering.</p>
        </Card>
        <Card>
          <div className={w.person}>
            <Avatar name={iv.candidateName} src={iv.avatarUrl} size={44} />
            <div className={w.personText}><span className={w.personName}>{iv.candidateName}</span><span className={w.personSub}>{iv.jobTitle} applicant</span></div>
          </div>
          {iv.candidateWaiting ? <Notice tone="info" style={{ marginTop: 16 }}>{iv.candidateName} is in the waiting room.</Notice> : null}
          {iv.notes ? <div className={w.noteCard} style={{ marginTop: 16 }}><div className={w.overline}>Scheduling notes</div><p className={w.pre} style={{ marginTop: 6 }}>{iv.notes}</p></div> : null}
          <ButtonLink variant="secondary" to={`/app/candidates/${iv.applicationId}`} style={{ marginTop: 16 }}>View candidate</ButtonLink>
        </Card>
        {room.guests.link ? <GuestLinkCard link={room.guests.link} /> : null}
      </div>
    </div>
  );
}

/** Final interviews: the shareable link for department heads and outside stakeholders. */
function GuestLinkCard({ link }: { link: string }) {
  const toast = useToast();
  const copy = async () => {
    if (await copyText(link)) toast.success('Guest link copied.');
    else toast.error('Copy the link from the box instead.', 'Could not copy');
  };
  return (
    <Card>
      <CardHeader title="Guest link" />
      <p className={w.faint}>Share it with department heads or clients joining this final interview. Guests give their name and position, then wait until someone in the room admits them. Do not send it to the candidate: they have their own link.</p>
      <div className={w.row} style={{ gap: 8, marginTop: 12 }}>
        <TextInput readOnly value={link} aria-label="Guest link" onFocus={(e) => e.currentTarget.select()} />
        <Button variant="secondary" icon="copy" onClick={() => void copy()}>Copy</Button>
      </div>
    </Card>
  );
}

function LiveRoom({ room, media, onEnded }: { room: StaffRoomDto; media: Media; onEnded: (endedAt: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const iv = room.interview;
  const [hand, setHand] = useState(false);
  const [panel, setPanel] = useState<SidePanel>('dock');
  const [tab, setTab] = useState<DockTab>('notes');
  const [pending, setPending] = useState<PresenceResultDto['pendingRequest']>(null);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const [admitting, setAdmitting] = useState(false);
  const [guestRequests, setGuestRequests] = useState<GuestRequestDto[]>([]);
  const [admittedGuests, setAdmittedGuests] = useState<GuestDto[]>(room.guests.admitted);
  const [deciding, setDeciding] = useState<number | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [moments, setMoments] = useState(room.moments);
  const [startedAt, setStartedAt] = useState(iv.startedAt ?? new Date().toISOString());
  const notes = useLiveNotes(iv.id, iv.liveNotes);
  const scorecard = useScorecardDraft(iv.id, room.scorecard.myRatings);
  const endedRef = useRef(false);

  const finish = useCallback((at: string) => {
    if (endedRef.current) return;
    endedRef.current = true;
    void qc.invalidateQueries({ queryKey: interviewKeys.detail(iv.id) });
    void qc.invalidateQueries({ queryKey: interviewKeys.list });
    onEnded(at);
  }, [iv.id, onEnded, qc]);

  const call = useCall({
    driver: room.realtime.driver,
    channel: room.realtime.room,
    rtc: room.rtc,
    self: { id: `u${room.me.id}`, name: room.me.name, role: iv.interviewerId === room.me.id ? 'interviewer' : 'staff' },
    stream: media.stream, screen: media.screen, micOn: media.micOn, camOn: media.camOn, hand,
    onEnded: (p) => {
      if (p.endedById !== room.me.id) toast.info(p.endedBy ? `${p.endedBy} ended the meeting.` : 'The meeting has ended.');
      finish(new Date().toISOString());
    },
    onFirstConnection: () => { void api.post(`/interviews/${iv.id}/connected`).catch(() => undefined); },
  });

  // Presence heartbeat: keeps the interviewer "here" and surfaces entry requests.
  const beat = useCallback(async () => {
    try {
      const r = await api.post<PresenceResultDto>(`/interviews/${iv.id}/presence`);
      setPending(r.pendingRequest);
      setGuestRequests(r.guestRequests);
      setAdmittedGuests(r.admittedGuests);
      if (r.meetingState === 'review_pending' || r.meetingState === 'reviewed') finish(new Date().toISOString());
    } catch { /* the next beat retries */ }
  }, [iv.id, finish]);

  useEffect(() => {
    void beat().then(() => setStartedAt((cur) => iv.startedAt ?? cur));
    const every = Math.max(5, Math.floor(room.presenceSeconds / 3)) * 1000;
    const t = window.setInterval(() => void beat(), every);
    const leave = () => api.beacon(`/interviews/${iv.id}/leave`);
    window.addEventListener('pagehide', leave);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('pagehide', leave);
      if (!endedRef.current) leave();
    };
  }, [beat, iv.id, iv.startedAt, room.presenceSeconds]);

  // Entry requests arrive on the staff channel straight away; the heartbeat is the fallback.
  useEffect(() => {
    if (!room.realtime.staff) return undefined;
    const ch = joinChannel(room.realtime.driver, room.realtime.staff, `u${room.me.id}`);
    const offs = [ch.on('entry:requested', () => void beat()), ch.on('guest:requested', () => void beat())];
    return () => { offs.forEach((off) => off()); ch.close(); };
  }, [room.realtime.driver, room.realtime.staff, room.me.id, beat]);

  const candidateInCall = call.peers.some((p) => p.meta.role === 'candidate');
  const showAdmit = pending && !candidateInCall && dismissedAt !== (pending.since ?? 'none');

  const admit = async () => {
    setAdmitting(true);
    try {
      await api.post(`/interviews/${iv.id}/admit`);
      setPending(null);
      toast.success(`${iv.candidateName} is joining.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setAdmitting(false);
    }
  };

  const decideGuest = async (guest: GuestRequestDto, decision: GuestDecision) => {
    setDeciding(guest.id);
    try {
      const decided = await api.post<GuestDto>(`/interviews/${iv.id}/guests/${guest.id}/decision`, { decision });
      setGuestRequests((list) => list.filter((g) => g.id !== guest.id));
      if (decision === 'admit') {
        setAdmittedGuests((list) => [...list.filter((g) => g.id !== decided.id), decided]);
        toast.success(`${guest.name} is joining.`);
      } else {
        toast.info(`${guest.name} was not admitted. They have been told politely.`);
      }
    } catch (e) {
      toast.error(errorMessage(e));
      void beat();
    } finally {
      setDeciding(null);
    }
  };

  const copyGuestLink = async () => {
    if (room.guests.link && await copyText(room.guests.link)) toast.success('Guest link copied.');
    else toast.error('Open the room summary to copy the link.', 'Could not copy');
  };

  // Guests' tiles and the participants list use the name and position the server
  // holds for them, not what their browser announces.
  const verifiedCall = {
    ...call,
    peers: call.peers.map((p) => {
      if (p.meta.role !== 'guest') return p;
      const known = admittedGuests.find((g) => g.peerId === p.meta.id);
      return { ...p, meta: { ...p.meta, name: known?.name ?? p.meta.name, position: known ? known.position : 'Not admitted by a host' } };
    }),
  };

  const end = async () => {
    setEnding(true);
    try {
      await notes.flush();
      await api.post(`/interviews/${iv.id}/end`, { liveNotes: notes.current() });
      finish(new Date().toISOString());
    } catch (e) {
      toast.error(errorMessage(e), 'The meeting did not end');
      setEnding(false);
    }
  };

  const elapsed = () => Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
  const flag = async (label: string) => {
    try {
      const atSecond = elapsed();
      const r = await api.post<{ id: number }>(`/interviews/${iv.id}/moments`, { atSecond, label });
      setMoments((m) => [...m, { id: r.id, atSecond, label, author: room.me.name }]);
      toast.success('Moment flagged.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const share = async () => {
    if (media.screen) media.stopScreen();
    else await media.startScreen();
  };

  const live = suggestedScore(scorecard.ratings).score;
  const { title, subtitle } = roomTitle(room);

  return (
    <CallStage
      title={title}
      subtitle={subtitle}
      since={startedAt}
      pills={live !== null ? <span className={`${s.pill} ${s.pillScore}`}><Icon name="star" size={15} />Score {live}</span> : null}
      headerAction={<>
        {room.guests.link ? <button type="button" className={s.topLink} onClick={() => void copyGuestLink()}><Icon name="link" size={14} />Copy guest link</button> : null}
        <Link className={s.topLink} to={`/app/candidates/${iv.applicationId}`} target="_blank" rel="noopener noreferrer">View candidate<Icon name="external" size={14} /></Link>
      </>}
      banner={showAdmit && pending ? (
        <div className={s.banner} role="alert">
          <Avatar name={pending.name} src={pending.avatarUrl} size={36} />
          <div className={s.bannerText}><strong>{pending.name} is in the waiting room</strong><span>They can hear nothing and see nothing until you let them in.</span></div>
          <button type="button" className={s.darkBtn} onClick={() => setDismissedAt(pending.since ?? 'none')}>Keep waiting</button>
          <button type="button" className={s.lightBtn} onClick={() => void admit()} disabled={admitting}>{admitting ? 'Admitting…' : 'Admit candidate'}</button>
        </div>
      ) : null}
      call={verifiedCall}
      media={media}
      self={{ name: room.me.name, role: iv.interviewerId === room.me.id ? 'interviewer' : 'staff' }}
      hand={hand}
      onHand={() => setHand((h) => !h)}
      onShare={() => void share()}
      emptyStage={(
        <div className={s.stageNote}>
          <Avatar name={iv.candidateName} src={iv.avatarUrl} size={104} />
          <strong>{pending ? `${pending.name} is in the waiting room` : `Waiting for ${iv.candidateName}`}</strong>
          <span>{pending ? 'Admit them from the banner above when you are ready.' : 'They will appear here once they join and you let them in.'}</span>
        </div>
      )}
      dock={<StaffDock room={room} tab={tab} onTab={setTab} notes={notes} scorecard={scorecard} moments={moments} onFlag={flag} elapsedSeconds={elapsed} />}
      panel={panel}
      onPanel={setPanel}
      endLabel="End meeting"
      onEnd={() => setConfirmEnd(true)}
      overlay={(<>
        <GuestAdmissions requests={guestRequests} deciding={deciding} onDecide={(g, d) => void decideGuest(g, d)} />
        <Modal open={confirmEnd} onClose={() => setConfirmEnd(false)} role="alertdialog" title="End the meeting for everyone?"
          footer={<>
            <Button variant="secondary" onClick={() => setConfirmEnd(false)}>Keep meeting</Button>
            <Button variant="danger" loading={ending} onClick={() => void end()}>End meeting</Button>
          </>}>
          <ul className={s.steps}>
            <li><span><Icon name="close" size={14} /></span><span><strong>The room closes{candidateInCall ? ` and ${iv.candidateName} is disconnected` : ''}{admittedGuests.length ? `. Guests are disconnected too` : ''}</strong></span></li>
            <li><span><Icon name="check" size={14} /></span><span><strong>Your notes and scorecard draft are saved</strong></span></li>
            <li><span><Icon name="edit" size={14} /></span><span><strong>You score and review the interview next</strong></span></li>
          </ul>
        </Modal>
      </>)}
    />
  );
}

function EndedScreen({ room, endedAt }: { room: StaffRoomDto; endedAt: string | null }) {
  const qc = useQueryClient();
  const fresh = qc.getQueryData<StaffRoomDto>(interviewKeys.detail(room.interview.id)) ?? room;
  const iv = fresh.interview;
  const minutes = iv.startedAt && endedAt ? Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(iv.startedAt)) / 60_000)) : null;
  const rated = Object.values(fresh.scorecard.myRatings).filter((v) => v !== null).length;
  const noteLines = (iv.liveNotes ?? '').split('\n').filter((l) => l.trim()).length;
  const reviewed = iv.state === 'reviewed';
  return createPortal(
    <div className={s.room}>
      <header className={s.topbar}>
        <div className={s.titleBlock}><strong>Interview with {iv.candidateName}</strong><span>{iv.jobTitle}{iv.roomCode ? ` · Room code ${iv.roomCode}` : ''}</span></div>
        <div className={s.pills}><span className={s.pill}><Icon name="checkcircle" size={15} />Notes saved</span>{minutes !== null ? <span className={`${s.pill} ${s.timer}`}>Ended · {plural(minutes, 'min')}</span> : null}</div>
      </header>
      <div className={s.ended}>
        <div className={s.endedCard}>
          <h1>Meeting ended</h1>
          <p>The interview with {iv.candidateName}{minutes !== null ? ` ran for ${plural(minutes, 'minute')} and` : ''} has closed for everyone. {reviewed ? 'It has already been reviewed.' : 'Finish up in the review.'}</p>
          <ul className={s.endedList}>
            <li><Icon name="checkcircle" size={18} /><span>Room closed for everyone<small>{endedAt ? formatTime(endedAt) : ''}</small></span></li>
            <li><Icon name="checkcircle" size={18} /><span>Notes saved<small>{noteLines ? plural(noteLines, 'line') : 'No notes'} of your own · {plural(fresh.moments.length, 'flagged moment')}</small></span></li>
            <li><Icon name="checkcircle" size={18} /><span>Scorecard draft saved<small>{rated} of {fresh.scorecard.criteria.length} criteria rated</small></span></li>
          </ul>
          <div className={s.actions}>
            <Link className={s.darkBtn} to={`/app/candidates/${iv.applicationId}`}>Open candidate</Link>
            <Link className={s.lightBtn} to={`/app/interviews/${iv.id}/review`}>{reviewed ? 'View review' : 'Continue to review'}</Link>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

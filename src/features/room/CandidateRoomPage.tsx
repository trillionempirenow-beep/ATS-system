import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CandidateRoomDto } from '@shared/api/interviews';
import { Icon } from '@/components/icon/Icon';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Display';
import { EmptyState, Notice, Skeleton } from '@/components/ui/Feedback';
import { Card } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatDate, formatTime, plural } from '@/lib/format';
import { joinChannel } from '@/lib/realtime';
import { FORMAT_LABELS } from '../interviews/ScheduleDrawer';
import { CallStage, type SidePanel } from './CallStage';
import { DeviceCheck } from './DeviceCheck';
import { useCall } from './call/useCall';
import { useLocalMedia } from './call/useLocalMedia';
import s from './Room.module.css';

type Step = 'lobby' | 'check' | 'waiting' | 'call' | 'left';

const WAITING = new Set(['waiting', 'requested']);

export function CandidateRoomPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const qc = useQueryClient();
  const toast = useToast();
  const media = useLocalMedia();
  const [step, setStep] = useState<Step>('lobby');
  const [joining, setJoining] = useState(false);
  const [endedAt, setEndedAt] = useState<string | null>(null);
  const [callStart, setCallStart] = useState<string | null>(null);
  const key = useMemo(() => ['room', code, token] as const, [code, token]);
  const path = `/room/${encodeURIComponent(code)}`;

  const state = useQuery({
    queryKey: key,
    queryFn: () => api.get<CandidateRoomDto>(`${path}?t=${encodeURIComponent(token)}`),
    retry: (n, e) => !(e instanceof ApiError && (e.status === 403 || e.status === 404)) && n < 2,
    refetchInterval: (q) => (q.state.data && !q.state.data.ended && step === 'lobby' ? 15_000 : false),
  });
  const data = state.data;

  useEffect(() => { document.title = data ? `Interview · ${data.companyName}` : 'Interview'; }, [data]);

  const apply = useCallback((next: CandidateRoomDto) => qc.setQueryData(key, next), [qc, key]);

  // Waiting room and call: keep our presence fresh and pick up admission.
  const beat = useCallback(async () => {
    try {
      apply(await api.post<CandidateRoomDto>(`${path}/heartbeat`, { t: token }));
    } catch { /* next beat retries */ }
  }, [apply, path, token]);

  useEffect(() => {
    if (step !== 'waiting' && step !== 'call') return undefined;
    const t = window.setInterval(() => void beat(), step === 'waiting' ? 8000 : 15_000);
    const leave = () => api.beacon(`${path}/leave`, { t: token });
    window.addEventListener('pagehide', leave);
    return () => { window.clearInterval(t); window.removeEventListener('pagehide', leave); };
  }, [step, beat, path, token]);

  // The lobby channel tells us the moment we are admitted or the meeting ends.
  const lobby = data?.realtime.lobby ?? null;
  const driver = data?.realtime.driver ?? 'local';
  useEffect(() => {
    if (!lobby || (step !== 'waiting' && step !== 'call')) return undefined;
    const ch = joinChannel(driver, lobby, `c-${code}`);
    const offs = [
      ch.on('entry:admitted', () => void beat()),
      ch.on('room:ended', () => { setEndedAt(new Date().toISOString()); void beat(); }),
    ];
    return () => { offs.forEach((o) => o()); ch.close(); };
  }, [lobby, driver, step, beat, code]);

  // Admission moves the waiting room into the call; a reload while waiting resumes the wait.
  useEffect(() => {
    if (step === 'lobby' && data?.canJoin && WAITING.has(data.requestState)) setStep('waiting');
    // The server dropped the request (cancelled elsewhere or expired): go back to the door.
    if (step === 'waiting' && data?.requestState === 'none') setStep('lobby');
    if (step === 'waiting' && data?.requestState === 'admitted' && data.realtime.room) {
      setCallStart(new Date().toISOString());
      setStep('call');
    }
    if (data?.ended && (step === 'waiting' || step === 'call')) {
      media.stopAll();
      setEndedAt((cur) => cur ?? new Date().toISOString());
      setStep('lobby');
    }
  }, [data, step, media]);

  const requestEntry = async () => {
    setJoining(true);
    try {
      const next = await api.post<CandidateRoomDto>(`${path}/request-entry`, { t: token });
      apply(next);
      if (next.requestState === 'admitted' && next.realtime.room) {
        setCallStart(new Date().toISOString());
        setStep('call');
      } else {
        setStep('waiting');
      }
    } catch (e) {
      toast.error(errorMessage(e));
      void state.refetch();
      setStep('lobby');
    } finally {
      setJoining(false);
    }
  };

  const cancel = async (thenLeave: boolean) => {
    try { await api.post(`${path}/cancel`, { t: token }); } catch { /* the request expires on its own */ }
    media.stopAll();
    // Clear the cached request first, or the resume-on-reload rule below would put us straight back in the queue.
    if (data) apply({ ...data, requestState: 'none' });
    void state.refetch();
    setStep(thenLeave ? 'left' : 'lobby');
  };

  if (state.isError) {
    const invalid = state.error instanceof ApiError && (state.error.status === 403 || state.error.status === 404);
    return (
      <div className={`${s.shell} ${s.narrow}`}>
        <Card>
          <EmptyState icon="alert" title={invalid ? 'This interview link is not valid' : 'The interview could not be loaded'}
            text={invalid ? 'The room was not found. Check the link in your invitation email, or look up your application to see joining details.' : errorMessage(state.error)}
            actions={invalid ? <ButtonLink to="/status" variant="secondary">Check application status</ButtonLink> : <Button onClick={() => void state.refetch()}>Try again</Button>} />
        </Card>
      </div>
    );
  }
  if (!data) return <div className={`${s.shell} ${s.narrow}`}><Skeleton height={320} /></div>;

  if (step === 'call' && data.realtime.room && data.rtc) {
    return <CandidateCall data={data} media={media} since={data.startedAt ?? callStart}
      onLeave={() => { api.beacon(`${path}/leave`, { t: token }); media.stopAll(); setStep('left'); }}
      onEnded={() => { media.stopAll(); setEndedAt(new Date().toISOString()); setStep('lobby'); void state.refetch(); }} />;
  }

  if (data.ended || data.joinState === 'ended') return <Ended data={data} endedAt={endedAt} startedAt={callStart} />;

  const details = (
    <div className={s.facts}>
      <div><span>Interview type</span><strong>{data.meetingType === 'screening' ? 'Screening' : 'Interview'} · {FORMAT_LABELS[data.interviewType]}</strong></div>
      <div><span>Interviewer</span><strong>{data.interviewerName ?? 'The hiring team'}</strong></div>
      <div><span>Date</span><strong>{formatDate(data.startsAt, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</strong></div>
      <div><span>Time</span><strong>{formatTime(data.startsAt)}</strong></div>
    </div>
  );
  const roomCode = <span className={s.code}>Room {data.roomCode}</span>;

  if (step === 'check') {
    return (
      <div className={s.shell}>
        <DeviceCheck name={data.candidateName} media={media} joinLabel="Join interview room" joining={joining}
          context={<Card padding={16}>{details}</Card>}
          onBack={() => { media.stopAll(); setStep('lobby'); }}
          onJoin={() => void requestEntry()} />
      </div>
    );
  }

  if (step === 'waiting') {
    return (
      <div className={`${s.shell} ${s.narrow}`}>
        <Card>
          <div className={s.checkSide}>
            <div className={s.statusLine}><Badge tone="info" dot>In the waiting room</Badge>{roomCode}</div>
            <h1 className={s.heading}>You are in the waiting room</h1>
            <p className={s.lead}>
              {data.interviewerPresent ? 'Your interviewer has been told you are here and will let you in shortly.' : 'We will let you in as soon as your interviewer arrives. Your interviewer has been notified.'} Please keep this page open.
            </p>
            <div className={s.waitPulse}><span className={s.dot} /><span><strong>{data.requestState === 'requested' ? 'Waiting for approval' : 'Waiting for the interviewer'}</strong>This page updates on its own.</span></div>
            <div className={s.actions}>
              <Button variant="secondary" onClick={() => void cancel(false)}>Cancel request</Button>
              <Button variant="ghost" onClick={() => void cancel(true)}>Leave waiting room</Button>
            </div>
          </div>
        </Card>
        <Link to="/status" className={s.back}>Back to my application</Link>
      </div>
    );
  }

  if (step === 'left') {
    return (
      <div className={`${s.shell} ${s.narrow}`}>
        <Card>
          <EmptyState icon="signout" title="You left the interview" text="The interview is still open. You can join again while it is running."
            actions={<><Button onClick={() => setStep('check')}>Rejoin</Button><ButtonLink variant="secondary" to="/status">Back to my application</ButtonLink></>} />
        </Card>
      </div>
    );
  }

  if (data.joinState === 'cancelled') {
    return (
      <div className={`${s.shell} ${s.narrow}`}>
        <Card><EmptyState icon="xcircle" title="This interview was cancelled" text={data.message} actions={<ButtonLink variant="secondary" to="/status">Back to my application</ButtonLink>} /></Card>
      </div>
    );
  }

  const open = data.canJoin;
  return (
    <div className={`${s.shell} ${s.narrow}`}>
      <Card>
        <div className={s.checkSide}>
          <div className={s.statusLine}>
            <Badge tone={open ? 'success' : 'neutral'} dot>{open ? (data.interviewerPresent ? 'Your interviewer is ready' : 'Room is open') : 'Not open yet'}</Badge>
            {roomCode}
          </div>
          <h1 className={s.heading}>Your interview at {data.companyName}</h1>
          <p className={s.lead}>{data.jobTitle}</p>
          {details}
          <div className={s.actions}>
            <Button size="lg" icon="video" disabled={!open} onClick={() => setStep('check')}>Join interview</Button>
          </div>
          {open ? (
            <p className={s.previewHint}>You will check your camera and microphone before entering.</p>
          ) : (
            <Notice tone="info" title={`Opens ${data.joinWindowMinutes} minutes before your start time`}>
              That is {formatTime(data.opensAt)}. This page updates on its own. Nothing to refresh.
            </Notice>
          )}
        </div>
      </Card>
      <Link to="/status" className={s.back}>Back to my application</Link>
    </div>
  );
}

function CandidateCall({ data, media, since, onLeave, onEnded }: {
  data: CandidateRoomDto; media: ReturnType<typeof useLocalMedia>; since: string | null; onLeave: () => void; onEnded: () => void;
}) {
  const [hand, setHand] = useState(false);
  const [panel, setPanel] = useState<SidePanel>(null);
  const ended = useRef(false);
  const call = useCall({
    driver: data.realtime.driver,
    channel: data.realtime.room,
    rtc: data.rtc,
    self: { id: `c${data.interviewId}`, name: data.candidateName, role: 'candidate' },
    stream: media.stream, screen: media.screen, micOn: media.micOn, camOn: media.camOn, hand,
    onEnded: () => { if (!ended.current) { ended.current = true; onEnded(); } },
  });
  return (
    <CallStage
      title={`Interview with ${data.interviewerName ?? data.companyName}`}
      subtitle={`${data.jobTitle} ${data.meetingType === 'screening' ? 'screening' : 'interview'} · Room code ${data.roomCode}`}
      since={since}
      call={call}
      media={media}
      self={{ name: data.candidateName, role: 'candidate' }}
      hand={hand}
      onHand={() => setHand((h) => !h)}
      onShare={() => { if (media.screen) media.stopScreen(); else void media.startScreen(); }}
      emptyStage={<div className={s.stageNote}><strong>Connecting you to {data.interviewerName ?? 'your interviewer'}…</strong><span>This takes a few seconds. Check that this tab is allowed to use your camera and microphone.</span></div>}
      panel={panel}
      onPanel={setPanel}
      endLabel="Leave meeting"
      onEnd={onLeave}
    />
  );
}

function Ended({ data, endedAt, startedAt }: { data: CandidateRoomDto; endedAt: string | null; startedAt: string | null }) {
  const minutes = endedAt && startedAt ? Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000)) : null;
  return (
    <div className={`${s.shell} ${s.narrow}`}>
      <Card>
        <div className={s.checkSide}>
          <h1 className={s.heading}>Thanks for meeting with us</h1>
          <p className={s.lead}>Your interview has ended. Here is what happens next.</p>
          <div className={s.statusLine}>
            <Badge tone="neutral">{data.jobTitle}</Badge>
            <span className={s.code}>{formatDate(data.startsAt, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}{minutes ? ` · ${plural(minutes, 'minute')}` : ''}</span>
          </div>
          <ul className={s.steps}>
            <li data-done><span><Icon name="check" size={14} /></span><span><strong>Interview finished</strong><small>{endedAt ? `Today, ${formatTime(endedAt)}` : 'Completed'}</small></span></li>
            <li><span><Icon name="edit" size={14} /></span><span><strong>Your interviewer writes a review</strong><small>This is under way now</small></span></li>
            <li><span><Icon name="refresh" size={14} /></span><span><strong>Your recruiter updates your application</strong><small>You will see the new status when you check</small></span></li>
          </ul>
          <div className={s.actions}>
            <ButtonLink to="/status">Back to my application</ButtonLink>
            <ButtonLink variant="secondary" to="/">Return to careers home</ButtonLink>
          </div>
        </div>
      </Card>
    </div>
  );
}

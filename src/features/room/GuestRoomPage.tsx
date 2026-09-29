import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import type { GuestRoomDto, GuestSessionDto } from '@shared/api/interviews';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Display';
import { Field, TextInput, formStyles } from '@/components/ui/Form';
import { EmptyState, Notice, Skeleton } from '@/components/ui/Feedback';
import { Card } from '@/components/ui/Surface';
import { ApiError, api, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { formatDate, formatTime } from '@/lib/format';
import { joinChannel } from '@/lib/realtime';
import { CallStage, type SidePanel } from './CallStage';
import { DeviceCheck, VideoPreview } from './DeviceCheck';
import { useCall } from './call/useCall';
import { useLocalMedia } from './call/useLocalMedia';
import s from './Room.module.css';

type Step = 'form' | 'waiting' | 'ready' | 'call' | 'denied' | 'left';
interface Values { name: string; position: string }
const KNOWN = ['name', 'position'];

// The guest's request key lives in this tab only, so a reload resumes the wait
// (or the call) without asking the hosts again. Storage can be unavailable.
const storageKey = (code: string) => `acme-guest:${code}`;
const saved = (code: string): { key: string; name: string; position: string } | null => {
  try { return JSON.parse(sessionStorage.getItem(storageKey(code)) ?? 'null') as { key: string; name: string; position: string } | null; } catch { return null; }
};
const save = (code: string, v: { key: string; name: string; position: string } | null) => {
  try { if (v) sessionStorage.setItem(storageKey(code), JSON.stringify(v)); else sessionStorage.removeItem(storageKey(code)); } catch { /* per-tab convenience only */ }
};

/**
 * Final interview guest entry: department heads and outside stakeholders give
 * their name and position, wait until a host admits them, then join the call.
 */
export function GuestRoomPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const [params] = useSearchParams();
  const g = params.get('g') ?? '';
  const path = `/room/${encodeURIComponent(code)}/guest`;
  const media = useLocalMedia();
  const [step, setStep] = useState<Step>('form');
  const [session, setSession] = useState<GuestSessionDto | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [callStart, setCallStart] = useState<string | null>(null);
  const resumed = useRef(false);
  const stepRef = useRef(step);
  stepRef.current = step;
  const last = saved(code);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Values>({
    defaultValues: { name: last?.name ?? '', position: last?.position ?? '' },
  });

  const room = useQuery({
    queryKey: ['guest-room', code, g],
    queryFn: () => api.get<GuestRoomDto>(`${path}?g=${encodeURIComponent(g)}`),
    retry: (n, e) => !(e instanceof ApiError && (e.status === 403 || e.status === 404 || e.status === 422)) && n < 2,
    refetchInterval: (q) => (q.state.data && !q.state.data.ended && step === 'form' ? 20_000 : false),
  });
  const info: GuestRoomDto | undefined = session ?? room.data;

  useEffect(() => { document.title = info ? `Final interview · ${info.companyName}` : 'Final interview'; }, [info]);

  /** Moves the screen to wherever the server says this guest is. */
  const applySession = useCallback((next: GuestSessionDto) => {
    setSession(next);
    if (next.ended || next.cancelled) {
      setEnded(true);
      media.stopAll();
      return;
    }
    const state = next.guest.state;
    if (state === 'denied') { save(code, null); media.stopAll(); setStep('denied'); return; }
    const cur = stepRef.current;
    if (state === 'left') { save(code, null); setStep(cur === 'call' || cur === 'left' ? 'left' : 'form'); return; }
    if (state === 'admitted' && next.realtime.room) {
      // Admitted while waiting: straight in. Admitted before a reload: check devices first.
      if (cur === 'waiting') { setCallStart(new Date().toISOString()); setStep('call'); } else if (cur !== 'call') setStep('ready');
      return;
    }
    if (state === 'waiting') setStep('waiting');
  }, [code, media]);

  const refresh = useCallback(async (key: string) => {
    try {
      applySession(await api.post<GuestSessionDto>(`${path}/status`, { g, key }));
    } catch (e) {
      // The request is gone (another tab left, or the link changed): start again at the form.
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) { save(code, null); setSession(null); setStep('form'); }
    }
  }, [applySession, code, g, path]);

  // A reload picks up where this tab left off.
  useEffect(() => {
    if (resumed.current || !room.data || !last?.key) return;
    resumed.current = true;
    void refresh(last.key);
  }, [room.data, last?.key, refresh]);

  // While waiting or in the call: heartbeat (keeps us on the hosts' screens) and state.
  const key = session?.guest.key ?? null;
  useEffect(() => {
    if (!key || (step !== 'waiting' && step !== 'call' && step !== 'ready')) return undefined;
    const t = window.setInterval(() => void refresh(key), step === 'waiting' ? 5000 : 15_000);
    return () => window.clearInterval(t);
  }, [key, step, refresh]);

  // Our own lobby channel: the host's decision and the end of the meeting arrive here at once.
  const lobby = session?.realtime.lobby ?? null;
  const driver = session?.realtime.driver ?? 'local';
  const peerId = session?.guest.peerId ?? '';
  useEffect(() => {
    if (!lobby || !key) return undefined;
    const ch = joinChannel(driver, lobby, peerId);
    const offs = [
      ch.on('entry:admitted', () => void refresh(key)),
      ch.on('entry:denied', () => void refresh(key)),
      ch.on('room:ended', () => void refresh(key)),
    ];
    return () => { offs.forEach((o) => o()); ch.close(); };
  }, [lobby, driver, peerId, key, refresh]);

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const next = await api.post<GuestSessionDto>(`${path}/join`, { g, name: v.name.trim(), position: v.position.trim() });
      save(code, { key: next.guest.key, name: next.guest.name, position: next.guest.position });
      applySession(next);
    } catch (e) {
      setFormError(applyServerErrors(e, setError, KNOWN));
      void room.refetch();
    }
  });

  const leave = async () => {
    if (key) {
      try { await api.post(`${path}/leave`, { g, key }); } catch { /* the request goes stale on its own */ }
    }
    save(code, null);
    media.stopAll();
    setStep(stepRef.current === 'call' ? 'left' : 'form');
    setSession(null);
  };

  if (room.isError) {
    const invalid = room.error instanceof ApiError && [403, 404, 422].includes(room.error.status);
    return (
      <div className={`${s.shell} ${s.narrow}`}>
        <Card>
          <EmptyState icon="alert" title={invalid ? 'This guest link is not valid' : 'The meeting could not be loaded'}
            text={invalid ? 'Check that you opened the full link you were sent, or ask the person who invited you for a new one.' : errorMessage(room.error)}
            actions={invalid ? null : <Button onClick={() => void room.refetch()}>Try again</Button>} />
        </Card>
      </div>
    );
  }
  if (!info) return <div className={`${s.shell} ${s.narrow}`}><Skeleton height={360} /></div>;

  if (step === 'call' && session?.realtime.room && session.rtc) {
    return <GuestCall session={session} media={media} since={callStart} onLeave={() => void leave()} onEnded={() => void refresh(session.guest.key)} />;
  }

  if (ended || info.ended || info.cancelled) {
    return (
      <div className={`${s.shell} ${s.narrow}`}>
        <Card>
          <EmptyState icon={info.cancelled ? 'xcircle' : 'checkcircle'} title={info.cancelled ? 'This interview was cancelled' : 'This meeting has ended'}
            text={info.cancelled ? 'Please contact the person who invited you.' : 'Thank you for joining the final interview. You can close this page.'} />
        </Card>
      </div>
    );
  }

  const facts = (
    <div className={s.facts}>
      <div><span>Meeting</span><strong>Final interview</strong></div>
      <div><span>Role</span><strong>{info.jobTitle}</strong></div>
      <div><span>Date</span><strong>{formatDate(info.startsAt, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</strong></div>
      <div><span>Time</span><strong>{formatTime(info.startsAt)}{info.endsAt ? ` – ${formatTime(info.endsAt)}` : ''}</strong></div>
    </div>
  );
  const roomCode = <span className={s.code}>Room {info.roomCode}</span>;

  if (step === 'ready' && session) {
    return (
      <div className={s.shell}>
        <DeviceCheck name={session.guest.name} media={media} joinLabel="Join meeting" context={<Card padding={16}>{facts}</Card>}
          onBack={() => void leave()} onJoin={() => { setCallStart(new Date().toISOString()); setStep('call'); }} />
      </div>
    );
  }

  if (step === 'waiting' && session) {
    return (
      <div className={`${s.shell} ${s.narrow}`}>
        <Card>
          <div className={s.checkSide}>
            <div className={s.statusLine}><Badge tone="info" dot>Waiting room</Badge>{roomCode}</div>
            <h1 className={s.heading}>Waiting for the host to let you in…</h1>
            <p className={s.lead}>
              The hiring team can see that <strong>{session.guest.name}</strong> ({session.guest.position}) is asking to join. Please keep this page open. It updates on its own.
            </p>
            <div className={s.waitPulse}><span className={s.dot} /><span><strong>Request sent</strong>You will join the moment someone in the room admits you.</span></div>
            <div>
              <strong>Get ready while you wait</strong>
              <p className={s.previewHint}>Nobody can see or hear you until you are admitted.</p>
            </div>
            <VideoPreview stream={media.stream} name={session.guest.name} off={!media.camOn} />
            <div className={s.actions}>
              {media.access === 'granted' ? (
                <>
                  <Button variant="secondary" icon={media.micOn ? 'mic' : 'micoff'} onClick={media.toggleMic}>{media.micOn ? 'Mute' : 'Unmute'}</Button>
                  <Button variant="secondary" icon={media.camOn ? 'video' : 'camoff'} onClick={media.toggleCam}>{media.camOn ? 'Camera off' : 'Camera on'}</Button>
                </>
              ) : (
                <Button icon="video" loading={media.access === 'requesting'} onClick={() => void media.request()}>Turn on camera and mic</Button>
              )}
              <Button variant="ghost" onClick={() => void leave()}>Leave waiting room</Button>
            </div>
            {media.error ? <Notice tone="warning">{media.error}</Notice> : null}
          </div>
        </Card>
      </div>
    );
  }

  if (step === 'denied') {
    return (
      <div className={`${s.shell} ${s.narrow}`}>
        <Card>
          <EmptyState icon="info" title="You were not admitted to this meeting"
            text="Thank you for your patience. The host was not able to let you in this time. If you think this is a mistake, please contact the person who invited you." />
        </Card>
      </div>
    );
  }

  if (step === 'left') {
    return (
      <div className={`${s.shell} ${s.narrow}`}>
        <Card>
          <EmptyState icon="signout" title="You left the meeting" text="The meeting is still running. To come back, ask to join again and a host will let you in."
            actions={<Button onClick={() => setStep('form')}>Ask to join again</Button>} />
        </Card>
      </div>
    );
  }

  return (
    <div className={`${s.shell} ${s.narrow}`}>
      <Card>
        <div className={s.checkSide}>
          <div className={s.statusLine}>
            <Badge tone={info.canJoin ? 'success' : 'neutral'} dot>{info.canJoin ? 'Room is open' : 'Not open yet'}</Badge>
            {roomCode}
          </div>
          <h1 className={s.heading}>Join the final interview at {info.companyName}</h1>
          <p className={s.lead}>You have been invited as a guest. Tell the hiring team who you are, and a host will let you in.</p>
          {facts}
          <form className={formStyles.stack} noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            {formError ? <Notice tone="danger">{formError}</Notice> : null}
            <Field label="Full name" required error={errors.name?.message}>
              <TextInput autoComplete="name" maxLength={120} placeholder="Jane Doe"
                {...register('name', { validate: (v) => v.trim().length > 0 || 'Please enter your full name.' })} />
            </Field>
            <Field label="Position / job title" required hint="Shown next to your name in the meeting." error={errors.position?.message}>
              <TextInput autoComplete="organization-title" maxLength={120} placeholder="Head of Marketing"
                {...register('position', { validate: (v) => v.trim().length > 0 || 'Please enter your position or job title.' })} />
            </Field>
            <div className={s.actions}>
              <Button type="submit" size="lg" icon="users" loading={isSubmitting} disabled={!info.canJoin}>Ask to join</Button>
            </div>
          </form>
          {!info.canJoin ? <Notice tone="info" title="The room is not open yet">{info.message} This page updates on its own.</Notice> : null}
          <p className={s.previewHint}><Icon name="lock" size={13} /> Your name and position are shown to everyone in the meeting.</p>
        </div>
      </Card>
    </div>
  );
}

function GuestCall({ session, media, since, onLeave, onEnded }: {
  session: GuestSessionDto; media: ReturnType<typeof useLocalMedia>; since: string | null; onLeave: () => void; onEnded: () => void;
}) {
  const [hand, setHand] = useState(false);
  const [panel, setPanel] = useState<SidePanel>(null);
  const self = { id: session.guest.peerId, name: session.guest.name, role: 'guest' as const, position: session.guest.position };
  const call = useCall({
    driver: session.realtime.driver,
    channel: session.realtime.room,
    rtc: session.rtc,
    self,
    stream: media.stream, screen: media.screen, micOn: media.micOn, camOn: media.camOn, hand,
    onEnded,
  });
  return (
    <CallStage
      title={`Final interview · ${session.jobTitle}`}
      subtitle={`${session.companyName} · You are a guest: ${session.guest.name} - ${session.guest.position}`}
      since={since}
      call={call}
      media={media}
      self={self}
      hand={hand}
      onHand={() => setHand((h) => !h)}
      onShare={() => { if (media.screen) media.stopScreen(); else void media.startScreen(); }}
      emptyStage={<div className={s.stageNote}><strong>Connecting you to the meeting…</strong><span>This takes a few seconds.</span></div>}
      panel={panel}
      onPanel={setPanel}
      endLabel="Leave meeting"
      onEnd={onLeave}
    />
  );
}

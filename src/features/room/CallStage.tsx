import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '@/components/icon/Icon';
import { Avatar } from '@/components/ui/Display';
import { cx } from '@/lib/cx';
import { formatTime, mmss } from '@/lib/format';
import type { Call, ParticipantRole, RemotePeer } from './call/useCall';
import type { LocalMedia } from './call/useLocalMedia';
import s from './Room.module.css';

const ROLE_LABELS: Record<ParticipantRole, string> = { interviewer: 'Interviewer', staff: 'Hiring team', candidate: 'Candidate' };

export function Elapsed({ since }: { since: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  const seconds = since ? Math.max(0, Math.floor((now - Date.parse(since)) / 1000)) : 0;
  return <span className={cx(s.pill, s.timer)}><Icon name="clock" size={15} />{mmss(seconds)}</span>;
}

function Tile({ stream, name, role, mirrored, muted, hasVideo, micOn, hand, small, highlight }: {
  stream: MediaStream | null; name: string; role?: string; mirrored?: boolean; muted?: boolean; hasVideo: boolean; micOn: boolean; hand?: boolean; small?: boolean; highlight?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);
  return (
    <div className={cx(s.tile, small && s.tileSmall, highlight && s.tileSpeaking)}>
      <video ref={ref} autoPlay playsInline muted={muted} className={cx(s.tileVideo, mirrored && s.mirrored)} style={{ opacity: hasVideo ? 1 : 0 }} />
      {!hasVideo ? (
        <div className={s.tileEmpty}><span className={s.glow} /><Avatar name={name} size={small ? 48 : 104} /></div>
      ) : null}
      <div className={s.tileName}>
        <Icon name={micOn ? 'mic' : 'micoff'} size={small ? 13 : 15} />
        {name}{role ? <span>· {role}</span> : null}
        {hand ? <Icon name="hand" size={15} /> : null}
      </div>
    </div>
  );
}

function Control({ icon, label, onClick, off, active, disabled }: { icon: IconName; label: string; onClick: () => void; off?: boolean; active?: boolean; disabled?: boolean }) {
  return (
    <div className={s.ctrl}>
      <button type="button" className={cx(s.ctrlBtn, off && s.ctrlOff, active && s.ctrlActive)} aria-label={label} aria-pressed={active || off || undefined} onClick={onClick} disabled={disabled}>
        <Icon name={icon} size={22} />
      </button>
      <span className={s.ctrlLabel}>{label}</span>
    </div>
  );
}

function ChatPanel({ call }: { call: Call }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [call.messages.length]);
  const submit = (e: FormEvent) => { e.preventDefault(); call.sendChat(text); setText(''); };
  return (
    <>
      <div className={s.sideHead}><strong>Chat</strong><span>Visible to everyone in the room</span></div>
      <div className={s.chatList} aria-live="polite">
        {call.messages.length === 0 ? <p className={s.sideEmpty}>Messages you send here are seen by everyone in the room and are not saved after the meeting.</p> : null}
        {call.messages.map((m) => (
          <div key={m.id} className={cx(s.chatMsg, m.mine && s.chatMine)}>
            <span className={s.chatWho}>{m.mine ? 'You' : m.name} <time>{formatTime(m.at)}</time></span>
            <p>{m.text}</p>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className={s.chatForm} onSubmit={submit}>
        <input className={s.chatInput} value={text} onChange={(e) => setText(e.target.value)} placeholder="Send a message" maxLength={2000} aria-label="Chat message" />
        <button type="submit" className={s.chatSend} aria-label="Send message" disabled={!text.trim()}><Icon name="send" size={18} /></button>
      </form>
    </>
  );
}

function ParticipantsPanel({ self, peers, extra }: { self: { name: string; role: ParticipantRole; micOn: boolean; camOn: boolean }; peers: RemotePeer[]; extra?: ReactNode }) {
  const row = (key: string, name: string, sub: string) => (
    <li key={key} className={s.person}><Avatar name={name} size={36} /><span><strong>{name}</strong><small>{sub}</small></span></li>
  );
  const status = (mic: boolean, cam: boolean) => `Mic ${mic ? 'on' : 'off'} · Cam ${cam ? 'on' : 'off'}`;
  return (
    <>
      <div className={s.sideHead}><strong>Participants</strong><span>{peers.length + 1} in the room</span></div>
      <ul className={s.people}>
        {row('self', self.name, `You · ${ROLE_LABELS[self.role]} · ${status(self.micOn, self.camOn)}`)}
        {peers.map((p) => row(p.meta.id, p.meta.name, `${ROLE_LABELS[p.meta.role]} · ${status(p.meta.mic, p.meta.cam)}${p.meta.hand ? ' · Hand raised' : ''}`))}
      </ul>
      {extra}
    </>
  );
}

export type SidePanel = 'chat' | 'participants' | 'dock' | null;

interface Props {
  title: string;
  subtitle: string;
  pills?: ReactNode;
  since: string | null;
  headerAction?: ReactNode;
  banner?: ReactNode;
  call: Call;
  media: LocalMedia;
  self: { name: string; role: ParticipantRole };
  hand: boolean;
  onHand: () => void;
  onShare: () => void;
  emptyStage: ReactNode;
  dock?: ReactNode;
  participantsExtra?: ReactNode;
  panel: SidePanel;
  onPanel: (p: SidePanel) => void;
  endLabel: string;
  onEnd: () => void;
  overlay?: ReactNode;
}

/** The full-screen call: top bar, video stage, optional side panel, and the control bar. */
export function CallStage(p: Props) {
  const { call, media } = p;
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const presenter = call.peers.find((x) => x.meta.screen) ?? call.peers[0] ?? null;
  const others = call.peers.filter((x) => x !== presenter);
  const selfHasVideo = Boolean(media.screen || (media.stream?.getVideoTracks().length && media.camOn));
  const selfStream = media.screen ?? media.stream;
  const toggle = (panel: Exclude<SidePanel, null>) => p.onPanel(p.panel === panel ? null : panel);

  return createPortal(
    <div className={s.room} role="application" aria-label={p.title}>
      <header className={s.topbar}>
        <div className={s.titleBlock}>
          <strong>{p.title}</strong>
          <span>{p.subtitle}</span>
        </div>
        <div className={s.pills}>
          {p.pills}
          <Elapsed since={p.since} />
          {p.headerAction}
        </div>
      </header>

      {p.banner}
      {call.reconnecting ? (
        <div className={s.bannerWarn} role="status"><Icon name="wifioff" size={18} />Connection lost. Reconnecting… Your notes are safe and keep saving.</div>
      ) : null}

      <div className={s.body}>
        <div className={s.stage}>
          <div className={s.main}>
            {presenter ? (
              <Tile stream={presenter.stream} name={presenter.meta.name} role={presenter.meta.screen ? 'Presenting' : ROLE_LABELS[presenter.meta.role]}
                hasVideo={presenter.hasVideo} micOn={presenter.meta.mic} hand={presenter.meta.hand} highlight />
            ) : (
              <div className={s.tile}><div className={s.tileEmpty}><span className={s.glow} />{p.emptyStage}</div></div>
            )}
            <div className={s.pip}>
              <Tile stream={selfStream} name="You" muted mirrored={!media.screen} hasVideo={selfHasVideo} micOn={media.micOn && Boolean(media.stream?.getAudioTracks().length)} hand={p.hand} small />
            </div>
          </div>
          {others.length ? (
            <div className={s.strip}>
              {others.map((o) => <Tile key={o.meta.id} stream={o.stream} name={o.meta.name} role={ROLE_LABELS[o.meta.role]} hasVideo={o.hasVideo} micOn={o.meta.mic} hand={o.meta.hand} small />)}
            </div>
          ) : null}
        </div>

        {p.panel ? (
          <aside className={s.side} aria-label="Side panel">
            <div className={s.sidePanel}>
              <button type="button" className={s.sideClose} onClick={() => p.onPanel(null)} aria-label="Close panel"><Icon name="close" size={18} /></button>
              {p.panel === 'chat' ? <ChatPanel call={call} /> : null}
              {p.panel === 'participants' ? <ParticipantsPanel self={{ ...p.self, micOn: media.micOn, camOn: media.camOn }} peers={call.peers} extra={p.participantsExtra} /> : null}
              {p.panel === 'dock' ? p.dock : null}
            </div>
          </aside>
        ) : null}
      </div>

      <footer className={s.controls}>
        <Control icon={media.micOn ? 'mic' : 'micoff'} label={media.micOn ? 'Mute' : 'Unmute'} off={!media.micOn} onClick={media.toggleMic} disabled={!media.stream?.getAudioTracks().length} />
        <Control icon={media.camOn ? 'video' : 'camoff'} label={media.camOn ? 'Stop video' : 'Start video'} off={!media.camOn} onClick={media.toggleCam} disabled={!media.stream?.getVideoTracks().length} />
        <Control icon="screen" label={media.screen ? 'Stop sharing' : 'Share screen'} active={Boolean(media.screen)} onClick={p.onShare} />
        <Control icon="hand" label={p.hand ? 'Lower hand' : 'Raise hand'} active={p.hand} onClick={p.onHand} />
        <span className={s.ctrlSep} />
        <Control icon="chat" label="Chat" active={p.panel === 'chat'} onClick={() => toggle('chat')} />
        <Control icon="users" label="Participants" active={p.panel === 'participants'} onClick={() => toggle('participants')} />
        {p.dock ? <Control icon="edit" label="Notes" active={p.panel === 'dock'} onClick={() => toggle('dock')} /> : null}
        <span className={s.ctrlSep} />
        <div className={s.ctrl}>
          <button type="button" className={s.endBtn} onClick={p.onEnd}><Icon name="phone" size={20} />{p.endLabel}</button>
        </div>
      </footer>
      {p.overlay}
    </div>,
    document.body,
  );
}

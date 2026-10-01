import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '@/components/icon/Icon';
import { Avatar } from '@/components/ui/Display';
import { cx } from '@/lib/cx';
import { formatTime, mmss } from '@/lib/format';
import type { Call, ChatScope, ParticipantMeta, ParticipantRole, RemotePeer } from './call/useCall';
import type { LocalMedia } from './call/useLocalMedia';
import s from './Room.module.css';

const ROLE_LABELS: Record<ParticipantRole, string> = { interviewer: 'Interviewer', staff: 'Hiring team', candidate: 'Candidate', guest: 'Guest' };

/** What a tile says under someone: guests show the position they entered, everyone else their role. */
const tileRole = (meta: Pick<ParticipantMeta, 'role' | 'position' | 'screen'>): { role?: string; position?: string } =>
  meta.screen ? { role: 'Presenting', position: meta.role === 'guest' ? meta.position : undefined }
    : meta.role === 'guest' && meta.position ? { position: meta.position } : { role: ROLE_LABELS[meta.role] };

/**
 * Who is talking right now, from the sound on each person's incoming audio. One
 * shared AudioContext, read a few times a second; only drives a highlight ring.
 */
function useSpeaking(peers: RemotePeer[]): Set<string> {
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const key = peers.map((x) => `${x.meta.id}:${x.stream.getAudioTracks()[0]?.id ?? ''}`).join('|');
  useEffect(() => {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return undefined;
    const ctx = new AC();
    const meters = peers.flatMap((x) => {
      const track = x.stream.getAudioTracks()[0];
      if (!track) return [];
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
      return [{ id: x.meta.id, analyser, data: new Uint8Array(analyser.fftSize) }];
    });
    const t = window.setInterval(() => {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      const now = new Set<string>();
      for (const m of meters) {
        m.analyser.getByteTimeDomainData(m.data);
        let sum = 0;
        for (const v of m.data) sum += (v - 128) * (v - 128);
        if (Math.sqrt(sum / m.data.length) > 6) now.add(m.id);
      }
      setSpeaking((prev) => (prev.size === now.size && [...now].every((id) => prev.has(id)) ? prev : now));
    }, 250);
    return () => { window.clearInterval(t); void ctx.close().catch(() => undefined); };
    // The key captures who is here and which audio track each sends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return speaking;
}

/** Shown to everyone in the room while the interviewer has AI notes on. */
export function AiNotesPill() {
  return <span className={cx(s.pill, s.pillAi)} title="The interviewer's AI assistant is taking notes of this meeting."><Icon name="sparkle" size={15} />AI notes on</span>;
}

export function Elapsed({ since }: { since: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  const seconds = since ? Math.max(0, Math.floor((now - Date.parse(since)) / 1000)) : 0;
  return <span className={cx(s.pill, s.timer)}><Icon name="clock" size={15} />{mmss(seconds)}</span>;
}

function Tile({ stream, name, role, position, mirrored, muted, hasVideo, micOn, hand, small, highlight }: {
  stream: MediaStream | null; name: string; role?: string; position?: string; mirrored?: boolean; muted?: boolean; hasVideo: boolean; micOn: boolean; hand?: boolean; small?: boolean; highlight?: boolean;
}) {
  // "John Doe - Tech Lead": the full text stays readable on hover when the pill truncates it.
  const label = position ? `${name} - ${position}` : name;
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (el.srcObject !== stream) el.srcObject = stream;
    // autoPlay alone can stall when tracks arrive after the stream is attached.
    const play = () => { if (el.srcObject) void el.play().catch(() => undefined); };
    play();
    stream?.addEventListener('addtrack', play);
    return () => stream?.removeEventListener('addtrack', play);
  }, [stream]);
  return (
    <div className={cx(s.tile, small && s.tileSmall, highlight && s.tileSpeaking)}>
      <video ref={ref} autoPlay playsInline muted={muted} className={cx(s.tileVideo, mirrored && s.mirrored)} style={{ opacity: hasVideo ? 1 : 0 }} />
      {!hasVideo ? (
        <div className={s.tileEmpty}><span className={s.glow} /><Avatar name={name} size={small ? 48 : 104} /></div>
      ) : null}
      <div className={s.tileName} title={role ? `${label} · ${role}` : label}>
        <Icon name={micOn ? 'mic' : 'micoff'} size={small ? 13 : 15} />
        <b className={s.tileLabel}>{label}</b>{role ? <span>· {role}</span> : null}
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
  const [scope, setScope] = useState<ChatScope>('everyone');
  const [seen, setSeen] = useState<Record<ChatScope, number>>({ everyone: 0, team: 0 });
  const end = useRef<HTMLDivElement>(null);
  const team = call.teamChat && scope === 'team';
  const list = call.messages.filter((m) => m.scope === scope);
  const count = (sc: ChatScope) => call.messages.filter((m) => m.scope === sc).length;
  // What has arrived in the other tab since it was last open.
  const unread = (sc: ChatScope) => sc !== scope && count(sc) > seen[sc];
  useEffect(() => { setSeen((v) => ({ ...v, [scope]: list.length })); }, [scope, list.length]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [list.length, scope]);
  const submit = (e: FormEvent) => { e.preventDefault(); call.sendChat(text, scope); setText(''); };
  return (
    <>
      {call.teamChat ? (
        <div className={s.sideTabs} role="tablist" aria-label="Chat">
          <button type="button" role="tab" aria-selected={scope === 'everyone'} className={s.sideTab} onClick={() => setScope('everyone')}>
            Everyone{unread('everyone') ? <span className={s.unreadDot} aria-label="new messages" /> : null}
          </button>
          <button type="button" role="tab" aria-selected={scope === 'team'} className={s.sideTab} onClick={() => setScope('team')}>
            <Icon name="lock" size={13} />Team chat{unread('team') ? <span className={s.unreadDot} aria-label="new messages" /> : null}
          </button>
        </div>
      ) : null}
      <div className={s.sideHead}>
        <strong>{team ? 'Team chat' : 'Chat'}</strong>
        <span>{team ? 'Only the hiring team and guests. The candidate cannot see this.' : 'Visible to everyone in the room'}</span>
      </div>
      <div className={cx(s.chatList, team && s.chatTeam)} aria-live="polite">
        {list.length === 0 ? (
          <p className={s.sideEmpty}>{team
            ? 'Pass notes to the panel here, like a question to ask next. Not saved after the meeting.'
            : 'Messages you send here are seen by everyone in the room and are not saved after the meeting.'}</p>
        ) : null}
        {list.map((m) => (
          <div key={m.id} className={cx(s.chatMsg, m.mine && s.chatMine)}>
            <span className={s.chatWho}>{m.mine ? 'You' : m.name} <time>{formatTime(m.at)}</time></span>
            <p>{m.text}</p>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className={s.chatForm} onSubmit={submit}>
        <input className={s.chatInput} value={text} onChange={(e) => setText(e.target.value)} placeholder={team ? 'Message the team' : 'Send a message'} maxLength={2000} aria-label={team ? 'Team chat message' : 'Chat message'} />
        <button type="submit" className={s.chatSend} aria-label="Send message" disabled={!text.trim()}><Icon name="send" size={18} /></button>
      </form>
    </>
  );
}

type PanelSelf = { name: string; role: ParticipantRole; position?: string; micOn: boolean; camOn: boolean };

const GROUPS: Array<{ key: string; title: string; roles: ParticipantRole[] }> = [
  { key: 'team', title: 'Hiring team', roles: ['interviewer', 'staff'] },
  { key: 'candidate', title: 'Candidate', roles: ['candidate'] },
  { key: 'guests', title: 'Guests', roles: ['guest'] },
];

/** Everyone in the room, grouped so the candidate and the interviewers know exactly who is listening. */
function ParticipantsPanel({ self, peers, extra }: { self: PanelSelf; peers: RemotePeer[]; extra?: ReactNode }) {
  const status = (mic: boolean, cam: boolean) => `Mic ${mic ? 'on' : 'off'} · Cam ${cam ? 'on' : 'off'}`;
  const people = [
    { key: 'self', you: true, name: self.name, role: self.role, position: self.position, mic: self.micOn, cam: self.camOn, hand: false },
    ...peers.map((p) => ({ key: p.meta.id, you: false, name: p.meta.name, role: p.meta.role, position: p.meta.position, mic: p.meta.mic, cam: p.meta.cam, hand: p.meta.hand })),
  ];
  return (
    <>
      <div className={s.sideHead}><strong>Participants</strong><span>{people.length} in the room</span></div>
      <div className={s.peopleGroups}>
        {GROUPS.map((g) => {
          const members = people.filter((m) => g.roles.includes(m.role));
          if (!members.length) return null;
          return (
            <section key={g.key} aria-label={g.title}>
              <h3 className={s.peopleTitle}>{g.title}<span>{members.length}</span></h3>
              <ul className={s.people}>
                {members.map((m) => (
                  <li key={m.key} className={s.person}>
                    <Avatar name={m.name} size={36} />
                    <span>
                      <strong>{m.name}{m.you ? ' (you)' : ''}</strong>
                      {m.role === 'guest' && m.position ? <em className={s.personPosition}>{m.position}</em> : null}
                      <small>{m.role === 'guest' ? 'External guest' : ROLE_LABELS[m.role]} · {status(m.mic, m.cam)}{m.hand ? ' · Hand raised' : ''}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
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
  self: { name: string; role: ParticipantRole; position?: string };
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
  // Admitted straight from a waiting room without ever turning devices on: ask now,
  // otherwise the person sits in the call with no microphone and no way to add one.
  const requestMedia = media.request;
  useEffect(() => {
    if (media.access === 'idle') void requestMedia();
    // Only on entering the call; later choices (joining without devices) stand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const sharing = call.peers.find((x) => x.meta.screen) ?? null;
  // The interview itself is between the interviewer and the candidate. Everyone else
  // (guests, other hiring team) watches from a row of small tiles, so they never look
  // like a second candidate. Two people, or someone presenting: the classic layout.
  const lead = (role: ParticipantRole) => role === 'interviewer' || role === 'candidate';
  const selfLead = lead(p.self.role);
  const leads = call.peers.filter((x) => lead(x.meta.role));
  const audience = call.peers.filter((x) => !lead(x.meta.role));
  const panelMode = !sharing && (audience.length > 0 || !selfLead);
  const presenter = sharing ?? call.peers[0] ?? null;
  const others = call.peers.filter((x) => x !== presenter);
  const speaking = useSpeaking(call.peers);
  const selfHasVideo = Boolean(media.screen || (media.stream?.getVideoTracks().length && media.camOn));
  const selfStream = media.screen ?? media.stream;
  const hasMic = Boolean(media.stream?.getAudioTracks().length);
  const hasCam = Boolean(media.stream?.getVideoTracks().length);
  const selfMic = media.micOn && hasMic;
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
          {panelMode ? (
            <>
              <div className={s.main}>
                {leads.length + (selfLead ? 1 : 0) ? (
                  <div className={s.grid} style={{ '--cols': leads.length + (selfLead ? 1 : 0) } as CSSProperties}>
                    {leads.map((o) => (
                      <Tile key={o.meta.id} stream={o.stream} name={o.meta.name} {...tileRole(o.meta)} hasVideo={o.hasVideo} micOn={o.meta.mic} hand={o.meta.hand} highlight={speaking.has(o.meta.id)} />
                    ))}
                    {selfLead ? <Tile stream={selfStream} name="You" muted mirrored={!media.screen} hasVideo={selfHasVideo} micOn={selfMic} hand={p.hand} /> : null}
                  </div>
                ) : (
                  <div className={s.tile}><div className={s.tileEmpty}><span className={s.glow} />{p.emptyStage}</div></div>
                )}
              </div>
              <div className={cx(s.strip, s.audience)} aria-label="Also in the room">
                {audience.map((o) => (
                  <Tile key={o.meta.id} stream={o.stream} name={o.meta.name} {...tileRole(o.meta)} hasVideo={o.hasVideo} micOn={o.meta.mic} hand={o.meta.hand} small highlight={speaking.has(o.meta.id)} />
                ))}
                {!selfLead ? <Tile stream={selfStream} name="You" position={p.self.position} muted mirrored={!media.screen} hasVideo={selfHasVideo} micOn={selfMic} hand={p.hand} small /> : null}
              </div>
            </>
          ) : (
            <>
              <div className={s.main}>
                {presenter ? (
                  <Tile stream={presenter.stream} name={presenter.meta.name} {...tileRole(presenter.meta)}
                    hasVideo={presenter.hasVideo} micOn={presenter.meta.mic} hand={presenter.meta.hand} highlight={speaking.has(presenter.meta.id)} />
                ) : (
                  <div className={s.tile}><div className={s.tileEmpty}><span className={s.glow} />{p.emptyStage}</div></div>
                )}
                <div className={s.pip}>
                  <Tile stream={selfStream} name="You" muted mirrored={!media.screen} hasVideo={selfHasVideo} micOn={selfMic} hand={p.hand} small />
                </div>
              </div>
              {others.length ? (
                <div className={s.strip}>
                  {others.map((o) => <Tile key={o.meta.id} stream={o.stream} name={o.meta.name} {...tileRole(o.meta)} hasVideo={o.hasVideo} micOn={o.meta.mic} hand={o.meta.hand} small />)}
                </div>
              ) : null}
            </>
          )}
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
        {hasMic
          ? <Control icon={media.micOn ? 'mic' : 'micoff'} label={media.micOn ? 'Mute' : 'Unmute'} off={!media.micOn} onClick={media.toggleMic} />
          : <Control icon="micoff" label="Turn on mic" off onClick={() => void media.request()} disabled={media.access === 'requesting'} />}
        {hasCam
          ? <Control icon={media.camOn ? 'video' : 'camoff'} label={media.camOn ? 'Stop video' : 'Start video'} off={!media.camOn} onClick={media.toggleCam} />
          : <Control icon="camoff" label="Turn on camera" off onClick={() => void media.request()} disabled={media.access === 'requesting'} />}
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

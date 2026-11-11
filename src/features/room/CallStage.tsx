import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '@/components/icon/Icon';
import { Avatar } from '@/components/ui/Display';
import { cx } from '@/lib/cx';
import { formatTime, mmss } from '@/lib/format';
import type { Call, ChatScope, ParticipantMeta, ParticipantRole, RemotePeer } from './call/useCall';
import type { LocalMedia } from './call/useLocalMedia';
import s from './Room.module.css';
import { lockScroll } from '@/lib/scrollLock';

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

/** Shown to everyone in the room when the meeting is recorded. */
export function RecordingPill({ note, problem }: { note?: string; problem?: boolean } = {}) {
  return (
    <span className={cx(s.pill, s.pillRec)} title={problem ? 'A part of the recording could not be saved. Keep this tab open.' : 'This meeting is recorded (cameras and sound) for the hiring team.'}>
      <span className={s.recDot} aria-hidden="true" />Recording{note ? <small className={s.recNote}>{problem ? 'save problem' : note}</small> : null}
    </span>
  );
}

export function Elapsed({ since }: { since: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  const seconds = since ? Math.max(0, Math.floor((now - Date.parse(since)) / 1000)) : 0;
  return <span className={cx(s.pill, s.timer)}><Icon name="clock" size={15} />{mmss(seconds)}</span>;
}

function Tile({ stream, name, role, position, mirrored, muted, hasVideo, micOn, hand, small, highlight, onSpot, fit }: {
  stream: MediaStream | null; name: string; role?: string; position?: string; mirrored?: boolean; muted?: boolean; hasVideo: boolean; micOn: boolean; hand?: boolean; small?: boolean; highlight?: boolean;
  /** Makes the whole tile clickable: it becomes the big spotlight. */
  onSpot?: () => void;
  /** Big tiles show the whole picture (camera or screen) like a video call app; small tiles fill their box. */
  fit?: 'cover' | 'contain';
}) {
  // "John Doe - Tech Lead": the full text stays readable on hover when the pill truncates it.
  const label = position ? `${name} - ${position}` : name;
  const ref = useRef<HTMLVideoElement>(null);
  // Whether pictures are really arriving. Browsers can leave an incoming camera
  // flagged "muted" on slow or relayed connections while frames still play, so the
  // tile trusts frames drawn rather than that flag.
  const [painting, setPainting] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (el.srcObject !== stream) el.srcObject = stream;
    // autoPlay alone can stall when tracks arrive after the stream is attached.
    const play = () => { if (el.srcObject) void el.play().catch(() => undefined); };
    play();
    stream?.addEventListener('addtrack', play);
    const tracks = stream?.getVideoTracks() ?? [];
    tracks.forEach((tr) => tr.addEventListener('unmute', play));

    let last = 0;
    let handle = 0;
    const video = el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void };
    const onFrame = () => { last = Date.now(); handle = video.requestVideoFrameCallback?.(onFrame) ?? 0; };
    if (video.requestVideoFrameCallback) handle = video.requestVideoFrameCallback(onFrame);
    let lastTime = -1;
    const check = window.setInterval(() => {
      // Without frame callbacks (older Safari), a moving clock with a picture size counts.
      if (!video.requestVideoFrameCallback && el.videoWidth > 0 && el.currentTime !== lastTime) { lastTime = el.currentTime; last = Date.now(); }
      setPainting(Date.now() - last < 2500);
    }, 700);
    return () => {
      window.clearInterval(check);
      if (handle) video.cancelVideoFrameCallback?.(handle);
      stream?.removeEventListener('addtrack', play);
      tracks.forEach((tr) => tr.removeEventListener('unmute', play));
    };
  }, [stream]);
  // Your own preview (muted) shows at once; other people once their pictures arrive.
  const showVideo = hasVideo && (painting || Boolean(muted));
  return (
    <div className={cx(s.tile, small && s.tileSmall, highlight && s.tileSpeaking)}>
      <video ref={ref} autoPlay playsInline muted={muted} className={cx(s.tileVideo, fit === 'cover' && s.fitCover, mirrored && s.mirrored)} style={{ opacity: showVideo ? 1 : 0 }} />
      {!showVideo ? (
        <div className={s.tileEmpty}><span className={s.glow} /><Avatar name={name} size={small ? 48 : 104} /></div>
      ) : null}
      {onSpot ? (
        <button type="button" className={s.tileHit} onClick={onSpot} aria-label={`Spotlight ${name}`} title="Click to spotlight">
          <span className={s.tileHint}><Icon name="expand" size={small ? 14 : 16} /></span>
        </button>
      ) : null}
      <div className={s.tileName} title={role ? `${label} · ${role}` : label}>
        <Icon name={micOn ? 'mic' : 'micoff'} size={small ? 13 : 15} />
        <b className={s.tileLabel}>{label}</b>{role ? <span>· {role}</span> : null}
      </div>
      {hand ? <span className={s.handBadge} role="img" aria-label="Hand raised"><Icon name="hand" size={small ? 14 : 20} /></span> : null}
    </div>
  );
}

/** The live size of an element, for layouts that depend on the room's real space. */
function useBoxSize(el: HTMLElement | null): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return size;
}

const GAP = 12;
type SidePlan = { at: 'right' | 'bottom'; cols: number; cap: number; tileW: number; tileH: number };

/**
 * Where everyone outside the big area goes, and how many fit without scrolling:
 * a grid on the right (one column, two when crowded) or one row underneath,
 * whichever leaves the big area (shape `mainRatio`) larger. Whoever does not fit
 * is folded into a "+N" tile.
 */
function planSide(w: number, h: number, n: number, forceBottom: boolean, mainRatio: number): SidePlan {
  const bottomTileW = Math.round(Math.min(220, Math.max(104, w * 0.2)));
  const bottomTileH = Math.max(72, Math.round(bottomTileW * 9 / 16));
  const bottomCols = Math.max(1, Math.floor((w + GAP) / (bottomTileW + GAP)));
  const bottom: SidePlan = { at: 'bottom', cols: bottomCols, cap: bottomCols, tileW: bottomTileW, tileH: bottomTileH };
  if (forceBottom || w < 860 || w < h * 1.2) return bottom;

  const sideW = Math.round(Math.min(380, Math.max(220, w * 0.25)));
  const fit = (cols: number) => {
    const tileW = Math.floor((sideW - GAP * (cols - 1)) / cols);
    const tileH = Math.round(tileW * 9 / 16);
    // At most four rows, so tiles stay big enough to recognise someone.
    return { tileW, tileH, rows: Math.min(4, Math.max(1, Math.floor((h + GAP) / (tileH + GAP)))) };
  };
  let cols = 1;
  let f = fit(1);
  if (n > f.rows) { cols = 2; f = fit(2); }
  const right: SidePlan = { at: 'right', cols, cap: cols * f.rows, tileW: f.tileW, tileH: f.tileH };

  // How tall the big area's content can be with each choice; the grid on the right wins ties.
  const usedW = Math.min(cols, n) * f.tileW + GAP * (Math.min(cols, n) - 1);
  const rightH = Math.min((w - usedW - GAP) / mainRatio, h);
  const bottomH = Math.min(w / mainRatio, h - bottomTileH - GAP);
  return rightH >= bottomH * 0.9 ? right : bottom;
}

type SideItem = { key: string; name: string; node: ReactNode; audio?: MediaStream };

/** Sound for someone folded into the "+N" tile: you still hear everyone. */
function PeerAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    void el.play().catch(() => undefined);
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

function SideTiles({ items, plan, onMore }: { items: SideItem[]; plan: SidePlan; onMore: () => void }) {
  const over = items.length > plan.cap;
  const shown = over ? items.slice(0, Math.max(0, plan.cap - 1)) : items;
  const hidden = over ? items.slice(shown.length) : [];
  const count = shown.length + (hidden.length ? 1 : 0);
  const style = { '--cols': Math.min(plan.cols, count), '--tw': `${plan.tileW}px`, '--th': `${plan.tileH}px` } as CSSProperties;
  return (
    <div className={s.sideTiles} style={style} aria-label="Also in the room">
      {shown.map((x) => x.node)}
      {hidden.length ? (
        <button type="button" className={cx(s.tile, s.tileSmall, s.moreTile)} onClick={onMore}
          aria-label={`${hidden.length} more in the room: ${hidden.map((x) => x.name).join(', ')}. Show participants`}>
          <span className={s.moreFaces} aria-hidden="true">
            {hidden.slice(0, 3).map((x) => <Avatar key={x.key} name={x.name} size={36} />)}
          </span>
          <span className={s.moreCount} aria-hidden="true">+{hidden.length}</span>
        </button>
      ) : null}
      {hidden.map((x) => (x.audio ? <PeerAudio key={`audio:${x.key}`} stream={x.audio} /> : null))}
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
  useEffect(() => lockScroll(), []);

  // The interview itself is between the interviewer and the candidate. Everyone else
  // (guests, other hiring team) watches from a row of small tiles, so they never look
  // like a second candidate. Two people: the classic layout.
  const lead = (role: ParticipantRole) => role === 'interviewer' || role === 'candidate';
  const selfLead = lead(p.self.role);
  const leads = call.peers.filter((x) => lead(x.meta.role));
  const audience = call.peers.filter((x) => !lead(x.meta.role));
  const panelMode = audience.length > 0 || !selfLead;
  const presenter = call.peers[0] ?? null;
  const others = call.peers.filter((x) => x !== presenter);
  const speaking = useSpeaking(call.peers);
  // Spotlight (like Discord): click any tile to make it the big one, everyone else drops to a row.
  const SELF = 'self';
  const [pinned, setPinned] = useState<string | null>(null);
  const pinnedValid = pinned !== null && (pinned === SELF || call.peers.some((x) => x.meta.id === pinned));
  const spotId = pinnedValid ? pinned : null;
  // Someone sharing a screen: it goes large on the right and every camera stays on, in a
  // column on the left. A peer on an older version of the app sends their screen instead
  // of their camera (no screenId): that one stream is their screen.
  const legacySharer = (o: RemotePeer) => o.meta.screen && !o.meta.screenId;
  const screens: Array<{ id: string; who: RemotePeer | null }> = [
    ...(media.screen ? [{ id: 'screen:self', who: null }] : []),
    ...call.peers.filter((o) => o.meta.screen).map((o) => ({ id: `screen:${o.meta.id}`, who: o })),
  ];
  const bigScreen = screens.find((x) => x.id === pinned) ?? screens[0] ?? null;
  const spotRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === spotRef.current && spotRef.current !== null);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void spotRef.current?.requestFullscreen?.().catch(() => undefined);
  };
  // Your tile is always your camera; a screen you share gets a tile of its own.
  const selfHasVideo = Boolean(media.stream?.getVideoTracks().length && media.camOn);
  const selfStream = media.stream;
  const hasMic = Boolean(media.stream?.getAudioTracks().length);
  const hasCam = Boolean(media.stream?.getVideoTracks().length);
  const selfMic = media.micOn && hasMic;
  const toggle = (panel: Exclude<SidePanel, null>) => p.onPanel(p.panel === panel ? null : panel);

  const peerTile = (o: RemotePeer, small: boolean, spot: boolean) => (
    <Tile key={o.meta.id} stream={o.stream} name={o.meta.name} {...tileRole(o.meta)} hasVideo={o.hasVideo} micOn={o.meta.mic} hand={o.meta.hand}
      small={small} highlight={speaking.has(o.meta.id)} fit={small ? 'cover' : 'contain'} onSpot={spot ? undefined : () => setPinned(o.meta.id)} />
  );
  const selfTile = (small: boolean, spot: boolean) => (
    <Tile key="self" stream={selfStream} name="You" position={small && !selfLead ? p.self.position : undefined} muted mirrored
      hasVideo={selfHasVideo} micOn={selfMic} hand={p.hand} small={small} fit={small ? 'cover' : 'contain'} onSpot={spot ? undefined : () => setPinned(SELF)} />
  );
  /** A shared screen, never cropped. `onSpot` swaps it into the big spot when several people share. */
  const screenTile = (x: { id: string; who: RemotePeer | null }, big: boolean) => x.who ? (
    <Tile key={x.id} stream={legacySharer(x.who) ? x.who.stream : x.who.screen} name={`${x.who.meta.name}’s screen`} role="Presenting"
      hasVideo={legacySharer(x.who) ? x.who.hasVideo : x.who.hasScreen} micOn={x.who.meta.mic} fit="contain"
      onSpot={big ? undefined : () => setPinned(x.id)} />
  ) : (
    <Tile key={x.id} stream={media.screen} name="Your screen" role="Presenting" muted hasVideo={Boolean(media.screen)} micOn={selfMic} fit="contain"
      onSpot={big ? undefined : () => setPinned(x.id)} />
  );
  const spotPeer = spotId && spotId !== SELF ? call.peers.find((x) => x.meta.id === spotId) ?? null : null;

  // Everyone outside the big area, most important first: the interviewer and candidate,
  // you, then raised hands, then everyone else in the order they joined.
  const ranked = (withSelf: boolean, peers: RemotePeer[], clickable = true): SideItem[] => {
    const rank = (o: RemotePeer) => (lead(o.meta.role) ? 0 : o.meta.hand ? 2 : 3);
    const items: Array<SideItem & { r: number }> = peers.map((o) => ({ key: o.meta.id, name: o.meta.name, node: peerTile(o, true, !clickable), audio: o.stream, r: rank(o) }));
    if (withSelf) items.push({ key: SELF, name: 'You', node: selfTile(true, !clickable), r: 1 });
    return items.sort((a, b) => a.r - b.r);
  };
  const [sideBox, setSideBox] = useState<HTMLDivElement | null>(null);
  const box = useBoxSize(sideBox);
  /** The big area plus everyone else in a grid beside it (or a row under it), never scrolling. */
  const withSide = (main: ReactNode, items: SideItem[], forceBottom: boolean, mainRatio = 16 / 9) => {
    const plan = planSide(box.w, box.h, items.length, forceBottom, mainRatio);
    return (
      <div ref={setSideBox} className={cx(s.withSide, plan.at === 'bottom' && s.withSideBottom, p.panel && s.besidePanel)}>
        <div className={s.main}>{main}</div>
        {items.length ? <SideTiles items={items} plan={plan} onMore={() => p.onPanel('participants')} /> : null}
      </div>
    );
  };

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
          {bigScreen ? withSide(
            <div className={s.spotArea} ref={spotRef}>
              <div className={s.spotFrame}>
                {screenTile(bigScreen, true)}
                <div className={s.spotBar}>
                  <button type="button" className={s.spotBtn} onClick={toggleFull} aria-pressed={full}><Icon name="expand" size={15} />{full ? 'Exit full screen' : 'Full screen'}</button>
                </div>
              </div>
            </div>,
            // Every camera stays on while someone shares: interviewer and candidate first.
            [
              ...ranked(true, call.peers.filter((o) => !legacySharer(o)), false),
              ...screens.filter((x) => x !== bigScreen).map((x) => ({ key: x.id, name: x.who ? `${x.who.meta.name}’s screen` : 'Your screen', node: screenTile(x, false) })),
            ],
            Boolean(p.panel),
          ) : spotId ? withSide(
            <div className={s.spotArea} ref={spotRef}>
              <div className={s.spotFrame}>
                {spotId === SELF ? selfTile(false, true) : spotPeer ? peerTile(spotPeer, false, true) : null}
                <div className={s.spotBar}>
                  {pinnedValid ? (
                    <button type="button" className={s.spotBtn} onClick={() => setPinned(null)}><Icon name="close" size={15} />Exit spotlight</button>
                  ) : null}
                  <button type="button" className={s.spotBtn} onClick={toggleFull} aria-pressed={full}><Icon name="expand" size={15} />{full ? 'Exit full screen' : 'Full screen'}</button>
                </div>
              </div>
            </div>,
            ranked(spotId !== SELF, call.peers.filter((x) => x.meta.id !== spotId)),
            false,
          ) : panelMode ? withSide(
            leads.length + (selfLead ? 1 : 0) ? (
              // The interviewer and candidate keep their camera's shape, side by side (stacked on upright screens).
              <div className={s.spotArea}>
                <div className={s.leadFrame} style={{ '--cols': leads.length + (selfLead ? 1 : 0) } as CSSProperties}>
                  {leads.map((o) => peerTile(o, false, false))}
                  {selfLead ? selfTile(false, false) : null}
                </div>
              </div>
            ) : audience.length === 0 ? (
              <div className={s.spotArea}><div className={s.spotFrame}>{selfTile(false, true)}</div></div>
            ) : (
              <div className={s.tile}><div className={s.tileEmpty}><span className={s.glow} />{p.emptyStage}</div></div>
            ),
            ranked(!selfLead && (leads.length > 0 || audience.length > 0), audience),
            false,
            (16 * Math.max(1, leads.length + (selfLead ? 1 : 0))) / 9,
          ) : (
            <>
              <div className={s.main}>
                {presenter ? (
                  <div className={s.spotArea}>
                    <div className={s.spotFrame}>
                      <Tile stream={presenter.stream} name={presenter.meta.name} {...tileRole(presenter.meta)} fit="contain"
                        hasVideo={presenter.hasVideo} micOn={presenter.meta.mic} hand={presenter.meta.hand} highlight={speaking.has(presenter.meta.id)} />
                      <div className={s.pip}>
                        {selfTile(true, false)}
                      </div>
                    </div>
                  </div>
                ) : (
                  // Nobody else here yet: you fill the frame, as in Google Meet. The other person
                  // takes it when they join, and you move to the corner.
                  <div className={s.spotArea}>
                    <div className={s.spotFrame}>{selfTile(false, true)}</div>
                  </div>
                )}
              </div>
              {others.length ? (
                <div className={s.strip}>
                  {others.map((o) => peerTile(o, true, false))}
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
          <button type="button" className={s.endBtn} onClick={p.onEnd} aria-label={p.endLabel}><Icon name="phone" size={20} /><span className={s.endText}>{p.endLabel}</span></button>
        </div>
      </footer>
      {p.overlay}
    </div>,
    document.body,
  );
}

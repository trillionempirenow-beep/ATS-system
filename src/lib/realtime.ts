import type { RealtimeChannel as SupabaseChannel, SupabaseClient } from '@supabase/supabase-js';

export type RealtimeDriver = 'supabase' | 'local';
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
export type PresenceState<M> = Record<string, M[]>;

/**
 * One channel: broadcast to the other members, receive their broadcasts and
 * server events, and share presence. Both transports implement the same shape,
 * so the interview room and the notification bell do not know which one runs.
 */
export interface Channel<M = Record<string, unknown>> {
  on(event: string, handler: (payload: unknown) => void): () => void;
  send(event: string, payload: unknown): void;
  track(meta: M): void;
  onPresence(handler: (state: PresenceState<M>) => void): () => void;
  onStatus(handler: (status: ConnectionStatus) => void): () => void;
  close(): void;
}

class Emitter<T> {
  private handlers = new Set<(v: T) => void>();
  add(h: (v: T) => void) { this.handlers.add(h); return () => { this.handlers.delete(h); }; }
  emit(v: T) { for (const h of this.handlers) h(v); }
}

// ---------------------------------------------------------------------------
// Supabase Realtime (production)
// ---------------------------------------------------------------------------
let supabase: Promise<SupabaseClient> | null = null;
/** The SDK is loaded on first use so it stays out of the initial bundle (local dev never needs it). */
function supabaseClient(): Promise<SupabaseClient> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) throw new Error('Realtime is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  supabase ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
  return supabase;
}

function supabaseChannel<M>(name: string, presenceKey: string): Channel<M> {
  const events = new Map<string, Emitter<unknown>>();
  const presence = new Emitter<PresenceState<M>>();
  const status = new Emitter<ConnectionStatus>();
  const client = supabaseClient();
  let ch: SupabaseChannel | null = null;
  let closed = false;
  let lastMeta: M | null = null;
  let current: ConnectionStatus = 'connecting';
  // Broadcasts sent before the SDK finished loading go out once the channel exists.
  const queued: Array<{ event: string; payload: unknown }> = [];

  void client.then((sb) => {
    if (closed) return;
    const channel = sb.channel(name, { config: { broadcast: { self: false, ack: false }, presence: { key: presenceKey } } });
    ch = channel;
    channel.on('broadcast', { event: '*' }, (msg: { event: string; payload: unknown }) => events.get(msg.event)?.emit(msg.payload));
    channel.on('presence', { event: 'sync' }, () => presence.emit(channel.presenceState() as unknown as PresenceState<M>));
    channel.subscribe((s) => {
      current = s === 'SUBSCRIBED' ? 'connected' : s === 'CLOSED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' ? 'disconnected' : 'connecting';
      status.emit(current);
      if (current !== 'connected') return;
      if (lastMeta) void channel.track(lastMeta as Record<string, unknown>);
      for (const m of queued.splice(0)) void channel.send({ type: 'broadcast', event: m.event, payload: m.payload });
    });
  }, () => {
    current = 'disconnected';
    status.emit(current);
  });

  return {
    on: (event, h) => { if (!events.has(event)) events.set(event, new Emitter()); return events.get(event)!.add(h); },
    send: (event, payload) => {
      if (ch && current === 'connected') void ch.send({ type: 'broadcast', event, payload });
      else queued.push({ event, payload });
    },
    track: (meta) => { lastMeta = meta; if (ch && current === 'connected') void ch.track(meta as Record<string, unknown>); },
    onPresence: (h) => presence.add(h),
    onStatus: (h) => { h(current); return status.add(h); },
    close: () => {
      closed = true;
      if (!ch) return;
      const channel = ch;
      void channel.unsubscribe();
      void client.then((sb) => sb.removeChannel(channel));
    },
  };
}

// ---------------------------------------------------------------------------
// Local development hub (served by the API at /dev-realtime)
// ---------------------------------------------------------------------------
interface LocalMember { name: string; presenceKey: string; meta: unknown; events: Map<string, Emitter<unknown>>; presence: Emitter<PresenceState<unknown>> }

class LocalHub {
  private ws: WebSocket | null = null;
  private members = new Map<string, LocalMember>();
  private statusEmitter = new Emitter<ConnectionStatus>();
  private retry = 0;
  status: ConnectionStatus = 'disconnected';

  private setStatus(s: ConnectionStatus) { this.status = s; this.statusEmitter.emit(s); }

  private connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/dev-realtime`);
    this.ws = ws;
    this.setStatus('connecting');
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('connected');
      for (const m of this.members.values()) ws.send(JSON.stringify({ type: 'join', channel: m.name, presenceKey: m.presenceKey, meta: m.meta }));
    };
    ws.onmessage = (ev) => {
      const frame = JSON.parse(String(ev.data)) as { type: string; channel: string; event?: string; payload?: unknown; state?: PresenceState<unknown> };
      const m = this.members.get(frame.channel);
      if (!m) return;
      if (frame.type === 'broadcast' && frame.event) m.events.get(frame.event)?.emit(frame.payload);
      if (frame.type === 'presence' && frame.state) m.presence.emit(frame.state);
    };
    ws.onclose = () => {
      this.setStatus('disconnected');
      if (!this.members.size) return;
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      window.setTimeout(() => this.connect(), delay);
    };
  }

  private raw(frame: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame)); }

  channel<M>(name: string, presenceKey: string): Channel<M> {
    const member: LocalMember = { name, presenceKey, meta: {}, events: new Map(), presence: new Emitter() };
    this.members.set(name, member);
    this.connect();
    this.raw({ type: 'join', channel: name, presenceKey, meta: member.meta });
    return {
      on: (event, h) => { if (!member.events.has(event)) member.events.set(event, new Emitter()); return member.events.get(event)!.add(h); },
      send: (event, payload) => this.raw({ type: 'broadcast', channel: name, event, payload }),
      track: (meta) => { member.meta = meta; this.raw({ type: 'track', channel: name, meta }); },
      onPresence: (h) => member.presence.add(h as (s: PresenceState<unknown>) => void),
      onStatus: (h) => { h(this.status); return this.statusEmitter.add(h); },
      close: () => {
        this.raw({ type: 'leave', channel: name });
        this.members.delete(name);
        if (!this.members.size) { this.ws?.close(); this.ws = null; }
      },
    };
  }
}

let localHub: LocalHub | null = null;

export function joinChannel<M = Record<string, unknown>>(driver: RealtimeDriver, name: string, presenceKey: string): Channel<M> {
  if (driver === 'local') return (localHub ??= new LocalHub()).channel<M>(name, presenceKey);
  return supabaseChannel<M>(name, presenceKey);
}

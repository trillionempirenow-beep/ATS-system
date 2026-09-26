import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

/**
 * DEVELOPMENT ONLY. A small stand-in for Supabase Realtime so the interview
 * room, presence and live notifications work on localhost with no Supabase
 * project. Implements the same three things the client uses: broadcast to
 * others on a channel, presence sync, and server-originated events.
 */
interface Member { socket: WebSocket; key: string; meta: unknown }

type ClientFrame =
  | { type: 'join'; channel: string; presenceKey?: string; meta?: unknown }
  | { type: 'leave'; channel: string }
  | { type: 'broadcast'; channel: string; event: string; payload: unknown }
  | { type: 'track'; channel: string; meta: unknown };

export function attachLocalHub(server: Server): (channel: string, event: string, payload: unknown) => void {
  const wss = new WebSocketServer({ server, path: '/dev-realtime' });
  const channels = new Map<string, Map<WebSocket, Member>>();

  const send = (s: WebSocket, frame: unknown) => {
    if (s.readyState === s.OPEN) s.send(JSON.stringify(frame));
  };
  const syncPresence = (channel: string) => {
    const members = channels.get(channel);
    if (!members) return;
    const state: Record<string, unknown[]> = {};
    for (const m of members.values()) (state[m.key] ??= []).push(m.meta);
    for (const m of members.values()) send(m.socket, { type: 'presence', channel, state });
  };
  const leave = (socket: WebSocket, channel: string) => {
    const members = channels.get(channel);
    if (!members?.delete(socket)) return;
    if (members.size === 0) channels.delete(channel);
    else syncPresence(channel);
  };

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let frame: ClientFrame;
      try { frame = JSON.parse(String(raw)) as ClientFrame; } catch { return; }
      if (frame.type === 'join') {
        const members = channels.get(frame.channel) ?? new Map<WebSocket, Member>();
        channels.set(frame.channel, members);
        members.set(socket, { socket, key: frame.presenceKey ?? 'anon', meta: frame.meta ?? {} });
        send(socket, { type: 'joined', channel: frame.channel });
        syncPresence(frame.channel);
      } else if (frame.type === 'leave') {
        leave(socket, frame.channel);
      } else if (frame.type === 'track') {
        const m = channels.get(frame.channel)?.get(socket);
        if (m) { m.meta = frame.meta; syncPresence(frame.channel); }
      } else if (frame.type === 'broadcast') {
        const members = channels.get(frame.channel);
        if (!members?.has(socket)) return;
        for (const m of members.values()) {
          if (m.socket !== socket) send(m.socket, { type: 'broadcast', channel: frame.channel, event: frame.event, payload: frame.payload });
        }
      }
    });
    socket.on('close', () => {
      for (const channel of [...channels.keys()]) leave(socket, channel);
    });
  });

  return (channel, event, payload) => {
    for (const m of channels.get(channel)?.values() ?? []) send(m.socket, { type: 'broadcast', channel, event, payload });
  };
}

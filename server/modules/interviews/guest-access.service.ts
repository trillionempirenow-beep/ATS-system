import type { GuestDto, GuestRequestDto, GuestRoomDto, GuestSessionDto } from '../../../shared/api/interviews.js';
import { MAX_GUESTS_PER_INTERVIEW, MAX_WAITING_GUESTS, interviewIsOver } from '../../../shared/domain/interviews.js';
import { env } from '../../config/env.js';
import { sql, transaction } from '../../db/client.js';
import { audit } from '../../core/audit.js';
import { getSettings, intSetting } from '../../core/settings.js';
import type { CurrentUser } from '../../http/context.js';
import { AppError, conflict, notFound, tooManyRequests } from '../../http/errors.js';
import { randomHex, safeEqual } from '../../lib/crypto.js';
import { formatTime, iso, isoOrThrow } from '../../lib/format.js';
import { channels, EVENTS } from '../../realtime/channels.js';
import { publish } from '../../realtime/publisher.js';
import { brand } from '../../email/brand.js';
import { displayState, joinStateFor, presenceWindow, rtcConfig, timingOf } from './interview-helpers.js';
import * as repo from './interviews.repository.js';

/**
 * GuestAccessService — outside stakeholders on a final interview. The guest
 * link (room code + guest token) only opens the entry page; the call itself is
 * issued to one guest at a time, after a host admits them. Replies never
 * contain the candidate's details, notes or scores.
 */
type Ctx = { user: CurrentUser; ip: string | null };

const invalid = () => new AppError(403, 'forbidden', 'This guest link is not valid.');

async function resolve(code: string, token: string) {
  if (!code || !/^[a-f0-9]{32}$/i.test(token)) throw invalid();
  const row = await repo.byRoomCode(code);
  if (!row || !row.is_final || !row.guest_token || !safeEqual(row.guest_token, token.toLowerCase())) throw invalid();
  return row;
}

async function resolveGuest(code: string, token: string, key: string) {
  const row = await resolve(code, token);
  const guest = await repo.guestByKey(row.id, key.toLowerCase());
  if (!guest) throw new AppError(404, 'not_found', 'Your request to join was not found. Enter your details again.');
  return { row, guest };
}

const toGuest = (g: repo.GuestRow): GuestDto => ({ id: g.id, peerId: `g${g.id}`, name: g.name, position: g.position });

async function roomFor(row: repo.InterviewRow): Promise<GuestRoomDto> {
  const [s, js, b] = await Promise.all([getSettings(), joinStateFor({ ...row, candidate_request_state: 'none' }), brand()]);
  const cancelled = displayState(row) === 'cancelled';
  const ended = !cancelled && interviewIsOver(timingOf(row));
  const message = cancelled ? 'This interview was cancelled.'
    : ended ? 'This interview has ended.'
      : js.canJoin ? 'The room is open.'
        : `The room opens at ${formatTime(js.opensAt)}, ${intSetting(s.interview_join_window_minutes, 15)} minutes before the interview starts.`;
  return {
    interviewId: row.id,
    companyName: b.company,
    jobTitle: row.job_title,
    startsAt: isoOrThrow(row.starts_at),
    endsAt: iso(row.ends_at),
    roomCode: row.room_code ?? '',
    canJoin: js.canJoin,
    ended,
    cancelled,
    message,
    opensAt: js.opensAt,
  };
}

async function sessionFor(row: repo.InterviewRow, guest: repo.GuestRow): Promise<GuestSessionDto> {
  const room = await roomFor(row);
  // The call channel is only issued once a host has let this guest in, and only while the meeting runs.
  const inCall = guest.state === 'admitted' && !room.ended && !room.cancelled;
  return {
    ...room,
    guest: { ...toGuest(guest), key: guest.guest_key, state: guest.state },
    realtime: { driver: env.REALTIME_DRIVER, lobby: channels.guest(guest.id), room: inCall ? channels.room(row.id) : null, staff: null },
    rtc: inCall ? await rtcConfig() : null,
  };
}

export async function guestRoom(code: string, token: string): Promise<GuestRoomDto> {
  return roomFor(await resolve(code, token));
}

/** Submitting the entry form: one new request, announced to every host in the room. */
export async function join(code: string, token: string, name: string, position: string): Promise<GuestSessionDto> {
  const row = await resolve(code, token);
  const room = await roomFor(row);
  if (room.cancelled || room.ended) throw conflict(room.message);
  if (!room.canJoin) throw conflict(room.message);

  const windowSeconds = await presenceWindow();
  const guest = await transaction(async (tx) => {
    // Lock the interview so two guests arriving together cannot both slip past the limits.
    await tx`select id from interviews where id = ${row.id} for update`;
    const [counts] = await tx<{ waiting: number; total: number }[]>`
      select count(*) filter (where state = 'waiting' and last_seen > now() - make_interval(secs => ${windowSeconds}))::int as waiting,
             count(*) filter (where state in ('waiting','admitted'))::int as total
      from interview_guests where interview_id = ${row.id}`;
    if ((counts?.waiting ?? 0) >= MAX_WAITING_GUESTS) throw tooManyRequests('The waiting room is full right now. Please try again in a few minutes.');
    if ((counts?.total ?? 0) >= MAX_GUESTS_PER_INTERVIEW) throw conflict('This meeting has reached its guest limit. Please contact the person who invited you.');
    const [created] = await tx<repo.GuestRow[]>`
      insert into interview_guests (interview_id, guest_key, name, position)
      values (${row.id}, ${randomHex(24)}, ${name}, ${position})
      returning id, interview_id, guest_key, name, position, state, requested_at, last_seen`;
    return created!;
  });

  await publish(channels.staff(row.id), EVENTS.guestRequested, { interviewId: row.id, guestId: guest.id, name, position });
  return sessionFor(row, guest);
}

/** Heartbeat and state: keeps a waiting guest visible to the hosts and picks up the decision. */
export async function status(code: string, token: string, key: string): Promise<GuestSessionDto> {
  const { row, guest } = await resolveGuest(code, token, key);
  if (guest.state === 'waiting' || guest.state === 'admitted') {
    await sql`update interview_guests set last_seen = now() where id = ${guest.id}`;
  }
  return sessionFor(row, guest);
}

/** Leaving, or withdrawing the request. Coming back means asking again. */
export async function leave(code: string, token: string, key: string): Promise<void> {
  const { row, guest } = await resolveGuest(code, token, key);
  const [left] = await sql<{ id: number }[]>`
    update interview_guests set state = 'left' where id = ${guest.id} and state in ('waiting','admitted') returning id`;
  if (left) await publish(channels.staff(row.id), EVENTS.guestRequested, { interviewId: row.id, guestId: guest.id, state: 'left' });
}

// ---- Hosts ------------------------------------------------------------------

export async function forHosts(interviewId: number, windowSeconds: number): Promise<{ requests: GuestRequestDto[]; admitted: GuestDto[] }> {
  const [waiting, admitted] = await Promise.all([repo.waitingGuests(interviewId, windowSeconds), repo.admittedGuests(interviewId)]);
  return {
    requests: waiting.map((g) => ({ ...toGuest(g), since: isoOrThrow(g.requested_at) })),
    admitted: admitted.map(toGuest),
  };
}

/**
 * Admit or deny one guest. Only a waiting request can be decided, so two hosts
 * clicking at once settle on whichever landed first; the other gets a clear answer.
 */
export async function decide(interviewId: number, guestId: number, decision: 'admit' | 'deny', ctx: Ctx): Promise<GuestDto> {
  const row = await repo.byId(interviewId);
  if (!row) throw notFound('Could not find that meeting.');
  if (decision === 'admit' && (displayState(row) === 'cancelled' || interviewIsOver(timingOf(row)))) {
    throw conflict('This meeting is no longer running.');
  }
  const target = decision === 'admit' ? 'admitted' : 'denied';
  const guest = await transaction(async (tx) => {
    const [updated] = await tx<repo.GuestRow[]>`
      update interview_guests set state = ${target}, decided_at = now(), decided_by = ${ctx.user.id}
      where id = ${guestId} and interview_id = ${interviewId} and state = 'waiting'
      returning id, interview_id, guest_key, name, position, state, requested_at, last_seen`;
    if (!updated) {
      const [current] = await tx<{ state: string }[]>`select state from interview_guests where id = ${guestId} and interview_id = ${interviewId}`;
      if (!current) throw notFound('That guest request was not found.');
      if (current.state === target) return null;
      throw conflict(current.state === 'left' ? 'This guest has left the waiting room.' : `Another host already ${current.state} this guest.`);
    }
    await audit({ userId: ctx.user.id, action: decision === 'admit' ? 'interview_guest_admitted' : 'interview_guest_denied', entityType: 'interview',
      entityId: interviewId, details: { guest: updated.name, position: updated.position }, ip: ctx.ip }, tx);
    return updated;
  });

  if (guest) {
    await Promise.all([
      publish(channels.guest(guest.id), decision === 'admit' ? EVENTS.entryAdmitted : EVENTS.entryDenied, { interviewId }),
      // Other hosts drop the same request from their screens.
      publish(channels.staff(interviewId), EVENTS.guestRequested, { interviewId, guestId, state: target }),
    ]);
    return toGuest(guest);
  }
  const [again] = await sql<repo.GuestRow[]>`select id, interview_id, guest_key, name, position, state, requested_at, last_seen from interview_guests where id = ${guestId}`;
  return toGuest(again!);
}

/** The meeting ended or was cancelled: tell every guest still waiting or in the call. */
export async function notifyGuests(interviewId: number, event: string, payload: unknown): Promise<void> {
  const rows = await sql<{ id: number }[]>`select id from interview_guests where interview_id = ${interviewId} and state in ('waiting','admitted')`;
  await Promise.all(rows.map((g) => publish(channels.guest(g.id), event, payload)));
}

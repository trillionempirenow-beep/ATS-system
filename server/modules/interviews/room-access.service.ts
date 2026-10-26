import type { CandidateRoomDto } from '../../../shared/api/interviews.js';
import { interviewIsOver } from '../../../shared/domain/interviews.js';
import { env } from '../../config/env.js';
import { sql } from '../../db/client.js';
import { getSettings, intSetting } from '../../core/settings.js';
import { notifyMany } from '../../core/notifications.js';
import { AppError } from '../../http/errors.js';
import { safeEqual } from '../../lib/crypto.js';
import { fullName, iso, isoOrThrow } from '../../lib/format.js';
import { emitN8nEvent } from '../../integrations/n8n/n8n.client.js';
import { channels, EVENTS } from '../../realtime/channels.js';
import { publish } from '../../realtime/publisher.js';
import { brand } from '../../email/brand.js';
import { joinStateFor, presenceWindow, rtcConfig, timingOf } from './interview-helpers.js';
import * as repo from './interviews.repository.js';

/**
 * RoomAccessService — the candidate side. A room code alone proves nothing
 * (codes get forwarded); every call must also carry the interview's own
 * token, compared in constant time. Replies never contain notes, scores or
 * recruiter data.
 */
async function resolve(code: string, token: string) {
  if (!code || !/^[a-f0-9]{32}$/i.test(token)) throw new AppError(403, 'forbidden', 'This interview link is not valid.');
  const row = await repo.byRoomCode(code);
  if (!row || !row.candidate_token || !safeEqual(row.candidate_token, token.toLowerCase())) {
    throw new AppError(403, 'forbidden', 'This interview link is not valid.');
  }
  return row;
}

async function stateFor(row: repo.InterviewRow): Promise<CandidateRoomDto> {
  const s = await getSettings();
  const js = await joinStateFor(row);
  const admitted = row.candidate_request_state === 'admitted' && js.canJoin;
  const b = await brand();
  const windowSeconds = intSetting(s.meeting_presence_seconds, 35, 10);
  return {
    valid: true,
    interviewId: row.id,
    jobTitle: row.job_title,
    companyName: b.company,
    meetingType: row.meeting_type,
    interviewType: row.interview_type,
    interviewerName: row.interviewer_name,
    candidateName: fullName(row.first_name, row.last_name),
    startsAt: isoOrThrow(row.starts_at),
    endsAt: iso(row.ends_at),
    roomCode: row.room_code ?? '',
    joinWindowMinutes: intSetting(s.interview_join_window_minutes, 15),
    joinState: js.state,
    canJoin: js.canJoin,
    message: js.message,
    opensAt: js.opensAt,
    requestState: row.candidate_request_state,
    interviewerPresent: Boolean(row.interviewer_last_seen && Date.now() - row.interviewer_last_seen.getTime() <= windowSeconds * 1000),
    ended: interviewIsOver(timingOf(row)),
    serverTime: new Date().toISOString(),
    startedAt: iso(row.started_at),
    // The call channel is only issued once the interviewer has let the candidate in.
    realtime: { driver: env.REALTIME_DRIVER, lobby: channels.lobby(row.id), room: admitted ? channels.room(row.id) : null, staff: null, team: null },
    rtc: admitted ? await rtcConfig() : null,
    aiNotesOn: row.assistant_enabled,
    recorded: row.record_meeting,
  };
}

export async function roomState(code: string, token: string): Promise<CandidateRoomDto> {
  return stateFor(await resolve(code, token));
}

export async function heartbeat(code: string, token: string): Promise<CandidateRoomDto> {
  const row = await resolve(code, token);
  await sql`update interviews set candidate_last_seen = now() where id = ${row.id}`;
  return stateFor((await repo.byId(row.id))!);
}

/**
 * Idempotent: joining twice, refreshing or reconnecting all land on one state,
 * and an admitted candidate is never pushed back to waiting.
 */
export async function requestEntry(code: string, token: string): Promise<CandidateRoomDto> {
  const row = await resolve(code, token);
  if (interviewIsOver(timingOf(row))) throw new AppError(409, 'conflict', 'This interview has ended.');
  const js = await joinStateFor(row);
  if (!js.canJoin) throw new AppError(409, 'conflict', 'The interview is not open yet.');
  if (row.candidate_request_state === 'admitted') return heartbeat(code, token);

  const windowSeconds = await presenceWindow();
  const interviewerHere = Boolean(row.interviewer_last_seen && Date.now() - row.interviewer_last_seen.getTime() <= windowSeconds * 1000);
  const target = interviewerHere ? 'requested' : 'waiting';
  const wasWaiting = row.candidate_request_state === 'waiting' || row.candidate_request_state === 'requested';
  await sql`update interviews set candidate_request_state = ${target}, candidate_last_seen = now(),
              candidate_requested_at = coalesce(candidate_requested_at, now())
            where id = ${row.id} and candidate_request_state <> 'admitted'`;

  const name = fullName(row.first_name, row.last_name);
  await publish(channels.staff(row.id), EVENTS.entryRequested, { interviewId: row.id, name, state: target });
  if (!wasWaiting && row.interviewer_id) {
    await notifyMany([row.interviewer_id], {
      type: 'candidate_waiting', title: 'Candidate is waiting',
      body: `${name} is in the waiting room for the ${row.job_title} interview.`,
      link: `/app/interviews/${row.id}/room`, actionLabel: 'Open room', entityType: 'interview', entityId: row.id,
    });
    emitN8nEvent('interview.candidate_waiting', { interviewId: row.id, interviewerId: row.interviewer_id });
  }
  return stateFor((await repo.byId(row.id))!);
}

export async function cancelRequest(code: string, token: string): Promise<void> {
  const row = await resolve(code, token);
  await sql`update interviews set candidate_request_state = 'none', candidate_requested_at = null, candidate_last_seen = null
            where id = ${row.id} and candidate_request_state <> 'admitted'`;
  await publish(channels.staff(row.id), EVENTS.entryRequested, { interviewId: row.id, state: 'none' });
}

/** Leaving clears only the candidate's own presence; it never ends the meeting. */
export async function leave(code: string, token: string): Promise<void> {
  const row = await resolve(code, token);
  await sql`update interviews set candidate_last_seen = null where id = ${row.id}`;
}

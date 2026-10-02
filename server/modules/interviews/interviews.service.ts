import type { z } from 'zod';
import { ROLE_LABELS } from '../../../shared/domain/access.js';
import { RECOMMENDATIONS, SCORECARD_CRITERIA } from '../../../shared/domain/interviews.js';
import { REVIEW_STAGE_LABELS, STAGE_ORDER, stageRank } from '../../../shared/domain/pipeline.js';
import type {
  InterviewListDto, LiveMeetingDto, PresenceResultDto, ScheduleOptionsDto, ScheduleResultDto, StaffRoomDto,
  AiSummary, momentSchema, reviewSchema, scheduleInterviewSchema, scorecardDraftSchema, updateInterviewSchema,
} from '../../../shared/api/interviews.js';
import type { DeliveryReport } from '../../../shared/api/envelope.js';
import { env } from '../../config/env.js';
import { sql, transaction } from '../../db/client.js';
import { audit } from '../../core/audit.js';
import { getSettings, intSetting } from '../../core/settings.js';
import { notifyMany } from '../../core/notifications.js';
import type { CurrentUser } from '../../http/context.js';
import { AppError, conflict, isUniqueViolation, notFound, validationFailed } from '../../http/errors.js';
import { randomHex, roomCode } from '../../lib/crypto.js';
import { fullName, iso, isoOrThrow } from '../../lib/format.js';
import { sendEmail, toDeliveryReport } from '../../email/email.service.js';
import { calendarInvite, googleCalendarLink } from '../../email/calendar.js';
import { brand, whenInfo } from '../../email/brand.js';
import { interviewChanged } from '../../email/templates/index.js';
import { emitN8nEvent } from '../../integrations/n8n/n8n.client.js';
import { channels, EVENTS } from '../../realtime/channels.js';
import { publish } from '../../realtime/publisher.js';
import { avatarUrlForCandidate } from '../media/media.urls.js';
import {
  acceptsReview, candidatePresent, candidateRoomLink, displayState, groupByDay, guestRoomLink, interviewCalendarEvent, invitationEmail, presenceWindow, rtcConfig, toListItem,
} from './interview-helpers.js';
import * as guests from './guest-access.service.js';
import * as repo from './interviews.repository.js';
import * as aiNotes from './interview-notes.service.js';

type Ctx = { user: CurrentUser; ip: string | null };

async function load(id: number) {
  const row = await repo.byId(id);
  if (!row) throw notFound('Could not find that meeting.');
  return row;
}

export async function list(): Promise<InterviewListDto> {
  const [rows, windowSeconds, settings] = await Promise.all([repo.listAll(), presenceWindow(), getSettings()]);
  const items = rows.map((r) => toListItem(r, windowSeconds));
  const grouped = groupByDay(items);
  const weekAhead = Date.now() + 7 * 86_400_000;
  return {
    ...grouped,
    joinWindowMinutes: intSetting(settings.interview_join_window_minutes, 15),
    counts: {
      today: grouped.today.length,
      upcoming: grouped.upcoming.length,
      awaitingReview: items.filter((i) => i.state === 'review_pending').length,
      thisWeek: items.filter((i) => Date.parse(i.startsAt) >= Date.now() && Date.parse(i.startsAt) <= weekAhead && i.status !== 'cancelled' && i.status !== 'no_show').length,
    },
  };
}

export async function scheduleOptions(): Promise<ScheduleOptionsDto> {
  const [apps, people, busy] = await Promise.all([repo.scheduleApplications(), repo.interviewers(), repo.busySlots()]);
  return {
    applications: apps.map((a) => ({ id: a.id, candidateName: fullName(a.first_name, a.last_name), jobTitle: a.title, stage: a.stage })),
    interviewers: people.map((p) => ({ id: p.id, name: p.name, roleLabel: ROLE_LABELS[p.role as keyof typeof ROLE_LABELS] ?? p.role, upcomingCount: p.upcoming_count })),
    busySlots: busy.map((b) => ({ interviewerId: b.interviewer_id, startsAt: isoOrThrow(b.starts_at) })),
    timezone: env.APP_TIMEZONE,
  };
}

export async function schedule(input: z.infer<typeof scheduleInterviewSchema>, ctx: Ctx): Promise<ScheduleResultDto> {
  const interviewerId = input.interviewerId ?? ctx.user.id;
  const builtIn = input.meetingMode === 'builtin';
  const final = input.finalInterview;
  const [app] = await sql<{ id: number; stage: string; status: string }[]>`select id, stage, status from applications where id = ${input.applicationId}`;
  if (!app || app.status !== 'active' || app.stage === 'hired' || app.stage === 'rejected') {
    throw validationFailed({ applicationId: 'Please select an active application.' });
  }
  const [iv] = await sql<{ id: number }[]>`select id from users where id = ${interviewerId} and active and role in ('admin','recruiter','hiring_manager','super_admin')`;
  if (!iv) throw validationFailed({ interviewerId: 'Choose an active interviewer.' });

  let interviewId: number;
  try {
    interviewId = await transaction(async (tx) => {
      const [clash] = await tx<{ id: number }[]>`
        select id from interviews where interviewer_id = ${interviewerId} and status <> 'cancelled' and starts_at = ${input.startsAt}`;
      if (clash) throw conflict('This interviewer already has an interview scheduled at that exact time. Please pick another time or interviewer.');
      const [created] = await tx<{ id: number }[]>`
        insert into interviews (application_id, interviewer_id, meeting_type, starts_at, ends_at, timezone, interview_type, meeting_url,
                                meeting_provider, room_code, candidate_token, is_final, guest_token, location, notes, status, created_by)
        values (${input.applicationId}, ${interviewerId}, ${input.meetingType}, ${input.startsAt}, ${input.endsAt ?? null}, ${env.APP_TIMEZONE},
                ${input.interviewType}, ${builtIn ? null : input.meetingUrl || null}, ${builtIn ? 'Acme Room' : input.meetingProvider || 'External'},
                ${builtIn ? roomCode() : null}, ${builtIn ? randomHex(16) : null}, ${final}, ${builtIn ? randomHex(16) : null}, ${input.location || null}, ${input.notes || null}, 'scheduled', ${ctx.user.id})
        returning id`;
      await tx`update applications set assigned_to = ${interviewerId} where id = ${input.applicationId} and assigned_to is null`;
      const target = input.meetingType === 'screening' ? 'screening' : input.finalInterview ? 'final_interview' : 'interview';
      const [prev] = await tx<{ stage: string }[]>`select stage from applications where id = ${input.applicationId}`;
      // Forward only: booking another round never pulls a candidate back to an earlier stage.
      const earlier = STAGE_ORDER.slice(0, stageRank(target));
      const moved = await tx`update applications set stage = ${target}, updated_at = now()
                             where id = ${input.applicationId} and stage in ${tx(earlier)}`;
      if (moved.count && prev) {
        await audit({ userId: ctx.user.id, action: 'pipeline_stage_move', entityType: 'application', entityId: input.applicationId,
          details: { from: prev.stage, to: target, via: 'interview scheduled' }, ip: ctx.ip }, tx);
      }
      await audit({ userId: ctx.user.id, action: 'interview_create', entityType: 'interview', entityId: created!.id,
        details: { meeting: input.meetingType, type: input.interviewType, room: builtIn ? 'Acme Room' : 'external', final }, ip: ctx.ip }, tx);
      return created!.id;
    });
  } catch (e) {
    if (isUniqueViolation(e, 'interview_no_double_booking')) throw conflict('This interviewer already has an interview scheduled at that exact time. Please pick another time or interviewer.');
    throw e;
  }

  const row = await load(interviewId);
  let delivery: DeliveryReport = {};
  if (input.sendInvite) {
    const result = await sendEmail({ key: `interview-invite:${interviewId}`, template: 'interview-invitation', to: row.email, email: await invitationEmail(row) });
    delivery = toDeliveryReport(result);
  }
  await notifyMany([interviewerId], {
    actorId: ctx.user.id, type: 'interview_scheduled', title: `${input.meetingType === 'screening' ? 'Screening' : 'Interview'} scheduled`,
    body: `${ctx.user.name} scheduled you with ${fullName(row.first_name, row.last_name)} for ${row.job_title}.`,
    link: `/app/interviews?focus=${interviewId}`, actionLabel: 'Open interviews', entityType: 'interview', entityId: interviewId,
  });
  emitN8nEvent('interview.scheduled', {
    interviewId, applicationId: row.application_id, startsAt: isoOrThrow(row.starts_at), meetingType: row.meeting_type, interviewType: row.interview_type,
    builtInRoom: builtIn, interviewerId, emailSentByApp: delivery.email === 'sent',
  });
  return { interviewId, roomCode: row.room_code, candidateLink: candidateRoomLink(row), guestLink: row.interviewer_id === ctx.user.id ? guestRoomLink(row) : null, ...delivery };
}

export async function update(id: number, input: z.infer<typeof updateInterviewSchema>, ctx: Ctx): Promise<DeliveryReport> {
  const before = await load(id);
  const rescheduled = input.startsAt !== undefined && Date.parse(input.startsAt) !== before.starts_at.getTime();
  try {
    await transaction(async (tx) => {
      if (input.startsAt !== undefined || input.endsAt !== undefined || input.interviewerId !== undefined || input.interviewType !== undefined || input.location !== undefined) {
        await tx`update interviews set
                   starts_at = ${input.startsAt ?? before.starts_at}, ends_at = ${input.endsAt === undefined ? before.ends_at : input.endsAt},
                   interviewer_id = ${input.interviewerId ?? before.interviewer_id}, interview_type = ${input.interviewType ?? before.interview_type},
                   location = ${input.location === undefined ? before.location : input.location || null},
                   reminder_sent_at = ${rescheduled ? null : before.reminder_sent_at},
                   meeting_state = ${rescheduled && before.meeting_state === 'ready' ? 'scheduled' : before.meeting_state}
                 where id = ${id}`;
        await audit({ userId: ctx.user.id, action: 'interview_rescheduled', entityType: 'interview', entityId: id,
          details: rescheduled ? { from: before.starts_at.toISOString(), to: input.startsAt } : null, ip: ctx.ip }, tx);
      }
      if (input.status && input.status !== before.status) {
        await tx`update interviews set status = ${input.status} where id = ${id}`;
        await audit({ userId: ctx.user.id, action: 'interview_status', entityType: 'interview', entityId: id, details: { status: input.status }, ip: ctx.ip }, tx);
      }
    });
  } catch (e) {
    if (isUniqueViolation(e, 'interview_no_double_booking')) throw conflict('This interviewer already has an interview scheduled at that exact time.');
    throw e;
  }
  const after = await load(id);
  let delivery: DeliveryReport = {};
  const cancelled = input.status === 'cancelled' && before.status !== 'cancelled';
  if (input.notifyCandidate && (rescheduled || cancelled)) {
    const b = await brand();
    const change = cancelled ? 'cancelled' : 'rescheduled';
    // Same calendar UID as the invitation: a reschedule moves the entry, a cancellation removes it.
    const event = interviewCalendarEvent(after, b.company);
    const email = interviewChanged(b, {
      candidateName: after.first_name, jobTitle: after.job_title, change,
      when: cancelled ? null : whenInfo(after.starts_at), joinUrl: cancelled ? null : candidateRoomLink(after) ?? after.meeting_url,
      calendarUrl: cancelled ? null : googleCalendarLink(event),
    });
    const result = await sendEmail({
      key: `interview-${change}:${id}:${cancelled ? 'x' : after.starts_at.getTime()}`,
      template: `interview-${change}`,
      to: after.email,
      email: { ...email, calendar: calendarInvite(event, cancelled ? 'CANCEL' : 'REQUEST') },
    });
    delivery = toDeliveryReport(result);
  }
  if (cancelled) {
    void publish(channels.lobby(id), EVENTS.roomEnded, { reason: 'cancelled' });
    void guests.notifyGuests(id, EVENTS.roomEnded, { reason: 'cancelled' });
  }
  emitN8nEvent('interview.updated', { interviewId: id, status: after.status, startsAt: isoOrThrow(after.starts_at), emailSentByApp: delivery.email === 'sent' });
  return delivery;
}

export async function staffRoom(id: number, user: CurrentUser): Promise<StaffRoomDto> {
  const row = await load(id);
  const windowSeconds = await presenceWindow();
  const isInterviewer = row.interviewer_id === user.id;
  const [myRatings, moments, assistantNotes, rtc, guestList] = await Promise.all([
    repo.scorecardFor(id, user.id), repo.momentsFor(id), isInterviewer ? aiNotes.notesFor(id) : Promise.resolve([]), rtcConfig(), guests.forHosts(id, windowSeconds),
  ]);
  return {
    interview: {
      ...toListItem(row, windowSeconds),
      liveNotes: row.live_notes,
      notesUpdatedAt: iso(row.notes_updated_at),
      feedback: row.feedback,
      startedAt: iso(row.started_at),
      endedAt: iso(row.ended_at),
      reviewedAt: iso(row.reviewed_at),
      reviewerName: row.reviewer_name,
      notes: row.notes,
      acceptsReview: acceptsReview(row),
      candidateRequestState: row.candidate_request_state,
      candidateRequestedAt: iso(row.candidate_requested_at),
      candidatePresent: candidatePresent(row, windowSeconds),
      assistantEnabled: row.assistant_enabled,
      stage: row.stage,
    },
    me: { id: user.id, name: user.name },
    scorecard: { criteria: [...SCORECARD_CRITERIA], myRatings },
    moments: moments.map((m) => ({ id: m.id, atSecond: m.at_second, label: m.label, author: m.author })),
    // Live AI notes are the interviewer's alone.
    assistant: { configured: aiNotes.notesConfigured(), enabled: row.assistant_enabled, canUse: isInterviewer, notes: assistantNotes },
    // Older drivers hand jsonb back as text.
    aiSummary: typeof row.ai_summary === 'string' ? JSON.parse(row.ai_summary) as AiSummary : row.ai_summary,
    rtc,
    realtime: { driver: env.REALTIME_DRIVER, room: row.room_code ? channels.room(id) : null, staff: channels.staff(id), lobby: null, team: row.room_code ? channels.team(id) : null },
    presenceSeconds: windowSeconds,
    // Only the interviewer shares the guest link; everyone in the room can still admit guests.
    guests: { link: isInterviewer ? guestRoomLink(row) : null, admitted: guestList.admitted },
  };
}

/** Staff heartbeat: marks the interviewer present and moves the meeting forward only. */
export async function staffPresence(id: number): Promise<PresenceResultDto> {
  await sql`update interviews set interviewer_last_seen = now() where id = ${id}`;
  await sql`update interviews set meeting_state = 'in_progress', started_at = coalesce(started_at, now())
            where id = ${id} and meeting_state in ('scheduled','ready') and status not in ('cancelled','no_show')`;
  const row = await load(id);
  const windowSeconds = await presenceWindow();
  const guestList = row.guest_token ? await guests.forHosts(id, windowSeconds) : { requests: [], admitted: [] };
  const waiting = row.candidate_request_state === 'waiting' || row.candidate_request_state === 'requested';
  if (waiting && row.candidate_request_state === 'waiting' && candidatePresent(row, windowSeconds)) {
    // The interviewer has arrived: a waiting candidate becomes a request to decide on.
    await sql`update interviews set candidate_request_state = 'requested' where id = ${id} and candidate_request_state = 'waiting'`;
  }
  return {
    pendingRequest: waiting && candidatePresent(row, windowSeconds)
      ? { state: 'requested', since: iso(row.candidate_requested_at), name: fullName(row.first_name, row.last_name), avatarUrl: avatarUrlForCandidate(row.candidate_id, row.profile_image) }
      : null,
    candidatePresent: candidatePresent(row, windowSeconds),
    meetingState: displayState(row),
    guestRequests: guestList.requests,
    admittedGuests: guestList.admitted,
    startedAt: iso(row.started_at),
  };
}

export async function staffLeave(id: number): Promise<void> {
  await sql`update interviews set interviewer_last_seen = null where id = ${id}`;
}

export async function admit(id: number, ctx: Ctx): Promise<void> {
  const row = await load(id);
  if (displayState(row) === 'cancelled') throw conflict('This interview was cancelled.');
  await transaction(async (tx) => {
    await tx`update interviews set candidate_request_state = 'admitted', candidate_admitted_at = now(), candidate_admitted_by = ${ctx.user.id},
               candidate_joined_at = coalesce(candidate_joined_at, now()) where id = ${id}`;
    await audit({ userId: ctx.user.id, action: 'interview_candidate_admitted', entityType: 'interview', entityId: id,
      details: { candidate: fullName(row.first_name, row.last_name) }, ip: ctx.ip }, tx);
  });
  await publish(channels.lobby(id), EVENTS.entryAdmitted, { interviewId: id });
}

export async function saveNotes(id: number, liveNotes: string, user: CurrentUser): Promise<{ savedAt: string }> {
  const row = await load(id);
  if (row.meeting_state === 'reviewed') throw conflict('This interview has already been reviewed.');
  const [r] = await sql<{ notes_updated_at: Date }[]>`
    update interviews set live_notes = ${liveNotes === '' ? null : liveNotes}, notes_updated_at = now(), notes_author_id = ${user.id}
    where id = ${id} returning notes_updated_at`;
  return { savedAt: isoOrThrow(r!.notes_updated_at) };
}

export async function markConnected(id: number): Promise<void> {
  await sql`insert into interview_signals (interview_id, connected_at) values (${id}, now())
            on conflict (interview_id) do update set connected_at = coalesce(interview_signals.connected_at, now())`;
}

export async function endMeeting(id: number, liveNotes: string | undefined, ctx: Ctx): Promise<void> {
  const row = await load(id);
  if (acceptsReview(row)) return;
  await transaction(async (tx) => {
    if (liveNotes !== undefined) {
      await tx`update interviews set live_notes = ${liveNotes === '' ? null : liveNotes}, notes_updated_at = now(), notes_author_id = ${ctx.user.id} where id = ${id}`;
    }
    await tx`update interviews set meeting_state = 'review_pending', ended_at = coalesce(ended_at, now()), interviewer_last_seen = null,
               status = case when status in ('cancelled','no_show') then status else 'completed' end where id = ${id}`;
    await tx`insert into interview_signals (interview_id, ended_at) values (${id}, now())
             on conflict (interview_id) do update set ended_at = now()`;
    await audit({ userId: ctx.user.id, action: 'interview_ended', entityType: 'interview', entityId: id, ip: ctx.ip }, tx);
  });
  const payload = { interviewId: id, endedBy: ctx.user.name, endedById: ctx.user.id };
  await Promise.all([
    publish(channels.room(id), EVENTS.roomEnded, payload), publish(channels.lobby(id), EVENTS.roomEnded, payload), guests.notifyGuests(id, EVENTS.roomEnded, payload),
  ]);
  emitN8nEvent('interview.ended', { interviewId: id });
  if (row.assistant_enabled) {
    await sql`update interviews set assistant_enabled = false where id = ${id}`;
    aiNotes.summariseAfterMeeting(id);
  }
}

export async function submitReview(id: number, input: z.infer<typeof reviewSchema>, ctx: Ctx): Promise<void> {
  const row = await load(id);
  if (!acceptsReview(row)) throw new AppError(409, 'conflict', 'This interview has not ended yet. End the meeting before submitting a score and review.');
  if (input.score === null && !input.review && !input.recommendation) throw validationFailed({ score: 'Add a score, a review or a recommendation.' });
  // A final interview has its own stage review, so it never overwrites the first interview's.
  const stageType = row.meeting_type === 'screening' ? 'screening' : row.is_final ? 'final_interview' : 'interview';
  await transaction(async (tx) => {
    await tx`update interviews set meeting_state = 'reviewed', reviewed_at = now(), score = ${input.score}, feedback = ${input.review || null},
               recommendation = ${input.recommendation}, reviewer_id = ${ctx.user.id},
               status = case when status in ('cancelled','no_show') then status else 'completed' end where id = ${id}`;
    await tx`insert into stage_reviews (application_id, stage_type, rating, feedback, notes, reviewer_id)
             values (${row.application_id}, ${stageType}, ${input.score}, ${input.review || null}, ${row.live_notes}, ${ctx.user.id})
             on conflict (application_id, stage_type) do update set rating = excluded.rating, feedback = excluded.feedback,
               notes = excluded.notes, reviewer_id = excluded.reviewer_id, updated_at = now()`;
    await audit({ userId: ctx.user.id, action: 'interview_review_submitted', entityType: 'interview', entityId: id, details: {
      meeting: REVIEW_STAGE_LABELS[stageType],
      score: input.score !== null ? `${input.score}/100` : '',
      recommendation: input.recommendation ? RECOMMENDATIONS[input.recommendation] : '',
    }, ip: ctx.ip }, tx);
    await audit({ userId: ctx.user.id, action: `${stageType}_review`, entityType: 'application', entityId: row.application_id, ip: ctx.ip }, tx);
  });
  emitN8nEvent('interview.reviewed', { interviewId: id, applicationId: row.application_id, score: input.score, recommendation: input.recommendation });
}

export async function saveScorecardDraft(id: number, input: z.infer<typeof scorecardDraftSchema>, user: CurrentUser): Promise<void> {
  await load(id);
  await transaction(async (tx) => {
    for (const [criterion, rating] of Object.entries(input.ratings)) {
      if (rating === null) await tx`delete from scorecard_ratings where interview_id = ${id} and reviewer_id = ${user.id} and criterion = ${criterion}`;
      else await tx`insert into scorecard_ratings (interview_id, reviewer_id, criterion, rating) values (${id}, ${user.id}, ${criterion}, ${rating})
                    on conflict (interview_id, reviewer_id, criterion) do update set rating = excluded.rating, updated_at = now()`;
    }
  });
}

export async function flagMoment(id: number, input: z.infer<typeof momentSchema>, user: CurrentUser) {
  await load(id);
  const [m] = await sql<{ id: number }[]>`insert into interview_moments (interview_id, user_id, at_second, label) values (${id}, ${user.id}, ${input.atSecond}, ${input.label}) returning id`;
  return { id: m!.id };
}

/** The interview this user is currently hosting, for the "Interview in progress" banner. */
export async function myLiveMeeting(user: CurrentUser): Promise<LiveMeetingDto | null> {
  const windowSeconds = await presenceWindow();
  const [row] = await sql<{ id: number; title: string; first_name: string; last_name: string }[]>`
    select i.id, j.title, c.first_name, c.last_name from interviews i
    join applications a on a.id = i.application_id join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id
    where i.interviewer_id = ${user.id} and i.meeting_state = 'in_progress'
      and i.interviewer_last_seen > now() - make_interval(secs => ${windowSeconds})
    order by i.interviewer_last_seen desc limit 1`;
  return row ? { interviewId: row.id, jobTitle: row.title, candidateName: fullName(row.first_name, row.last_name) } : null;
}


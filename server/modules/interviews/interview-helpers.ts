import { env } from '../../config/env.js';
import { getSettings, intSetting } from '../../core/settings.js';
import {
  type INTERVIEW_TYPES, candidateJoinState, interviewAcceptsReview, interviewDisplayState, interviewerIsPresent,
  type InterviewTiming,
} from '../../../shared/domain/interviews.js';
import type { InterviewListItemDto, RtcConfigDto } from '../../../shared/api/interviews.js';
import { formatTime, fullName, iso, isoOrThrow, todayInZone } from '../../lib/format.js';
import { appLink, brand, whenInfo } from '../../email/brand.js';
import { interviewInvitation } from '../../email/templates/index.js';
import { avatarUrlForCandidate } from '../media/media.urls.js';
import type { InterviewRow } from './interviews.repository.js';

export const timingOf = (r: InterviewRow): InterviewTiming => ({ status: r.status, meeting_state: r.meeting_state, starts_at: isoOrThrow(r.starts_at) });
export const displayState = (r: InterviewRow) => interviewDisplayState(timingOf(r));
export const acceptsReview = (r: InterviewRow) => interviewAcceptsReview(timingOf(r));

export async function presenceWindow(): Promise<number> {
  return intSetting((await getSettings()).meeting_presence_seconds, 35, 10);
}

export function candidatePresent(r: InterviewRow, windowSeconds: number): boolean {
  return interviewerIsPresent(iso(r.candidate_last_seen), windowSeconds);
}

export async function joinStateFor(r: InterviewRow) {
  const s = await getSettings();
  return candidateJoinState(
    { ...timingOf(r), candidate_request_state: r.candidate_request_state, interviewer_last_seen: iso(r.interviewer_last_seen) },
    {
      joinWindowMinutes: intSetting(s.interview_join_window_minutes, 15),
      presenceSeconds: intSetting(s.meeting_presence_seconds, 35, 10),
      formatTime: (t) => formatTime(t),
    },
  );
}

export function toListItem(r: InterviewRow, presenceSeconds: number): InterviewListItemDto {
  return {
    id: r.id,
    applicationId: r.application_id,
    candidateId: r.candidate_id,
    candidateName: fullName(r.first_name, r.last_name),
    candidateEmail: r.email,
    avatarUrl: avatarUrlForCandidate(r.candidate_id, r.profile_image),
    jobTitle: r.job_title,
    meetingType: r.meeting_type,
    interviewType: r.interview_type,
    startsAt: isoOrThrow(r.starts_at),
    endsAt: iso(r.ends_at),
    interviewerId: r.interviewer_id,
    interviewerName: r.interviewer_name,
    status: r.status,
    state: displayState(r),
    builtInRoom: Boolean(r.room_code),
    roomCode: r.room_code,
    meetingUrl: r.meeting_url,
    meetingProvider: r.meeting_provider,
    location: r.location,
    score: r.score,
    recommendation: r.recommendation,
    candidateWaiting:
      (r.candidate_request_state === 'waiting' || r.candidate_request_state === 'requested') && candidatePresent(r, presenceSeconds),
    finalInterview: r.is_final,
  };
}

export function groupByDay(items: InterviewListItemDto[]) {
  const today = todayInZone();
  const dayOf = (isoStr: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(isoStr));
  const terminal = new Set(['review_pending', 'reviewed', 'cancelled', 'no_show']);
  const out = { today: [] as InterviewListItemDto[], upcoming: [] as InterviewListItemDto[], past: [] as InterviewListItemDto[] };
  for (const i of items) {
    const day = dayOf(i.startsAt);
    if (terminal.has(i.state) && day < today) out.past.push(i);
    else if (day === today) out.today.push(i);
    // Older interviews that never ended stay visible here until someone acts on them.
    else out.upcoming.push(i);
  }
  out.today.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  out.upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return out;
}

export async function rtcConfig(): Promise<RtcConfigDto> {
  const raw = (await getSettings()).ice_servers;
  try {
    const parsed = JSON.parse(raw) as RtcConfigDto['iceServers'];
    if (Array.isArray(parsed) && parsed.length) return { iceServers: parsed };
  } catch { /* fall back below */ }
  return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
}

export const candidateRoomLink = (r: Pick<InterviewRow, 'room_code' | 'candidate_token'>): string | null =>
  r.room_code && r.candidate_token ? appLink(`/interview/${encodeURIComponent(r.room_code)}?t=${r.candidate_token}`) : null;

/** The shareable link for outside stakeholders. Only final interviews in the built-in room have one. */
export const guestRoomLink = (r: Pick<InterviewRow, 'is_final' | 'room_code' | 'guest_token'>): string | null =>
  r.is_final && r.room_code && r.guest_token ? appLink(`/interview/${encodeURIComponent(r.room_code)}/guest?g=${r.guest_token}`) : null;

const TYPE_LABELS: Record<(typeof INTERVIEW_TYPES)[number], string> = { phone: 'Phone call', video: 'Video call', onsite: 'Onsite', panel: 'Panel (video)' };

export async function invitationEmail(r: InterviewRow) {
  const b = await brand();
  const link = r.room_code ? candidateRoomLink(r) : r.meeting_url || null;
  const minutes = r.ends_at ? Math.round((r.ends_at.getTime() - r.starts_at.getTime()) / 60000) : null;
  return interviewInvitation(b, {
    candidateName: r.first_name,
    jobTitle: r.job_title,
    meetingType: r.meeting_type,
    final: r.is_final,
    interviewType: r.room_code ? `${TYPE_LABELS[r.interview_type]} in ${b.company} Room` : TYPE_LABELS[r.interview_type],
    when: whenInfo(r.starts_at),
    duration: minutes && minutes > 0 ? `${minutes} minutes` : null,
    interviewerName: r.interviewer_name,
    joinUrl: link,
    location: r.location,
    roomCode: r.room_code,
    builtIn: Boolean(r.room_code),
    statusUrl: appLink(`/status?email=${encodeURIComponent(r.email)}&id=${r.application_id}`),
  });
}

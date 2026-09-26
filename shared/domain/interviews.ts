import type { Tone } from './pipeline.js';

export const MEETING_STATES = ['scheduled', 'ready', 'in_progress', 'ended', 'review_pending', 'reviewed'] as const;
export type MeetingState = (typeof MEETING_STATES)[number];

export const INTERVIEW_STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export type DisplayInterviewState = MeetingState | 'cancelled' | 'no_show';

export const INTERVIEW_STATE_LABELS: Record<DisplayInterviewState, string> = {
  scheduled: 'Scheduled',
  ready: 'Ready',
  in_progress: 'In progress',
  ended: 'Meeting ended',
  review_pending: 'Review pending',
  reviewed: 'Reviewed',
  cancelled: 'Cancelled',
  no_show: 'No show',
};

export const INTERVIEW_STATE_TONES: Record<DisplayInterviewState, Tone> = {
  scheduled: 'neutral',
  ready: 'info',
  in_progress: 'teal',
  ended: 'neutral',
  review_pending: 'warning',
  reviewed: 'success',
  cancelled: 'danger',
  no_show: 'danger',
};

export const MEETING_TYPES = ['screening', 'interview'] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const INTERVIEW_TYPES = ['phone', 'video', 'onsite', 'panel'] as const;
export type InterviewType = (typeof INTERVIEW_TYPES)[number];

export const RECOMMENDATIONS = {
  proceed: 'Proceed to next stage',
  offer: 'Proceed to offer',
  hold: 'Hold / keep warm',
  more_info: 'Needs another conversation',
  reject: 'Do not proceed',
} as const;
export type Recommendation = keyof typeof RECOMMENDATIONS;

export const CANDIDATE_REQUEST_STATES = ['none', 'waiting', 'requested', 'admitted'] as const;
export type CandidateRequestState = (typeof CANDIDATE_REQUEST_STATES)[number];

/** Scorecard criteria used by the live scorecard dock (ratings 1–5, per reviewer). */
export const SCORECARD_CRITERIA = [
  'Role knowledge',
  'Problem solving',
  'Communication',
  'Collaboration',
  'Culture add',
] as const;

export interface InterviewTiming {
  status: InterviewStatus;
  meeting_state: MeetingState;
  starts_at: string;
}

/**
 * The state to show. Cancelled and no-show override the lifecycle, and a
 * scheduled interview whose start time has passed reads as ready without a
 * background job moving it along.
 */
export function interviewDisplayState(row: InterviewTiming, now: Date = new Date()): DisplayInterviewState {
  if (row.status === 'cancelled') return 'cancelled';
  if (row.status === 'no_show') return 'no_show';
  if (row.meeting_state === 'scheduled' && new Date(row.starts_at).getTime() <= now.getTime()) return 'ready';
  return row.meeting_state;
}

/** Only from review_pending onward may a score be recorded. */
export function interviewAcceptsReview(row: InterviewTiming, now?: Date): boolean {
  const s = interviewDisplayState(row, now);
  return s === 'review_pending' || s === 'reviewed';
}

export function interviewIsOver(row: InterviewTiming, now?: Date): boolean {
  if (row.status === 'cancelled') return true;
  const s = interviewDisplayState(row, now);
  return s === 'ended' || s === 'review_pending' || s === 'reviewed';
}

export type CandidateJoinState =
  | 'not_available'
  | 'available'
  | 'interviewer_ready'
  | 'waiting'
  | 'requested'
  | 'admitted'
  | 'ended'
  | 'cancelled';

export interface JoinStateInput extends InterviewTiming {
  candidate_request_state: CandidateRequestState;
  interviewer_last_seen: string | null;
}

export interface JoinStateResult {
  canJoin: boolean;
  state: CandidateJoinState;
  message: string;
  opensAt: string;
}

export function interviewerIsPresent(lastSeen: string | null, presenceSeconds: number, now: Date = new Date()): boolean {
  if (!lastSeen) return false;
  return (now.getTime() - new Date(lastSeen).getTime()) / 1000 <= presenceSeconds;
}

/**
 * Can the candidate join, and what should the screen say?
 *   now >= starts_at - joinWindow   OR   interviewer present   → the door opens
 * Nothing closes it again until the interview ends or is cancelled.
 */
export function candidateJoinState(
  row: JoinStateInput,
  opts: { joinWindowMinutes: number; presenceSeconds: number; now?: Date; formatTime?: (iso: string) => string },
): JoinStateResult {
  const now = opts.now ?? new Date();
  const startsAt = new Date(row.starts_at);
  const opensAt = new Date(startsAt.getTime() - opts.joinWindowMinutes * 60_000).toISOString();
  const base = { opensAt };
  if (row.status === 'cancelled') {
    return { ...base, canJoin: false, state: 'cancelled', message: 'This interview was cancelled. Please contact the recruiter who scheduled it.' };
  }
  if (interviewIsOver(row, now)) return { ...base, canJoin: false, state: 'ended', message: 'This interview has ended.' };
  if (row.candidate_request_state === 'admitted') {
    return { ...base, canJoin: true, state: 'admitted', message: 'You have been admitted. Join when you are ready.' };
  }
  const timeOk = now.getTime() >= new Date(opensAt).getTime();
  const present = interviewerIsPresent(row.interviewer_last_seen, opts.presenceSeconds, now);
  if (!timeOk && !present) {
    const t = opts.formatTime ? opts.formatTime(row.starts_at) : startsAt.toISOString();
    return { ...base, canJoin: false, state: 'not_available', message: `Your interview starts at ${t}.` };
  }
  if (row.candidate_request_state === 'requested') {
    return { ...base, canJoin: true, state: 'requested', message: 'Your interviewer has received your request.' };
  }
  if (row.candidate_request_state === 'waiting') {
    return { ...base, canJoin: true, state: 'waiting', message: 'Waiting for your interviewer to arrive.' };
  }
  if (present) return { ...base, canJoin: true, state: 'interviewer_ready', message: 'Your interviewer is already in the meeting.' };
  return { ...base, canJoin: true, state: 'available', message: 'The interview room is ready.' };
}

export const JOIN_STATE_HEADLINES: Record<CandidateJoinState, string> = {
  not_available: 'Interview not available yet',
  available: 'Interview is ready',
  interviewer_ready: 'Your interviewer is ready',
  waiting: 'Waiting for your interviewer…',
  requested: 'Waiting for approval…',
  admitted: 'You have been admitted',
  ended: 'Interview ended',
  cancelled: 'Interview cancelled',
};

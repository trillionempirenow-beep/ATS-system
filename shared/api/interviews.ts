import { z } from 'zod';
import {
  INTERVIEW_STATUSES, INTERVIEW_TYPES, MEETING_TYPES, RECOMMENDATIONS,
  type CandidateJoinState, type CandidateRequestState, type DisplayInterviewState, type GuestState, type InterviewStatus, type InterviewType,
  type MeetingType, type Recommendation,
} from '../domain/interviews.js';
import type { Stage } from '../domain/pipeline.js';
import type { DeliveryReport } from './envelope.js';

export interface InterviewListItemDto {
  id: number;
  applicationId: number;
  candidateId: number;
  candidateName: string;
  candidateEmail: string;
  avatarUrl: string | null;
  jobTitle: string;
  meetingType: MeetingType;
  interviewType: InterviewType;
  startsAt: string;
  endsAt: string | null;
  interviewerId: number | null;
  interviewerName: string | null;
  status: InterviewStatus;
  state: DisplayInterviewState;
  builtInRoom: boolean;
  roomCode: string | null;
  meetingUrl: string | null;
  meetingProvider: string;
  location: string | null;
  score: number | null;
  recommendation: Recommendation | null;
  candidateWaiting: boolean;
  finalInterview: boolean;
}

export interface InterviewListDto {
  today: InterviewListItemDto[];
  upcoming: InterviewListItemDto[];
  past: InterviewListItemDto[];
  joinWindowMinutes: number;
  counts: { today: number; upcoming: number; awaitingReview: number; thisWeek: number };
}

export interface ScheduleOptionsDto {
  applications: Array<{ id: number; candidateName: string; jobTitle: string; stage: Stage }>;
  interviewers: Array<{ id: number; name: string; roleLabel: string; upcomingCount: number }>;
  busySlots: Array<{ interviewerId: number; startsAt: string }>;
  timezone: string;
}

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Choose a valid date and time.');

export const scheduleInterviewSchema = z
  .object({
    applicationId: z.number({ invalid_type_error: 'Please select an application.' }).int().positive('Please select an application.'),
    startsAt: isoDate,
    endsAt: isoDate.nullable().optional(),
    interviewType: z.enum(INTERVIEW_TYPES),
    meetingType: z.enum(MEETING_TYPES),
    interviewerId: z.number().int().positive().optional(),
    meetingMode: z.enum(['builtin', 'external']).default('builtin'),
    meetingUrl: z.string().trim().max(500).optional().default(''),
    meetingProvider: z.string().trim().max(80).optional().default(''),
    location: z.string().trim().max(255).optional().default(''),
    notes: z.string().trim().max(2000).optional().default(''),
    sendInvite: z.boolean().optional().default(true),
    /** Final interview: moves the candidate to the Final interview stage; in the built-in room it also issues a guest link. */
    finalInterview: z.boolean().optional().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.finalInterview && v.meetingType !== 'interview') {
      ctx.addIssue({ code: 'custom', path: ['finalInterview'], message: 'Screenings cannot be final interviews.' });
    }
    if (v.endsAt && Date.parse(v.endsAt) <= Date.parse(v.startsAt)) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'The end time must be after the start time.' });
    if (v.meetingMode === 'external' && v.meetingUrl && !/^https?:\/\//i.test(v.meetingUrl)) {
      ctx.addIssue({ code: 'custom', path: ['meetingUrl'], message: 'Use a full meeting link starting with https://' });
    }
    if (v.interviewType === 'onsite' && !v.location) ctx.addIssue({ code: 'custom', path: ['location'], message: 'Add the address for an onsite interview.' });
  });
export type ScheduleInterviewInput = z.input<typeof scheduleInterviewSchema>;

export const updateInterviewSchema = z.object({
  startsAt: isoDate.optional(),
  endsAt: isoDate.nullable().optional(),
  interviewerId: z.number().int().positive().optional(),
  interviewType: z.enum(INTERVIEW_TYPES).optional(),
  location: z.string().trim().max(255).optional(),
  status: z.enum(INTERVIEW_STATUSES).optional(),
  notifyCandidate: z.boolean().optional().default(true),
});
export type UpdateInterviewInput = z.input<typeof updateInterviewSchema>;

export interface ScheduleResultDto extends DeliveryReport {
  interviewId: number;
  roomCode: string | null;
  candidateLink: string | null;
  guestLink: string | null;
}

export const liveNotesSchema = z.object({ liveNotes: z.string().max(20000) });
export const endMeetingSchema = z.object({ liveNotes: z.string().max(20000).optional() });

export const reviewSchema = z.object({
  score: z.number().int().min(1, 'Score is between 1 and 100.').max(100, 'Score is between 1 and 100.').nullable(),
  review: z.string().trim().max(10000).default(''),
  recommendation: z.enum(Object.keys(RECOMMENDATIONS) as [Recommendation, ...Recommendation[]]).nullable(),
});
export type ReviewInput = z.input<typeof reviewSchema>;

export const scorecardDraftSchema = z.object({
  ratings: z.record(z.string().max(60), z.number().int().min(1).max(5).nullable()),
});

export const momentSchema = z.object({ atSecond: z.number().int().min(0), label: z.string().trim().min(1).max(200) });
export const assistantToggleSchema = z.object({ enabled: z.boolean() });

/** About 30 seconds of the meeting's sound, recorded in the interviewer's browser. */
export const assistantChunkSchema = z.object({
  audio: z.string().min(100).max(900_000),
  audioMime: z.string().max(80),
  atSecond: z.number().int().min(0).max(86_400),
});

export interface AiNoteDto { atSecond: number; topic: string | null; text: string }

/** Written once when the meeting ends, from everything the AI heard. */
export interface AiSummary {
  summary: string;
  keyAnswers: Array<{ label: string; value: string }>;
  strengths: string[];
  concerns: string[];
  followUps: string[];
}

export interface RtcConfigDto {
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  /** Whether the TURN relay loaded, and why not; logged in the browser console. */
  turnStatus?: string;
}

export interface RealtimeGrantDto {
  driver: 'supabase' | 'local';
  room: string | null;
  staff: string | null;
  lobby: string | null;
  /** Team chat (hiring team and guests only); null for the candidate. */
  team: string | null;
}

export interface StaffRoomDto {
  interview: InterviewListItemDto & {
    liveNotes: string | null;
    notesUpdatedAt: string | null;
    feedback: string | null;
    startedAt: string | null;
    endedAt: string | null;
    reviewedAt: string | null;
    reviewerName: string | null;
    notes: string | null;
    acceptsReview: boolean;
    candidateRequestState: CandidateRequestState;
    candidateRequestedAt: string | null;
    candidatePresent: boolean;
    assistantEnabled: boolean;
    stage: Stage;
  };
  me: { id: number; name: string };
  scorecard: { criteria: string[]; myRatings: Record<string, number | null> };
  moments: Array<{ id: number; atSecond: number; label: string; author: string | null }>;
  /** AI notes: only the interviewer gets them (canUse); everyone else sees an empty list. */
  assistant: { configured: boolean; enabled: boolean; canUse: boolean; notes: AiNoteDto[] };
  /** The AI's summary of the meeting, once it has ended. */
  aiSummary: AiSummary | null;
  rtc: RtcConfigDto;
  realtime: RealtimeGrantDto;
  presenceSeconds: number;
  /** Final interviews only: the shareable guest link (staff only) and who has been let in. */
  guests: { link: string | null; admitted: GuestDto[] };
}

/** A guest as the hosts see them: what they typed on the entry page, verified by the server. */
export interface GuestDto {
  id: number;
  /** The id the guest uses in the call ("g12"), to match video tiles to this record. */
  peerId: string;
  name: string;
  position: string;
}

export interface GuestRequestDto extends GuestDto {
  since: string;
}

export interface PresenceResultDto {
  pendingRequest: { state: 'waiting' | 'requested'; since: string | null; name: string; avatarUrl: string | null } | null;
  candidatePresent: boolean;
  meetingState: DisplayInterviewState;
  /** Guests on the entry page right now, oldest first. */
  guestRequests: GuestRequestDto[];
  admittedGuests: GuestDto[];
  /** When the meeting started (first host arrived); the call timer counts from here. */
  startedAt: string | null;
}

export const guestDecisionSchema = z.object({ decision: z.enum(['admit', 'deny']) });

// ---- Guest entry (public, guest link) --------------------------------------
const guestText = (label: string) => z.string().trim()
  .min(1, `Please enter your ${label}.`).max(120, `Keep your ${label} under 120 characters.`)
  // Printable text only: these values are shown to everyone in the call.
  .refine((v) => !/[\p{Cc}<>]/u.test(v), `Remove unusual characters from your ${label}.`);

export const guestJoinSchema = z.object({
  g: z.string().regex(/^[a-f0-9]{32}$/i),
  name: guestText('full name'),
  position: guestText('position or job title'),
});
export type GuestJoinInput = z.input<typeof guestJoinSchema>;

export const guestSessionSchema = z.object({
  g: z.string().regex(/^[a-f0-9]{32}$/i),
  key: z.string().regex(/^[a-f0-9]{48}$/i),
});

/** The public entry page. Deliberately thin: no candidate details, notes or scores. */
export interface GuestRoomDto {
  interviewId: number;
  companyName: string;
  jobTitle: string;
  startsAt: string;
  endsAt: string | null;
  roomCode: string;
  canJoin: boolean;
  ended: boolean;
  cancelled: boolean;
  message: string;
  opensAt: string;
}

/** One guest's own session: their request, and the call once a host admits them. */
export interface GuestSessionDto extends GuestRoomDto {
  guest: GuestDto & { key: string; state: GuestState };
  realtime: RealtimeGrantDto;
  rtc: RtcConfigDto | null;
  /** When the meeting started; the call timer counts from here for everyone. */
  startedAt: string | null;
  /** The interviewer has AI notes on: the room shows a notice while it is. */
  aiNotesOn: boolean;
}

export interface CandidateRoomDto {
  valid: true;
  interviewId: number;
  jobTitle: string;
  companyName: string;
  meetingType: MeetingType;
  interviewType: InterviewType;
  interviewerName: string | null;
  candidateName: string;
  startsAt: string;
  endsAt: string | null;
  roomCode: string;
  joinWindowMinutes: number;
  joinState: CandidateJoinState;
  canJoin: boolean;
  message: string;
  opensAt: string;
  requestState: CandidateRequestState;
  interviewerPresent: boolean;
  ended: boolean;
  serverTime: string;
  realtime: RealtimeGrantDto;
  rtc: RtcConfigDto | null;
  /** When the meeting started; the call timer counts from here for everyone. */
  startedAt: string | null;
  /** The interviewer has AI notes on: the room shows a notice while it is. */
  aiNotesOn: boolean;
}

export interface LiveMeetingDto {
  interviewId: number;
  jobTitle: string;
  candidateName: string;
}

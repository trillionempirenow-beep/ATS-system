import { z } from 'zod';
import {
  INTERVIEW_STATUSES, INTERVIEW_TYPES, MEETING_TYPES, RECOMMENDATIONS,
  type CandidateJoinState, type CandidateRequestState, type DisplayInterviewState, type InterviewStatus, type InterviewType,
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
  })
  .superRefine((v, ctx) => {
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

export interface RtcConfigDto {
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
}

export interface RealtimeGrantDto {
  driver: 'supabase' | 'local';
  room: string | null;
  staff: string | null;
  lobby: string | null;
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
  assistant: { configured: boolean; enabled: boolean; notes: Array<{ atSecond: number; topic: string | null; text: string }> };
  rtc: RtcConfigDto;
  realtime: RealtimeGrantDto;
  presenceSeconds: number;
}

export interface PresenceResultDto {
  pendingRequest: { state: 'waiting' | 'requested'; since: string | null; name: string; avatarUrl: string | null } | null;
  candidatePresent: boolean;
  meetingState: DisplayInterviewState;
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
}

export interface LiveMeetingDto {
  interviewId: number;
  jobTitle: string;
  candidateName: string;
}

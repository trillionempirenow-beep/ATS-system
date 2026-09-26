import { z } from 'zod';
import { RANGE_KEYS, type RangeKey } from '../domain/people.js';
import type { Stage } from '../domain/pipeline.js';
import type { InterviewType, MeetingType } from '../domain/interviews.js';
import type { AccountStatus, Role } from '../domain/access.js';

export interface DashboardDto {
  stats: {
    openRoles: { value: number; delta: number };
    activeCandidates: { value: number; delta: number };
    interviewsThisWeek: { value: number };
    hiredThisMonth: { value: number };
    applicationsThisWeek: { value: number; delta: number };
  };
  trend: Array<{ date: string; count: number }>;
  funnel: Array<{ stage: Stage; count: number }>;
  upcoming: Array<{ id: number; startsAt: string; candidateName: string; avatarUrl: string | null; jobTitle: string; meetingType: MeetingType; interviewType: InterviewType; state: string }>;
  recent: Array<{ applicationId: number; candidateName: string; email: string; avatarUrl: string | null; jobTitle: string; stage: Stage; updatedAt: string }>;
  jobsToReview: Array<{ id: number; title: string; department: string | null; applications: number; state: string }>;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const analyticsQuerySchema = z.object({
  range: z.enum(RANGE_KEYS).default('month'),
  from: date.optional(),
  to: date.optional(),
  user: z.coerce.number().int().positive().optional(),
  view: z.enum(['team', 'me']).optional(),
});

export interface CandidateMetrics {
  assigned: number; processing: number; shortlisted: number; contacted: number; inInterview: number; offer: number; hired: number; rejected: number; withdrawn: number;
}
export interface InterviewMetrics {
  total: number; upcoming: number; completed: number; cancelled: number; inProgress: number; awaitingReview: number; reviewed: number; avgScore: number | null; scored: number;
}

export interface PersonalAnalyticsDto {
  mode: 'personal';
  range: { key: RangeKey; label: string; from: string | null; to: string | null };
  subject: { id: number; name: string; role: Role; isMe: boolean };
  candidates: CandidateMetrics;
  funnel: Array<{ label: string; count: number }>;
  interviews: InterviewMetrics;
  outcomes: { progressed: number; notProgressed: number };
  timeline: Array<{ label: string; total: number }>;
  activity: Array<{ id: number; text: string; createdAt: string }>;
  timeToHireDays: number | null;
  offerAcceptance: { rate: number; hired: number; declined: number; pending: number } | null;
  hasData: boolean;
  team: Array<{ id: number; name: string }>;
}

export interface TeamRow {
  user: { id: number; name: string; email: string; role: Role; accountStatus: AccountStatus };
  candidates: number; processing: number; interviews: number; completed: number; hired: number; rejected: number; avgScore: number | null;
}

export interface TeamAnalyticsDto {
  mode: 'team';
  range: PersonalAnalyticsDto['range'];
  rows: TeamRow[];
  totals: { candidates: number; processing: number; interviews: number; completed: number; hired: number; rejected: number };
  members: { active: number; inactive: number; total: number };
  hasData: boolean;
}

export type AnalyticsDto = PersonalAnalyticsDto | TeamAnalyticsDto;

export interface ReportDto {
  range: PersonalAnalyticsDto['range'];
  rows: TeamRow[];
  totals: TeamAnalyticsDto['totals'];
  allMembers: Array<{ id: number; name: string }>;
}

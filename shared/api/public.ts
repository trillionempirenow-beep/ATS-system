import { z } from 'zod';
import { APPLY_SOURCES, type Stage } from '../domain/pipeline.js';
import type { EmploymentType } from '../domain/jobs.js';
import type { CandidateJoinState, DisplayInterviewState, InterviewType, MeetingType } from '../domain/interviews.js';

export interface PublicConfigDto {
  companyName: string;
  careersHeadline: string;
  logoUrl: string | null;
  acceptingApplications: boolean;
  closedMessage: string;
}

export interface PublicJobCardDto {
  id: number;
  slug: string;
  title: string;
  department: string | null;
  location: string | null;
  employmentType: EmploymentType;
  tags: string[];
  isUrgent: boolean;
  applications: number;
  applicantLimit: number | null;
  spotsRemaining: number | null;
  full: boolean;
  postedAt: string;
}

export interface PublicJobDetailDto extends PublicJobCardDto {
  description: string | null;
  responsibilities: string[];
  requirements: string[];
  qualifications: string[];
  preferredSkills: string[];
  experienceRequired: string | null;
  educationRequired: string | null;
  salaryInfo: string | null;
  related: PublicJobCardDto[];
  acceptingApplications: boolean;
  closedReason: string | null;
}

export interface PublicHomeDto {
  urgent: PublicJobCardDto[];
  featured: PublicJobCardDto[];
  stats: { openRoles: number; departmentsHiring: number; remoteRoles: number };
}

export interface PublicJobsDto {
  jobs: PublicJobCardDto[];
  facets: { departments: string[]; locations: string[]; tags: string[] };
  total: number;
}

export const publicJobsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  dept: z.string().trim().max(120).optional(),
  loc: z.string().trim().max(160).optional(),
  tag: z.string().trim().max(60).optional(),
  urgent: z.enum(['1']).optional(),
});

const sourceKeys = Object.keys(APPLY_SOURCES) as [keyof typeof APPLY_SOURCES, ...Array<keyof typeof APPLY_SOURCES>];

export const applyFieldsSchema = z.object({
    name: z.string().trim().min(1, 'Please enter your full name.').max(160),
    email: z.string().trim().email('Please enter a valid email address.').transform((v) => v.toLowerCase()),
    phoneCountry: z.string().length(2).default('PH'),
    phoneNumber: z.string().trim().max(30).optional().default(''),
    coverLetter: z.string().trim().min(1, 'Please tell us about yourself.').max(8000),
    whyUs: z.string().trim().min(1, 'Please tell us why you want to work here.').max(4000),
    source: z.enum(sourceKeys, { errorMap: () => ({ message: 'Please tell us how you heard about us.' }) }),
    sourceOther: z.string().trim().max(70).optional().default(''),
    portfolio: z.string().trim().max(255).optional().default(''),
    confirm: z.literal(true, { errorMap: () => ({ message: 'Please confirm your details are accurate before submitting.' }) }),
    resumeUploadId: z.string().uuid({ message: 'Please attach your resume.' }),
    photoUploadId: z.string().uuid().optional().nullable(),
  });

/** Cross-field rules shared by the API and the form. */
export function refineApply(v: { source?: string; sourceOther?: string; portfolio?: string; phoneNumber?: string }, ctx: z.RefinementCtx): void {
    if (v.source === 'other' && !v.sourceOther) {
      ctx.addIssue({ code: 'custom', path: ['sourceOther'], message: 'Please tell us how you heard about us.' });
    }
    if (v.portfolio && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v.portfolio)) {
      ctx.addIssue({ code: 'custom', path: ['portfolio'], message: 'Please enter a valid portfolio URL, e.g. https://yourportfolio.com' });
    }
    if (v.phoneNumber) {
      const digits = v.phoneNumber.replace(/\D/g, '');
      if (digits.length < 6 || digits.length > 14) ctx.addIssue({ code: 'custom', path: ['phoneNumber'], message: 'Please enter a valid phone number.' });
    }
}

export const applySchema = applyFieldsSchema.superRefine(refineApply);
export type ApplyInput = z.input<typeof applySchema>;

export interface ApplyResultDto {
  applicationId: number;
  email: string;
  jobTitle: string;
  confirmationEmail: 'sent' | 'skipped' | 'failed' | 'not_configured' | 'duplicate';
}

export const statusLookupSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.').transform((v) => v.toLowerCase()),
  applicationId: z.coerce.number().int().positive().optional(),
});
export type StatusLookupInput = z.input<typeof statusLookupSchema>;

export const withdrawSchema = z.object({
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
  applicationId: z.number().int().positive(),
});

export interface CandidateInterviewDto {
  id: number;
  meetingType: MeetingType;
  interviewType: InterviewType;
  startsAt: string;
  endsAt: string | null;
  interviewerName: string | null;
  state: DisplayInterviewState;
  location: string | null;
  externalUrl: string | null;
  room: { url: string; joinState: CandidateJoinState; canJoin: boolean; message: string; roomCode: string } | null;
}

export interface ApplicationStatusDto {
  id: number;
  stage: Stage;
  stageLabel: string;
  withdrawn: boolean;
  rejected: boolean;
  jobTitle: string;
  jobDepartment: string | null;
  jobLocation: string | null;
  firstName: string;
  lastName: string;
  appliedAt: string;
  updatedAt: string;
  timeline: Array<{ key: Stage; label: string; reached: boolean; current: boolean }>;
  feedback: { fit: string; notes: string | null } | null;
  /** Other roles the hiring team suggested, newest first. `slug` is null once the role closes. */
  /** Roles that could suit the applicant: from the hiring team, or from the one-time AI match (fromAi). */
  suggestions: Array<{ title: string; slug: string | null; note: string | null; alreadyApplied: boolean; fromAi: boolean }>;
  /** What the applicant sent. Cover letter and answer belong to this application; the rest is their current record. */
  submission: { coverLetter: string | null; whyUs: string | null; portfolio: string | null; source: string | null; resumeName: string | null };
  interviews: CandidateInterviewDto[];
  events: Array<{ key: string; title: string; note: string | null; at: string }>;
}

export type StatusLookupDto =
  | { kind: 'application'; application: ApplicationStatusDto }
  | { kind: 'list'; applications: Array<{ id: number; stage: Stage; stageLabel: string; jobTitle: string; appliedAt: string; withdrawn: boolean }> };

export const referralSchema = z.object({
  referrerName: z.string().trim().min(1, 'Please enter your name.').max(120),
  referrerEmail: z.string().trim().email('Please enter a valid email address.').transform((v) => v.toLowerCase()),
  candidateName: z.string().trim().min(1, "Please enter your friend's name.").max(120),
  candidateEmail: z.string().trim().email('Please enter a valid email address.').transform((v) => v.toLowerCase()),
  jobId: z.number().int().positive().nullable().optional(),
  note: z.string().trim().max(2000).optional().default(''),
});
export type ReferralInput = z.input<typeof referralSchema>;

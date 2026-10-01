import type { Stage } from '../domain/pipeline.js';
import { z } from 'zod';
import { EMPLOYMENT_TYPES, JOB_STATUSES, type ApprovalStatus, type EmploymentType, type JobApprovalAction, type JobState, type JobStatus } from '../domain/jobs.js';

export interface JobRowDto {
  id: number;
  title: string;
  slug: string;
  department: string | null;
  departmentId: number | null;
  location: string | null;
  employmentType: EmploymentType;
  tags: string[];
  applicantLimit: number | null;
  isUrgent: boolean;
  status: JobStatus;
  approvalStatus: ApprovalStatus;
  state: JobState;
  applications: number;
  creatorName: string | null;
  reviewerName: string | null;
  reviewNote: string | null;
  createdAt: string;
  publishedAt: string | null;
  submittedAt: string | null;
  canEdit: boolean;
  /** Created or owned by the person looking. */
  mine: boolean;
}

export interface JobsOverviewDto {
  jobs: JobRowDto[];
  departments: Array<{ id: number; name: string; description: string | null; jobCount: number }>;
  counts: { pendingApprovals: number; applications: number; upcomingInterviews: number };
  canPublish: boolean;
}

export interface MyJobsDto {
  jobs: JobRowDto[];
  byState: Partial<Record<JobState, number>>;
  canPost: boolean;
}

/** The job's own page in the workspace: the posting, who has applied, and who else would fit. */
export interface JobViewDto {
  job: NonNullable<JobEditorDto['job']>;
  applicants: Array<{ applicationId: number; candidateId: number; name: string; stage: Stage; appliedAt: string; aiScore: number | null }>;
  /** Registered applicants the AI found a real connection to this job, best first, with their score. */
  matches: Array<{
    candidateId: number; applicationId: number | null; name: string; currentTitle: string | null;
    score: number; reason: string; matched: string[]; missing: string[]; appliedHere: boolean;
  }>;
  /** When the last scoring against all applicants finished; null if never. */
  matchedAt: string | null;
  /** A run is in progress (it takes up to a minute). */
  matchingNow: boolean;
  /** Why the last run failed, or partly failed. */
  matchingError: string | null;
  /** Applicants the last run scored (all of them, not only the 60%+ shown). */
  scored: number;
  matchingEnabled: boolean;
}

export interface JobEditorDto {
  job: (JobRowDto & {
    description: string | null;
    responsibilities: string | null;
    qualifications: string | null;
    requirements: string | null;
    preferredSkills: string | null;
    experienceRequired: string | null;
    educationRequired: string | null;
    salaryInfo: string | null;
    sourcePdf: boolean;
    tagsRaw: string;
  }) | null;
  history: ApprovalEventDto[];
  departments: Array<{ id: number; name: string }>;
  canPublish: boolean;
  defaultApplicantLimit: number | null;
}

export interface ApprovalEventDto {
  id: number;
  action: JobApprovalAction;
  note: string | null;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
}

const optionalLimit = z
  .union([z.number().int().min(0), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const jobFieldsSchema = z.object({
  title: z.string().trim().min(1, 'A job title is required.').max(180),
  departmentId: z.number({ invalid_type_error: 'Please choose a department.' }).int().positive('Please choose a department.'),
  location: z.string().trim().max(160).default(''),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('full_time'),
  description: z.string().trim().max(20000).default(''),
  responsibilities: z.string().trim().max(10000).default(''),
  qualifications: z.string().trim().max(10000).default(''),
  requirements: z.string().trim().max(10000).default(''),
  preferredSkills: z.string().trim().max(10000).default(''),
  experienceRequired: z.string().trim().max(255).default(''),
  educationRequired: z.string().trim().max(255).default(''),
  salaryInfo: z.string().trim().max(255).default(''),
  tags: z.string().trim().max(255).default(''),
  applicantLimit: optionalLimit,
  isUrgent: z.boolean().default(false),
  sourcePdfPath: z.string().regex(/^job-descriptions\/[0-9a-f-]{36}\.pdf$/).nullable().optional(),
});
export type JobFieldsInput = z.input<typeof jobFieldsSchema>;

export const saveJobSchema = jobFieldsSchema.extend({ action: z.enum(['save_draft', 'submit', 'publish']) });
export type SaveJobInput = z.input<typeof saveJobSchema>;

export const jobStatusSchema = z.object({ status: z.enum(JOB_STATUSES) });
export const quickEditSchema = z.object({
  tags: z.string().trim().max(255).optional(),
  applicantLimit: optionalLimit,
  description: z.string().trim().max(20000).optional(),
  requirements: z.string().trim().max(10000).optional(),
  isUrgent: z.boolean().optional(),
});
export const departmentSchema = z.object({
  name: z.string().trim().min(1, 'Name the department.').max(120),
  description: z.string().trim().max(500).default(''),
});
export const extractPdfSchema = z.object({ uploadId: z.string().uuid() });

export interface ExtractPdfResultDto {
  ok: boolean;
  message: string | null;
  qualityWarning: string | null;
  sourcePdfPath: string;
  fields: {
    title: string; departmentId: number | null; departmentText: string; location: string; employmentType: EmploymentType;
    description: string; responsibilities: string; qualifications: string; requirements: string; preferredSkills: string;
    experienceRequired: string; educationRequired: string; salaryInfo: string; tags: string;
  } | null;
}

export const approvalDecisionSchema = z
  .object({
    decision: z.enum(['approve_publish', 'approve_only', 'reject', 'request_changes']),
    note: z.string().trim().max(2000).default(''),
  })
  .superRefine((v, ctx) => {
    if (v.decision === 'reject' && !v.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'A reason is required when rejecting a job posting.' });
    if (v.decision === 'request_changes' && !v.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Please say what needs to change.' });
  });
export type ApprovalDecisionInput = z.input<typeof approvalDecisionSchema>;

export interface ApprovalQueueDto {
  queue: Array<JobRowDto & { submitterName: string | null }>;
  decided: Array<JobRowDto & { reviewedAt: string | null }>;
}

export interface ApprovalDetailDto {
  job: NonNullable<JobEditorDto['job']> & { submitterName: string | null; creatorEmail: string | null };
  history: ApprovalEventDto[];
}

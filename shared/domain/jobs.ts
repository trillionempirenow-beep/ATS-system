import type { Tone } from './pipeline.js';

export const JOB_STATUSES = ['draft', 'open', 'paused', 'closed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const APPROVAL_STATUSES = ['none', 'draft', 'pending', 'approved', 'rejected', 'changes_requested'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'internship'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
};

export type JobState = 'draft' | 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'published' | 'paused' | 'closed';

export const JOB_STATE_LABELS: Record<JobState, string> = {
  draft: 'Draft',
  pending: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
  published: 'Published',
  paused: 'Paused',
  closed: 'Closed',
};

export const JOB_STATE_TONES: Record<JobState, Tone> = {
  draft: 'neutral',
  pending: 'warning',
  approved: 'info',
  rejected: 'danger',
  changes_requested: 'purple',
  published: 'success',
  paused: 'neutral',
  closed: 'neutral',
};

/** status='open' is the only public state; everything else folds in approval_status. */
export function jobState(job: { status: JobStatus; approval_status: ApprovalStatus }): JobState {
  if (job.status === 'open') return 'published';
  if (job.status === 'closed') return 'closed';
  if (job.status === 'paused') return 'paused';
  if (job.approval_status === 'none') return 'draft';
  return job.approval_status;
}

export const JOB_APPROVAL_ACTIONS = ['submitted', 'approved', 'rejected', 'changes_requested', 'published', 'resubmitted', 'withdrawn'] as const;
export type JobApprovalAction = (typeof JOB_APPROVAL_ACTIONS)[number];

export const JOB_APPROVAL_ACTION_LABELS: Record<JobApprovalAction, string> = {
  submitted: 'Submitted for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
  published: 'Published',
  resubmitted: 'Resubmitted',
  withdrawn: 'Withdrawn',
};

/** Split "a,b,c" into at most six trimmed, de-duplicated tags. */
export function jobTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const t of raw.split(',').map((s) => s.trim())) {
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 6);
}

export function spotsRemaining(limit: number | null, applications: number): number | null {
  if (limit === null) return null;
  return Math.max(0, limit - applications);
}

export function splitLines(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim().replace(/^[-•*]\s*/, ''))
    .filter(Boolean);
}

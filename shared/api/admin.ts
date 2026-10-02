import { z } from 'zod';
import { ACCOUNT_STATUSES, PERMISSIONS, RECRUITER_PERMISSION_KEYS, type AccountStatus, type PermissionKey, type Role } from '../domain/access.js';
import type { JobState } from '../domain/jobs.js';
import type { ApplicationStatus, Stage } from '../domain/pipeline.js';

export interface AccountDto {
  id: number;
  name: string;
  email: string;
  role: Role;
  accountStatus: AccountStatus;
  permissions: PermissionKey[];
  jobTitle: string | null;
  avatarUrl: string | null;
  createdAt: string;
  createdByName: string | null;
  createdById: number | null;
  seatReleased: boolean;
  statusNote: string | null;
  hrAccountLimit: number;
  seatsUsed: number;
  canManage: boolean;
  openRequest: { id: number; reason: string | null; requestedBy: string | null; createdAt: string } | null;
}

export interface AdminsOverviewDto {
  admins: AccountDto[];
  stats: { pendingAccounts: number; pendingReactivations: number; seatsTotal: number; seatsUsed: number; jobs: Partial<Record<JobState, number>> };
  recentActivity: Array<{ id: number; action: string; note: string | null; jobTitle: string; actorName: string | null; createdAt: string }>;
}

const email = z.string().trim().email('That email address is not valid.').transform((v) => v.toLowerCase());
const tempPassword = z.string().min(8, 'The temporary password must be at least 8 characters.');

export const createAdminSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  email,
  password: tempPassword,
  hrAccountLimit: z.number().int().min(0).max(999).default(0),
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
});
export type CreateAdminInput = z.input<typeof createAdminSchema>;

export const adminPermissionsSchema = z.object({
  hrAccountLimit: z.number().int().min(0).max(999),
  permissions: z.array(z.enum(PERMISSIONS)),
});

export const accountStatusSchema = z.object({
  status: z.enum(['active', 'rejected', 'suspended', 'disabled']),
  note: z.string().trim().max(500).optional().default(''),
});

export interface HrAccountsDto {
  accounts: AccountDto[];
  iAmSuper: boolean;
  seats: { limit: number; used: number; available: number } | null;
  counts: Partial<Record<AccountStatus, number>>;
}

export const hrAccountsQuerySchema = z.object({ status: z.enum(ACCOUNT_STATUSES).optional() });

export const createHrSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  email,
  password: tempPassword,
  permissions: z.array(z.enum(RECRUITER_PERMISSION_KEYS)).default([]),
});
export type CreateHrInput = z.input<typeof createHrSchema>;

export const hrPermissionsSchema = z.object({ permissions: z.array(z.enum(RECRUITER_PERMISSION_KEYS)) });
export const reactivationSchema = z.object({ reason: z.string().trim().max(500).optional().default('') });
export const decisionSchema = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(500).optional().default('') });

export interface PasswordResetRowDto {
  id: number;
  userId: number;
  accountName: string;
  accountEmail: string;
  accountRole: Role;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'used' | 'expired';
  requestedIp: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  tokenExpiresAt: string | null;
}

export interface PasswordResetsDto {
  pending: PasswordResetRowDto[];
  decided: PasswordResetRowDto[];
  windowHours: number;
}

export interface ResetDecisionResultDto {
  status: 'approved' | 'rejected';
  /** Shown once to the Super Admin right after approval. */
  resetLink: string | null;
  expiresInHours: number | null;
  email: 'sent' | 'skipped' | 'failed' | 'not_configured' | 'duplicate';
}

export interface PortalOverviewDto {
  settings: { acceptingApplications: boolean; closedMessage: string; careersHeadline: string; defaultApplicantLimit: string };
  stats: { candidates: number; applications: number; active: number; withdrawn: number; newThisWeek: number };
  jobs: Array<{ id: number; title: string; department: string | null; status: string; approvalStatus: string; state: JobState; applications: number; applicantLimit: number | null }>;
  registrations: Array<{ id: number; name: string; email: string; source: string; applications: number; createdAt: string }>;
  recentApplications: Array<{ id: number; candidateName: string; email: string; jobTitle: string; stage: Stage; status: ApplicationStatus; appliedAt: string }>;
  canPublish: boolean;
}

export const portalSettingsSchema = z.object({
  acceptingApplications: z.boolean(),
  closedMessage: z.string().trim().max(500).default(''),
  careersHeadline: z.string().trim().max(160).default(''),
  defaultApplicantLimit: z.string().trim().regex(/^\d*$/, 'Use a whole number or leave blank.').default(''),
});
export const portalJobVisibilitySchema = z.object({ status: z.enum(['open', 'paused', 'closed']) });
export const portalApplicationStatusSchema = z.object({ status: z.enum(['active', 'withdrawn']) });

export const auditQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  user: z.coerce.number().int().positive().optional(),
  role: z.string().max(30).optional(),
  action: z.string().max(80).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type AuditCategory = 'security' | 'approval' | 'interview' | 'candidate' | 'job' | 'account' | 'system';

export interface AuditLogDto {
  rows: Array<{ id: number; action: string; category: AuditCategory; userName: string | null; userRole: Role | null; entityType: string | null; entityId: number | null; subject: string | null; detail: string; ip: string | null; createdAt: string }>;
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  stats: { total: number; today: number; actors: number; security: number };
  options: { users: Array<{ id: number; name: string }>; actions: string[] };
  ownOnly: boolean;
}

export interface SettingsDto {
  companyName: string;
  careersHeadline: string;
  logoPath: string;
  defaultApplicantLimit: string;
  interviewJoinWindowMinutes: number;
  passwordResetHours: number;
  interviewReminderMinutes: number;
  attendanceTimezone: string;
  attendanceGraceMinutes: number;
  recordingRetentionDays: number;
  iceServers: string;
  integrations: { email: string; n8n: boolean; storage: string; realtime: string };
}

export const settingsSchema = z.object({
  companyName: z.string().trim().min(1, 'Company name is required.').max(120),
  careersHeadline: z.string().trim().max(160).default(''),
  logoPath: z.string().trim().max(500).refine((v) => v === '' || /^https:\/\//.test(v) || /^\/?[\w\-./]+\.(png|jpg|jpeg|svg|webp)$/i.test(v), 'Use an https:// image URL or leave blank.').default(''),
  defaultApplicantLimit: z.string().trim().regex(/^\d*$/, 'Use a whole number or leave blank.').default(''),
  interviewJoinWindowMinutes: z.number().int().min(0).max(240),
  passwordResetHours: z.number().int().min(1).max(168),
  interviewReminderMinutes: z.number().int().min(5).max(1440),
  attendanceTimezone: z.string().trim().min(1).max(60),
  attendanceGraceMinutes: z.number().int().min(0).max(120),
  /** Meeting recordings are deleted this many days after the meeting. */
  recordingRetentionDays: z.number().int().min(1).max(3650).optional(),
  iceServers: z.string().trim().refine((v) => {
    try { const p = JSON.parse(v) as unknown; return Array.isArray(p) && p.every((s) => typeof s === 'object' && s !== null && 'urls' in s); } catch { return false; }
  }, 'Enter a JSON array such as [{"urls":"stun:stun.l.google.com:19302"}].'),
});
export type SettingsInput = z.input<typeof settingsSchema>;

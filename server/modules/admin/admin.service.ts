import type { z } from 'zod';
import { canPublishJobs, isAdminLevel, type Role } from '../../../shared/domain/access.js';
import { jobState, type ApprovalStatus, type JobStatus } from '../../../shared/domain/jobs.js';
import type { ApplicationStatus, Stage } from '../../../shared/domain/pipeline.js';
import { sourceLabel } from '../../../shared/domain/pipeline.js';
import type {
  AuditCategory, AuditLogDto, PasswordResetRowDto, PasswordResetsDto, PortalOverviewDto, ResetDecisionResultDto, SettingsDto,
  auditQuerySchema, decisionSchema, portalSettingsSchema, settingsSchema,
} from '../../../shared/api/admin.js';
import { env } from '../../config/env.js';
import { sql, transaction } from '../../db/client.js';
import { audit } from '../../core/audit.js';
import { notify } from '../../core/notifications.js';
import { getSettings, intSetting, setSettings } from '../../core/settings.js';
import type { CurrentUser } from '../../http/context.js';
import { conflict, forbidden, notFound } from '../../http/errors.js';
import { randomHex, sha256 } from '../../lib/crypto.js';
import { fullName, iso, isoOrThrow } from '../../lib/format.js';
import { sendEmail } from '../../email/email.service.js';
import { appLink, brand } from '../../email/brand.js';
import { passwordResetApproved, passwordResetRejected } from '../../email/templates/index.js';
import { setStatus as setJobStatus } from '../jobs/jobs.service.js';

type Ctx = { user: CurrentUser; ip: string | null };

// ---------------------------------------------------------------------------
// Password resets (Super Admin)
// ---------------------------------------------------------------------------

interface ResetRow {
  id: number; user_id: number; account_name: string; account_email: string; account_role: Role; reason: string | null;
  status: PasswordResetRowDto['status']; requested_ip: string | null; created_at: Date; decided_at: Date | null;
  decided_name: string | null; decision_note: string | null; token_expires_at: Date | null;
}
const toReset = (r: ResetRow): PasswordResetRowDto => ({
  id: r.id, userId: r.user_id, accountName: r.account_name, accountEmail: r.account_email, accountRole: r.account_role, reason: r.reason,
  status: r.status, requestedIp: r.requested_ip, createdAt: isoOrThrow(r.created_at), decidedAt: iso(r.decided_at), decidedBy: r.decided_name,
  decisionNote: r.decision_note, tokenExpiresAt: iso(r.token_expires_at),
});

export async function passwordResets(): Promise<PasswordResetsDto> {
  // Links past their expiry are closed out so the list reads truthfully.
  await sql`update password_reset_requests set status = 'expired', reset_token_hash = null where status = 'approved' and token_expires_at < now()`;
  const base = sql`
    select r.id, r.user_id, u.name as account_name, u.email::text as account_email, u.role as account_role, r.reason, r.status, r.requested_ip,
           r.created_at, r.decided_at, d.name as decided_name, r.decision_note, r.token_expires_at
    from password_reset_requests r join users u on u.id = r.user_id left join users d on d.id = r.decided_by`;
  const [pending, decided, s] = await Promise.all([
    sql<ResetRow[]>`${base} where r.status = 'pending' order by r.created_at asc`,
    sql<ResetRow[]>`${base} where r.status <> 'pending' order by coalesce(r.decided_at, r.created_at) desc limit 20`,
    getSettings(),
  ]);
  return { pending: pending.map(toReset), decided: decided.map(toReset), windowHours: intSetting(s.password_reset_hours, 24, 1) };
}

export async function decideReset(id: number, input: z.infer<typeof decisionSchema>, ctx: Ctx): Promise<ResetDecisionResultDto> {
  const s = await getSettings();
  const hours = intSetting(s.password_reset_hours, 24, 1);
  const note = input.note || null;
  const token = input.decision === 'approved' ? randomHex(32) : null;
  const req = await transaction(async (tx) => {
    const [r] = await tx<{ id: number; user_id: number; name: string; email: string }[]>`
      select r.id, r.user_id, u.name, u.email::text from password_reset_requests r join users u on u.id = r.user_id
      where r.id = ${id} and r.status = 'pending' for update of r`;
    if (!r) throw conflict('That request has already been decided.');
    if (token) {
      await tx`update password_reset_requests set status = 'approved', reset_token_hash = ${sha256(token)},
                 token_expires_at = now() + make_interval(hours => ${hours}), decided_by = ${ctx.user.id}, decided_at = now(), decision_note = ${note}
               where id = ${id}`;
      await audit({ userId: ctx.user.id, action: 'password_reset_approved', entityType: 'user', entityId: r.user_id, details: { account: r.name, expires_in: `${hours} hours`, note: note ?? '' }, ip: ctx.ip }, tx);
    } else {
      await tx`update password_reset_requests set status = 'rejected', reset_token_hash = null, token_expires_at = null, decided_by = ${ctx.user.id},
                 decided_at = now(), decision_note = ${note} where id = ${id}`;
      await audit({ userId: ctx.user.id, action: 'password_reset_rejected', entityType: 'user', entityId: r.user_id, details: { account: r.name, reason: note ?? '' }, ip: ctx.ip }, tx);
    }
    return r;
  });
  const b = await brand();
  if (token) {
    const link = appLink(`/reset-password/${token}`);
    const mail = await sendEmail({ key: `password-reset:${id}`, template: 'password-reset', to: req.email, email: passwordResetApproved(b, { name: req.name, resetUrl: link, hours }) });
    await notify({ userId: req.user_id, actorId: ctx.user.id, type: 'account', title: 'Your password reset was approved',
      body: 'A Super Admin approved your request. Use the secure link you were sent to set a new password.', link: '/login', actionLabel: 'Sign in' });
    return { status: 'approved', resetLink: link, expiresInHours: hours, email: mail.outcome };
  }
  const mail = await sendEmail({ key: `password-reset-rejected:${id}`, template: 'password-reset-rejected', to: req.email, email: passwordResetRejected(b, { name: req.name, note }) });
  await notify({ userId: req.user_id, actorId: ctx.user.id, type: 'account', title: 'Your password reset request was rejected',
    body: note ?? 'Your existing password is unchanged. Contact your Super Admin if you still need help.', link: '/login' });
  return { status: 'rejected', resetLink: null, expiresInHours: null, email: mail.outcome };
}

// ---------------------------------------------------------------------------
// Applicant portal (applicant_portal permission)
// ---------------------------------------------------------------------------

export async function portalOverview(user: CurrentUser): Promise<PortalOverviewDto> {
  const s = await getSettings();
  const [[stats], jobs, regs, recent] = await Promise.all([
    sql<{ candidates: number; applications: number; active: number; withdrawn: number; new_week: number }[]>`
      select (select count(*)::int from candidates) as candidates, (select count(*)::int from applications) as applications,
             (select count(*)::int from applications where status = 'active') as active, (select count(*)::int from applications where status = 'withdrawn') as withdrawn,
             (select count(*)::int from candidates where created_at >= now() - interval '7 days') as new_week`,
    sql<{ id: number; title: string; department: string | null; status: JobStatus; approval_status: ApprovalStatus; applications: number; applicant_limit: number | null }[]>`
      select j.id, j.title, d.name as department, j.status, j.approval_status, j.applicant_limit,
             (select count(*)::int from applications a where a.job_id = j.id) as applications
      from jobs j left join departments d on d.id = j.department_id
      where j.status in ('open','paused') or j.approval_status = 'approved'
      order by array_position(array['open','paused','draft','closed'], j.status), j.title`,
    sql<{ id: number; first_name: string; last_name: string; email: string; source: string; applications: number; created_at: Date }[]>`
      select c.id, c.first_name, c.last_name, c.email::text, c.source, (select count(*)::int from applications a where a.candidate_id = c.id) as applications, c.created_at
      from candidates c order by c.created_at desc limit 12`,
    sql<{ id: number; first_name: string; last_name: string; email: string; title: string; stage: Stage; status: ApplicationStatus; applied_at: Date }[]>`
      select a.id, c.first_name, c.last_name, c.email::text, j.title, a.stage, a.status, a.applied_at
      from applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id order by a.applied_at desc limit 12`,
  ]);
  return {
    settings: {
      acceptingApplications: s.portal_accepting_applications !== '0', closedMessage: s.portal_closed_message,
      careersHeadline: s.careers_headline, defaultApplicantLimit: s.default_applicant_limit,
    },
    stats: { candidates: stats!.candidates, applications: stats!.applications, active: stats!.active, withdrawn: stats!.withdrawn, newThisWeek: stats!.new_week },
    jobs: jobs.map((j) => ({ id: j.id, title: j.title, department: j.department, status: j.status, approvalStatus: j.approval_status, state: jobState(j), applications: j.applications, applicantLimit: j.applicant_limit })),
    registrations: regs.map((r) => ({ id: r.id, name: fullName(r.first_name, r.last_name), email: r.email, source: sourceLabel(r.source), applications: r.applications, createdAt: isoOrThrow(r.created_at) })),
    recentApplications: recent.map((r) => ({ id: r.id, candidateName: fullName(r.first_name, r.last_name), email: r.email, jobTitle: r.title, stage: r.stage, status: r.status, appliedAt: isoOrThrow(r.applied_at) })),
    canPublish: canPublishJobs(user),
  };
}

export async function savePortalSettings(input: z.infer<typeof portalSettingsSchema>, ctx: Ctx): Promise<void> {
  await setSettings(sql, {
    portal_accepting_applications: input.acceptingApplications ? '1' : '0',
    portal_closed_message: input.closedMessage,
    careers_headline: input.careersHeadline,
    default_applicant_limit: input.defaultApplicantLimit,
  });
  await audit({ userId: ctx.user.id, action: 'applicant_portal_settings', entityType: 'settings', details: { accepting_applications: input.acceptingApplications ? 'Yes' : 'No' }, ip: ctx.ip });
}

/** Making a role visible is a publish, so it goes through the same approval gate as Job management. */
export async function setPortalJobVisibility(id: number, status: 'open' | 'paused' | 'closed', ctx: Ctx): Promise<void> {
  const [job] = await sql<{ approval_status: ApprovalStatus }[]>`select approval_status from jobs where id = ${id}`;
  if (!job) throw notFound('That job no longer exists.');
  if (status === 'open' && !['approved', 'none'].includes(job.approval_status)) {
    throw conflict('That posting has not been approved yet. Approve it in Job approvals before making it visible.');
  }
  if (status === 'open' && !canPublishJobs(ctx.user)) throw forbidden('Publishing a role requires the "Job posting" permission.');
  await setJobStatus(id, { status }, ctx, 'Made visible from the applicant portal');
}

export async function setApplicationStatus(id: number, status: ApplicationStatus, ctx: Ctx): Promise<void> {
  const res = await sql`update applications set status = ${status}, updated_at = now() where id = ${id}`;
  if (!res.count) throw notFound('That application no longer exists.');
  await audit({ userId: ctx.user.id, action: 'application_status_change', entityType: 'application', entityId: id, details: { status }, ip: ctx.ip });
}

// ---------------------------------------------------------------------------
// Audit trail (audit_trail permission; a recruiter sees only their own activity)
// ---------------------------------------------------------------------------

const SECURITY_ACTIONS = ['password_changed', 'password_reset_requested', 'password_reset_approved', 'password_reset_rejected', 'password_reset_completed',
  'admin_permissions_update', 'hr_permissions_update', 'hr_account_status', 'hr_account_delete', 'reactivation_requested', 'reactivation_approved',
  'reactivation_rejected', 'seat_limit_changed', 'seat_released', 'admin_status_change', 'login_failed'];

export function auditCategory(action: string): AuditCategory {
  const groups: Array<[AuditCategory, string[]]> = [
    ['security', ['password', 'permission', 'reactivation', 'seat', 'status_change', 'account_status', 'admin_create', 'hr_account', 'login_failed']],
    ['approval', ['approve', 'reject', 'request_changes', 'submit_for_approval', 'decision']],
    ['interview', ['interview', 'meeting']],
    ['candidate', ['candidate', 'application', 'pipeline', 'stage', 'ai_analysis', 'document', 'referral']],
    ['job', ['job', 'department']],
    ['account', ['profile', 'user', 'admin', 'login', 'logout']],
  ];
  for (const [cat, needles] of groups) if (needles.some((n) => action.includes(n))) return cat;
  return 'system';
}

function auditDetail(details: Record<string, unknown> | null, entityType: string | null, entityId: number | null): string {
  if (details) {
    const bits = Object.entries(details)
      .filter(([, v]) => v !== '' && v !== null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
      .map(([k, v]) => `${k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}: ${String(v)}`);
    if (bits.length) return bits.join(' · ');
  }
  return entityType ? `${entityType.charAt(0).toUpperCase()}${entityType.slice(1)} #${entityId ?? ''}` : 'System activity';
}

const AUDIT_PAGE = 50;

type AuditQuery = z.infer<typeof auditQuerySchema>;

/** One filtered query for both the paged view and the CSV export. Non-admins only ever see their own events. */
async function queryAudit(q: AuditQuery, user: CurrentUser, limit: number, offset: number) {
  const ownOnly = !isAdminLevel(user);
  const like = q.q ? `%${q.q}%` : null;
  return sql<{ id: number; action: string; entity_type: string | null; entity_id: number | null; details: Record<string, unknown> | null; ip_address: string | null; created_at: Date; user_name: string | null; user_role: Role | null; first_name: string | null; last_name: string | null; job_title: string | null; total: number }[]>`
    select l.id, l.action, l.entity_type, l.entity_id, l.details, l.ip_address, l.created_at, u.name as user_name, u.role as user_role,
           c.first_name, c.last_name, j.title as job_title, count(*) over()::int as total
    from audit_logs l
    left join users u on u.id = l.user_id
    left join applications ap on l.entity_type = 'application' and l.entity_id = ap.id
    left join candidates c on (l.entity_type = 'candidate' and l.entity_id = c.id) or (l.entity_type = 'application' and ap.candidate_id = c.id)
    left join jobs j on (l.entity_type = 'job' and l.entity_id = j.id) or (l.entity_type = 'application' and ap.job_id = j.id)
    where true
      ${ownOnly ? sql`and l.user_id = ${user.id}` : sql``}
      ${like ? sql`and (l.action ilike ${like} or l.entity_type ilike ${like} or u.name ilike ${like} or c.first_name ilike ${like}
                        or c.last_name ilike ${like} or j.title ilike ${like} or l.details::text ilike ${like})` : sql``}
      ${q.user && !ownOnly ? sql`and l.user_id = ${q.user}` : sql``}
      ${q.role && !ownOnly ? sql`and u.role = ${q.role}` : sql``}
      ${q.action ? sql`and l.action = ${q.action}` : sql``}
      ${q.from ? sql`and l.created_at >= ${`${q.from}T00:00:00`}::timestamp at time zone ${env.APP_TIMEZONE}` : sql``}
      ${q.to ? sql`and l.created_at <= ${`${q.to}T23:59:59`}::timestamp at time zone ${env.APP_TIMEZONE}` : sql``}
    order by l.created_at desc
    limit ${limit} offset ${offset}`;
}

type AuditRow = Awaited<ReturnType<typeof queryAudit>>[number];
const toAuditRow = (r: AuditRow): AuditLogDto['rows'][number] => ({
  id: r.id, action: r.action, category: auditCategory(r.action), userName: r.user_name, userRole: r.user_role, entityType: r.entity_type, entityId: r.entity_id,
  subject: r.first_name ? fullName(r.first_name, r.last_name) : r.job_title, detail: auditDetail(r.details, r.entity_type, r.entity_id),
  ip: r.ip_address, createdAt: isoOrThrow(r.created_at),
});

export async function auditLog(q: AuditQuery, user: CurrentUser): Promise<AuditLogDto> {
  const ownOnly = !isAdminLevel(user);
  const rows = await queryAudit(q, user, AUDIT_PAGE, (q.page - 1) * AUDIT_PAGE);
  const scope = ownOnly ? sql`where user_id = ${user.id}` : sql`where true`;
  const [[stats], users, actions] = await Promise.all([
    sql<{ total: number; today: number; actors: number; security: number }[]>`
      select count(*)::int as total,
             count(*) filter (where created_at >= date_trunc('day', now() at time zone ${env.APP_TIMEZONE}) at time zone ${env.APP_TIMEZONE})::int as today,
             count(distinct user_id)::int as actors,
             count(*) filter (where action in ${sql(SECURITY_ACTIONS)})::int as security
      from audit_logs ${scope}`,
    ownOnly ? Promise.resolve([]) : sql<{ id: number; name: string }[]>`select id, name from users order by name`,
    sql<{ action: string }[]>`select distinct action from audit_logs ${scope} order by action`,
  ]);
  const total = rows[0]?.total ?? 0;
  return {
    rows: rows.map(toAuditRow),
    total, page: q.page, pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE)), pageSize: AUDIT_PAGE,
    stats: stats ?? { total: 0, today: 0, actors: 0, security: 0 },
    options: { users, actions: actions.map((a) => a.action) },
    ownOnly,
  };
}

const AUDIT_EXPORT_LIMIT = 10_000;

export async function auditCsv(q: AuditQuery, user: CurrentUser): Promise<string> {
  const rows = (await queryAudit(q, user, AUDIT_EXPORT_LIMIT, 0)).map(toAuditRow);
  const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [['Date/time', 'User', 'Role', 'Action', 'Related', 'Subject', 'Details', 'IP address']];
  for (const r of rows) {
    lines.push([r.createdAt, r.userName ?? '', r.userRole ?? '', r.action, r.entityType && r.entityId ? `${r.entityType} #${r.entityId}` : '', r.subject ?? '', r.detail, r.ip ?? '']);
  }
  return lines.map((l) => l.map(cell).join(',')).join('\r\n');
}

// ---------------------------------------------------------------------------
// Settings (Admin-level)
// ---------------------------------------------------------------------------

export async function settings(): Promise<SettingsDto> {
  const s = await getSettings();
  return {
    companyName: s.company_name,
    careersHeadline: s.careers_headline,
    logoPath: s.logo_path,
    defaultApplicantLimit: s.default_applicant_limit,
    interviewJoinWindowMinutes: intSetting(s.interview_join_window_minutes, 15),
    passwordResetHours: intSetting(s.password_reset_hours, 24, 1),
    interviewReminderMinutes: intSetting(s.interview_reminder_minutes, 60, 5),
    attendanceTimezone: s.attendance_timezone,
    attendanceGraceMinutes: intSetting(s.attendance_grace_minutes, 10),
    recordingRetentionDays: intSetting(s.recording_retention_days, 90, 1),
    iceServers: s.ice_servers,
    integrations: { email: env.EMAIL_PROVIDER, n8n: env.N8N_ENABLED && Boolean(env.N8N_WEBHOOK_URL), storage: env.STORAGE_DRIVER, realtime: env.REALTIME_DRIVER },
  };
}

export async function saveSettings(input: z.infer<typeof settingsSchema>, ctx: Ctx): Promise<void> {
  const before = await getSettings();
  const patch = {
    company_name: input.companyName,
    careers_headline: input.careersHeadline,
    logo_path: input.logoPath,
    default_applicant_limit: input.defaultApplicantLimit,
    interview_join_window_minutes: String(input.interviewJoinWindowMinutes),
    password_reset_hours: String(input.passwordResetHours),
    interview_reminder_minutes: String(input.interviewReminderMinutes),
    attendance_timezone: input.attendanceTimezone,
    attendance_grace_minutes: String(input.attendanceGraceMinutes),
    ...(input.recordingRetentionDays !== undefined ? { recording_retention_days: String(input.recordingRetentionDays) } : {}),
    ice_servers: JSON.stringify(JSON.parse(input.iceServers)),
  };
  await setSettings(sql, patch);
  const changed = Object.entries(patch).filter(([k, v]) => before[k as keyof typeof before] !== v).map(([k]) => k.replace(/_/g, ' '));
  await audit({ userId: ctx.user.id, action: 'settings_update', entityType: 'settings', details: { changed: changed.join(', ') || 'nothing' }, ip: ctx.ip });
}

import type { z } from 'zod';
import { canPublishJobs, hasPermission, isAdminLevel } from '../../../shared/domain/access.js';
import { jobState, jobTags } from '../../../shared/domain/jobs.js';
import type {
  ApprovalDetailDto, ApprovalEventDto, ApprovalQueueDto, ExtractPdfResultDto, JobEditorDto, JobRowDto, JobsOverviewDto, MyJobsDto,
  approvalDecisionSchema, departmentSchema, jobStatusSchema, quickEditSchema, saveJobSchema,
} from '../../../shared/api/jobs.js';
import { sql, transaction } from '../../db/client.js';
import { audit } from '../../core/audit.js';
import { jobReviewerIds, notify, notifyMany } from '../../core/notifications.js';
import { getSettings, intSetting } from '../../core/settings.js';
import type { CurrentUser } from '../../http/context.js';
import { AppError, conflict, forbidden, isUniqueViolation, notFound, validationFailed } from '../../http/errors.js';
import { iso, isoOrThrow } from '../../lib/format.js';
import { emitN8nEvent } from '../../integrations/n8n/n8n.client.js';
import { extractPdfText } from '../../parsers/text-extract.js';
import { parseJobDescription, skillsToTags } from '../../parsers/jd-parser.js';
import { consumeUpload } from '../uploads/uploads.service.js';
import * as repo from './jobs.repository.js';

type Ctx = { user: CurrentUser; ip: string | null };

/** can_edit_job(): Admin-level sees everything; a recruiter only their own, and only while it is with them. */
export function canEditJob(job: Pick<repo.JobRow, 'created_by' | 'owner_id' | 'status' | 'approval_status'>, user: CurrentUser): boolean {
  if (!hasPermission(user, 'job_management') && !hasPermission(user, 'job_posting')) return false;
  if (isAdminLevel(user)) return true;
  const mine = job.created_by === user.id || job.owner_id === user.id;
  return mine && ['draft', 'rejected', 'changes_requested'].includes(jobState(job));
}

function toRow(j: repo.JobRow, user: CurrentUser): JobRowDto {
  return {
    id: j.id, title: j.title, slug: j.slug, department: j.department, departmentId: j.department_id, location: j.location,
    employmentType: j.employment_type, tags: jobTags(j.tags), applicantLimit: j.applicant_limit, isUrgent: j.is_urgent,
    status: j.status, approvalStatus: j.approval_status, state: jobState(j), applications: j.applications,
    creatorName: j.creator_name, reviewerName: j.reviewer_name, reviewNote: j.review_note, createdAt: isoOrThrow(j.created_at),
    publishedAt: iso(j.published_at), submittedAt: iso(j.submitted_at), canEdit: canEditJob(j, user),
  };
}

const toEvents = (rows: Awaited<ReturnType<typeof repo.history>>): ApprovalEventDto[] =>
  rows.map((h) => ({ id: h.id, action: h.action, note: h.note, actorName: h.actor_name, actorRole: h.actor_role, createdAt: isoOrThrow(h.created_at) }));

function editorJob(j: repo.JobRow, user: CurrentUser): NonNullable<JobEditorDto['job']> {
  return {
    ...toRow(j, user), description: j.description, responsibilities: j.responsibilities, qualifications: j.qualifications,
    requirements: j.requirements, preferredSkills: j.preferred_skills, experienceRequired: j.experience_required,
    educationRequired: j.education_required, salaryInfo: j.salary_info, sourcePdf: Boolean(j.source_pdf), tagsRaw: jobTags(j.tags).join(', '),
  };
}

export async function overview(user: CurrentUser): Promise<JobsOverviewDto> {
  const [jobs, departments, [counts]] = await Promise.all([
    repo.allJobs(),
    repo.departments(),
    sql<{ pending: number; apps: number; upcoming: number }[]>`
      select (select count(*)::int from jobs where approval_status = 'pending') as pending,
             (select count(*)::int from applications) as apps,
             (select count(*)::int from interviews where starts_at >= now() and status not in ('cancelled','no_show')) as upcoming`,
  ]);
  return {
    jobs: jobs.map((j) => toRow(j, user)),
    departments: departments.map((d) => ({ id: d.id, name: d.name, description: d.description, jobCount: d.job_count })),
    counts: { pendingApprovals: counts?.pending ?? 0, applications: counts?.apps ?? 0, upcomingInterviews: counts?.upcoming ?? 0 },
    canPublish: canPublishJobs(user),
  };
}

export async function mine(user: CurrentUser): Promise<MyJobsDto> {
  const jobs = (await repo.jobsOwnedBy(user.id)).map((j) => toRow(j, user));
  const byState: MyJobsDto['byState'] = {};
  for (const j of jobs) byState[j.state] = (byState[j.state] ?? 0) + 1;
  return { jobs, byState, canPost: hasPermission(user, 'job_posting') };
}

export async function editor(id: number | null, user: CurrentUser): Promise<JobEditorDto> {
  const s = await getSettings();
  const departments = (await repo.departments()).map((d) => ({ id: d.id, name: d.name }));
  const base = { departments, canPublish: canPublishJobs(user), defaultApplicantLimit: s.default_applicant_limit ? intSetting(s.default_applicant_limit, 0) : null };
  if (id === null) {
    if (!hasPermission(user, 'job_posting')) throw forbidden('Creating job postings requires the "Job posting" permission.');
    return { ...base, job: null, history: [] };
  }
  const job = await repo.byId(id);
  if (!job) throw notFound('That job no longer exists.');
  if (!canEditJob(job, user)) throw forbidden('This posting is no longer yours to edit — it has moved on in the approval workflow.');
  return { ...base, job: editorJob(job, user), history: toEvents(await repo.history(id)) };
}

async function verifySourcePdf(path: string | null | undefined, user: CurrentUser): Promise<string | null | undefined> {
  if (!path) return path;
  const [ok] = await sql<{ id: string }[]>`select id from pending_uploads where storage_path = ${path} and purpose = 'job_pdf' and created_by = ${user.id} and consumed_at is not null`;
  return ok ? path : undefined;
}

export async function save(id: number | null, input: z.infer<typeof saveJobSchema>, ctx: Ctx): Promise<{ jobId: number; state: string }> {
  const { user } = ctx;
  if (input.action === 'publish' && !canPublishJobs(user)) throw forbidden('Publishing a job requires Admin approval. Submit it for review instead.');
  if (id === null && !hasPermission(user, 'job_posting')) throw forbidden('Creating job postings requires the "Job posting" permission.');
  const [dept] = await sql<{ id: number }[]>`select id from departments where id = ${input.departmentId}`;
  if (!dept) throw validationFailed({ departmentId: 'Please choose a department.' });
  const sourcePdf = await verifySourcePdf(input.sourcePdfPath, user);

  const status = input.action === 'publish' ? 'open' : 'draft';
  const approval = input.action === 'publish' ? 'approved' : input.action === 'submit' ? 'pending' : 'draft';
  const tags = jobTags(input.tags).join(',') || null;
  const f = input;

  const result = await transaction(async (tx) => {
    let jobId: number;
    let wasReturned = false;
    if (id !== null) {
      const existing = await repo.lockById(tx, id);
      if (!existing) throw notFound('That job no longer exists.');
      if (!canEditJob(existing, user)) throw forbidden('This posting is no longer yours to edit — it has moved on in the approval workflow.');
      wasReturned = ['rejected', 'changes_requested'].includes(jobState(existing));
      const slug = existing.title === f.title ? existing.slug : await repo.uniqueSlug(tx, f.title, id);
      await tx`update jobs set department_id = ${f.departmentId}, title = ${f.title}, slug = ${slug}, location = ${f.location || null},
                 employment_type = ${f.employmentType}, tags = ${tags}, applicant_limit = ${f.applicantLimit}, description = ${f.description || null},
                 requirements = ${f.requirements || null}, responsibilities = ${f.responsibilities || null}, qualifications = ${f.qualifications || null},
                 preferred_skills = ${f.preferredSkills || null}, experience_required = ${f.experienceRequired || null},
                 education_required = ${f.educationRequired || null}, salary_info = ${f.salaryInfo || null}, is_urgent = ${f.isUrgent},
                 source_pdf = ${sourcePdf === undefined ? existing.source_pdf : sourcePdf}, status = ${status}, approval_status = ${approval},
                 submitted_by = ${input.action === 'submit' ? user.id : existing.submitted_by},
                 submitted_at = ${input.action === 'submit' ? new Date() : existing.submitted_at},
                 published_at = case when ${status} = 'open' and published_at is null then now() else published_at end
               where id = ${id}`;
      jobId = id;
    } else {
      const slug = await repo.uniqueSlug(tx, f.title, null);
      const [created] = await tx<{ id: number }[]>`
        insert into jobs (department_id, title, slug, location, employment_type, tags, applicant_limit, description, requirements, responsibilities,
                          qualifications, preferred_skills, experience_required, education_required, salary_info, is_urgent, source_pdf,
                          status, approval_status, owner_id, created_by, submitted_by, submitted_at, published_at)
        values (${f.departmentId}, ${f.title}, ${slug}, ${f.location || null}, ${f.employmentType}, ${tags}, ${f.applicantLimit},
                ${f.description || null}, ${f.requirements || null}, ${f.responsibilities || null}, ${f.qualifications || null},
                ${f.preferredSkills || null}, ${f.experienceRequired || null}, ${f.educationRequired || null}, ${f.salaryInfo || null},
                ${f.isUrgent}, ${sourcePdf ?? null}, ${status}, ${approval}, ${user.id}, ${user.id},
                ${input.action === 'submit' ? user.id : null}, ${input.action === 'submit' ? new Date() : null}, ${status === 'open' ? new Date() : null})
        returning id`;
      jobId = created!.id;
    }
    if (input.action === 'save_draft') {
      await audit({ userId: user.id, action: 'job_draft_save', entityType: 'job', entityId: jobId, details: { title: f.title }, ip: ctx.ip }, tx);
    } else if (input.action === 'submit') {
      await repo.recordApproval(tx, jobId, wasReturned ? 'resubmitted' : 'submitted', user.id);
      await audit({ userId: user.id, action: 'job_submit_for_approval', entityType: 'job', entityId: jobId, details: { title: f.title }, ip: ctx.ip }, tx);
    } else {
      await repo.recordApproval(tx, jobId, 'published', user.id, `Published directly by ${user.name}`);
      await audit({ userId: user.id, action: 'job_publish', entityType: 'job', entityId: jobId, details: { title: f.title, published_by: user.name }, ip: ctx.ip }, tx);
    }
    return { jobId, state: jobState({ status, approval_status: approval }) };
  });

  if (input.action === 'submit') await notifySubmitted(result.jobId, f.title, user);
  if (input.action === 'publish') emitN8nEvent('job.status_changed', { jobId: result.jobId, title: f.title, status: 'open' });
  return result;
}

async function notifySubmitted(jobId: number, title: string, user: CurrentUser) {
  await notifyMany(await jobReviewerIds(), {
    actorId: user.id, type: 'job_approval', title: 'Job approval required',
    body: `${user.name} submitted "${title}" for approval.`, link: `/app/jobs/approvals/${jobId}`, actionLabel: 'Review posting',
    entityType: 'job', entityId: jobId,
  });
  emitN8nEvent('job.submitted', { jobId, title, submittedBy: user.id });
}

/** my-jobs.php "Submit for approval" without opening the editor. */
export async function submit(id: number, ctx: Ctx): Promise<void> {
  if (!hasPermission(ctx.user, 'job_posting')) throw forbidden('Submitting a posting for approval requires the "Job posting" permission.');
  const title = await transaction(async (tx) => {
    const job = await repo.lockById(tx, id);
    if (!job) throw notFound('That job no longer exists.');
    if (!canEditJob(job, ctx.user)) throw forbidden('That posting is not yours to change right now.');
    const wasReturned = ['rejected', 'changes_requested'].includes(jobState(job));
    await tx`update jobs set approval_status = 'pending', status = 'draft', submitted_by = ${ctx.user.id}, submitted_at = now() where id = ${id}`;
    await repo.recordApproval(tx, id, wasReturned ? 'resubmitted' : 'submitted', ctx.user.id);
    await audit({ userId: ctx.user.id, action: 'job_submit_for_approval', entityType: 'job', entityId: id, details: { title: job.title }, ip: ctx.ip }, tx);
    return job.title;
  });
  await notifySubmitted(id, title, ctx.user);
}

/** admin.php job_status: publishing still has to respect the approval gate. */
export async function setStatus(id: number, input: z.infer<typeof jobStatusSchema>, ctx: Ctx, source = 'Status changed by an Admin'): Promise<void> {
  const title = await transaction(async (tx) => {
    const job = await repo.lockById(tx, id);
    if (!job) throw notFound('That job no longer exists.');
    if (input.status === 'open') {
      if (!canPublishJobs(ctx.user)) throw forbidden('Publishing a role requires the "Job posting" permission.');
      if (job.approval_status === 'pending') throw conflict('That posting is still awaiting approval. Review it in Job approvals first.');
      if (['rejected', 'changes_requested'].includes(job.approval_status)) {
        throw conflict('That posting was returned to its author and cannot be published until it is resubmitted and approved.');
      }
    }
    await tx`update jobs set status = ${input.status},
               approval_status = case when ${input.status} = 'open' and approval_status in ('none','draft') then 'approved' else approval_status end,
               published_at = case when ${input.status} = 'open' and published_at is null then now() else published_at end where id = ${id}`;
    if (input.status === 'open') await repo.recordApproval(tx, id, 'published', ctx.user.id, source);
    await audit({ userId: ctx.user.id, action: 'job_status_change', entityType: 'job', entityId: id, details: { title: job.title, status: input.status }, ip: ctx.ip }, tx);
    return job.title;
  });
  emitN8nEvent('job.status_changed', { jobId: id, title, status: input.status });
}

export async function quickEdit(id: number, input: z.infer<typeof quickEditSchema>, ctx: Ctx): Promise<void> {
  const job = await repo.byId(id);
  if (!job) throw notFound('That job no longer exists.');
  await transaction(async (tx) => {
    await tx`update jobs set
               tags = ${input.tags === undefined ? job.tags : jobTags(input.tags).join(',') || null},
               applicant_limit = ${input.applicantLimit === undefined ? job.applicant_limit : input.applicantLimit},
               description = ${input.description === undefined ? job.description : input.description || null},
               requirements = ${input.requirements === undefined ? job.requirements : input.requirements || null},
               is_urgent = ${input.isUrgent ?? job.is_urgent}
             where id = ${id}`;
    await audit({ userId: ctx.user.id, action: 'job_quick_edit', entityType: 'job', entityId: id, details: { title: job.title }, ip: ctx.ip }, tx);
  });
}

export async function createDepartment(input: z.infer<typeof departmentSchema>, ctx: Ctx): Promise<{ id: number }> {
  try {
    const [d] = await sql<{ id: number }[]>`insert into departments (name, description) values (${input.name}, ${input.description || null}) returning id`;
    await audit({ userId: ctx.user.id, action: 'department_create', entityType: 'department', entityId: d!.id, details: { name: input.name }, ip: ctx.ip });
    return { id: d!.id };
  } catch (e) {
    if (isUniqueViolation(e)) throw validationFailed({ name: 'A department with that name already exists.' });
    throw e;
  }
}

export async function extractPdf(uploadId: string, ctx: Ctx): Promise<ExtractPdfResultDto> {
  if (!hasPermission(ctx.user, 'job_posting')) throw forbidden('Creating job postings requires the "Job posting" permission.');
  const file = await consumeUpload(uploadId, 'job_pdf', ctx.user, 'job-descriptions', 'uploadId');
  const result = await extractPdfText(file.data);
  if (result.error) return { ok: false, message: result.error, qualityWarning: null, sourcePdfPath: file.path, fields: null };
  const f = parseJobDescription(result.text);
  const depts = await repo.departments();
  const match = f.department
    ? depts.find((d) => d.name.toLowerCase() === f.department.toLowerCase() || f.department.toLowerCase().includes(d.name.toLowerCase()))
    : undefined;
  await audit({ userId: ctx.user.id, action: 'job_pdf_import', entityType: 'job', details: { file: file.originalName, title: f.title || '(not detected)' }, ip: ctx.ip });
  return {
    ok: true,
    message: null,
    qualityWarning: result.quality === 'poor'
      ? 'The text layer in this PDF came through with very few word breaks, so some fields may run together. Please review the wording carefully before saving.'
      : null,
    sourcePdfPath: file.path,
    fields: {
      title: f.title, departmentId: match?.id ?? null, departmentText: f.department, location: f.location,
      employmentType: f.employment_type || 'full_time', description: f.description, responsibilities: f.responsibilities,
      qualifications: f.qualifications, requirements: f.skills, preferredSkills: f.preferred_skills, experienceRequired: f.experience,
      educationRequired: f.education, salaryInfo: f.salary, tags: skillsToTags(f.skills),
    },
  };
}

// ---------------------------------------------------------------------------
// Approval queue (Admin-level holding job_posting)
// ---------------------------------------------------------------------------

export async function approvalQueue(user: CurrentUser): Promise<ApprovalQueueDto> {
  const [queue, decided] = await Promise.all([repo.pendingQueue(), repo.recentlyDecided()]);
  return {
    queue: queue.map((j) => ({ ...toRow(j, user), submitterName: j.submitter_name })),
    decided: decided.map((j) => ({ ...toRow(j, user), reviewedAt: iso(j.reviewed_at) })),
  };
}

export async function approvalDetail(id: number, user: CurrentUser): Promise<ApprovalDetailDto> {
  const job = await repo.byId(id);
  if (!job) throw notFound('That job no longer exists.');
  return { job: { ...editorJob(job, user), submitterName: job.submitter_name, creatorEmail: job.creator_email }, history: toEvents(await repo.history(id)) };
}

export async function decide(id: number, input: z.infer<typeof approvalDecisionSchema>, ctx: Ctx): Promise<{ published: boolean }> {
  const decided = await transaction(async (tx) => {
    const job = await repo.lockById(tx, id);
    if (!job) throw notFound('That job no longer exists.');
    if (job.approval_status !== 'pending') {
      throw new AppError(409, 'conflict', 'That posting is not waiting for approval — someone may have reviewed it already.');
    }
    const note = input.note || null;
    const recipient = job.submitted_by ?? job.created_by;
    if (input.decision === 'approve_publish' || input.decision === 'approve_only') {
      const publish = input.decision === 'approve_publish';
      await tx`update jobs set approval_status = 'approved', status = ${publish ? 'open' : 'draft'}, reviewed_by = ${ctx.user.id}, reviewed_at = now(),
                 review_note = ${note}, published_at = case when ${publish} and published_at is null then now() else published_at end where id = ${id}`;
      await repo.recordApproval(tx, id, 'approved', ctx.user.id, note);
      await audit({ userId: ctx.user.id, action: 'job_approve', entityType: 'job', entityId: id, details: { title: job.title, note }, ip: ctx.ip }, tx);
      if (publish) {
        await repo.recordApproval(tx, id, 'published', ctx.user.id);
        await audit({ userId: ctx.user.id, action: 'job_publish', entityType: 'job', entityId: id, details: { title: job.title, published_by: ctx.user.name }, ip: ctx.ip }, tx);
      }
      return { job, recipient, publish, title: publish ? 'Your job posting was approved and published' : 'Your job posting was approved', body: `"${job.title}" was reviewed by ${ctx.user.name}.`, link: '/app/jobs/mine' };
    }
    const status = input.decision === 'reject' ? 'rejected' : 'changes_requested';
    await tx`update jobs set approval_status = ${status}, status = 'draft', reviewed_by = ${ctx.user.id}, reviewed_at = now(), review_note = ${note} where id = ${id}`;
    await repo.recordApproval(tx, id, status, ctx.user.id, note);
    await audit({
      userId: ctx.user.id, action: input.decision === 'reject' ? 'job_reject' : 'job_request_changes', entityType: 'job', entityId: id,
      details: input.decision === 'reject' ? { title: job.title, reason: note } : { title: job.title, requested: note }, ip: ctx.ip,
    }, tx);
    return {
      job, recipient, publish: false,
      title: input.decision === 'reject' ? 'Your job posting was rejected' : 'Changes requested on your job posting',
      body: `"${job.title}": ${note ?? ''}`, link: `/app/jobs/${id}/edit`,
    };
  });
  if (decided.recipient) {
    await notify({ userId: decided.recipient, actorId: ctx.user.id, type: 'job_decision', title: decided.title, body: decided.body, link: decided.link, actionLabel: 'Open posting', entityType: 'job', entityId: id });
  }
  emitN8nEvent('job.decided', { jobId: id, title: decided.job.title, decision: input.decision, published: decided.publish });
  return { published: decided.publish };
}

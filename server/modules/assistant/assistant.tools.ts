import { STAGES, STAGE_LABELS, isStageSkip, type Stage } from '../../../shared/domain/pipeline.js';
import { canPublishJobs, hasPermission, isAdminLevel } from '../../../shared/domain/access.js';
import { EMPLOYMENT_TYPES } from '../../../shared/domain/jobs.js';
import { EXPERIENCE_LEVELS, MANUAL_SOURCES } from '../../../shared/domain/pipeline.js';
import type { AssistantActionKind } from '../../../shared/api/assistant.js';
import { env } from '../../config/env.js';
import { sql } from '../../db/client.js';
import type { CurrentUser } from '../../http/context.js';
import { fullName } from '../../lib/format.js';
import * as interviews from '../interviews/interviews.service.js';
import { requiredFields } from '../candidates/candidates.service.js';
import { signToken } from './assistant.tokens.js';

/**
 * The two tools the n8n agent calls. lookup only reads; propose only prepares
 * a change and returns a signed action the person must confirm in the chat.
 * Both run as the person who is chatting, with their permissions. Answers are
 * small plain objects: they go straight into the model's context.
 */

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number.parseInt(str(v), 10); return Number.isFinite(n) && n > 0 ? n : null; };
const bool = (v: unknown) => v === true || v === 'true';

/** "Tue, Oct 1, 2:30 PM" in the company's time zone. */
export const when = (d: Date | string) => new Intl.DateTimeFormat('en-US', {
  timeZone: env.APP_TIMEZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(d));

/** Answers the model reads as "this did not work, tell the person why". */
class ToolRefusal extends Error {}
const refuse = (message: string): never => { throw new ToolRefusal(message); };
export const isRefusal = (e: unknown): e is ToolRefusal => e instanceof ToolRefusal;

/** Accepts a stage written loosely: "final interview", "Final-Interview", "applied". */
function toStage(v: unknown): Stage | null {
  const s = str(v).toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'applied') return 'new';
  return (STAGES as readonly string[]).includes(s) ? (s as Stage) : null;
}

// ---------------------------------------------------------------- lookup

export async function lookup(user: CurrentUser, args: Args): Promise<unknown> {
  const what = str(args.what).toLowerCase();
  const query = str(args.query);
  switch (what) {
    case 'candidates': return findCandidates(query, str(args.job), toStage(args.stage));
    case 'candidate': return candidateDetail(num(args.id), query);
    case 'interviews': return upcomingInterviews();
    case 'interviewers': return sql`select id, name from users where active and role in ('admin','recruiter','hiring_manager','super_admin') order by name`;
    case 'jobs': return jobs(query);
    case 'departments': return sql`select id, name from departments order by name`;
    case 'pipeline': return pipelineCounts(str(args.job));
    case 'approvals': return approvals(user);
    default:
      return refuse('Unknown lookup. Use what = candidates, candidate, interviews, interviewers, jobs, departments, pipeline or approvals.');
  }
}

async function findCandidates(query: string, job: string, stage: Stage | null) {
  const like = query ? `%${query}%` : null;
  const jobLike = job ? `%${job}%` : null;
  const rows = await sql<{ application_id: number; candidate_id: number; first_name: string; last_name: string; email: string; title: string; stage: Stage; applied_at: Date; current_title: string | null }[]>`
    select a.id as application_id, c.id as candidate_id, c.first_name, c.last_name, c.email::text, j.title, a.stage, a.applied_at, c.current_title
    from applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id
    where a.status = 'active' and c.record_status = 'active'
      ${like ? sql`and ((c.first_name || ' ' || c.last_name) ilike ${like} or c.email::text ilike ${like} or c.skills ilike ${like} or c.current_title ilike ${like})` : sql``}
      ${jobLike ? sql`and j.title ilike ${jobLike}` : sql``}
      ${stage ? sql`and a.stage = ${stage}` : sql``}
    order by a.updated_at desc limit 15`;
  return {
    count: rows.length,
    candidates: rows.map((r) => ({
      applicationId: r.application_id, candidateId: r.candidate_id, name: fullName(r.first_name, r.last_name), email: r.email,
      job: r.title, stage: STAGE_LABELS[r.stage], currentTitle: r.current_title, applied: when(r.applied_at),
    })),
  };
}

async function candidateDetail(id: number | null, query: string) {
  const like = query ? `%${query}%` : null;
  const [c] = await sql<{ id: number; first_name: string; last_name: string; email: string; phone: string | null; current_title: string | null; experience_level: string | null; skills: string | null; education: string | null }[]>`
    select c.id, c.first_name, c.last_name, c.email::text, c.phone, c.current_title, c.experience_level, c.skills, c.education
    from candidates c
    where ${id ? sql`(c.id = ${id} or c.id = (select candidate_id from applications where id = ${id}))` : like ? sql`(c.first_name || ' ' || c.last_name) ilike ${like}` : sql`false`}
    order by c.created_at desc limit 1`;
  if (!c) return refuse('No candidate found. Search with what = candidates first.');
  const [apps, notes, ivs] = await Promise.all([
    sql<{ id: number; title: string; stage: Stage; status: string; applied_at: Date }[]>`
      select a.id, j.title, a.stage, a.status, a.applied_at from applications a join jobs j on j.id = a.job_id where a.candidate_id = ${c.id} order by a.applied_at desc`,
    sql<{ note: string; created_at: Date }[]>`select note, created_at from candidate_notes where candidate_id = ${c.id} order by created_at desc limit 3`,
    sql<{ starts_at: Date; meeting_type: string; status: string }[]>`
      select i.starts_at, i.meeting_type, i.status from interviews i join applications a on a.id = i.application_id
      where a.candidate_id = ${c.id} and i.starts_at > now() - interval '1 day' and i.status <> 'cancelled' order by i.starts_at limit 3`,
  ]);
  return {
    candidateId: c.id, name: fullName(c.first_name, c.last_name), email: c.email, phone: c.phone, currentTitle: c.current_title,
    experienceLevel: c.experience_level, skills: c.skills, education: c.education,
    applications: apps.map((a) => ({ applicationId: a.id, job: a.title, stage: STAGE_LABELS[a.stage], withdrawn: a.status === 'withdrawn', applied: when(a.applied_at) })),
    upcomingInterviews: ivs.map((i) => ({ when: when(i.starts_at), type: i.meeting_type, status: i.status })),
    latestNotes: notes.map((n) => n.note.slice(0, 300)),
  };
}

async function upcomingInterviews() {
  const list = await interviews.list();
  const items = [...list.today, ...list.upcoming].filter((i) => i.status !== 'cancelled').slice(0, 15);
  return {
    today: list.counts.today, thisWeek: list.counts.thisWeek,
    interviews: items.map((i) => ({
      id: i.id, applicationId: i.applicationId, candidate: i.candidateName, job: i.jobTitle, when: when(i.startsAt),
      type: i.finalInterview ? 'final interview' : i.meetingType, format: i.interviewType, interviewer: i.interviewerName, status: i.status,
    })),
  };
}

async function jobs(query: string) {
  const like = query ? `%${query}%` : null;
  const rows = await sql<{ id: number; title: string; department: string | null; location: string | null; status: string; approval_status: string; applicants: number }[]>`
    select j.id, j.title, d.name as department, j.location, j.status, j.approval_status,
           (select count(*)::int from applications a where a.job_id = j.id and a.status = 'active') as applicants
    from jobs j left join departments d on d.id = j.department_id
    where j.status <> 'closed' ${like ? sql`and j.title ilike ${like}` : sql``}
    order by j.created_at desc limit 20`;
  return { jobs: rows.map((j) => ({ ...j, waitingForApproval: j.approval_status === 'pending' })) };
}

async function pipelineCounts(job: string) {
  const jobLike = job ? `%${job}%` : null;
  const rows = await sql<{ stage: Stage; n: number }[]>`
    select a.stage, count(*)::int as n from applications a join jobs j on j.id = a.job_id
    where a.status = 'active' ${jobLike ? sql`and j.title ilike ${jobLike}` : sql``}
    group by a.stage`;
  return Object.fromEntries(STAGES.map((st) => [STAGE_LABELS[st], rows.find((r) => r.stage === st)?.n ?? 0]));
}

async function approvals(user: CurrentUser) {
  const jobsWaiting = await sql<{ id: number; title: string; submitter: string | null; submitted_at: Date | null }[]>`
    select j.id, j.title, u.name as submitter, j.submitted_at from jobs j left join users u on u.id = j.submitted_by
    where j.approval_status = 'pending' order by j.submitted_at`;
  return {
    canApprove: canPublishJobs(user),
    note: canPublishJobs(user) ? undefined : 'This person cannot approve postings; only an Admin with the Job posting permission can.',
    jobPostings: jobsWaiting.map((j) => ({ jobId: j.id, title: j.title, submittedBy: j.submitter, submitted: j.submitted_at ? when(j.submitted_at) : null })),
  };
}

// ---------------------------------------------------------------- propose

/** What a confirmed action needs, signed into its token. */
export type ActionData =
  | { kind: 'move_stage'; applicationId: number; stage: Stage; notify: boolean; override: boolean }
  | { kind: 'schedule_interview'; applicationId: number; startsAt: string; endsAt: string; meetingType: 'screening' | 'interview'; interviewType: 'phone' | 'video' | 'onsite' | 'panel'; interviewerId: number; final: boolean; location: string }
  | { kind: 'send_email'; candidateId: number; to: string; name: string; subject: string; body: string }
  | { kind: 'create_job'; fields: Record<string, unknown>; publish: boolean; departmentName: string }
  | { kind: 'add_candidate'; input: Record<string, unknown>; jobTitle: string | null; existing: string | null }
  | { kind: 'approve_job' | 'reject_job'; jobId: number; note: string };

export interface Proposal { kind: AssistantActionKind; title: string; lines: string[]; confirmLabel: string; data: ActionData }

export async function propose(user: CurrentUser, args: Args): Promise<{ status: string; preview: string[]; actionToken: string }> {
  const p = await prepare(user, args);
  const actionToken = signToken('action', user.id, { title: p.title, lines: p.lines, confirmLabel: p.confirmLabel, ...p.data });
  return {
    status: 'Prepared, NOT done yet. A Confirm button is shown to the person; it only happens when they press it. Tell them to check and confirm.',
    preview: [p.title, ...p.lines],
    actionToken,
  };
}

async function application(id: number | null) {
  if (!id) return refuse('Give application_id (from lookup candidates). If several people match, ask which one.');
  const [a] = await sql<{ id: number; stage: Stage; status: string; candidate_id: number; first_name: string; last_name: string; email: string; title: string }[]>`
    select a.id, a.stage, a.status, c.id as candidate_id, c.first_name, c.last_name, c.email::text, j.title
    from applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id where a.id = ${id}`;
  if (!a) return refuse(`There is no application ${id}. Look the candidate up again.`);
  if (a.status === 'withdrawn') return refuse(`${fullName(a.first_name, a.last_name)} withdrew this application, so it cannot be changed.`);
  return a;
}

async function prepare(user: CurrentUser, args: Args): Promise<Proposal> {
  const action = str(args.action).toLowerCase();

  if (action === 'move_stage') {
    const a = await application(num(args.application_id));
    const stage = toStage(args.stage) ?? refuse('Give stage: screening, interview, final_interview, offer, hired or rejected.');
    if (a.stage === stage) refuse(`${fullName(a.first_name, a.last_name)} is already in ${STAGE_LABELS[stage]}.`);
    const skip = isStageSkip(a.stage, stage);
    if (skip && user.role !== 'admin') {
      refuse(`Moving from ${STAGE_LABELS[a.stage]} to ${STAGE_LABELS[stage]} skips a required stage. Only an Admin can skip stages; move one stage at a time instead.`);
    }
    const notify = bool(args.notify);
    return {
      kind: 'move_stage', confirmLabel: stage === 'rejected' ? 'Reject' : 'Move',
      title: `Move ${fullName(a.first_name, a.last_name)} to ${STAGE_LABELS[stage]}`,
      lines: [`${a.title}`, `${STAGE_LABELS[a.stage]} → ${STAGE_LABELS[stage]}${skip ? ' (skips a stage, Admin override)' : ''}`, notify ? `Emails ${a.email} about it` : 'No email to the applicant'],
      data: { kind: 'move_stage', applicationId: a.id, stage, notify, override: skip },
    };
  }

  if (action === 'schedule_interview') {
    const a = await application(num(args.application_id));
    const start = new Date(str(args.starts_at));
    if (Number.isNaN(start.getTime())) refuse('Give starts_at as an ISO date-time with the time zone offset, e.g. 2026-10-02T14:00:00+08:00.');
    if (start.getTime() < Date.now()) refuse('That time has already passed. Ask for a future time.');
    const minutes = Math.min(Math.max(num(args.duration_minutes) ?? 60, 15), 240);
    const meetingType = str(args.meeting_type) === 'screening' ? 'screening' : 'interview';
    const format = str(args.interview_type).toLowerCase();
    const interviewType = (['phone', 'video', 'onsite', 'panel'] as const).find((t) => t === format) ?? 'video';
    const location = str(args.location);
    if (interviewType === 'onsite' && !location) refuse('An onsite interview needs an address. Ask for the location.');
    const interviewerId = num(args.interviewer_id) ?? user.id;
    const [iv] = await sql<{ name: string }[]>`select name from users where id = ${interviewerId} and active and role in ('admin','recruiter','hiring_manager','super_admin')`;
    if (!iv) refuse('That interviewer was not found. Use lookup interviewers.');
    const final = bool(args.final) && meetingType === 'interview';
    return {
      kind: 'schedule_interview', confirmLabel: 'Schedule',
      title: `Schedule ${final ? 'a final interview' : meetingType === 'screening' ? 'a screening' : 'an interview'} with ${fullName(a.first_name, a.last_name)}`,
      lines: [a.title, `${when(start)} · ${minutes} min · ${interviewType}${location ? ` · ${location}` : ''}`, `Interviewer: ${iv!.name}`, `Invitation email to ${a.email}`],
      data: { kind: 'schedule_interview', applicationId: a.id, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + minutes * 60_000).toISOString(), meetingType, interviewType, interviewerId, final, location },
    };
  }

  if (action === 'send_email') {
    const subject = str(args.subject).slice(0, 180);
    const body = str(args.body).slice(0, 5000);
    if (!subject || !body) refuse('Give subject and body for the email.');
    const appId = num(args.application_id);
    const candId = num(args.candidate_id);
    const [c] = await sql<{ id: number; first_name: string; last_name: string; email: string }[]>`
      select c.id, c.first_name, c.last_name, c.email::text from candidates c
      where ${appId ? sql`c.id = (select candidate_id from applications where id = ${appId})` : candId ? sql`c.id = ${candId}` : sql`false`}`;
    if (!c) refuse('Give application_id or candidate_id of who to email.');
    return {
      kind: 'send_email', confirmLabel: 'Send email',
      title: `Email ${fullName(c!.first_name, c!.last_name)}`,
      lines: [`To: ${c!.email}`, `Subject: ${subject}`, body],
      data: { kind: 'send_email', candidateId: c!.id, to: c!.email, name: c!.first_name, subject, body },
    };
  }

  if (action === 'create_job') {
    if (!hasPermission(user, 'job_posting')) refuse('This person does not have the Job posting permission, so they cannot create postings.');
    const title = str(args.title).slice(0, 180);
    if (!title) refuse('Give the job title.');
    const deptName = str(args.department);
    const [dept] = await sql<{ id: number; name: string }[]>`
      select id, name from departments where ${deptName ? sql`name ilike ${`%${deptName}%`}` : sql`false`} order by name limit 1`;
    if (!dept) refuse(`Department "${deptName || '(none given)'}" not found. Use lookup departments and pick one, or ask the person.`);
    const type = str(args.employment_type).toLowerCase().replace(/[\s-]+/g, '_');
    const lines = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean).join('\n') : str(v)).slice(0, 10000);
    // Publishing straight away is only for people who can approve postings, and only when asked.
    const publish = bool(args.publish) && canPublishJobs(user);
    const fields = {
      title, departmentId: dept!.id, location: str(args.location).slice(0, 160),
      employmentType: (EMPLOYMENT_TYPES as readonly string[]).includes(type) ? type : 'full_time',
      description: str(args.description).slice(0, 20000), responsibilities: lines(args.responsibilities), qualifications: lines(args.qualifications),
      requirements: lines(args.requirements ?? args.skills), preferredSkills: lines(args.preferred_skills), experienceRequired: str(args.experience).slice(0, 255),
      educationRequired: str(args.education).slice(0, 255), salaryInfo: str(args.salary).slice(0, 255), tags: '', applicantLimit: null, isUrgent: false,
    };
    return {
      kind: 'create_job', confirmLabel: publish ? 'Create and publish' : 'Create and submit',
      title: `${publish ? 'Publish' : 'Create'} job posting: ${title}`,
      lines: [
        `${dept!.name}${fields.location ? ` · ${fields.location}` : ''} · ${fields.employmentType.replace('_', '-')}`,
        ...(fields.salaryInfo ? [`Salary: ${fields.salaryInfo}`] : []),
        publish ? 'Goes live on the careers site.' : 'Saved and sent to an Admin for approval. It is not published until approved.',
      ],
      data: { kind: 'create_job', fields, publish, departmentName: dept!.name },
    };
  }

  if (action === 'add_candidate') {
    const name = str(args.full_name ?? args.name).replace(/\s+/g, ' ').slice(0, 160);
    if (!name) refuse('Give the applicant\'s full name.');
    const email = str(args.email).toLowerCase().slice(0, 190);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) refuse(`"${email}" is not a valid email address. Ask for the right one.`);
    const phone = str(args.phone).slice(0, 30);
    if (phone && !/^[\d\s()+.-]{7,20}$/.test(phone)) refuse(`"${phone}" does not look like a phone number. Ask for the right one.`);
    const required = await requiredFields();
    if (required.includes('email') && !email) refuse('An email address is required to add an applicant. Ask for it.');
    // Which open role they apply for, by id or by title.
    const jobId = num(args.job_id);
    const jobText = str(args.job);
    let job: { id: number; title: string } | undefined;
    if (jobId || jobText) {
      [job] = await sql<{ id: number; title: string }[]>`
        select id, title from jobs where status = 'open' and ${jobId ? sql`id = ${jobId}` : sql`title ilike ${`%${jobText}%`}`} order by created_at desc limit 1`;
      if (!job) refuse(`No open job matches "${jobText || jobId}". Use lookup jobs and pick an open one, or add them without a job.`);
    }
    const [existing] = email ? await sql<{ first_name: string; last_name: string }[]>`select first_name, last_name from candidates where email = ${email} order by id desc limit 1` : [];
    const level = str(args.experience_level).toLowerCase();
    const source = str(args.source).toLowerCase().replace(/[\s-]+/g, '_');
    const skills = Array.isArray(args.skills) ? args.skills.map(str).filter(Boolean).join(', ') : str(args.skills);
    const input = {
      action: 'submit', fullName: name, email, phone, currentTitle: str(args.current_title).slice(0, 160),
      experienceLevel: (EXPERIENCE_LEVELS as readonly string[]).includes(level) ? level : '',
      skills: skills.slice(0, 500), education: str(args.education).slice(0, 300),
      source: source in MANUAL_SOURCES ? source : 'direct', jobId: job?.id ?? null, notes: str(args.notes).slice(0, 5000),
    };
    const existingName = existing ? fullName(existing.first_name, existing.last_name) : null;
    return {
      kind: 'add_candidate', confirmLabel: existingName ? 'Update applicant' : 'Add applicant',
      title: `${existingName ? 'Update' : 'Add'} applicant: ${name}`,
      lines: [
        [email, phone].filter(Boolean).join(' · ') || 'No contact details yet',
        job ? `Applies for ${job.title} (starts in Applied)` : 'Not linked to a job yet',
        ...(existingName ? [`${email} already belongs to ${existingName}; their record will be updated.`] : []),
      ],
      data: { kind: 'add_candidate', input, jobTitle: job?.title ?? null, existing: existingName },
    };
  }

  if (action === 'approve_job' || action === 'reject_job') {
    if (!canPublishJobs(user)) refuse('Only an Admin with the Job posting permission can approve or reject postings. This person cannot.');
    const id = num(args.job_id) ?? refuse('Give job_id (from lookup approvals).');
    const [job] = await sql<{ id: number; title: string; approval_status: string }[]>`select id, title, approval_status from jobs where id = ${id}`;
    if (!job) refuse(`There is no job ${id}.`);
    if (job!.approval_status !== 'pending') refuse(`"${job!.title}" is not waiting for approval.`);
    const note = str(args.note).slice(0, 2000);
    if (action === 'reject_job' && !note) refuse('Rejecting needs a reason. Ask the person why.');
    return {
      kind: action, confirmLabel: action === 'approve_job' ? 'Approve and publish' : 'Reject',
      title: `${action === 'approve_job' ? 'Approve and publish' : 'Reject'}: ${job!.title}`,
      lines: action === 'approve_job' ? ['Goes live on the careers site.'] : [`Reason: ${note}`],
      data: { kind: action, jobId: job!.id, note },
    };
  }

  return refuse('Unknown action. Use move_stage, schedule_interview, send_email, create_job, add_candidate, approve_job or reject_job.');
}

export const canUseAssistant = (user: CurrentUser) => ['admin', 'recruiter', 'hiring_manager', 'super_admin'].includes(user.role) || isAdminLevel(user);

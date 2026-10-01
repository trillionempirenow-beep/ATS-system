import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { STAGE_LABELS, STAGE_ORDER, type Stage } from '../../../shared/domain/pipeline.js';
import { canPublishJobs, ROLE_LABELS, hasPermission, isAdminLevel } from '../../../shared/domain/access.js';
import { scheduleInterviewSchema } from '../../../shared/api/interviews.js';
import { saveJobSchema } from '../../../shared/api/jobs.js';
import { addCandidateSchema } from '../../../shared/api/candidates.js';
import { EMPLOYMENT_TYPE_LABELS, type EmploymentType } from '../../../shared/domain/jobs.js';
import { EXPERIENCE_LEVEL_LABELS, MANUAL_SOURCES, type ExperienceLevel, type ManualSource } from '../../../shared/domain/pipeline.js';
import type { AssistantActionDto, AssistantConfirmDto, AssistantPreview, AssistantReplyDto, assistantMessageSchema } from '../../../shared/api/assistant.js';
import { env } from '../../config/env.js';
import { sql } from '../../db/client.js';
import { auditQuietly } from '../../core/audit.js';
import type { CurrentUser } from '../../http/context.js';
import { AppError, forbidden } from '../../http/errors.js';
import { appLink, brand } from '../../email/brand.js';
import { sendEmail } from '../../email/email.service.js';
import { applicationStatus, interviewInvitation, recruiterMessage } from '../../email/templates/index.js';
import { describeError } from '../../parsers/resume-ai.js';
import { fullName } from '../../lib/format.js';
import * as pipeline from '../pipeline/pipeline.service.js';
import * as interviews from '../interviews/interviews.service.js';
import * as jobs from '../jobs/jobs.service.js';
import * as candidates from '../candidates/candidates.service.js';
import { type ActionData, when } from './assistant.tools.js';
import { TOKEN_PATTERN, readToken, signToken } from './assistant.tokens.js';

type Ctx = { user: CurrentUser; ip: string | null };
type SignedAction = ActionData & { title: string; lines: string[]; confirmLabel: string };

/** n8n's agent may take a few tool round trips; leave room inside the function's 60s (vercel.json). */
const TIMEOUT_MS = 50_000;

export const assistantEnabled = () => Boolean(env.ASSISTANT_N8N_WEBHOOK_URL);

/**
 * One turn: hands the message (or recording) to the "ats-assistant" n8n
 * workflow with a short-lived token its tools use to act as this person, then
 * returns the reply and any changes it prepared, for the person to confirm.
 */
export async function message(input: z.infer<typeof assistantMessageSchema>, ctx: Ctx): Promise<AssistantReplyDto> {
  if (!env.ASSISTANT_N8N_WEBHOOK_URL) {
    throw new AppError(503, 'service_unavailable', 'The assistant is not connected yet. Set ASSISTANT_N8N_WEBHOOK_URL to the ats-assistant workflow\'s webhook and redeploy.');
  }
  const { user } = ctx;
  const secret = env.CV_N8N_SECRET ?? env.EMAIL_N8N_SECRET;
  const now = new Date();
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(env.ASSISTANT_N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-ATS-Secret': secret } : {}) },
      body: JSON.stringify({
        text: input.text,
        audio: input.audio ?? null,
        audioMime: input.audioMime ?? null,
        voice: Boolean(input.audio),
        history: input.history,
        page: input.page,
        now: `${now.toISOString()} (${when(now)} in ${env.APP_TIMEZONE})`,
        timezone: env.APP_TIMEZONE,
        user: {
          name: user.name, firstName: user.name.split(/\s+/)[0], role: ROLE_LABELS[user.role] ?? user.role,
          isAdmin: isAdminLevel(user), canApproveJobs: canPublishJobs(user), canCreateJobs: hasPermission(user, 'job_posting'),
        },
        token: signToken('run', user.id, {}),
        toolsUrl: `${env.APP_URL.replace(/\/$/, '')}/api/v1/assistant/tools`,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.warn(`[assistant] n8n: ${describeError(e)} after ${Date.now() - started}ms`);
    throw new AppError(504, 'service_unavailable', 'The assistant took too long to answer. Try a shorter request.');
  }
  const raw = await res.text();
  if (!res.ok) {
    console.warn(`[assistant] n8n HTTP ${res.status}: ${raw.slice(0, 300)}`);
    const hint = res.status === 401 || res.status === 403 ? ' (the shared secret does not match n8n\'s Header Auth credential)' : '';
    throw new AppError(502, 'service_unavailable', `The assistant could not answer (n8n HTTP ${res.status}${hint}).`);
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { throw new AppError(502, 'service_unavailable', 'The assistant workflow did not answer with JSON.'); }
  console.info(`[assistant] answered in ${Date.now() - started}ms`);

  // Prepared changes come back inside the agent's tool results; take every signed one that belongs to this person.
  const seen = new Set<string>();
  const actions: AssistantActionDto[] = [];
  for (const token of JSON.stringify(body.steps ?? body).match(TOKEN_PATTERN) ?? []) {
    if (seen.has(token)) continue;
    seen.add(token);
    const a = readToken<SignedAction>(token, 'action', user.id);
    if (a) actions.push({ token, kind: a.kind, title: a.title, lines: a.lines, confirmLabel: a.confirmLabel, preview: await previewOf(a, user.name).catch(() => undefined) });
  }
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    reply: text(body.reply) ?? (actions.length ? 'Check the details below and confirm.' : 'Sorry, I did not get an answer. Please try again.'),
    transcript: text(body.transcript),
    audio: text(body.audio),
    audioMime: text(body.audioMime) ?? (text(body.audio) ? 'audio/mpeg' : null),
    actions: actions.slice(-5),
  };
}

/** "Thursday, October 2, 2026" / "2:00 PM" / "Asia/Manila", as the invitation email shows them. */
function whenInfo(iso: string) {
  const d = new Date(iso);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: env.APP_TIMEZONE, ...o }).format(d);
  return { date: part({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), time: part({ hour: 'numeric', minute: '2-digit' }), timezone: env.APP_TIMEZONE };
}

const asEmail = (to: string, e: { subject: string; html: string }) => ({ to, subject: e.subject, html: e.html });

/** Who and what an application is, for previews. */
async function applicationInfo(id: number) {
  const [a] = await sql<{ first_name: string; last_name: string; email: string; title: string; stage: Stage }[]>`
    select c.first_name, c.last_name, c.email::text, j.title, a.stage
    from applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id where a.id = ${id}`;
  return a;
}

/** What the change will produce, for the card's Preview: the posting, the applicant, or the exact email. */
async function previewOf(a: SignedAction, senderName: string): Promise<AssistantPreview | undefined> {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (a.kind) {
    case 'create_job': {
      const f = a.fields;
      return {
        type: 'job', title: s(f.title), department: a.departmentName, location: s(f.location),
        employmentType: EMPLOYMENT_TYPE_LABELS[s(f.employmentType) as EmploymentType] ?? s(f.employmentType), salary: s(f.salaryInfo),
        description: s(f.description), responsibilities: s(f.responsibilities), qualifications: s(f.qualifications),
        requirements: s(f.requirements), preferredSkills: s(f.preferredSkills), experience: s(f.experienceRequired),
        education: s(f.educationRequired), publish: a.publish,
      };
    }
    case 'add_candidate': {
      const i = a.input;
      return {
        type: 'candidate', fullName: s(i.fullName), email: s(i.email), phone: s(i.phone), currentTitle: s(i.currentTitle),
        experienceLevel: EXPERIENCE_LEVEL_LABELS[s(i.experienceLevel) as ExperienceLevel] ?? '', skills: s(i.skills),
        education: s(i.education), source: MANUAL_SOURCES[s(i.source) as ManualSource] ?? '', job: a.jobTitle, notes: s(i.notes), existing: a.existing,
      };
    }
    case 'send_email': {
      const email = recruiterMessage(await brand(), { candidateName: a.name, subject: a.subject, body: a.body, senderName });
      return { type: 'email', email: asEmail(a.to, email) };
    }
    case 'move_stage': {
      const app = await applicationInfo(a.applicationId);
      if (!app) return undefined;
      const statusUrl = appLink(`/status?email=${encodeURIComponent(app.email)}&id=${a.applicationId}`);
      const email = a.notify && a.stage !== 'new'
        ? asEmail(app.email, applicationStatus(await brand(), { candidateName: app.first_name, jobTitle: app.title, stage: a.stage, stageLabel: STAGE_LABELS[a.stage], statusUrl, feedback: null }))
        : null;
      return {
        type: 'stage', candidate: fullName(app.first_name, app.last_name), job: app.title,
        from: STAGE_LABELS[app.stage], to: STAGE_LABELS[a.stage], stages: [...STAGE_ORDER.map((st) => STAGE_LABELS[st]), STAGE_LABELS.rejected], email,
      };
    }
    case 'schedule_interview': {
      const app = await applicationInfo(a.applicationId);
      const [iv] = await sql<{ name: string }[]>`select name from users where id = ${a.interviewerId}`;
      if (!app) return undefined;
      const minutes = Math.round((Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60_000);
      const format = a.interviewType === 'video' ? 'Video call' : a.interviewType === 'phone' ? 'Phone call' : a.interviewType === 'onsite' ? 'On-site' : 'Panel';
      const email = interviewInvitation(await brand(), {
        candidateName: app.first_name, jobTitle: app.title, meetingType: a.meetingType, final: a.final, interviewType: format,
        when: whenInfo(a.startsAt), duration: `${minutes} minutes`, interviewerName: iv?.name ?? null,
        // The room and its link are created when the interview is booked.
        joinUrl: a.interviewType === 'onsite' ? null : appLink('/interview/(created-when-you-confirm)'),
        location: a.location || null, roomCode: null, builtIn: a.interviewType !== 'onsite', statusUrl: appLink('/status'),
      });
      return {
        type: 'interview', candidate: fullName(app.first_name, app.last_name), job: app.title, when: `${whenInfo(a.startsAt).date}, ${whenInfo(a.startsAt).time}`,
        duration: `${minutes} minutes`, kind: a.meetingType === 'screening' ? 'Screening' : a.final ? 'Final interview' : 'Interview', format,
        interviewer: iv?.name ?? '', location: a.location || null, email: asEmail(app.email, email),
      };
    }
    case 'approve_job':
    case 'reject_job': {
      const [j] = await sql<{ title: string; department: string | null; location: string | null; employment_type: EmploymentType; salary_info: string | null; description: string | null;
        responsibilities: string | null; qualifications: string | null; requirements: string | null; preferred_skills: string | null; experience_required: string | null; education_required: string | null }[]>`
        select j.title, d.name as department, j.location, j.employment_type, j.salary_info, j.description, j.responsibilities, j.qualifications,
               j.requirements, j.preferred_skills, j.experience_required, j.education_required
        from jobs j left join departments d on d.id = j.department_id where j.id = ${a.jobId}`;
      if (!j) return undefined;
      return {
        type: 'job', title: j.title, department: j.department ?? '', location: j.location ?? '', employmentType: EMPLOYMENT_TYPE_LABELS[j.employment_type] ?? '',
        salary: j.salary_info ?? '', description: j.description ?? '', responsibilities: j.responsibilities ?? '', qualifications: j.qualifications ?? '',
        requirements: j.requirements ?? '', preferredSkills: j.preferred_skills ?? '', experience: j.experience_required ?? '', education: j.education_required ?? '',
        publish: a.kind === 'approve_job',
        notice: a.kind === 'reject_job' ? `This posting will be rejected and sent back to its author. Reason: ${a.note}` : undefined,
      };
    }
  }
}

/** Runs a prepared change as the person confirming it. Their own permissions apply again here. */
export async function confirm(token: string, ctx: Ctx): Promise<AssistantConfirmDto> {
  const a = readToken<SignedAction>(token, 'action', ctx.user.id);
  if (!a) throw new AppError(410, 'conflict', 'This suggestion has expired. Ask the assistant again.');
  const result = await run(a, token, ctx);
  await auditQuietly({ userId: ctx.user.id, action: 'assistant_action', entityType: 'assistant', details: { kind: a.kind, title: a.title }, ip: ctx.ip });
  return result;
}

async function run(a: SignedAction, token: string, ctx: Ctx): Promise<AssistantConfirmDto> {
  const { user } = ctx;
  switch (a.kind) {
    case 'move_stage': {
      const moved = await pipeline.moveStage(a.applicationId, { stage: a.stage, override: a.override, notifyApplicant: a.notify }, user, ctx.ip);
      return {
        message: `Done. Moved to ${STAGE_LABELS[moved.to]}.`,
        undoToken: moved.from === moved.to ? null : signToken('undo', user.id, { applicationId: a.applicationId, stage: moved.from }),
        link: `/app/candidates/${a.applicationId}`,
      };
    }
    case 'schedule_interview': {
      const input = scheduleInterviewSchema.parse({
        applicationId: a.applicationId, startsAt: a.startsAt, endsAt: a.endsAt, interviewType: a.interviewType, meetingType: a.meetingType,
        interviewerId: a.interviewerId, meetingMode: 'builtin', location: a.location, sendInvite: true, finalInterview: a.final,
      });
      await interviews.schedule(input, ctx);
      return { message: `Done. Scheduled for ${when(a.startsAt)}, and the invitation was sent.`, undoToken: null, link: '/app/interviews' };
    }
    case 'send_email': {
      const sent = await sendEmail({
        // One send per suggestion, however many times Confirm is pressed.
        key: `assistant:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`,
        template: 'recruiter-message',
        to: a.to,
        email: recruiterMessage(await brand(), { candidateName: a.name, subject: a.subject, body: a.body, senderName: user.name }),
      });
      if (sent.outcome === 'duplicate') return { message: 'This email was already sent.', undoToken: null, link: null };
      if (sent.outcome === 'skipped') return { message: 'Done, but email is in log mode here, so nothing was delivered.', undoToken: null, link: null };
      if (sent.outcome !== 'sent') throw new AppError(502, 'service_unavailable', `The email was not sent: ${'error' in sent ? sent.error : sent.outcome}.`);
      return { message: `Done. Email sent to ${a.to}.`, undoToken: null, link: null };
    }
    case 'create_job': {
      const action = a.publish && canPublishJobs(user) ? 'publish' : 'submit';
      const saved = await jobs.save(null, saveJobSchema.parse({ ...a.fields, action }), ctx);
      return {
        message: action === 'publish' ? 'Done. The posting is live on the careers site.' : 'Done. The posting was saved and sent to an Admin for approval.',
        undoToken: null,
        link: `/app/jobs/${saved.jobId}`,
      };
    }
    case 'add_candidate': {
      const added = await candidates.addCandidate(addCandidateSchema.parse(a.input), ctx);
      return {
        message: a.existing ? 'Done. The applicant\'s record was updated.' : a.jobTitle ? `Done. Added and applied for ${a.jobTitle}.` : 'Done. The applicant was added.',
        undoToken: null,
        link: added.applicationId ? `/app/candidates/${added.applicationId}` : '/app/candidates',
      };
    }
    case 'approve_job':
    case 'reject_job': {
      if (!canPublishJobs(user)) throw forbidden('Only an Admin with the Job posting permission can approve or reject postings.');
      await jobs.decide(a.jobId, { decision: a.kind === 'approve_job' ? 'approve_publish' : 'reject', note: a.note }, ctx);
      return { message: a.kind === 'approve_job' ? 'Done. Approved and published.' : 'Done. The posting was rejected and the submitter was told why.', undoToken: null, link: '/app/jobs/approvals' };
    }
  }
}

/** Moves the candidate back to where they were before a confirmed move. */
export async function undo(token: string, ctx: Ctx): Promise<AssistantConfirmDto> {
  const a = readToken<{ applicationId: number; stage: Stage }>(token, 'undo', ctx.user.id);
  if (!a) throw new AppError(410, 'conflict', 'This can no longer be undone from here. Move the candidate on the board instead.');
  const moved = await pipeline.moveStage(a.applicationId, { stage: a.stage, override: ctx.user.role === 'admin', notifyApplicant: false }, ctx.user, ctx.ip);
  await auditQuietly({ userId: ctx.user.id, action: 'assistant_undo', entityType: 'application', entityId: a.applicationId, details: { to: moved.to }, ip: ctx.ip });
  return { message: `Undone. Back in ${STAGE_LABELS[moved.to]}.`, undoToken: null, link: `/app/candidates/${a.applicationId}` };
}

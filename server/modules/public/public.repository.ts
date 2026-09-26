import { sql, type Db } from '../../db/client.js';
import type { EmploymentType } from '../../../shared/domain/jobs.js';
import type { Stage, ApplicationStatus } from '../../../shared/domain/pipeline.js';
import type { CandidateRequestState, InterviewStatus, InterviewType, MeetingState, MeetingType } from '../../../shared/domain/interviews.js';

export interface PublicJobRow {
  id: number;
  slug: string;
  title: string;
  department: string | null;
  location: string | null;
  employment_type: EmploymentType;
  tags: string | null;
  is_urgent: boolean;
  applicant_limit: number | null;
  applications: number;
  published_at: Date | null;
  created_at: Date;
  description: string | null;
  requirements: string | null;
  responsibilities: string | null;
  qualifications: string | null;
  preferred_skills: string | null;
  experience_required: string | null;
  education_required: string | null;
  salary_info: string | null;
  created_by: number | null;
  owner_id: number | null;
}

const JOB_COLUMNS = sql`
  j.id, j.slug, j.title, d.name as department, j.location, j.employment_type, j.tags, j.is_urgent, j.applicant_limit,
  j.published_at, j.created_at, j.description, j.requirements, j.responsibilities, j.qualifications, j.preferred_skills,
  j.experience_required, j.education_required, j.salary_info, j.created_by, j.owner_id,
  (select count(*) from applications a where a.job_id = j.id)::int as applications`;

export async function openJobs(): Promise<PublicJobRow[]> {
  return sql<PublicJobRow[]>`
    select ${JOB_COLUMNS} from jobs j left join departments d on d.id = j.department_id
    where j.status = 'open' order by j.published_at desc nulls last, j.created_at desc`;
}

export async function openJobBySlug(slug: string): Promise<PublicJobRow | null> {
  const [row] = await sql<PublicJobRow[]>`
    select ${JOB_COLUMNS} from jobs j left join departments d on d.id = j.department_id
    where j.slug = ${slug} and j.status = 'open' limit 1`;
  return row ?? null;
}

export async function lockJobForApply(tx: Db, jobId: number): Promise<{ applicant_limit: number | null; applications: number } | null> {
  const [row] = await tx<{ applicant_limit: number | null }[]>`select applicant_limit from jobs where id = ${jobId} and status = 'open' for update`;
  if (!row) return null;
  const [c] = await tx<{ n: number }[]>`select count(*)::int as n from applications where job_id = ${jobId}`;
  return { applicant_limit: row.applicant_limit, applications: c?.n ?? 0 };
}

export interface StatusRow {
  id: number;
  stage: Stage;
  status: ApplicationStatus;
  applied_at: Date;
  updated_at: Date;
  title: string;
  first_name: string;
  last_name: string;
  candidate_id: number;
  department: string | null;
  location: string | null;
}

export async function applicationForEmail(id: number, email: string): Promise<StatusRow | null> {
  const [row] = await sql<StatusRow[]>`
    select a.id, a.stage, a.status, a.applied_at, a.updated_at, j.title, c.first_name, c.last_name, c.id as candidate_id,
           d.name as department, j.location
    from applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id left join departments d on d.id = j.department_id
    where a.id = ${id} and c.email = ${email} limit 1`;
  return row ?? null;
}

export async function applicationsForEmail(email: string) {
  return sql<{ id: number; stage: Stage; status: ApplicationStatus; applied_at: Date; title: string }[]>`
    select a.id, a.stage, a.status, a.applied_at, j.title
    from applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id
    where c.email = ${email} order by a.applied_at desc`;
}

export async function latestFeedback(applicationId: number) {
  const [row] = await sql<{ fit: string; notes: string | null }[]>`
    select fit, notes from candidate_feedback where application_id = ${applicationId} order by created_at desc limit 1`;
  return row ?? null;
}

export async function latestSuggestion(applicationId: number) {
  const [row] = await sql<{ title: string; slug: string; status: string; note: string | null }[]>`
    select j.title, j.slug, j.status, s.note from candidate_role_suggestions s join jobs j on j.id = s.suggested_job_id
    where s.application_id = ${applicationId} order by s.created_at desc limit 1`;
  return row ?? null;
}

export interface CandidateInterviewRow {
  id: number;
  meeting_type: MeetingType;
  interview_type: InterviewType;
  starts_at: Date;
  ends_at: Date | null;
  status: InterviewStatus;
  meeting_state: MeetingState;
  room_code: string | null;
  candidate_token: string | null;
  meeting_url: string | null;
  location: string | null;
  candidate_request_state: CandidateRequestState;
  interviewer_last_seen: Date | null;
  interviewer_name: string | null;
}

/** Interviews a candidate should see: not cancelled, not yet reviewed, from yesterday on. */
export async function upcomingInterviewsFor(applicationId: number): Promise<CandidateInterviewRow[]> {
  return sql<CandidateInterviewRow[]>`
    select i.id, i.meeting_type, i.interview_type, i.starts_at, i.ends_at, i.status, i.meeting_state, i.room_code,
           i.candidate_token, i.meeting_url, i.location, i.candidate_request_state, i.interviewer_last_seen, u.name as interviewer_name
    from interviews i left join users u on u.id = i.interviewer_id
    where i.application_id = ${applicationId} and i.status <> 'cancelled' and i.meeting_state <> 'reviewed'
      and i.starts_at >= now() - interval '1 day'
    order by i.starts_at asc`;
}

/** Candidate-safe history: stage moves, scheduled interviews and a withdrawal. No notes or reviewer data. */
export async function applicationEvents(applicationId: number) {
  return sql<{ id: number; action: string; details: Record<string, unknown> | null; created_at: Date }[]>`
    select l.id, l.action, l.details, l.created_at from audit_logs l
    where (l.entity_type = 'application' and l.entity_id = ${applicationId} and l.action in ('pipeline_stage_move','application_withdrawn'))
       or (l.entity_type = 'interview' and l.action = 'interview_create' and l.entity_id in (select id from interviews where application_id = ${applicationId}))
    order by l.created_at desc, l.id desc`;
}

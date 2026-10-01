import { sql, type Db } from '../../db/client.js';
import type { ExperienceLevel, FeedbackFit, ReviewStage, Stage } from '../../../shared/domain/pipeline.js';
import type { EmploymentType } from '../../../shared/domain/jobs.js';
import type { EmployeeStatus } from '../../../shared/domain/people.js';
import type { InterviewStatus, InterviewType, MeetingState, MeetingType, Recommendation } from '../../../shared/domain/interviews.js';
import type { CandidateListQuery } from '../../../shared/api/candidates.js';

export const PAGE_SIZE = 25;

export interface ListRow {
  application_id: number;
  candidate_id: number;
  first_name: string;
  last_name: string;
  email: string;
  profile_image: string | null;
  stage: Stage;
  job_id: number;
  job_title: string;
  rating: number;
  source: string;
  owner_name: string | null;
  applied_at: Date;
  resume_path: string | null;
  primary_doc_id: number | null;
  total: number;
}

const SORTS = {
  recent: sql`a.applied_at desc`,
  oldest: sql`a.applied_at asc`,
  name: sql`c.first_name asc, c.last_name asc`,
  rating: sql`c.rating desc, a.applied_at desc`,
  role: sql`j.title asc, a.applied_at desc`,
} as const;

/** Active applications, filtered in SQL so counts and rows always agree. */
export async function listCandidates(q: CandidateListQuery & { sort: keyof typeof SORTS; page: number }): Promise<ListRow[]> {
  const search = q.q ? q.q.trim() : '';
  const tsQuery = search
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}@.+-]/gu, ''))
    .filter(Boolean)
    .map((w) => `${w}:*`)
    .join(' & ');
  return sql<ListRow[]>`
    select a.id as application_id, c.id as candidate_id, c.first_name, c.last_name, c.email::text, c.profile_image, a.stage,
           j.id as job_id, j.title as job_title, c.rating, c.source, u.name as owner_name, a.applied_at, c.resume_path,
           (select d.id from candidate_documents d where d.candidate_id = c.id and d.is_primary order by d.created_at desc limit 1) as primary_doc_id,
           count(*) over()::int as total
    from applications a
    join candidates c on c.id = a.candidate_id
    join jobs j on j.id = a.job_id
    left join users u on u.id = a.assigned_to
    where a.status = 'active'
      ${q.stage ? sql`and a.stage = ${q.stage}` : sql``}
      ${q.job ? sql`and j.id = ${q.job}` : sql``}
      ${q.owner ? sql`and a.assigned_to = ${q.owner}` : sql``}
      ${q.rating === 'unrated' ? sql`and c.rating = 0` : typeof q.rating === 'number' ? sql`and c.rating >= ${q.rating}` : sql``}
      ${search
        ? sql`and (c.search_vector @@ to_tsquery('simple', ${tsQuery || search})
                   or j.title ilike ${'%' + search + '%'}
                   or (c.first_name || ' ' || c.last_name) ilike ${'%' + search + '%'})`
        : sql``}
    order by ${SORTS[q.sort]}
    limit ${PAGE_SIZE} offset ${(q.page - 1) * PAGE_SIZE}`;
}

export async function stageCounts(): Promise<Array<{ stage: Stage; n: number }>> {
  return sql`select stage, count(*)::int as n from applications where status = 'active' group by stage`;
}

export async function filterOptions() {
  const [jobs, owners] = await Promise.all([
    sql<{ id: number; title: string }[]>`select distinct j.id, j.title from jobs j join applications a on a.job_id = j.id where a.status = 'active' order by j.title`,
    sql<{ id: number; name: string }[]>`select distinct u.id, u.name from users u join applications a on a.assigned_to = u.id where a.status = 'active' order by u.name`,
  ]);
  return { jobs, owners };
}

export interface ProfileRow {
  application_id: number;
  stage: Stage;
  app_status: 'active' | 'withdrawn';
  applied_at: Date;
  updated_at: Date;
  cover_letter: string | null;
  why_us: string | null;
  assigned_to: number | null;
  assigned_name: string | null;
  candidate_id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  rating: number;
  resume_path: string | null;
  profile_image: string | null;
  portfolio_url: string | null;
  source: string;
  consent_at: Date | null;
  candidate_created: Date;
  current_title: string | null;
  experience_level: ExperienceLevel | null;
  skills: string | null;
  education: string | null;
  candidate_notes: string | null;
  record_status: 'draft' | 'active';
  resume_len: number;
  job_id: number;
  job_title: string;
  job_tags: string | null;
  job_location: string | null;
  employment_type: EmploymentType;
  department: string | null;
}

export async function profile(applicationId: number): Promise<ProfileRow | null> {
  const [row] = await sql<ProfileRow[]>`
    select a.id as application_id, a.stage, a.status as app_status, a.applied_at, a.updated_at, a.cover_letter, a.why_us,
           a.assigned_to, u.name as assigned_name,
           c.id as candidate_id, c.first_name, c.last_name, c.email::text, c.phone, c.rating, c.resume_path, c.profile_image,
           c.portfolio_url, c.source, c.consent_at, c.created_at as candidate_created, c.current_title, c.experience_level,
           c.skills, c.education, c.notes as candidate_notes, c.record_status, char_length(coalesce(c.resume_text, ''))::int as resume_len,
           j.id as job_id, j.title as job_title, j.tags as job_tags, j.location as job_location, j.employment_type, d.name as department
    from applications a
    join candidates c on c.id = a.candidate_id
    join jobs j on j.id = a.job_id
    left join departments d on d.id = j.department_id
    left join users u on u.id = a.assigned_to
    where a.id = ${applicationId} limit 1`;
  return row ?? null;
}

export const otherApplications = (candidateId: number, applicationId: number) =>
  sql<{ application_id: number; job_title: string; stage: Stage; status: string }[]>`
    select a.id as application_id, j.title as job_title, a.stage, a.status from applications a join jobs j on j.id = a.job_id
    where a.candidate_id = ${candidateId} and a.id <> ${applicationId} order by a.applied_at desc`;

export const documents = (candidateId: number) =>
  sql<{ id: number; original_name: string; extension: 'pdf' | 'doc' | 'docx'; byte_size: number; is_primary: boolean; parsed: boolean; uploader: string | null; created_at: Date }[]>`
    select d.id, d.original_name, d.extension, d.byte_size, d.is_primary, d.parsed, u.name as uploader, d.created_at
    from candidate_documents d left join users u on u.id = d.uploaded_by
    where d.candidate_id = ${candidateId} order by d.is_primary desc, d.created_at desc`;

export const notes = (candidateId: number) =>
  sql<{ id: number; note: string; author: string | null; created_at: Date }[]>`
    select n.id, n.note, u.name as author, n.created_at from candidate_notes n left join users u on u.id = n.author_id
    where n.candidate_id = ${candidateId} order by n.created_at desc`;

export const feedback = (applicationId: number) =>
  sql<{ id: number; fit: FeedbackFit; notes: string | null; author: string | null; created_at: Date }[]>`
    select f.id, f.fit, f.notes, u.name as author, f.created_at from candidate_feedback f left join users u on u.id = f.author_id
    where f.application_id = ${applicationId} order by f.created_at desc`;

export const suggestions = (applicationId: number) =>
  sql<{ id: number; job_id: number; job_title: string; note: string | null; author: string | null; created_at: Date }[]>`
    select s.id, s.suggested_job_id as job_id, j.title as job_title, s.note, case when s.from_ai then 'AI match' else u.name end as author, s.created_at
    from candidate_role_suggestions s join jobs j on j.id = s.suggested_job_id left join users u on u.id = s.author_id
    where s.application_id = ${applicationId} order by s.created_at desc`;

export const openRolesExcept = (jobId: number) =>
  sql<{ id: number; title: string }[]>`select id, title from jobs where status = 'open' and id <> ${jobId} order by title`;

export const stageReviews = (applicationId: number) =>
  sql<{ stage_type: ReviewStage; rating: number | null; feedback: string | null; notes: string | null; reviewer: string | null; updated_at: Date }[]>`
    select r.stage_type, r.rating, r.feedback, r.notes, u.name as reviewer, r.updated_at
    from stage_reviews r left join users u on u.id = r.reviewer_id where r.application_id = ${applicationId}`;

export async function aiAnalysis(applicationId: number) {
  const [row] = await sql<{ overall_score: number; category_scores: Record<string, number>; summary: string; strengths: string[]; concerns: string[]; recommendation: string; ai_notes: string; generated_at: Date }[]>`
    select overall_score, category_scores, summary, strengths, concerns, recommendation, ai_notes, generated_at
    from candidate_ai_analysis where application_id = ${applicationId}`;
  return row ?? null;
}

export const interviewHistory = (candidateId: number) =>
  sql<{ id: number; meeting_type: MeetingType; interview_type: InterviewType; starts_at: Date; status: InterviewStatus; meeting_state: MeetingState; job_title: string; interviewer_name: string | null; reviewer_name: string | null; score: number | null; recommendation: Recommendation | null; feedback: string | null; live_notes: string | null; room_code: string | null }[]>`
    select i.id, i.meeting_type, i.interview_type, i.starts_at, i.status, i.meeting_state, j.title as job_title,
           u.name as interviewer_name, rv.name as reviewer_name, i.score, i.recommendation, i.feedback, i.live_notes, i.room_code
    from interviews i join applications a on a.id = i.application_id join jobs j on j.id = a.job_id
    left join users u on u.id = i.interviewer_id left join users rv on rv.id = i.reviewer_id
    where a.candidate_id = ${candidateId} order by i.starts_at desc`;

export const activity = (applicationId: number, candidateId: number) =>
  sql<{ id: number; action: string; actor: string | null; details: Record<string, unknown> | null; created_at: Date }[]>`
    select al.id, al.action, u.name as actor, al.details, al.created_at from audit_logs al left join users u on u.id = al.user_id
    where (al.entity_type = 'application' and al.entity_id = ${applicationId}) or (al.entity_type = 'candidate' and al.entity_id = ${candidateId})
    order by al.created_at desc limit 25`;

export async function employeeForApplication(applicationId: number) {
  const [row] = await sql<{ id: number; employee_number: string | null; job_title: string | null; department: string | null; start_date: string | null; status: EmployeeStatus }[]>`
    select e.id, e.employee_number, e.job_title, d.name as department, to_char(e.start_date, 'YYYY-MM-DD') as start_date, e.status
    from employees e left join departments d on d.id = e.department_id where e.application_id = ${applicationId}`;
  return row ?? null;
}

export const departments = () => sql<{ id: number; name: string }[]>`select id, name from departments order by name`;

export async function applicationBasics(applicationId: number, db: Db = sql) {
  const [row] = await db<{ id: number; candidate_id: number; job_id: number; stage: Stage; status: string; assigned_to: number | null; first_name: string; last_name: string; email: string; job_title: string; cover_letter: string | null; why_us: string | null; portfolio_url: string | null; resume_path: string | null; job_tags: string | null }[]>`
    select a.id, a.candidate_id, a.job_id, a.stage, a.status, a.assigned_to, c.first_name, c.last_name, c.email::text, j.title as job_title,
           a.cover_letter, a.why_us, c.portfolio_url, c.resume_path, j.tags as job_tags
    from applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id where a.id = ${applicationId}`;
  return row ?? null;
}

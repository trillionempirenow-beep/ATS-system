import { sql, type Db } from '../../db/client.js';
import type { ApprovalStatus, EmploymentType, JobApprovalAction, JobStatus } from '../../../shared/domain/jobs.js';

export interface JobRow {
  id: number;
  title: string;
  slug: string;
  department_id: number | null;
  department: string | null;
  location: string | null;
  employment_type: EmploymentType;
  tags: string | null;
  applicant_limit: number | null;
  is_urgent: boolean;
  status: JobStatus;
  approval_status: ApprovalStatus;
  owner_id: number | null;
  created_by: number | null;
  submitted_by: number | null;
  submitted_at: Date | null;
  reviewed_by: number | null;
  reviewed_at: Date | null;
  review_note: string | null;
  published_at: Date | null;
  created_at: Date;
  matched_at: Date | null;
  matching_started_at: Date | null;
  matching_error: string | null;
  description: string | null;
  requirements: string | null;
  responsibilities: string | null;
  qualifications: string | null;
  preferred_skills: string | null;
  experience_required: string | null;
  education_required: string | null;
  salary_info: string | null;
  source_pdf: string | null;
  applications: number;
  creator_name: string | null;
  creator_email: string | null;
  reviewer_name: string | null;
  submitter_name: string | null;
}

const SELECT = sql`
  select j.*, d.name as department, cu.name as creator_name, cu.email::text as creator_email, rv.name as reviewer_name, su.name as submitter_name,
         (select count(*)::int from applications a where a.job_id = j.id) as applications
  from jobs j
  left join departments d on d.id = j.department_id
  left join users cu on cu.id = j.created_by
  left join users rv on rv.id = j.reviewed_by
  left join users su on su.id = j.submitted_by`;

export const allJobs = () => sql<JobRow[]>`${SELECT} order by j.created_at desc`;
export const jobsOwnedBy = (userId: number) => sql<JobRow[]>`${SELECT} where j.created_by = ${userId} or j.owner_id = ${userId} order by j.created_at desc`;
export const pendingQueue = () => sql<JobRow[]>`${SELECT} where j.approval_status = 'pending' order by j.submitted_at asc nulls last, j.created_at asc`;
export const recentlyDecided = () =>
  sql<JobRow[]>`${SELECT} where j.approval_status in ('approved','rejected','changes_requested') and j.reviewed_at is not null order by j.reviewed_at desc limit 12`;

export async function byId(id: number, db: Db = sql): Promise<JobRow | null> {
  const [row] = await db<JobRow[]>`${SELECT} where j.id = ${id}`;
  return row ?? null;
}

export async function lockById(tx: Db, id: number): Promise<JobRow | null> {
  const [row] = await tx<JobRow[]>`select j.*, null as department, 0 as applications, null as creator_name, null as creator_email,
                                           null as reviewer_name, null as submitter_name from jobs j where j.id = ${id} for update`;
  return row ?? null;
}

export async function history(jobId: number) {
  return sql<{ id: number; action: JobApprovalAction; note: string | null; actor_name: string | null; actor_role: string | null; created_at: Date }[]>`
    select ja.id, ja.action, ja.note, u.name as actor_name, u.role as actor_role, ja.created_at
    from job_approvals ja left join users u on u.id = ja.actor_id where ja.job_id = ${jobId} order by ja.created_at asc, ja.id asc`;
}

export async function recordApproval(db: Db, jobId: number, action: JobApprovalAction, actorId: number, note: string | null = null): Promise<void> {
  await db`insert into job_approvals (job_id, actor_id, action, note) values (${jobId}, ${actorId}, ${action}, ${note})`;
}

export async function uniqueSlug(db: Db, title: string, ignoreId: number | null): Promise<string> {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `job-${Math.random().toString(16).slice(2, 8)}`;
  let slug = base;
  for (let n = 2; n < 200; n++) {
    const [hit] = await db<{ id: number }[]>`select id from jobs where slug = ${slug} and id <> ${ignoreId ?? 0} limit 1`;
    if (!hit) return slug;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export const departments = () =>
  sql<{ id: number; name: string; description: string | null; job_count: number }[]>`
    select d.id, d.name, d.description, (select count(*)::int from jobs j where j.department_id = d.id) as job_count
    from departments d order by d.name`;

import { sql, type Db } from '../../db/client.js';
import type { Stage } from '../../../shared/domain/pipeline.js';
import type { CandidateRequestState, InterviewStatus, InterviewType, MeetingState, MeetingType, Recommendation } from '../../../shared/domain/interviews.js';

export interface InterviewRow {
  id: number;
  application_id: number;
  interviewer_id: number | null;
  meeting_type: MeetingType;
  starts_at: Date;
  ends_at: Date | null;
  timezone: string | null;
  interview_type: InterviewType;
  meeting_url: string | null;
  meeting_provider: string;
  room_code: string | null;
  candidate_token: string | null;
  location: string | null;
  status: InterviewStatus;
  meeting_state: MeetingState;
  notes: string | null;
  live_notes: string | null;
  notes_updated_at: Date | null;
  feedback: string | null;
  score: number | null;
  recommendation: Recommendation | null;
  started_at: Date | null;
  ended_at: Date | null;
  reviewed_at: Date | null;
  reviewer_id: number | null;
  candidate_request_state: CandidateRequestState;
  candidate_requested_at: Date | null;
  candidate_last_seen: Date | null;
  interviewer_last_seen: Date | null;
  assistant_enabled: boolean;
  reminder_sent_at: Date | null;
  candidate_id: number;
  first_name: string;
  last_name: string;
  email: string;
  profile_image: string | null;
  job_title: string;
  stage: Stage;
  interviewer_name: string | null;
  reviewer_name: string | null;
}

const SELECT = sql`
  select i.id, i.application_id, i.interviewer_id, i.meeting_type, i.starts_at, i.ends_at, i.timezone, i.interview_type, i.meeting_url,
         i.meeting_provider, i.room_code, i.candidate_token, i.location, i.status, i.meeting_state, i.notes, i.live_notes, i.notes_updated_at,
         i.feedback, i.score, i.recommendation, i.started_at, i.ended_at, i.reviewed_at, i.reviewer_id, i.candidate_request_state,
         i.candidate_requested_at, i.candidate_last_seen, i.interviewer_last_seen, i.assistant_enabled, i.reminder_sent_at,
         c.id as candidate_id, c.first_name, c.last_name, c.email::text, c.profile_image, j.title as job_title, a.stage,
         u.name as interviewer_name, rv.name as reviewer_name
  from interviews i
  join applications a on a.id = i.application_id
  join candidates c on c.id = a.candidate_id
  join jobs j on j.id = a.job_id
  left join users u on u.id = i.interviewer_id
  left join users rv on rv.id = i.reviewer_id`;

export const listAll = () => sql<InterviewRow[]>`${SELECT} order by i.starts_at desc limit 500`;

export async function byId(id: number, db: Db = sql): Promise<InterviewRow | null> {
  const [row] = await db<InterviewRow[]>`${SELECT} where i.id = ${id} limit 1`;
  return row ?? null;
}

export async function byRoomCode(code: string): Promise<InterviewRow | null> {
  const [row] = await sql<InterviewRow[]>`${SELECT} where i.room_code = ${code} limit 1`;
  return row ?? null;
}

export const scheduleApplications = () =>
  sql<{ id: number; first_name: string; last_name: string; title: string; stage: Stage }[]>`
    select a.id, c.first_name, c.last_name, j.title, a.stage from applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id
    where a.status = 'active' and a.stage not in ('hired','rejected') order by c.last_name, c.first_name`;

export const interviewers = () =>
  sql<{ id: number; name: string; role: string; upcoming_count: number }[]>`
    select u.id, u.name, u.role,
           (select count(*)::int from interviews i where i.interviewer_id = u.id and i.starts_at >= now() and i.status not in ('cancelled','no_show')) as upcoming_count
    from users u where u.role in ('admin','recruiter','hiring_manager') and u.active order by upcoming_count asc, u.name asc`;

export const busySlots = () =>
  sql<{ interviewer_id: number; starts_at: Date }[]>`
    select interviewer_id, starts_at from interviews where starts_at >= now() and status <> 'cancelled' and interviewer_id is not null`;

export async function scorecardFor(interviewId: number, reviewerId: number): Promise<Record<string, number>> {
  const rows = await sql<{ criterion: string; rating: number }[]>`
    select criterion, rating from scorecard_ratings where interview_id = ${interviewId} and reviewer_id = ${reviewerId}`;
  return Object.fromEntries(rows.map((r) => [r.criterion, r.rating]));
}

export const momentsFor = (interviewId: number) =>
  sql<{ id: number; at_second: number; label: string; author: string | null }[]>`
    select m.id, m.at_second, m.label, u.name as author from interview_moments m left join users u on u.id = m.user_id
    where m.interview_id = ${interviewId} order by m.at_second`;

export const assistantNotesFor = (interviewId: number) =>
  sql<{ at_second: number; topic: string | null; text: string }[]>`
    select at_second, topic, text from assistant_notes where interview_id = ${interviewId} order by at_second`;

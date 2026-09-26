import type { z } from 'zod';
import { ACCOUNT_STATUS_LABELS, isAdminLevel, isSuperAdmin, type AccountStatus, type Role } from '../../../shared/domain/access.js';
import { interviewDisplayState, type InterviewStatus, type MeetingState } from '../../../shared/domain/interviews.js';
import { jobState, type ApprovalStatus, type JobStatus } from '../../../shared/domain/jobs.js';
import { RANGE_LABELS, type RangeKey } from '../../../shared/domain/people.js';
import { STAGE_ORDER, type Stage } from '../../../shared/domain/pipeline.js';
import type {
  AnalyticsDto, CandidateMetrics, DashboardDto, InterviewMetrics, PersonalAnalyticsDto, ReportDto, TeamAnalyticsDto, TeamRow, analyticsQuerySchema,
} from '../../../shared/api/insights.js';
import { env } from '../../config/env.js';
import { sql } from '../../db/client.js';
import type { CurrentUser } from '../../http/context.js';
import { forbidden } from '../../http/errors.js';
import { fullName, isoOrThrow, todayInZone } from '../../lib/format.js';
import { avatarUrlForCandidate } from '../media/media.urls.js';

const TZ = env.APP_TIMEZONE;

export async function dashboard(): Promise<DashboardDto> {
  const [[s], trendRows, funnelRows, upcoming, recent, jobs] = await Promise.all([
    sql<{ open_roles: number; open_prev: number; active: number; active_prev: number; week_iv: number; hired_month: number; apps_week: number; apps_prev: number }[]>`
      select (select count(*)::int from jobs where status = 'open') as open_roles,
             (select count(*)::int from jobs where status = 'open' and published_at < now() - interval '7 days') as open_prev,
             (select count(*)::int from applications where status = 'active' and stage not in ('hired','rejected')) as active,
             (select count(*)::int from applications where status = 'active' and stage not in ('hired','rejected') and applied_at < now() - interval '7 days') as active_prev,
             (select count(*)::int from interviews where starts_at between now() and now() + interval '7 days' and status not in ('cancelled','no_show')) as week_iv,
             (select count(*)::int from applications where stage = 'hired' and updated_at >= date_trunc('month', now() at time zone ${TZ}) at time zone ${TZ}) as hired_month,
             (select count(*)::int from applications where applied_at >= now() - interval '7 days') as apps_week,
             (select count(*)::int from applications where applied_at >= now() - interval '14 days' and applied_at < now() - interval '7 days') as apps_prev`,
    sql<{ d: string; c: number }[]>`
      select to_char(applied_at at time zone ${TZ}, 'YYYY-MM-DD') as d, count(*)::int as c from applications
      where applied_at >= (date_trunc('day', now() at time zone ${TZ}) - interval '13 days') at time zone ${TZ} group by 1`,
    sql<{ stage: Stage; n: number }[]>`select stage, count(*)::int as n from applications where status = 'active' and stage <> 'rejected' group by stage`,
    sql<{ id: number; starts_at: Date; first_name: string; last_name: string; candidate_id: number; profile_image: string | null; title: string; meeting_type: 'screening' | 'interview'; interview_type: 'phone' | 'video' | 'onsite' | 'panel'; status: InterviewStatus; meeting_state: MeetingState }[]>`
      select i.id, i.starts_at, c.first_name, c.last_name, c.id as candidate_id, c.profile_image, j.title, i.meeting_type, i.interview_type, i.status, i.meeting_state
      from interviews i join applications a on a.id = i.application_id join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id
      where i.starts_at >= now() - interval '1 hour' and i.status not in ('cancelled','no_show') and i.meeting_state in ('scheduled','ready','in_progress')
      order by i.starts_at asc limit 5`,
    sql<{ id: number; first_name: string; last_name: string; email: string; candidate_id: number; profile_image: string | null; title: string; stage: Stage; updated_at: Date }[]>`
      select a.id, c.first_name, c.last_name, c.email::text, c.id as candidate_id, c.profile_image, j.title, a.stage, a.updated_at
      from applications a join candidates c on c.id = a.candidate_id join jobs j on j.id = a.job_id where a.status = 'active' order by a.updated_at desc limit 8`,
    sql<{ id: number; title: string; department: string | null; applications: number; status: JobStatus; approval_status: ApprovalStatus }[]>`
      select j.id, j.title, d.name as department, j.status, j.approval_status,
             (select count(*)::int from applications a where a.job_id = j.id and a.status = 'active' and a.stage = 'new') as applications
      from jobs j left join departments d on d.id = j.department_id where j.status = 'open' order by applications desc, j.published_at desc limit 4`,
  ]);
  const byDay = new Map(trendRows.map((r) => [r.d, r.c]));
  const today = todayInZone();
  const trend = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (13 - i));
    const key = d.toISOString().slice(0, 10);
    return { date: key, count: byDay.get(key) ?? 0 };
  });
  const counts = new Map(funnelRows.map((r) => [r.stage, r.n]));
  return {
    stats: {
      openRoles: { value: s!.open_roles, delta: s!.open_roles - s!.open_prev },
      activeCandidates: { value: s!.active, delta: s!.active - s!.active_prev },
      interviewsThisWeek: { value: s!.week_iv },
      hiredThisMonth: { value: s!.hired_month },
      applicationsThisWeek: { value: s!.apps_week, delta: s!.apps_week - s!.apps_prev },
    },
    trend,
    funnel: STAGE_ORDER.map((stage) => ({ stage, count: counts.get(stage) ?? 0 })),
    upcoming: upcoming.map((u) => ({
      id: u.id, startsAt: isoOrThrow(u.starts_at), candidateName: fullName(u.first_name, u.last_name), avatarUrl: avatarUrlForCandidate(u.candidate_id, u.profile_image),
      jobTitle: u.title, meetingType: u.meeting_type, interviewType: u.interview_type,
      state: interviewDisplayState({ status: u.status, meeting_state: u.meeting_state, starts_at: isoOrThrow(u.starts_at) }),
    })),
    recent: recent.map((r) => ({ applicationId: r.id, candidateName: fullName(r.first_name, r.last_name), email: r.email, avatarUrl: avatarUrlForCandidate(r.candidate_id, r.profile_image), jobTitle: r.title, stage: r.stage, updatedAt: isoOrThrow(r.updated_at) })),
    jobsToReview: jobs.map((j) => ({ id: j.id, title: j.title, department: j.department, applications: j.applications, state: jobState(j) })),
  };
}

// ---------------------------------------------------------------------------
// Analytics (port of includes/analytics_lib.php)
// ---------------------------------------------------------------------------

function resolveRange(key: RangeKey, from?: string, to?: string): { from: string | null; to: string | null; label: string } {
  const today = todayInZone();
  const shift = (days: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  switch (key) {
    case 'today': return { from: today, to: today, label: 'Today' };
    case 'week': { const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; return { from: shift(-dow), to: today, label: 'This week' }; }
    case 'month': return { from: `${today.slice(0, 8)}01`, to: today, label: 'This month' };
    case 'quarter': { const d = new Date(`${today}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 3); return { from: d.toISOString().slice(0, 10), to: today, label: 'Last 3 months' }; }
    case 'custom': {
      let f = from ?? `${today.slice(0, 8)}01`; let t = to ?? today;
      if (f > t) [f, t] = [t, f];
      const fmt = (x: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${x}T12:00:00Z`));
      return { from: f, to: t, label: `${fmt(f)} – ${fmt(t)}` };
    }
    default: return { from: null, to: null, label: 'All time' };
  }
}

const rangeSql = (from: string | null, to: string | null, column: ReturnType<typeof sql>) =>
  from && to
    ? sql`and ${column} >= ${`${from}T00:00:00`}::timestamp at time zone ${TZ} and ${column} <= ${`${to}T23:59:59`}::timestamp at time zone ${TZ}`
    : sql``;

/** Whose candidates: assigned to them, or unassigned on a job they created or own. */
const ownedSql = (userId: number) => sql`and (a.assigned_to = ${userId} or (a.assigned_to is null and (j.created_by = ${userId} or j.owner_id = ${userId})))`;

async function candidateMetrics(userId: number, from: string | null, to: string | null): Promise<CandidateMetrics> {
  const rows = await sql<{ stage: Stage; status: string; n: number }[]>`
    select a.stage, a.status, count(*)::int as n from applications a join jobs j on j.id = a.job_id
    where true ${ownedSql(userId)} ${rangeSql(from, to, sql`a.applied_at`)} group by a.stage, a.status`;
  const m: CandidateMetrics = { assigned: 0, processing: 0, shortlisted: 0, contacted: 0, inInterview: 0, offer: 0, hired: 0, rejected: 0, withdrawn: 0 };
  for (const r of rows) {
    m.assigned += r.n;
    if (r.status === 'withdrawn') { m.withdrawn += r.n; continue; }
    if (r.stage === 'screening') { m.shortlisted += r.n; m.contacted += r.n; m.processing += r.n; }
    else if (r.stage === 'interview') { m.inInterview += r.n; m.contacted += r.n; m.processing += r.n; }
    else if (r.stage === 'offer') { m.offer += r.n; m.contacted += r.n; m.processing += r.n; }
    else if (r.stage === 'hired') m.hired += r.n;
    else if (r.stage === 'rejected') m.rejected += r.n;
    else m.processing += r.n;
  }
  return m;
}

async function funnel(userId: number, from: string | null, to: string | null) {
  const labels: Record<string, string> = { new: 'Applied', screening: 'Shortlisted', interview: 'Interview', offer: 'Offer', hired: 'Hired' };
  const rows = await sql<{ stage: Stage; n: number }[]>`
    select a.stage, count(*)::int as n from applications a join jobs j on j.id = a.job_id
    where a.status = 'active' ${ownedSql(userId)} ${rangeSql(from, to, sql`a.applied_at`)} group by a.stage`;
  return STAGE_ORDER.map((key, i) => ({
    label: labels[key]!,
    count: rows.filter((r) => STAGE_ORDER.indexOf(r.stage as (typeof STAGE_ORDER)[number]) >= i).reduce((s, r) => s + r.n, 0),
  }));
}

async function interviewMetrics(userId: number, from: string | null, to: string | null): Promise<InterviewMetrics> {
  const rows = await sql<{ status: InterviewStatus; meeting_state: MeetingState; starts_at: Date; score: number | null }[]>`
    select i.status, i.meeting_state, i.starts_at, i.score from interviews i where i.interviewer_id = ${userId} ${rangeSql(from, to, sql`i.starts_at`)}`;
  const m: InterviewMetrics = { total: 0, upcoming: 0, completed: 0, cancelled: 0, inProgress: 0, awaitingReview: 0, reviewed: 0, avgScore: null, scored: 0 };
  let sum = 0;
  for (const r of rows) {
    m.total++;
    const st = interviewDisplayState({ status: r.status, meeting_state: r.meeting_state, starts_at: isoOrThrow(r.starts_at) });
    if (st === 'cancelled' || st === 'no_show') { m.cancelled++; continue; }
    if (st === 'in_progress') m.inProgress++;
    if (st === 'review_pending') m.awaitingReview++;
    if (st === 'reviewed') m.reviewed++;
    if (st === 'ended' || st === 'review_pending' || st === 'reviewed') m.completed++;
    if ((st === 'scheduled' || st === 'ready') && r.starts_at.getTime() >= Date.now()) m.upcoming++;
    if (r.score !== null) { m.scored++; sum += r.score; }
  }
  if (m.scored) m.avgScore = Math.round(sum / m.scored);
  return m;
}

async function outcomes(userId: number, from: string | null, to: string | null) {
  const rows = await sql<{ stage: Stage; n: number }[]>`
    select a.stage, count(distinct a.id)::int as n from interviews i join applications a on a.id = i.application_id
    where i.interviewer_id = ${userId} and i.meeting_state in ('ended','review_pending','reviewed') ${rangeSql(from, to, sql`i.starts_at`)} group by a.stage`;
  return {
    progressed: rows.filter((r) => r.stage === 'offer' || r.stage === 'hired').reduce((s, r) => s + r.n, 0),
    notProgressed: rows.filter((r) => r.stage === 'rejected').reduce((s, r) => s + r.n, 0),
  };
}

async function timeline(userId: number, from: string | null, to: string | null, buckets = 8) {
  const today = todayInZone();
  const end = to ?? today;
  const start = from ?? (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 56); return d.toISOString().slice(0, 10); })();
  const rows = await sql<{ d: string; n: number }[]>`
    select to_char(i.starts_at at time zone ${TZ}, 'YYYY-MM-DD') as d, count(*)::int as n from interviews i
    where i.interviewer_id = ${userId} and i.meeting_state in ('ended','review_pending','reviewed') ${rangeSql(start, end, sql`i.starts_at`)} group by 1`;
  const byDay = new Map(rows.map((r) => [r.d, r.n]));
  const startMs = Date.parse(`${start}T12:00:00Z`);
  const span = Math.max(1, Math.round((Date.parse(`${end}T12:00:00Z`) - startMs) / 86_400_000) + 1);
  const size = Math.max(1, Math.ceil(span / buckets));
  const fmt = (ms: number, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(new Date(ms));
  const out: Array<{ label: string; total: number }> = [];
  for (let off = 0; off < span; off += size) {
    const bStart = startMs + off * 86_400_000;
    const bEnd = Math.min(startMs + (span - 1) * 86_400_000, bStart + (size - 1) * 86_400_000);
    let total = 0;
    for (let t = bStart; t <= bEnd; t += 86_400_000) total += byDay.get(new Date(t).toISOString().slice(0, 10)) ?? 0;
    out.push({ label: size === 1 ? fmt(bStart, { month: 'short', day: 'numeric' }) : `${fmt(bStart, { month: 'short', day: 'numeric' })}–${fmt(bEnd, { day: 'numeric' })}`, total });
  }
  return out;
}

const ACTIVITY_TEXT: Record<string, string> = {
  pipeline_stage_move: 'Moved %s in the pipeline',
  interview_create: 'Scheduled an interview with %s',
  interview_ended: 'Ended the interview with %s',
  interview_review_submitted: 'Submitted the interview review for %s',
  interview_status: 'Updated the interview status for %s',
  candidate_note: 'Added a note on %s',
  job_submit_for_approval: 'Submitted a job posting for approval',
  job_draft_save: 'Saved a job draft',
};

async function activity(userId: number, from: string | null, to: string | null) {
  const rows = await sql<{ id: number; action: string; created_at: Date; first_name: string | null; last_name: string | null }[]>`
    select al.id, al.action, al.created_at, c.first_name, c.last_name from audit_logs al
    left join applications ap on al.entity_type = 'application' and al.entity_id = ap.id
    left join interviews iv on al.entity_type = 'interview' and al.entity_id = iv.id
    left join applications ai on ai.id = iv.application_id
    left join candidates c on c.id = coalesce(ap.candidate_id, ai.candidate_id, case when al.entity_type = 'candidate' then al.entity_id end)
    where al.user_id = ${userId} and al.action in ${sql(Object.keys(ACTIVITY_TEXT))} ${rangeSql(from, to, sql`al.created_at`)}
    order by al.created_at desc limit 12`;
  return rows.map((r) => {
    const tpl = ACTIVITY_TEXT[r.action] ?? r.action;
    const who = fullName(r.first_name, r.last_name) || 'a candidate';
    return { id: r.id, text: tpl.replace('%s', who), createdAt: isoOrThrow(r.created_at) };
  });
}

async function timeToHire(userId: number, from: string | null, to: string | null): Promise<number | null> {
  const [r] = await sql<{ days: string | null }[]>`
    select avg(extract(epoch from (a.updated_at - a.applied_at)) / 86400)::numeric(10,1)::text as days from applications a join jobs j on j.id = a.job_id
    where a.stage = 'hired' and a.updated_at >= a.applied_at ${ownedSql(userId)} ${rangeSql(from, to, sql`a.updated_at`)}`;
  return r?.days ? Number(r.days) : null;
}

async function offerAcceptance(userId: number, from: string | null, to: string | null) {
  const [r] = await sql<{ hired: number; pending: number; declined: number }[]>`
    select count(*) filter (where a.stage = 'hired')::int as hired, count(*) filter (where a.stage = 'offer')::int as pending,
           count(*) filter (where a.stage = 'rejected' and a.status = 'withdrawn')::int as declined
    from applications a join jobs j on j.id = a.job_id where true ${ownedSql(userId)} ${rangeSql(from, to, sql`a.applied_at`)}`;
  const decided = (r?.hired ?? 0) + (r?.declined ?? 0);
  return decided === 0 ? null : { rate: Math.round(((r?.hired ?? 0) / decided) * 100), hired: r!.hired, declined: r!.declined, pending: r!.pending };
}

interface Member { id: number; name: string; email: string; role: Role; account_status: AccountStatus }

async function teamMembers(user: CurrentUser): Promise<Member[]> {
  return sql<Member[]>`
    select id, name, email::text, role, account_status from users where role in ('recruiter','hiring_manager')
    ${isSuperAdmin(user) ? sql`` : sql`and created_by = ${user.id}`} order by name`;
}

async function teamRows(members: Member[], from: string | null, to: string | null): Promise<TeamRow[]> {
  return Promise.all(members.map(async (m) => {
    const [c, i] = await Promise.all([candidateMetrics(m.id, from, to), interviewMetrics(m.id, from, to)]);
    return {
      user: { id: m.id, name: m.name, email: m.email, role: m.role, accountStatus: m.account_status },
      candidates: c.assigned, processing: c.processing, interviews: i.total, completed: i.completed, hired: c.hired, rejected: c.rejected, avgScore: i.avgScore,
    };
  }));
}

export async function analytics(q: z.infer<typeof analyticsQuerySchema>, user: CurrentUser): Promise<AnalyticsDto> {
  const range = resolveRange(q.range, q.from, q.to);
  const rangeDto = { key: q.range, label: range.label || RANGE_LABELS[q.range], from: range.from, to: range.to };
  const admin = isAdminLevel(user);
  const team: Member[] = admin ? await teamMembers(user) : [];
  let subject = { id: user.id, name: user.name, role: user.role, isMe: true };
  if (q.user && q.user !== user.id) {
    const m = team.find((t) => t.id === q.user);
    if (!m) throw forbidden('You can only view analytics for HR/Recruiters you manage.');
    subject = { id: m.id, name: m.name, role: m.role, isMe: false };
  }
  if (admin && subject.isMe && q.view !== 'me') {
    const rows = await teamRows(team, range.from, range.to);
    const totals = { candidates: 0, processing: 0, interviews: 0, completed: 0, hired: 0, rejected: 0 };
    for (const r of rows) for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += r[k];
    const dto: TeamAnalyticsDto = {
      mode: 'team', range: rangeDto, rows, totals,
      members: { active: team.filter((t) => t.account_status === 'active').length, inactive: team.filter((t) => t.account_status !== 'active').length, total: team.length },
      hasData: team.length > 0,
    };
    return dto;
  }
  const [cand, fun, inter, out, tl, act, tth, offer] = await Promise.all([
    candidateMetrics(subject.id, range.from, range.to), funnel(subject.id, range.from, range.to), interviewMetrics(subject.id, range.from, range.to),
    outcomes(subject.id, range.from, range.to), timeline(subject.id, range.from, range.to), activity(subject.id, range.from, range.to),
    timeToHire(subject.id, range.from, range.to), offerAcceptance(subject.id, range.from, range.to),
  ]);
  const dto: PersonalAnalyticsDto = {
    mode: 'personal', range: rangeDto, subject, candidates: cand, funnel: fun, interviews: inter, outcomes: { progressed: out.progressed, notProgressed: out.notProgressed },
    timeline: tl, activity: act, timeToHireDays: tth, offerAcceptance: offer, hasData: cand.assigned > 0 || inter.total > 0,
    team: team.map((t) => ({ id: t.id, name: t.name })),
  };
  return dto;
}

/** analytics-report.php: Admin-only, optionally one person, with CSV export. */
export async function report(q: z.infer<typeof analyticsQuerySchema>, user: CurrentUser): Promise<ReportDto> {
  if (!isAdminLevel(user)) throw forbidden('HR/Recruiter reports are available to Admins.');
  const range = resolveRange(q.range, q.from, q.to);
  let team = await teamMembers(user);
  if (q.user) {
    if (!team.some((t) => t.id === q.user)) throw forbidden('You can only report on HR/Recruiters you manage.');
    team = team.filter((t) => t.id === q.user);
  }
  const rows = await teamRows(team, range.from, range.to);
  const totals = { candidates: 0, processing: 0, interviews: 0, completed: 0, hired: 0, rejected: 0 };
  for (const r of rows) for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += r[k];
  return { range: { key: q.range, label: range.label || RANGE_LABELS[q.range], from: range.from, to: range.to }, rows, totals, allMembers: (await teamMembers(user)).map((t) => ({ id: t.id, name: t.name })) };
}

export function reportCsv(data: ReportDto, generatedBy: string): string {
  const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines: unknown[][] = [
    ['Acme ATS — HR/Recruiter report'], ['Reporting period', data.range.label], ['Generated', new Date().toISOString()], ['Generated by', generatedBy], [],
    ['HR / Recruiter', 'Email', 'Status', 'Candidates', 'Processing', 'Interviews', 'Interviews completed', 'Hired', 'Rejected', 'Average score'],
    ...data.rows.map((r) => [r.user.name, r.user.email, ACCOUNT_STATUS_LABELS[r.user.accountStatus], r.candidates, r.processing, r.interviews, r.completed, r.hired, r.rejected, r.avgScore ?? '']),
  ];
  return lines.map((l) => l.map(cell).join(',')).join('\r\n');
}

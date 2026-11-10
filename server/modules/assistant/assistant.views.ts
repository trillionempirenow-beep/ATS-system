import type { AssistantCell, AssistantProfile, AssistantTile, AssistantView } from '../../../shared/api/assistant.js';
import { STAGE_LABELS, type Stage } from '../../../shared/domain/pipeline.js';

/**
 * Turns what the assistant looked up into tables the chat can show.
 *
 * The rows come straight from the lookup tool's own answer, not from the model's
 * wording, so the table is always exact and the model only has to say a sentence
 * about it. Only lists become tables; a single record or an empty answer does not.
 */

const MAX_ROWS = 100;
const MAX_VIEWS = 3;

const STAGE_BY_LABEL = new Map<string, Stage>((Object.entries(STAGE_LABELS) as Array<[Stage, string]>).map(([stage, label]) => [label.toLowerCase(), stage]));

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.map(obj) : []);
/** A stage written as its label ("Final interview") or its key ("final_interview"). */
const stageKey = (v: unknown): string | null => {
  const t = text(v).toLowerCase();
  return STAGE_BY_LABEL.get(t) ?? ((t in STAGE_LABELS) ? (t as Stage) : null);
};

type Row = Record<string, AssistantCell>;
interface Built { kind?: AssistantView['kind']; title: string; subtitle?: string; columns: AssistantView['columns']; rows: Row[]; tiles?: AssistantTile[]; profile?: AssistantProfile }

function candidates(result: Record<string, unknown>): Built {
  const rows = list(result.candidates).map((c): Row => ({
    name: text(c.name), job: text(c.job), stage: stageKey(c.stage), title: text(c.currentTitle) || null, applied: text(c.applied), email: text(c.email) || null,
    _link: num(c.applicationId) ? `/app/candidates/${num(c.applicationId)}` : null,
  }));
  return {
    title: 'Candidates',
    subtitle: result.moreExist === true ? `The ${rows.length} most recently updated, there are more` : undefined,
    columns: [
      { key: 'name', label: 'Candidate', sub: 'email' }, { key: 'job', label: 'Applied for' }, { key: 'stage', label: 'Stage', kind: 'stage' },
      { key: 'title', label: 'Current role' }, { key: 'applied', label: 'Applied', kind: 'date' },
    ],
    rows,
  };
}

function interviews(result: Record<string, unknown>): Built {
  const today = num(result.today);
  const week = num(result.thisWeek);
  const rows = list(result.interviews).map((i): Row => ({
    candidate: text(i.candidate), job: text(i.job), when: text(i.when), kind: [text(i.type), text(i.format)].filter(Boolean).join(' · '),
    interviewer: text(i.interviewer) || null, status: text(i.status), _link: '/app/interviews',
  }));
  return {
    title: 'Interviews',
    subtitle: today !== null && week !== null ? `${today} today · ${week} this week` : undefined,
    columns: [
      { key: 'candidate', label: 'Candidate', sub: 'job' }, { key: 'when', label: 'When', kind: 'date' }, { key: 'kind', label: 'Type' },
      { key: 'interviewer', label: 'Interviewer' }, { key: 'status', label: 'Status', kind: 'badge' },
    ],
    rows,
  };
}

function jobs(result: Record<string, unknown>): Built {
  const rows = list(result.jobs).map((j): Row => ({
    title: text(j.title), department: text(j.department) || null, location: text(j.location) || null,
    status: j.waitingForApproval === true ? 'Waiting for approval' : text(j.status), applicants: num(j.applicants) ?? 0,
    _link: num(j.id) ? `/app/jobs/${num(j.id)}` : null,
  }));
  return {
    title: 'Jobs',
    columns: [
      { key: 'title', label: 'Job', sub: 'location' }, { key: 'department', label: 'Department' }, { key: 'status', label: 'Status', kind: 'badge' },
      { key: 'applicants', label: 'Applicants', kind: 'count' },
    ],
    rows,
  };
}

function approvals(result: Record<string, unknown>): Built {
  const rows = list(result.jobPostings).map((p): Row => ({
    title: text(p.title), by: text(p.submittedBy) || null, submitted: text(p.submitted) || null, _link: '/app/jobs/approvals',
  }));
  return {
    title: 'Waiting for approval',
    subtitle: result.canApprove === false ? 'You can see these but only an Admin with the Job posting permission can decide' : undefined,
    columns: [{ key: 'title', label: 'Posting' }, { key: 'by', label: 'Submitted by' }, { key: 'submitted', label: 'Submitted', kind: 'date' }],
    rows,
  };
}

function pipeline(result: Record<string, unknown>): Built {
  const rows = Object.entries(result).map(([label, n]): Row => ({ stage: stageKey(label), count: num(n) ?? 0 })).filter((r) => r.stage);
  return { title: 'Pipeline', columns: [{ key: 'stage', label: 'Stage', kind: 'stage' }, { key: 'count', label: 'Applicants', kind: 'count' }], rows };
}

/** How the pipeline is doing: the figures, and who has been left waiting. */
function summary(result: Record<string, unknown>): Built {
  const attention = obj(result.needsAttention);
  const stuck = num(attention.count) ?? 0;
  const waiting = num(result.jobPostingsWaitingForApproval) ?? 0;
  const today = num(result.interviewsToday) ?? 0;
  const tiles: AssistantTile[] = [
    { label: 'Active applicants', value: num(result.activeApplicants) ?? 0, hint: `${num(result.newApplicationsThisWeek) ?? 0} new this week` },
    { label: 'Open jobs', value: num(result.openJobs) ?? 0 },
    { label: 'Interviews today', value: today, hint: `${num(result.interviewsThisWeek) ?? 0} this week`, tone: today > 0 ? 'info' : 'neutral' },
    { label: 'Waiting for approval', value: waiting, hint: waiting ? 'Job postings' : undefined, tone: waiting > 0 ? 'warning' : 'neutral' },
    { label: 'Need attention', value: stuck, hint: stuck ? 'No movement for 7+ days' : 'Nothing stuck', tone: stuck > 0 ? 'danger' : 'success' },
  ];
  const rows = list(attention.items).map((i): Row => ({
    name: text(i.name), job: text(i.job), stage: stageKey(i.stage), idle: num(i.daysIdle) ?? 0,
    _link: num(i.applicationId) ? `/app/candidates/${num(i.applicationId)}` : null,
  }));
  return {
    kind: 'stats', title: 'Overview', tiles,
    subtitle: stuck > rows.length ? `Showing ${rows.length} of ${stuck} that need attention` : undefined,
    columns: [{ key: 'name', label: 'Needs attention', sub: 'job' }, { key: 'stage', label: 'Stage', kind: 'stage' }, { key: 'idle', label: 'Days idle', kind: 'count' }],
    rows,
  };
}

/** One candidate, with their applications and what is coming up. */
function candidate(result: Record<string, unknown>): Built {
  const apps = list(result.applications).map((a) => ({
    job: text(a.job), stage: stageKey(a.stage), applied: text(a.applied), withdrawn: a.withdrawn === true,
    link: num(a.applicationId) ? `/app/candidates/${num(a.applicationId)}` : '/app/candidates',
  }));
  const level = text(result.experienceLevel);
  const profile: AssistantProfile = {
    name: text(result.name),
    subtitle: [text(result.currentTitle), level ? `${level} level` : ''].filter(Boolean).join(' · '),
    email: text(result.email) || null,
    phone: text(result.phone) || null,
    education: text(result.education) || null,
    skills: text(result.skills).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 14),
    applications: apps,
    interviews: list(result.upcomingInterviews).map((i) => [text(i.when), text(i.type), text(i.status)].filter(Boolean).join(' · ')),
    notes: (Array.isArray(result.latestNotes) ? result.latestNotes : []).map(text).filter(Boolean).slice(0, 3),
  };
  return { kind: 'profile', title: profile.name || 'Candidate', columns: [], rows: [], profile };
}

function names(title: string, label: string, result: unknown): Built {
  return { title, columns: [{ key: 'name', label }], rows: list(result).map((r): Row => ({ name: text(r.name) })).filter((r) => r.name) };
}

/** What each lookup answers with, as a table. A lookup that is not a list has no entry. */
const BUILDERS: Record<string, (result: unknown) => Built> = {
  candidates: (r) => candidates(obj(r)),
  interviews: (r) => interviews(obj(r)),
  jobs: (r) => jobs(obj(r)),
  approvals: (r) => approvals(obj(r)),
  pipeline: (r) => pipeline(obj(r)),
  summary: (r) => summary(obj(r)),
  candidate: (r) => candidate(obj(r)),
  departments: (r) => names('Departments', 'Department', r),
  interviewers: (r) => names('Interviewers', 'Interviewer', r),
};

/** The tool's reply: the HTTP tool wraps it in a list and hands it over as text. */
function resultOf(observation: unknown): unknown {
  let value: unknown = observation;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return undefined; }
  }
  const first = Array.isArray(value) ? value[0] : value;
  const reply = obj(first);
  return reply.ok === true ? reply.result : undefined;
}

/**
 * The agent's steps (what it called and what came back) as tables, in the order
 * it looked things up. The same lookup twice (a retry) shows once.
 */
export function viewsFromSteps(steps: unknown): AssistantView[] {
  const views: AssistantView[] = [];
  const seen = new Set<string>();
  for (const step of list(steps)) {
    const action = obj(step.action);
    if (text(action.tool) !== 'lookup') continue;
    // The agent passes the arguments as an object, or as a JSON string in older runs.
    let input = action.toolInput;
    if (typeof input === 'string') { try { input = JSON.parse(input); } catch { continue; } }
    const what = text(obj(input).what).toLowerCase();
    const build = BUILDERS[what];
    const result = resultOf(step.observation);
    if (!build || result === undefined) continue;
    const built = build(result);
    const hasContent = built.kind === 'profile' ? Boolean(built.profile?.name) : built.kind === 'stats' ? Boolean(built.tiles?.length) : built.rows.length > 0;
    if (!hasContent) continue;
    const key = `${what}:${text(obj(input).query)}:${text(obj(input).job)}:${text(obj(input).stage)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    views.push({ id: `${what}-${views.length + 1}`, ...built, rows: built.rows.slice(0, MAX_ROWS) });
    if (views.length >= MAX_VIEWS) break;
  }
  return views;
}

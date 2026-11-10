import type { AssistantCell, AssistantView } from '../../../shared/api/assistant.js';
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
interface Built { title: string; subtitle?: string; columns: AssistantView['columns']; rows: Row[] }

function candidates(result: Record<string, unknown>): Built {
  const rows = list(result.candidates).map((c): Row => ({
    name: text(c.name), job: text(c.job), stage: stageKey(c.stage), title: text(c.currentTitle) || null, applied: text(c.applied), email: text(c.email) || null,
    _link: num(c.applicationId) ? `/app/candidates/${num(c.applicationId)}` : null,
  }));
  return {
    title: 'Candidates',
    subtitle: rows.length >= 15 ? 'The 15 most recently updated' : undefined,
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
    if (!built.rows.length) continue;
    const key = `${what}:${text(obj(input).query)}:${text(obj(input).job)}:${text(obj(input).stage)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    views.push({ id: `${what}-${views.length + 1}`, ...built, rows: built.rows.slice(0, MAX_ROWS) });
    if (views.length >= MAX_VIEWS) break;
  }
  return views;
}

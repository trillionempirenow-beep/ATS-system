import { waitUntil } from '@vercel/functions';
import { env } from '../../config/env.js';
import { sql } from '../../db/client.js';
import { describeError } from '../../parsers/resume-ai.js';

/**
 * AI matching between applicants and job postings, through the "Match
 * applicants and jobs" flow of the ATS-system n8n workflow (Gemini).
 *
 * Each runs once and is stored:
 *  - analyseApplicationOnce: right after someone applies, a real analysis of
 *    the application, and their fit for every other open job. Strong fits
 *    (60%+) become role suggestions on their application status page.
 *  - matchJobOnce: when a job is published, every registered applicant is
 *    scored against it, for the job's "Matching applicants" panel.
 */

export const MIN_MATCH = 60;
const TIMEOUT_MS = 45_000;
/** Applicants sent to the AI for one job, after a quick keyword pre-filter. */
const JOB_POOL = 30;
/** Open jobs an application is compared against. */
const MAX_JOBS = 25;

/** The flow's address: MATCH_N8N_WEBHOOK_URL, or next to the CV reader's (same n8n, same secret). */
function matchUrl(): string | null {
  if (env.MATCH_N8N_WEBHOOK_URL) return env.MATCH_N8N_WEBHOOK_URL;
  if (!env.CV_N8N_WEBHOOK_URL) return null;
  try { return new URL('/webhook/ats-match', env.CV_N8N_WEBHOOK_URL).toString(); } catch { return null; }
}
export const matchingEnabled = () => Boolean(matchUrl());

interface MatchOut { candidate_id: number; job_id: number; score: number; reason: string; applicant_note: string; matched: string[]; missing: string[] }
interface AnalysisOut { score: number; summary: string; strengths: string[]; concerns: string[]; recommendation: string; categories: Record<string, number> }

async function callMatcher(body: object): Promise<{ matches: MatchOut[]; analysis: AnalysisOut | null }> {
  const url = matchUrl();
  if (!url) throw new Error('matching is not configured');
  const secret = env.CV_N8N_SECRET ?? env.EMAIL_N8N_SECRET;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-ATS-Secret': secret } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`n8n HTTP ${res.status}: ${raw.slice(0, 200)}`);
  const out = (JSON.parse(raw) as { output?: unknown }).output ?? JSON.parse(raw);
  const o = out as { matches?: unknown; analysis?: unknown };
  const num = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 8) : []);
  const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const matches = (Array.isArray(o.matches) ? o.matches : []).map((m) => {
    const r = m as Record<string, unknown>;
    return { candidate_id: Number(r.candidate_id), job_id: Number(r.job_id), score: num(r.score), reason: str(r.reason), applicant_note: str(r.applicant_note, 400), matched: strs(r.matched), missing: strs(r.missing) };
  }).filter((m) => Number.isInteger(m.candidate_id) && Number.isInteger(m.job_id));
  const a = o.analysis as Record<string, unknown> | null | undefined;
  const analysis = a && typeof a === 'object' && str(a.summary)
    ? {
        score: num(a.score), summary: str(a.summary, 1200), strengths: strs(a.strengths), concerns: strs(a.concerns), recommendation: str(a.recommendation, 120),
        categories: Object.fromEntries(Object.entries((a.categories as Record<string, unknown>) ?? {}).map(([k, v]) => [k.slice(0, 40), num(v)]).slice(0, 6)),
      }
    : null;
  return { matches, analysis };
}

/** What the AI reads about an applicant: work-relevant facts only (no name, email or phone). */
async function candidateProfiles(ids: number[], cvChars: number) {
  if (!ids.length) return [];
  const rows = await sql<{ id: number; current_title: string | null; experience_level: string | null; skills: string | null; education: string | null; resume_text: string | null; notes: string | null }[]>`
    select id, current_title, experience_level, skills, education, resume_text, notes from candidates where id in ${sql(ids)}`;
  return rows.map((c) => ({
    id: c.id, title: c.current_title ?? '', level: c.experience_level ?? '', skills: c.skills ?? '', education: c.education ?? '',
    cv: (c.resume_text ?? '').replace(/\s+/g, ' ').slice(0, cvChars),
  }));
}

const jobText = (j: { title: string; description: string | null; requirements: string | null; responsibilities: string | null; qualifications: string | null; preferred_skills: string | null; experience_required: string | null; education_required: string | null; tags: string | null }, chars: number) =>
  [j.description, j.responsibilities && `Responsibilities: ${j.responsibilities}`, j.qualifications && `Qualifications: ${j.qualifications}`,
    j.requirements && `Required skills: ${j.requirements}`, j.preferred_skills && `Preferred: ${j.preferred_skills}`,
    j.experience_required && `Experience: ${j.experience_required}`, j.education_required && `Education: ${j.education_required}`, j.tags && `Tags: ${j.tags}`]
    .filter(Boolean).join('\n').replace(/[ \t]+/g, ' ').slice(0, chars);

type JobFacts = Parameters<typeof jobText>[0] & { id: number };
const JOB_COLUMNS = sql`j.id, j.title, j.description, j.requirements, j.responsibilities, j.qualifications, j.preferred_skills, j.experience_required, j.education_required, j.tags`;

async function saveMatches(matches: MatchOut[]) {
  for (const m of matches) {
    await sql`insert into candidate_job_matches (candidate_id, job_id, score, reason, matched, missing)
              values (${m.candidate_id}, ${m.job_id}, ${m.score}, ${m.reason}, ${m.matched}, ${m.missing})
              on conflict (candidate_id, job_id) do update set score = excluded.score, reason = excluded.reason,
                matched = excluded.matched, missing = excluded.missing, created_at = now()`;
  }
}

/**
 * Strong fits for jobs the applicant has not applied to become suggestions on
 * their most recent application, which their status page shows. Never more
 * than three, and never the same job twice.
 */
async function suggestToApplicants(matches: MatchOut[]) {
  for (const m of matches.filter((x) => x.score >= MIN_MATCH)) {
    const [app] = await sql<{ id: number }[]>`
      select a.id from applications a
      where a.candidate_id = ${m.candidate_id} and a.status = 'active' and a.stage <> 'hired'
        and not exists (select 1 from applications o where o.candidate_id = ${m.candidate_id} and o.job_id = ${m.job_id})
        and not exists (select 1 from candidate_role_suggestions s where s.application_id = a.id and s.suggested_job_id = ${m.job_id})
        and (select count(*) from candidate_role_suggestions s where s.application_id = a.id and s.from_ai) < 3
      order by a.applied_at desc limit 1`;
    if (!app) continue;
    await sql`insert into candidate_role_suggestions (application_id, suggested_job_id, note, author_id, from_ai)
              values (${app.id}, ${m.job_id}, ${m.applicant_note || null}, null, true)`;
  }
}

/** Runs a one-time job in the background of the current request (kept alive on Vercel). */
export function inBackground(label: string, task: () => Promise<unknown>): void {
  const p = task().catch((e) => console.warn(`[matching] ${label}: ${describeError(e)}`));
  try { waitUntil(p); } catch { /* outside Vercel the promise simply runs on */ }
}

/**
 * Once per application: a real analysis of it for its job, and the applicant's
 * fit for every other open job. Skips if the AI already analysed it.
 */
export async function analyseApplicationOnce(applicationId: number): Promise<'done' | 'skipped'> {
  if (!matchingEnabled()) return 'skipped';
  const [app] = await sql<(JobFacts & { candidate_id: number; cover_letter: string | null; why_us: string | null; analysed: boolean })[]>`
    select a.candidate_id, a.cover_letter, a.why_us, ${JOB_COLUMNS},
           exists (select 1 from candidate_ai_analysis x where x.application_id = a.id and x.ai_notes like 'AI analysis%') as analysed
    from applications a join jobs j on j.id = a.job_id where a.id = ${applicationId}`;
  if (!app || app.analysed) return 'skipped';
  const [profile] = await candidateProfiles([app.candidate_id], 6000);
  const others = await sql<JobFacts[]>`
    select ${JOB_COLUMNS} from jobs j where j.status = 'open' and j.id <> ${app.id}
    order by j.published_at desc nulls last limit ${MAX_JOBS}`;
  const { matches, analysis } = await callMatcher({
    mode: 'application',
    applied_job: { id: app.id, title: app.title, text: jobText(app, 3000) },
    application: { cover_letter: (app.cover_letter ?? '').slice(0, 1500), why_us: (app.why_us ?? '').slice(0, 800) },
    candidates: profile ? [profile] : [],
    jobs: [{ id: app.id, title: app.title, text: jobText(app, 1200) }, ...others.map((j) => ({ id: j.id, title: j.title, text: jobText(j, 900) }))],
  });
  const valid = matches.filter((m) => m.candidate_id === app.candidate_id && (m.job_id === app.id || others.some((j) => j.id === m.job_id)));
  await saveMatches(valid);
  if (analysis) {
    const score = valid.find((m) => m.job_id === app.id)?.score ?? analysis.score;
    await sql`insert into candidate_ai_analysis (application_id, overall_score, category_scores, summary, strengths, concerns, recommendation, ai_notes)
              values (${applicationId}, ${score}, ${sql.json(analysis.categories)}, ${analysis.summary}, ${sql.json(analysis.strengths)}, ${sql.json(analysis.concerns)},
                      ${analysis.recommendation || (score >= 80 ? 'Recommended for Interview' : score >= 65 ? 'Recommended for Screening Call' : 'Not a Strong Match at This Time')},
                      ${'AI analysis (Gemini) of the CV and application against the job, run once when the application arrived.'})
              on conflict (application_id) do update set overall_score = excluded.overall_score, category_scores = excluded.category_scores,
                summary = excluded.summary, strengths = excluded.strengths, concerns = excluded.concerns,
                recommendation = excluded.recommendation, ai_notes = excluded.ai_notes, generated_at = now()`;
  }
  await suggestToApplicants(valid.filter((m) => m.job_id !== app.id));
  console.info(`[matching] application ${applicationId}: ${valid.length} job scores`);
  return 'done';
}

/**
 * Once per job: score every registered applicant against it. A keyword
 * pre-filter picks the most likely few dozen so one AI call covers them.
 */
export async function matchJobOnce(jobId: number, opts: { force?: boolean } = {}): Promise<'done' | 'skipped'> {
  if (!matchingEnabled()) return 'skipped';
  const [job] = await sql<(JobFacts & { matched_at: Date | null; status: string })[]>`select ${JOB_COLUMNS}, j.matched_at, j.status from jobs j where j.id = ${jobId}`;
  if (!job || (job.matched_at && !opts.force)) return 'skipped';
  const words = `${job.title} ${job.tags ?? ''} ${job.requirements ?? ''} ${job.preferred_skills ?? ''}`
    .toLowerCase().match(/[a-z0-9+#.]{3,}/g) ?? [];
  // websearch_to_tsquery reads any text safely ("c++", "node.js"); "or" ranks applicants matching any word.
  const query = [...new Set(words)].slice(0, 40).join(' or ');
  const pool = await sql<{ id: number }[]>`
    select c.id from candidates c
    where c.record_status = 'active'
    order by ${query ? sql`ts_rank(c.search_vector, websearch_to_tsquery('simple', ${query}))` : sql`0`} desc, c.created_at desc
    limit ${JOB_POOL}`;
  const profiles = await candidateProfiles(pool.map((p) => p.id), 1200);
  // Claim the job first, so two requests never run the same scoring.
  const claimed = await sql`update jobs set matched_at = now() where id = ${jobId} and (matched_at is null or ${Boolean(opts.force)}) returning id`;
  if (!claimed.length) return 'skipped';
  if (!profiles.length) return 'done';
  try {
    const { matches } = await callMatcher({ mode: 'job', jobs: [{ id: job.id, title: job.title, text: jobText(job, 3000) }], candidates: profiles });
    const valid = matches.filter((m) => m.job_id === job.id && profiles.some((p) => p.id === m.candidate_id));
    await saveMatches(valid);
    if (job.status === 'open') await suggestToApplicants(valid);
    console.info(`[matching] job ${jobId}: ${valid.length} applicants scored`);
    return 'done';
  } catch (e) {
    // Let it be tried again later.
    await sql`update jobs set matched_at = null where id = ${jobId}`;
    throw e;
  }
}

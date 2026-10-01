import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS, getApp, signIn } from '../helpers.js';

/**
 * A stand-in for the "Match applicants and jobs" n8n flow. For a job it scores
 * candidate 1 at 82 (strong), candidate 2 at 45 (partial, still shown) and
 * everyone else 20 with nothing matched (no connection, hidden).
 */
let n8n: Server;
const calls: Array<{ mode: string }> = [];

interface Body { mode: string; candidates: Array<{ id: number }>; jobs: Array<{ id: number }> }
function fakeMatcher(body: Body) {
  calls.push({ mode: body.mode });
  const matches = body.mode === 'job'
    ? body.candidates.map((c) => ({ candidate_id: c.id, job_id: body.jobs[0]!.id, score: c.id === 1 ? 82 : c.id === 2 ? 45 : 20, reason: 'Strong SQL.', applicant_note: '', matched: c.id <= 2 ? ['SQL'] : [], missing: [] }))
    : body.jobs.map((j, i) => ({ candidate_id: body.candidates[0]!.id, job_id: j.id, score: i === 1 ? 77 : 55, reason: 'Fits.', applicant_note: 'Your SQL work fits this role.', matched: ['SQL'], missing: ['Go'] }));
  const analysis = body.mode === 'application'
    ? { score: 55, summary: 'Solid analyst, light on the applied role.', strengths: ['SQL'], concerns: ['No Go'], recommendation: 'Recommended for Screening Call', categories: { Skills: 60 } }
    : { score: 0, summary: '', strengths: [], concerns: [], recommendation: '', categories: {} };
  return { output: { matches, analysis } };
}

beforeAll(async () => {
  n8n = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.headers['x-ats-secret'] !== 'test-n8n-secret') { res.writeHead(403).end('Authorization data is wrong!'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(fakeMatcher(JSON.parse(raw))));
    });
  });
  await new Promise<void>((r) => n8n.listen(0, '127.0.0.1', r));
  process.env.MATCH_N8N_WEBHOOK_URL = `http://127.0.0.1:${(n8n.address() as AddressInfo).port}/webhook/ats-match`;
  process.env.CV_N8N_SECRET = 'test-n8n-secret';
  await getApp();
});
afterAll(async () => {
  await new Promise<void>((r) => n8n.close(() => r()));
  delete process.env.MATCH_N8N_WEBHOOK_URL;
  const { sql } = await import('../../server/db/client.js');
  await sql`delete from rate_limits where bucket like 'login-%'`;
  // The test database takes a handful of connections: give this file's back.
  await sql.end({ timeout: 1 });
});

describe('job list, job page and AI matching', () => {
  it('shows every staff member all non-draft jobs with who created them, and the job page scores applicants once', async () => {
    const hr = await signIn(USERS.recruiter);
    const list = await hr.agent.get('/api/v1/jobs/mine');
    expect(list.status).toBe(200);
    const jobs = list.body.data.jobs as Array<{ id: number; state: string; mine: boolean; creatorName: string | null }>;
    expect(jobs.some((j) => !j.mine)).toBe(true);
    expect(jobs.every((j) => j.mine || j.state !== 'draft')).toBe(true);

    const live = jobs.find((j) => j.state === 'published')!;
    const before = await hr.agent.get(`/api/v1/jobs/${live.id}/overview`);
    expect(before.status).toBe(200);
    expect(before.body.data.matchingEnabled).toBe(true);

    // The run goes on in the background; the page polls the overview.
    const settle = async () => {
      for (let i = 0; i < 50; i++) {
        const r = await hr.agent.get(`/api/v1/jobs/${live.id}/overview`);
        if (!r.body.data.matchingNow) return r.body.data;
        await new Promise((ok) => setTimeout(ok, 100));
      }
      throw new Error('matching never finished');
    };
    const start = await hr.agent.post(`/api/v1/jobs/${live.id}/match`).set('X-CSRF-Token', hr.csrf).send({});
    expect(start.status).toBe(200);
    const done = await settle();
    expect(done.matchedAt).not.toBeNull();
    expect(done.matchingError).toBeNull();
    expect(done.scored).toBeGreaterThan(1);
    expect(done.matches.map((m: { score: number }) => m.score)).toEqual([82, 45]);

    // It can be run again at any time, on any job; the new scores replace the old.
    const jobCalls = calls.filter((c) => c.mode === 'job').length;
    await hr.agent.post(`/api/v1/jobs/${live.id}/match`).set('X-CSRF-Token', hr.csrf).send({}).expect(200);
    const again = await settle();
    expect(calls.filter((c) => c.mode === 'job').length).toBeGreaterThan(jobCalls);
    expect(again.scored).toBe(done.scored);

    // The careers site never names who wrote a posting.
    const { default: request } = await import('supertest');
    const pub = await request(await getApp()).get('/api/v1/public/jobs');
    expect(JSON.stringify(pub.body)).not.toMatch(/creator/i);
  });

  it('analyses a new application once and suggests strong-fit roles to the applicant', async () => {
    const { sql } = await import('../../server/db/client.js');
    const { analyseApplicationOnce } = await import('../../server/modules/matching/matching.service.js');
    const [count] = await sql<{ n: number }[]>`select count(*)::int as n from jobs where status = 'open'`;
    expect(count!.n).toBeGreaterThan(1);
    const [found] = await sql<{ id: number; candidate_id: number }[]>`
      select a.id, a.candidate_id from applications a join jobs j on j.id = a.job_id
      where j.status = 'open' and a.status = 'active' and a.stage <> 'hired' order by a.id limit 1`;
    expect(found).toBeDefined();
    const app = found!;
    await sql`delete from candidate_ai_analysis where application_id = ${app.id}`;
    await sql`delete from candidate_role_suggestions where application_id = ${app.id}`;

    expect(await analyseApplicationOnce(app.id)).toBe('done');
    const [analysis] = await sql<{ summary: string; ai_notes: string }[]>`select summary, ai_notes from candidate_ai_analysis where application_id = ${app.id}`;
    expect(analysis!.summary).toContain('Solid analyst');
    expect(analysis!.ai_notes).toMatch(/^AI analysis/);
    const suggested = await sql<{ from_ai: boolean; note: string }[]>`select from_ai, note from candidate_role_suggestions where application_id = ${app.id}`;
    expect(suggested.length).toBeLessThanOrEqual(1);
    for (const sg of suggested) { expect(sg.from_ai).toBe(true); expect(sg.note).toContain('SQL'); }

    expect(await analyseApplicationOnce(app.id)).toBe('skipped');
  });
});

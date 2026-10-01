import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS, getApp, signIn } from '../helpers.js';

/**
 * A stand-in for the "ats-assistant" n8n workflow: it calls the real tool
 * endpoints with the run token it was given, like the agent does, and answers
 * with its tool results as "steps". The scenario comes from the message text.
 */
let n8n: Server;
const NEXT: Record<string, string> = { Applied: 'screening', Screening: 'interview', Interview: 'final_interview' };

async function fakeAgent(body: { text: string; token: string }) {
  const app = await getApp();
  const call = (tool: string, args: object) =>
    request(app).post(`/api/v1/assistant/tools/${tool}`).set('X-Assistant-Token', body.token).send(args).then((r) => r.body);
  const [scenario, arg] = body.text.split(':');
  const steps: unknown[] = [];
  if (scenario === 'move') {
    const found = await call('lookup', { what: 'candidates' });
    const pick = found.result.candidates.find((c: { stage: string }) => NEXT[c.stage]);
    steps.push({ observation: JSON.stringify(await call('propose', { action: 'move_stage', application_id: pick.applicationId, stage: NEXT[pick.stage] })) });
  } else if (scenario === 'approve') {
    steps.push({ observation: JSON.stringify(await call('propose', { action: 'approve_job', job_id: Number(arg) })) });
  } else if (scenario === 'schedule' || scenario === 'email') {
    const found = await call('lookup', { what: 'candidates', stage: 'interview' });
    const pick = found.result.candidates[0];
    const args = scenario === 'schedule'
      ? { action: 'schedule_interview', application_id: pick.applicationId, starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), duration_minutes: 45, interview_type: 'video' }
      : { action: 'send_email', application_id: pick.applicationId, subject: 'Quick update', body: 'Hi,\nThanks for your patience.\n\nBest,\nAcme' };
    steps.push({ observation: JSON.stringify(await call('propose', args)) });
  } else if (scenario === 'add') {
    steps.push({ observation: JSON.stringify(await call('propose', { action: 'add_candidate', full_name: 'Bea  Assistant', email: 'bea.assistant@example.com', phone: '0917 555 0101', current_title: 'Data Analyst', experience_level: 'mid', skills: ['SQL', 'Power BI'], job: 'Senior Product Engineer' })) });
    steps.push({ observation: JSON.stringify(await call('propose', { action: 'add_candidate', full_name: 'No Mail', email: 'not-an-email' })) });
  } else if (scenario === 'job') {
    steps.push({ observation: JSON.stringify(await call('propose', { action: 'create_job', title: 'Assistant Test Role', department: 'Engineering', description: 'Made by the assistant test.', publish: true })) });
  }
  return { reply: `did ${scenario}`, steps };
}

beforeAll(async () => {
  n8n = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      if (req.headers['x-ats-secret'] !== 'test-n8n-secret') { res.writeHead(403).end('Authorization data is wrong!'); return; }
      const out = await fakeAgent(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => n8n.listen(0, '127.0.0.1', r));
  process.env.ASSISTANT_N8N_WEBHOOK_URL = `http://127.0.0.1:${(n8n.address() as AddressInfo).port}/webhook/ats-assistant`;
  process.env.CV_N8N_SECRET = 'test-n8n-secret';
});
afterAll(async () => {
  await new Promise<void>((r) => n8n.close(() => r()));
  // Give the sign-ins used here back, so later files stay under the shared login limit.
  const { sql } = await import('../../server/db/client.js');
  await sql`delete from rate_limits where bucket like 'login-%'`;
});

const say = (s: Awaited<ReturnType<typeof signIn>>, text: string) =>
  s.agent.post('/api/v1/assistant/message').set('X-CSRF-Token', s.csrf).send({ text, page: '/app' });

describe('Acme assistant', () => {
  // One sign-in per role: the login rate limit is shared with the other test files.
  let hr: Awaited<ReturnType<typeof signIn>>;
  let admin: Awaited<ReturnType<typeof signIn>>;
  beforeAll(async () => { hr = await signIn(USERS.recruiter); admin = await signIn(USERS.admin); });

  it('prepares a stage move, does it only on confirm, and can undo it', async () => {
    const res = await say(hr, 'move');
    expect(res.status).toBe(200);
    expect(res.body.data.reply).toBe('did move');
    expect(res.body.data.actions).toHaveLength(1);
    const action = res.body.data.actions[0];
    expect(action.kind).toBe('move_stage');

    // Another person cannot confirm someone else's suggestion.
    expect((await admin.agent.post('/api/v1/assistant/actions/confirm').set('X-CSRF-Token', admin.csrf).send({ token: action.token })).status).toBe(410);

    const done = await hr.agent.post('/api/v1/assistant/actions/confirm').set('X-CSRF-Token', hr.csrf).send({ token: action.token });
    expect(done.status).toBe(200);
    expect(done.body.data.message).toMatch(/^Done\. Moved to/);
    expect(done.body.data.undoToken).toBeTruthy();

    const undone = await hr.agent.post('/api/v1/assistant/actions/undo').set('X-CSRF-Token', hr.csrf).send({ token: done.body.data.undoToken });
    expect(undone.status).toBe(200);
    expect(undone.body.data.message).toMatch(/^Undone\./);
  });

  it('keeps HR from approving or publishing; a posting they ask for goes to approval', async () => {
    const approve = await say(hr, 'approve:1');
    expect(approve.body.data.actions).toHaveLength(0);

    const job = await say(hr, 'job');
    expect(job.body.data.actions).toHaveLength(1);
    expect(job.body.data.actions[0].confirmLabel).toBe('Create and submit');
    const made = await hr.agent.post('/api/v1/assistant/actions/confirm').set('X-CSRF-Token', hr.csrf).send({ token: job.body.data.actions[0].token });
    expect(made.status).toBe(200);
    expect(made.body.data.message).toMatch(/sent to an Admin for approval/);

    const queue = await admin.agent.get('/api/v1/approvals');
    const pending = queue.body.data.queue.find((j: { title: string }) => j.title === 'Assistant Test Role');
    expect(pending).toBeTruthy();

    // The Admin can approve it through the assistant.
    const adminApprove = await say(admin, `approve:${pending.id}`);
    expect(adminApprove.body.data.actions).toHaveLength(1);
    const ok = await admin.agent.post('/api/v1/assistant/actions/confirm').set('X-CSRF-Token', admin.csrf).send({ token: adminApprove.body.data.actions[0].token });
    expect(ok.body.data.message).toMatch(/Approved and published/);
  });

  it('schedules an interview and sends an email once each, on confirm', async () => {
    for (const scenario of ['schedule', 'email']) {
      const res = await say(hr, scenario);
      expect(res.body.data.actions).toHaveLength(1);
      const token = res.body.data.actions[0].token;
      const done = await hr.agent.post('/api/v1/assistant/actions/confirm').set('X-CSRF-Token', hr.csrf).send({ token });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(done.body.data.message).toMatch(/^Done/);
      if (scenario === 'email') {
        const again = await hr.agent.post('/api/v1/assistant/actions/confirm').set('X-CSRF-Token', hr.csrf).send({ token });
        expect(again.body.data.message).toBe('This email was already sent.');
      }
    }
  });

  it('adds an applicant with a preview, applied to the job, only on confirm', async () => {
    const res = await say(hr, 'add');
    // The second proposal had a bad email and was refused, so only one card.
    expect(res.body.data.actions).toHaveLength(1);
    const action = res.body.data.actions[0];
    expect(action.kind).toBe('add_candidate');
    expect(action.preview).toMatchObject({ type: 'candidate', fullName: 'Bea Assistant', experienceLevel: expect.any(String), skills: 'SQL, Power BI', job: 'Senior Product Engineer', existing: null });
    const done = await hr.agent.post('/api/v1/assistant/actions/confirm').set('X-CSRF-Token', hr.csrf).send({ token: action.token });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data.message).toBe('Done. Added and applied for Senior Product Engineer.');
    expect(done.body.data.link).toMatch(/^\/app\/candidates\/\d+$/);
  });

  it('shows a job posting preview', async () => {
    const res = await say(admin, 'job');
    expect(res.body.data.actions[0].preview).toMatchObject({ type: 'job', title: 'Assistant Test Role', department: 'Engineering', publish: true });
  });

  it('refuses tool calls without a valid run token', async () => {
    const app = await getApp();
    expect((await request(app).post('/api/v1/assistant/tools/lookup').send({ what: 'candidates' })).status).toBe(401);
    expect((await request(app).post('/api/v1/assistant/tools/lookup').set('X-Assistant-Token', 'ats1.abc.def').send({})).status).toBe(401);
  });
});

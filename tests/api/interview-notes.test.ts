import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS, anon, getApp, signIn } from '../helpers.js';

/** A stand-in for the "Interview notes" n8n flow: one note per piece, and a summary. */
let n8n: Server;
const received: Array<{ mode: string }> = [];

beforeAll(async () => {
  n8n = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.headers['x-ats-secret'] !== 'test-n8n-secret') { res.writeHead(403).end('no'); return; }
      const body = JSON.parse(raw) as { mode: string };
      received.push({ mode: body.mode });
      const output = body.mode === 'summary'
        ? { summary: 'Miguel has two years of React.', key_answers: [{ label: 'Expected salary', value: 'PHP 60-70k' }], strengths: ['React'], concerns: [], follow_ups: ['Check references'] }
        : { transcript: 'Kaya ko po mag-start after 30 days.', notes: [{ topic: 'Availability', text: 'Can start after a 30-day notice period.' }] };
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ output }));
    });
  });
  await new Promise<void>((r) => n8n.listen(0, '127.0.0.1', r));
  process.env.NOTES_N8N_WEBHOOK_URL = `http://127.0.0.1:${(n8n.address() as AddressInfo).port}/webhook/ats-interview-notes`;
  process.env.CV_N8N_SECRET = 'test-n8n-secret';
  await getApp();
});
afterAll(async () => {
  await new Promise<void>((r) => n8n.close(() => r()));
  delete process.env.NOTES_N8N_WEBHOOK_URL;
  const { sql } = await import('../../server/db/client.js');
  await sql`delete from rate_limits where bucket like 'login-%'`;
  await sql.end({ timeout: 1 });
});

describe('interview AI notes', () => {
  it('only the interviewer turns them on and reads them; the room shows a notice; a summary is written at the end', async () => {
    const hr = await signIn(USERS.recruiter);
    const admin = await signIn(USERS.admin);
    const scheduled = await hr.agent.post('/api/v1/interviews').set('X-CSRF-Token', hr.csrf).send({
      applicationId: 7, startsAt: new Date(Date.now() + 5 * 60_000).toISOString(), interviewType: 'video', meetingType: 'interview', meetingMode: 'builtin',
    });
    expect(scheduled.status).toBe(201);
    const { interviewId, candidateLink } = scheduled.body.data as { interviewId: number; candidateLink: string };
    const url = new URL(candidateLink);
    const code = url.pathname.split('/').pop()!;
    const t = url.searchParams.get('t')!;

    const mine = await hr.agent.get(`/api/v1/interviews/${interviewId}`);
    expect(mine.body.data.assistant).toMatchObject({ configured: true, enabled: false, canUse: true });

    // Someone else on the hiring team cannot switch it on or send audio.
    expect((await admin.agent.patch(`/api/v1/interviews/${interviewId}/assistant`).set('X-CSRF-Token', admin.csrf).send({ enabled: true })).status).toBe(403);

    await hr.agent.patch(`/api/v1/interviews/${interviewId}/assistant`).set('X-CSRF-Token', hr.csrf).send({ enabled: true }).expect(200);
    const candidate = await (await anon()).get(`/api/v1/room/${code}`).query({ t });
    expect(candidate.body.data.aiNotesOn).toBe(true);
    expect(JSON.stringify(candidate.body.data)).not.toMatch(/30-day notice/);

    const audio = Buffer.alloc(3000, 1).toString('base64');
    const piece = await hr.agent.post(`/api/v1/interviews/${interviewId}/assistant/chunk`).set('X-CSRF-Token', hr.csrf)
      .send({ audio, audioMime: 'audio/webm', atSecond: 30 });
    expect(piece.status).toBe(200);
    expect(piece.body.data.notes).toEqual([{ atSecond: 30, topic: 'Availability', text: 'Can start after a 30-day notice period.' }]);
    expect((await admin.agent.post(`/api/v1/interviews/${interviewId}/assistant/chunk`).set('X-CSRF-Token', admin.csrf)
      .send({ audio, audioMime: 'audio/webm', atSecond: 60 })).status).toBe(403);

    // Live notes are the interviewer's alone.
    const other = await admin.agent.get(`/api/v1/interviews/${interviewId}`);
    expect(other.body.data.assistant.canUse).toBe(false);
    expect(other.body.data.assistant.notes).toEqual([]);
    expect((await hr.agent.get(`/api/v1/interviews/${interviewId}`)).body.data.assistant.notes).toHaveLength(1);

    await hr.agent.post(`/api/v1/interviews/${interviewId}/end`).set('X-CSRF-Token', hr.csrf).send({}).expect(200);
    let summary = null;
    for (let i = 0; i < 40 && !summary; i++) {
      summary = (await hr.agent.get(`/api/v1/interviews/${interviewId}`)).body.data.aiSummary;
      if (!summary) await new Promise((r) => setTimeout(r, 100));
    }
    expect(summary).toMatchObject({ summary: 'Miguel has two years of React.', keyAnswers: [{ label: 'Expected salary', value: 'PHP 60-70k' }], followUps: ['Check references'] });
    expect(received.map((r) => r.mode)).toEqual(['chunk', 'summary']);
    expect((await (await anon()).get(`/api/v1/room/${code}`).query({ t })).body.data.aiNotesOn).toBe(false);
  });
});

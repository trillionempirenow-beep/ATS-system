import { afterAll, describe, expect, it } from 'vitest';
import { USERS, anon, getApp, signIn } from '../helpers.js';

afterAll(async () => {
  const { sql } = await import('../../server/db/client.js');
  await sql`delete from rate_limits where bucket like 'login-%' or bucket like 'share-%'`;
  await sql.end({ timeout: 1 });
});

describe('library and view-only shares', () => {
  it('admins open the library; HR without the permission cannot', async () => {
    await getApp();
    const hr = await signIn(USERS.recruiter);
    expect((await hr.agent.get('/api/v1/library')).status).toBe(403);

    const admin = await signIn(USERS.admin);
    expect(admin.me.permissions).toContain('library');
    const list = await admin.agent.get('/api/v1/library');
    expect(list.status).toBe(200);
    expect(list.body.data.rows.length).toBeGreaterThan(0);
    const appId = list.body.data.rows[0].applicationId as number;
    const detail = await admin.agent.get(`/api/v1/library/${appId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.file.details.email).toContain('@');
  });

  it('shares a view-only copy that only the recipient can open, and can be turned off', async () => {
    const { sql } = await import('../../server/db/client.js');
    const { sha256 } = await import('../../server/lib/crypto.js');
    const admin = await signIn(USERS.admin);
    const appId = (await admin.agent.get('/api/v1/library')).body.data.rows[0].applicationId as number;

    const created = await admin.agent.post(`/api/v1/library/${appId}/shares`).set('X-CSRF-Token', admin.csrf).send({
      recipientEmail: 'Manager.Out@Client.test', recipientName: 'Mia', sections: ['details', 'cv'], allowDownload: true, expiry: '7d',
    });
    expect(created.status).toBe(201);
    const { share, link } = created.body.data as { share: { id: number; status: string; expiresAt: string }; link: string };
    expect(share.status).toBe('active');
    expect(share.expiresAt).toBeTruthy();
    const token = new URL(link).pathname.split('/').pop()!;

    const pub = await anon();
    const landing = await pub.get(`/api/v1/shared/${token}`);
    expect(landing.body.data).toMatchObject({ state: 'ok' });
    expect(landing.body.data.maskedEmail).toMatch(/^m•+@client\.test$/);

    // Without a verified code there is nothing to read.
    expect((await pub.get(`/api/v1/shared/${token}/file`)).status).toBe(403);

    // Someone else's address gets the same answer, but no code is made.
    expect((await pub.post(`/api/v1/shared/${token}/code`).send({ email: 'someone@else.test' })).body.data).toEqual({ sent: true });
    expect((await sql`select count(*)::int as n from library_share_codes where share_id = ${share.id}`)[0]!.n).toBe(0);
    expect((await pub.post(`/api/v1/shared/${token}/code`).send({ email: 'manager.out@client.test' })).status).toBe(200);
    expect((await sql`select count(*)::int as n from library_share_codes where share_id = ${share.id}`)[0]!.n).toBe(1);

    // Swap in a code we know (the real one only exists in the email).
    await sql`update library_share_codes set code_hash = ${sha256(`${share.id}:123456`)} where share_id = ${share.id}`;
    expect((await pub.post(`/api/v1/shared/${token}/verify`).send({ email: 'manager.out@client.test', code: '000000' })).status).toBe(422);
    const ok = await pub.post(`/api/v1/shared/${token}/verify`).send({ email: 'manager.out@client.test', code: '123456' });
    expect(ok.status).toBe(200);
    const viewerToken = ok.body.data.viewerToken as string;
    // A code works once.
    expect((await pub.post(`/api/v1/shared/${token}/verify`).send({ email: 'manager.out@client.test', code: '123456' })).status).toBe(422);

    const file = await pub.get(`/api/v1/shared/${token}/file`).set('X-Share-Viewer', viewerToken);
    expect(file.status).toBe(200);
    expect(file.body.data.file.sections).toEqual(['details', 'cv']);
    expect(file.body.data.file.notes).toEqual([]);
    expect(file.body.data.file.ai).toBeNull();
    expect(file.body.data.file.interviews).toEqual([]);

    // Turned off: the link and the viewer session stop working at once.
    const off = await admin.agent.post(`/api/v1/library/shares/${share.id}/revoke`).set('X-CSRF-Token', admin.csrf);
    expect(off.body.data.status).toBe('off');
    expect((await pub.get(`/api/v1/shared/${token}`)).body.data.state).toBe('off');
    expect((await pub.get(`/api/v1/shared/${token}/file`).set('X-Share-Viewer', viewerToken)).status).toBe(410);
  });

  it('records a meeting in parts that land in the library', async () => {
    const admin = await signIn(USERS.admin);
    const startsAt = new Date(Date.now() + 9 * 86_400_000 + 17 * 60_000).toISOString();
    const scheduled = await admin.agent.post('/api/v1/interviews').set('X-CSRF-Token', admin.csrf).send({
      applicationId: 5, startsAt, interviewType: 'video', meetingType: 'interview', meetingMode: 'builtin', recordMeeting: true, sendInvite: false,
    });
    expect(scheduled.status).toBe(201);
    const { interviewId, candidateLink } = scheduled.body.data as { interviewId: number; candidateLink: string };

    // Everyone is told: the candidate's room says it is recorded.
    const url = new URL(candidateLink);
    const roomState = await (await anon()).get(`/api/v1/room/${url.pathname.split('/').pop()}`).query({ t: url.searchParams.get('t') });
    expect(roomState.body.data.recorded).toBe(true);

    const staffRoom = await admin.agent.get(`/api/v1/interviews/${interviewId}`);
    expect(staffRoom.body.data.recording).toEqual({ on: true, isRecorder: true, parts: 0 });

    // Only the interviewer's browser records.
    const hr = await signIn(USERS.recruiter);
    expect((await hr.agent.post(`/api/v1/interviews/${interviewId}/recordings/grant`).set('X-CSRF-Token', hr.csrf).send({ mime: 'video/webm' })).status).toBe(403);

    const grant = await admin.agent.post(`/api/v1/interviews/${interviewId}/recordings/grant`).set('X-CSRF-Token', admin.csrf).send({ mime: 'video/webm' });
    expect(grant.status).toBe(200);
    const g = grant.body.data as { path: string; uploadUrl: string; token: string };
    expect(g.path).toMatch(new RegExp(`^${interviewId}/\\d+-[a-f0-9]+\\.webm$`));
    const put = await (await anon()).put(new URL(g.uploadUrl).pathname).set('Content-Type', 'video/webm').send(Buffer.alloc(6000, 1));
    expect(put.status).toBeLessThan(300);

    const part = { path: g.path, mime: 'video/webm', sizeBytes: 6000, durationSec: 300, startedAt: new Date().toISOString() };
    // A path the server did not hand out is refused.
    expect((await admin.agent.post(`/api/v1/interviews/${interviewId}/recordings`).set('X-CSRF-Token', admin.csrf)
      .send({ ...part, path: `${interviewId}/other.webm`, token: g.token })).status).toBe(403);
    const saved = await admin.agent.post(`/api/v1/interviews/${interviewId}/recordings`).set('X-CSRF-Token', admin.csrf).send({ ...part, token: g.token });
    expect(saved.status).toBe(201);
    expect(saved.body.data.parts).toBe(1);

    const file = await admin.agent.get('/api/v1/library/5');
    const iv = (file.body.data.file.interviews as Array<{ id: number; recordings: Array<{ id: number; durationSec: number }> }>).find((i) => i.id === interviewId)!;
    expect(iv.recordings).toHaveLength(1);
    expect(iv.recordings[0]!.durationSec).toBe(300);
    const play = await admin.agent.get(`/api/v1/library/5/recordings/${iv.recordings[0]!.id}`);
    expect(play.status).toBe(200);

    // Housekeeping removes recordings past the retention period.
    const { sql } = await import('../../server/db/client.js');
    const { cleanup } = await import('../../server/modules/interviews/interview-recordings.service.js');
    await sql`update interviews set starts_at = now() - interval '100 days' where id = ${interviewId}`;
    expect(await cleanup(90)).toBe(1);
    expect((await sql`select count(*)::int as n from interview_recordings where interview_id = ${interviewId}`)[0]!.n).toBe(0);
  });
});

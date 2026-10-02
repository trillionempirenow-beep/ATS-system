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
});

import { describe, expect, it } from 'vitest';
import { USERS, anon, signIn } from '../helpers.js';

describe('authentication', () => {
  it('signs in with a password hash written by PHP and returns role and permissions', async () => {
    const s = await signIn(USERS.recruiter);
    expect(s.me.role).toBe('recruiter');
    expect(s.me.permissions).toEqual(expect.arrayContaining(['job_management', 'job_posting']));
    const me = await s.agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
  });

  it('gives one generic message for a wrong password', async () => {
    const res = await (await anon()).post('/api/v1/auth/login').send({ email: USERS.recruiter, password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password.');
  });

  it('blocks pending and suspended accounts with their own message and no session', async () => {
    const pending = await (await anon()).post('/api/v1/auth/login').send({ email: 'hana.kim@acme.test', password: 'password' });
    expect(pending.status).toBe(403);
    expect(pending.body.error.details.accountStatus).toBe('pending');
    expect(pending.headers['set-cookie']).toBeUndefined();
    const suspended = await (await anon()).post('/api/v1/auth/login').send({ email: 'leo.martins@acme.test', password: 'password' });
    expect(suspended.body.error.message).toMatch(/suspended/);
  });

  it('refuses writes without the CSRF token', async () => {
    const s = await signIn(USERS.recruiter);
    const res = await s.agent.post('/api/v1/auth/logout');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_failed');
    const ok = await s.agent.post('/api/v1/auth/logout').set('X-CSRF-Token', s.csrf);
    expect(ok.status).toBe(200);
    const after = await s.agent.get('/api/v1/auth/me');
    expect(after.status).toBe(401);
  });

  it('never reveals whether an address exists when a reset is requested', async () => {
    const a = await (await anon()).post('/api/v1/auth/forgot-password').send({ email: 'nobody@acme.test' });
    const b = await (await anon()).post('/api/v1/auth/forgot-password').send({ email: USERS.admin });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body).toEqual(b.body);
  });
});

import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { isCommonPassword, passwordProblems, temporaryPasswordProblem } from '../../shared/domain/access.js';
import { securityHeaders } from '../../server/http/security-headers.js';
import { anon, getApp } from '../helpers.js';

describe('browser security headers', () => {
  it('vercel.json sends exactly the production set the server sends', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
    const all = vercel.headers.find((h) => h.source === '/(.*)');
    expect(Object.fromEntries((all?.headers ?? []).map((h) => [h.key, h.value]))).toEqual(securityHeaders(true));
  });

  it('every API reply carries them, and the policy refuses inline scripts and framing by other sites', async () => {
    const res = await (await anon()).get('/api/v1/health');
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'self'");
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('flood guard', () => {
  it('answers 429 with Retry-After once one address passes its budget, before any database work', async () => {
    const { createApp } = await import('../../server/app.js');
    const app = createApp({ ipRequestsPerMinute: 3 });
    for (let i = 0; i < 3; i++) await request(app).get('/api/v1/health').expect(200);
    const blocked = await request(app).get('/api/v1/health');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('request hygiene', () => {
  it('a malformed Referer is refused as a foreign origin, not a server error', async () => {
    const res = await request(await getApp()).post('/api/v1/public/referrals').set('Referer', 'not a url').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_failed');
  });

  it('the careers pages may be cached by the CDN for a moment; signed-in pages never are', async () => {
    const pub = await (await anon()).get('/api/v1/public/jobs');
    expect(pub.headers['cache-control']).toContain('s-maxage=30');
    const me = await (await anon()).get('/api/v1/auth/me');
    expect(me.headers['cache-control']).toBe('no-store');
  });
});

describe('sign-in guessing', () => {
  afterAll(async () => {
    const { sql } = await import('../../server/db/client.js');
    await sql`delete from rate_limits where bucket like 'login-%'`;
  });

  it('stops repeated guesses at one account from one address', async () => {
    const attempt = async () => (await anon()).post('/api/v1/auth/login').send({ email: 'ghost.account@acme.test', password: 'Wrong-guess-1234' });
    for (let i = 0; i < 8; i++) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });
});

describe('password rules', () => {
  it('need 12 characters with a letter and a number, and refuse common passwords and their variants', () => {
    expect(passwordProblems('Teal-harbor-2026', 'Teal-harbor-2026')).toEqual([]);
    expect(passwordProblems('short1', 'short1')).toContain('be at least 12 characters long');
    for (const common of ['Password2024!', 'qwerty123456', 'Welcome12345', 'aaaaaaaaaaaa', 'Strtm2026!!!', '1234abcabcabc']) {
      expect(isCommonPassword(common), common).toBe(true);
    }
    expect(isCommonPassword('Onboard-river-42')).toBe(false);
    expect(temporaryPasswordProblem('temporary1')).toMatch(/at least 12 characters/);
  });
});

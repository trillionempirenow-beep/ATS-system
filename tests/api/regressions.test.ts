import { describe, expect, it } from 'vitest';
import { USERS, signIn } from '../helpers.js';

describe('add candidate with an email already on file', () => {
  it('saving a draft keeps an active candidate active and keeps details left blank', async () => {
    const { sql } = await import('../../server/db/client.js');
    const hr = await signIn(USERS.recruiter);
    const email = 'ines.duarte@example.com';
    await hr.agent.post('/api/v1/candidates').set('X-CSRF-Token', hr.csrf)
      .send({ fullName: 'Ines Duarte', email, phone: '+351 91 555 0199', currentTitle: 'QA Lead', skills: 'cypress', source: 'linkedin' })
      .expect(201);

    await hr.agent.post('/api/v1/candidates').set('X-CSRF-Token', hr.csrf)
      .send({ action: 'draft', fullName: 'Ines Duarte', email, source: 'linkedin' })
      .expect(201);

    const [c] = await sql<{ record_status: string; phone: string | null; current_title: string | null; skills: string | null }[]>`
      select record_status, phone, current_title, skills from candidates where email = ${email}`;
    expect(c).toEqual({ record_status: 'active', phone: '+351 91 555 0199', current_title: 'QA Lead', skills: 'cypress' });
  });
});

describe('audit trail export', () => {
  it('neutralises text a spreadsheet would run as a formula', async () => {
    const hr = await signIn(USERS.recruiter);
    await hr.agent.post('/api/v1/candidates').set('X-CSRF-Token', hr.csrf)
      .send({ action: 'draft', fullName: '=HYPERLINK("http://evil.test","x")', source: 'other' })
      .expect(201);
    const sa = await signIn(USERS.superAdmin);
    const csv = await sa.agent.get('/api/v1/audit-logs.csv?q=HYPERLINK');
    expect(csv.status).toBe(200);
    expect(csv.text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv.text).toContain(`'=HYPERLINK`);
  });
});

describe('rescheduling an interview', () => {
  it('refuses an interviewer who is not active hiring staff, and an end before the start', async () => {
    const admin = await signIn(USERS.admin);
    // User 5 is an employee, not an interviewer.
    const employee = await admin.agent.patch('/api/v1/interviews/2').set('X-CSRF-Token', admin.csrf).send({ interviewerId: 5, notifyCandidate: false });
    expect(employee.status).toBe(422);
    expect(employee.body.error.fields.interviewerId).toBeTruthy();
    const missing = await admin.agent.patch('/api/v1/interviews/2').set('X-CSRF-Token', admin.csrf).send({ interviewerId: 99999, notifyCandidate: false });
    expect(missing.status).toBe(422);

    const start = new Date(Date.now() + 3 * 86_400_000);
    const backwards = await admin.agent.patch('/api/v1/interviews/2').set('X-CSRF-Token', admin.csrf)
      .send({ startsAt: start.toISOString(), endsAt: new Date(start.getTime() - 60_000).toISOString(), notifyCandidate: false });
    expect(backwards.status).toBe(422);
    expect(backwards.body.error.fields.endsAt).toBeTruthy();
  });
});

describe('HR account status changes', () => {
  it('disabling an account with an open reactivation request rejects the request instead of approving it', async () => {
    const { sql } = await import('../../server/db/client.js');
    const sa = await signIn(USERS.superAdmin);
    // Leo Martins (7) is suspended in the seed data.
    try {
      await sa.agent.post('/api/v1/users/7/reactivation').set('X-CSRF-Token', sa.csrf).send({ reason: 'Back from leave' }).expect(200);
      await sa.agent.patch('/api/v1/users/7/status').set('X-CSRF-Token', sa.csrf).send({ status: 'disabled', note: 'Left the company' }).expect(200);
      const [r] = await sql<{ status: string }[]>`select status from account_requests where user_id = 7 order by id desc limit 1`;
      expect(r?.status).toBe('rejected');
    } finally {
      await sql`update users set account_status = 'suspended', active = false where id = 7`;
    }
  });
});

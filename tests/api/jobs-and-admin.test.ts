import { describe, expect, it } from 'vitest';
import { USERS, anon, signIn } from '../helpers.js';

describe('job posting approval workflow', () => {
  it('recruiter drafts and submits; recruiter cannot publish; admin requests changes, then approves and publishes', async () => {
    const hr = await signIn(USERS.recruiter);
    const admin = await signIn(USERS.admin);
    const fields = { title: 'QA Automation Engineer', departmentId: 1, location: 'Remote', employmentType: 'full_time', description: 'Own test automation.', tags: 'Playwright, TypeScript' };

    const publish = await hr.agent.post('/api/v1/jobs').set('X-CSRF-Token', hr.csrf).send({ ...fields, action: 'publish' });
    expect(publish.status).toBe(403);

    const draft = await hr.agent.post('/api/v1/jobs').set('X-CSRF-Token', hr.csrf).send({ ...fields, action: 'submit' });
    expect(draft.status).toBe(201);
    const jobId = draft.body.data.jobId as number;
    expect(draft.body.data.state).toBe('pending');

    expect((await hr.agent.get('/api/v1/approvals')).status).toBe(403);
    const locked = await hr.agent.put(`/api/v1/jobs/${jobId}`).set('X-CSRF-Token', hr.csrf).send({ ...fields, action: 'save_draft' });
    expect(locked.status).toBe(403);

    const noNote = await admin.agent.post(`/api/v1/approvals/${jobId}/decision`).set('X-CSRF-Token', admin.csrf).send({ decision: 'request_changes' });
    expect(noNote.status).toBe(422);
    await admin.agent.post(`/api/v1/approvals/${jobId}/decision`).set('X-CSRF-Token', admin.csrf).send({ decision: 'request_changes', note: 'Add a salary range.' }).expect(200);

    const resubmit = await hr.agent.put(`/api/v1/jobs/${jobId}`).set('X-CSRF-Token', hr.csrf).send({ ...fields, salaryInfo: 'PHP 90k', action: 'submit' });
    expect(resubmit.status).toBe(200);
    const history = await hr.agent.get(`/api/v1/jobs/${jobId}`);
    expect(history.status).toBe(403);

    await admin.agent.post(`/api/v1/approvals/${jobId}/decision`).set('X-CSRF-Token', admin.csrf).send({ decision: 'approve_publish' }).expect(200);
    const detail = await admin.agent.get(`/api/v1/approvals/${jobId}`);
    expect(detail.body.data.history.map((h: { action: string }) => h.action)).toEqual(['submitted', 'changes_requested', 'resubmitted', 'approved', 'published']);

    const pub = await (await anon()).get('/api/v1/public/jobs');
    expect(pub.body.data.jobs.some((j: { id: number }) => j.id === jobId)).toBe(true);

    const notes = await hr.agent.get('/api/v1/notifications');
    expect(notes.body.data.items.some((n: { type: string }) => n.type === 'job_decision')).toBe(true);
  });
});

describe('accounts and seats', () => {
  it('only the Super Admin creates HR/Recruiter accounts; Admins cannot be given that permission', async () => {
    const admin = await signIn(USERS.admin);
    // Even an Admin who held the old grant no longer has it.
    expect(admin.me.permissions).not.toContain('manage_accounts');
    const denied = await admin.agent.post('/api/v1/users').set('X-CSRF-Token', admin.csrf)
      .send({ name: 'Nina Park', email: 'nina.park@acme.test', password: 'temporary1', permissions: ['job_posting'] });
    expect(denied.status).toBe(403);

    const sa = await signIn(USERS.superAdmin);
    const admins = await sa.agent.get('/api/v1/admin/admins');
    const alicia = admins.body.data.admins.find((a: { email: string }) => a.email === USERS.admin);
    expect(alicia.permissions).not.toContain('manage_accounts');
    // Granting it is ignored.
    await sa.agent.put(`/api/v1/admin/admins/${alicia.id}/permissions`).set('X-CSRF-Token', sa.csrf)
      .send({ hrAccountLimit: alicia.hrAccountLimit, permissions: [...alicia.permissions, 'manage_accounts'] }).expect(200);
    const again = await signIn(USERS.admin);
    expect(again.me.permissions).not.toContain('manage_accounts');

    const created = await sa.agent.post('/api/v1/users').set('X-CSRF-Token', sa.csrf)
      .send({ name: 'Nina Park', email: 'nina.park@acme.test', password: 'temporary1', permissions: ['job_posting'] });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  });

  it('password reset: request, Super Admin approval issues a one-time link, link works once', async () => {
    const sa = await signIn(USERS.superAdmin);
    const list = await sa.agent.get('/api/v1/password-resets');
    const pending = list.body.data.pending[0];
    const decided = await sa.agent.post(`/api/v1/password-resets/${pending.id}/decision`).set('X-CSRF-Token', sa.csrf).send({ decision: 'approved' });
    const token = new URL(decided.body.data.resetLink).pathname.split('/').pop();
    const check = await (await anon()).get(`/api/v1/auth/reset-password/${token}`);
    expect(check.body.data.valid).toBe(true);
    const weak = await (await anon()).post('/api/v1/auth/reset-password').send({ token, password: 'short', confirm: 'short' });
    expect(weak.status).toBe(422);
    await (await anon()).post('/api/v1/auth/reset-password').send({ token, password: 'NewPassword9', confirm: 'NewPassword9' }).expect(200);
    const again = await (await anon()).post('/api/v1/auth/reset-password').send({ token, password: 'NewPassword9', confirm: 'NewPassword9' });
    expect(again.status).toBe(410);
    await signIn(USERS.manager, 'NewPassword9');
  });

  it('keeps recruiters out of Super Admin and settings areas', async () => {
    const hr = await signIn(USERS.recruiter);
    expect((await hr.agent.get('/api/v1/admin/admins')).status).toBe(403);
    expect((await hr.agent.get('/api/v1/settings')).status).toBe(403);
    expect((await hr.agent.get('/api/v1/users')).status).toBe(403);
    const audit = await hr.agent.get('/api/v1/audit-logs');
    expect(audit.status).toBe(200);
    expect(audit.body.data.ownOnly).toBe(true);
  });
});

describe('attendance', () => {
  it('a linked employee clocks in once and out once; an unlinked user is told so', async () => {
    const e = await signIn(USERS.employee);
    const me = await e.agent.get('/api/v1/attendance/me');
    expect(me.body.data.linked).toBe(true);
    await e.agent.post('/api/v1/attendance/clock-in').set('X-CSRF-Token', e.csrf).expect(200);
    expect((await e.agent.post('/api/v1/attendance/clock-in').set('X-CSRF-Token', e.csrf)).status).toBe(409);
    await e.agent.post('/api/v1/attendance/clock-out').set('X-CSRF-Token', e.csrf).expect(200);
    const after = await e.agent.get('/api/v1/attendance/me');
    expect(after.body.data.todayRecord.status).toBe('half_day');
    expect((await e.agent.get('/api/v1/attendance')).status).toBe(403);

    const hr = await signIn(USERS.recruiter);
    const unlinked = await hr.agent.get('/api/v1/attendance/me');
    expect(unlinked.body.data.linked).toBe(false);
  });
});

describe('careers site rules', () => {
  it('enforces the applicant limit and reports the Full state', async () => {
    const res = await (await anon()).get('/api/v1/public/jobs/devops-engineer');
    expect(res.body.data.applicantLimit).toBe(5);
    expect(res.body.data.full).toBe(false);
  });

  it('status lookup lists applications by email and withdraw is final', async () => {
    const list = await (await anon()).post('/api/v1/public/status').send({ email: 'maya.chen@example.com' });
    expect(list.body.data.kind).toBe('list');
    const one = await (await anon()).post('/api/v1/public/status').send({ email: 'maya.chen@example.com', applicationId: 1 });
    expect(one.body.data.application.stageLabel).toBe('Screening');
    await (await anon()).post('/api/v1/public/status/withdraw').send({ email: 'maya.chen@example.com', applicationId: 1 }).expect(200);
    const after = await (await anon()).post('/api/v1/public/status').send({ email: 'maya.chen@example.com', applicationId: 1 });
    expect(after.body.data.application.withdrawn).toBe(true);
    const wrong = await (await anon()).post('/api/v1/public/status').send({ email: 'someone@example.com', applicationId: 1 });
    expect(wrong.status).toBe(404);
  });

  it('shows rejection feedback and a suggested role', async () => {
    const res = await (await anon()).post('/api/v1/public/status').send({ email: 'pedro.alves@example.com', applicationId: 11 });
    expect(res.body.data.application.rejected).toBe(true);
    expect(res.body.data.application.feedback.fit).toBe('not-a-fit');
    expect(res.body.data.application.suggestions[0].title).toBe('Content Marketer');
    expect(res.body.data.application.submission).toHaveProperty('coverLetter');
  });
});

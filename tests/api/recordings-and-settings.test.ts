import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS, getApp, signIn } from '../helpers.js';

beforeAll(async () => { await getApp(); });
afterAll(async () => {
  const { sql } = await import('../../server/db/client.js');
  await sql`delete from rate_limits where bucket like 'login-%'`;
  await sql.end({ timeout: 1 });
});

describe('candidate recordings', () => {
  it('shows the summary and moments to the hiring team, and keeps the transcript for the interviewer', async () => {
    const { sql } = await import('../../server/db/client.js');
    const hr = await signIn(USERS.recruiter);
    const admin = await signIn(USERS.admin);

    // A meeting held by the recruiter, with something said and a summary at the end.
    const made = await hr.agent.post('/api/v1/interviews').set('X-CSRF-Token', hr.csrf).send({
      applicationId: 7, startsAt: new Date(Date.now() + 5 * 60_000).toISOString(), interviewType: 'video', meetingType: 'interview', meetingMode: 'builtin',
    });
    expect(made.status).toBe(201);
    const id = (made.body.data as { interviewId: number }).interviewId;
    await sql`insert into interview_transcripts (interview_id, at_second, text) values (${id}, 30, 'I can start after a thirty day notice.')`;
    await sql`insert into interview_moments (interview_id, at_second, label, user_id) values (${id}, 30, 'Availability', ${hr.me.id})`;
    await sql`update interviews set started_at = now() - interval '40 minutes', ended_at = now() - interval '5 minutes',
              ai_summary = ${sql.json({ summary: 'Available after notice.', keyAnswers: [], strengths: ['Clear'], concerns: [], followUps: [] })} where id = ${id}`;

    const mine = await hr.agent.get('/api/v1/candidates/7/recordings');
    expect(mine.status).toBe(200);
    const item = (mine.body.data.items as Array<{ interviewId: number; transcript: unknown[]; detailLocked: boolean; durationMinutes: number; summary: { summary: string } }>).find((i) => i.interviewId === id)!;
    expect(item.detailLocked).toBe(false);
    expect(item.transcript).toHaveLength(1);
    expect(item.durationMinutes).toBe(35);
    expect(item.summary.summary).toBe('Available after notice.');

    // Another member of the team sees the review material, not what was said.
    const theirs = await admin.agent.get('/api/v1/candidates/7/recordings');
    expect(theirs.status).toBe(200);
    const seen = (theirs.body.data.items as Array<{ interviewId: number; transcript: unknown[]; notes: unknown[]; moments: unknown[]; detailLocked: boolean; summary: unknown }>).find((i) => i.interviewId === id)!;
    expect(seen.detailLocked).toBe(true);
    expect(seen.transcript).toEqual([]);
    expect(seen.notes).toEqual([]);
    expect(seen.moments).toHaveLength(1);
    expect(seen.summary).not.toBeNull();
    expect(JSON.stringify(theirs.body)).not.toMatch(/thirty day notice/);
  });

  it('is for staff only, and unknown applications are a 404', async () => {
    const employee = await signIn(USERS.employee);
    expect((await employee.agent.get('/api/v1/candidates/7/recordings')).status).toBe(403);
    const hr = await signIn(USERS.recruiter);
    expect((await hr.agent.get('/api/v1/candidates/999999/recordings')).status).toBe(404);
  });
});

describe('workspace settings', () => {
  it('saves without the technical fields and leaves their stored values alone', async () => {
    const admin = await signIn(USERS.admin);
    const before = (await admin.agent.get('/api/v1/settings')).body.data as { passwordResetHours: number; iceServers: string; interviewReminderMinutes: number };
    const saved = await admin.agent.put('/api/v1/settings').set('X-CSRF-Token', admin.csrf).send({
      companyName: 'Acme', careersHeadline: 'Do the best work of your career.', logoPath: '', defaultApplicantLimit: '',
      interviewJoinWindowMinutes: 15, interviewReminderMinutes: 120, attendanceTimezone: 'Asia/Manila', attendanceGraceMinutes: 10,
    });
    expect(saved.status).toBe(200);
    const after = (await admin.agent.get('/api/v1/settings')).body.data as typeof before;
    expect(after.interviewReminderMinutes).toBe(120);
    expect(after.passwordResetHours).toBe(before.passwordResetHours);
    expect(after.iceServers).toBe(before.iceServers);
    // put the reminder back so other tests keep their defaults
    await admin.agent.put('/api/v1/settings').set('X-CSRF-Token', admin.csrf).send({
      companyName: 'Acme', careersHeadline: 'Do the best work of your career.', logoPath: '', defaultApplicantLimit: '',
      interviewJoinWindowMinutes: 15, interviewReminderMinutes: before.interviewReminderMinutes, attendanceTimezone: 'Asia/Manila', attendanceGraceMinutes: 10,
    }).expect(200);
  });

  it('still rejects a malformed ICE server list when one is sent', async () => {
    const admin = await signIn(USERS.admin);
    const res = await admin.agent.put('/api/v1/settings').set('X-CSRF-Token', admin.csrf).send({
      companyName: 'Acme', careersHeadline: '', logoPath: '', defaultApplicantLimit: '',
      interviewJoinWindowMinutes: 15, interviewReminderMinutes: 60, attendanceTimezone: 'Asia/Manila', attendanceGraceMinutes: 10, iceServers: 'not json',
    });
    expect(res.status).toBe(422);
  });
});

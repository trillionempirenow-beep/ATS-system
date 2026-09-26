import { describe, expect, it } from 'vitest';
import { USERS, anon, signIn } from '../helpers.js';

describe('interview scheduling, waiting room and review', () => {
  it('runs the whole lifecycle: schedule → candidate waits → admit → end → review', async () => {
    const hr = await signIn(USERS.recruiter);
    const startsAt = new Date(Date.now() + 5 * 60_000).toISOString();

    const scheduled = await hr.agent.post('/api/v1/interviews').set('X-CSRF-Token', hr.csrf).send({
      applicationId: 9, startsAt, interviewType: 'video', meetingType: 'screening', meetingMode: 'builtin',
    });
    expect(scheduled.status).toBe(201);
    const { interviewId, candidateLink } = scheduled.body.data as { interviewId: number; candidateLink: string };
    expect(candidateLink).toMatch(/\/interview\/ACM[A-Z0-9]+\?t=[a-f0-9]{32}$/);
    const url = new URL(candidateLink);
    const code = url.pathname.split('/').pop()!;
    const t = url.searchParams.get('t')!;

    const clash = await hr.agent.post('/api/v1/interviews').set('X-CSRF-Token', hr.csrf).send({
      applicationId: 5, startsAt, interviewType: 'video', meetingType: 'interview', meetingMode: 'builtin',
    });
    expect(clash.status).toBe(409);

    const bad = await (await anon()).get(`/api/v1/room/${code}`).query({ t: 'f'.repeat(32) });
    expect(bad.status).toBe(403);

    const state = await (await anon()).get(`/api/v1/room/${code}`).query({ t });
    expect(state.status).toBe(200);
    expect(state.body.data.canJoin).toBe(true);
    expect(state.body.data.realtime.room).toBeNull();
    expect(JSON.stringify(state.body.data)).not.toMatch(/liveNotes|score|feedback/);

    const waiting = await (await anon()).post(`/api/v1/room/${code}/request-entry`).send({ t });
    expect(waiting.body.data.requestState).toBe('waiting');

    const presence = await hr.agent.post(`/api/v1/interviews/${interviewId}/presence`).set('X-CSRF-Token', hr.csrf);
    expect(presence.body.data.pendingRequest?.name).toBeTruthy();

    const early = await hr.agent.post(`/api/v1/interviews/${interviewId}/review`).set('X-CSRF-Token', hr.csrf)
      .send({ score: 80, review: 'x', recommendation: 'proceed' });
    expect(early.status).toBe(409);

    await hr.agent.post(`/api/v1/interviews/${interviewId}/admit`).set('X-CSRF-Token', hr.csrf).expect(200);
    const admitted = await (await anon()).get(`/api/v1/room/${code}`).query({ t });
    expect(admitted.body.data.requestState).toBe('admitted');
    expect(admitted.body.data.realtime.room).toMatch(/^room-/);

    await hr.agent.post(`/api/v1/interviews/${interviewId}/notes`).set('X-CSRF-Token', hr.csrf).send({ liveNotes: 'Strong answers' }).expect(200);
    await hr.agent.post(`/api/v1/interviews/${interviewId}/end`).set('X-CSRF-Token', hr.csrf).send({}).expect(200);
    const ended = await (await anon()).get(`/api/v1/room/${code}`).query({ t });
    expect(ended.body.data.joinState).toBe('ended');

    await hr.agent.post(`/api/v1/interviews/${interviewId}/review`).set('X-CSRF-Token', hr.csrf)
      .send({ score: 81, review: 'Good fit', recommendation: 'proceed' }).expect(200);
    const profile = await hr.agent.get('/api/v1/candidates/9');
    expect(profile.body.data.screeningReview.rating).toBe(81);
    expect(profile.body.data.stage).toBe('screening');
  });

  it('keeps employees out of recruiting endpoints', async () => {
    const e = await signIn(USERS.employee);
    expect((await e.agent.get('/api/v1/interviews')).status).toBe(403);
    expect((await e.agent.get('/api/v1/candidates')).status).toBe(403);
  });
});

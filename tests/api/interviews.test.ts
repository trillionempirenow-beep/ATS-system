import { describe, expect, it } from 'vitest';
import { USERS, anon, signIn, type Session } from '../helpers.js';

describe('interview scheduling, waiting room and review', () => {
  // One recruiter session for the file: sign-ins count against the suite-wide login rate limit.
  let recruiter: Promise<Session> | null = null;
  const signInRecruiter = () => (recruiter ??= signIn(USERS.recruiter));

  it('runs the whole lifecycle: schedule → candidate waits → admit → end → review', async () => {
    const hr = await signInRecruiter();
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

  it('runs a final interview with guests: link → entry form → admit / deny → end', async () => {
    const hr = await signInRecruiter();
    const startsAt = new Date(Date.now() + 7 * 60_000).toISOString();
    const scheduled = await hr.agent.post('/api/v1/interviews').set('X-CSRF-Token', hr.csrf).send({
      applicationId: 5, startsAt, interviewType: 'panel', meetingType: 'interview', meetingMode: 'builtin', finalInterview: true, sendInvite: false,
    });
    expect(scheduled.status).toBe(201);
    const { interviewId, candidateLink, guestLink } = scheduled.body.data as { interviewId: number; candidateLink: string; guestLink: string };
    expect(guestLink).toMatch(/\/interview\/ACM[A-Z0-9]+\/guest\?g=[a-f0-9]{32}$/);
    const code = new URL(guestLink).pathname.split('/')[2]!;
    const g = new URL(guestLink).searchParams.get('g')!;
    const t = new URL(candidateLink).searchParams.get('t')!;
    const guestApi = `/api/v1/room/${code}/guest`;

    // Scheduling a final interview moves the candidate into the Final interview stage.
    expect((await hr.agent.get('/api/v1/candidates/5')).body.data.stage).toBe('final_interview');

    // The two links never stand in for each other.
    expect((await (await anon()).get(guestApi).query({ g: t })).status).toBe(403);
    expect((await (await anon()).get(`/api/v1/room/${code}`).query({ t: g })).status).toBe(403);

    const entry = await (await anon()).get(guestApi).query({ g });
    expect(entry.status).toBe(200);
    expect(entry.body.data.canJoin).toBe(true);
    expect(JSON.stringify(entry.body.data)).not.toMatch(/candidate|liveNotes|score|email/i);

    const missing = await (await anon()).post(`${guestApi}/join`).send({ g, name: 'Jane Doe', position: '' });
    expect(missing.status).toBe(422);
    expect(missing.body.error.fields.position).toBeTruthy();

    const jane = await (await anon()).post(`${guestApi}/join`).send({ g, name: 'Jane Doe', position: 'Head of Marketing' });
    expect(jane.status).toBe(201);
    expect(jane.body.data.guest.state).toBe('waiting');
    expect(jane.body.data.realtime.room).toBeNull();
    expect(jane.body.data.realtime.lobby).toMatch(/^guest-/);
    const janeKey = jane.body.data.guest.key as string;
    const janeId = jane.body.data.guest.id as number;

    const mallory = await (await anon()).post(`${guestApi}/join`).send({ g, name: 'Mallory', position: 'Consultant' });
    const malloryId = mallory.body.data.guest.id as number;

    const presence = await hr.agent.post(`/api/v1/interviews/${interviewId}/presence`).set('X-CSRF-Token', hr.csrf);
    expect(presence.body.data.guestRequests.map((r: { name: string; position: string }) => `${r.name} - ${r.position}`))
      .toEqual(['Jane Doe - Head of Marketing', 'Mallory - Consultant']);

    await hr.agent.post(`/api/v1/interviews/${interviewId}/guests/${malloryId}/decision`).set('X-CSRF-Token', hr.csrf).send({ decision: 'deny' }).expect(200);
    const denied = await (await anon()).post(`${guestApi}/status`).send({ g, key: mallory.body.data.guest.key });
    expect(denied.body.data.guest.state).toBe('denied');
    expect(denied.body.data.realtime.room).toBeNull();

    await hr.agent.post(`/api/v1/interviews/${interviewId}/guests/${janeId}/decision`).set('X-CSRF-Token', hr.csrf).send({ decision: 'admit' }).expect(200);
    const admitted = await (await anon()).post(`${guestApi}/status`).send({ g, key: janeKey });
    expect(admitted.body.data.guest.state).toBe('admitted');
    expect(admitted.body.data.realtime.room).toMatch(/^room-/);
    expect(admitted.body.data.rtc).not.toBeNull();

    // A second host changing their mind after the first decided gets a clear answer.
    const late = await hr.agent.post(`/api/v1/interviews/${interviewId}/guests/${janeId}/decision`).set('X-CSRF-Token', hr.csrf).send({ decision: 'deny' });
    expect(late.status).toBe(409);

    const staffRoom = await hr.agent.get(`/api/v1/interviews/${interviewId}`);
    expect(staffRoom.body.data.guests.link).toBe(guestLink);
    expect(staffRoom.body.data.guests.admitted).toEqual([{ id: janeId, peerId: `g${janeId}`, name: 'Jane Doe', position: 'Head of Marketing' }]);

    await hr.agent.post(`/api/v1/interviews/${interviewId}/end`).set('X-CSRF-Token', hr.csrf).send({}).expect(200);
    const ended = await (await anon()).post(`${guestApi}/status`).send({ g, key: janeKey });
    expect(ended.body.data.ended).toBe(true);
    expect(ended.body.data.realtime.room).toBeNull();
    expect((await (await anon()).post(`${guestApi}/join`).send({ g, name: 'Late', position: 'Director' })).status).toBe(409);

    // Its review is kept as the final interview review, apart from the first interview's.
    await hr.agent.post(`/api/v1/interviews/${interviewId}/review`).set('X-CSRF-Token', hr.csrf)
      .send({ score: 90, review: 'Panel agreed', recommendation: 'offer' }).expect(200);
    const profile = await hr.agent.get('/api/v1/candidates/5');
    expect(profile.body.data.finalInterviewReview.rating).toBe(90);
    expect(profile.body.data.interviewReview?.rating ?? null).not.toBe(90);
  });

  it('treats the final interview as an optional stage between Interview and Offer', async () => {
    const hr = await signInRecruiter();
    const move = (stage: string) => hr.agent.post('/api/v1/applications/5/stage').set('X-CSRF-Token', hr.csrf).send({ stage });
    // Booking a regular interview never pulls a candidate back out of the final round.
    await hr.agent.post('/api/v1/interviews').set('X-CSRF-Token', hr.csrf).send({
      applicationId: 5, startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), interviewType: 'video', meetingType: 'interview', meetingMode: 'builtin', sendInvite: false,
    }).expect(201);
    expect((await hr.agent.get('/api/v1/candidates/5')).body.data.stage).toBe('final_interview');

    expect((await move('interview')).status).toBe(200);
    // Roles without a final round go straight to Offer: that is not a skip.
    const toOffer = await move('offer');
    expect(toOffer.status).toBe(200);
    expect(toOffer.body.data.override).toBe(false);
    expect((await move('final_interview')).status).toBe(200);

    // Applicants only see the final round on their timeline when their process has one.
    const timeline = async (email: string, applicationId: number) =>
      ((await (await anon()).post('/api/v1/public/status').send({ email, applicationId: String(applicationId) })).body.data.application.timeline as Array<{ key: string }>)
        .map((t) => t.key);
    expect(await timeline('luis.fernandez@example.com', 5)).toContain('final_interview');
    expect(await timeline('ravi.menon@example.com', 9)).not.toContain('final_interview');
  });

  it('only issues guest links for final interviews in the built-in room', async () => {
    const hr = await signInRecruiter();
    const plain = await hr.agent.post('/api/v1/interviews').set('X-CSRF-Token', hr.csrf).send({
      applicationId: 5, startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), interviewType: 'video', meetingType: 'interview', meetingMode: 'builtin', sendInvite: false,
    });
    expect(plain.status).toBe(201);
    expect(plain.body.data.guestLink).toBeNull();
    const external = await hr.agent.post('/api/v1/interviews').set('X-CSRF-Token', hr.csrf).send({
      applicationId: 5, startsAt: new Date(Date.now() + 4 * 86_400_000).toISOString(), interviewType: 'video', meetingType: 'interview',
      meetingMode: 'external', meetingUrl: 'https://meet.example.com/x', finalInterview: true, sendInvite: false,
    });
    expect(external.status).toBe(201);
    expect(external.body.data.guestLink).toBeNull();
    const screening = await hr.agent.post('/api/v1/interviews').set('X-CSRF-Token', hr.csrf).send({
      applicationId: 5, startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), interviewType: 'video', meetingType: 'screening',
      meetingMode: 'builtin', finalInterview: true, sendInvite: false,
    });
    expect(screening.status).toBe(422);
  });

  it('keeps employees out of recruiting endpoints', async () => {
    const e = await signIn(USERS.employee);
    expect((await e.agent.get('/api/v1/interviews')).status).toBe(403);
    expect((await e.agent.get('/api/v1/candidates')).status).toBe(403);
    expect((await e.agent.post('/api/v1/interviews/1/guests/1/decision').set('X-CSRF-Token', e.csrf).send({ decision: 'admit' })).status).toBe(403);
  });
});

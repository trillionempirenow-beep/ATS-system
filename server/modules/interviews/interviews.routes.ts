import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  assistantChunkSchema, assistantToggleSchema, recordingGrantSchema, recordingSaveSchema, endMeetingSchema, guestDecisionSchema, guestJoinSchema, guestSessionSchema, liveNotesSchema, momentSchema, reviewSchema, scheduleInterviewSchema, scorecardDraftSchema, updateInterviewSchema,
} from '../../../shared/api/interviews.js';
import { body, idParam, parse } from '../../http/validate.js';
import { requireStaff } from '../../middleware/guards.js';
import { rateLimit } from '../../middleware/security.js';
import * as service from './interviews.service.js';
import * as room from './room-access.service.js';
import * as guests from './guest-access.service.js';
import * as aiNotes from './interview-notes.service.js';
import * as recordings from './interview-recordings.service.js';

export const interviewsRouter = Router();

const ctx = (req: Request) => ({ user: req.auth!.user, ip: req.ip ?? null });
const ok = { data: { ok: true } };

// ---- Staff -----------------------------------------------------------------
interviewsRouter.use('/interviews', requireStaff);

interviewsRouter.get('/interviews', async (_req, res) => { res.json({ data: await service.list() }); });
interviewsRouter.get('/interviews/options', async (_req, res) => { res.json({ data: await service.scheduleOptions() }); });
interviewsRouter.get('/interviews/live', async (req, res) => { res.json({ data: await service.myLiveMeeting(req.auth!.user) }); });

interviewsRouter.post('/interviews', async (req, res) => {
  res.status(201).json({ data: await service.schedule(body(req, scheduleInterviewSchema), ctx(req)) });
});

interviewsRouter.get('/interviews/:id', async (req, res) => {
  res.json({ data: await service.staffRoom(idParam(req), req.auth!.user) });
});

interviewsRouter.patch('/interviews/:id', async (req, res) => {
  res.json({ data: await service.update(idParam(req), body(req, updateInterviewSchema), ctx(req)) });
});

interviewsRouter.post('/interviews/:id/presence', async (req, res) => {
  res.json({ data: await service.staffPresence(idParam(req)) });
});

interviewsRouter.post('/interviews/:id/leave', async (req, res) => {
  await service.staffLeave(idParam(req));
  res.json(ok);
});

interviewsRouter.post('/interviews/:id/admit', async (req, res) => {
  await service.admit(idParam(req), ctx(req));
  res.json(ok);
});

// Guests: a host lets a waiting guest in, or turns them away.
interviewsRouter.post('/interviews/:id/guests/:guestId/decision', async (req, res) => {
  res.json({ data: await guests.decide(idParam(req), idParam(req, 'guestId'), body(req, guestDecisionSchema).decision, ctx(req)) });
});

interviewsRouter.post('/interviews/:id/notes', async (req, res) => {
  res.json({ data: await service.saveNotes(idParam(req), body(req, liveNotesSchema).liveNotes, req.auth!.user) });
});

interviewsRouter.post('/interviews/:id/connected', async (req, res) => {
  await service.markConnected(idParam(req));
  res.json(ok);
});

interviewsRouter.post('/interviews/:id/end', async (req, res) => {
  await service.endMeeting(idParam(req), body(req, endMeetingSchema).liveNotes, ctx(req));
  res.json(ok);
});

interviewsRouter.post('/interviews/:id/review', async (req, res) => {
  await service.submitReview(idParam(req), body(req, reviewSchema), ctx(req));
  res.json(ok);
});

interviewsRouter.put('/interviews/:id/scorecard/draft', async (req, res) => {
  await service.saveScorecardDraft(idParam(req), body(req, scorecardDraftSchema), req.auth!.user);
  res.json(ok);
});

interviewsRouter.post('/interviews/:id/moments', async (req, res) => {
  res.status(201).json({ data: await service.flagMoment(idParam(req), body(req, momentSchema), req.auth!.user) });
});

interviewsRouter.patch('/interviews/:id/assistant', async (req, res) => {
  res.json({ data: await aiNotes.setEnabled(idParam(req), body(req, assistantToggleSchema).enabled, req.auth!.user.id) });
});

interviewsRouter.post('/interviews/:id/assistant/chunk', async (req, res) => {
  res.json({ data: await aiNotes.addChunk(idParam(req), body(req, assistantChunkSchema), req.auth!.user.id) });
});

interviewsRouter.post('/interviews/:id/recordings/grant', rateLimit({ name: 'recording-grant', max: 60, windowSeconds: 3600 }), async (req, res) => {
  res.json({ data: await recordings.grant(idParam(req), req.auth!.user.id, body(req, recordingGrantSchema).mime) });
});

interviewsRouter.post('/interviews/:id/recordings', async (req, res) => {
  res.status(201).json({ data: await recordings.save(idParam(req), req.auth!.user.id, body(req, recordingSaveSchema)) });
});

// ---- Candidate (interview token) ------------------------------------------
const tokenOf = (req: Request) => parse(z.string().max(64), (req.body as { t?: unknown })?.t ?? req.query.t ?? '');
const codeOf = (req: Request) => parse(z.string().regex(/^[A-Z0-9]{4,20}$/i), req.params.code).toUpperCase();
const roomLimit = rateLimit({ name: 'room', max: 240, windowSeconds: 600 });

interviewsRouter.get('/room/:code', roomLimit, async (req, res) => {
  res.json({ data: await room.roomState(codeOf(req), tokenOf(req)) });
});
interviewsRouter.post('/room/:code/heartbeat', roomLimit, async (req, res) => {
  res.json({ data: await room.heartbeat(codeOf(req), tokenOf(req)) });
});
interviewsRouter.post('/room/:code/request-entry', roomLimit, async (req, res) => {
  res.json({ data: await room.requestEntry(codeOf(req), tokenOf(req)) });
});
interviewsRouter.post('/room/:code/cancel', roomLimit, async (req, res) => {
  await room.cancelRequest(codeOf(req), tokenOf(req));
  res.json(ok);
});
interviewsRouter.post('/room/:code/leave', roomLimit, async (req, res) => {
  await room.leave(codeOf(req), tokenOf(req));
  res.json(ok);
});

// ---- Interview guest (guest link) ------------------------------------------
// Joining is limited harder than polling: each join puts a request in front of the hosts.
const guestJoinLimit = rateLimit({ name: 'guest-join', max: 10, windowSeconds: 600 });
const guestTokenOf = (req: Request) => parse(z.string().regex(/^[a-f0-9]{32}$/i), req.query.g ?? '');

interviewsRouter.get('/room/:code/guest', roomLimit, async (req, res) => {
  res.json({ data: await guests.guestRoom(codeOf(req), guestTokenOf(req)) });
});
interviewsRouter.post('/room/:code/guest/join', guestJoinLimit, async (req, res) => {
  const input = body(req, guestJoinSchema);
  res.status(201).json({ data: await guests.join(codeOf(req), input.g, input.name, input.position) });
});
interviewsRouter.post('/room/:code/guest/status', roomLimit, async (req, res) => {
  const input = body(req, guestSessionSchema);
  res.json({ data: await guests.status(codeOf(req), input.g, input.key) });
});
interviewsRouter.post('/room/:code/guest/leave', roomLimit, async (req, res) => {
  const input = body(req, guestSessionSchema);
  await guests.leave(codeOf(req), input.g, input.key);
  res.json(ok);
});

import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  addCandidateSchema, candidateListQuerySchema, convertEmployeeSchema, documentUploadSchema, feedbackSchema, noteSchema,
  profileUpdateSchema, ratingSchema, requiredFieldsSchema, stageReviewSchema, suggestionSchema,
} from '../../../shared/api/candidates.js';
import { body, idParam, parse, query } from '../../http/validate.js';
import { REVIEW_STAGES } from '../../../shared/domain/pipeline.js';
import { requireStaff } from '../../middleware/guards.js';
import { rateLimit } from '../../middleware/security.js';
import * as service from './candidates.service.js';

export const candidatesRouter = Router();
candidatesRouter.use('/candidates', requireStaff);

const ctx = (req: Request) => ({ user: req.auth!.user, ip: req.ip ?? null });
const ok = { data: { ok: true } };

candidatesRouter.get('/candidates', async (req, res) => {
  res.json({ data: await service.list(query(req, candidateListQuerySchema)) });
});

candidatesRouter.get('/candidates/form-options', async (_req, res) => {
  const [required, jobs] = await Promise.all([service.requiredFields(), service.openJobsForForms()]);
  res.json({ data: { required, jobs } });
});

candidatesRouter.put('/candidates/required-fields', async (req, res) => {
  await service.setRequiredFields(body(req, requiredFieldsSchema).required, ctx(req));
  res.json(ok);
});

candidatesRouter.post('/candidates/parse-cv', rateLimit({ name: 'parse-cv', max: 30, windowSeconds: 600 }), async (req, res) => {
  res.json({ data: await service.parseCv(body(req, documentUploadSchema).uploadId, ctx(req)) });
});

candidatesRouter.post('/candidates', async (req, res) => {
  res.status(201).json({ data: await service.addCandidate(body(req, addCandidateSchema), ctx(req)) });
});

candidatesRouter.get('/candidates/:id', async (req, res) => {
  res.json({ data: await service.profile(idParam(req)) });
});

candidatesRouter.patch('/candidates/:id', async (req, res) => {
  await service.updateProfile(idParam(req), body(req, profileUpdateSchema), ctx(req));
  res.json(ok);
});

candidatesRouter.post('/candidates/:id/notes', async (req, res) => {
  await service.addNote(idParam(req), body(req, noteSchema).note, ctx(req));
  res.status(201).json(ok);
});

candidatesRouter.put('/candidates/:id/rating', async (req, res) => {
  await service.setRating(idParam(req), body(req, ratingSchema).rating, ctx(req));
  res.json(ok);
});

candidatesRouter.post('/candidates/:id/feedback', async (req, res) => {
  await service.addFeedback(idParam(req), body(req, feedbackSchema), ctx(req));
  res.status(201).json(ok);
});

candidatesRouter.post('/candidates/:id/suggestions', async (req, res) => {
  await service.addSuggestion(idParam(req), body(req, suggestionSchema), ctx(req));
  res.status(201).json(ok);
});

candidatesRouter.put('/candidates/:id/stage-reviews/:stageType', async (req, res) => {
  const stageType = parse(z.enum(REVIEW_STAGES), req.params.stageType);
  await service.saveStageReview(idParam(req), stageType, body(req, stageReviewSchema), ctx(req));
  res.json(ok);
});

candidatesRouter.post('/candidates/:id/analysis', async (req, res) => {
  await service.runAnalysis(idParam(req), ctx(req));
  res.json(ok);
});

candidatesRouter.post('/candidates/:id/documents', async (req, res) => {
  await service.addDocument(idParam(req), body(req, documentUploadSchema).uploadId, ctx(req));
  res.status(201).json(ok);
});

candidatesRouter.post('/candidates/:id/convert-to-employee', async (req, res) => {
  res.status(201).json({ data: await service.convertToEmployee(idParam(req), body(req, convertEmployeeSchema), ctx(req)) });
});

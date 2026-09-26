import { Router } from 'express';
import { pipelineQuerySchema, stageMoveSchema } from '../../../shared/api/pipeline.js';
import { body, idParam, query } from '../../http/validate.js';
import { requireStaff } from '../../middleware/guards.js';
import * as service from './pipeline.service.js';

export const pipelineRouter = Router();

pipelineRouter.get('/pipeline', requireStaff, async (req, res) => {
  res.json({ data: await service.board(query(req, pipelineQuerySchema)) });
});

pipelineRouter.post('/applications/:id/stage', requireStaff, async (req, res) => {
  res.json({ data: await service.moveStage(idParam(req), body(req, stageMoveSchema), req.auth!.user, req.ip ?? null) });
});

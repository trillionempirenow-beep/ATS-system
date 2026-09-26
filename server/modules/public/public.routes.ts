import { Router } from 'express';
import { applySchema, publicJobsQuerySchema, referralSchema, statusLookupSchema, withdrawSchema } from '../../../shared/api/public.js';
import { body, query } from '../../http/validate.js';
import { rateLimit } from '../../middleware/security.js';
import * as service from './public.service.js';

export const publicRouter = Router();

publicRouter.get('/public/config', async (_req, res) => {
  res.json({ data: await service.publicConfig() });
});

publicRouter.get('/public/home', async (_req, res) => {
  res.json({ data: await service.home() });
});

publicRouter.get('/public/jobs', async (req, res) => {
  res.json({ data: await service.listJobs(query(req, publicJobsQuerySchema)) });
});

publicRouter.get('/public/jobs/:slug', async (req, res) => {
  res.json({ data: await service.jobDetail(String(req.params.slug)) });
});

publicRouter.post(
  '/public/jobs/:slug/apply',
  rateLimit({ name: 'apply', max: 10, windowSeconds: 3600 }),
  async (req, res) => {
    const input = body(req, applySchema);
    res.status(201).json({ data: await service.apply(String(req.params.slug), input, req.ip ?? null) });
  },
);

publicRouter.post('/public/status', rateLimit({ name: 'status', max: 60, windowSeconds: 600 }), async (req, res) => {
  const input = body(req, statusLookupSchema);
  res.json({ data: await service.statusLookup(input.email, input.applicationId) });
});

publicRouter.post('/public/status/withdraw', rateLimit({ name: 'withdraw', max: 10, windowSeconds: 3600 }), async (req, res) => {
  const input = body(req, withdrawSchema);
  await service.withdraw(input.email, input.applicationId, req.ip ?? null);
  res.json({ data: { ok: true } });
});

publicRouter.post('/public/referrals', rateLimit({ name: 'referral', max: 10, windowSeconds: 3600 }), async (req, res) => {
  await service.createReferral(body(req, referralSchema), req.ip ?? null);
  res.status(201).json({ data: { ok: true } });
});

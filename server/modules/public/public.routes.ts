import { Router, type Response } from 'express';
import { applySchema, publicJobsQuerySchema, referralSchema, statusLinksSchema, statusLookupSchema, withdrawSchema } from '../../../shared/api/public.js';
import { body, query } from '../../http/validate.js';
import { rateLimit } from '../../middleware/security.js';
import * as service from './public.service.js';

export const publicRouter = Router();

/**
 * The careers pages are the same for everyone, so the CDN (Vercel) may keep a copy for
 * 30 seconds: a flood of visitors is answered from the edge instead of the database.
 * Never when the reply sets a cookie (an expired session being cleared): that must not be shared.
 */
function shareable(res: Response): void {
  if (!res.getHeader('Set-Cookie')) res.set('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
}

publicRouter.get('/public/config', async (_req, res) => {
  const data = await service.publicConfig();
  shareable(res);
  res.json({ data });
});

publicRouter.get('/public/home', async (_req, res) => {
  const data = await service.home();
  shareable(res);
  res.json({ data });
});

publicRouter.get('/public/jobs', async (req, res) => {
  const data = await service.listJobs(query(req, publicJobsQuerySchema));
  shareable(res);
  res.json({ data });
});

publicRouter.get('/public/jobs/:slug', async (req, res) => {
  const data = await service.jobDetail(String(req.params.slug));
  shareable(res);
  res.json({ data });
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
  res.json({ data: await service.statusLookup(input.email, input.applicationId, input.k) });
});

// Sends an email, so it is limited per address as well as per visitor: nobody can flood an applicant's inbox.
publicRouter.post(
  '/public/status/links',
  rateLimit({ name: 'status-links', max: 10, windowSeconds: 3600 }),
  rateLimit({ name: 'status-links-email', max: 3, windowSeconds: 3600, key: (req) => String(req.body?.email ?? '').trim().toLowerCase().slice(0, 190) }),
  async (req, res) => {
    await service.sendStatusLinks(body(req, statusLinksSchema).email);
    res.status(202).json({ data: { ok: true } });
  },
);

publicRouter.post('/public/status/withdraw', rateLimit({ name: 'withdraw', max: 10, windowSeconds: 3600 }), async (req, res) => {
  const input = body(req, withdrawSchema);
  await service.withdraw(input.email, input.applicationId, input.k, req.ip ?? null);
  res.json({ data: { ok: true } });
});

publicRouter.post('/public/referrals', rateLimit({ name: 'referral', max: 10, windowSeconds: 3600 }), async (req, res) => {
  await service.createReferral(body(req, referralSchema), req.ip ?? null);
  res.status(201).json({ data: { ok: true } });
});

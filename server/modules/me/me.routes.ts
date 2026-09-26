import { Router, type Request } from 'express';
import { changePasswordSchema, markReadSchema, notificationsQuerySchema, profileSchema } from '../../../shared/api/me.js';
import { body, query } from '../../http/validate.js';
import { requireAuth } from '../../middleware/guards.js';
import * as service from './me.service.js';

export const meRouter = Router();

const ctx = (req: Request) => ({ user: req.auth!.user, ip: req.ip ?? null });
const ok = { data: { ok: true } };

meRouter.get('/shell', requireAuth, async (req, res) => { res.json({ data: await service.shellSummary(req.auth!.user) }); });

meRouter.get('/notifications', requireAuth, async (req, res) => {
  res.json({ data: await service.notifications(req.auth!.user, query(req, notificationsQuerySchema)) });
});
meRouter.post('/notifications/read', requireAuth, async (req, res) => {
  const input = body(req, markReadSchema);
  await service.markRead(req.auth!.user, input.ids, input.all);
  res.json(ok);
});
meRouter.delete('/notifications/read', requireAuth, async (req, res) => {
  await service.clearRead(req.auth!.user);
  res.json(ok);
});

meRouter.get('/profile', requireAuth, async (req, res) => { res.json({ data: await service.profile(req.auth!.user) }); });
meRouter.put('/profile', requireAuth, async (req, res) => {
  await service.updateProfile(body(req, profileSchema), ctx(req));
  res.json(ok);
});
meRouter.put('/profile/password', requireAuth, async (req, res) => {
  await service.changePassword(body(req, changePasswordSchema), ctx(req), req.auth!.session);
  res.json(ok);
});

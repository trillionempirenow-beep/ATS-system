import { Router } from 'express';
import { forgotPasswordSchema, loginSchema, resetPasswordSchema, type ResetTokenCheckDto } from '../../../shared/api/auth.js';
import { body } from '../../http/validate.js';
import { requireAuth } from '../../middleware/guards.js';
import { rateLimit } from '../../middleware/security.js';
import { clearSessionCookie, startSession } from '../../middleware/session.js';
import { audit } from '../../core/audit.js';
import * as service from './auth.service.js';
import * as sessions from './session.repository.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  rateLimit({ name: 'login-ip', max: 20, windowSeconds: 900 }),
  rateLimit({ name: 'login-email', max: 8, windowSeconds: 900, key: (req) => String(req.body?.email ?? '').toLowerCase().slice(0, 190) }),
  async (req, res) => {
    const input = body(req, loginSchema);
    const user = await service.authenticate(input.email, input.password, req.ip ?? null);
    if (req.auth) await sessions.deleteSession(req.auth.session.id);
    const session = await startSession(req, res, user.id, input.remember);
    const current = await sessions.loadActiveUser(user.id);
    res.json({ data: service.toMe({ user: current!, session }) });
  },
);

authRouter.post('/logout', requireAuth, async (req, res) => {
  await audit({ userId: req.auth!.user.id, action: 'logout', entityType: 'user', entityId: req.auth!.user.id, ip: req.ip ?? null });
  await sessions.deleteSession(req.auth!.session.id);
  clearSessionCookie(res);
  res.json({ data: { ok: true } });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ data: service.toMe(req.auth!) });
});

authRouter.post(
  '/forgot-password',
  rateLimit({ name: 'forgot', max: 5, windowSeconds: 3600 }),
  async (req, res) => {
    const input = body(req, forgotPasswordSchema);
    await service.requestPasswordReset(input.email, input.reason, req.ip ?? null);
    // Identical reply whether or not the address exists.
    res.status(202).json({ data: { ok: true } });
  },
);

authRouter.get('/reset-password/:token', rateLimit({ name: 'reset-check', max: 30, windowSeconds: 900 }), async (req, res) => {
  const token = String(req.params.token);
  const row = /^[a-f0-9]{64}$/i.test(token) ? await service.findValidReset(token) : null;
  const dto: ResetTokenCheckDto = row ? { valid: true, name: row.name, email: row.email } : { valid: false };
  res.json({ data: dto });
});

authRouter.post('/reset-password', rateLimit({ name: 'reset', max: 10, windowSeconds: 900 }), async (req, res) => {
  const input = body(req, resetPasswordSchema);
  await service.completePasswordReset(input.token, input.password, input.confirm, req.ip ?? null);
  res.json({ data: { ok: true } });
});

import { Router, type NextFunction, type Request, type Response } from 'express';
import { assistantMessageSchema, assistantTokenSchema } from '../../../shared/api/assistant.js';
import { AppError } from '../../http/errors.js';
import { body } from '../../http/validate.js';
import { requireStaff } from '../../middleware/guards.js';
import { rateLimit } from '../../middleware/security.js';
import { loadActiveUser } from '../auth/session.repository.js';
import * as service from './assistant.service.js';
import { canUseAssistant, isRefusal, lookup, propose } from './assistant.tools.js';
import { readToken } from './assistant.tokens.js';

export const assistantRouter = Router();

const ctx = (req: Request) => ({ user: req.auth!.user, ip: req.ip ?? null });
const perUser = (req: Request) => String(req.auth?.user.id ?? req.ip);

// ---- The chat (signed-in staff) ---------------------------------------------
assistantRouter.post('/assistant/message', requireStaff, rateLimit({ name: 'assistant', max: 20, windowSeconds: 60, key: perUser }), async (req, res) => {
  res.json({ data: await service.message(body(req, assistantMessageSchema), ctx(req)) });
});

assistantRouter.post('/assistant/actions/confirm', requireStaff, async (req, res) => {
  res.json({ data: await service.confirm(body(req, assistantTokenSchema).token, ctx(req)) });
});

assistantRouter.post('/assistant/actions/undo', requireStaff, async (req, res) => {
  res.json({ data: await service.undo(body(req, assistantTokenSchema).token, ctx(req)) });
});

// ---- Tools the n8n agent calls, as the person chatting -----------------------
// No session here: the run token from /assistant/message says who, for a few minutes.
async function asRunUser(req: Request, res: Response, next: NextFunction) {
  const run = readToken<object>(req.get('x-assistant-token') ?? '', 'run');
  const user = run ? await loadActiveUser(run.userId) : null;
  if (!user || !canUseAssistant(user)) return next(new AppError(401, 'unauthenticated', 'The assistant token is missing or expired.'));
  res.locals.assistantUser = user;
  next();
}

/** Tool answers are always 200 with JSON, so the agent reads refusals as text it can relay instead of failing the run. */
function tool(fn: typeof lookup | typeof propose) {
  return async (req: Request, res: Response) => {
    try {
      const args = typeof req.body === 'object' && req.body ? (req.body as Record<string, unknown>) : {};
      res.json({ ok: true, result: await fn(res.locals.assistantUser, args) });
    } catch (e) {
      if (isRefusal(e) || e instanceof AppError) return res.json({ ok: false, error: e.message });
      console.error('[assistant] tool failed', e);
      res.json({ ok: false, error: 'That did not work because of a server error. Tell the person to try again or do it on the page.' });
    }
  };
}
assistantRouter.post('/assistant/tools/lookup', asRunUser, tool(lookup));
assistantRouter.post('/assistant/tools/propose', asRunUser, tool(propose));

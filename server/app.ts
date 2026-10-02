import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import { env } from './config/env.js';
import { beginDbRequest, prepareDb, resetDbPool } from './db/client.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { csrfProtection } from './middleware/security.js';
import { loadSession } from './middleware/session.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { uploadsRouter } from './modules/uploads/uploads.routes.js';
import { featureRouters } from './routes.js';

/** Routes that wait on an AI service and may take most of the function's time. */
const SLOW_ROUTES: Array<string | RegExp> = ['/api/v1/assistant/message', '/api/v1/candidates/parse-cv', '/api/v1/jobs/extract-pdf', '/api/v1/cron/',
  /^\/api\/v1\/interviews\/\d+\/assistant\/chunk$/];

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY || env.NODE_ENV === 'production' ? 1 : false);

  app.use(async (req, res, next) => {
    await prepareDb();
    const done = beginDbRequest();
    // Answer a stuck request well before the platform's 60s limit, with a message the
    // page can show, and give the next requests fresh database connections.
    const limit = SLOW_ROUTES.some((r) => (typeof r === 'string' ? req.path.startsWith(r) : r.test(req.path))) ? 57_000 : 25_000;
    const watchdog = setTimeout(() => {
      resetDbPool();
      if (!res.headersSent) {
        res.status(503).json({ error: { code: 'service_unavailable', message: 'The server took too long to answer. Please try again.' } });
      }
    }, limit);
    const finished = () => { clearTimeout(watchdog); done(); };
    res.on('finish', finished);
    res.on('close', finished);
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  // Hold-to-talk recordings for the assistant are larger than any form.
  app.use('/api/v1/assistant/message', express.json({ limit: '2mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const v1 = Router();
  v1.get('/health', (_req, res) => {
    res.json({ data: { ok: true, time: new Date().toISOString() } });
  });
  v1.use('/auth', authRouter);
  v1.use(uploadsRouter);
  for (const r of featureRouters) v1.use(r);

  const api = Router();
  api.use(loadSession);
  api.use(csrfProtection);
  api.use('/v1', v1);
  api.use(notFoundHandler);

  app.use('/api', api);
  app.use(errorHandler);
  return app;
}

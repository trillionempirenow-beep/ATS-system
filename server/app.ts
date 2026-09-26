import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { csrfProtection } from './middleware/security.js';
import { loadSession } from './middleware/session.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { uploadsRouter } from './modules/uploads/uploads.routes.js';
import { featureRouters } from './routes.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY || env.NODE_ENV === 'production' ? 1 : false);

  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
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

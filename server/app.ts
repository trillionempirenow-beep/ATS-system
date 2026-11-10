import cookieParser from 'cookie-parser';
import express, { Router, type Request, type Response } from 'express';
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

/** A request slower than this is written to the log, with the time it took. */
const SLOW_LOG_MS = 1_000;
/** Requests this instance has started; the first one pays for the cold start. */
let requestsServed = 0;

/** Methods that are safe to run twice. */
const READ_METHODS = new Set(['GET', 'HEAD']);

export interface AppOptions {
  /** A read that has not answered after this long is almost always on a dead database connection: it is retried once. */
  readRetryAfterMs?: number;
  /** How long that retry may take before the request is answered with an error. */
  readRetryLimitMs?: number;
}

export function createApp(options: AppOptions = {}): express.Express {
  // A healthy request answers in well under a second, so waiting longer only makes the page hang.
  const readRetryAfterMs = options.readRetryAfterMs ?? 8_000;
  const readRetryLimitMs = options.readRetryLimitMs ?? 12_000;
  const app = express();
  const dispatch = (app as unknown as { handle: (req: Request, res: Response, done: (err?: unknown) => void) => void }).handle.bind(app);
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY || env.NODE_ENV === 'production' ? 1 : false);

  app.use(async (req, res, next) => {
    const started = Date.now();
    const coldInstance = requestsServed++ === 0;
    await prepareDb();
    const done = beginDbRequest();
    // Answer a stuck request well before the platform's 60s limit, with a message the
    // page can show, and give the next requests fresh database connections.
    const slow = SLOW_ROUTES.some((r) => (typeof r === 'string' ? req.path.startsWith(r) : r.test(req.path)));
    const isRetry = res.locals.dbRetried === true;
    // Only plain reads are run again: repeating a write could do it twice.
    const canRetry = !slow && !isRetry && READ_METHODS.has(req.method);
    const limit = slow ? 57_000 : canRetry ? readRetryAfterMs : isRetry ? readRetryLimitMs : 25_000;
    const watchdog = setTimeout(() => {
      resetDbPool();
      if (res.headersSent) return;
      if (canRetry) {
        console.warn(`[api] ${req.method} ${req.originalUrl} did not answer in ${readRetryAfterMs}ms; retrying once on fresh connections`);
        res.locals.dbRetried = true;
        // The stuck attempt sits inside the nested routers, which have trimmed the address: put it back.
        req.url = req.originalUrl;
        req.baseUrl = '';
        // Express runs a request through its stack with app.handle; its type definitions leave it out.
        dispatch(req, res, (err?: unknown) => (err ? errorHandler(err, req, res, () => undefined) : notFoundHandler(req, res)));
        return;
      }
      res.status(503).json({ error: { code: 'service_unavailable', message: 'The server took too long to answer. Please try again.' } });
    }, limit);
    const finished = () => {
      clearTimeout(watchdog);
      done();
      const ms = Date.now() - started;
      if (ms >= SLOW_LOG_MS && !res.locals.slowLogged) {
        res.locals.slowLogged = true;
        console.warn(`[slow] ${req.method} ${req.originalUrl.split('?')[0]} took ${ms}ms${coldInstance ? ' (first request on a new instance)' : ''}${res.locals.dbRetried ? ' (retried)' : ''}`);
      }
    };
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

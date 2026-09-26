import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '../../shared/api/envelope.js';
import { AppError } from '../http/errors.js';

export function notFoundHandler(_req: Request, res: Response): void {
  const body: ApiErrorBody = { error: { code: 'not_found', message: 'That endpoint does not exist.' } };
  res.status(404).json(body);
}

/** Every failure leaves as { error: { code, message } }. No stack traces, SQL or secrets reach the client. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message } };
    if (err.fields) body.error.fields = err.fields;
    if (err.details) body.error.details = err.details;
    res.status(err.status).json(body);
    return;
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'payload_too_large', message: 'That request is too large.' } } satisfies ApiErrorBody);
    return;
  }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_request', message: 'The request body is not valid JSON.' } } satisfies ApiErrorBody);
    return;
  }
  console.error(`[api] ${req.method} ${req.originalUrl} failed`, err);
  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong on our side. Please try again.' },
  } satisfies ApiErrorBody);
}

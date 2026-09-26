import type { ErrorCode } from '../../shared/api/envelope.js';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) => new AppError(400, 'bad_request', message, fields);
export const validationFailed = (fields: Record<string, string>, message = 'Please correct the highlighted fields.') =>
  new AppError(422, 'validation_failed', message, fields);
export const unauthenticated = (message = 'Please sign in to continue.') => new AppError(401, 'unauthenticated', message);
export const forbidden = (message = 'You do not have permission to perform this action.', details?: Record<string, unknown>) =>
  new AppError(403, 'forbidden', message, undefined, details);
export const notFound = (message = 'That record could not be found.') => new AppError(404, 'not_found', message);
export const conflict = (message: string, code: ErrorCode = 'conflict', details?: Record<string, unknown>) =>
  new AppError(409, code, message, undefined, details);
export const tooManyRequests = (message = 'Too many attempts. Please wait a moment and try again.') =>
  new AppError(429, 'rate_limited', message);

/** Postgres unique-violation, for turning duplicate inserts into friendly 409s. */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { code?: string; constraint_name?: string };
  return err.code === '23505' && (!constraint || err.constraint_name === constraint);
}

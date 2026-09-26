import type { Request } from 'express';
import { type z, type ZodTypeAny } from 'zod';
import { validationFailed } from './errors.js';

export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed(zodFieldErrors(result.error));
  return result.data;
}

export const body = <S extends ZodTypeAny>(req: Request, schema: S): z.infer<S> => parse(schema, req.body ?? {});
export const query = <S extends ZodTypeAny>(req: Request, schema: S): z.infer<S> => parse(schema, req.query ?? {});

export function idParam(req: Request, name = 'id'): number {
  const raw = req.params[name];
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw validationFailed({ [name]: 'Invalid id.' });
  return n;
}

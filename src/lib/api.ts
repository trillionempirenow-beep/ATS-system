import type { ApiErrorBody, ErrorCode } from '@shared/api/envelope';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fields: Record<string, string> = {},
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;
let hadSession = false;

/** Set by the auth provider whenever /auth/me or sign-in returns. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
  hadSession = token !== null;
}

export const SESSION_ENDED_EVENT = 'acme:session-ended';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'service_unavailable', 'We could not reach the server. Check your connection and try again.');
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const err = (json as ApiErrorBody | null)?.error;
    const apiErr = new ApiError(
      res.status,
      err?.code ?? (res.status === 404 ? 'not_found' : 'internal_error'),
      err?.message ?? 'Something went wrong. Please try again.',
      err?.fields ?? {},
      err?.details ?? {},
    );
    if (res.status === 401 && hadSession && (apiErr.code === 'session_expired' || apiErr.code === 'unauthenticated')) {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT));
    }
    throw apiErr;
  }
  return (json as { data: T }).data;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path),
  /** Fire-and-forget POST that still reaches the server while the page unloads. */
  beacon: (path: string, body: unknown = {}) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    void fetch(`/api/v1${path}`, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'same-origin', keepalive: true }).catch(() => undefined);
  },
};

/** Builds "?a=1&b=2" from defined, non-empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Please try again.';
}

export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthenticated'
  | 'session_expired'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'csrf_failed'
  | 'rate_limited'
  | 'payload_too_large'
  | 'unsupported_type'
  | 'skip_blocked'
  | 'applicant_limit_reached'
  | 'account_blocked'
  | 'service_unavailable'
  | 'internal_error';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Per-field messages for form validation. */
    fields?: Record<string, string>;
    /** Extra machine-readable context, e.g. the missing permission. */
    details?: Record<string, unknown>;
  };
}

export interface ApiSuccess<T> {
  data: T;
}

/** Side effects that can fail without undoing the main action. */
export interface DeliveryReport {
  email?: 'sent' | 'skipped' | 'failed' | 'not_configured' | 'duplicate';
  emailError?: string;
}

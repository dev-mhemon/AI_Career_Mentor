/** Central mapper: ApiError / UnauthorizedError / NetworkError -> UI-ready error model. Pure; no I/O. */
import { ApiError, NetworkError } from './client';

export type ErrorTone = 'error' | 'warning' | 'info';

export interface MappedError {
  /** Clear user-facing copy. */
  message: string;
  tone: ErrorTone;
  status: number | null;
  code?: string;
  /** field -> message, from details[] (400/422). */
  fieldErrors: Record<string, string>;
  /** Seconds for live countdown (423/429). */
  retryAfterSeconds: number | null;
  retryable: boolean;
  /** Present on 5xx for support. */
  requestId?: string;
  /** Caller should send user to sign-in. */
  requiresSignIn: boolean;
}

function fieldErrorsOf(err: ApiError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of err.details ?? []) if (d.field && !(d.field in out)) out[d.field] = d.message;
  return out;
}

export function mapApiError(error: unknown): MappedError {
  const base: MappedError = {
    message: 'Something went wrong. Please try again.',
    tone: 'error',
    status: null,
    fieldErrors: {},
    retryAfterSeconds: null,
    retryable: true,
    requiresSignIn: false,
  };

  if (error instanceof NetworkError) {
    return {
      ...base,
      message: 'Network problem. Check your connection and try again.',
      tone: 'warning',
    };
  }
  if (!(error instanceof ApiError)) return base;

  const s = error.statusCode;
  const m: MappedError = {
    ...base,
    status: s,
    code: error.code,
    fieldErrors: fieldErrorsOf(error),
    retryAfterSeconds: error.retryAfterSeconds,
    retryable: error.retryable,
    requestId: error.requestId,
  };

  if (s === 400 || s === 422) {
    return {
      ...m,
      message: Object.keys(m.fieldErrors).length
        ? 'Please fix the highlighted fields.'
        : error.message || 'Check your input and try again.',
      retryable: false,
    };
  }
  if (s === 401) {
    return {
      ...m,
      message: 'Your session has expired or details are incorrect. Please sign in again.',
      requiresSignIn: true,
      retryable: false,
    };
  }
  if (s === 403) {
    return { ...m, message: "You don't have permission to do that.", retryable: false };
  }
  if (s === 409) {
    return {
      ...m,
      message: error.message || 'This conflicts with existing data. Review and try again.',
      tone: 'warning',
      retryable: false,
    };
  }
  if (s === 423 || s === 429) {
    const wait = m.retryAfterSeconds;
    return {
      ...m,
      message:
        s === 423
          ? 'Too many attempts. This is temporarily locked.'
          : 'Too many requests. Please wait before trying again.',
      tone: 'warning',
      retryable: wait !== null || error.retryable,
    };
  }
  if (s >= 500) {
    return {
      ...m,
      message: m.requestId
        ? `Server error. Please try again. Reference: ${m.requestId}`
        : 'Server error. Please try again shortly.',
      retryable: true,
    };
  }
  return { ...m, message: error.message || base.message };
}

/**
 * Input is never cleared on error: callers keep their own form values and only
 * merge `fieldErrors` for display. This helper makes that contract explicit.
 */
export function preserveInput<T extends Record<string, unknown>>(values: T, _error: MappedError): T {
  void _error;
  return values;
}

/** Shape of failing server-action results (AuthActionResult subset). */
export interface ActionErrorLike {
  error?: string;
  status?: number;
  code?: string;
  retryAfterSeconds?: number;
  fieldErrors?: Record<string, string>;
}

/**
 * Map a server-action failure to the UI error model. Server copy is curated and kept as the
 * message; status/code/retryAfterSeconds/fieldErrors drive tone, countdown and inline errors.
 */
export function mapActionResult(r: ActionErrorLike | null | undefined): MappedError | null {
  if (!r?.error) return null;
  const status = r.status ?? null;
  const viaApi = status
    ? mapApiError(
        new ApiError(status, r.error, r.code, undefined, [], false, r.retryAfterSeconds ?? null),
      )
    : null;
  return {
    message: r.error,
    tone: viaApi?.tone ?? 'error',
    status,
    code: r.code,
    fieldErrors: r.fieldErrors ?? {},
    retryAfterSeconds: r.retryAfterSeconds ?? null,
    retryable: viaApi?.retryable ?? true,
    requestId: undefined,
    requiresSignIn: viaApi?.requiresSignIn ?? false,
  };
}

/** Central mapper: ApiError / UnauthorizedError / NetworkError -> UI-ready error model. Pure; no I/O. */
import { ApiError, NetworkError } from './client';
import type {
  M05OperationInput,
  M05OperationName,
  M05OperationOutput,
} from './client';

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

export const INVALID_CREDENTIALS_MESSAGE =
  'Please verify your credentials. The password entered is incorrect.';

/**
 * Curated user-facing mappings for M04 AI/Job and M06 Roadmap domain error codes (`C05` §16.4 / §16.5 / §16.6).
 * Never echoes raw `error.message` so provider/model/internal details cannot leak to the UI.
 */
const SAFE_CODE_ERRORS: Readonly<
  Record<string, { message: string; tone: ErrorTone; retryable: boolean }>
> = {
  AI_TIMEOUT: {
    message:
      'AI generation timed out. Your information has been saved. Please try again.',
    tone: 'warning',
    retryable: true,
  },
  AI_SERVICE_ERROR: {
    message:
      'AI service is temporarily unavailable. Your information has been saved. Please try again later.',
    tone: 'error',
    retryable: true,
  },
  AI_GENERATION_FAILED: {
    message:
      "We couldn't generate this right now. Your information has been saved. Please try again.",
    tone: 'error',
    retryable: true,
  },
  AI_VALIDATION_FAILED: {
    message:
      'Generated output could not be verified and was discarded. Your information has been saved. Please try again.',
    tone: 'error',
    retryable: true,
  },
  AI_BUDGET_EXHAUSTED: {
    message:
      'AI capacity is temporarily unavailable. Your existing roadmaps, plans, and progress remain accessible.',
    tone: 'warning',
    retryable: true,
  },
  JOB_NOT_FOUND: {
    message: 'This background task could not be found.',
    tone: 'warning',
    retryable: false,
  },
  IDEMPOTENCY_KEY_REUSED: {
    message:
      'This request key was already used for a different action. Please refresh and try again.',
    tone: 'warning',
    retryable: false,
  },
  STALE_JOB_INPUT: {
    message:
      'Your saved data changed before this task could complete. Please refresh and try again.',
    tone: 'warning',
    retryable: false,
  },
  DRAFT_STALE: {
    message:
      'Your profile or career goal changed after this draft was generated. Refresh the draft before locking.',
    tone: 'warning',
    retryable: false,
  },
  STALE_VERSION: {
    message:
      'A newer version of this roadmap exists. Reload the latest version before continuing.',
    tone: 'warning',
    retryable: false,
  },
  LARGE_ROADMAP_CONFIRMATION_REQUIRED: {
    message:
      'This roadmap exceeds 45 active topics. Confirm that you want to lock a large roadmap before continuing.',
    tone: 'warning',
    retryable: false,
  },
  RESOURCE_CONFLICT: {
    message:
      'A roadmap already exists for this career goal, or an active update is already in progress.',
    tone: 'warning',
    retryable: false,
  },
  ROADMAP_LIMIT_REACHED: {
    message:
      'You have reached the maximum of 3 active roadmaps. Archive an existing roadmap before generating a new one.',
    tone: 'warning',
    retryable: false,
  },
  INVALID_STATE_TRANSITION: {
    message:
      'This action is not allowed in the roadmap’s current state. Refresh to inspect the latest status.',
    tone: 'warning',
    retryable: false,
  },
  RESOURCE_NOT_FOUND: {
    message: 'The requested roadmap or resource could not be found.',
    tone: 'warning',
    retryable: false,
  },
  VERSION_NOT_FOUND: {
    message: 'The requested roadmap version could not be found.',
    tone: 'warning',
    retryable: false,
  },
  NO_OPEN_DRAFT: {
    message:
      'There is no open draft for this roadmap. View the current locked version instead.',
    tone: 'warning',
    retryable: false,
  },
  PROFILE_INCOMPLETE: {
    message:
      'Complete your profile and confirm a career goal before generating a roadmap.',
    tone: 'warning',
    retryable: false,
  },
  LEVEL_NOT_CONFIRMED: {
    message:
      'Confirm your target career level (Junior, Mid, or Senior) before generating a roadmap.',
    tone: 'warning',
    retryable: false,
  },
  FEATURE_DISABLED: {
    message:
      'Roadmap generation is currently unavailable. Your existing roadmaps, versions, and progress remain accessible.',
    tone: 'info',
    retryable: false,
  },
  RATE_LIMIT_EXCEEDED: {
    message:
      'Roadmap generation limit reached. Your existing roadmaps remain accessible. Please wait before trying again.',
    tone: 'warning',
    retryable: true,
  },
  DAILY_PLAN_NOT_FOUND: {
    message:
      'No Daily Plan exists for this roadmap yet. Confirm your daily study hours to create one.',
    tone: 'info',
    retryable: false,
  },
  NO_FOCUS_ROADMAP: {
    message:
      'No Focus Roadmap is currently selected. Lock or set a Focus Roadmap first.',
    tone: 'info',
    retryable: false,
  },
  DAILY_PLAN_EXISTS: {
    message:
      'A Daily Plan already exists for this roadmap. Use Rebuild Plan if you want to adjust daily study hours.',
    tone: 'warning',
    retryable: false,
  },
  LEARNING_HOURS_REQUIRED: {
    message:
      'Choose daily study hours between 0.5 and 12 hours in 0.5-hour increments before continuing.',
    tone: 'warning',
    retryable: false,
  },
  ROADMAP_NOT_LOCKED: {
    message:
      'This roadmap must be locked before creating or rebuilding a Daily Plan.',
    tone: 'warning',
    retryable: false,
  },
  ROADMAP_ARCHIVED: {
    message:
      'This roadmap is archived and read-only. Select an active locked roadmap to create or rebuild a Daily Plan.',
    tone: 'warning',
    retryable: false,
  },
  PLAN_ITEM_NOT_AVAILABLE: {
    message:
      'This study unit is not ready for a practice quiz yet. Ensure the roadmap is locked and today’s study guide has finished preparing.',
    tone: 'warning',
    retryable: false,
  },
  QUIZ_NOT_STARTED: {
    message:
      'Start the practice quiz before saving or submitting answers.',
    tone: 'warning',
    retryable: false,
  },
  QUIZ_NOT_SUBMITTED: {
    message:
      'Submit this practice quiz first to view your graded results and feedback.',
    tone: 'info',
    retryable: false,
  },
  QUIZ_ALREADY_SUBMITTED: {
    message:
      'This quiz attempt has already been submitted. View your results below.',
    tone: 'info',
    retryable: false,
  },
  NO_ANSWERS_SUBMITTED: {
    message:
      'Answer at least one question—or select "I don’t know"—before submitting the quiz.',
    tone: 'warning',
    retryable: false,
  },
  UNANSWERED_CONFIRMATION_REQUIRED: {
    message:
      'Some questions are still unanswered. Confirm whether you want to submit anyway or go back to finish.',
    tone: 'warning',
    retryable: false,
  },
  QUESTION_NOT_IN_QUIZ: {
    message:
      'One or more answers did not match this quiz attempt. Refresh the quiz and try again.',
    tone: 'warning',
    retryable: false,
  },
  RETRY_LIMIT_REACHED: {
    message:
      'You have already completed the single retry permitted for this topic’s practice quiz.',
    tone: 'info',
    retryable: false,
  },
  REVIEW_NOT_RETRYABLE: {
    message:
      'This free-response answer was recorded as a non-attempt and cannot be retried for AI review.',
    tone: 'info',
    retryable: false,
  },
  RAW_RESPONSE_EXPIRED: {
    message:
      'The original free-response text has expired under the 90-day privacy retention policy and can no longer be re-evaluated.',
    tone: 'info',
    retryable: false,
  },
};

/**
 * Curated user-facing mappings for M05 profile & career-goal error codes (`C05` §14.3/§14.4/§16).
 * Never echoes raw `error.message`, so internals cannot leak to the UI.
 */
const M05_SAFE_ERRORS: Readonly<
  Record<string, { message: string; tone: ErrorTone; retryable: boolean }>
> = {
  OUT_OF_SCOPE_GOAL: {
    message:
      'This goal is outside what we support. AI Career Mentor covers technology careers only. Try a technology role such as "Backend developer" or "Data analyst".',
    tone: 'warning',
    retryable: false,
  },
  NON_TECH_GOAL: {
    message:
      'This goal is outside what we support. AI Career Mentor covers technology careers only. Try a technology role such as "Backend developer" or "Data analyst".',
    tone: 'warning',
    retryable: false,
  },
  CLARIFICATION_LIMIT_REACHED: {
    message:
      'The clarification limit was reached. Review the best interpretation below and confirm it.',
    tone: 'info',
    retryable: false,
  },
  GOAL_ALREADY_CONFIRMED: {
    message:
      'This goal is already confirmed and its text cannot be edited. Discontinue it and create a new goal instead.',
    tone: 'warning',
    retryable: false,
  },
  ROLE_MISMATCH: {
    message:
      'That role is not one of the proposed options. Choose one of the suggested roles and try again.',
    tone: 'error',
    retryable: false,
  },
  ROADMAP_LIMIT_REACHED: {
    message:
      'You have reached the maximum of 3 active roadmaps (3 active goals or roadmaps). Archive or discontinue an existing one before adding another.',
    tone: 'warning',
    retryable: false,
  },
  SKILL_NOT_FOUND: {
    message:
      'We could not find that skill. Pick one of the suggested skills or check the spelling.',
    tone: 'warning',
    retryable: false,
  },
  FEATURE_DISABLED: {
    message:
      'This feature is currently unavailable. Your existing goals, roadmaps, versions, and progress remain accessible.',
    tone: 'warning',
    retryable: false,
  },
  INVALID_STATE_TRANSITION: {
    message:
      'This action is not allowed in the current state, or this goal has already moved to a different step. Refresh to see the latest status.',
    tone: 'warning',
    retryable: false,
  },
  STALE_VERSION: {
    message:
      'A newer version of this roadmap exists, or this goal changed while your update was being processed. Reload the latest version before continuing.',
    tone: 'warning',
    retryable: false,
  },
  RESOURCE_NOT_FOUND: {
    message: 'We could not find that item (the requested resource could not be found). It may have been removed.',
    tone: 'warning',
    retryable: false,
  },
};

export function mapApiError(
  error: unknown,
  options?: { channel?: 'email' | 'phone' },
): MappedError {
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

  if (error.code && Object.hasOwn(M05_SAFE_ERRORS, error.code)) {
    const safe = M05_SAFE_ERRORS[error.code];
    return {
      ...m,
      message: safe.message,
      tone: safe.tone,
      retryable: safe.retryable,
    };
  }

  if (error.code && Object.hasOwn(SAFE_CODE_ERRORS, error.code)) {
    const safe = SAFE_CODE_ERRORS[error.code];
    return {
      ...m,
      message: safe.message,
      tone: safe.tone,
      retryable: safe.retryable,
    };
  }

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
    if (
      error.code === 'AUTH_USER_NOT_FOUND' ||
      error.code === 'ACCOUNT_NOT_FOUND' ||
      error.code === 'USER_NOT_FOUND' ||
      error.code === 'ACCOUNT_DELETED' ||
      (error.code === 'AUTH_REQUIRED' &&
        /no account found|account.*not found|user.*not found|deleted/i.test(
          error.message ?? '',
        ))
    ) {
      return {
        ...m,
        message: error.message || 'No account found with this email address.',
        requiresSignIn: false,
        retryable: false,
      };
    }
    if (
      error.code === 'AUTH_INVALID_CREDENTIALS' ||
      error.code === 'INVALID_CREDENTIALS'
    ) {
      const message =
        !error.message || /^invalid credentials/i.test(error.message.trim())
          ? INVALID_CREDENTIALS_MESSAGE
          : error.message;
      return {
        ...m,
        message,
        requiresSignIn: false,
        retryable: false,
      };
    }
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
  if (s === 404) {
    return {
      ...m,
      message:
        error.code === 'AUTH_USER_NOT_FOUND' ||
        error.code === 'ACCOUNT_NOT_FOUND' ||
        error.code === 'USER_NOT_FOUND' ||
        error.code === 'ACCOUNT_DELETED'
          ? error.message || 'No account found with this email address.'
          : error.message || 'The requested resource was not found.',
      retryable: false,
    };
  }
  if (s === 409) {
    let message =
      error.message || 'This conflicts with existing data. Review and try again.';
    if (error.code === 'CONTACT_ALREADY_REGISTERED') {
      const inferredChannel =
        options?.channel ??
        (error.details?.some((d) => d.field === 'phone')
          ? 'phone'
          : error.details?.some((d) => d.field === 'email')
            ? 'email'
            : undefined);
      if (inferredChannel === 'phone') {
        message = 'This phone number is already registered.';
      } else if (inferredChannel === 'email') {
        message = 'This email is already registered.';
      } else if (
        !error.message ||
        /^contact already registered\.?$/i.test(error.message.trim())
      ) {
        message = 'This contact is already registered.';
      }
    }
    return {
      ...m,
      message,
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

/** Serializable result envelope returned by server-action glue to client components. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: MappedError };

/** Converts any thrown value into a serializable, UI-safe failure result. */
export function toActionFailure(error: unknown): { ok: false; error: MappedError } {
  return { ok: false, error: mapApiError(error) };
}

/**
 * Server-action-shaped invoker injected into M05 client forms by their Server Component page.
 * Keeps access tokens server-side; failures arrive already mapped to safe copy.
 */
export type M05Invoke = <K extends M05OperationName>(
  op: K,
  input: M05OperationInput<K>,
) => Promise<ActionResult<M05OperationOutput<K>>>;

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

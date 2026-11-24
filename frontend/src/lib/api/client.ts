/**
 * Server-side API client for communicating with the NestJS backend.
 *
 * Responsibilities:
 *  - Obtain the Supabase access token via getSession()
 *  - Attach Authorization: Bearer <token> header
 *  - Call NestJS endpoints and return parsed JSON
 *  - Throw typed errors (ApiError, UnauthorizedError, NetworkError)
 *
 * This client does NOT:
 *  - Verify JWT signatures (NestJS does that)
 *  - Perform redirects or call signOut()
 *  - Make business-level authorization decisions
 *
 * Calling code (Server Actions, Server Components) handles
 * error-level business logic such as redirects.
 */

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL!;
}

// ─── Error Types ──────────────────────────────────────────────

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    public readonly requestId?: string,
    public readonly details: FieldError[] = [],
    public readonly retryable = false,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class UnauthorizedError extends ApiError {
  constructor(
    message = 'Unauthorized',
    code?: string,
    requestId?: string,
    details: FieldError[] = [],
    retryable = false,
    retryAfterSeconds: number | null = null,
  ) {
    super(401, message, code, requestId, details, retryable, retryAfterSeconds);
    this.name = 'UnauthorizedError';
  }
}

export class NetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

// ─── Backend Response Types ───────────────────────────────────

export interface UserResponse {
  id: string;
  email: string | null;
  phone: string | null;
  role: 'USER' | 'ADMIN';
  status: 'active' | 'suspended';
  linked_providers: string[];
  verified_contact: boolean;
}

export interface AuthSessionResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'Bearer';
  user: UserResponse;
  profile_complete: boolean;
  next_step: 'profile_setup' | 'app_home' | 'add_verified_contact';
}

export interface OAuthSessionResponse {
  user: UserResponse;
  profile_complete: boolean;
  verified_contact_required: boolean;
  next_step: 'profile_setup' | 'app_home' | 'add_verified_contact';
}

export interface RegistrationPendingResponse {
  verification_channel: 'email' | 'phone';
  contact_masked: string;
  expires_in_seconds: number;
  resend_available_at: string;
}

export interface RegisterUserBody {
  email?: string | null;
  phone?: string | null;
  password: string;
  confirm_password: string;
  privacy_consent: true;
}

export interface ResendVerificationBody {
  channel: 'email' | 'phone';
  contact: string;
}

export interface VerifyEmailBody {
  email: string;
  code: string;
}

/**
 * Request payload for phone verification (EP-A03).
 */
export interface VerifyPhoneBody {
  phone: string;
  code: string;
}

// ─── Core Fetch Wrapper ──────────────────────────────────────

export const DEFAULT_AUTH_STATE_TIMEOUT_MS = 4000;

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * Builds an AbortSignal that aborts after `timeoutMs` or when an optional `callerSignal` aborts.
 * Always invoke the returned `cleanup()` in a `finally` block to prevent timer/listener leaks.
 */
export function createTimedAbortSignal(
  timeoutMs: number,
  callerSignal?: AbortSignal | null,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let onCallerAbort: (() => void) | undefined;

  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      onCallerAbort = () => controller.abort(callerSignal.reason);
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  const timer =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          controller.abort(new DOMException('Request timed out', 'TimeoutError'));
        }, timeoutMs)
      : undefined;

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer !== undefined) clearTimeout(timer);
      if (callerSignal && onCallerAbort) {
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    },
  };
}

interface ApiEnvelopeResult<T> {
  data: T;
  meta?: PageMetaDTO;
  serverDateMs?: number;
}

export type ServerTimeAnchor = {
  serverMs: number;
  monotonicMs: number;
};

function readMonotonicMs(): number {
  return typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

let observedServerTimeAnchor: ServerTimeAnchor | null = null;
let observedServerClockOffsetMs: number | null = null;

/**
 * Returns the latest observed server timestamp paired with the monotonic `performance.now()`
 * reading captured when the HTTP `Date` response header was parsed, or `null` if none has been
 * observed yet.
 */
export function getObservedServerTimeAnchor(): ServerTimeAnchor | null {
  return observedServerTimeAnchor;
}

/**
 * Returns the latest observed `serverTime - clientTime` offset in milliseconds derived from
 * HTTP `Date` response headers, or `null` when no server `Date` header has been observed yet.
 */
export function getObservedServerClockOffsetMs(): number | null {
  return observedServerClockOffsetMs;
}

function parsePageMeta(raw: unknown): PageMetaDTO | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const meta = raw as Record<string, unknown>;
  if (
    typeof meta.limit !== 'number' ||
    !Number.isFinite(meta.limit) ||
    meta.limit <= 0
  ) {
    return undefined;
  }
  if (meta.next_cursor !== null && typeof meta.next_cursor !== 'string') {
    return undefined;
  }
  return {
    limit: meta.limit,
    next_cursor: meta.next_cursor,
  };
}

async function apiFetchEnvelope<T>(
  path: string,
  accessToken: string | null,
  options: ApiFetchOptions = {},
): Promise<ApiEnvelopeResult<T>> {
  const url = `${getApiBaseUrl()}${path}`;
  const { timeoutMs, signal: callerSignal, ...fetchOptions } = options;

  const timedAbort =
    (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0) ||
    callerSignal
      ? createTimedAbortSignal(timeoutMs ?? 0, callerSignal)
      : null;
  const signal = timedAbort?.signal;

  let response: Response;
  let body;
  try {
    try {
      response = await fetch(url, {
        cache: 'no-store',
        ...fetchOptions,
        ...(signal ? { signal } : {}),
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...fetchOptions.headers,
        },
      });
    } catch {
      throw new NetworkError(
        signal?.aborted
          ? 'Request timed out or was aborted. Please try again.'
          : 'Unable to reach the server. Please try again.',
      );
    }

    try {
      body = await response.json();
    } catch {
      if (signal?.aborted) {
        throw new NetworkError('Request timed out or was aborted. Please try again.');
      }
      body = null;
    }
  } finally {
    timedAbort?.cleanup();
  }
  if (!response.ok) {
    const error = body?.error;
    const code = typeof error?.code === 'string' ? error.code : undefined;
    const requestId =
      typeof error?.requestId === 'string'
        ? error.requestId
        : response.headers?.get('X-Request-Id') || undefined;
    const rawDetails: FieldError[] = Array.isArray(error?.details)
      ? error.details.filter(
          (d: FieldError) =>
            typeof d?.field === 'string' &&
            typeof d?.code === 'string' &&
            typeof d?.message === 'string',
        )
      : [];
    const retryable =
      typeof error?.retryable === 'boolean'
        ? error.retryable
        : [429, 502, 503, 504].includes(response.status);
    const isStructuredPostCommitResetOutcome =
      response.status >= 500 &&
      retryable === false &&
      rawDetails.some(
        (d) => d.code === 'PASSWORD_RESET_POST_COMMIT_CLEANUP_PENDING',
      );
    const details: FieldError[] =
      response.status < 500 || isStructuredPostCommitResetOutcome
        ? rawDetails
        : [];
    const headerRetry = response.headers?.get('Retry-After');
    const retryValue =
      error?.retryAfterSeconds ??
      (headerRetry && /^\d+$/.test(headerRetry) ? Number(headerRetry) : null);
    const retryAfterSeconds = Number.isInteger(retryValue) && retryValue >= 0 ? retryValue : null;
    const message =
      response.status >= 500 && !isStructuredPostCommitResetOutcome
        ? 'Service temporarily unavailable. Please try again.'
        : typeof error?.message === 'string'
          ? error.message
          : 'Request rejected';
    if (response.status === 401)
      throw new UnauthorizedError(message, code, requestId, details, retryable, retryAfterSeconds);
    throw new ApiError(
      response.status,
      message,
      code,
      requestId,
      details,
      retryable,
      retryAfterSeconds,
    );
  }
  const rawDateHeader = response.headers?.get('Date');
  const parsedServerDateMs = rawDateHeader
    ? Date.parse(rawDateHeader)
    : Number.NaN;
  const serverDateMs = Number.isFinite(parsedServerDateMs)
    ? parsedServerDateMs
    : undefined;
  if (serverDateMs !== undefined) {
    observedServerTimeAnchor = {
      serverMs: serverDateMs,
      monotonicMs: readMonotonicMs(),
    };
    observedServerClockOffsetMs = serverDateMs - Date.now();
  }
  if (body?.success !== true || !('data' in body))
    throw new ApiError(502, 'Invalid backend response', 'INVALID_RESPONSE');
  const rawMeta = parsePageMeta(body.meta);
  return {
    data: body.data as T,
    ...(rawMeta ? { meta: rawMeta } : {}),
    ...(serverDateMs !== undefined ? { serverDateMs } : {}),
  };
}

async function apiFetch<T>(
  path: string,
  accessToken: string | null,
  options: ApiFetchOptions = {},
): Promise<T> {
  const envelope = await apiFetchEnvelope<T>(path, accessToken, options);
  return envelope.data;
}

// ─── Auth API Functions ──────────────────────────────────────

/**
 * POST /auth/sync
 * Syncs the authenticated Supabase user to the local NestJS database.
 */
export async function syncUser(accessToken: string): Promise<UserResponse> {
  const data = await apiFetch<{ user: UserResponse }>('/auth/sync', accessToken, {
    method: 'POST',
  });
  return data.user;
}

export function registerUser(body: RegisterUserBody): Promise<RegistrationPendingResponse> {
  return apiFetch<RegistrationPendingResponse>('/auth/register', null, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function resendVerification(body: ResendVerificationBody): Promise<RegistrationPendingResponse> {
  return apiFetch<RegistrationPendingResponse>('/auth/resend-verification', null, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function verifyEmail(body: VerifyEmailBody): Promise<AuthSessionResponse> {
  return apiFetch<AuthSessionResponse>('/auth/verify-email', null, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * POST /auth/verify-phone
 * Verifies 6-digit OTP code for Bangladesh mobile number and returns approved auth session.
 */
export function verifyPhone(body: VerifyPhoneBody): Promise<AuthSessionResponse> {
  return apiFetch<AuthSessionResponse>('/auth/verify-phone', null, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function loginUser(identifier: string, password: string): Promise<AuthSessionResponse> {
  return apiFetch<AuthSessionResponse>('/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

export async function approveOAuthSession(
  accessToken: string,
  provider: 'google' | 'facebook',
): Promise<OAuthSessionResponse> {
  return apiFetch<OAuthSessionResponse>('/auth/oauth/session', accessToken, {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
}

export interface LogoutResponse {
  logged_out: true;
}

export function logoutUser(accessToken: string): Promise<LogoutResponse> {
  return apiFetch<LogoutResponse>('/auth/logout', accessToken, {
    method: 'POST',
  });
}

export function refreshSession(
  refreshToken: string,
): Promise<AuthSessionResponse> {
  return apiFetch<AuthSessionResponse>('/auth/refresh', null, {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export interface ForgotPasswordResponse {
  message: string;
}

export function forgotPassword(
  identifier: string,
): Promise<ForgotPasswordResponse> {
  return apiFetch<ForgotPasswordResponse>('/auth/forgot-password', null, {
    method: 'POST',
    body: JSON.stringify({ identifier }),
  });
}

export interface ResetPasswordPendingCleanup {
  local_session_revocation?: boolean;
  local_session_sync?: boolean;
  account_bootstrap?: boolean;
  channel_mapping_sync?: boolean;
  provider_session_revocation?: boolean;
}

export interface ResetPasswordResponse {
  password_reset: true;
  cleanup_status?:
    | 'partial'
    | 'pending_account_bootstrap'
    | 'pending_account_sync';
  account_ready_for_signin?: boolean;
  pending_cleanup?: ResetPasswordPendingCleanup;
  message?: string;
}

export function resetPassword(
  identifier: string,
  code: string,
  newPassword: string,
  confirmNewPassword: string,
): Promise<ResetPasswordResponse> {
  return apiFetch<ResetPasswordResponse>('/auth/reset-password', null, {
    method: 'POST',
    body: JSON.stringify({
      identifier,
      code,
      new_password: newPassword,
      confirm_new_password: confirmNewPassword,
    }),
  });
}

/**
 * Request payload for social identity linking (EP-A11).
 */
export interface LinkIdentityBody {
  provider: 'google' | 'facebook';
}

export interface LinkIdentityResponse {
  linked_providers: string[];
}

/**
 * POST /auth/identities/link
 * Links a Google or Facebook OAuth identity to an existing verified account.
 */
export function linkSocialIdentity(
  accessToken: string,
  provider: 'google' | 'facebook',
): Promise<LinkIdentityResponse> {
  return apiFetch<LinkIdentityResponse>('/auth/identities/link', accessToken, {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
}

export interface AddContactBody {
  channel: 'email' | 'phone';
  contact: string;
}

/**
 * POST /auth/contact
 * Adds and initiates verification for a contact on an authenticated account.
 */
export function addContact(
  accessToken: string,
  body: AddContactBody,
): Promise<RegistrationPendingResponse> {
  return apiFetch<RegistrationPendingResponse>('/auth/contact', accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Full EP-A13 (`GET /api/v1/auth/me`) current-user and effective-access payload.
 */
export interface CurrentUserStateResponse {
  user: UserResponse;
  profile_complete: boolean;
  focus_roadmap_id: string | null;
  effective_access: Record<string, boolean>;
  can_delete_account: boolean;
}

export interface AuthStateRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * GET /auth/me
 * Returns the current application-level user (role, status).
 */
export async function getMe(
  accessToken: string,
  options?: AuthStateRequestOptions,
): Promise<UserResponse> {
  const data = await apiFetch<{ user: UserResponse }>('/auth/me', accessToken, {
    timeoutMs: options?.timeoutMs ?? DEFAULT_AUTH_STATE_TIMEOUT_MS,
    signal: options?.signal,
  });
  return data.user;
}

/**
 * GET /auth/me (EP-A13)
 * Returns the full current-user metadata including `effective_access`, `profile_complete`, `focus_roadmap_id`, and `can_delete_account`.
 */
export async function getCurrentUserState(
  accessToken: string,
  options?: AuthStateRequestOptions,
): Promise<CurrentUserStateResponse> {
  const data = await apiFetch< Partial<CurrentUserStateResponse> & { user: UserResponse } >(
    '/auth/me',
    accessToken,
    {
      timeoutMs: options?.timeoutMs ?? DEFAULT_AUTH_STATE_TIMEOUT_MS,
      signal: options?.signal,
    },
  );
  return {
    user: data.user,
    profile_complete: Boolean(data.profile_complete),
    focus_roadmap_id: data.focus_roadmap_id ?? null,
    effective_access: data.effective_access ?? {},
    can_delete_account: data.can_delete_account ?? true,
  };
}

// ─── Profile API Types & Functions (C05 §14.3 / §15.3) ───────

export type ExperienceLevel = 'beginner' | 'junior' | 'mid' | 'senior';
export type LearningPreference = 'reading' | 'hands_on' | 'visual' | 'mixed';
export type LearningState =
  | 'not_started'
  | 'learning'
  | 'practicing'
  | 'proficient';

export interface ProfileSkillDTO {
  skill_id: string;
  name: string;
  alias_resolved: boolean;
  learning_state: LearningState;
  source: 'self_reported' | 'evidence';
}

export interface UnresolvedSkillCandidateDTO {
  skill_id: string;
  name: string;
}

export interface UnresolvedSkillDTO {
  input: string;
  candidates: UnresolvedSkillCandidateDTO[];
}

export interface ProfileResponse {
  current_role: string | null;
  education: string | null;
  education_level?: string | null;
  experience_level: ExperienceLevel | null;
  existing_skills: ProfileSkillDTO[];
  existing_skills_none: boolean;
  learning_preference: LearningPreference | null;
  preferred_daily_hours: number | null;
  timezone: string | null;
  timezone_detected: boolean;
  active_career_goal_ids: string[];
  profile_complete: boolean;
  missing_fields: string[];
  unresolved_skills?: UnresolvedSkillDTO[];
  progress_initialization?: string;
  updated_at: string;
}

export interface SkillInputBody {
  name: string;
}

export interface UpdateProfileBody {
  current_role?: string;
  /**
   * Optional education background (max 200 characters). Blank string clears existing education.
   */
  education?: string;
  /**
   * Optional education level alias (max 200 characters). Blank string clears existing education.
   */
  education_level?: string;
  experience_level?: ExperienceLevel;
  existing_skills?: SkillInputBody[];
  existing_skills_none?: boolean;
}

export interface UpdateLearningSettingsBody {
  timezone?: string;
  preferred_daily_hours?: number;
}

/**
 * GET /profile (EP-P01)
 * Loads the authenticated user's profile, skills, learning settings, and completeness state.
 */
export function getProfile(
  accessToken: string,
  options?: AuthStateRequestOptions,
): Promise<ProfileResponse> {
  return apiFetch<ProfileResponse>('/profile', accessToken, {
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

/**
 * PATCH /profile (EP-P02)
 * Partially updates the user's background (role, optional education, experience level) and self-reported skills / beginner None flag.
 */
export function updateProfile(
  accessToken: string,
  body: UpdateProfileBody,
): Promise<ProfileResponse> {
  return apiFetch<ProfileResponse>('/profile', accessToken, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * PATCH /profile/learning-settings (EP-P04)
 * Updates the user's IANA timezone and preferred daily learning hours (0.5 to 12 in 0.5-hour steps).
 */
export function updateLearningSettings(
  accessToken: string,
  body: UpdateLearningSettingsBody,
): Promise<ProfileResponse> {
  return apiFetch<ProfileResponse>('/profile/learning-settings', accessToken, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * Request payload for EP-P03 (`ProfilePreferencesDTO`).
 */
export interface UpdatePreferencesBody {
  learning_preference: LearningPreference;
}

/**
 * PATCH /profile/preferences (EP-P03)
 * Saves the learning preference (`reading` | `hands_on` | `visual` | `mixed`).
 */
export function updatePreferences(
  accessToken: string,
  body: UpdatePreferencesBody,
): Promise<ProfileResponse> {
  return apiFetch<ProfileResponse>('/profile/preferences', accessToken, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * Explicit skill selection for Screen 08: a list of skill names, OR the explicit beginner `None` (`R07`).
 * Maps onto EP-P02 (`existing_skills` / `existing_skills_none`); the backend rejects both together.
 */
export type SkillSelection = { none: true } | { none?: false; names: string[] };

/**
 * PATCH /profile (EP-P02) restricted to the skills sub-section.
 * `{ none: true }` sends `existing_skills_none: true` with no skills (never both, `R07`).
 */
export function updateSkills(
  accessToken: string,
  selection: SkillSelection,
): Promise<ProfileResponse> {
  return updateProfile(
    accessToken,
    selection.none
      ? { existing_skills_none: true }
      : {
          existing_skills_none: false,
          existing_skills: selection.names.map((name) => ({ name })),
        },
  );
}

/**
 * Request payload for EP-P05 (`SkillAliasInterpretationDTO`).
 */
export interface SkillAliasBody {
  input: string;
  skill_id: string;
}

export interface SkillAliasInterpretationResponse {
  input: string;
  skill_id: string;
  scope: 'user';
  added_to_profile: boolean;
  progress_initialization:
    | 'deferred_until_level_confirmation'
    | 'initialized'
    | 'unchanged';
}

/**
 * POST /profile/skill-alias-interpretations (EP-P05)
 * Resolves an uncertain skill alias for this user only.
 */
export function interpretSkillAlias(
  accessToken: string,
  body: SkillAliasBody,
): Promise<SkillAliasInterpretationResponse> {
  return apiFetch<SkillAliasInterpretationResponse>(
    '/profile/skill-alias-interpretations',
    accessToken,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

// ─── Career Goal API Types & Functions (C05 §14.4 / §15.4 EP-C01–EP-C07) ───

export type CareerLevel = 'junior' | 'mid' | 'senior';

export type GoalStatus =
  | 'clarifying'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'discontinued';

/** `R29` complete consuming schema: `rationale` is always present, explicitly `null` when absent. */
export interface RoleOptionDTO {
  canonical_role_id: string;
  name: string;
  rationale: string | null;
}

export interface ProposedRoleDTO {
  canonical_role_id: string;
  name: string;
}

export interface CareerGoalResponse {
  id: string;
  goal_text: string;
  status: GoalStatus;
  clarification_round: number;
  clarification_question: string | null;
  proposed_role: ProposedRoleDTO | null;
  alternative_roles: RoleOptionDTO[];
  suggested_level: CareerLevel | null;
  target_level: CareerLevel | null;
  roadmap_id: string | null;
  created_at: string;
}

export interface PageMetaDTO {
  limit: number;
  next_cursor: string | null;
}

export interface CareerGoalListResponse {
  items: CareerGoalResponse[];
  meta: PageMetaDTO;
}

export interface ListCareerGoalsQuery {
  status?: GoalStatus;
  limit?: number;
  cursor?: string;
}

export interface CareerGoalBody {
  goal_text: string;
}

export interface GoalClarificationBody {
  answer: string;
}

export interface GoalConfirmBody {
  canonical_role_id: string;
  target_level: CareerLevel;
}

export interface DiscontinueCareerGoalResponse {
  id: string;
  status: 'discontinued';
  archived_roadmap_id: string | null;
  new_focus_roadmap_id: string | null;
}

function goalPath(goalId: string, suffix = ''): string {
  return `/career/goals/${encodeURIComponent(goalId.trim())}${suffix}`;
}

/**
 * POST /career/goals (EP-C01)
 * Submits a free-text goal; the backend interprets it synchronously.
 */
export function createCareerGoal(
  accessToken: string,
  body: CareerGoalBody,
): Promise<CareerGoalResponse> {
  return apiFetch<CareerGoalResponse>('/career/goals', accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * GET /career/goals (EP-C02)
 * Lists the caller's goals. The array arrives in `data`; pagination arrives in top-level `meta`.
 */
export async function listCareerGoals(
  accessToken: string,
  query: ListCareerGoalsQuery = {},
): Promise<CareerGoalListResponse> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  const qs = params.toString();
  const { data, meta } = await apiFetchEnvelope<CareerGoalResponse[]>(
    `/career/goals${qs ? `?${qs}` : ''}`,
    accessToken,
  );
  const m = meta as Partial<PageMetaDTO> | null;
  if (
    !Array.isArray(data) ||
    !m ||
    typeof m.limit !== 'number' ||
    !Number.isInteger(m.limit) ||
    m.limit < 1 ||
    m.limit > 100 ||
    !(m.next_cursor === null || typeof m.next_cursor === 'string')
  ) {
    throw new ApiError(502, 'Invalid backend response', 'INVALID_RESPONSE');
  }
  return {
    items: data,
    meta: {
      limit: m.limit,
      next_cursor: m.next_cursor,
    },
  };
}

/** GET /career/goals/:id (EP-C03) */
export function getCareerGoal(
  accessToken: string,
  goalId: string,
): Promise<CareerGoalResponse> {
  return apiFetch<CareerGoalResponse>(goalPath(goalId), accessToken);
}

/** POST /career/goals/:id/clarifications (EP-C04) */
export function submitGoalClarification(
  accessToken: string,
  goalId: string,
  body: GoalClarificationBody,
): Promise<CareerGoalResponse> {
  return apiFetch<CareerGoalResponse>(
    goalPath(goalId, '/clarifications'),
    accessToken,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** POST /career/goals/:id/confirm (EP-C05) */
export function confirmCareerGoal(
  accessToken: string,
  goalId: string,
  body: GoalConfirmBody,
): Promise<CareerGoalResponse> {
  return apiFetch<CareerGoalResponse>(goalPath(goalId, '/confirm'), accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** PATCH /career/goals/:id (EP-C06) — rewords an unconfirmed goal. */
export function updateCareerGoal(
  accessToken: string,
  goalId: string,
  body: CareerGoalBody,
): Promise<CareerGoalResponse> {
  return apiFetch<CareerGoalResponse>(goalPath(goalId), accessToken, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** DELETE /career/goals/:id (EP-C07) — discontinues a goal; history and progress are retained. */
export function deleteCareerGoal(
  accessToken: string,
  goalId: string,
): Promise<DiscontinueCareerGoalResponse> {
  return apiFetch<DiscontinueCareerGoalResponse>(goalPath(goalId), accessToken, {
    method: 'DELETE',
  });
}

// ─── M05 operation dispatcher (shared by server-action glue) ─────

/**
 * Typed operation table so a single server-action wrapper per page can invoke any
 * allowed profile/career endpoint without exposing the raw access token to the browser.
 */
export interface M05OperationMap {
  getProfile: { input: undefined; output: ProfileResponse };
  updateProfile: { input: UpdateProfileBody; output: ProfileResponse };
  updateSkills: { input: SkillSelection; output: ProfileResponse };
  updatePreferences: { input: UpdatePreferencesBody; output: ProfileResponse };
  updateLearningSettings: {
    input: UpdateLearningSettingsBody;
    output: ProfileResponse;
  };
  interpretSkillAlias: {
    input: SkillAliasBody;
    output: SkillAliasInterpretationResponse;
  };
  createCareerGoal: { input: CareerGoalBody; output: CareerGoalResponse };
  listCareerGoals: {
    input: ListCareerGoalsQuery | undefined;
    output: CareerGoalListResponse;
  };
  getCareerGoal: { input: { id: string }; output: CareerGoalResponse };
  submitGoalClarification: {
    input: { id: string; body: GoalClarificationBody };
    output: CareerGoalResponse;
  };
  confirmCareerGoal: {
    input: { id: string; body: GoalConfirmBody };
    output: CareerGoalResponse;
  };
  updateCareerGoal: {
    input: { id: string; body: CareerGoalBody };
    output: CareerGoalResponse;
  };
  deleteCareerGoal: {
    input: { id: string };
    output: DiscontinueCareerGoalResponse;
  };
  generateRoadmap: {
    input: { body: GenerateRoadmapRequestDTO; idempotencyKey: string };
    output: JobAcceptedDTO;
  };
  getJobStatus: {
    input: { jobId: string };
    output: JobStatusDTO;
  };
}

export type M05OperationName = keyof M05OperationMap;
export type M05OperationInput<K extends M05OperationName> =
  M05OperationMap[K]['input'];
export type M05OperationOutput<K extends M05OperationName> =
  M05OperationMap[K]['output'];

/**
 * Executes one M05 operation with an access token. Pure dispatch; throws `ApiError`/`NetworkError`.
 * Unknown operation names are rejected so callers cannot reach arbitrary functions.
 */
export async function dispatchM05Operation<K extends M05OperationName>(
  accessToken: string,
  op: K,
  input: M05OperationInput<K>,
): Promise<M05OperationOutput<K>> {
  const run = async (): Promise<unknown> => {
    switch (op as M05OperationName) {
      case 'getProfile':
        return getProfile(accessToken);
      case 'updateProfile':
        return updateProfile(accessToken, input as UpdateProfileBody);
      case 'updateSkills':
        return updateSkills(accessToken, input as SkillSelection);
      case 'updatePreferences':
        return updatePreferences(accessToken, input as UpdatePreferencesBody);
      case 'updateLearningSettings':
        return updateLearningSettings(
          accessToken,
          input as UpdateLearningSettingsBody,
        );
      case 'interpretSkillAlias':
        return interpretSkillAlias(accessToken, input as SkillAliasBody);
      case 'createCareerGoal':
        return createCareerGoal(accessToken, input as CareerGoalBody);
      case 'listCareerGoals':
        return listCareerGoals(
          accessToken,
          (input as ListCareerGoalsQuery | undefined) ?? {},
        );
      case 'getCareerGoal':
        return getCareerGoal(accessToken, (input as { id: string }).id);
      case 'submitGoalClarification': {
        const v = input as { id: string; body: GoalClarificationBody };
        return submitGoalClarification(accessToken, v.id, v.body);
      }
      case 'confirmCareerGoal': {
        const v = input as { id: string; body: GoalConfirmBody };
        return confirmCareerGoal(accessToken, v.id, v.body);
      }
      case 'updateCareerGoal': {
        const v = input as { id: string; body: CareerGoalBody };
        return updateCareerGoal(accessToken, v.id, v.body);
      }
      case 'deleteCareerGoal':
        return deleteCareerGoal(accessToken, (input as { id: string }).id);
      case 'generateRoadmap': {
        const v = input as {
          body: GenerateRoadmapRequestDTO;
          idempotencyKey: string;
        };
        return generateRoadmap(accessToken, v.body, v.idempotencyKey);
      }
      case 'getJobStatus':
        return getJobStatus(accessToken, (input as { jobId: string }).jobId);
      default:
        throw new ApiError(400, 'Unsupported operation', 'INVALID_OPERATION');
    }
  };
  return (await run()) as M05OperationOutput<K>;
}

// ─── Account Deletion API Types & Functions (C05 §14.2 / §15.2 EP-X01 / EP-X02) ───

export type DeletionRequestStatus = 'scheduled' | 'in_progress' | 'completed';

export interface AccountDeletionStatusResponse {
  id: string;
  status: DeletionRequestStatus;
  requested_at: string;
  completed_at: string | null;
  provider_deletion_requested: boolean;
  deletion_receipt?: string;
  receipt_expires_at?: string;
}

export interface AccountDeletionInput {
  confirmation: 'DELETE';
  password?: string;
  reauth_token?: string;
}

/**
 * POST /account/deletion-requests (EP-X01)
 * Initiates account deletion for the authenticated caller with literal 'DELETE' confirmation
 * and live re-authentication credentials.
 */
export function requestAccountDeletion(
  accessToken: string,
  body: AccountDeletionInput,
  idempotencyKey?: string,
): Promise<AccountDeletionStatusResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return apiFetch<AccountDeletionStatusResponse>(
    '/account/deletion-requests',
    accessToken,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
  );
}

/**
 * GET /account/deletion-requests/current (EP-X02)
 * Queries account deletion status. Accepts either an active account Bearer JWT or a DeletionReceipt token.
 */
export function getAccountDeletionStatus(
  tokenOrReceipt: string,
  isReceipt = false,
): Promise<AccountDeletionStatusResponse> {
  if (isReceipt) {
    return apiFetch<AccountDeletionStatusResponse>(
      '/account/deletion-requests/current',
      null,
      {
        headers: {
          Authorization: `DeletionReceipt ${tokenOrReceipt}`,
        },
      },
    );
  }
  return apiFetch<AccountDeletionStatusResponse>(
    '/account/deletion-requests/current',
    tokenOrReceipt,
  );
}

// ─── Async Jobs API Types & Functions (C05 §13.6 / §14.13 EP-J01 / §15.1) ───

export type JobStatus = 'queued' | 'preparing' | 'succeeded' | 'failed';

export type JobKind =
  | 'career_goal'
  | 'roadmap_generate'
  | 'roadmap_revision'
  | 'merge_proposal'
  | 'topic_content'
  | 'quiz_generate'
  | 'practice_review';

export interface JobResultRefDTO {
  type: string;
  id: string;
}

export interface JobErrorDTO {
  code: string;
  message: string;
  retryable: boolean;
}

export interface JobAcceptedDTO {
  job_id: string;
  kind?: JobKind | string;
  status: JobStatus;
  poll_url: string;
  retry_after_seconds: number;
}

export interface JobStatusDTO {
  job_id: string;
  kind: JobKind | string;
  status: JobStatus;
  result_ref: JobResultRefDTO | null;
  error: JobErrorDTO | null;
  retryable: boolean;
  created_at: string;
  finished_at: string | null;
}

/**
 * Attaches an optional `Idempotency-Key` header (`H-IDEM`, C05 §13.1) onto a headers dictionary.
 */
export function withIdempotencyKey(
  idempotencyKey?: string | null,
  headers?: HeadersInit,
): Record<string, string> {
  const merged: Record<string, string> = {};
  if (headers) {
    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        merged[key] = value;
      });
    } else if (Array.isArray(headers)) {
      for (const [key, value] of headers) {
        merged[key] = value;
      }
    } else {
      Object.assign(merged, headers);
    }
  }
  if (typeof idempotencyKey === 'string' && idempotencyKey.trim()) {
    for (const existingKey of Object.keys(merged)) {
      if (existingKey.toLowerCase() === 'idempotency-key') {
        delete merged[existingKey];
      }
    }
    merged['Idempotency-Key'] = idempotencyKey.trim();
  }
  return merged;
}

/**
 * GET /jobs/:id (EP-J01)
 * Polls status for an asynchronous background AI job belonging to the authenticated caller.
 */
export function getJobStatus(
  accessToken: string,
  jobId: string,
  options?: AuthStateRequestOptions,
): Promise<JobStatusDTO> {
  return apiFetch<JobStatusDTO>(
    `/jobs/${encodeURIComponent(jobId.trim())}`,
    accessToken,
    {
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * Generates a fresh client UUIDv4 for `Idempotency-Key` (`H-IDEM`, C05 §13.1) mutations.
 */
export function createIdempotencyKey(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Roadmap Lifecycle API Types & Functions (C05 §14.5 / §15.5) ───

export type RoadmapStatus = 'draft' | 'locked' | 'archived';
export type RoadmapVersionState = 'draft' | 'locked' | 'superseded' | 'restored';
export type RoadmapVersionOrigin = 'user_request' | 'ai' | 'merge' | 'undo';
export type ItemPriority = 'core' | 'supporting' | 'optional';
export type SkillGapType =
  | 'existing'
  | 'transferable'
  | 'refresh'
  | 'strengthen'
  | 'missing';

export interface RoadmapSourceRefDTO {
  publisher: string;
  url: string;
  retrieved_at?: string;
}

export interface RoadmapMilestoneDTO {
  id: string;
  title: string;
}

export interface RoadmapItemDTO {
  id: string;
  item_id: string;
  lineage_id: string;
  topic_id: string;
  skill_id: string;
  phase_no: number;
  phase_title: string | null;
  title: string;
  priority: ItemPriority;
  gap_type: SkillGapType;
  required_depth: string | null;
  estimated_effort_hours: number | null;
  sequence_no: number;
  depends_on: string[];
  depends_on_lineage_ids: string[];
  reason: string | null;
  retired: boolean;
  sources: RoadmapSourceRefDTO[];
}

export interface RoadmapPhaseDTO {
  phase_no: number;
  title: string;
  milestones: RoadmapMilestoneDTO[];
  items: RoadmapItemDTO[];
}

export interface RoadmapSummaryBlockDTO {
  current_situation: string;
  target_interpretation: string;
  expected_career_impact: string;
  next_steps: string[];
}

export interface LevelOutlineDTO {
  career_level: CareerLevel;
  outline: string[];
}

export interface RoadmapSizeGuardrailDTO {
  active_topic_count: number;
  soft_max_topics: number;
  materially_large: boolean;
  warning: string | null;
}

export interface RoadmapSummaryDTO {
  id: string;
  career_goal_id: string;
  canonical_role_id: string;
  role_name: string;
  target_level: CareerLevel;
  status: RoadmapStatus;
  is_focus: boolean;
  current_version_id: string | null;
  current_version_no: number | null;
  draft_version_no: number | null;
  has_open_draft: boolean;
  has_open_merge: boolean;
  has_daily_plan: boolean;
  stale: boolean;
  stale_draft: boolean;
  locked_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoadmapListResponseDTO {
  items: RoadmapSummaryDTO[];
  meta: PageMetaDTO;
}

export interface RoadmapDetailDTO {
  id: string;
  career_goal_id: string;
  canonical_role_id: string;
  role_name: string;
  target_level: CareerLevel;
  status: RoadmapStatus;
  is_focus: boolean;
  version_id: string;
  version_no: number;
  version_state: RoadmapVersionState;
  summary: RoadmapSummaryBlockDTO;
  phases: RoadmapPhaseDTO[];
  items: RoadmapItemDTO[];
  level_outline: LevelOutlineDTO[];
  size_guardrail: RoadmapSizeGuardrailDTO;
  warnings: string[];
  stale: boolean;
  stale_reason: string | null;
  locked_at: string | null;
  created_at: string;
}

export type RoadmapResponseDTO = RoadmapDetailDTO;

export interface GenerateRoadmapRequestDTO {
  career_goal_id: string;
  target_level: CareerLevel;
  level_confirmed: boolean;
}

export interface ListRoadmapsParams {
  status?: RoadmapStatus;
  cursor?: string;
  limit?: number;
}

export type RoadmapVersionQuery = 'current' | 'draft' | number | string;

export interface RevisionRequestDTO {
  instruction?: string;
  refresh_stale?: boolean;
  expected_version_no?: number;
}

export interface LockRoadmapDTO {
  expected_version_no?: number;
  version_no?: number;
  confirm_large_roadmap?: boolean;
  acknowledge_stale?: boolean;
}

export interface LockRoadmapResponseDTO {
  roadmap_id: string;
  status: 'locked';
  version_no: number;
  current_version_id: string;
  is_focus: boolean;
  locked_at: string;
  next_step: 'confirm_learning_hours';
  preferred_daily_hours: number | null;
  size_guardrail: RoadmapSizeGuardrailDTO;
}

export interface RoadmapVersionDTO {
  id: string;
  version_no: number;
  state: RoadmapVersionState;
  created_by: RoadmapVersionOrigin;
  target_level: CareerLevel;
  base_version_id: string | null;
  merge_id: string | null;
  stale: boolean;
  locked_at: string | null;
  superseded_at: string | null;
  created_at: string;
}

export interface ListRoadmapVersionsParams {
  cursor?: string;
  limit?: number;
}

export interface RoadmapVersionListResponseDTO {
  items: RoadmapVersionDTO[];
  meta: PageMetaDTO;
}

export interface FocusSwitchResponseDTO {
  focus_roadmap_id: string;
  daily_plan: {
    state: 'existing' | 'missing';
    plan_id: string | null;
    requires_learning_hours: boolean;
  };
}

export interface ArchiveRoadmapDTO {
  reason?: string;
}

export interface ArchiveRoadmapResponseDTO {
  archived_roadmap_id: string;
  status: 'archived';
  new_focus_roadmap_id: string | null;
}

export type MergeOrigin = 'user_request' | 'level_change' | 'ai_proposal';
export type UserMergeOrigin = 'user_request' | 'level_change';
export type MergeStatus =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'undone'
  | 'superseded';
export type MergeOp =
  | 'add_topic'
  | 'update_topic'
  | 'reprioritize'
  | 'reclassify'
  | 'retire_topic';

export type CreateRoadmapMergeInputDTO = {
  origin: UserMergeOrigin;
  target_level?: CareerLevel;
  instruction?: string;
  base_version_no?: number;
};

export type ListRoadmapMergesParams = {
  status?: MergeStatus;
  cursor?: string;
  limit?: number;
};

export type MergeOperationDTO = {
  id: string;
  sort_order: number;
  op: MergeOp;
  item_id: string | null;
  lineage_id: string | null;
  topic_id: string | null;
  skill_id: string | null;
  title: string | null;
  priority: ItemPriority | null;
  reason: string | null;
  payload: Record<string, unknown>;
};

export type MergeSizeImpactDTO = {
  active_topics_before: number;
  active_topics_after: number;
  before: number;
  after: number;
  delta: number;
  soft_limit: number;
  materially_large: boolean;
  warning: string | null;
};

export type MergeDailyPlanImpactDTO = {
  has_active_plan: boolean;
  completed_days_unchanged: number;
  future_days_affected: number;
};

export type MergeSummaryDTO = {
  id: string;
  roadmap_id: string;
  origin: MergeOrigin;
  status: MergeStatus;
  base_version_no: number;
  target_level: CareerLevel | null;
  reason: string | null;
  materially_large: boolean;
  undo_available: boolean;
  created_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  undone_at: string | null;
};

export type PaginatedMergeListDTO = {
  items: MergeSummaryDTO[];
  meta: PageMetaDTO;
};

export type MergeProposalDTO = {
  id: string;
  roadmap_id: string;
  origin: MergeOrigin;
  status: MergeStatus;
  base_version_id: string;
  base_version_no: number;
  result_version_id: string | null;
  target_level: CareerLevel | null;
  instruction: string | null;
  reason: string | null;
  operations: MergeOperationDTO[];
  size_impact: MergeSizeImpactDTO;
  daily_plan_impact: MergeDailyPlanImpactDTO;
  undo_available: boolean;
  created_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  undone_at: string | null;
  undo_window_closed_at: string | null;
};

export type AcceptRoadmapMergeInputDTO = {
  base_version_no?: number;
  acknowledge_large_expansion?: boolean;
};

export type AcceptRoadmapMergeResultDTO = {
  roadmap_id: string;
  merge_id: string;
  new_version_no: number;
  undo_available: boolean;
  daily_plan_reconciled: boolean;
};

export type RejectRoadmapMergeResultDTO = {
  merge_id: string;
  status: 'rejected';
  rejected_at: string;
};

export type UndoRoadmapMergeResultDTO = {
  restored_version_no: number;
  merge_id: string;
  status: 'undone';
};

function normalizePaginatedEnvelope<T>(
  envelope: ApiEnvelopeResult<T[] | { items: T[]; meta?: PageMetaDTO }>,
  defaultLimit = 20,
): { items: T[]; meta: PageMetaDTO } {
  const topMeta = parsePageMeta(envelope.meta);
  const payload = envelope.data;
  if (Array.isArray(payload)) {
    return {
      items: payload,
      meta: topMeta ?? {
        limit: defaultLimit,
        next_cursor: null,
      },
    };
  }
  if (payload && typeof payload === 'object' && Array.isArray(payload.items)) {
    const embeddedMeta = parsePageMeta((payload as { meta?: unknown }).meta);
    return {
      items: payload.items,
      meta: topMeta ?? embeddedMeta ?? {
        limit: defaultLimit,
        next_cursor: null,
      },
    };
  }
  return {
    items: [],
    meta: topMeta ?? { limit: defaultLimit, next_cursor: null },
  };
}

/**
 * POST /roadmaps/generate (EP-R01, 202 Accepted, H-IDEM)
 */
export function generateRoadmap(
  accessToken: string,
  body: GenerateRoadmapRequestDTO,
  idempotencyKey: string,
  options?: AuthStateRequestOptions,
): Promise<JobAcceptedDTO> {
  return apiFetch<JobAcceptedDTO>('/roadmaps/generate', accessToken, {
    method: 'POST',
    headers: withIdempotencyKey(idempotencyKey),
    body: JSON.stringify(body),
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

/**
 * GET /roadmaps (EP-R02, Gate: none)
 */
export async function listRoadmaps(
  accessToken: string,
  params?: ListRoadmapsParams,
  options?: AuthStateRequestOptions,
): Promise<RoadmapListResponseDTO> {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.cursor) search.set('cursor', params.cursor);
  if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) {
    search.set('limit', String(params.limit));
  }
  const qs = search.toString();
  const envelope = await apiFetchEnvelope<
    RoadmapSummaryDTO[] | { items: RoadmapSummaryDTO[]; meta?: PageMetaDTO }
  >(qs ? `/roadmaps?${qs}` : '/roadmaps', accessToken, {
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  return normalizePaginatedEnvelope(envelope, params?.limit ?? 20);
}

/**
 * GET /roadmaps/:id (EP-R03, optional ?version=current|draft|<int>, Gate: none)
 */
export function getRoadmap(
  accessToken: string,
  roadmapId: string,
  version?: RoadmapVersionQuery,
  options?: AuthStateRequestOptions,
): Promise<RoadmapDetailDTO> {
  const encodedId = encodeURIComponent(roadmapId.trim());
  const versionParam =
    version !== undefined && String(version).trim() !== ''
      ? `?version=${encodeURIComponent(String(version).trim())}`
      : '';
  return apiFetch<RoadmapDetailDTO>(
    `/roadmaps/${encodedId}${versionParam}`,
    accessToken,
    {
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * POST /roadmaps/:id/revision (EP-R04, 202 Accepted, H-IDEM)
 */
export function reviseRoadmap(
  accessToken: string,
  roadmapId: string,
  body: RevisionRequestDTO,
  idempotencyKey: string,
  options?: AuthStateRequestOptions,
): Promise<JobAcceptedDTO> {
  return apiFetch<JobAcceptedDTO>(
    `/roadmaps/${encodeURIComponent(roadmapId.trim())}/revision`,
    accessToken,
    {
      method: 'POST',
      headers: withIdempotencyKey(idempotencyKey),
      body: JSON.stringify(body),
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * POST /roadmaps/:id/lock (EP-R05, 200 OK, H-IDEM)
 */
export function lockRoadmap(
  accessToken: string,
  roadmapId: string,
  body: LockRoadmapDTO,
  idempotencyKey: string,
  options?: AuthStateRequestOptions,
): Promise<LockRoadmapResponseDTO> {
  return apiFetch<LockRoadmapResponseDTO>(
    `/roadmaps/${encodeURIComponent(roadmapId.trim())}/lock`,
    accessToken,
    {
      method: 'POST',
      headers: withIdempotencyKey(idempotencyKey),
      body: JSON.stringify(body),
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * GET /roadmaps/:id/versions (EP-R06, Gate: none)
 */
export async function listRoadmapVersions(
  accessToken: string,
  roadmapId: string,
  params?: ListRoadmapVersionsParams,
  options?: AuthStateRequestOptions,
): Promise<RoadmapVersionListResponseDTO> {
  const search = new URLSearchParams();
  if (params?.cursor) search.set('cursor', params.cursor);
  if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) {
    search.set('limit', String(params.limit));
  }
  const qs = search.toString();
  const base = `/roadmaps/${encodeURIComponent(roadmapId.trim())}/versions`;
  const envelope = await apiFetchEnvelope<
    RoadmapVersionDTO[] | { items: RoadmapVersionDTO[]; meta?: PageMetaDTO }
  >(qs ? `${base}?${qs}` : base, accessToken, {
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  return normalizePaginatedEnvelope(envelope, params?.limit ?? 50);
}

/**
 * GET /roadmaps/:id/versions/:version_no (EP-R07, Gate: none)
 */
export function getRoadmapVersion(
  accessToken: string,
  roadmapId: string,
  versionNo: number | string,
  options?: AuthStateRequestOptions,
): Promise<RoadmapDetailDTO> {
  return apiFetch<RoadmapDetailDTO>(
    `/roadmaps/${encodeURIComponent(roadmapId.trim())}/versions/${encodeURIComponent(String(versionNo).trim())}`,
    accessToken,
    {
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * POST /roadmaps/:id/merges (EP-R08, 202 Accepted, H-IDEM)
 */
export function createRoadmapMerge(
  accessToken: string,
  roadmapId: string,
  input: CreateRoadmapMergeInputDTO,
  idempotencyKey: string,
  ifMatchVersionNo?: number,
  options?: AuthStateRequestOptions,
): Promise<JobAcceptedDTO> {
  const extraHeaders: Record<string, string> = {};
  if (
    typeof ifMatchVersionNo === 'number' &&
    Number.isInteger(ifMatchVersionNo) &&
    ifMatchVersionNo >= 1
  ) {
    extraHeaders['If-Match'] = String(ifMatchVersionNo);
  }
  return apiFetch<JobAcceptedDTO>(
    `/roadmaps/${encodeURIComponent(roadmapId.trim())}/merges`,
    accessToken,
    {
      method: 'POST',
      headers: withIdempotencyKey(idempotencyKey, extraHeaders),
      body: JSON.stringify(input),
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * GET /roadmaps/:id/merges (EP-R09, Gate: none)
 */
export async function listRoadmapMerges(
  accessToken: string,
  roadmapId: string,
  params?: ListRoadmapMergesParams,
  options?: AuthStateRequestOptions,
): Promise<PaginatedMergeListDTO> {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.cursor) search.set('cursor', params.cursor);
  const normalizedLimit =
    typeof params?.limit === 'number' &&
    Number.isFinite(params.limit) &&
    Math.floor(params.limit) >= 1
      ? Math.min(100, Math.floor(params.limit))
      : undefined;
  if (normalizedLimit !== undefined) {
    search.set('limit', String(normalizedLimit));
  }
  const qs = search.toString();
  const base = `/roadmaps/${encodeURIComponent(roadmapId.trim())}/merges`;
  const envelope = await apiFetchEnvelope<
    MergeSummaryDTO[] | { items: MergeSummaryDTO[]; meta?: PageMetaDTO }
  >(qs ? `${base}?${qs}` : base, accessToken, {
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  const payload = envelope.data as unknown;
  const isValidArray = Array.isArray(payload);
  const isValidWrapped =
    payload !== null &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    Array.isArray((payload as { items?: unknown }).items);
  if (!isValidArray && !isValidWrapped) {
    throw new ApiError(
      502,
      'Unexpected merge proposals response format.',
      'INVALID_RESPONSE',
      undefined,
      [],
      true,
    );
  }
  return normalizePaginatedEnvelope(envelope, normalizedLimit ?? 20);
}

/**
 * GET /roadmaps/:id/merges/:merge_id (EP-R10, Gate: none)
 */
export async function getRoadmapMerge(
  accessToken: string,
  roadmapId: string,
  mergeId: string,
  options?: AuthStateRequestOptions,
): Promise<MergeProposalDTO> {
  const detail = await apiFetch<MergeProposalDTO>(
    `/roadmaps/${encodeURIComponent(roadmapId.trim())}/merges/${encodeURIComponent(mergeId.trim())}`,
    accessToken,
    {
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
  if (
    !detail ||
    typeof detail !== 'object' ||
    typeof detail.id !== 'string' ||
    detail.id.trim().length === 0 ||
    !Array.isArray(detail.operations) ||
    !detail.size_impact ||
    typeof detail.size_impact !== 'object' ||
    Array.isArray(detail.size_impact) ||
    !detail.daily_plan_impact ||
    typeof detail.daily_plan_impact !== 'object' ||
    Array.isArray(detail.daily_plan_impact)
  ) {
    throw new ApiError(
      502,
      'Unexpected merge proposal detail format.',
      'INVALID_RESPONSE',
      undefined,
      [],
      true,
    );
  }
  return detail;
}

/**
 * POST /roadmaps/:id/merges/:merge_id/accept (EP-R11, 200 OK, H-IDEM)
 */
export function acceptRoadmapMerge(
  accessToken: string,
  roadmapId: string,
  mergeId: string,
  input: AcceptRoadmapMergeInputDTO,
  idempotencyKey: string,
  ifMatchVersionNo?: number,
  options?: AuthStateRequestOptions,
): Promise<AcceptRoadmapMergeResultDTO> {
  const extraHeaders: Record<string, string> = {};
  if (
    typeof ifMatchVersionNo === 'number' &&
    Number.isInteger(ifMatchVersionNo) &&
    ifMatchVersionNo >= 1
  ) {
    extraHeaders['If-Match'] = String(ifMatchVersionNo);
  }
  return apiFetch<AcceptRoadmapMergeResultDTO>(
    `/roadmaps/${encodeURIComponent(roadmapId.trim())}/merges/${encodeURIComponent(mergeId.trim())}/accept`,
    accessToken,
    {
      method: 'POST',
      headers: withIdempotencyKey(idempotencyKey, extraHeaders),
      body: JSON.stringify(input),
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * POST /roadmaps/:id/merges/:merge_id/reject (EP-R12, 200 OK, Gate: none)
 */
export function rejectRoadmapMerge(
  accessToken: string,
  roadmapId: string,
  mergeId: string,
  options?: AuthStateRequestOptions,
): Promise<RejectRoadmapMergeResultDTO> {
  return apiFetch<RejectRoadmapMergeResultDTO>(
    `/roadmaps/${encodeURIComponent(roadmapId.trim())}/merges/${encodeURIComponent(mergeId.trim())}/reject`,
    accessToken,
    {
      method: 'POST',
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * POST /roadmaps/:id/merges/undo (EP-R13, 200 OK, H-IDEM, Gate: none)
 */
export function undoLastRoadmapMerge(
  accessToken: string,
  roadmapId: string,
  idempotencyKey: string,
  ifMatchVersionNo?: number,
  options?: AuthStateRequestOptions,
): Promise<UndoRoadmapMergeResultDTO> {
  const extraHeaders: Record<string, string> = {};
  if (
    typeof ifMatchVersionNo === 'number' &&
    Number.isInteger(ifMatchVersionNo) &&
    ifMatchVersionNo >= 1
  ) {
    extraHeaders['If-Match'] = String(ifMatchVersionNo);
  }
  return apiFetch<UndoRoadmapMergeResultDTO>(
    `/roadmaps/${encodeURIComponent(roadmapId.trim())}/merges/undo`,
    accessToken,
    {
      method: 'POST',
      headers: withIdempotencyKey(idempotencyKey, extraHeaders),
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * POST /roadmaps/:id/focus (EP-R14, Gate: none)
 */
export function focusRoadmap(
  accessToken: string,
  roadmapId: string,
  options?: AuthStateRequestOptions,
): Promise<FocusSwitchResponseDTO> {
  return apiFetch<FocusSwitchResponseDTO>(
    `/roadmaps/${encodeURIComponent(roadmapId.trim())}/focus`,
    accessToken,
    {
      method: 'POST',
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * POST /roadmaps/:id/archive (EP-R15, Gate: none)
 */
export function archiveRoadmap(
  accessToken: string,
  roadmapId: string,
  body?: ArchiveRoadmapDTO,
  options?: AuthStateRequestOptions,
): Promise<ArchiveRoadmapResponseDTO> {
  return apiFetch<ArchiveRoadmapResponseDTO>(
    `/roadmaps/${encodeURIComponent(roadmapId.trim())}/archive`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

// ─── Learning, Daily Plans, Topic Content & Today API (C05 §14.6 / §15.6) ───

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed';
export type PlanDayStatus = PlanItemStatus;
export type TodayStatus =
  | 'ready'
  | 'preparing'
  | 'no_focus_roadmap'
  | 'no_daily_plan'
  | 'plan_completed';
export type ResourceType =
  | 'official_docs'
  | 'release_notes'
  | 'article'
  | 'standard'
  | 'video'
  | 'other';
export type AttemptStatus =
  | 'generated'
  | 'started'
  | 'submitted'
  | 'ai_reviewed'
  | 'feedback_available';

export interface PlanDayTopicDTO {
  plan_item_id: string;
  topic_id: string;
  title: string;
}

export interface PlanDayDTO {
  day_no: number;
  status: PlanDayStatus;
  topics: PlanDayTopicDTO[];
  completed_at: string | null;
}

export interface DailyPlanResponseDTO {
  plan_id: string;
  roadmap_id: string;
  is_focus: boolean;
  hours_per_day: number;
  roadmap_version_no: number;
  next_incomplete_day_no: number | null;
  total_days: number;
  completed_days: number;
  days: PlanDayDTO[];
}

export interface PaginatedDailyPlanResponseDTO {
  plan: DailyPlanResponseDTO;
  meta: PageMetaDTO;
}

export interface GetDailyPlanParams {
  roadmap_id?: string;
  limit?: number;
  cursor?: string;
}

export interface CreateDailyPlanDTO {
  roadmap_id: string;
  hours_per_day: number;
}

export interface RebuildDailyPlanDTO {
  hours_per_day: number;
}

export interface TopicImportantQuestionDTO {
  question: string;
  answer_markdown: string;
}

export interface TopicSourceRefDTO {
  publisher: string;
  url: string;
  retrieved_at?: string;
}

export interface TopicDetailDTO {
  topic_id: string;
  title: string;
  career_level: CareerLevel;
  content_version: number;
  explanation_markdown: string | null;
  important_questions: TopicImportantQuestionDTO[];
  sources: TopicSourceRefDTO[];
  learning_state: LearningState;
  required_depth: string;
  rating_allowed: boolean;
  report_allowed: boolean;
}

export interface TodayPlanDayDTO {
  day_no: number;
  total_days: number;
  plan_item_id?: string;
}

export interface TodayQuizSummaryDTO {
  attempt_id: string | null;
  status: AttemptStatus | null;
  can_retry: boolean;
}

export interface TodayResponseDTO {
  status: TodayStatus;
  roadmap_id: string | null;
  plan_id: string | null;
  plan_day: TodayPlanDayDTO | null;
  topic: TopicDetailDTO | null;
  quiz: TodayQuizSummaryDTO;
  job: JobAcceptedDTO | null;
  requires_learning_hours: boolean;
  preferred_daily_hours?: number | null;
}

export interface ListLearningTopicsParams {
  roadmap_id?: string;
  priority?: ItemPriority;
  learning_state?: LearningState;
  limit?: number;
  cursor?: string;
}

export interface TopicSummaryDTO {
  topic_id: string;
  title: string;
  skill_id: string;
  priority: ItemPriority;
  career_level: CareerLevel;
  learning_state: LearningState;
  plan_day_no: number | null;
}

export interface TopicListResponseDTO {
  items: TopicSummaryDTO[];
  meta: PageMetaDTO;
}

export interface ListLearningResourcesParams {
  topic_id: string;
  limit?: number;
  cursor?: string;
}

export interface LearningResourceDTO {
  id: string;
  title: string;
  publisher: string;
  url: string;
  resource_type: ResourceType;
  retrieved_at: string | null;
}

export interface LearningResourceListResponseDTO {
  items: LearningResourceDTO[];
  meta: PageMetaDTO;
}

/**
 * GET /learning/daily-plan (EP-L01, Gate: none)
 */
export async function getDailyPlan(
  accessToken: string,
  params?: GetDailyPlanParams,
  options?: AuthStateRequestOptions,
): Promise<PaginatedDailyPlanResponseDTO> {
  const search = new URLSearchParams();
  if (params?.roadmap_id) search.set('roadmap_id', params.roadmap_id.trim());
  if (params?.cursor) search.set('cursor', params.cursor);
  if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) {
    search.set('limit', String(params.limit));
  }
  const qs = search.toString();
  const envelope = await apiFetchEnvelope<DailyPlanResponseDTO>(
    qs ? `/learning/daily-plan?${qs}` : '/learning/daily-plan',
    accessToken,
    {
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
  return {
    plan: envelope.data,
    meta: envelope.meta ?? {
      limit: params?.limit ?? 20,
      next_cursor: null,
    },
  };
}

/**
 * POST /learning/daily-plans (EP-L02, 201 Created, H-IDEM, Gate: write daily_plan)
 */
export function createDailyPlan(
  accessToken: string,
  body: CreateDailyPlanDTO,
  idempotencyKey: string,
  options?: AuthStateRequestOptions,
): Promise<DailyPlanResponseDTO> {
  return apiFetch<DailyPlanResponseDTO>('/learning/daily-plans', accessToken, {
    method: 'POST',
    headers: withIdempotencyKey(idempotencyKey),
    body: JSON.stringify(body),
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

/**
 * POST /learning/daily-plans/:id/rebuild (EP-L03, 200 OK, Gate: write daily_plan)
 */
export function rebuildDailyPlan(
  accessToken: string,
  planId: string,
  body: RebuildDailyPlanDTO,
  options?: AuthStateRequestOptions,
): Promise<DailyPlanResponseDTO> {
  return apiFetch<DailyPlanResponseDTO>(
    `/learning/daily-plans/${encodeURIComponent(planId.trim())}/rebuild`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(body),
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * GET /learning/today (EP-L04, Gate: none for reads; daily_plan checked on missing-content enqueue)
 */
export function getToday(
  accessToken: string,
  options?: AuthStateRequestOptions,
): Promise<TodayResponseDTO> {
  return apiFetch<TodayResponseDTO>('/learning/today', accessToken, {
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
}

/**
 * GET /learning/topics (EP-L05, Gate: none)
 */
export async function listLearningTopics(
  accessToken: string,
  params?: ListLearningTopicsParams,
  options?: AuthStateRequestOptions,
): Promise<TopicListResponseDTO> {
  const search = new URLSearchParams();
  if (params?.roadmap_id) search.set('roadmap_id', params.roadmap_id.trim());
  if (params?.priority) search.set('priority', params.priority);
  if (params?.learning_state) search.set('learning_state', params.learning_state);
  if (params?.cursor) search.set('cursor', params.cursor);
  if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) {
    search.set('limit', String(params.limit));
  }
  const qs = search.toString();
  const envelope = await apiFetchEnvelope<
    TopicSummaryDTO[] | { items: TopicSummaryDTO[]; meta?: PageMetaDTO }
  >(qs ? `/learning/topics?${qs}` : '/learning/topics', accessToken, {
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  return normalizePaginatedEnvelope(envelope, params?.limit ?? 20);
}

/**
 * GET /learning/topics/:id (EP-L06, Gate: none)
 */
export function getLearningTopic(
  accessToken: string,
  topicId: string,
  options?: AuthStateRequestOptions,
): Promise<TopicDetailDTO> {
  return apiFetch<TopicDetailDTO>(
    `/learning/topics/${encodeURIComponent(topicId.trim())}`,
    accessToken,
    {
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * GET /learning/resources (EP-L07, Gate: none)
 */
export async function listLearningResources(
  accessToken: string,
  params: ListLearningResourcesParams,
  options?: AuthStateRequestOptions,
): Promise<LearningResourceListResponseDTO> {
  const search = new URLSearchParams();
  search.set('topic_id', params.topic_id.trim());
  if (params.cursor) search.set('cursor', params.cursor);
  if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
    search.set('limit', String(params.limit));
  }
  const envelope = await apiFetchEnvelope<
    LearningResourceDTO[] | { items: LearningResourceDTO[]; meta?: PageMetaDTO }
  >(`/learning/resources?${search.toString()}`, accessToken, {
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  return normalizePaginatedEnvelope(envelope, params.limit ?? 20);
}

// ─── M08 Quiz, AI Practice Review & Progress API (C05 §14.7–§14.9 / §15.7–§15.9) ───

export type QuestionType = 'mcq' | 'free_response';
export type QuestionDifficulty = 'basic' | 'application' | 'analysis';
export type PerformanceLevel = 'good' | 'needs_work';
export type ReviewStatus = 'pending' | 'reviewed' | 'failed' | 'not_evidence';
export type ResponseHint =
  | 'sql'
  | 'code'
  | 'config'
  | 'test_case'
  | 'debug'
  | 'command'
  | 'design'
  | 'text';
export type ReviewDimensionScore = 'good' | 'partial' | 'weak';
export type EvidenceSource = 'quiz_attempt' | 'practice_review';
export type ProgressEventType = 'state_change' | 'evidence_added';

export interface QuizGenerateDTO {
  daily_plan_item_id: string;
}

export interface QuizAnswerInputDTO {
  question_id: string;
  selected_option_id?: string | null;
  text?: string | null;
  i_dont_know?: boolean;
  clear?: boolean;
}

export interface QuizAnswersPatchDTO {
  answers: QuizAnswerInputDTO[];
}

export interface QuizSubmissionDTO {
  answers?: QuizAnswerInputDTO[];
  confirm_unanswered?: boolean;
}

export interface QuizQuestionOptionDTO {
  option_id: string;
  text: string;
}

export interface QuizQuestionDTO {
  question_id: string;
  type: QuestionType;
  difficulty: QuestionDifficulty;
  prompt: string;
  options: QuizQuestionOptionDTO[] | null;
  response_hint: string | null;
  max_length: number | null;
  allow_i_dont_know: boolean;
}

export interface SavedQuizAnswerDTO {
  question_id: string;
  selected_option_id: string | null;
  text: string | null;
  i_dont_know: boolean;
}

export interface QuizAttemptDTO {
  attempt_id: string;
  status: AttemptStatus;
  attempt_no: number;
  topic_id: string;
  topic_title?: string;
  career_level: CareerLevel;
  questions: QuizQuestionDTO[];
  saved_answers: SavedQuizAnswerDTO[];
  submitted_at: string | null;
}

export interface QuizAnswersSavedResponseDTO {
  saved: number;
  saved_at: string;
}

export interface QuizMcqScoreDTO {
  correct: number;
  total: number;
}

export interface QuizSubmitResponseDTO {
  attempt_id: string;
  status: AttemptStatus;
  mcq_score: QuizMcqScoreDTO;
  plan_day_unlocked: boolean;
  next_plan_day_no: number | null;
  review_job_id: string | null;
}

export interface QuizResultMcqQuestionDTO {
  question_id: string;
  type: 'mcq';
  your_answer: string | null;
  correct_answer: string;
  is_correct: boolean;
  explanation: string | null;
  reportable: boolean;
}

export interface QuizResultFreeResponseQuestionDTO {
  question_id: string;
  type: 'free_response';
  user_answer?: string | null;
  explanation?: string | null;
  practice_review_id: string | null;
  review_status: ReviewStatus;
  reportable: boolean;
}

export type QuizResultQuestionDTO =
  | QuizResultMcqQuestionDTO
  | QuizResultFreeResponseQuestionDTO;

export interface ProgressChangeSummaryDTO {
  skill_id: string;
  career_level: CareerLevel;
  from: LearningState;
  to: LearningState;
  reason: string;
}

export interface QuizResultDTO {
  attempt_id: string;
  status: AttemptStatus;
  attempt_no: number;
  topic_title?: string;
  mcq_score: QuizMcqScoreDTO;
  performance_level: PerformanceLevel | null;
  questions: QuizResultQuestionDTO[];
  improvement_recommendations: string[];
  progress_change: ProgressChangeSummaryDTO | null;
  retry_available: boolean;
}

export interface PracticeReviewDimensionsDTO {
  correctness: ReviewDimensionScore;
  understanding: ReviewDimensionScore;
  reasoning: ReviewDimensionScore;
}

export interface PracticeReviewSummaryDTO {
  id: string;
  question_id: string;
  review_status: ReviewStatus;
  performance_level: PerformanceLevel | null;
}

export interface PracticeFeedbackDTO {
  id: string;
  question_id: string;
  review_status: ReviewStatus;
  performance_level: PerformanceLevel | null;
  dimensions: PracticeReviewDimensionsDTO | null;
  strengths: string[];
  mistakes: string[];
  weaknesses: string[];
  improvement_recommendations: string[];
  evidence_eligible: boolean;
  reportable: boolean;
}

export interface RoadmapProgressCountsDTO {
  items_total: number;
  items_completed: number;
}

export interface SkillProgressDTO {
  skill_id: string;
  name: string;
  career_level: CareerLevel;
  learning_state: LearningState;
  shared_with_roadmap_ids: string[];
  weak_area: boolean;
  last_evidence_at: string | null;
  state_reason: string | null;
}

export interface WeakAreaDTO {
  skill_id: string;
  name: string;
  reason: string;
}

export interface ProgressResponseDTO {
  roadmap_id: string | null;
  career_level: CareerLevel;
  roadmap_progress: RoadmapProgressCountsDTO;
  skills: SkillProgressDTO[];
  weak_areas: WeakAreaDTO[];
}

export interface PaginatedProgressResponseDTO {
  progress: ProgressResponseDTO;
  meta: PageMetaDTO;
}

export interface GetProgressParams {
  roadmap_id?: string;
  career_level?: CareerLevel;
  learning_state?: LearningState;
  limit?: number;
  cursor?: string;
}

export interface SkillEvidenceSummaryDTO {
  count: number;
  quiz_attempts: number;
  practice_reviews: number;
  retry_improved: boolean | null;
}

export interface SkillRoadmapRequirementDTO {
  roadmap_id: string;
  required_depth: string | null;
}

export interface SkillLevelProgressDetailDTO {
  career_level: CareerLevel;
  learning_state: LearningState;
  state_reason: string | null;
  last_evidence_at: string | null;
  evidence_summary: SkillEvidenceSummaryDTO;
  roadmap_requirements: SkillRoadmapRequirementDTO[];
}

export interface SkillProgressDetailDTO {
  skill_id: string;
  name: string;
  levels: SkillLevelProgressDetailDTO[];
}

export interface GetSkillProgressDetailParams {
  career_level?: CareerLevel;
}

export interface ProgressHistoryItemDTO {
  id: string;
  occurred_at: string;
  skill_id: string;
  career_level: CareerLevel;
  event: ProgressEventType;
  from_state: LearningState | null;
  to_state: LearningState | null;
  reason: string | null;
  source: EvidenceSource | null;
  source_id: string | null;
  source_attempt_id: string | null;
}

export interface PaginatedProgressHistoryResponseDTO {
  items: ProgressHistoryItemDTO[];
  meta: PageMetaDTO;
}

export interface GetProgressHistoryParams {
  skill_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

const VALID_JOB_STATUSES: ReadonlySet<string> = new Set<JobStatus>([
  'queued',
  'preparing',
  'succeeded',
  'failed',
]);

function normalizePositiveLimit(limit?: number): number | undefined {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return undefined;
  }
  const floored = Math.floor(limit);
  return floored >= 1 ? floored : undefined;
}

/**
 * Type guard distinguishing `202 JobAcceptedDTO` responses from synchronous attempt/feedback payloads.
 */
export function isJobAcceptedDTO(value: unknown): value is JobAcceptedDTO {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.job_id === 'string' &&
    typeof candidate.poll_url === 'string' &&
    typeof candidate.status === 'string' &&
    VALID_JOB_STATUSES.has(candidate.status) &&
    typeof candidate.retry_after_seconds === 'number' &&
    Number.isFinite(candidate.retry_after_seconds)
  );
}

/**
 * POST /quiz/generate (EP-Q01, 200/201/202, H-IDEM, Gate: write quiz_practice)
 */
export function generateQuiz(
  accessToken: string,
  body: QuizGenerateDTO,
  idempotencyKey: string,
  options?: AuthStateRequestOptions,
): Promise<QuizAttemptDTO | JobAcceptedDTO> {
  return apiFetch<QuizAttemptDTO | JobAcceptedDTO>(
    '/quiz/generate',
    accessToken,
    {
      method: 'POST',
      headers: withIdempotencyKey(idempotencyKey),
      body: JSON.stringify(body),
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * GET /quiz/:id (EP-Q02, 200 OK, Gate: none)
 */
export function getQuizAttempt(
  accessToken: string,
  attemptId: string,
  options?: AuthStateRequestOptions,
): Promise<QuizAttemptDTO> {
  return apiFetch<QuizAttemptDTO>(
    `/quiz/${encodeURIComponent(attemptId.trim())}`,
    accessToken,
    {
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * POST /quiz/:id/start (EP-Q03, 200 OK, Gate: write quiz_practice)
 */
export function startQuizAttempt(
  accessToken: string,
  attemptId: string,
  options?: AuthStateRequestOptions,
): Promise<QuizAttemptDTO> {
  return apiFetch<QuizAttemptDTO>(
    `/quiz/${encodeURIComponent(attemptId.trim())}/start`,
    accessToken,
    {
      method: 'POST',
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * PATCH /quiz/:id/answers (EP-Q04, 200 OK, Gate: write quiz_practice)
 */
export function patchQuizAnswers(
  accessToken: string,
  attemptId: string,
  body: QuizAnswersPatchDTO,
  options?: AuthStateRequestOptions,
): Promise<QuizAnswersSavedResponseDTO> {
  return apiFetch<QuizAnswersSavedResponseDTO>(
    `/quiz/${encodeURIComponent(attemptId.trim())}/answers`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * POST /quiz/:id/submit (EP-Q05, 200/202, H-IDEM, Gate: write quiz_practice)
 */
export function submitQuizAttempt(
  accessToken: string,
  attemptId: string,
  body: QuizSubmissionDTO,
  idempotencyKey: string,
  options?: AuthStateRequestOptions,
): Promise<QuizSubmitResponseDTO> {
  return apiFetch<QuizSubmitResponseDTO>(
    `/quiz/${encodeURIComponent(attemptId.trim())}/submit`,
    accessToken,
    {
      method: 'POST',
      headers: withIdempotencyKey(idempotencyKey),
      body: JSON.stringify(body),
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * GET /quiz/:id/result (EP-Q06, 200 OK, Gate: none)
 */
export function getQuizResult(
  accessToken: string,
  attemptId: string,
  options?: AuthStateRequestOptions,
): Promise<QuizResultDTO> {
  return apiFetch<QuizResultDTO>(
    `/quiz/${encodeURIComponent(attemptId.trim())}/result`,
    accessToken,
    {
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * POST /quiz/:id/retry (EP-Q07, 201/202, H-IDEM, Gate: write quiz_practice)
 */
export function retryQuizAttempt(
  accessToken: string,
  attemptId: string,
  idempotencyKey: string,
  options?: AuthStateRequestOptions,
): Promise<QuizAttemptDTO | JobAcceptedDTO> {
  return apiFetch<QuizAttemptDTO | JobAcceptedDTO>(
    `/quiz/${encodeURIComponent(attemptId.trim())}/retry`,
    accessToken,
    {
      method: 'POST',
      headers: withIdempotencyKey(idempotencyKey),
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * GET /practice-review?quiz_attempt_id=<uuid> (EP-PR01, 200 OK, Gate: none)
 */
export function listPracticeReviews(
  accessToken: string,
  quizAttemptId: string,
  options?: AuthStateRequestOptions,
): Promise<PracticeReviewSummaryDTO[]> {
  const search = new URLSearchParams();
  search.set('quiz_attempt_id', quizAttemptId.trim());
  return apiFetch<PracticeReviewSummaryDTO[]>(
    `/practice-review?${search.toString()}`,
    accessToken,
    {
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * GET /practice-review/:id/feedback (EP-PR02, 200 OK, Gate: none)
 */
export function getPracticeReviewFeedback(
  accessToken: string,
  reviewId: string,
  options?: AuthStateRequestOptions,
): Promise<PracticeFeedbackDTO> {
  return apiFetch<PracticeFeedbackDTO>(
    `/practice-review/${encodeURIComponent(reviewId.trim())}/feedback`,
    accessToken,
    {
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * POST /practice-review/:id/review (EP-PR03, 200/202, Gate: write ai_practice_review)
 */
export function retryPracticeReview(
  accessToken: string,
  reviewId: string,
  options?: AuthStateRequestOptions,
): Promise<PracticeFeedbackDTO | JobAcceptedDTO> {
  return apiFetch<PracticeFeedbackDTO | JobAcceptedDTO>(
    `/practice-review/${encodeURIComponent(reviewId.trim())}/review`,
    accessToken,
    {
      method: 'POST',
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * GET /progress (EP-G01, 200 OK, Gate: none)
 */
export async function getProgress(
  accessToken: string,
  params?: GetProgressParams,
  options?: AuthStateRequestOptions,
): Promise<PaginatedProgressResponseDTO> {
  const search = new URLSearchParams();
  const normalizedLimit = normalizePositiveLimit(params?.limit);
  if (params?.roadmap_id) search.set('roadmap_id', params.roadmap_id.trim());
  if (params?.career_level) search.set('career_level', params.career_level);
  if (params?.learning_state) {
    search.set('learning_state', params.learning_state);
  }
  if (params?.cursor) search.set('cursor', params.cursor);
  if (normalizedLimit !== undefined) {
    search.set('limit', String(normalizedLimit));
  }
  const qs = search.toString();
  const envelope = await apiFetchEnvelope<ProgressResponseDTO>(
    qs ? `/progress?${qs}` : '/progress',
    accessToken,
    {
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
  return {
    progress: envelope.data,
    meta: envelope.meta ?? {
      limit: normalizedLimit ?? 20,
      next_cursor: null,
    },
  };
}

/**
 * GET /progress/skills/:skill_id (EP-G02, 200 OK, Gate: none)
 */
export function getSkillProgressDetail(
  accessToken: string,
  skillId: string,
  params?: GetSkillProgressDetailParams,
  options?: AuthStateRequestOptions,
): Promise<SkillProgressDetailDTO> {
  const search = new URLSearchParams();
  if (params?.career_level) search.set('career_level', params.career_level);
  const qs = search.toString();
  const base = `/progress/skills/${encodeURIComponent(skillId.trim())}`;
  return apiFetch<SkillProgressDetailDTO>(
    qs ? `${base}?${qs}` : base,
    accessToken,
    {
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

/**
 * GET /progress/history (EP-G03, 200 OK, Gate: none)
 */
export async function getProgressHistory(
  accessToken: string,
  params?: GetProgressHistoryParams,
  options?: AuthStateRequestOptions,
): Promise<PaginatedProgressHistoryResponseDTO> {
  const search = new URLSearchParams();
  const normalizedLimit = normalizePositiveLimit(params?.limit);
  if (params?.skill_id) search.set('skill_id', params.skill_id.trim());
  if (params?.from) search.set('from', params.from.trim());
  if (params?.to) search.set('to', params.to.trim());
  if (params?.cursor) search.set('cursor', params.cursor);
  if (normalizedLimit !== undefined) {
    search.set('limit', String(normalizedLimit));
  }
  const qs = search.toString();
  const envelope = await apiFetchEnvelope<
    ProgressHistoryItemDTO[] | { items: ProgressHistoryItemDTO[]; meta?: PageMetaDTO }
  >(qs ? `/progress/history?${qs}` : '/progress/history', accessToken, {
    ...(options?.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  return normalizePaginatedEnvelope(envelope, normalizedLimit ?? 20);
}

// ─── M10 AI Career Mentor API (C05 §14.10 / §15.10) ─────────────────────────

export type MentorContextType = 'focus_roadmap' | 'topic' | 'general';
export type MentorLanguage = 'bn' | 'en' | 'mixed';
export type MentorMessageRole = 'user' | 'assistant';

export type ConversationCreateInput = {
  context_type: MentorContextType;
  topic_id?: string;
};

export type ConversationDTO = {
  id: string;
  context_type: MentorContextType;
  roadmap_id: string | null;
  topic_id: string | null;
  title: string | null;
  created_at: string;
};

export type ListMentorConversationsParams = {
  limit?: number;
  cursor?: string;
};

export type PaginatedConversationsResponseDTO = {
  items: ConversationDTO[];
  meta: PageMetaDTO;
};

export type MessageRequestInput = {
  conversation_id: string;
  content: string;
  client_message_id: string;
};

export type MessageDTO = {
  id: string;
  role: MentorMessageRole;
  content: string;
  language: MentorLanguage;
  created_at: string;
};

export type MessageResponseDTO = {
  user_message_id: string;
  assistant_message: MessageDTO;
  safety_mode: boolean;
  learning_claim_recorded: boolean;
};

export type GetMentorHistoryParams = {
  conversation_id: string;
  limit?: number;
  cursor?: string;
};

export type PaginatedMentorHistoryResponseDTO = {
  items: MessageDTO[];
  meta: PageMetaDTO;
};

const VALID_MENTOR_CONTEXT_TYPES: ReadonlySet<string> = new Set([
  'focus_roadmap',
  'topic',
  'general',
]);
const VALID_MENTOR_LANGUAGES: ReadonlySet<string> = new Set([
  'bn',
  'en',
  'mixed',
]);
const VALID_MENTOR_ROLES: ReadonlySet<string> = new Set(['user', 'assistant']);

function throwInvalidMentorResponse(message: string): never {
  throw new ApiError(502, message, 'INVALID_RESPONSE', undefined, [], true);
}

function isValidConversationDTO(value: unknown): value is ConversationDTO {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    rec.id.trim().length > 0 &&
    typeof rec.context_type === 'string' &&
    VALID_MENTOR_CONTEXT_TYPES.has(rec.context_type) &&
    (rec.roadmap_id === null || typeof rec.roadmap_id === 'string') &&
    (rec.topic_id === null || typeof rec.topic_id === 'string') &&
    (rec.title === null || typeof rec.title === 'string') &&
    typeof rec.created_at === 'string' &&
    rec.created_at.trim().length > 0
  );
}

function isValidMessageDTO(value: unknown): value is MessageDTO {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    rec.id.trim().length > 0 &&
    typeof rec.role === 'string' &&
    VALID_MENTOR_ROLES.has(rec.role) &&
    typeof rec.content === 'string' &&
    typeof rec.language === 'string' &&
    VALID_MENTOR_LANGUAGES.has(rec.language) &&
    typeof rec.created_at === 'string' &&
    rec.created_at.trim().length > 0
  );
}

function isValidMessageResponseDTO(value: unknown): value is MessageResponseDTO {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.user_message_id === 'string' &&
    rec.user_message_id.trim().length > 0 &&
    isValidMessageDTO(rec.assistant_message) &&
    rec.assistant_message.role === 'assistant' &&
    typeof rec.safety_mode === 'boolean' &&
    typeof rec.learning_claim_recorded === 'boolean'
  );
}

function extractValidatedArray<T>(
  envelope: { data: unknown; meta?: PageMetaDTO },
  validator: (item: unknown) => item is T,
  fallbackLimit: number,
  label: string,
): { items: T[]; meta: PageMetaDTO } {
  const payload = envelope.data;
  let rawItems: unknown;
  let rawEmbeddedMeta: unknown;

  if (Array.isArray(payload)) {
    rawItems = payload;
  } else if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    'items' in payload
  ) {
    rawItems = (payload as { items?: unknown }).items;
    rawEmbeddedMeta = (payload as { meta?: unknown }).meta;
  }

  if (!Array.isArray(rawItems) || !rawItems.every(validator)) {
    throwInvalidMentorResponse(`Unexpected ${label} format.`);
  }

  return {
    items: rawItems,
    meta:
      parsePageMeta(envelope.meta) ??
      parsePageMeta(rawEmbeddedMeta) ?? {
        limit: fallbackLimit,
        next_cursor: null,
      },
  };
}

/**
 * POST /mentor/conversations (EP-M01, 201 Created, Gate: write ai_mentor)
 */
export async function createMentorConversation(
  accessToken: string,
  input: ConversationCreateInput,
  options?: AuthStateRequestOptions,
): Promise<ConversationDTO> {
  const payload: ConversationCreateInput = {
    context_type: input.context_type,
    ...(input.topic_id !== undefined ? { topic_id: input.topic_id.trim() } : {}),
  };
  const data = await apiFetch<unknown>('/mentor/conversations', accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!isValidConversationDTO(data)) {
    throwInvalidMentorResponse('Unexpected mentor conversation response format.');
  }
  return data;
}

/**
 * GET /mentor/conversations (EP-M02, 200 OK, Gate: none)
 */
export async function listMentorConversations(
  accessToken: string,
  params?: ListMentorConversationsParams,
  options?: AuthStateRequestOptions,
): Promise<PaginatedConversationsResponseDTO> {
  const search = new URLSearchParams();
  const normalizedLimit = normalizePositiveLimit(params?.limit);
  if (normalizedLimit !== undefined) {
    search.set('limit', String(normalizedLimit));
  }
  if (params?.cursor) {
    search.set('cursor', params.cursor);
  }
  const qs = search.toString();
  const envelope = await apiFetchEnvelope<unknown>(
    qs ? `/mentor/conversations?${qs}` : '/mentor/conversations',
    accessToken,
    {
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
  return extractValidatedArray(
    envelope,
    isValidConversationDTO,
    normalizedLimit ?? 20,
    'mentor conversations list',
  );
}

/**
 * POST /mentor/messages (EP-M03, 201 Created JSON default, Gate: write ai_mentor).
 * Deduplication is body-level via `client_message_id` (no `Idempotency-Key` header).
 */
export async function sendMentorMessage(
  accessToken: string,
  input: MessageRequestInput,
  options?: AuthStateRequestOptions,
): Promise<MessageResponseDTO> {
  const data = await apiFetch<unknown>('/mentor/messages', accessToken, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: JSON.stringify({
      conversation_id: input.conversation_id.trim(),
      content: input.content,
      client_message_id: input.client_message_id.trim(),
    }),
    timeoutMs: options?.timeoutMs ?? 15_000,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!isValidMessageResponseDTO(data)) {
    throwInvalidMentorResponse('Unexpected mentor message response format.');
  }
  return data;
}

/**
 * GET /mentor/history (EP-M04, 200 OK, Gate: none; 90-day retention cutoff enforced server-side)
 */
export async function getMentorHistory(
  accessToken: string,
  params: GetMentorHistoryParams,
  options?: AuthStateRequestOptions,
): Promise<PaginatedMentorHistoryResponseDTO> {
  const search = new URLSearchParams();
  search.set('conversation_id', params.conversation_id.trim());
  const normalizedLimit = normalizePositiveLimit(params.limit);
  if (normalizedLimit !== undefined) {
    search.set('limit', String(normalizedLimit));
  }
  if (params.cursor) {
    search.set('cursor', params.cursor);
  }
  const envelope = await apiFetchEnvelope<unknown>(
    `/mentor/history?${search.toString()}`,
    accessToken,
    {
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
  return extractValidatedArray(
    envelope,
    isValidMessageDTO,
    normalizedLimit ?? 20,
    'mentor history',
  );
}

// ─── M11 Technology Intelligence API (C05 §14.11 / §15.11) ───────────────────

export type TechnologyReleaseStatus =
  | 'released'
  | 'announced'
  | 'planned'
  | 'experimental';

export type TechnologyRelevanceLevel = 'high' | 'medium' | 'low';

export type TechnologyActionTiming =
  | 'act_now'
  | 'learn_later'
  | 'awareness_only';

export type TechnologyUpdateState =
  | 'available'
  | 'no_important_changes'
  | 'temporarily_unavailable';

export type TechnologyUpdateDTO = {
  id: string;
  local_date: string;
  title: string;
  what_changed: string;
  why_it_matters: string;
  publisher: string;
  source_url: string;
  fetched_at: string;
  release_status: TechnologyReleaseStatus;
  relevance: TechnologyRelevanceLevel;
  action_timing: TechnologyActionTiming;
  roadmap_relation: string | null;
  viewed: boolean;
};

export type TechnologyUpdateListDTO = {
  today_state: TechnologyUpdateState | null;
  generation_pending: boolean;
  message: string | null;
  items: TechnologyUpdateDTO[];
};

export type PaginatedTechnologyUpdatesResponseDTO = {
  data: TechnologyUpdateListDTO;
  meta: PageMetaDTO;
};

export type TechnologyUpdateViewedDTO = {
  id: string;
  viewed: true;
  viewed_at: string;
};

export type ListTechnologyUpdatesParams = {
  limit?: number;
  cursor?: string;
};

const VALID_TECH_RELEASE_STATUSES: ReadonlySet<string> = new Set([
  'released',
  'announced',
  'planned',
  'experimental',
]);
const VALID_TECH_RELEVANCE_LEVELS: ReadonlySet<string> = new Set([
  'high',
  'medium',
  'low',
]);
const VALID_TECH_ACTION_TIMINGS: ReadonlySet<string> = new Set([
  'act_now',
  'learn_later',
  'awareness_only',
]);
const VALID_TECH_UPDATE_STATES: ReadonlySet<string> = new Set([
  'available',
  'no_important_changes',
  'temporarily_unavailable',
]);

function throwInvalidTechUpdateResponse(message: string): never {
  throw new ApiError(502, message, 'INVALID_RESPONSE', undefined, [], true);
}

function isValidTechnologyUpdateDTO(
  value: unknown,
): value is TechnologyUpdateDTO {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    rec.id.trim().length > 0 &&
    typeof rec.local_date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(rec.local_date) &&
    typeof rec.title === 'string' &&
    rec.title.trim().length > 0 &&
    typeof rec.what_changed === 'string' &&
    rec.what_changed.trim().length > 0 &&
    typeof rec.why_it_matters === 'string' &&
    rec.why_it_matters.trim().length > 0 &&
    typeof rec.publisher === 'string' &&
    rec.publisher.trim().length > 0 &&
    typeof rec.source_url === 'string' &&
    rec.source_url.trim().length > 0 &&
    typeof rec.fetched_at === 'string' &&
    rec.fetched_at.trim().length > 0 &&
    typeof rec.release_status === 'string' &&
    VALID_TECH_RELEASE_STATUSES.has(rec.release_status) &&
    typeof rec.relevance === 'string' &&
    VALID_TECH_RELEVANCE_LEVELS.has(rec.relevance) &&
    typeof rec.action_timing === 'string' &&
    VALID_TECH_ACTION_TIMINGS.has(rec.action_timing) &&
    (rec.roadmap_relation === null || typeof rec.roadmap_relation === 'string') &&
    typeof rec.viewed === 'boolean'
  );
}

function isValidTechnologyUpdateListDTO(
  value: unknown,
): value is TechnologyUpdateListDTO {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  if (
    rec.today_state !== null &&
    (typeof rec.today_state !== 'string' ||
      !VALID_TECH_UPDATE_STATES.has(rec.today_state))
  ) {
    return false;
  }
  if (typeof rec.generation_pending !== 'boolean') {
    return false;
  }
  if (rec.message !== null && typeof rec.message !== 'string') {
    return false;
  }
  if (!Array.isArray(rec.items) || !rec.items.every(isValidTechnologyUpdateDTO)) {
    return false;
  }
  return true;
}

function isValidTechnologyUpdateViewedDTO(
  value: unknown,
): value is TechnologyUpdateViewedDTO {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    rec.id.trim().length > 0 &&
    rec.viewed === true &&
    typeof rec.viewed_at === 'string' &&
    rec.viewed_at.trim().length > 0
  );
}

/**
 * GET /technology-updates (EP-T01, 200 OK, Gate: read technology_update)
 */
export async function listTechnologyUpdates(
  accessToken: string,
  params?: ListTechnologyUpdatesParams & AuthStateRequestOptions,
): Promise<PaginatedTechnologyUpdatesResponseDTO> {
  const search = new URLSearchParams();
  const normalizedLimit = normalizePositiveLimit(params?.limit);
  if (normalizedLimit !== undefined) {
    search.set('limit', String(normalizedLimit));
  }
  if (params?.cursor) {
    search.set('cursor', params.cursor);
  }
  const qs = search.toString();
  const envelope = await apiFetchEnvelope<unknown>(
    qs ? `/technology-updates?${qs}` : '/technology-updates',
    accessToken,
    {
      ...(params?.timeoutMs !== undefined
        ? { timeoutMs: params.timeoutMs }
        : {}),
      ...(params?.signal ? { signal: params.signal } : {}),
    },
  );
  const payload = envelope.data;
  let listCandidate: unknown = payload;
  let embeddedMeta: unknown;
  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    'data' in payload &&
    !(
      'today_state' in payload &&
      'generation_pending' in payload &&
      'items' in payload
    )
  ) {
    listCandidate = (payload as { data?: unknown }).data;
    embeddedMeta = (payload as { meta?: unknown }).meta;
  } else if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    'meta' in payload
  ) {
    embeddedMeta = (payload as { meta?: unknown }).meta;
  }

  if (!isValidTechnologyUpdateListDTO(listCandidate)) {
    throwInvalidTechUpdateResponse(
      'Unexpected technology updates list response format.',
    );
  }

  return {
    data: {
      today_state: listCandidate.today_state,
      generation_pending: listCandidate.generation_pending,
      message: listCandidate.message,
      items: listCandidate.items,
    },
    meta:
      parsePageMeta(envelope.meta) ??
      parsePageMeta(embeddedMeta) ?? {
        limit: normalizedLimit ?? 20,
        next_cursor: null,
      },
  };
}

/**
 * GET /technology-updates/:id (EP-T02, 200 OK, Gate: read technology_update)
 */
export async function getTechnologyUpdate(
  accessToken: string,
  id: string,
  options?: AuthStateRequestOptions,
): Promise<TechnologyUpdateDTO> {
  const data = await apiFetch<unknown>(
    `/technology-updates/${encodeURIComponent(id.trim())}`,
    accessToken,
    {
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
  if (!isValidTechnologyUpdateDTO(data)) {
    throwInvalidTechUpdateResponse(
      'Unexpected technology update detail response format.',
    );
  }
  return data;
}

/**
 * POST /technology-updates/:id/view (EP-T03, 200 OK, Gate: read technology_update)
 */
export async function markTechnologyUpdateViewed(
  accessToken: string,
  id: string,
  options?: AuthStateRequestOptions,
): Promise<TechnologyUpdateViewedDTO> {
  const data = await apiFetch<unknown>(
    `/technology-updates/${encodeURIComponent(id.trim())}/view`,
    accessToken,
    {
      method: 'POST',
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
  if (!isValidTechnologyUpdateViewedDTO(data)) {
    throwInvalidTechUpdateResponse(
      'Unexpected technology update view response format.',
    );
  }
  return data;
}

/* -------------------------------------------------------------------------- */
/* M12 Quality Feedback API — Ratings & Reports (EP-F01, EP-F02, C05 §15.11)  */
/* -------------------------------------------------------------------------- */

export type RatingTarget =
  | 'roadmap_draft'
  | 'roadmap_merge'
  | 'topic_content'
  | 'technology_update';

export type ReportTarget =
  | 'quiz_question'
  | 'practice_review'
  | 'topic_content'
  | 'roadmap_content';

export type ReportReason =
  | 'incorrect'
  | 'unclear'
  | 'unfair_scoring'
  | 'inappropriate'
  | 'outdated'
  | 'other';

export type RatingRequestDTO = {
  target_type: RatingTarget;
  target_id: string;
  score: number;
  comment?: string;
};

export type RatingResponseDTO = {
  target_type: RatingTarget;
  target_id: string;
  score: number;
};

export type ReportRequestDTO = {
  target_type: ReportTarget;
  target_id: string;
  reason: ReportReason;
  comment?: string;
};

export type ReportResponseDTO = {
  report_id: string;
  status: 'received';
};

const VALID_RATING_TARGETS: ReadonlySet<string> = new Set([
  'roadmap_draft',
  'roadmap_merge',
  'topic_content',
  'technology_update',
]);

function throwInvalidFeedbackResponse(message: string): never {
  throw new ApiError(502, message, 'INVALID_RESPONSE', undefined, [], true);
}

function isValidRatingResponseDTO(
  value: unknown,
): value is RatingResponseDTO {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.target_type === 'string' &&
    VALID_RATING_TARGETS.has(rec.target_type) &&
    typeof rec.target_id === 'string' &&
    rec.target_id.trim().length > 0 &&
    typeof rec.score === 'number' &&
    Number.isInteger(rec.score) &&
    rec.score >= 1 &&
    rec.score <= 5
  );
}

function isValidReportResponseDTO(
  value: unknown,
): value is ReportResponseDTO {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.report_id === 'string' &&
    rec.report_id.trim().length > 0 &&
    rec.status === 'received'
  );
}

/**
 * POST /ratings (EP-F01, 200 OK, AZ-USER, Gate: none)
 */
export async function submitRating(
  accessToken: string,
  payload: RatingRequestDTO,
  options?: AuthStateRequestOptions,
): Promise<RatingResponseDTO> {
  const data = await apiFetch<unknown>('/ratings', accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
    ...(options?.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!isValidRatingResponseDTO(data)) {
    throwInvalidFeedbackResponse('Unexpected rating response format.');
  }
  return data;
}

/**
 * POST /reports (EP-F02, 201 Created, AZ-USER, Gate: none)
 */
export async function submitReport(
  accessToken: string,
  payload: ReportRequestDTO,
  options?: AuthStateRequestOptions,
): Promise<ReportResponseDTO> {
  const data = await apiFetch<unknown>('/reports', accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
    ...(options?.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!isValidReportResponseDTO(data)) {
    throwInvalidFeedbackResponse('Unexpected report response format.');
  }
  return data;
}

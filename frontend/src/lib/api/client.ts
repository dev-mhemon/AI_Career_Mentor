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

/** Success envelope pieces: `data` plus optional top-level `meta` (e.g. EP-C02 `PageMetaDTO`). */
interface ApiEnvelope<T> {
  data: T;
  meta: unknown;
}

async function apiFetch<T>(
  path: string,
  accessToken: string | null,
  options: ApiFetchOptions = {},
): Promise<T> {
  return (await apiFetchEnvelope<T>(path, accessToken, options)).data;
}

async function apiFetchEnvelope<T>(
  path: string,
  accessToken: string | null,
  options: ApiFetchOptions = {},
): Promise<ApiEnvelope<T>> {
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
    const details: FieldError[] =
      response.status < 500 && Array.isArray(error?.details)
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
    const headerRetry = response.headers?.get('Retry-After');
    const retryValue =
      error?.retryAfterSeconds ??
      (headerRetry && /^\d+$/.test(headerRetry) ? Number(headerRetry) : null);
    const retryAfterSeconds = Number.isInteger(retryValue) && retryValue >= 0 ? retryValue : null;
    const message =
      response.status >= 500
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
  if (body?.success !== true || !('data' in body))
    throw new ApiError(502, 'Invalid backend response', 'INVALID_RESPONSE');
  return { data: body.data as T, meta: body.meta ?? null };
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

export interface ResetPasswordResponse {
  password_reset: true;
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

export interface ProfileSkillDTO {
  skill_id: string;
  name: string;
  alias_resolved: boolean;
  learning_state: 'not_started' | 'learning' | 'practicing' | 'proficient';
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
export function getProfile(accessToken: string): Promise<ProfileResponse> {
  return apiFetch<ProfileResponse>('/profile', accessToken);
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

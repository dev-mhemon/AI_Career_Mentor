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

async function apiFetch<T>(
  path: string,
  accessToken: string | null,
  options: RequestInit = {},
): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new NetworkError('Unable to reach the server. Please try again.');
  }

  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
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
  return body.data as T;
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

/**
 * GET /auth/me
 * Returns the current application-level user (role, status).
 */
export async function getMe(accessToken: string): Promise<UserResponse> {
  const data = await apiFetch<{ user: UserResponse }>('/auth/me', accessToken);
  return data.user;
}

/**
 * GET /auth/me (EP-A13)
 * Returns the full current-user metadata including `effective_access`, `profile_complete`, `focus_roadmap_id`, and `can_delete_account`.
 */
export async function getCurrentUserState(
  accessToken: string,
): Promise<CurrentUserStateResponse> {
  const data = await apiFetch< Partial<CurrentUserStateResponse> & { user: UserResponse } >(
    '/auth/me',
    accessToken,
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

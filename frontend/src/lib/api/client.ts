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

/**
 * GET /auth/me
 * Returns the current application-level user (role, status).
 */
export async function getMe(accessToken: string): Promise<UserResponse> {
  const data = await apiFetch<{ user: UserResponse }>('/auth/me', accessToken);
  return data.user;
}

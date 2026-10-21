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

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Unauthorized") {
    super(401, message);
    this.name = "UnauthorizedError";
  }
}

export class NetworkError extends Error {
  constructor(message = "Network request failed") {
    super(message);
    this.name = "NetworkError";
  }
}

// ─── Backend Response Types ───────────────────────────────────

export interface UserResponse {
  id: string;
  email: string | null;
  phone: string | null;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  created_at: string;
  updated_at: string;
}

// ─── Core Fetch Wrapper ──────────────────────────────────────

async function apiFetch<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
    });
  } catch {
    throw new NetworkError(
      `Failed to reach backend at ${url}. Is the server running?`,
    );
  }

  if (response.status === 401) {
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    let message: string;
    try {
      const body = await response.json();
      message = body.message || body.error || response.statusText;
    } catch {
      message = response.statusText;
    }
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

// ─── Auth API Functions ──────────────────────────────────────

/**
 * POST /auth/sync
 * Syncs the authenticated Supabase user to the local NestJS database.
 */
export async function syncUser(accessToken: string): Promise<UserResponse> {
  return apiFetch<UserResponse>("/auth/sync", accessToken, {
    method: "POST",
  });
}

/**
 * GET /auth/me
 * Returns the current application-level user (role, status).
 */
export async function getMe(accessToken: string): Promise<UserResponse> {
  return apiFetch<UserResponse>("/auth/me", accessToken);
}

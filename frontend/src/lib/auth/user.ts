import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getMe,
  getCurrentUserState,
  UnauthorizedError,
  type UserResponse,
  type CurrentUserStateResponse,
} from '@/lib/api/client';

/**
 * Full account and effective-access state returned by EP-A13 (`GET /api/v1/auth/me`).
 */
export type AppSessionState = CurrentUserStateResponse;

/**
 * Discriminated result of resolving a session in read-only Server Components.
 * Distinguishes unauthenticated states from transient backend failures.
 */
export type ReadOnlySessionResult<T> =
  | { status: 'authenticated'; data: T }
  | { status: 'unauthenticated'; data: null }
  | { status: 'transient_error'; data: null; error: unknown };

/**
 * Checks whether a session or JWT access token is expired without triggering auto-refresh.
 * Inspects numeric `expires_at` (epoch seconds) and JWT `exp` payload claim.
 */
export function isSessionExpired(session: {
  expires_at?: number;
  access_token?: string;
}): boolean {
  if (typeof session.expires_at === 'number' && session.expires_at > 0) {
    return session.expires_at <= Math.floor(Date.now() / 1000);
  }
  if (session.access_token && typeof session.access_token === 'string') {
    const parts = session.access_token.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(
          Buffer.from(parts[1], 'base64url').toString('utf8'),
        );
        if (typeof payload.exp === 'number' && payload.exp > 0) {
          return payload.exp <= Math.floor(Date.now() / 1000);
        }
      } catch {
        return true;
      }
    }
  }
  return false;
}

/**
 * Executes a read-only authenticated request against the backend auth endpoints.
 *
 * In Next.js Server Components, cookies are strictly read-only; attempts to rotate tokens,
 * call setSession, or call signOut cannot persist cookie mutations to the browser response.
 * Token rotation and session lifetime management are strictly handled by Edge Proxy
 * (`frontend/src/proxy.ts`) and Server Actions (`frontend/src/lib/auth/actions.ts`).
 *
 * Uses `createSupabaseServerClient({ readOnly: true })` with `autoRefreshToken: false`
 * and checks token expiry before calling the fetcher so expired sessions return
 * `unauthenticated` without stranding rotated tokens in swallowed cookie writes.
 *
 * Distinguishes:
 *  - 'authenticated': valid session and successful backend response
 *  - 'unauthenticated': missing session, expired session, or 401 UnauthorizedError
 *  - 'transient_error': valid non-expired session, but backend threw 5xx, 429, or network error
 */
async function fetchReadOnlySession<T>(
  fetcher: (accessToken: string) => Promise<T>,
): Promise<ReadOnlySessionResult<T>> {
  try {
    const supabase = await createSupabaseServerClient({ readOnly: true });
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { status: 'unauthenticated', data: null };
    }

    if (isSessionExpired(session)) {
      return { status: 'unauthenticated', data: null };
    }

    try {
      const data = await fetcher(session.access_token);
      return { status: 'authenticated', data };
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return { status: 'unauthenticated', data: null };
      }
      return { status: 'transient_error', data: null, error: err };
    }
  } catch (err) {
    return { status: 'transient_error', data: null, error: err };
  }
}

/**
 * Retrieves the authenticated user's full EP-A13 (`GET /api/v1/auth/me`) account and effective-access state,
 * with explicit status discrimination (authenticated, unauthenticated, transient_error).
 */
export async function getAppSessionStateResult(): Promise<ReadOnlySessionResult<AppSessionState>> {
  return fetchReadOnlySession((accessToken) =>
    getCurrentUserState(accessToken),
  );
}

/**
 * Retrieves the authenticated user's application status from NestJS (`GET /api/v1/auth/me`),
 * with explicit status discrimination (authenticated, unauthenticated, transient_error).
 */
export async function getAppUserResult(): Promise<ReadOnlySessionResult<UserResponse>> {
  return fetchReadOnlySession((accessToken) => getMe(accessToken));
}

/**
 * Backward-compatible helper retrieving the authenticated user's full EP-A13 account state.
 * Returns null on unauthenticated or transient error states without cookie mutations.
 * In route layouts and settings pages, prefer `getAppSessionStateResult()` to surface transient outages.
 */
export async function getAppSessionState(): Promise<AppSessionState | null> {
  const result = await getAppSessionStateResult();
  return result.status === 'authenticated' ? result.data : null;
}

/**
 * Backward-compatible helper retrieving the authenticated user's application status from NestJS.
 * Returns null on unauthenticated or transient error states without cookie mutations.
 * In route layouts and dashboards, prefer `getAppUserResult()` to surface transient outages.
 */
export async function getAppUser(): Promise<UserResponse | null> {
  const result = await getAppUserResult();
  return result.status === 'authenticated' ? result.data : null;
}

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getMe,
  getCurrentUserState,
  refreshSession,
  UnauthorizedError,
  type UserResponse,
  type CurrentUserStateResponse,
} from '@/lib/api/client';

/**
 * Full account and effective-access state returned by EP-A13 (`GET /api/v1/auth/me`).
 */
export type AppSessionState = CurrentUserStateResponse;

/**
 * Executes an authenticated read against `/auth/me` with at most one canonical EP-A07 refresh retry on 401.
 * Only signs out on explicit 401 / UnauthorizedError after a failed refresh — transient errors (5xx, 429,
 * network) return `null` without destroying the session, preventing accidental sign-out on flaky networks.
 */
async function fetchWithSingleRefresh<T>(
  fetcher: (accessToken: string) => Promise<T>,
): Promise<T | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return null;
    }

    try {
      return await fetcher(session.access_token);
    } catch (err) {
      /* Only retry on 401 Unauthorized — transient errors return null without sign-out. */
      if (!(err instanceof UnauthorizedError)) {
        return null;
      }

      if (!session.refresh_token) {
        await supabase.auth.signOut().catch(() => undefined);
        return null;
      }

      try {
        const refreshed = await refreshSession(session.refresh_token);
        const { error } = await supabase.auth.setSession({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
        });
        if (error) {
          await supabase.auth.signOut().catch(() => undefined);
          return null;
        }
        return await fetcher(refreshed.access_token);
      } catch (refreshErr) {
        /* Sign out only on auth rejection (401) during refresh — transient errors preserve session. */
        if (refreshErr instanceof UnauthorizedError) {
          await supabase.auth.signOut().catch(() => undefined);
        }
        return null;
      }
    }
  } catch {
    return null;
  }
}

/**
 * Retrieves the authenticated user's full EP-A13 (`GET /api/v1/auth/me`) account and effective-access state.
 * Performs at most one refresh per 401 and signs out cleanly on auth failure only.
 */
export async function getAppSessionState(): Promise<AppSessionState | null> {
  return fetchWithSingleRefresh((accessToken) =>
    getCurrentUserState(accessToken),
  );
}

/**
 * Retrieves the authenticated user's application status from NestJS (`GET /api/v1/auth/me`).
 * Performs at most one refresh per 401 and signs out cleanly on auth failure only.
 */
export async function getAppUser(): Promise<UserResponse | null> {
  return fetchWithSingleRefresh((accessToken) => getMe(accessToken));
}

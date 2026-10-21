import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMe, type UserResponse } from "@/lib/api/client";

/**
 * Retrieves the authenticated user's application status from NestJS.
 *
 * Used by Server Components to enforce business-level route guards:
 *  - /dashboard layout redirects unauthenticated users to /login
 *  - /login page redirects authenticated users to /dashboard
 *
 * Returns null if the user is not authenticated or if the backend
 * call fails. The calling Server Component decides what to do.
 */
export async function getAppUser(): Promise<UserResponse | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return null;
    }

    const user = await getMe(session.access_token);
    return user;
  } catch {
    return null;
  }
}

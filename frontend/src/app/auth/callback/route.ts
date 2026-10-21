import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { syncUser, getMe } from "@/lib/api/client";

/**
 * OAuth callback route handler.
 *
 * Flow:
 *   1. Exchange the auth code for a Supabase session
 *   2. POST /api/auth/sync to create/update local user
 *   3. GET /api/auth/me to determine application status
 *   4. Redirect to /dashboard
 *
 * On failure, redirects to /login?error=oauth_failed.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }

  try {
    const supabase = await createSupabaseServerClient();

    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      console.error("OAuth code exchange failed:", exchangeError.message);
      return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
    }

    // Get the fresh session
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
    }

    // Sync user to backend
    await syncUser(session.access_token);

    // Get application status to ensure user is active (could handle SUSPENDED here if desired)
    // For MVP we just redirect to dashboard which has its own checks
    await getMe(session.access_token);

    return NextResponse.redirect(`${origin}/dashboard`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    if (err instanceof Error) {
      if (err.name === 'ApiError' || err.name === 'NetworkError') {
        return NextResponse.redirect(`${origin}/login?error=sync_failed`);
      }
    }
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }
}

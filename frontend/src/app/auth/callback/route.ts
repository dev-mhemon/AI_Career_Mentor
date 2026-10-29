import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { approveOAuthSession, ApiError, NetworkError } from "@/lib/api/client";

async function safeSignOut(
  supabase: {
    auth: {
      signOut: (options?: { scope?: "global" | "local" | "others" }) => unknown;
    };
  } | null,
) {
  if (!supabase) return;
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Auth callback route handler.
 *
 * Flow:
 *   1. Reject missing code -> /login?error=oauth_failed
 *   2. Identify flow branch:
 *      a) OAuth branch: ?provider=google | facebook
 *         - Exchange auth code for Supabase session
 *         - Validate that user.identities contains the requested provider
 *         - POST /api/v1/auth/oauth/session with { provider } to approve session
 *         - Redirect per C05 OAuth next_step
 *      b) Legacy / transitional email confirmation branch: flow=email or no provider param
 *         - Exchange auth code so GoTrue confirms email
 *         - Clean up unapproved local session via signOut({ scope: 'local' })
 *         - Redirect to /login?verified=true for canonical password login
 *      c) Invalid provider param -> /login?error=oauth_failed without code exchange
 *
 * On any failure, cleans up the local session via signOut({ scope: 'local' })
 * and redirects to /login?error=oauth_failed (or sync_failed).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const queryProvider = searchParams.get("provider");
  const flow = searchParams.get("flow");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }

  // If provider is explicitly specified but unsupported, reject immediately
  if (
    queryProvider &&
    queryProvider !== "google" &&
    queryProvider !== "facebook"
  ) {
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }

  const isOAuthFlow =
    flow !== "email" &&
    (queryProvider === "google" || queryProvider === "facebook");
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null =
    null;

  try {
    supabase = await createSupabaseServerClient();

    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      console.error("Auth code exchange failed");
      await safeSignOut(supabase);
      return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
    }

    if (isOAuthFlow) {
      const provider = queryProvider as "google" | "facebook";

      // Get the fresh session
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        await safeSignOut(supabase);
        return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
      }

      // Validate that a matching identity exists on the user (identities only, no app_metadata)
      const hasMatchingIdentity = session.user.identities?.some(
        (i) => i.provider === provider,
      );
      if (!hasMatchingIdentity) {
        await safeSignOut(supabase);
        return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
      }

      const approved = await approveOAuthSession(session.access_token, provider);
      const destination =
        approved.user.status === "suspended"
          ? "/dashboard"
          : approved.next_step === "add_verified_contact"
            ? "/dashboard?prompt=verify_contact"
            : approved.next_step === "profile_setup"
              ? "/dashboard?next_step=profile_setup"
              : "/dashboard";

      return NextResponse.redirect(`${origin}${destination}`);
    }

    // Branch B: Transitional email confirmation callback (flow=email or no provider query param)
    // GoTrue has recorded email confirmation from exchangeCodeForSession.
    // Clean up unapproved local session so canonical EP-A05 login can establish approved session.
    await safeSignOut(supabase);
    return NextResponse.redirect(`${origin}/login?verified=true`);
  } catch (err) {
    console.error("Auth callback failed");
    await safeSignOut(supabase);
    if (
      err instanceof ApiError ||
      err instanceof NetworkError ||
      (err instanceof Error &&
        (err.name === "ApiError" || err.name === "NetworkError"))
    ) {
      return NextResponse.redirect(`${origin}/login?error=sync_failed`);
    }
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }
}

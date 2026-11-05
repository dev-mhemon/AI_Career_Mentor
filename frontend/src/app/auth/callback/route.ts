import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  approveOAuthSession,
  linkSocialIdentity,
  ApiError,
  NetworkError,
} from "@/lib/api/client";

/**
 * Safely signs out the local Supabase session, suppressing any errors.
 */
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
 * Auth callback route handler for OAuth sign-in and social identity linking.
 *
 * Flow:
 *   1. Reject missing code -> /settings?error=link_failed (flow=link) or /login?error=oauth_failed
 *   2. Identify flow branch:
 *      a) OAuth branch: ?provider=google | facebook
 *         - Exchange auth code for Supabase session
 *         - Validate that user.identities contains the requested provider
 *         - For flow=link: approve OAuth session and link identity -> /settings?linked=<provider> (or /settings?error=link_failed)
 *         - For standard sign-in: approve OAuth session and redirect per status/next_step (suspended -> /settings, add_verified_contact -> /settings?prompt=verify_contact)
 *      b) Legacy / transitional email confirmation branch: flow=email or no provider param
 *         - Exchange auth code so GoTrue confirms email
 *         - Clean up unapproved local session via signOut({ scope: 'local' })
 *         - Redirect to /login?verified=true for canonical password login
 *      c) Invalid provider param or flow=link without provider -> /settings?error=link_failed (flow=link) or /login?error=oauth_failed
 *
 * On any failure during sign-in, cleans up the local session via signOut({ scope: 'local' })
 * and redirects to /login?error=oauth_failed (or sync_failed). Flow=link failures preserve existing session.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const queryProvider = searchParams.get("provider");
  const flow = searchParams.get("flow");

  if (!code) {
    if (flow === "link") {
      return NextResponse.redirect(`${origin}/settings?error=link_failed`);
    }
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }

  // If provider is explicitly specified but unsupported, or flow is link without provider, reject immediately
  if (
    (queryProvider &&
      queryProvider !== "google" &&
      queryProvider !== "facebook") ||
    (flow === "link" && !queryProvider)
  ) {
    if (flow === "link") {
      return NextResponse.redirect(`${origin}/settings?error=link_failed`);
    }
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
      if (flow === "link") {
        return NextResponse.redirect(`${origin}/settings?error=link_failed`);
      }
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
        if (flow === "link") {
          return NextResponse.redirect(`${origin}/settings?error=link_failed`);
        }
        await safeSignOut(supabase);
        return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
      }

      // Validate that a matching identity exists on the user (identities only, no app_metadata)
      const hasMatchingIdentity = session.user.identities?.some(
        (i) => i.provider === provider,
      );
      if (!hasMatchingIdentity) {
        if (flow === "link") {
          return NextResponse.redirect(`${origin}/settings?error=link_failed`);
        }
        await safeSignOut(supabase);
        return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
      }

      if (flow === "link") {
        try {
          await approveOAuthSession(session.access_token, provider);
          await linkSocialIdentity(session.access_token, provider);
          return NextResponse.redirect(
            `${origin}/settings?linked=${provider}`,
          );
        } catch {
          return NextResponse.redirect(
            `${origin}/settings?error=link_failed`,
          );
        }
      }

      const approved = await approveOAuthSession(
        session.access_token,
        provider,
      );
      const destination =
        approved.user.status === "suspended"
          ? "/settings"
          : approved.next_step === "add_verified_contact"
            ? "/settings?prompt=verify_contact"
            : approved.next_step === "profile_setup"
              ? "/onboarding/profile"
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
    if (flow === "link") {
      return NextResponse.redirect(`${origin}/settings?error=link_failed`);
    }
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

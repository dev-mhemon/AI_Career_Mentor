import { createBrowserClient } from "@supabase/ssr";

/**
 * Creates a Supabase client configured for browser-side use.
 *
 * In Phase 1 this is used exclusively for triggering OAuth redirects
 * (signInWithOAuth) which require a browser context to navigate
 * to the external provider consent screen.
 *
 * Email/password authentication is handled via Server Actions using
 * the server client — the browser client does NOT handle those flows.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

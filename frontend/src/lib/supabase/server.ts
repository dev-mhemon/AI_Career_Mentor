import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Creates a Supabase client configured for server-side use
 * (Server Components, Server Actions, Route Handlers).
 *
 * Uses HttpOnly cookies via next/headers for secure session storage.
 * The cookie adapter reads/writes through the Next.js cookie API.
 *
 * This client is NOT a singleton — call it per-request to get
 * a fresh cookie-bound instance.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll can throw in Server Components where cookies
            // are read-only. This is expected and safe — the Proxy
            // handles session refresh for those requests.
          }
        },
      },
    },
  );
}

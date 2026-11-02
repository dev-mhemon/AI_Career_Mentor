import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Creates a Supabase client configured for server-side use
 * (Server Components, Server Actions, Route Handlers).
 *
 * Uses HttpOnly cookies via next/headers for secure session storage.
 * When `options.readOnly` is true, suppresses cookie write operations and intercepts
 * `/auth/v1/token` endpoint requests with a non-retryable response so token rotation
 * cannot be triggered during Server Component renders. Edge Proxy (`frontend/src/proxy.ts`)
 * remains the sole token refresh authority.
 *
 * This client is NOT a singleton — call it per-request to get
 * a fresh cookie-bound instance.
 */
export async function createSupabaseServerClient(options?: { readOnly?: boolean }) {
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
          if (options?.readOnly) {
            return;
          }
          try {
            cookiesToSet.forEach(({ name, value, options: cookieOptions }) =>
              cookieStore.set(name, value, cookieOptions),
            );
          } catch {
            // setAll can throw in Server Components where cookies
            // are read-only. This is expected and safe — the Proxy
            // handles session refresh for those requests.
          }
        },
      },
      global: {
        fetch: options?.readOnly
          ? (input, init) => {
              const urlStr =
                typeof input === "string"
                  ? input
                  : input instanceof URL
                    ? input.toString()
                    : (input as Request).url;
              if (urlStr.includes("/auth/v1/token")) {
                // In read-only Server Components, prevent token rotation requests that
                // would strand rotated refresh tokens in swallowed setAll cookie writes.
                return Promise.resolve(
                  new Response(
                    JSON.stringify({
                      error: "read_only_mode",
                      error_description:
                        "Token refresh is forbidden in read-only Server Components",
                    }),
                    {
                      status: 400,
                      headers: { "Content-Type": "application/json" },
                    },
                  ),
                );
              }
              return fetch(input, init);
            }
          : fetch,
      },
    },
  );
}

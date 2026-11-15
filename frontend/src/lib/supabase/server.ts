import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  createTimedAbortSignal,
  DEFAULT_AUTH_STATE_TIMEOUT_MS,
} from "@/lib/api/client";
import {
  applyRememberPreference,
  buildRememberMeCookie,
  REMEMBER_ME_COOKIE,
  resolveRememberCookieValue,
} from "./remember";

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
export async function createSupabaseServerClient(options?: {
  readOnly?: boolean;
  rememberMe?: boolean;
}) {
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
            const rememberCookie =
              typeof cookieStore.get === "function"
                ? cookieStore.get(REMEMBER_ME_COOKIE)?.value
                : undefined;
            const effectiveRememberMe =
              options?.rememberMe ?? resolveRememberCookieValue(rememberCookie);

            cookiesToSet.forEach(({ name, value, options: cookieOptions }) => {
              cookieStore.set(
                name,
                value,
                applyRememberPreference(
                  value,
                  cookieOptions,
                  effectiveRememberMe,
                ),
              );
            });
            const renewedRememberCookie = buildRememberMeCookie(
              effectiveRememberMe,
              cookiesToSet,
            );
            if (renewedRememberCookie) {
              cookieStore.set(
                renewedRememberCookie.name,
                renewedRememberCookie.value,
                renewedRememberCookie.options,
              );
            }
          } catch {
            // setAll can throw in Server Components where cookies
            // are read-only. This is expected and safe — the Proxy
            // handles session refresh for those requests.
          }
        },
      },
      global: {
        fetch: options?.readOnly
          ? async (input, init) => {
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
              const { signal, cleanup } = createTimedAbortSignal(
                DEFAULT_AUTH_STATE_TIMEOUT_MS,
                init?.signal,
              );
              try {
                const response = await fetch(input, { ...init, signal });
                if (
                  response.body === null ||
                  response.status === 204 ||
                  response.status === 205 ||
                  response.status === 304
                ) {
                  return response;
                }
                const bodyBuffer = await new Promise<ArrayBuffer>(
                  (resolve, reject) => {
                    if (signal.aborted) {
                      void response.body
                        ?.cancel(signal.reason)
                        .catch(() => undefined);
                      reject(signal.reason);
                      return;
                    }
                    const onAbort = () => {
                      void response.body
                        ?.cancel(signal.reason)
                        .catch(() => undefined);
                      reject(signal.reason);
                    };
                    signal.addEventListener("abort", onAbort, { once: true });
                    response.arrayBuffer().then(
                      (buf) => {
                        signal.removeEventListener("abort", onAbort);
                        resolve(buf);
                      },
                      (err) => {
                        signal.removeEventListener("abort", onAbort);
                        reject(err);
                      },
                    );
                  },
                );
                return new Response(bodyBuffer, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                });
              } finally {
                cleanup();
              }
            }
          : fetch,
      },
    },
  );
}

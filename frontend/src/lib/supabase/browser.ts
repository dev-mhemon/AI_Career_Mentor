import { createBrowserClient } from "@supabase/ssr";
import {
  applyRememberPreference,
  REMEMBER_ME_COOKIE,
  resolveRememberCookieValue,
} from "./remember";

function parseDocumentCookies(
  cookieHeader: string,
): Array<{ name: string; value: string }> {
  if (!cookieHeader) return [];
  const result: Array<{ name: string; value: string }> = [];
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    const rawVal = trimmed.slice(eqIdx + 1).trim();
    if (!name) continue;
    let value = rawVal;
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      value = decodeURIComponent(value);
    } catch {
      // Keep raw value if not URI-encoded
    }
    result.push({ name, value });
  }
  return result;
}

function serializeBrowserCookie(
  name: string,
  value: string,
  options?: {
    domain?: string;
    expires?: Date | string;
    maxAge?: number;
    path?: string;
    sameSite?: boolean | "lax" | "strict" | "none";
    secure?: boolean;
  },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options?.maxAge !== undefined && Number.isFinite(options.maxAge)) {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }
  if (options?.domain) {
    parts.push(`Domain=${options.domain}`);
  }
  parts.push(`Path=${options?.path || "/"}`);
  if (options?.expires) {
    const exp =
      options.expires instanceof Date
        ? options.expires.toUTCString()
        : new Date(options.expires).toUTCString();
    parts.push(`Expires=${exp}`);
  }
  if (options?.sameSite) {
    const ss =
      options.sameSite === true
        ? "Strict"
        : `${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1).toLowerCase()}`;
    parts.push(`SameSite=${ss}`);
  }
  if (options?.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

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
    {
      cookies: {
        getAll() {
          if (typeof document === "undefined") return [];
          return parseDocumentCookies(document.cookie);
        },
        setAll(cookiesToSet) {
          if (typeof document === "undefined") return;
          const existing = parseDocumentCookies(document.cookie);
          const rememberPref = resolveRememberCookieValue(
            existing.find((c) => c.name === REMEMBER_ME_COOKIE)?.value,
          );
          cookiesToSet.forEach(({ name, value, options }) => {
            const nextOptions = applyRememberPreference(
              value,
              options,
              rememberPref,
            );
            document.cookie = serializeBrowserCookie(name, value, nextOptions);
          });
        },
      },
    },
  );
}

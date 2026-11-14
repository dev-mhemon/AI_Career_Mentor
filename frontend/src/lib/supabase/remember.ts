export const REMEMBER_ME_COOKIE = "mentor_remember_me";
export const LEGACY_REMEMBER_COOKIE = "auth_remember";
export const REMEMBER_ME_MAX_AGE = 60 * 60 * 24 * 30;

export interface RememberCookiePayload {
  name: string;
  value: "1" | "0";
  options: {
    httpOnly: false;
    path: "/";
    sameSite: "lax";
    maxAge?: number;
    secure?: boolean;
  };
}

export function resolveRememberCookieValue(
  raw: string | undefined,
): boolean | undefined {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return undefined;
}

export function applyRememberPreference<
  T extends { maxAge?: number; expires?: Date | string },
>(
  value: string,
  options: T | undefined,
  pref: boolean | undefined,
): T | undefined {
  if (!value || pref === undefined) {
    return options;
  }
  if (pref === true) {
    return { ...options, maxAge: REMEMBER_ME_MAX_AGE } as T;
  }
  const sessionOptions = { ...options } as T;
  delete sessionOptions.maxAge;
  delete sessionOptions.expires;
  return sessionOptions;
}

/**
 * Re-emits `mentor_remember_me` alongside refreshed auth cookies so its 30-day
 * expiry slides with the session instead of lapsing while auth stays alive.
 */
export function buildRememberMeCookie(
  pref: boolean | undefined,
  cookiesToSet: ReadonlyArray<{
    name: string;
    value: string;
    options?: { secure?: boolean };
  }>,
): RememberCookiePayload | null {
  if (pref === undefined) {
    return null;
  }
  if (cookiesToSet.some((cookie) => cookie.name === REMEMBER_ME_COOKIE)) {
    return null;
  }
  const refreshedCookies = cookiesToSet.filter((cookie) => Boolean(cookie.value));
  if (refreshedCookies.length === 0) {
    return null;
  }
  const useSecure = refreshedCookies.some(
    (cookie) => cookie.options?.secure === true,
  );
  return {
    name: REMEMBER_ME_COOKIE,
    value: pref ? "1" : "0",
    options: {
      httpOnly: false,
      path: "/",
      sameSite: "lax",
      ...(pref ? { maxAge: REMEMBER_ME_MAX_AGE } : {}),
      ...(useSecure ? { secure: true } : {}),
    },
  };
}

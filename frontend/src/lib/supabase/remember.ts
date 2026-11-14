export const REMEMBER_ME_COOKIE = "mentor_remember_me";
export const LEGACY_REMEMBER_COOKIE = "auth_remember";
export const REMEMBER_ME_MAX_AGE = 60 * 60 * 24 * 30;

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

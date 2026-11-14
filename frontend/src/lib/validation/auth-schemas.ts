/** Shared client-side validation. Mirrors PRD §10 and backend rules; server stays authoritative. */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const BD_PHONE_RE = /^(?:(?:\+?88)?0)?(1[3-9]\d{8})$/;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const GOAL_MIN = 3;
export const GOAL_MAX = 300;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateEmail(raw: string): Result<string> {
  const value = normalizeEmail(raw);
  if (!value) return { ok: false, error: 'Enter your email address.' };
  if (value.length > 254 || value.includes('..') || !EMAIL_RE.test(value))
    return { ok: false, error: 'Enter a valid email address.' };
  return { ok: true, value };
}

/** Strip spaces/dashes/parens; accept 01..., 1..., 8801..., +8801...; return canonical +8801XXXXXXXXX or null. */
export function normalizeBdPhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-()]/g, '');
  const m = BD_PHONE_RE.exec(compact);
  if (!m) return null;
  return `+880${m[1]}`;
}

/**
 * Formats a Bangladesh phone input for visible display without ever prepending `+880`.
 * Strips non-digits and strips pasted `+880`/`880` country code into local `01...` format.
 */
export function sanitizeBdPhoneDisplay(raw: string): string {
  const trimmed = raw.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');
  const hadCountryPlus = trimmed.startsWith('+880');
  if (hadCountryPlus || /^8800?1/.test(digitsOnly)) {
    const withoutCc = digitsOnly.slice(3);
    if (!withoutCc) return '';
    if (withoutCc.startsWith('1')) return `0${withoutCc}`;
    if (withoutCc.startsWith('01')) return withoutCc;
    return withoutCc;
  }
  return digitsOnly;
}

export function validateBdPhone(raw: string): Result<string> {
  if (!raw.trim()) return { ok: false, error: 'Enter your phone number.' };
  const value = normalizeBdPhone(raw);
  if (!value) {
    return {
      ok: false,
      error: 'Enter a valid Bangladesh mobile number (e.g. 01712345678)',
    };
  }
  return { ok: true, value };
}

/** Real-time BD phone validator: catches non-digits, invalid prefix, and >11 digits while typing. */
export function validateBdPhoneLive(raw: string, requireComplete = false): Result<string> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return requireComplete
      ? { ok: false, error: 'Enter your phone number.' }
      : { ok: true, value: '' };
  }

  if (requireComplete) return validateBdPhone(trimmed);

  const withoutPlusPrefix = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
  if (/[^\d\s\-()]/.test(withoutPlusPrefix)) {
    return {
      ok: false,
      error: 'Enter digits only for a Bangladesh mobile number (e.g. 01712345678).',
    };
  }

  const digits = sanitizeBdPhoneDisplay(trimmed);
  if (!digits) {
    return {
      ok: false,
      error: 'Enter a valid Bangladesh mobile number (e.g. 01712345678)',
    };
  }

  const normalized = normalizeBdPhone(digits);
  if (normalized) return { ok: true, value: normalized };

  if (digits.startsWith('0')) {
    if (digits.length >= 2 && digits[1] !== '1') {
      return {
        ok: false,
        error: 'Bangladesh mobile numbers must start with 01 (e.g. 01712345678).',
      };
    }
    if (digits.length >= 3 && !/[3-9]/.test(digits[2])) {
      return {
        ok: false,
        error: 'Bangladesh mobile prefix must be 013–019 (e.g. 01712345678).',
      };
    }
    if (digits.length > 11) {
      return {
        ok: false,
        error: 'Bangladesh mobile numbers must be 11 digits (e.g. 01712345678).',
      };
    }
    return { ok: true, value: digits };
  }

  if (digits.startsWith('1')) {
    if (digits.length >= 2 && !/[3-9]/.test(digits[1])) {
      return {
        ok: false,
        error: 'Bangladesh mobile prefix must be 013–019 (e.g. 01712345678).',
      };
    }
    if (digits.length > 10) {
      return {
        ok: false,
        error: 'Bangladesh mobile numbers must be 11 digits with leading 0 (e.g. 01712345678).',
      };
    }
    return { ok: true, value: digits };
  }

  return {
    ok: false,
    error: 'Bangladesh mobile numbers must start with 01 (e.g. 01712345678).',
  };
}

/** Shared helper for phone onChange handlers tracking blur-incomplete state. */
export function validateBdPhoneOnChange(
  raw: string,
  wasBlurredIncomplete: boolean,
): { ok: boolean; error?: string; resetBlurred: boolean } {
  if (!raw.trim()) return { ok: true, resetBlurred: true };
  const live = validateBdPhoneLive(raw, false);
  if (!live.ok) return { ok: false, error: live.error, resetBlurred: false };
  if (normalizeBdPhone(raw)) return { ok: true, resetBlurred: false };
  if (wasBlurredIncomplete) {
    const strict = validateBdPhone(raw);
    if (!strict.ok) return { ok: false, error: strict.error, resetBlurred: false };
  }
  return { ok: true, resetBlurred: false };
}

export function validateEmailLive(raw: string): Result<string> {
  if (!raw) return { ok: true, value: '' };
  return validateEmail(raw);
}

export type IdentifierKind = 'email' | 'phone' | 'unknown';

export function detectIdentifier(raw: string): IdentifierKind {
  const s = raw.trim();
  if (!s) return 'unknown';
  if (s.includes('@')) return 'email';
  if (/^[+\d(][\d\s\-()]*$/.test(s) && /\d/.test(s)) return 'phone';
  return 'unknown';
}

export function validateIdentifier(
  raw: string,
): Result<{ kind: 'email' | 'phone'; value: string }> {
  const kind = detectIdentifier(raw);
  if (kind === 'email') {
    const r = validateEmail(raw);
    return r.ok ? { ok: true, value: { kind, value: r.value } } : r;
  }
  if (kind === 'phone') {
    const r = validateBdPhone(raw);
    return r.ok ? { ok: true, value: { kind, value: r.value } } : r;
  }
  return { ok: false, error: 'Enter a valid email address or Bangladesh mobile number.' };
}

/** Shared helper for unified Email-or-Phone onChange handlers. */
export function validateIdentifierOnChange(
  raw: string,
  wasBlurredIncomplete: boolean,
): { ok: boolean; error?: string; resetBlurred: boolean } {
  if (!raw) return { ok: true, resetBlurred: true };
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: 'Enter a valid email address or Bangladesh mobile number.',
      resetBlurred: false,
    };
  }
  if (/^\+(?:8(?:8(?:0)?)?)?$/.test(trimmed) && !wasBlurredIncomplete) {
    return { ok: true, resetBlurred: false };
  }
  if (detectIdentifier(raw) === 'phone') {
    return validateBdPhoneOnChange(raw, wasBlurredIncomplete);
  }
  const email = validateEmail(raw);
  return email.ok
    ? { ok: true, resetBlurred: false }
    : {
        ok: false,
        error: 'Enter a valid email address or Bangladesh mobile number.',
        resetBlurred: false,
      };
}

export function validatePassword(password: string): Result<string> {
  if (password.length < PASSWORD_MIN)
    return { ok: false, error: `Password must be at least ${PASSWORD_MIN} characters.` };
  if (password.length > PASSWORD_MAX)
    return { ok: false, error: `Password must be at most ${PASSWORD_MAX} characters.` };
  return { ok: true, value: password };
}

export function validatePasswordLive(password: string): Result<string> {
  if (!password) return { ok: true, value: '' };
  return validatePassword(password);
}

/** Sign-In password check: avoids leaking 8-char policy hints to unauthenticated callers. */
export function validateLoginPassword(password: string): Result<string> {
  if (!password) return { ok: false, error: 'Enter your password.' };
  if (password.length > PASSWORD_MAX)
    return { ok: false, error: `Password must be at most ${PASSWORD_MAX} characters.` };
  return { ok: true, value: password };
}

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong' };

export function passwordStrength(password: string): PasswordStrength {
  if (password.length < PASSWORD_MIN) return { score: 0, label: 'Too short' };
  let score = 1;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  const s = Math.min(score, 4) as 1 | 2 | 3 | 4;
  return { score: s, label: (['Weak', 'Fair', 'Good', 'Strong'] as const)[s - 1] };
}

export function validatePasswordMatch(password: string, confirm: string): Result<string> {
  if (password !== confirm) return { ok: false, error: 'Passwords do not match.' };
  return { ok: true, value: confirm };
}

export function validateOtp(raw: string): Result<string> {
  const value = raw.trim();
  if (!/^\d{6}$/.test(value)) return { ok: false, error: 'Enter the 6-digit code.' };
  return { ok: true, value };
}

export function validateOtpLive(raw: string): Result<string> {
  if (!raw) return { ok: true, value: '' };
  return validateOtp(raw);
}

export function validateGoal(raw: string): Result<string> {
  const value = raw.trim();
  if (value.length < GOAL_MIN)
    return { ok: false, error: `Goal must be at least ${GOAL_MIN} characters.` };
  if (value.length > GOAL_MAX)
    return { ok: false, error: `Goal must be at most ${GOAL_MAX} characters.` };
  return { ok: true, value };
}

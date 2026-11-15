/**
 * Shared client & server-action validation for Screen 07 Profile Setup (`/onboarding/profile`).
 * Reuses email and Bangladesh phone validators from `./auth-schemas`.
 */

import type { ExperienceLevel } from '@/lib/api/client';
import {
  normalizeEmail,
  validateBdPhone,
  validateEmail,
  type Result,
} from './auth-schemas';

export const FULL_NAME_MIN = 2;
export const FULL_NAME_MAX = 100;
export const CURRENT_ROLE_MIN = 2;
export const CURRENT_ROLE_MAX = 120;
export const EDUCATION_MAX = 160;
export const DAILY_HOURS_MIN = 0.5;
export const DAILY_HOURS_MAX = 12;

export const VALID_EXPERIENCE_LEVELS: readonly ExperienceLevel[] = [
  'beginner',
  'junior',
  'mid',
  'senior',
];

const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;
const DIGITS_ONLY_RE = /^\d+$/;
const DECIMAL_NUMBER_RE = /^\d+(\.\d+)?$/;

export function isNonSyntheticEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  return (
    normalized.length > 0 &&
    !normalized.endsWith('@synthetic.mentor') &&
    !normalized.endsWith('@phone.invalid')
  );
}

/** Trims and collapses internal whitespace into single spaces. */
export function normalizeFullName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function validateFullName(raw: string): Result<string> {
  if (CONTROL_CHAR_RE.test(raw)) {
    return {
      ok: false,
      error: 'Full name cannot contain control characters.',
    };
  }
  const value = normalizeFullName(raw);
  if (!value) {
    return { ok: false, error: 'Enter your full name.' };
  }
  if (value.length < FULL_NAME_MIN) {
    return {
      ok: false,
      error: `Full name must be at least ${FULL_NAME_MIN} characters.`,
    };
  }
  if (value.length > FULL_NAME_MAX) {
    return {
      ok: false,
      error: `Full name must be ${FULL_NAME_MAX} characters or fewer.`,
    };
  }
  if (DIGITS_ONLY_RE.test(value.replace(/\s+/g, ''))) {
    return {
      ok: false,
      error: 'Full name cannot contain only digits.',
    };
  }
  return { ok: true, value };
}

export function validateCurrentRole(raw: string): Result<string> {
  if (CONTROL_CHAR_RE.test(raw)) {
    return {
      ok: false,
      error: 'Current role cannot contain control characters.',
    };
  }
  const value = raw.trim();
  if (!value) {
    return { ok: false, error: 'Enter your current role or profession.' };
  }
  if (value.length < CURRENT_ROLE_MIN || value.length > CURRENT_ROLE_MAX) {
    return {
      ok: false,
      error: `Current role must be between ${CURRENT_ROLE_MIN} and ${CURRENT_ROLE_MAX} characters.`,
    };
  }
  return { ok: true, value };
}

export function validateEducation(raw: string): Result<string> {
  if (CONTROL_CHAR_RE.test(raw)) {
    return {
      ok: false,
      error: 'Education cannot contain control characters.',
    };
  }
  const value = raw.trim();
  if (!value) {
    return { ok: true, value: '' };
  }
  if (value.length > EDUCATION_MAX) {
    return {
      ok: false,
      error: `Education must be ${EDUCATION_MAX} characters or fewer.`,
    };
  }
  return { ok: true, value };
}

export function isValidExperienceLevel(value: string): value is ExperienceLevel {
  return (VALID_EXPERIENCE_LEVELS as readonly string[]).includes(value);
}

export function validateExperienceLevel(raw: string): Result<ExperienceLevel> {
  const value = raw.trim();
  if (!isValidExperienceLevel(value)) {
    return { ok: false, error: 'Select your experience level.' };
  }
  return { ok: true, value };
}

export function isValidIanaTimezone(raw: string): boolean {
  const value = raw.trim();
  if (!value || CONTROL_CHAR_RE.test(value) || value.startsWith('+') || value.startsWith('-')) {
    return false;
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function validateIanaTimezone(raw: string): Result<string> {
  const value = raw.trim();
  if (!isValidIanaTimezone(value)) {
    return {
      ok: false,
      error: 'Enter a valid IANA timezone (e.g. Asia/Dhaka, UTC).',
    };
  }
  return { ok: true, value };
}

export function parseValidDailyHours(raw: string): number | null {
  const value = raw.trim();
  if (!value || !DECIMAL_NUMBER_RE.test(value)) {
    return null;
  }
  const num = Number(value);
  if (
    !Number.isFinite(num) ||
    num < DAILY_HOURS_MIN ||
    num > DAILY_HOURS_MAX ||
    Math.round(num * 2) !== num * 2
  ) {
    return null;
  }
  return num;
}

export function validateDailyHours(raw: string): Result<number> {
  const parsed = parseValidDailyHours(raw);
  if (parsed === null) {
    return {
      ok: false,
      error: 'Enter daily study hours between 0.5 and 12 in 0.5 increments.',
    };
  }
  return { ok: true, value: parsed };
}

export function validateOptionalEmail(raw: string): Result<string> {
  if (!raw.trim()) {
    return { ok: true, value: '' };
  }
  return validateEmail(raw);
}

export function validateOptionalBdPhone(raw: string): Result<string> {
  if (!raw.trim()) {
    return { ok: true, value: '' };
  }
  return validateBdPhone(raw);
}

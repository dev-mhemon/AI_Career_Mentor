import { normalizeBdPhone } from '@/lib/validation/auth-schemas';
import { isNonSyntheticEmail, normalizeFullName } from '@/lib/validation/profile-schemas';

export interface ShellUserInfo {
  fullName?: string | null;
  currentRole?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ResolvedShellUserDisplay {
  displayName: string;
  initials: string;
  roleLabel: string;
}

const ALPHANUMERIC_CHAR_RE = /[\p{L}\p{N}]/u;
const NON_WORD_TOKEN_EDGES_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const DIGITS_AND_PUNCT_ONLY_RE = /^[\d\s+\-().]+$/;

function formatShellPhone(raw: string): string {
  const normalized = normalizeBdPhone(raw);
  if (normalized) {
    const match = /^\+880(1[3-9]\d{2})(\d{6})$/.exec(normalized);
    if (match) {
      return `+880 ${match[1]}-${match[2]}`;
    }
    return normalized;
  }
  return raw.trim();
}

function firstAlphanumericChars(token: string, count: number): string {
  const chars = Array.from(token).filter((ch) => ALPHANUMERIC_CHAR_RE.test(ch));
  return chars.slice(0, count).join('').toUpperCase();
}

function extractNameInitials(rawName: string): string {
  const normalized = normalizeFullName(rawName);
  if (!normalized || DIGITS_AND_PUNCT_ONLY_RE.test(normalized)) {
    return '';
  }

  const tokens = normalized
    .split(' ')
    .map((part) => part.replace(NON_WORD_TOKEN_EDGES_RE, ''))
    .filter((part) => ALPHANUMERIC_CHAR_RE.test(part));

  if (tokens.length >= 2) {
    const first = firstAlphanumericChars(tokens[0], 1);
    const last = firstAlphanumericChars(tokens[tokens.length - 1], 1);
    const combined = `${first}${last}`.trim();
    if (combined) return combined;
  }

  if (tokens.length === 1) {
    const single = firstAlphanumericChars(tokens[0], 2);
    if (single) return single;
  }

  return '';
}

function extractEmailInitials(rawEmail: string): string {
  if (!isNonSyntheticEmail(rawEmail)) return '';
  const trimmed = rawEmail.trim();
  const atIdx = trimmed.indexOf('@');
  const localPart = atIdx > 0 ? trimmed.slice(0, atIdx) : trimmed;
  if (!localPart) return '';

  const segments = localPart
    .split(/[._\-\s]+/)
    .map((part) => part.replace(NON_WORD_TOKEN_EDGES_RE, ''))
    .filter((part) => ALPHANUMERIC_CHAR_RE.test(part));

  if (segments.length >= 2) {
    const first = firstAlphanumericChars(segments[0], 1);
    const second = firstAlphanumericChars(segments[1], 1);
    const combined = `${first}${second}`.trim();
    if (combined) return combined;
  }

  if (segments.length === 1) {
    const single = firstAlphanumericChars(segments[0], 2);
    if (single) return single;
  }

  return '';
}

/**
 * Derives 1-2 character uppercase avatar initials from fullName, email, or phone.
 * Always returns a safe non-empty string and never produces `undefined`.
 */
export function getUserInitials(user?: ShellUserInfo | null): string {
  if (typeof user?.fullName === 'string') {
    const fromName = extractNameInitials(user.fullName);
    if (fromName) return fromName;
  }

  if (typeof user?.email === 'string') {
    const fromEmail = extractEmailInitials(user.email);
    if (fromEmail) return fromEmail;
  }

  return 'U';
}

/**
 * Resolves the top-line user display name (fullName -> email username -> formatted phone -> "Account").
 */
export function getUserDisplayName(user?: ShellUserInfo | null): string {
  if (typeof user?.fullName === 'string') {
    const normalized = normalizeFullName(user.fullName);
    if (normalized) return normalized;
  }

  if (typeof user?.email === 'string' && isNonSyntheticEmail(user.email)) {
    const trimmed = user.email.trim();
    const atIdx = trimmed.indexOf('@');
    const username = atIdx > 0 ? trimmed.slice(0, atIdx) : trimmed;
    if (username) return username;
  }

  if (typeof user?.phone === 'string' && user.phone.trim()) {
    return formatShellPhone(user.phone);
  }

  return 'Account';
}

/**
 * Resolves the secondary user role label, falling back to "Learner".
 */
export function getUserRoleLabel(user?: ShellUserInfo | null): string {
  if (typeof user?.currentRole === 'string') {
    const trimmed = user.currentRole.trim();
    if (trimmed) return trimmed;
  }
  return 'Learner';
}

/**
 * Resolves complete display metadata for the authenticated shell header.
 */
export function resolveShellUserDisplay(
  user?: ShellUserInfo | null,
): ResolvedShellUserDisplay {
  return {
    displayName: getUserDisplayName(user),
    initials: getUserInitials(user),
    roleLabel: getUserRoleLabel(user),
  };
}

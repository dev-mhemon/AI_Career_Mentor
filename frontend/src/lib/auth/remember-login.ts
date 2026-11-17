import {
  normalizeEmail,
  sanitizeBdPhoneDisplay,
} from '@/lib/validation/auth-schemas';
import {
  isNonSyntheticEmail,
  normalizeFullName,
} from '@/lib/validation/profile-schemas';

export const LOGIN_HINT_COOKIE = 'mentor_login_hint';
export const REMEMBERED_LOGIN_COOKIE_NAME = LOGIN_HINT_COOKIE;
export const REMEMBERED_LOGIN_STORAGE_KEY = 'mentor_remembered_login';
export const OAUTH_HINT_COOKIE = 'mentor_oauth_hint';
export const OAUTH_HINT_STORAGE_KEY = 'mentor_oauth_hint';
export const OAUTH_HINT_CLEARED_STORAGE_KEY = 'mentor_oauth_hint_cleared';
export const OAUTH_HINT_MAX_AGE = 60 * 60 * 24 * 30;

export type LoginChannel = 'email' | 'phone';
export type OAuthProvider = 'google' | 'facebook';

export interface RememberedLoginHint {
  channel: LoginChannel;
  identifier: string;
  rememberMe: true;
}

export interface OAuthLoginHint {
  provider: OAuthProvider;
  displayName: string;
  email: string;
  avatarUrl?: string;
}

const ALLOWED_HINT_KEYS = new Set(['channel', 'identifier', 'rememberMe']);
const ALLOWED_OAUTH_HINT_KEYS = new Set([
  'provider',
  'displayName',
  'email',
  'avatarUrl',
]);

export function normalizeRememberedIdentifier(
  channel: LoginChannel,
  identifier: string,
): string {
  const trimmed = identifier.trim();
  if (!trimmed) return '';
  if (channel === 'phone') {
    return sanitizeBdPhoneDisplay(trimmed);
  }
  return trimmed.toLowerCase();
}

export function serializeRememberedLoginHint(
  channel: LoginChannel,
  identifier: string,
): string {
  const normalized = normalizeRememberedIdentifier(channel, identifier);
  return JSON.stringify({
    channel,
    identifier: normalized,
    rememberMe: true,
  } satisfies RememberedLoginHint);
}

export function parseRememberedLoginHint(
  raw: string | undefined | null,
): RememberedLoginHint | null {
  if (!raw || typeof raw !== 'string') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (!(err instanceof SyntaxError)) return null;
    try {
      parsed = JSON.parse(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_HINT_KEYS.has(key)) {
      return null;
    }
  }

  if (record.rememberMe !== true) return null;
  if (record.channel !== 'email' && record.channel !== 'phone') return null;
  if (typeof record.identifier !== 'string') return null;

  const normalized = normalizeRememberedIdentifier(
    record.channel,
    record.identifier,
  );
  if (!normalized || normalized.length > 254) return null;

  return {
    channel: record.channel,
    identifier: normalized,
    rememberMe: true,
  };
}

/**
 * Parses a server-side `mentor_login_hint` cookie value, returning `undefined` (not `null`) when absent or invalid
 * so `null` remains reserved for explicit post-deletion clearing in `LoginPage`.
 */
export function parseRememberedLoginCookieHint(
  raw: string | undefined | null,
): RememberedLoginHint | undefined {
  return parseRememberedLoginHint(raw) ?? undefined;
}

const listeners = new Set<() => void>();

function notifyRememberedLoginListeners(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Isolate listener errors so remaining subscribers still execute
    }
  });
}

export function subscribeRememberedLogin(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  listeners.add(listener);
  const handleStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === REMEMBERED_LOGIN_STORAGE_KEY) {
      listener();
    }
  };
  window.addEventListener('storage', handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', handleStorage);
  };
}

export function getRememberedLoginSnapshot(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(REMEMBERED_LOGIN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getRememberedLoginServerSnapshot(): string | null {
  return null;
}

export function saveRememberedLogin(
  channel: LoginChannel,
  identifier: string,
): void {
  if (typeof window === 'undefined') return;
  const serialized = serializeRememberedLoginHint(channel, identifier);
  const parsed = parseRememberedLoginHint(serialized);
  if (!parsed) return;
  try {
    window.localStorage.setItem(REMEMBERED_LOGIN_STORAGE_KEY, serialized);
    notifyRememberedLoginListeners();
  } catch {
    // Ignore storage quota or private browsing write errors
  }
}

export function loadRememberedLogin(): RememberedLoginHint | null {
  return parseRememberedLoginHint(getRememberedLoginSnapshot());
}

export function clearRememberedLoginCookie(): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = `${LOGIN_HINT_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
  } catch {
    // Ignore document cookie write errors
  }
}

export function clearRememberedLogin(): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(REMEMBERED_LOGIN_STORAGE_KEY);
    } catch {
      // Ignore storage access errors
    }
  }
  try {
    clearRememberedLoginCookie();
  } catch {
    // Ignore cookie access errors
  }
  try {
    notifyRememberedLoginListeners();
  } catch {
    // Ignore listener notification errors
  }
}

export const clearRememberedLoginHint = clearRememberedLogin;
export const clearRememberedLoginStorage = clearRememberedLogin;

function sanitizeAvatarUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 1024) return undefined;
  try {
    const parsed = new URL(trimmed);
    const isLoopbackHttp =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
    if (parsed.protocol !== 'https:' && !isLoopbackHttp) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizeOAuthDisplayName(rawName: unknown, email: string): string {
  if (typeof rawName === 'string') {
    const normalized = normalizeFullName(rawName);
    if (normalized) {
      return normalized.slice(0, 120);
    }
  }
  if (email) {
    const at = email.indexOf('@');
    const prefix = at > 0 ? email.slice(0, at) : email;
    if (prefix) return prefix.slice(0, 120);
  }
  return '';
}

function extractRawAvatarFromMetadata(
  meta: Record<string, unknown> | null | undefined,
): unknown {
  if (!meta) return undefined;
  if (typeof meta.avatar_url === 'string' && meta.avatar_url.trim()) {
    return meta.avatar_url;
  }
  if (typeof meta.picture === 'string' && meta.picture.trim()) {
    return meta.picture;
  }
  if (meta.picture && typeof meta.picture === 'object') {
    const pic = meta.picture as { data?: { url?: unknown }; url?: unknown };
    if (typeof pic.data?.url === 'string' && pic.data.url.trim()) {
      return pic.data.url;
    }
    if (typeof pic.url === 'string' && pic.url.trim()) {
      return pic.url;
    }
  }
  return undefined;
}

/**
 * Extracts a lightweight, non-sensitive returning OAuth login hint from Supabase user metadata.
 */
export function extractOAuthLoginHintFromUser(
  provider: OAuthProvider,
  user: {
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  } | null | undefined,
  fallbackEmail?: string | null,
): OAuthLoginHint | null {
  if (provider !== 'google' && provider !== 'facebook') return null;
  const meta = user?.user_metadata ?? undefined;

  const candidateEmails = [
    user?.email,
    typeof meta?.email === 'string' ? meta.email : undefined,
    fallbackEmail,
  ];
  let resolvedEmail = '';
  for (const candidate of candidateEmails) {
    if (typeof candidate === 'string' && isNonSyntheticEmail(candidate)) {
      const normalized = normalizeEmail(candidate);
      if (normalized && normalized.length <= 254) {
        resolvedEmail = normalized;
        break;
      }
    }
  }

  const rawName =
    (typeof meta?.full_name === 'string' && meta.full_name.trim()
      ? meta.full_name
      : undefined) ??
    (typeof meta?.name === 'string' && meta.name.trim()
      ? meta.name
      : undefined) ??
    (typeof meta?.given_name === 'string' && meta.given_name.trim()
      ? meta.given_name
      : undefined);

  const displayName =
    normalizeOAuthDisplayName(rawName, resolvedEmail) ||
    (provider === 'google' ? 'Google User' : 'Facebook User');
  const avatarUrl = sanitizeAvatarUrl(extractRawAvatarFromMetadata(meta));

  if (!resolvedEmail && !rawName) {
    return null;
  }

  return {
    provider,
    displayName,
    email: resolvedEmail,
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export function serializeOAuthLoginHint(hint: OAuthLoginHint): string | null {
  if (hint.provider !== 'google' && hint.provider !== 'facebook') return null;
  const email =
    typeof hint.email === 'string' && isNonSyntheticEmail(hint.email)
      ? normalizeEmail(hint.email)
      : '';
  if (email.length > 254) return null;

  const displayName = normalizeOAuthDisplayName(hint.displayName, email);
  if (!displayName) return null;

  const avatarUrl = sanitizeAvatarUrl(hint.avatarUrl);
  return JSON.stringify({
    provider: hint.provider,
    displayName,
    email,
    ...(avatarUrl ? { avatarUrl } : {}),
  } satisfies OAuthLoginHint);
}

export function parseOAuthLoginHint(
  raw: string | undefined | null,
): OAuthLoginHint | null {
  if (!raw || typeof raw !== 'string') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (!(err instanceof SyntaxError)) return null;
    try {
      parsed = JSON.parse(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_OAUTH_HINT_KEYS.has(key)) {
      return null;
    }
  }

  if (record.provider !== 'google' && record.provider !== 'facebook') {
    return null;
  }
  if (typeof record.displayName !== 'string') return null;
  if (typeof record.email !== 'string') return null;

  const email = record.email.trim()
    ? isNonSyntheticEmail(record.email)
      ? normalizeEmail(record.email)
      : ''
    : '';
  if (record.email.trim() && !email) return null;
  if (email.length > 254) return null;

  const displayName = normalizeOAuthDisplayName(record.displayName, email);
  if (!displayName) return null;

  const avatarUrl = sanitizeAvatarUrl(record.avatarUrl);
  return {
    provider: record.provider,
    displayName,
    email,
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

/**
 * Parses a server-side `mentor_oauth_hint` cookie value, returning `undefined` (not `null`) when absent or invalid
 * so `null` remains reserved for explicit post-deletion clearing in `LoginPage`.
 */
export function parseOAuthLoginCookieHint(
  raw: string | undefined | null,
): OAuthLoginHint | undefined {
  return parseOAuthLoginHint(raw) ?? undefined;
}

const oauthListeners = new Set<() => void>();

function notifyOAuthHintListeners(): void {
  oauthListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Isolate listener errors so remaining subscribers still execute
    }
  });
}

export function subscribeOAuthLoginHint(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  oauthListeners.add(listener);
  const handleStorage = (e: StorageEvent) => {
    if (
      e.key === null ||
      e.key === OAUTH_HINT_STORAGE_KEY ||
      e.key === OAUTH_HINT_CLEARED_STORAGE_KEY
    ) {
      listener();
    }
  };
  window.addEventListener('storage', handleStorage);
  return () => {
    oauthListeners.delete(listener);
    window.removeEventListener('storage', handleStorage);
  };
}

export function getOAuthLoginHintSnapshot(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(OAUTH_HINT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getOAuthLoginHintClearedSnapshot(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(OAUTH_HINT_CLEARED_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function isOAuthLoginHintCleared(): boolean {
  return Boolean(getOAuthLoginHintClearedSnapshot());
}

export function getOAuthLoginHintServerSnapshot(): string | null {
  return null;
}

export function saveOAuthLoginHint(hint: OAuthLoginHint): void {
  if (typeof window === 'undefined') return;
  const serialized = serializeOAuthLoginHint(hint);
  if (!serialized) return;
  try {
    window.localStorage.removeItem(OAUTH_HINT_CLEARED_STORAGE_KEY);
    window.localStorage.setItem(OAUTH_HINT_STORAGE_KEY, serialized);
    notifyOAuthHintListeners();
  } catch {
    // Ignore storage quota or private browsing write errors
  }
}

export function loadOAuthLoginHint(): OAuthLoginHint | null {
  return parseOAuthLoginHint(getOAuthLoginHintSnapshot());
}

export function clearOAuthLoginHintCookie(): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = `${OAUTH_HINT_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
  } catch {
    // Ignore document cookie write errors
  }
}

export function clearOAuthLoginHint(): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(OAUTH_HINT_STORAGE_KEY);
    } catch {
      // Ignore storage remove errors
    }
    try {
      window.localStorage.setItem(OAUTH_HINT_CLEARED_STORAGE_KEY, '1');
    } catch {
      // Ignore storage write errors
    }
  }
  try {
    clearOAuthLoginHintCookie();
  } catch {
    // Ignore cookie access errors
  }
  try {
    notifyOAuthHintListeners();
  } catch {
    // Ignore listener notification errors
  }
}

function readDocumentCookie(name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }
  return null;
}

/**
 * Syncs `mentor_oauth_hint` cookie written by `/auth/callback` into `localStorage`
 * once the authenticated workspace mounts, unless an account deletion notice is active.
 */
export function syncOAuthLoginHintFromDocumentCookie(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (readDocumentCookie('account_deleted') === 'true') {
    clearOAuthLoginHint();
    return;
  }
  const cookieRaw = readDocumentCookie(OAUTH_HINT_COOKIE);
  if (!cookieRaw) return;
  const parsed = parseOAuthLoginHint(cookieRaw);
  if (!parsed) return;
  const serialized = serializeOAuthLoginHint(parsed);
  if (!serialized) return;
  try {
    window.localStorage.removeItem(OAUTH_HINT_CLEARED_STORAGE_KEY);
    if (window.localStorage.getItem(OAUTH_HINT_STORAGE_KEY) !== serialized) {
      window.localStorage.setItem(OAUTH_HINT_STORAGE_KEY, serialized);
      notifyOAuthHintListeners();
    }
  } catch {
    // Ignore storage quota or private browsing write errors
  }
}

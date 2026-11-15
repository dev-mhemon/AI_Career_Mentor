import { sanitizeBdPhoneDisplay } from '@/lib/validation/auth-schemas';

export const LOGIN_HINT_COOKIE = 'mentor_login_hint';
export const REMEMBERED_LOGIN_STORAGE_KEY = 'mentor_remembered_login';

export type LoginChannel = 'email' | 'phone';

export interface RememberedLoginHint {
  channel: LoginChannel;
  identifier: string;
  rememberMe: true;
}

const ALLOWED_HINT_KEYS = new Set(['channel', 'identifier', 'rememberMe']);

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

const listeners = new Set<() => void>();

function notifyRememberedLoginListeners(): void {
  listeners.forEach((listener) => listener());
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

export function clearRememberedLogin(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REMEMBERED_LOGIN_STORAGE_KEY);
  } catch {
    // Ignore storage access errors
  }
  try {
    document.cookie = `${LOGIN_HINT_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
  } catch {
    // Ignore document cookie write errors
  }
  notifyRememberedLoginListeners();
}

/**
 * R18 verification draft state helper for Screen 03/04/02/05/06/22 verification and recovery flows.
 * Stores only `{ channel, normalized_identifier, contact_masked, expires_at, context }` in `sessionStorage`.
 */

export const VERIFICATION_DRAFT_STORAGE_KEY = 'mentor_verification_draft';

/** Maximum allowed R18 verification draft lifetime in seconds (10 minutes). */
export const MAX_VERIFICATION_DRAFT_TTL_SECONDS = 600;

/** Supported verification delivery channels under C05/C09 R18. */
export type VerificationChannel = 'email' | 'phone';

/** Local UI flow context that initiated the verification challenge. */
export type VerificationDraftContext =
  | 'registration'
  | 'unverified_login'
  | 'secondary_contact'
  | 'password_recovery';

/** Exact C09/C05 R18 sessionStorage verification draft payload. */
export interface VerificationDraft {
  channel: VerificationChannel;
  normalized_identifier: string;
  contact_masked: string;
  expires_at: string;
  context: VerificationDraftContext;
}

/** Input parameters for creating or updating an R18 verification draft. */
export interface SaveVerificationDraftInput {
  channel: VerificationChannel;
  identifier: string;
  contactMasked?: string;
  expiresInSeconds?: number;
  context?: VerificationDraftContext;
  /**
   * When true, verifies that sessionStorage is currently missing or expired before saving.
   * If an active live draft exists for another identifier or channel, returns null without overwriting.
   */
  onlyIfMissingOrExpired?: boolean;
}

const ALLOWED_DRAFT_KEYS = new Set([
  'channel',
  'normalized_identifier',
  'contact_masked',
  'expires_at',
  'context',
]);

const FORBIDDEN_SECRET_KEYS = [
  'password',
  'confirm_password',
  'confirmPassword',
  'code',
  'token',
  'access_token',
  'refresh_token',
];

/**
 * Normalizes an email or Bangladesh phone identifier for R18 verification/resend requests.
 */
export function normalizeVerificationIdentifier(
  channel: VerificationChannel,
  rawIdentifier: string,
): string {
  const trimmed = rawIdentifier.trim();
  if (!trimmed) return '';
  if (channel === 'email') {
    return trimmed.toLowerCase();
  }
  const compact = trimmed.replace(/[\s-]/g, '');
  if (/^01[3-9]\d{8}$/.test(compact)) {
    return `+88${compact}`;
  }
  return compact;
}

/**
 * Generates a display-safe masked contact string when server masking is not yet available.
 */
export function maskVerificationContact(
  channel: VerificationChannel,
  normalizedIdentifier: string,
): string {
  if (!normalizedIdentifier) return '****';
  if (channel === 'email') {
    const atIndex = normalizedIdentifier.lastIndexOf('@');
    if (atIndex <= 0) return '****';
    return `${normalizedIdentifier[0]}****${normalizedIdentifier.slice(atIndex)}`;
  }
  if (normalizedIdentifier.length >= 6) {
    return `${normalizedIdentifier.slice(0, 6)}****${normalizedIdentifier.slice(-2)}`;
  }
  return '****';
}

/**
 * Computes the ISO expiry timestamp enforcing `min(challenge expiry, 10 minutes)` per R18.
 */
export function computeDraftExpiresAt(
  challengeExpiresInSeconds?: number,
  nowMs: number = Date.now(),
): string {
  const requested =
    typeof challengeExpiresInSeconds === 'number' &&
    Number.isFinite(challengeExpiresInSeconds) &&
    challengeExpiresInSeconds > 0
      ? Math.floor(challengeExpiresInSeconds)
      : MAX_VERIFICATION_DRAFT_TTL_SECONDS;
  const clampedSeconds = Math.min(requested, MAX_VERIFICATION_DRAFT_TTL_SECONDS);
  return new Date(nowMs + clampedSeconds * 1000).toISOString();
}

/**
 * Builds the canonical PII-free verification route path (`/verify?channel=<channel>`).
 */
export function buildVerificationPath(channel: VerificationChannel): string {
  return `/verify?channel=${encodeURIComponent(channel)}`;
}

/**
 * Safely accesses browser `sessionStorage`, returning null in SSR environments
 * or when browser security policies block storage access (throwing SecurityError).
 */
export function getSafeSessionStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage || null;
  } catch {
    return null;
  }
}

/**
 * Removes the R18 verification draft from browser `sessionStorage`.
 */
export function clearVerificationDraft(): void {
  const storage = getSafeSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(VERIFICATION_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage access errors in restricted environments
  }
}

/**
 * Saves a sanitized R18 verification draft into `sessionStorage`, excluding passwords, codes, and tokens.
 * If `input.onlyIfMissingOrExpired` is true, will not overwrite an existing live draft from another flow.
 */
export function saveVerificationDraft(
  input: SaveVerificationDraftInput,
  nowMs: number = Date.now(),
): VerificationDraft | null {
  const storage = getSafeSessionStorage();
  if (!storage) return null;
  if (input.channel !== 'email' && input.channel !== 'phone') return null;

  if (input.onlyIfMissingOrExpired) {
    const { draft: currentLive } = loadVerificationDraft(null, nowMs);
    if (currentLive) {
      const normalized = normalizeVerificationIdentifier(
        input.channel,
        input.identifier,
      );
      if (
        currentLive.channel !== input.channel ||
        currentLive.normalized_identifier !== normalized
      ) {
        // Storage holds an active live draft for a different flow; do not overwrite.
        return null;
      }
    }
  }

  const normalized = normalizeVerificationIdentifier(
    input.channel,
    input.identifier,
  );
  if (!normalized) return null;

  const draft: VerificationDraft = {
    channel: input.channel,
    normalized_identifier: normalized,
    contact_masked:
      input.contactMasked?.trim() ||
      maskVerificationContact(input.channel, normalized),
    expires_at: computeDraftExpiresAt(input.expiresInSeconds, nowMs),
    context: input.context ?? 'registration',
  };

  try {
    storage.setItem(
      VERIFICATION_DRAFT_STORAGE_KEY,
      JSON.stringify(draft),
    );
    return draft;
  } catch {
    return null;
  }
}

/**
 * Saves a fallback verification draft only if sessionStorage is currently missing or expired.
 * If storage contains an active live draft for another identifier or channel, leaves it intact
 * and returns null to prevent overwriting newer flows.
 */
export function saveFallbackVerificationDraft(
  input: SaveVerificationDraftInput,
  nowMs: number = Date.now(),
): VerificationDraft | null {
  return saveVerificationDraft(
    { ...input, onlyIfMissingOrExpired: true },
    nowMs,
  );
}

/**
 * Loads and validates the R18 verification draft from `sessionStorage`, clearing it if expired or malformed.
 * Optionally filters by expected channel and/or expected context without clearing an active draft for another flow.
 */
export function loadVerificationDraft(
  expectedChannel?: VerificationChannel | null,
  nowMs: number = Date.now(),
  expectedContext?: VerificationDraftContext | VerificationDraftContext[] | null,
): { draft: VerificationDraft | null; expired: boolean } {
  const storage = getSafeSessionStorage();
  if (!storage) {
    return { draft: null, expired: false };
  }

  let raw: string | null = null;
  try {
    raw = storage.getItem(VERIFICATION_DRAFT_STORAGE_KEY);
  } catch {
    return { draft: null, expired: false };
  }

  if (!raw) {
    return { draft: null, expired: false };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      clearVerificationDraft();
      return { draft: null, expired: false };
    }

    const keys = Object.keys(parsed);
    if (
      keys.length !== ALLOWED_DRAFT_KEYS.size ||
      keys.some((k) => !ALLOWED_DRAFT_KEYS.has(k)) ||
      FORBIDDEN_SECRET_KEYS.some((k) => k in parsed)
    ) {
      clearVerificationDraft();
      return { draft: null, expired: false };
    }

    if (
      (parsed.channel !== 'email' && parsed.channel !== 'phone') ||
      typeof parsed.normalized_identifier !== 'string' ||
      !parsed.normalized_identifier.trim() ||
      typeof parsed.contact_masked !== 'string' ||
      !parsed.contact_masked.trim() ||
      typeof parsed.expires_at !== 'string' ||
      ![
        'registration',
        'unverified_login',
        'secondary_contact',
        'password_recovery',
      ].includes(String(parsed.context))
    ) {
      clearVerificationDraft();
      return { draft: null, expired: false };
    }

    const expiresAtMs = Date.parse(parsed.expires_at);
    const isExpired =
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= nowMs ||
      expiresAtMs - nowMs > MAX_VERIFICATION_DRAFT_TTL_SECONDS * 1000;

    if (isExpired) {
      clearVerificationDraft();
    }

    if (expectedChannel && parsed.channel !== expectedChannel) {
      return { draft: null, expired: false };
    }

    const expectedContexts = expectedContext
      ? Array.isArray(expectedContext)
        ? expectedContext
        : [expectedContext]
      : null;

    if (
      expectedContexts &&
      !expectedContexts.includes(parsed.context as VerificationDraftContext)
    ) {
      return { draft: null, expired: false };
    }

    if (isExpired) {
      return { draft: null, expired: true };
    }

    return {
      draft: {
        channel: parsed.channel,
        normalized_identifier: parsed.normalized_identifier,
        contact_masked: parsed.contact_masked,
        expires_at: parsed.expires_at,
        context: parsed.context as VerificationDraftContext,
      },
      expired: false,
    };
  } catch {
    clearVerificationDraft();
    return { draft: null, expired: false };
  }
}

/**
 * Updates the active R18 verification draft expiry from server resend metadata (`min(challenge expiry, 10min)`).
 * If `expectedChannel` or `expectedIdentifier` is provided, ensures the stored draft matches both before updating.
 */
export function updateVerificationDraftExpiry(
  expiresInSeconds: number,
  contactMasked?: string,
  nowMs: number = Date.now(),
  expectedChannel?: VerificationChannel,
  expectedIdentifier?: string,
): VerificationDraft | null {
  const { draft } = loadVerificationDraft(expectedChannel, nowMs);
  if (!draft) return null;

  if (
    expectedIdentifier &&
    draft.normalized_identifier !== expectedIdentifier
  ) {
    return null;
  }

  const updated: VerificationDraft = {
    ...draft,
    contact_masked: contactMasked?.trim() || draft.contact_masked,
    expires_at: computeDraftExpiresAt(expiresInSeconds, nowMs),
  };

  const storage = getSafeSessionStorage();
  if (!storage) return null;

  try {
    storage.setItem(
      VERIFICATION_DRAFT_STORAGE_KEY,
      JSON.stringify(updated),
    );
    return updated;
  } catch {
    return null;
  }
}

/** Storage key prefix for R18 resend cooldown states in sessionStorage. */
export const RESEND_COOLDOWN_STORAGE_PREFIX = 'mentor_resend_cooldown_';

/** Maximum allowed cooldown duration in seconds (10 minutes). */
export const MAX_COOLDOWN_DURATION_SECONDS = 600;

/** Persisted cooldown state structure stored in sessionStorage. */
export interface PersistedCooldownState {
  deadlineMs: number;
  originalSeconds: number;
  createdAt: number;
}

/**
 * Builds the scoped storage key for a resend cooldown.
 * When identifier is present, normalizes and scopes by channel and identifier.
 *
 * @param channel - Verification channel ('email' | 'phone') or null/undefined for default.
 * @param identifier - Optional contact identifier (email or phone).
 */
export function getCooldownStorageKey(
  channel?: VerificationChannel | null,
  identifier?: string | null,
): string {
  const channelKey = channel || 'default';
  const rawId = typeof identifier === 'string' ? identifier.trim() : '';
  if (!rawId) {
    return `${RESEND_COOLDOWN_STORAGE_PREFIX}${channelKey}`;
  }
  const normalized =
    channel === 'email' || channel === 'phone'
      ? normalizeVerificationIdentifier(channel, rawId)
      : rawId.toLowerCase();
  return `${RESEND_COOLDOWN_STORAGE_PREFIX}${channelKey}_${normalized || rawId.toLowerCase()}`;
}

/**
 * Resolves the contact identifier from explicit parameter or active verification draft in storage.
 */
function resolveCooldownIdentifier(
  channel?: VerificationChannel | null,
  identifier?: string | null,
): string | null {
  if (identifier && typeof identifier === 'string' && identifier.trim()) {
    return identifier.trim();
  }
  try {
    const { draft } = loadVerificationDraft(channel);
    if (draft?.normalized_identifier) {
      return draft.normalized_identifier;
    }
  } catch {
    // Ignore draft loading errors
  }
  return null;
}

/**
 * Saves a resend cooldown deadline into browser sessionStorage.
 *
 * @param channel - Verification channel ('email' | 'phone') or null/undefined for channel-neutral.
 * @param deadlineMs - Absolute expiry timestamp in epoch milliseconds.
 * @param originalSeconds - Initial requested cooldown duration in seconds.
 * @param nowMs - Current timestamp in epoch milliseconds (defaults to Date.now()).
 * @param identifier - Optional contact identifier to scope cooldown per contact.
 */
export function setPersistedCooldown(
  channel: VerificationChannel | null | undefined,
  deadlineMs: number,
  originalSeconds: number,
  nowMs: number = Date.now(),
  identifier?: string | null,
): void {
  const storage = getSafeSessionStorage();
  if (!storage) return;
  const effectiveId = resolveCooldownIdentifier(channel, identifier);
  const key = getCooldownStorageKey(channel, effectiveId);
  const payload: PersistedCooldownState = {
    deadlineMs,
    originalSeconds,
    createdAt: nowMs,
  };
  try {
    storage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage quota or restricted environment errors
  }
}

/**
 * Retrieves the persisted resend cooldown state from browser sessionStorage.
 *
 * @param channel - Verification channel ('email' | 'phone') or null/undefined for channel-neutral.
 * @param identifier - Optional contact identifier to scope cooldown per contact.
 * @returns Parsed PersistedCooldownState, or null if missing, invalid, or malformed.
 */
export function getPersistedCooldown(
  channel: VerificationChannel | null | undefined,
  identifier?: string | null,
): PersistedCooldownState | null {
  const storage = getSafeSessionStorage();
  if (!storage) return null;
  const effectiveId = resolveCooldownIdentifier(channel, identifier);
  const key = getCooldownStorageKey(channel, effectiveId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.deadlineMs !== 'number' ||
      !Number.isSafeInteger(parsed.deadlineMs) ||
      typeof parsed.originalSeconds !== 'number' ||
      !Number.isSafeInteger(parsed.originalSeconds) ||
      typeof parsed.createdAt !== 'number' ||
      !Number.isSafeInteger(parsed.createdAt)
    ) {
      try {
        storage.removeItem(key);
      } catch {
        // Ignore
      }
      return null;
    }
    return {
      deadlineMs: parsed.deadlineMs,
      originalSeconds: parsed.originalSeconds,
      createdAt: parsed.createdAt,
    };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore
    }
    return null;
  }
}

/**
 * Removes the persisted resend cooldown state from browser sessionStorage.
 * If identifier is provided, strictly removes only the contact-scoped key.
 *
 * @param channel - Verification channel ('email' | 'phone') or null/undefined for channel-neutral.
 * @param identifier - Optional contact identifier to clear scoped cooldown.
 */
export function clearPersistedCooldown(
  channel: VerificationChannel | null | undefined,
  identifier?: string | null,
): void {
  const storage = getSafeSessionStorage();
  if (!storage) return;
  const effectiveId = resolveCooldownIdentifier(channel, identifier);
  const key = getCooldownStorageKey(channel, effectiveId);
  const fallbackKey = getCooldownStorageKey(channel, null);
  try {
    storage.removeItem(key);
    if (!identifier && key !== fallbackKey) {
      storage.removeItem(fallbackKey);
    }
  } catch {
    // Ignore
  }
}

/**
 * Privacy-filtered frontend telemetry (`C09 §7`, `R11`).
 * Captures strictly content-free product health events correlated via a rotated
 * non-PII `anonymous_session_id` and strips/rejects all user content and PII.
 */

export type TelemetryFeatureKey =
  | 'auth'
  | 'onboarding'
  | 'roadmap_generator'
  | 'daily_plan'
  | 'quiz_practice'
  | 'ai_practice_review'
  | 'progress_tracking'
  | 'ai_mentor'
  | 'technology_update';

export type TelemetryScreenName =
  | 'landing'
  | 'login'
  | 'register'
  | 'forgot_password'
  | 'reset_password'
  | 'verify_otp'
  | 'onboarding_profile'
  | 'onboarding_goal'
  | 'onboarding_review'
  | 'onboarding_generating'
  | 'onboarding_ready'
  | 'roadmap_draft'
  | 'dashboard'
  | 'career_profile'
  | 'roadmaps'
  | 'roadmap_detail'
  | 'daily_plan'
  | 'today'
  | 'quiz'
  | 'progress'
  | 'mentor'
  | 'tech_updates'
  | 'settings'
  | 'admin_dashboard'
  | 'admin_users'
  | 'admin_features'
  | 'admin_audit_logs';

export type TelemetryEventName =
  | 'page_viewed'
  | 'auth_login_submitted'
  | 'auth_signup_submitted'
  | 'auth_otp_verified'
  | 'onboarding_started'
  | 'profile_completed'
  | 'career_goal_submitted'
  | 'ai_generation_requested'
  | 'ai_generation_succeeded'
  | 'ai_generation_failed'
  | 'roadmap_activated'
  | 'learning_started'
  | 'quiz_submitted'
  | 'mentor_message_sent';

export type TelemetryMetadataKey =
  | 'feature_key'
  | 'screen_name'
  | 'request_id'
  | 'channel'
  | 'step'
  | 'status_code'
  | 'error_code'
  | 'reason_code'
  | 'source';

export type TelemetryMetadataValue = string | number | boolean;

export type TelemetryEvent = {
  timestamp: string;
  anonymous_session_id: string;
  feature_key: TelemetryFeatureKey;
  screen_name: TelemetryScreenName | 'unknown';
  event_name: TelemetryEventName;
  request_id?: string;
  metadata?: Partial<Record<TelemetryMetadataKey, TelemetryMetadataValue>>;
};

export type TrackEventInput = {
  event_name: TelemetryEventName;
  feature_key: TelemetryFeatureKey;
  screen_name: string;
  request_id?: string | null;
  metadata?: Record<string, unknown>;
};

export type TelemetrySink = (event: TelemetryEvent) => void;

const SESSION_STORAGE_KEY = 'acm:telemetry:anonymous_session_id';
const MAX_BUFFER_SIZE = 100;

const ALLOWED_EVENTS: ReadonlySet<string> = new Set<TelemetryEventName>([
  'page_viewed',
  'auth_login_submitted',
  'auth_signup_submitted',
  'auth_otp_verified',
  'onboarding_started',
  'profile_completed',
  'career_goal_submitted',
  'ai_generation_requested',
  'ai_generation_succeeded',
  'ai_generation_failed',
  'roadmap_activated',
  'learning_started',
  'quiz_submitted',
  'mentor_message_sent',
]);

const ALLOWED_FEATURE_KEYS: ReadonlySet<string> = new Set<TelemetryFeatureKey>([
  'roadmap_generator',
  'daily_plan',
  'quiz_practice',
  'ai_practice_review',
  'progress_tracking',
  'ai_mentor',
  'technology_update',
  'onboarding',
  'auth',
]);

const ALLOWED_SCREEN_NAMES: ReadonlySet<string> = new Set<TelemetryScreenName>([
  'landing',
  'login',
  'register',
  'forgot_password',
  'reset_password',
  'verify_otp',
  'onboarding_profile',
  'onboarding_goal',
  'onboarding_review',
  'onboarding_generating',
  'onboarding_ready',
  'roadmap_draft',
  'dashboard',
  'career_profile',
  'roadmaps',
  'roadmap_detail',
  'daily_plan',
  'today',
  'quiz',
  'progress',
  'mentor',
  'tech_updates',
  'settings',
  'admin_dashboard',
  'admin_users',
  'admin_features',
  'admin_audit_logs',
]);

const ALLOWED_CHANNELS: ReadonlySet<string> = new Set([
  'email',
  'phone',
  'google',
  'oauth',
  'otp',
  'password',
  'web',
  'pwa',
]);

const ALLOWED_SOURCES: ReadonlySet<string> = new Set([
  'web',
  'pwa',
  'sidebar',
  'bottom_nav',
  'header',
  'onboarding',
  'career_profile',
  'dashboard',
  'roadmap_draft',
  'today',
  'daily_plan',
  'quiz',
  'mentor',
  'settings',
  'manual',
  'retry',
]);

const ALLOWED_STEP_STRINGS: ReadonlySet<string> = new Set([
  '1',
  '2',
  '3',
  '4',
  '5',
  'profile',
  'goal',
  'review',
  'generating',
  'ready',
  'verify',
  'submit',
]);

const ALLOWED_METADATA_KEYS: ReadonlySet<string> = new Set<TelemetryMetadataKey>([
  'feature_key',
  'screen_name',
  'request_id',
  'channel',
  'step',
  'status_code',
  'error_code',
  'reason_code',
  'source',
]);

const ENUM_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,47}$/;
const REQUEST_ID_TOKEN_PATTERN = /^req_[A-Za-z0-9_-]{8,48}$/;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const BD_OR_INTL_PHONE_PATTERN = /(?:\+?8801[3-9]\d{8}|(?<!\d)01[3-9]\d{8}(?!\d)|\+\d{8,15})/;
const JWT_OR_BEARER_PATTERN = /(?:bearer\s+[a-z0-9._-]+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const eventBuffer: TelemetryEvent[] = [];
let customSink: TelemetrySink | null = null;
let inMemorySessionId: string | null = null;
let storageAuthoritative = true;

function generateUuidV4(): string {
  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to byte-based UUID generation.
  }
  const bytes = new Uint8Array(16);
  let populated = false;
  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.getRandomValues === 'function'
    ) {
      crypto.getRandomValues(bytes);
      populated = true;
    }
  } catch {
    populated = false;
  }
  if (!populated) {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readStorageSessionId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    return existing && UUID_PATTERN.test(existing) ? existing : null;
  } catch {
    return null;
  }
}

function writeStorageSessionId(id: string): boolean {
  if (typeof window === 'undefined') {
    storageAuthoritative = false;
    return false;
  }
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, id);
    storageAuthoritative = true;
    return true;
  } catch {
    // Restricted storage mode: keep in-memory session authoritative until a later write succeeds.
    storageAuthoritative = false;
    return false;
  }
}

/**
 * Returns the active non-PII `anonymous_session_id` UUID from `sessionStorage`
 * (or the authoritative in-memory ID if a prior `sessionStorage.setItem` failed).
 */
export function getTelemetrySessionId(): string {
  if (storageAuthoritative) {
    const stored = readStorageSessionId();
    if (stored) {
      inMemorySessionId = stored;
      return stored;
    }
  } else if (inMemorySessionId) {
    return inMemorySessionId;
  }

  if (!inMemorySessionId) {
    inMemorySessionId = generateUuidV4();
  }
  writeStorageSessionId(inMemorySessionId);
  return inMemorySessionId;
}

/**
 * Rotates `anonymous_session_id` (invoked on sign-in and sign-out boundaries per `C09 §7.1`).
 */
export function rotateTelemetrySessionId(): string {
  const nextId = generateUuidV4();
  inMemorySessionId = nextId;
  writeStorageSessionId(nextId);
  return nextId;
}

function isSafeEnumCode(value: string): boolean {
  const trimmed = value.trim();
  if (!ENUM_CODE_PATTERN.test(trimmed)) {
    return false;
  }
  if (
    EMAIL_PATTERN.test(trimmed) ||
    BD_OR_INTL_PHONE_PATTERN.test(trimmed) ||
    JWT_OR_BEARER_PATTERN.test(trimmed)
  ) {
    return false;
  }
  return true;
}

function sanitizeAllowlistedMetadataValue(
  key: TelemetryMetadataKey,
  value: unknown,
): TelemetryMetadataValue | undefined {
  switch (key) {
    case 'status_code':
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 100 &&
        value <= 599
        ? value
        : undefined;

    case 'step':
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 5
      ) {
        return value;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return ALLOWED_STEP_STRINGS.has(trimmed) ? trimmed : undefined;
      }
      return undefined;

    case 'request_id':
      return typeof value === 'string' ? sanitizeRequestId(value) : undefined;

    case 'screen_name':
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return ALLOWED_SCREEN_NAMES.has(trimmed) ? trimmed : undefined;
      }
      return undefined;

    case 'feature_key':
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return ALLOWED_FEATURE_KEYS.has(trimmed) ? trimmed : undefined;
      }
      return undefined;

    case 'channel':
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return ALLOWED_CHANNELS.has(trimmed) ? trimmed : undefined;
      }
      return undefined;

    case 'source':
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return ALLOWED_SOURCES.has(trimmed) ? trimmed : undefined;
      }
      return undefined;

    case 'error_code':
    case 'reason_code':
      return typeof value === 'string' && isSafeEnumCode(value)
        ? value.trim()
        : undefined;
  }
}

function sanitizeMetadata(
  raw?: Record<string, unknown>,
): Partial<Record<TelemetryMetadataKey, TelemetryMetadataValue>> | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const clean: Partial<Record<TelemetryMetadataKey, TelemetryMetadataValue>> =
    {};
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = key.trim().toLowerCase();
    if (!ALLOWED_METADATA_KEYS.has(normalizedKey)) {
      continue;
    }
    const typedKey = normalizedKey as TelemetryMetadataKey;
    const sanitized = sanitizeAllowlistedMetadataValue(typedKey, value);
    if (sanitized !== undefined) {
      clean[typedKey] = sanitized;
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function sanitizeRequestId(raw?: string | null): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  if (
    EMAIL_PATTERN.test(trimmed) ||
    BD_OR_INTL_PHONE_PATTERN.test(trimmed) ||
    JWT_OR_BEARER_PATTERN.test(trimmed)
  ) {
    return undefined;
  }
  return UUID_PATTERN.test(trimmed) || REQUEST_ID_TOKEN_PATTERN.test(trimmed)
    ? trimmed
    : undefined;
}

/** Registers an optional sink for tests or future approved collectors. */
export function setTelemetrySink(sink: TelemetrySink | null): void {
  customSink = sink;
}

/** Returns a shallow snapshot of the bounded in-memory ring buffer (`max 100`). */
export function getTelemetryEvents(): readonly TelemetryEvent[] {
  return [...eventBuffer];
}

/** Clears the in-memory ring buffer (primarily for deterministic tests). */
export function clearTelemetryEvents(): void {
  eventBuffer.length = 0;
}

/**
 * Emits a strictly sanitized `C09 §7` telemetry event.
 * Unknown event names or feature keys are dropped; metadata keys and values are
 * validated against strict field-specific allowlists.
 */
export function trackEvent(input: TrackEventInput): TelemetryEvent | null {
  try {
    if (
      !ALLOWED_EVENTS.has(input.event_name) ||
      !ALLOWED_FEATURE_KEYS.has(input.feature_key)
    ) {
      return null;
    }
    const trimmedScreen =
      typeof input.screen_name === 'string' ? input.screen_name.trim() : '';
    const safeScreen: TelemetryScreenName | 'unknown' = ALLOWED_SCREEN_NAMES.has(
      trimmedScreen,
    )
      ? (trimmedScreen as TelemetryScreenName)
      : 'unknown';
    const safeRequestId = sanitizeRequestId(input.request_id);
    const safeMetadata = sanitizeMetadata(input.metadata);

    const event: TelemetryEvent = {
      timestamp: new Date().toISOString(),
      anonymous_session_id: getTelemetrySessionId(),
      feature_key: input.feature_key,
      screen_name: safeScreen,
      event_name: input.event_name,
      ...(safeRequestId ? { request_id: safeRequestId } : {}),
      ...(safeMetadata ? { metadata: safeMetadata } : {}),
    };

    eventBuffer.push(event);
    if (eventBuffer.length > MAX_BUFFER_SIZE) {
      eventBuffer.splice(0, eventBuffer.length - MAX_BUFFER_SIZE);
    }

    if (customSink) {
      try {
        customSink(event);
      } catch {
        // Telemetry failures must never impact user flows.
      }
    }

    return event;
  } catch {
    return null;
  }
}

import { readAbuseConfiguration } from './auth/abuse-control/config.js';
import { trustedProxyCidrs } from './auth/client-ip.js';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Validates an email webhook or transport URL.
 * Requires https: for remote hosts; http: is accepted only for explicit loopback addresses.
 * Throws an Error if the URL is malformed, uses an unsupported protocol, or uses http: on a non-loopback host.
 */
export function validateEmailWebhookUrl(
  rawUrl: unknown,
  keyName = 'email transport URL',
): URL {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error(`Invalid ${keyName}: URL must be a non-empty string`);
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid ${keyName}: malformed URL`);
  }
  if (parsed.protocol === 'https:') {
    return parsed;
  }
  if (parsed.protocol === 'http:') {
    const hostname = parsed.hostname.toLowerCase();
    if (LOOPBACK_HOSTNAMES.has(hostname)) {
      return parsed;
    }
    throw new Error(
      `Invalid ${keyName}: non-loopback transport requires https: protocol`,
    );
  }
  throw new Error(
    `Invalid ${keyName}: protocol must be https: (or http: for loopback hosts)`,
  );
}

const EMAIL_LOCAL_PART =
  "[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*";
const EMAIL_DOMAIN_PART =
  '[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+';

/**
 * Matches a bare email address (e.g. user@example.com) or Resend-supported named sender
 * format (e.g. "Career Mentor <mentor@example.com>"), strictly validating local and domain parts.
 */
export const AUTH_EMAIL_FROM_PATTERN = new RegExp(
  `^(?:[^\\r\\n<>]*<${EMAIL_LOCAL_PART}@${EMAIL_DOMAIN_PART}>|${EMAIL_LOCAL_PART}@${EMAIL_DOMAIN_PART})$`,
);

/**
 * Validates AUTH_EMAIL_FROM sender address format for Resend.
 * Accepts bare email addresses and named sender addresses (Name <email@domain>).
 */
export function validateAuthEmailFrom(fromAddress: string): void {
  if (!AUTH_EMAIL_FROM_PATTERN.test(fromAddress)) {
    throw new Error(
      'AUTH_EMAIL_FROM must be an email address on a verified sender domain',
    );
  }
}

/** Startup validation for the current foundation configuration; no secret is echoed. */
export function validateConfiguration(raw: Record<string, unknown>) {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
  ];
  for (const key of required)
    if (typeof raw[key] !== 'string' || !raw[key])
      throw new Error(`Missing required configuration: ${key}`);
  const url = new URL(String(raw.SUPABASE_URL));
  if (!['https:', 'http:'].includes(url.protocol))
    throw new Error('Invalid SUPABASE_URL');
  const key = String(raw.SUPABASE_ANON_KEY);
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (key.split('.').length === 3) {
    try {
      publicKey =
        JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString())
          .role === 'anon';
    } catch {
      publicKey = false;
    }
  }
  if (!publicKey)
    throw new Error(
      'SUPABASE_ANON_KEY must be a public anon JWT or sb_publishable_ key',
    );
  const port = Number(raw.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid DB_PORT');
  if (raw.SUPABASE_JWKS_URL) new URL(String(raw.SUPABASE_JWKS_URL));
  const emailWebhookKeys = [
    'AUTH_EMAIL_WEBHOOK_URL',
    'AUTH_EMAIL_TRANSPORT_URL',
    'EMAIL_TRANSPORT_URL',
    'MAILPIT_URL',
    'TEXTBEE_BASE_URL',
  ] as const;
  for (const emailKey of emailWebhookKeys) {
    if (
      raw[emailKey] !== undefined &&
      raw[emailKey] !== null &&
      raw[emailKey] !== ''
    ) {
      validateEmailWebhookUrl(raw[emailKey], emailKey);
    }
  }
  if (
    raw.TEXTBEE_TIMEOUT_MS !== undefined &&
    raw.TEXTBEE_TIMEOUT_MS !== null &&
    raw.TEXTBEE_TIMEOUT_MS !== ''
  ) {
    const timeout = Number(raw.TEXTBEE_TIMEOUT_MS);
    if (!Number.isInteger(timeout) || timeout <= 0) {
      throw new Error('Invalid TEXTBEE_TIMEOUT_MS');
    }
  }
  if (raw.RESEND_API_KEY) {
    const fromAddress =
      typeof raw.AUTH_EMAIL_FROM === 'string' ? raw.AUTH_EMAIL_FROM.trim() : '';
    if (!fromAddress) {
      throw new Error('AUTH_EMAIL_FROM is required when RESEND_API_KEY is set');
    }
    validateAuthEmailFrom(fromAddress);
  }
  if (raw.AUTH_PASSWORD_MIN_LENGTH !== undefined) {
    const minimum = String(raw.AUTH_PASSWORD_MIN_LENGTH);
    if (
      !/^[1-9][0-9]*$/.test(minimum) ||
      Number(minimum) < 8 ||
      Number(minimum) > 128
    )
      throw new Error('Invalid AUTH_PASSWORD_MIN_LENGTH');
  }
  if (raw.AUTH_OTP_HMAC_SECRET !== undefined) {
    if (
      typeof raw.AUTH_OTP_HMAC_SECRET !== 'string' ||
      !raw.AUTH_OTP_HMAC_SECRET.trim() ||
      Buffer.byteLength(raw.AUTH_OTP_HMAC_SECRET) < 32 ||
      raw.AUTH_OTP_HMAC_SECRET.startsWith('replace_')
    )
      throw new Error('AUTH_OTP_HMAC_SECRET requires at least 32 secret bytes');
  }
  readAbuseConfiguration(raw);
  trustedProxyCidrs(raw.AUTH_TRUSTED_PROXY_CIDRS);
  return raw;
}

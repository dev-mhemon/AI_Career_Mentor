export const operatingDefaults = {
  AUTH_OTP_TTL_SECONDS: 600,
  AUTH_OTP_MAX_FAILURES: 5,
  AUTH_RESEND_COOLDOWN_SECONDS: 60,
  AUTH_SEND_CONTACT_LIMIT: 3,
  AUTH_SEND_IP_LIMIT: 10,
  AUTH_SEND_WINDOW_SECONDS: 900,
  AUTH_LOGIN_MAX_FAILURES: 5,
  AUTH_LOGIN_WINDOW_SECONDS: 900,
  AUTH_LOGIN_LOCKOUT_SECONDS: 900,
  AUTH_REDIS_TIMEOUT_MS: 1000,
  AUTH_REDIS_RETRY_SECONDS: 5,
} as const;

export const abuseConfigurationNames = [
  'AUTH_REDIS_URL',
  'AUTH_HMAC_SECRET',
  ...Object.keys(operatingDefaults),
];

export interface AbuseConfiguration {
  url: string;
  secret: string;
  policy: { -readonly [K in keyof typeof operatingDefaults]: number };
}

/** Missing configuration keeps existing routes usable, but never enables a bypass. */
export function readAbuseConfiguration(
  raw: Record<string, unknown>,
): AbuseConfiguration | undefined {
  if (abuseConfigurationNames.every((key) => raw[key] === undefined))
    return undefined;
  let url: URL;
  try {
    url = new URL(String(raw.AUTH_REDIS_URL));
    if (
      !['redis:', 'rediss:'].includes(url.protocol) ||
      !url.hostname ||
      !/^\/(0|[1-9][0-9]*)?$|^$/.test(url.pathname) ||
      url.search ||
      url.hash
    )
      throw new Error();
  } catch {
    throw new Error('Invalid AUTH_REDIS_URL');
  }
  if (
    typeof raw.AUTH_HMAC_SECRET !== 'string' ||
    !raw.AUTH_HMAC_SECRET.trim() ||
    Buffer.byteLength(raw.AUTH_HMAC_SECRET) < 32 ||
    raw.AUTH_HMAC_SECRET.startsWith('replace_')
  )
    throw new Error('AUTH_HMAC_SECRET requires at least 32 secret bytes');
  const policy = { ...operatingDefaults } as AbuseConfiguration['policy'];
  for (const name of Object.keys(policy) as (keyof typeof policy)[]) {
    const value = raw[name] ?? policy[name];
    if (
      !/^[1-9][0-9]*$/.test(String(value)) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) > 2_147_483_647
    )
      throw new Error(`Invalid ${name}: expected a positive bounded integer`);
    policy[name] = Number(value);
  }
  return { url: url.toString(), secret: raw.AUTH_HMAC_SECRET, policy };
}

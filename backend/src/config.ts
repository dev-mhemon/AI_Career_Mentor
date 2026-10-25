import { readAbuseConfiguration } from './auth/abuse-control/config.js';
import { trustedProxyCidrs } from './auth/client-ip.js';

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
  if (raw.AUTH_PASSWORD_MIN_LENGTH !== undefined) {
    const minimum = String(raw.AUTH_PASSWORD_MIN_LENGTH);
    if (
      !/^[1-9][0-9]*$/.test(minimum) ||
      Number(minimum) < 8 ||
      Number(minimum) > 128
    )
      throw new Error('Invalid AUTH_PASSWORD_MIN_LENGTH');
  }
  readAbuseConfiguration(raw);
  trustedProxyCidrs(raw.AUTH_TRUSTED_PROXY_CIDRS);
  return raw;
}

import { validateConfiguration } from './config.js';
const base = {
  SUPABASE_URL: 'http://127.0.0.1:56321',
  SUPABASE_ANON_KEY: 'sb_publishable_synthetic',
  DB_HOST: '127.0.0.1',
  DB_PORT: '56322',
  DB_USER: 'postgres',
  DB_PASSWORD: 'synthetic',
  DB_NAME: 'postgres',
};
describe('Public runtime key boundary', () => {
  it('accepts publishable keys', () => {
    expect(validateConfiguration(base)).toBe(base);
  });
  it('accepts a legacy anon JWT format', () => {
    const key =
      'header.' +
      Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url') +
      '.signature';
    expect(() =>
      validateConfiguration({ ...base, SUPABASE_ANON_KEY: key }),
    ).not.toThrow();
  });
  it.each([
    'sb_secret_synthetic',
    'header.' +
      Buffer.from(JSON.stringify({ role: 'service_role' })).toString(
        'base64url',
      ) +
      '.signature',
    'invalid',
  ])('rejects backend-only or malformed key format', (key) => {
    expect(() =>
      validateConfiguration({ ...base, SUPABASE_ANON_KEY: key }),
    ).toThrow('public anon');
  });
  it('fails early on missing database configuration', () => {
    expect(() =>
      validateConfiguration({ ...base, DB_PASSWORD: undefined }),
    ).toThrow('DB_PASSWORD');
  });
  it('fails startup for an invalid trusted-proxy range', () => {
    expect(() =>
      validateConfiguration({
        ...base,
        AUTH_TRUSTED_PROXY_CIDRS: '0.0.0.0/33',
      }),
    ).toThrow('AUTH_TRUSTED_PROXY_CIDRS');
    expect(() =>
      validateConfiguration({
        ...base,
        AUTH_TRUSTED_PROXY_CIDRS: '0.0.0.0/1,128.0.0.0/1',
      }),
    ).toThrow('AUTH_TRUSTED_PROXY_CIDRS');
    expect(() =>
      validateConfiguration({
        ...base,
        AUTH_TRUSTED_PROXY_CIDRS: 'fe80::1%eth0',
      }),
    ).toThrow('AUTH_TRUSTED_PROXY_CIDRS');
  });
  it('accepts only an explicit backend registration minimum of 8 through 128', () => {
    for (const value of ['7', '129', '8.5', '08', 'not-a-number'])
      expect(() =>
        validateConfiguration({ ...base, AUTH_PASSWORD_MIN_LENGTH: value }),
      ).toThrow('AUTH_PASSWORD_MIN_LENGTH');
    expect(() =>
      validateConfiguration({ ...base, AUTH_PASSWORD_MIN_LENGTH: '12' }),
    ).not.toThrow();
  });
  it('validates optional AUTH_OTP_HMAC_SECRET for 32 secret bytes and no template placeholder', () => {
    for (const secret of [
      '',
      'short-secret',
      'replace_with_at_least_32_random_secret_bytes',
    ])
      expect(() =>
        validateConfiguration({ ...base, AUTH_OTP_HMAC_SECRET: secret }),
      ).toThrow('AUTH_OTP_HMAC_SECRET');
    expect(() =>
      validateConfiguration({
        ...base,
        AUTH_OTP_HMAC_SECRET: '01234567890123456789012345678901',
      }),
    ).not.toThrow();
  });
});

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
  it('validates optional email webhook transport URLs: enforces https for remote and allows http only for loopback', () => {
    const keys = [
      'AUTH_EMAIL_WEBHOOK_URL',
      'AUTH_EMAIL_TRANSPORT_URL',
      'EMAIL_TRANSPORT_URL',
      'MAILPIT_URL',
    ];

    for (const key of keys) {
      // Rejects malformed URL
      expect(() =>
        validateConfiguration({
          ...base,
          [key]: 'not-a-valid-url',
        }),
      ).toThrow(`Invalid ${key}: malformed URL`);

      // Rejects non-loopback http
      expect(() =>
        validateConfiguration({
          ...base,
          [key]: 'http://mail.example.com/dispatch',
        }),
      ).toThrow(
        `Invalid ${key}: non-loopback transport requires https: protocol`,
      );

      // Accepts loopback http (localhost, 127.0.0.1, [::1])
      expect(() =>
        validateConfiguration({
          ...base,
          [key]: 'http://localhost:8025/api/v1/send',
        }),
      ).not.toThrow();
      expect(() =>
        validateConfiguration({
          ...base,
          [key]: 'http://127.0.0.1:8025/api/v1/send',
        }),
      ).not.toThrow();
      expect(() =>
        validateConfiguration({
          ...base,
          [key]: 'http://[::1]:8025/api/v1/send',
        }),
      ).not.toThrow();

      // Accepts remote https
      expect(() =>
        validateConfiguration({
          ...base,
          [key]: 'https://mail.example.com/dispatch',
        }),
      ).not.toThrow();
    }
  });
  it('requires AUTH_EMAIL_FROM when RESEND_API_KEY is configured', () => {
    expect(() =>
      validateConfiguration({
        ...base,
        RESEND_API_KEY: 're_synthetic_key_123',
      }),
    ).toThrow('AUTH_EMAIL_FROM is required when RESEND_API_KEY is set');

    expect(() =>
      validateConfiguration({
        ...base,
        RESEND_API_KEY: 're_synthetic_key_123',
        AUTH_EMAIL_FROM: '   ',
      }),
    ).toThrow('AUTH_EMAIL_FROM is required when RESEND_API_KEY is set');

    expect(() =>
      validateConfiguration({
        ...base,
        RESEND_API_KEY: 're_synthetic_key_123',
        AUTH_EMAIL_FROM: 'not-an-email',
      }),
    ).toThrow(
      'AUTH_EMAIL_FROM must be an email address on a verified sender domain',
    );

    expect(() =>
      validateConfiguration({
        ...base,
        RESEND_API_KEY: 're_synthetic_key_123',
        AUTH_EMAIL_FROM: 'Career Mentor <not-an-email>',
      }),
    ).toThrow(
      'AUTH_EMAIL_FROM must be an email address on a verified sender domain',
    );

    expect(() =>
      validateConfiguration({
        ...base,
        RESEND_API_KEY: 're_synthetic_key_123',
        AUTH_EMAIL_FROM: 'Career Mentor <mentor@example.com',
      }),
    ).toThrow(
      'AUTH_EMAIL_FROM must be an email address on a verified sender domain',
    );

    // Rejects consecutive dots in domain
    expect(() =>
      validateConfiguration({
        ...base,
        RESEND_API_KEY: 're_synthetic_key_123',
        AUTH_EMAIL_FROM: 'mentor@example..com',
      }),
    ).toThrow(
      'AUTH_EMAIL_FROM must be an email address on a verified sender domain',
    );

    expect(() =>
      validateConfiguration({
        ...base,
        RESEND_API_KEY: 're_synthetic_key_123',
        AUTH_EMAIL_FROM: 'Career Mentor <mentor@example..com>',
      }),
    ).toThrow(
      'AUTH_EMAIL_FROM must be an email address on a verified sender domain',
    );

    // Rejects consecutive dots in local part
    expect(() =>
      validateConfiguration({
        ...base,
        RESEND_API_KEY: 're_synthetic_key_123',
        AUTH_EMAIL_FROM: 'men..tor@example.com',
      }),
    ).toThrow(
      'AUTH_EMAIL_FROM must be an email address on a verified sender domain',
    );

    expect(() =>
      validateConfiguration({
        ...base,
        RESEND_API_KEY: 're_synthetic_key_123',
        AUTH_EMAIL_FROM: '"Name" <men..tor@example.com>',
      }),
    ).toThrow(
      'AUTH_EMAIL_FROM must be an email address on a verified sender domain',
    );

    // Rejects invalid punctuation in domain
    expect(() =>
      validateConfiguration({
        ...base,
        RESEND_API_KEY: 're_synthetic_key_123',
        AUTH_EMAIL_FROM: 'mentor@ex,ample.com',
      }),
    ).toThrow(
      'AUTH_EMAIL_FROM must be an email address on a verified sender domain',
    );

    expect(() =>
      validateConfiguration({
        ...base,
        RESEND_API_KEY: 're_synthetic_key_123',
        AUTH_EMAIL_FROM: '"Name" <mentor@ex,ample.com>',
      }),
    ).toThrow(
      'AUTH_EMAIL_FROM must be an email address on a verified sender domain',
    );

    // Bare email format
    expect(() =>
      validateConfiguration({
        ...base,
        RESEND_API_KEY: 're_synthetic_key_123',
        AUTH_EMAIL_FROM: 'noreply@example.com',
      }),
    ).not.toThrow();

    // Resend named sender format
    expect(() =>
      validateConfiguration({
        ...base,
        RESEND_API_KEY: 're_synthetic_key_123',
        AUTH_EMAIL_FROM: 'Career Mentor <mentor@example.com>',
      }),
    ).not.toThrow();

    // Resend quoted named sender format
    expect(() =>
      validateConfiguration({
        ...base,
        RESEND_API_KEY: 're_synthetic_key_123',
        AUTH_EMAIL_FROM: '"Career Mentor" <mentor@example.com>',
      }),
    ).not.toThrow();
  });
});

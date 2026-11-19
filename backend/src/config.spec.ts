import {
  readAiGatewayConfiguration,
  readJobWorkerConfiguration,
  validateConfiguration,
} from './config.js';
import { readIdempotencyConfiguration } from './jobs/services/idempotency.service.js';
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
      'TEXTBEE_BASE_URL',
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
  it('validates optional TEXTBEE_TIMEOUT_MS as a positive integer', () => {
    for (const invalid of ['0', '-5', 'abc', '10.5']) {
      expect(() =>
        validateConfiguration({
          ...base,
          TEXTBEE_TIMEOUT_MS: invalid,
        }),
      ).toThrow('Invalid TEXTBEE_TIMEOUT_MS');
    }
    expect(() =>
      validateConfiguration({
        ...base,
        TEXTBEE_TIMEOUT_MS: '5000',
      }),
    ).not.toThrow();
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

  it('validates optional idempotency Redis configuration keys', () => {
    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_REDIS_URL: 'http://127.0.0.1:6379',
      }),
    ).toThrow('Invalid IDEMPOTENCY_REDIS_URL');

    expect(() =>
      validateConfiguration({
        ...base,
        REDIS_URL: 'redis://127.0.0.1:6379?foo=bar',
      }),
    ).toThrow('Invalid REDIS_URL');

    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_REDIS_EPOCH: '   ',
      }),
    ).toThrow('Invalid IDEMPOTENCY_REDIS_EPOCH');

    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_REDIS_EPOCH: 'replace_with_epoch',
      }),
    ).toThrow('Invalid IDEMPOTENCY_REDIS_EPOCH');

    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_TTL_SECONDS: '0',
      }),
    ).toThrow('Invalid IDEMPOTENCY_TTL_SECONDS');

    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_REDIS_TIMEOUT_MS: '-100',
      }),
    ).toThrow('Invalid IDEMPOTENCY_REDIS_TIMEOUT_MS');

    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_REDIS_RETRY_SECONDS: 'abc',
      }),
    ).toThrow('Invalid IDEMPOTENCY_REDIS_RETRY_SECONDS');

    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_REDIS_URL: 'redis://127.0.0.1:56379',
        IDEMPOTENCY_REDIS_EPOCH: 'epoch-2026-11-18',
        IDEMPOTENCY_TTL_SECONDS: '86400',
        IDEMPOTENCY_REDIS_TIMEOUT_MS: '1000',
        IDEMPOTENCY_REDIS_RETRY_SECONDS: '5',
      }),
    ).not.toThrow();
  });

  it('ignores blank idempotency Redis URL strings and preserves non-blank fallback precedence', () => {
    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_REDIS_URL: '',
        AUTH_REDIS_URL: 'redis://127.0.0.1:56379',
        AUTH_HMAC_SECRET: 'synthetic-auth-hmac-secret-32byt',
      }),
    ).not.toThrow();

    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_REDIS_URL: '   ',
        REDIS_URL: '   ',
      }),
    ).not.toThrow();

    expect(
      readIdempotencyConfiguration({
        IDEMPOTENCY_REDIS_URL: '',
        AUTH_REDIS_URL: 'redis://auth-fallback:6379',
        REDIS_URL: 'redis://generic-fallback:6379',
        IDEMPOTENCY_REDIS_EPOCH: 'epoch-1',
      })?.url,
    ).toBe('redis://auth-fallback:6379');

    expect(
      readIdempotencyConfiguration({
        IDEMPOTENCY_REDIS_URL: '   ',
        AUTH_REDIS_URL: '  ',
        REDIS_URL: 'redis://generic-fallback:6379',
        IDEMPOTENCY_REDIS_EPOCH: 'epoch-1',
      })?.url,
    ).toBe('redis://generic-fallback:6379');

    expect(
      readIdempotencyConfiguration({
        IDEMPOTENCY_REDIS_URL: '  redis://explicit-idempotency:6379  ',
        AUTH_REDIS_URL: 'redis://auth-fallback:6379',
        REDIS_URL: 'redis://generic-fallback:6379',
        IDEMPOTENCY_REDIS_EPOCH: 'epoch-1',
      })?.url,
    ).toBe('redis://explicit-idempotency:6379');
  });

  it('rejects malformed percent-encoded credentials in Redis URLs at startup', () => {
    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_REDIS_URL: 'redis://user:bad%ZZpass@127.0.0.1:6379',
      }),
    ).toThrow('Invalid IDEMPOTENCY_REDIS_URL');

    expect(() =>
      validateConfiguration({
        ...base,
        REDIS_URL: 'redis://bad%ZZuser:pass@127.0.0.1:6379',
      }),
    ).toThrow('Invalid REDIS_URL');

    expect(() =>
      validateConfiguration({
        ...base,
        AUTH_REDIS_URL: 'redis://user:bad%ZZpass@127.0.0.1:6379',
      }),
    ).toThrow('Invalid AUTH_REDIS_URL');
  });

  it('treats whitespace-only numeric H-IDEM overrides as unset and validates timeout vs TTL invariant', () => {
    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_TTL_SECONDS: '   ',
        IDEMPOTENCY_REDIS_TIMEOUT_MS: '   ',
        IDEMPOTENCY_REDIS_RETRY_SECONDS: '   ',
        AUTH_REDIS_TIMEOUT_MS: '1500',
        AUTH_REDIS_RETRY_SECONDS: '9',
        AUTH_REDIS_URL: 'redis://127.0.0.1:56379',
        AUTH_HMAC_SECRET: 'synthetic-auth-hmac-secret-32byt',
      }),
    ).not.toThrow();

    const parsed = readIdempotencyConfiguration({
      IDEMPOTENCY_REDIS_URL: 'redis://127.0.0.1:56379',
      IDEMPOTENCY_TTL_SECONDS: '   ',
      IDEMPOTENCY_REDIS_TIMEOUT_MS: '   ',
      IDEMPOTENCY_REDIS_RETRY_SECONDS: '   ',
      AUTH_REDIS_TIMEOUT_MS: '1500',
      AUTH_REDIS_RETRY_SECONDS: '9',
    });
    expect(parsed?.ttlSeconds).toBe(86_400);
    expect(parsed?.timeoutMs).toBe(1_500);
    expect(parsed?.retryAfterSeconds).toBe(9);

    // Non-blank invalid numeric override still fails fast
    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_REDIS_TIMEOUT_MS: '1.5',
      }),
    ).toThrow('Invalid IDEMPOTENCY_REDIS_TIMEOUT_MS');

    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_TTL_SECONDS: '1',
        IDEMPOTENCY_REDIS_TIMEOUT_MS: '1000',
      }),
    ).toThrow(
      'IDEMPOTENCY_TTL_SECONDS * 1000 must be greater than IDEMPOTENCY_REDIS_TIMEOUT_MS',
    );
  });

  it('validates only the selected H-IDEM Redis URL so unselected REDIS_URL with query params does not fail startup', () => {
    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_REDIS_URL: 'redis://127.0.0.1:56379',
        REDIS_URL: 'redis://127.0.0.1:6379?foo=bar',
      }),
    ).not.toThrow();

    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_REDIS_URL: '   ',
        AUTH_REDIS_URL: 'redis://127.0.0.1:56379',
        AUTH_HMAC_SECRET: 'synthetic-auth-hmac-secret-32byt',
        REDIS_URL: 'redis://127.0.0.1:6379?foo=bar',
      }),
    ).not.toThrow();

    expect(() =>
      validateConfiguration({
        ...base,
        IDEMPOTENCY_REDIS_URL: '   ',
        REDIS_URL: 'redis://127.0.0.1:6379?foo=bar',
      }),
    ).toThrow('Invalid REDIS_URL');
  });

  it('validates M04 durable job worker, reaper, and AI gateway operating bounds (R26, R13)', () => {
    expect(() =>
      validateConfiguration({
        ...base,
        JOB_WORKER_LEASE_SECONDS: '120',
        JOB_WORKER_HEARTBEAT_SECONDS: '30',
        JOB_WORKER_MAX_ATTEMPTS: '5',
        JOB_WORKER_MAX_AGE_SECONDS: '3600',
        JOB_REAPER_INTERVAL_SECONDS: '30',
        JOB_POLL_INTERVAL_MS: '1000',
        JOB_RETRY_AFTER_SECONDS: '3',
        AI_QUOTA_CACHE_TTL_MS: '5000',
        AI_EXECUTION_MODE: 'synthetic',
      }),
    ).not.toThrow();

    expect(
      readJobWorkerConfiguration({
        JOB_WORKER_LEASE_SECONDS: '   ',
        JOB_WORKER_HEARTBEAT_SECONDS: '   ',
        JOB_WORKER_MAX_ATTEMPTS: '   ',
        JOB_WORKER_MAX_AGE_SECONDS: '   ',
        JOB_REAPER_INTERVAL_SECONDS: '   ',
      }),
    ).toEqual({
      leaseSeconds: 120,
      heartbeatSeconds: 30,
      maxAttempts: 5,
      maxAgeSeconds: 3_600,
      reaperIntervalSeconds: 30,
      pollIntervalMs: 1_000,
      retryAfterSeconds: 3,
    });

    expect(
      readAiGatewayConfiguration({
        AI_QUOTA_CACHE_TTL_MS: '   ',
        AI_EXECUTION_MODE: '   ',
      }),
    ).toEqual({
      quotaCacheTtlMs: 5_000,
      executionMode: 'real_user',
    });

    expect(() =>
      validateConfiguration({
        ...base,
        JOB_WORKER_LEASE_SECONDS: '30',
        JOB_WORKER_HEARTBEAT_SECONDS: '30',
      }),
    ).toThrow(
      'JOB_WORKER_HEARTBEAT_SECONDS must be less than JOB_WORKER_LEASE_SECONDS',
    );

    expect(() =>
      validateConfiguration({
        ...base,
        JOB_WORKER_MAX_ATTEMPTS: '6',
      }),
    ).toThrow('Invalid JOB_WORKER_MAX_ATTEMPTS');

    expect(() =>
      validateConfiguration({
        ...base,
        JOB_WORKER_MAX_AGE_SECONDS: '3601',
      }),
    ).toThrow('Invalid JOB_WORKER_MAX_AGE_SECONDS');

    expect(() =>
      validateConfiguration({
        ...base,
        JOB_REAPER_INTERVAL_SECONDS: '31',
      }),
    ).toThrow('Invalid JOB_REAPER_INTERVAL_SECONDS');

    expect(() =>
      validateConfiguration({
        ...base,
        AI_QUOTA_CACHE_TTL_MS: '5001',
      }),
    ).toThrow('Invalid AI_QUOTA_CACHE_TTL_MS');

    expect(() =>
      validateConfiguration({
        ...base,
        AI_EXECUTION_MODE: 'free_tier',
      }),
    ).toThrow('Invalid AI_EXECUTION_MODE');
  });
});

import { createHmac, randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { createServer } from 'node:net';
import { HttpException } from '@nestjs/common';
import { AuthAbuseControl } from '../src/auth/abuse-control/abuse-control.service.js';
import type { Contact } from '../src/auth/abuse-control/abuse-control.service.js';
import { readAbuseConfiguration } from '../src/auth/abuse-control/config.js';
import { ApiExceptionFilter } from '../src/common/http.js';
import type { ArgumentsHost } from '@nestjs/common';

const url = process.env.AUTH_ABUSE_TEST_REDIS_URL;
if (!url || process.env.AUTH_ABUSE_TEST_DISPOSABLE !== 'yes')
  throw new Error('Explicit disposable Redis test configuration is required');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
  throw new Error(
    'Redis integration tests require a loopback disposable service',
  );

const admin = createClient({ url, socket: { reconnectStrategy: false } });
admin.on('error', () => undefined);
const services: AuthAbuseControl[] = [];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const contact = (identifier = `${randomUUID()}@example.invalid`): Contact => ({
  channel: 'email',
  identifier,
});
const ip = '192.0.2.1';

/** Give each case isolated synthetic keys while two independent clients share its policy authority. */
function fixture(overrides: Record<string, unknown> = {}) {
  const secret = randomUUID();
  const config = readAbuseConfiguration({
    AUTH_REDIS_URL: url,
    AUTH_HMAC_SECRET: secret,
    ...overrides,
  })!;
  const a = new AuthAbuseControl(config);
  const b = new AuthAbuseControl(config);
  services.push(a, b);
  const hmac = (kind: string, value: unknown) =>
    createHmac('sha256', secret)
      .update(JSON.stringify([kind, value]))
      .digest('hex');
  const digest = (c: Contact) => hmac('contact', [c.channel, c.identifier]);
  const key = (kind: string, c: Contact) => `auth:v1:${kind}:${digest(c)}`;
  const loginKey = (kind: string, c: Contact) =>
    `auth:v1:login:${kind}:${hmac('login-pair', [digest(c), hmac('ip', ip)])}`;
  return { a, b, config, key, loginKey };
}

/** Require a contract exception with the expected status/code instead of accepting any rejected promise. */
async function rejected(
  promise: Promise<unknown>,
  status: number,
  code: string,
) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HttpException);
  const error = caught as HttpException;
  expect(error.getStatus()).toBe(status);
  expect(error.getResponse()).toMatchObject({ code });
  return error;
}

beforeAll(async () => {
  await admin.connect();
});
afterEach(() => {
  services.splice(0).forEach((service) => service.onModuleDestroy());
});
afterAll(() => {
  if (admin.isOpen) admin.destroy();
});

describe('R31 against real disposable Redis, independent application clients', () => {
  it('enforces default send limits, first-write expiry and delivery-failure quota', async () => {
    const { a, b, key } = fixture();
    const c = contact();
    await a.reserveSend(c, ip);
    expect(await admin.pTTL(key('send:contact', c))).toBeGreaterThan(899000);
    const first = await admin.pTTL(key('send:contact', c));
    await rejected(b.reserveSend(c, ip), 429, 'RESEND_COOLDOWN_ACTIVE');
    for (let i = 0; i < 2; i++) {
      await admin.pExpire(key('send:cooldown', c), 1);
      await pause(10);
      await b.reserveSend(c, ip);
    }
    expect(await admin.get(key('send:contact', c))).toBe('3');
    expect(await admin.pTTL(key('send:contact', c))).toBeLessThan(first);
    await admin.pExpire(key('send:cooldown', c), 1);
    await pause(10);
    await rejected(a.reserveSend(c, ip), 429, 'OTP_LIMIT_EXCEEDED');
    expect(await admin.get(key('send:contact', c))).toBe('3');
  });

  it('atomically admits exactly ten default shared-IP sends across clients', async () => {
    const { a, b } = fixture();
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) =>
        (i % 2 ? a : b).reserveSend(contact(), ip),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    const failures = results.filter((r) => r.status === 'rejected');
    for (const r of failures)
      expect((r.reason as HttpException).getResponse()).toMatchObject({
        code: 'OTP_LIMIT_EXCEEDED',
      });
    await expect(b.reserveSend(contact(), '192.0.2.2')).resolves.toEqual({
      retryAfterSeconds: 60,
    });
  });

  it('does not bypass cooldown by using another instance or IP', async () => {
    const { a, b } = fixture();
    const c = contact();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? a : b).reserveSend(c, `192.0.2.${i + 1}`),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('honors configured send limits, canonical IP and recovers on real expiry', async () => {
    const { a, b, key } = fixture({
      AUTH_SEND_IP_LIMIT: 2,
      AUTH_SEND_CONTACT_LIMIT: 1,
      AUTH_SEND_WINDOW_SECONDS: 1,
      AUTH_RESEND_COOLDOWN_SECONDS: 1,
    });
    const c = contact();
    await a.reserveSend(c, '2001:db8::1');
    await admin.pExpire(key('send:cooldown', c), 1);
    await pause(10);
    await rejected(b.reserveSend(c, '192.0.2.2'), 429, 'OTP_LIMIT_EXCEEDED');
    await b.reserveSend(contact(), '2001:0db8:0:0:0:0:0:1');
    await rejected(
      a.reserveSend(contact(), '2001:db8::1'),
      429,
      'OTP_LIMIT_EXCEEDED',
    );
    await pause(1100);
    await expect(b.reserveSend(c, '2001:db8::1')).resolves.toEqual({
      retryAfterSeconds: 1,
    });
  });

  it('fails closed if independent instances disagree on the shared policy', async () => {
    const { a, config } = fixture();
    const b = new AuthAbuseControl({
      ...config,
      policy: { ...config.policy, AUTH_SEND_CONTACT_LIMIT: 4 },
    });
    services.push(b);
    await a.reserveSend(contact(), ip);
    await rejected(b.reserveSend(contact(), ip), 503, 'SERVICE_UNAVAILABLE');
    await expect(a.reserveSend(contact(), ip)).resolves.toEqual({
      retryAfterSeconds: 60,
    });
  });

  it('keeps mixed policies closed while old traffic continues and permits cutover after the quiet lifetime', async () => {
    const { a, config, key } = fixture({
      AUTH_OTP_TTL_SECONDS: 2,
      AUTH_RESEND_COOLDOWN_SECONDS: 2,
      AUTH_SEND_WINDOW_SECONDS: 2,
      AUTH_LOGIN_WINDOW_SECONDS: 2,
      AUTH_LOGIN_LOCKOUT_SECONDS: 2,
    });
    const b = new AuthAbuseControl({
      ...config,
      policy: { ...config.policy, AUTH_SEND_CONTACT_LIMIT: 4 },
    });
    services.push(b);
    const original = contact();
    await a.reserveSend(original, ip);
    await pause(1200);
    await a.reserveSend(contact(), ip);
    await pause(1100);
    // The original counter has expired, but more recent old-policy state is still protected.
    expect(await admin.exists(key('send:contact', original))).toBe(0);
    const error = await rejected(
      b.reserveSend(contact(), ip),
      503,
      'SERVICE_UNAVAILABLE',
    );
    expect(error.getResponse()).toMatchObject({ retryAfterSeconds: 1 });
    await pause(1100);
    await expect(b.reserveSend(contact(), ip)).resolves.toEqual({
      retryAfterSeconds: 2,
    });
    // A late instance with the old settings must not join the new policy's live state.
    await rejected(a.reserveSend(contact(), ip), 503, 'SERVICE_UNAVAILABLE');
  });

  it('fails closed on fixture counter state whose required expiry was lost', async () => {
    const { a, key } = fixture();
    const c = contact();
    await a.reserveSend(c, ip);
    await admin.pExpire(key('send:cooldown', c), 1);
    await pause(10);
    await admin.persist(key('send:contact', c));
    await rejected(a.reserveSend(c, ip), 503, 'SERVICE_UNAVAILABLE');
  });

  it('enforces five failures, unchanged challenge TTL, one-time consume and generation replacement', async () => {
    const { a, b, key } = fixture();
    const c = contact();
    const challenge = await a.issueChallenge(c);
    expect(challenge.expiresInSeconds).toBe(600);
    const first = await admin.pTTL(key('challenge', c));
    await pause(30);
    for (let i = 1; i <= 5; i++)
      await rejected(
        b.verifyChallenge(c, '000000', async () => false),
        i === 5 ? 429 : 422,
        i === 5
          ? 'VERIFICATION_ATTEMPTS_EXCEEDED'
          : 'VERIFICATION_CODE_INVALID',
      );
    const provider = vi.fn(async () => true);
    await rejected(
      a.verifyChallenge(c, '000000', provider),
      429,
      'VERIFICATION_ATTEMPTS_EXCEEDED',
    );
    expect(provider).not.toHaveBeenCalled();
    expect(await admin.pTTL(key('challenge', c))).toBeLessThan(first - 20);
    await b.issueChallenge(c);
    await a.verifyChallenge(c, '000000', provider);
    await rejected(
      b.verifyChallenge(c, '000000', provider),
      409,
      'ALREADY_VERIFIED',
    );
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('serializes competing verification callbacks and prevents an old generation consuming a resend', async () => {
    const { a, b } = fixture();
    const c = contact();
    await a.issueChallenge(c);
    let release!: (valid: boolean) => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = a.verifyChallenge(c, '000000', () => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    await running;
    const provider = vi.fn(async () => true);
    await rejected(
      b.verifyChallenge(c, '000000', provider),
      503,
      'SERVICE_UNAVAILABLE',
    );
    await b.issueChallenge(c);
    release(true);
    await rejected(first, 410, 'VERIFICATION_CODE_EXPIRED');
    await b.verifyChallenge(c, '000000', provider);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('honors provider validity/configured failures and recovers after challenge expiry', async () => {
    const { a, b } = fixture({
      AUTH_OTP_TTL_SECONDS: 2,
      AUTH_OTP_MAX_FAILURES: 1,
    });
    const c = contact();
    const challenge = await a.issueChallenge(c, 1);
    expect(challenge.expiresInSeconds).toBe(1);
    await rejected(
      a.verifyChallenge(c, '000000', async () => false),
      429,
      'VERIFICATION_ATTEMPTS_EXCEEDED',
    );
    await pause(1100);
    await rejected(
      b.verifyChallenge(c, '000000', async () => true),
      410,
      'VERIFICATION_CODE_EXPIRED',
    );
    const next = await b.issueChallenge(c, 30);
    expect(next.expiresInSeconds).toBe(2);
    await b.verifyChallenge(c, '000000', async () => true);
  });

  it('locks on fifth login failure, leaves other identifier/IP pairs usable and does not slide lock TTL', async () => {
    const { a, b, loginKey } = fixture();
    const c = contact();
    for (let i = 1; i <= 5; i++)
      await rejected(
        (i % 2 ? a : b).login(c, ip, async () => ({ success: false })),
        i === 5 ? 423 : 401,
        i === 5 ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
      );
    const provider = vi.fn(async () => ({
      success: true as const,
      value: 'synthetic-session',
    }));
    const first = await rejected(
      b.login(c, ip, provider),
      423,
      'ACCOUNT_LOCKED',
    );
    expect(first.getResponse()).toMatchObject({ retryAfterSeconds: 900 });
    const lockTtl = await admin.pTTL(loginKey('lock', c));
    expect(lockTtl).toBeGreaterThan(899000);
    await expect(b.login(contact(), ip, provider)).resolves.toBe(
      'synthetic-session',
    );
    await expect(b.login(c, '192.0.2.2', provider)).resolves.toBe(
      'synthetic-session',
    );
    expect(provider).toHaveBeenCalledTimes(2);
    await pause(20);
    const again = await rejected(
      a.login(c, ip, provider),
      423,
      'ACCOUNT_LOCKED',
    );
    expect(
      (again.getResponse() as { retryAfterSeconds: number }).retryAfterSeconds,
    ).toBeLessThanOrEqual(900);
    expect(await admin.pTTL(loginKey('lock', c))).toBeLessThan(lockTtl - 10);
  });

  it('does not extend the login failure window on subsequent failures', async () => {
    const { a, b, loginKey } = fixture();
    const c = contact();
    await rejected(
      a.login(c, ip, async () => ({ success: false })),
      401,
      'INVALID_CREDENTIALS',
    );
    const first = await admin.pTTL(loginKey('failures', c));
    expect(first).toBeGreaterThan(899000);
    await pause(30);
    await rejected(
      b.login(c, ip, async () => ({ success: false })),
      401,
      'INVALID_CREDENTIALS',
    );
    expect(await admin.pTTL(loginKey('failures', c))).toBeLessThan(first - 20);
    expect(await admin.get(loginKey('failures', c))).toBe('2');
  });

  it('keeps phone contacts independent and canonicalizes IPv4-mapped IPv6 for shared-IP limits', async () => {
    const { a, b } = fixture({ AUTH_SEND_IP_LIMIT: 1 });
    const phone: Contact = { channel: 'phone', identifier: '+8801700000001' };
    await a.reserveSend(phone, ip);
    await rejected(
      b.reserveSend(contact(), '::ffff:192.0.2.1'),
      429,
      'OTP_LIMIT_EXCEEDED',
    );
    await b.reserveSend(contact(), '192.0.2.2');
    await a.issueChallenge(phone);
    await a.verifyChallenge(phone, '000000', async () => true);
    await rejected(
      b.verifyChallenge(contact(), '000000', async () => true),
      410,
      'VERIFICATION_CODE_EXPIRED',
    );
  });

  it('rejects malformed codes before invoking a provider or consuming attempts', async () => {
    const { a, key } = fixture();
    const c = contact();
    await a.issueChallenge(c);
    const provider = vi.fn(async () => true);
    for (const code of ['12345', '1234567', 'abcdef', '১২৩৪৫৬', ' 123456'])
      await rejected(
        a.verifyChallenge(c, code, provider),
        422,
        'VALIDATION_FAILED',
      );
    expect(provider).not.toHaveBeenCalled();
    expect(await admin.hGet(key('challenge', c), 'failures')).toBe('0');
    await a.verifyChallenge(c, '000000', provider);
    expect(provider).toHaveBeenCalledWith('000000');
  });

  it('allows at most one success under simultaneous valid verification', async () => {
    const { a, b } = fixture();
    const c = contact();
    await a.issueChallenge(c);
    const provider = vi.fn(async () => {
      await pause(30);
      return true;
    });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? a : b).verifyChallenge(c, '000000', provider),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(provider).toHaveBeenCalledTimes(1);
    await rejected(
      a.verifyChallenge(c, '000000', provider),
      409,
      'ALREADY_VERIFIED',
    );
  });

  it('bounds real command stalls and recovers with a fresh connection without replaying the command', async () => {
    const { a } = fixture({ AUTH_REDIS_TIMEOUT_MS: 50 });
    await a.reserveSend(contact(), ip);
    await admin.sendCommand(['CLIENT', 'PAUSE', '200', 'ALL']);
    await rejected(a.reserveSend(contact(), ip), 503, 'SERVICE_UNAVAILABLE');
    await pause(250);
    await expect(a.reserveSend(contact(), '192.0.2.2')).resolves.toEqual({
      retryAfterSeconds: 60,
    });
  });

  it('quarantines ambiguous login outcomes and recovers after reservation expiry', async () => {
    const { a, b } = fixture({ AUTH_LOGIN_WINDOW_SECONDS: 1 });
    const c = contact();
    await rejected(
      a.login(c, ip, async () => {
        throw new Error('synthetic-private-provider-error');
      }),
      503,
      'SERVICE_UNAVAILABLE',
    );
    const provider = vi.fn(async () => ({
      success: true as const,
      value: true,
    }));
    await rejected(b.login(c, ip, provider), 503, 'SERVICE_UNAVAILABLE');
    expect(provider).not.toHaveBeenCalled();
    await pause(1100);
    await expect(b.login(c, ip, provider)).resolves.toBe(true);
  });

  it('fences a late login completion after expiry without releasing a newer reservation', async () => {
    const { a, b, loginKey } = fixture({ AUTH_LOGIN_WINDOW_SECONDS: 1 });
    const c = contact();
    let releaseOld!: () => void;
    let oldStarted!: () => void;
    const oldRunning = new Promise<void>((resolve) => {
      oldStarted = resolve;
    });
    const old = a.login(c, ip, async () => {
      oldStarted();
      await new Promise<void>((resolve) => {
        releaseOld = resolve;
      });
      return { success: true, value: 'synthetic-old-result' };
    });
    await oldRunning;
    await pause(1100);
    let releaseNew!: () => void;
    let newStarted!: () => void;
    const newRunning = new Promise<void>((resolve) => {
      newStarted = resolve;
    });
    const current = b.login(c, ip, async () => {
      newStarted();
      await new Promise<void>((resolve) => {
        releaseNew = resolve;
      });
      return { success: false };
    });
    await newRunning;
    releaseOld();
    await rejected(old, 503, 'SERVICE_UNAVAILABLE');
    const provider = vi.fn(async () => ({ success: false as const }));
    await rejected(a.login(c, ip, provider), 503, 'SERVICE_UNAVAILABLE');
    expect(provider).not.toHaveBeenCalled();
    releaseNew();
    await rejected(current, 401, 'INVALID_CREDENTIALS');
    expect(await admin.get(loginKey('failures', c))).toBe('1');
    await expect(
      a.login(c, ip, async () => ({ success: true, value: true })),
    ).resolves.toBe(true);
  });

  it('honors login overrides, failure-window expiry, successful reset and lockout expiry', async () => {
    const { a, b } = fixture({
      AUTH_LOGIN_MAX_FAILURES: 2,
      AUTH_LOGIN_WINDOW_SECONDS: 1,
      AUTH_LOGIN_LOCKOUT_SECONDS: 1,
    });
    const c = contact();
    const bad = async () => ({ success: false as const });
    const good = async () => ({ success: true as const, value: true });
    await rejected(a.login(c, ip, bad), 401, 'INVALID_CREDENTIALS');
    await pause(1100);
    await rejected(b.login(c, ip, bad), 401, 'INVALID_CREDENTIALS');
    await a.login(c, ip, good);
    await rejected(b.login(c, ip, bad), 401, 'INVALID_CREDENTIALS');
    await rejected(a.login(c, ip, bad), 423, 'ACCOUNT_LOCKED');
    await pause(1100);
    await expect(b.login(c, ip, good)).resolves.toBe(true);
  });

  it('serializes concurrent login attempts before calling the provider', async () => {
    const { a, b } = fixture();
    const c = contact();
    let release!: () => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = a.login(c, ip, async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { success: false };
    });
    await running;
    const provider = vi.fn(async () => ({ success: false as const }));
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () => b.login(c, ip, provider)),
    );
    expect(
      attempts.every(
        (r) =>
          r.status === 'rejected' &&
          (r.reason as HttpException).getStatus() === 503,
      ),
    ).toBe(true);
    expect(provider).not.toHaveBeenCalled();
    release();
    await rejected(first, 401, 'INVALID_CREDENTIALS');
  });

  it('fails closed on a real connection failure, emits retry headers and hides sensitive values', async () => {
    // Reserve then release a loopback port, yielding a real refused connection without touching Redis state.
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected a loopback TCP address');
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    const failedUrl = new URL(url!);
    failedUrl.hostname = '127.0.0.1';
    failedUrl.port = String(address.port);
    failedUrl.password = 'synthetic-invalid-credential';
    const { a } = fixture({
      AUTH_REDIS_URL: failedUrl.toString(),
      AUTH_REDIS_RETRY_SECONDS: 7,
    });
    const c = contact();
    const provider = vi.fn(async () => true);
    const logs = (['error', 'warn', 'log', 'info', 'debug'] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      const error = await rejected(
        a.reserveSend(c, ip),
        503,
        'SERVICE_UNAVAILABLE',
      );
      await rejected(
        a.verifyChallenge(c, '000000', provider),
        503,
        'SERVICE_UNAVAILABLE',
      );
      await rejected(
        a.login(c, ip, async () => {
          provider();
          return { success: false };
        }),
        503,
        'SERVICE_UNAVAILABLE',
      );
      expect(provider).not.toHaveBeenCalled();
      const response = {
        getHeader: vi.fn(() => 'synthetic-request'),
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      new ApiExceptionFilter().catch(error, {
        switchToHttp: () => ({ getResponse: () => response }),
      } as unknown as ArgumentsHost);
      expect(response.setHeader).toHaveBeenCalledWith('Retry-After', 7);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'SERVICE_UNAVAILABLE',
            retryable: true,
            retryAfterSeconds: 7,
          }),
        }),
      );
      const output = JSON.stringify(response.json.mock.calls);
      expect(output).not.toContain(c.identifier);
      expect(output).not.toContain('synthetic-invalid-credential');
      expect(output).not.toContain(url!);
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally {
      logs.forEach((log) => log.mockRestore());
    }
  });

  it('stores no raw contact/IP/code/password/token/secret and quarantines ambiguous provider failures', async () => {
    const { a, b, config, key } = fixture();
    const c = contact();
    await a.reserveSend(c, ip);
    await a.issueChallenge(c);
    await rejected(
      a.verifyChallenge(c, '000000', async () => {
        throw new Error('synthetic-private-code-password-token');
      }),
      503,
      'SERVICE_UNAVAILABLE',
    );
    const provider = vi.fn(async () => true);
    await rejected(
      b.verifyChallenge(c, '000000', provider),
      503,
      'SERVICE_UNAVAILABLE',
    );
    expect(provider).not.toHaveBeenCalled();
    const keys = await admin.keys('auth:v1:*');
    const state = JSON.stringify(await admin.hGetAll(key('challenge', c)));
    for (const sensitive of [
      c.identifier,
      ip,
      config.secret,
      'synthetic-private-code-password-token',
    ]) {
      expect(keys.join(' ')).not.toContain(sensitive);
      expect(state).not.toContain(sensitive);
    }
    expect(state).not.toMatch(/otp|password|token|code/i);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      a.onModuleDestroy();
      await rejected(a.reserveSend(c, ip), 503, 'SERVICE_UNAVAILABLE');
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

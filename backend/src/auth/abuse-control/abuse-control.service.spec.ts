import { HttpException } from '@nestjs/common';
import { AuthAbuseControl } from './abuse-control.service.js';
import { readAbuseConfiguration } from './config.js';
import { ipQuotaScript } from './scripts.js';

describe('Unconfigured abuse controls never bypass shared enforcement', () => {
  it('fails closed before send, verification or login work', async () => {
    const service = new AuthAbuseControl(undefined);
    const contact = {
      channel: 'email' as const,
      identifier: 'synthetic@example.invalid',
    };
    const provider = vi.fn();
    for (const call of [
      () => service.reserveSend(contact, '192.0.2.1'),
      () => service.issueChallenge(contact),
      () => service.verifyChallenge(contact, '000000', provider),
      () => service.login(contact, '192.0.2.1', provider),
      () => service.enforceIpQuota('forgot-password', '192.0.2.1'),
      () => service.enforceIpQuota('login', '192.0.2.1'),
    ]) {
      try {
        await call();
        expect.fail('Expected fail-closed response');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(503);
        expect((error as HttpException).getResponse()).toMatchObject({
          code: 'SERVICE_UNAVAILABLE',
          retryable: true,
          retryAfterSeconds: 5,
        });
      }
    }
    expect(provider).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });
  it('rejects noncanonical contact/IP inputs without exposing their values or opening Redis', async () => {
    const service = new AuthAbuseControl(
      readAbuseConfiguration({
        AUTH_REDIS_URL: 'redis://127.0.0.1:1',
        AUTH_HMAC_SECRET: 'synthetic-secret-with-at-least-32-bytes',
      }),
    );
    const contact = {
      channel: 'email' as const,
      identifier: 'synthetic@example.invalid',
    };
    await expect(
      service.reserveSend(contact, 'fe80::1%synthetic-private-zone'),
    ).rejects.toThrow(
      new Error('Auth abuse control requires a validated client IP'),
    );
    await expect(
      service.reserveSend(
        { ...contact, identifier: 'SYNTHETIC@example.invalid' },
        '192.0.2.1',
      ),
    ).rejects.toThrow(
      new Error('Auth abuse control requires a normalized contact'),
    );
    service.onModuleDestroy();
  });

  it('evaluates abort phase when verify callback throws, clearing busy reservation', async () => {
    const service = new AuthAbuseControl(
      readAbuseConfiguration({
        AUTH_REDIS_URL: 'redis://127.0.0.1:1',
        AUTH_HMAC_SECRET: 'synthetic-secret-with-at-least-32-bytes',
      }),
    );
    const contact = {
      channel: 'email' as const,
      identifier: 'synthetic@example.invalid',
    };
    const evaluateSpy = vi
      .spyOn(service as any, 'evaluate')
      .mockResolvedValueOnce([0, 600000, 'test-generation'])
      .mockResolvedValueOnce([0, 600000]);

    const error = new HttpException({ code: 'OTP_EXPIRED' }, 410);
    await expect(
      service.verifyChallenge(contact, '123456', async () => {
        throw error;
      }),
    ).rejects.toThrow(error);

    expect(evaluateSpy).toHaveBeenCalledTimes(2);
    expect(evaluateSpy.mock.calls[1][2]).toEqual([
      'test-generation',
      expect.any(String),
      'abort',
      5,
    ]);
    service.onModuleDestroy();
  });

  it('bounds ipQuotaScript loop to explicit counter count so trailing policyKey is never checked as a counter', async () => {
    const config = readAbuseConfiguration({
      AUTH_REDIS_URL: 'redis://127.0.0.1:1',
      AUTH_HMAC_SECRET: 'synthetic-secret-with-at-least-32-bytes',
    });
    const service = new AuthAbuseControl(config);
    const evaluateSpy = vi
      .spyOn(service as any, 'evaluate')
      .mockResolvedValue([0, 0]);

    expect(ipQuotaScript).toContain('local counterCount = tonumber(ARGV[4])');
    expect(ipQuotaScript).toContain('for i = 1, counterCount do');
    expect(ipQuotaScript).not.toContain('#KEYS');

    await service.enforceIpQuota('forgot-password', '192.0.2.1');
    expect(evaluateSpy).toHaveBeenLastCalledWith(
      ipQuotaScript,
      [
        expect.stringMatching(/^auth:v1:ip:forgot-password:/),
        expect.stringMatching(/^auth:v1:send:ip:/),
      ],
      [
        config!.policy.AUTH_SEND_IP_LIMIT,
        config!.policy.AUTH_SEND_WINDOW_SECONDS * 1000,
        2,
        2,
      ],
    );

    await service.enforceIpQuota('login', '192.0.2.1');
    expect(evaluateSpy).toHaveBeenLastCalledWith(
      ipQuotaScript,
      [expect.stringMatching(/^auth:v1:ip:login:/)],
      [
        config!.policy.AUTH_SEND_IP_LIMIT * 2,
        config!.policy.AUTH_LOGIN_WINDOW_SECONDS * 1000,
        10,
        1,
      ],
    );
    service.onModuleDestroy();
  });
});

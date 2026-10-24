import { HttpException } from '@nestjs/common';
import { AuthAbuseControl } from './abuse-control.service.js';
import { readAbuseConfiguration } from './config.js';

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
});

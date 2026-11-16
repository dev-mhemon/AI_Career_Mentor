import { HttpException } from '@nestjs/common';
import { AuthAbuseControl } from './abuse-control.service.js';
import { readAbuseConfiguration } from './config.js';
import { ipQuotaScript } from './scripts.js';

interface MockRedisCounter {
  count?: number;
  pttl: number;
}

/**
 * Compile and execute `ipQuotaScript` directly against an in-memory Redis mock
 * so Lua control-flow changes (including loop bounds and maxTtl aggregation)
 * are tested behaviorally in Vitest without needing a live Redis process.
 */
function executeIpQuotaLua(
  script: string,
  keys: string[],
  args: (string | number)[],
  store: Map<string, MockRedisCounter>,
): [number, number] {
  const stringArgs = args.map(String);
  const luaIndex = <T>(items: T[]) =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === 'string' && /^\d+$/.test(prop)) {
            return items[Number(prop) - 1];
          }
          return undefined;
        },
      },
    );

  const redis = {
    call(command: string, key: string, value?: string | number) {
      const entry = store.get(key);
      switch (command) {
        case 'PTTL':
          return entry ? entry.pttl : -2;
        case 'GET':
          return entry?.count !== undefined ? String(entry.count) : undefined;
        case 'INCR': {
          const next = (entry?.count ?? 0) + 1;
          store.set(key, { count: next, pttl: entry?.pttl ?? -1 });
          return next;
        }
        case 'PEXPIRE': {
          const current = store.get(key);
          if (current) {
            current.pttl = Number(value);
          }
          return 1;
        }
        default:
          throw new Error(`Unsupported mocked Redis command: ${command}`);
      }
    },
  };

  const translateExpr = (expr: string): string =>
    expr
      .replace(/\{([^{}]+)\}/g, '[$1]')
      .replace(/~=/g, '!==')
      .replace(/==/g, '===')
      .replace(/\band\b/g, '&&')
      .replace(/\bor\b/g, '||');

  const jsLines: string[] = [];
  for (const rawLine of script.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('--')) continue;

    const forMatch = /^for\s+(\w+)\s*=\s*(.+?),\s*(.+?)\s+do$/.exec(line);
    if (forMatch) {
      const [, idx, start, stop] = forMatch;
      jsLines.push(
        `for (let ${idx} = ${translateExpr(start)}; ${idx} <= ${translateExpr(stop)}; ${idx}++) {`,
      );
      continue;
    }

    const inlineIf = /^if\s+(.+?)\s+then\s+(.+?)\s+end$/.exec(line);
    if (inlineIf) {
      const [, cond, stmt] = inlineIf;
      jsLines.push(`if (${translateExpr(cond)}) { ${translateExpr(stmt)}; }`);
      continue;
    }

    const blockIf = /^if\s+(.+?)\s+then$/.exec(line);
    if (blockIf) {
      jsLines.push(`if (${translateExpr(blockIf[1])}) {`);
      continue;
    }

    if (line === 'end') {
      jsLines.push('}');
      continue;
    }

    const localMatch = /^local\s+(\w+)\s*=\s*(.+)$/.exec(line);
    if (localMatch) {
      jsLines.push(`let ${localMatch[1]} = ${translateExpr(localMatch[2])};`);
      continue;
    }

    if (line.startsWith('return ') || /^[A-Za-z_]\w*\s*=/.test(line)) {
      jsLines.push(`${translateExpr(line)};`);
      continue;
    }

    throw new Error(`Unsupported Lua line in test evaluator: ${line}`);
  }

  const fn = new Function(
    'KEYS',
    'ARGV',
    'redis',
    'tonumber',
    'math',
    jsLines.join('\n'),
  ) as (
    KEYS: unknown,
    ARGV: unknown,
    redis: unknown,
    tonumber: (v: unknown) => number,
    math: { max: (...n: number[]) => number },
  ) => [number, number];

  return fn(
    luaIndex(keys),
    luaIndex(stringArgs),
    redis,
    (v: unknown) => (v === undefined || v === null ? NaN : Number(v)),
    { max: Math.max },
  );
}

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
    expect(ipQuotaScript).toContain('maxTtl = math.max(maxTtl, remaining)');
    expect(ipQuotaScript).toContain('if maxTtl > 0 then');
    expect(ipQuotaScript).toContain('if ttl == -1 then return {6, 1000} end');

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

  it('executes ipQuotaScript to return maximum remaining TTL across saturated counters regardless of key order', async () => {
    const config = readAbuseConfiguration({
      AUTH_REDIS_URL: 'redis://127.0.0.1:1',
      AUTH_HMAC_SECRET: 'synthetic-secret-with-at-least-32-bytes',
    })!;
    const limit = config.policy.AUTH_SEND_IP_LIMIT;
    const windowMs = config.policy.AUTH_SEND_WINDOW_SECONDS * 1000;

    // 1. Two saturated counters with different TTLs in both orders -> max TTL (45000 ms)
    const forwardStore = new Map<string, MockRedisCounter>([
      ['k1', { count: limit, pttl: 15000 }],
      ['k2', { count: limit + 1, pttl: 45000 }],
    ]);
    expect(
      executeIpQuotaLua(
        ipQuotaScript,
        ['k1', 'k2', 'policyKey'],
        [limit, windowMs, 2, 2],
        forwardStore,
      ),
    ).toEqual([2, 45000]);

    const reverseStore = new Map<string, MockRedisCounter>([
      ['k1', { count: limit, pttl: 45000 }],
      ['k2', { count: limit, pttl: 15000 }],
    ]);
    expect(
      executeIpQuotaLua(
        ipQuotaScript,
        ['k1', 'k2', 'policyKey'],
        [limit, windowMs, 2, 2],
        reverseStore,
      ),
    ).toEqual([2, 45000]);

    // 2. Non-saturated longer-lived counter must not extend maxTtl beyond saturated counter (20000 ms)
    const mixedStore = new Map<string, MockRedisCounter>([
      ['k1', { count: limit, pttl: 20000 }],
      ['k2', { count: limit - 1, pttl: 90000 }],
    ]);
    expect(
      executeIpQuotaLua(
        ipQuotaScript,
        ['k1', 'k2'],
        [limit, windowMs, 2, 2],
        mixedStore,
      ),
    ).toEqual([2, 20000]);

    const mixedReverseStore = new Map<string, MockRedisCounter>([
      ['k1', { count: limit - 1, pttl: 90000 }],
      ['k2', { count: limit, pttl: 20000 }],
    ]);
    expect(
      executeIpQuotaLua(
        ipQuotaScript,
        ['k1', 'k2'],
        [limit, windowMs, 2, 2],
        mixedReverseStore,
      ),
    ).toEqual([2, 20000]);

    // 3. Saturated counter with pttl < 0 (missing expiry, e.g. -2) falls back to windowMs
    const missingExpiryStore = new Map<string, MockRedisCounter>([
      ['k1', { count: limit, pttl: -2 }],
      ['k2', { count: limit, pttl: 15000 }],
    ]);
    expect(
      executeIpQuotaLua(
        ipQuotaScript,
        ['k1', 'k2'],
        [limit, windowMs, 2, 2],
        missingExpiryStore,
      ),
    ).toEqual([2, windowMs]);

    // 4. Persistent key without TTL (-1) still fails closed with retryable {6, 1000}
    const persistentKeyStore = new Map<string, MockRedisCounter>([
      ['k1', { count: 1, pttl: 15000 }],
      ['k2', { count: 1, pttl: -1 }],
    ]);
    expect(
      executeIpQuotaLua(
        ipQuotaScript,
        ['k1', 'k2'],
        [limit, windowMs, 2, 2],
        persistentKeyStore,
      ),
    ).toEqual([6, 1000]);

    // 5. Wire into AuthAbuseControl.enforceIpQuota to verify 429 retryAfterSeconds matches maxTtl
    const service = new AuthAbuseControl(config);
    vi.spyOn(service as any, 'evaluate').mockImplementation(
      async (script: unknown, keys: unknown, args: unknown) => {
        const keyList = keys as string[];
        const argList = args as (string | number)[];
        const e2eStore = new Map<string, MockRedisCounter>([
          [keyList[0], { count: limit, pttl: 15000 }],
          [keyList[1], { count: limit, pttl: 45000 }],
          ['auth:v1:policy:v1', { count: limit + 50, pttl: -1 }],
        ]);
        return executeIpQuotaLua(script as string, keyList, argList, e2eStore);
      },
    );

    try {
      await service.enforceIpQuota('forgot-password', '192.0.2.1');
      expect.fail('Expected 429 OTP_LIMIT_EXCEEDED');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'OTP_LIMIT_EXCEEDED',
        retryAfterSeconds: 45,
      });
    } finally {
      service.onModuleDestroy();
    }
  });

  it('clearContactsState deletes contact send, cooldown, challenge, and OTP secret keys', async () => {
    const config = readAbuseConfiguration({
      AUTH_REDIS_URL: 'redis://127.0.0.1:6379',
      AUTH_HMAC_SECRET: 'synthetic-secret-with-at-least-32-bytes',
    });
    const service = new AuthAbuseControl(config);
    const delMock = vi.fn().mockResolvedValue(1);
    const withCommandOptionsMock = vi.fn().mockReturnValue({ del: delMock });
    vi.spyOn(
      service as unknown as { getConnectedClient: () => Promise<unknown> },
      'getConnectedClient',
    ).mockResolvedValue({
      withCommandOptions: withCommandOptionsMock,
    });

    try {
      await service.clearContactsState(
        [
          { channel: 'email', identifier: 'User@Example.Invalid' },
          { channel: 'phone', identifier: '+8801629795421' },
        ],
        ['00000000-0000-4000-8000-000000000001'],
      );
      expect(delMock).toHaveBeenCalledTimes(1);
      const deletedKeys = delMock.mock.calls[0][0] as string[];
      expect(deletedKeys).toHaveLength(16);
      expect(
        deletedKeys.some((k) => k.startsWith('auth:v1:send:cooldown:')),
      ).toBe(true);
      expect(
        deletedKeys.some((k) => k.startsWith('auth:v1:send:contact:')),
      ).toBe(true);
      expect(deletedKeys.some((k) => k.startsWith('auth:v1:challenge:'))).toBe(
        true,
      );
      expect(deletedKeys).toContain(
        'auth:v1:otp:secret:00000000-0000-4000-8000-000000000001',
      );
    } finally {
      service.onModuleDestroy();
    }
  });
});

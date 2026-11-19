import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACQUIRE_IDEMPOTENCY_SCRIPT,
  COMPLETE_IDEMPOTENCY_SCRIPT,
  DEFAULT_IDEMPOTENCY_TTL_MS,
  DEFAULT_IDEMPOTENCY_TTL_SECONDS,
  IDEMPOTENCY_EPOCH_KEY,
  IdempotencyService,
  isIdempotencyUniqueViolation,
  normalizeConcreteRoute,
  readIdempotencyConfiguration,
  type IdempotencyConfiguration,
  type IdempotencyRedisClient,
} from './services/idempotency.service.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const IDEM_KEY_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EXPECTED_EPOCH = 'epoch-2026-11-18-v1';

interface MockRedisEntry {
  value: string;
  pttl: number;
  expiresAtMs: number | null;
}

function expectContractError(
  error: unknown,
  expectedStatus: number,
  expectedCode: string,
  expectedRetryable?: boolean,
) {
  expect(error).toBeInstanceOf(HttpException);
  const httpErr = error as HttpException;
  expect(httpErr.getStatus()).toBe(expectedStatus);
  const body = httpErr.getResponse() as {
    code?: string;
    retryable?: boolean;
    retryAfterSeconds?: number | null;
  };
  expect(body.code).toBe(expectedCode);
  if (expectedRetryable !== undefined) {
    expect(body.retryable).toBe(expectedRetryable);
  }
}

/**
 * Deterministic in-memory Redis simulator executing the exact atomic Lua semantics of
 * `ACQUIRE_IDEMPOTENCY_SCRIPT` and `COMPLETE_IDEMPOTENCY_SCRIPT`, including passive TTL
 * expiration before existence/read checks while preserving persistent entries (`expiresAtMs === null`).
 */
function createSimulatedRedisClient(
  redisStore: Map<string, MockRedisEntry>,
  options: {
    isDown: () => boolean;
    now?: () => number;
    onBeforeEval?: (
      script: string,
      evalOpts: { keys: string[]; arguments: string[] },
    ) => void;
  },
) {
  const now = () => options.now?.() ?? Date.now();
  const expireIfNeeded = (key: string): MockRedisEntry | undefined => {
    const entry = redisStore.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAtMs !== null && now() >= entry.expiresAtMs) {
      redisStore.delete(key);
      return undefined;
    }
    return entry;
  };
  const resolveRemainingPttl = (entry: MockRedisEntry): number =>
    entry.expiresAtMs !== null
      ? Math.max(0, entry.expiresAtMs - now())
      : entry.pttl;

  const pingMock = vi.fn<() => Promise<string>>(async () => {
    if (options.isDown()) {
      throw new Error('Redis connection refused');
    }
    return 'PONG';
  });

  const getMock = vi.fn<IdempotencyRedisClient['get']>(async (key: string) => {
    if (options.isDown()) {
      throw new Error('Redis connection refused');
    }
    return expireIfNeeded(key)?.value ?? null;
  });

  const setMock = vi.fn<IdempotencyRedisClient['set']>(
    async (
      key: string,
      value: string,
      setOpts?: { NX?: boolean; XX?: boolean; PX?: number; EX?: number },
    ) => {
      if (options.isDown()) {
        throw new Error('Redis connection refused');
      }
      const existing = expireIfNeeded(key);
      const exists = existing !== undefined;
      if (setOpts?.NX && exists) {
        return null;
      }
      if (setOpts?.XX && !exists) {
        return null;
      }
      const hasExplicitExpiry = Boolean(setOpts?.PX || setOpts?.EX);
      const pttl =
        setOpts?.PX ??
        (setOpts?.EX ? setOpts.EX * 1000 : DEFAULT_IDEMPOTENCY_TTL_MS);
      redisStore.set(key, {
        value,
        pttl: hasExplicitExpiry ? pttl : -1,
        expiresAtMs: hasExplicitExpiry ? now() + pttl : null,
      });
      return 'OK';
    },
  );

  const delMock = vi.fn(async (key: string) => {
    if (options.isDown()) {
      throw new Error('Redis connection refused');
    }
    const existing = expireIfNeeded(key);
    if (!existing) {
      return 0;
    }
    redisStore.delete(key);
    return 1;
  });

  const pTTLMock = vi.fn<NonNullable<IdempotencyRedisClient['pTTL']>>(
    async (key: string) => {
      if (options.isDown()) {
        throw new Error('Redis connection refused');
      }
      const entry = expireIfNeeded(key);
      return entry ? resolveRemainingPttl(entry) : -2;
    },
  );

  const evalMock = vi.fn<IdempotencyRedisClient['eval']>(
    async (
      script: string,
      evalOpts: { keys: string[]; arguments: string[] },
    ) => {
      if (options.isDown()) {
        throw new Error('Redis connection refused');
      }
      options.onBeforeEval?.(script, evalOpts);

      const [epochKey, redisKey] = evalOpts.keys;
      const epochValue = expireIfNeeded(epochKey)?.value ?? null;

      if (script === ACQUIRE_IDEMPOTENCY_SCRIPT) {
        const [expectedEpoch, serializedInFlight, ttlMsStr] =
          evalOpts.arguments;
        if (!epochValue || epochValue !== expectedEpoch) {
          return ['EPOCH_MISMATCH', '', '-2'];
        }
        const existing = expireIfNeeded(redisKey);
        if (existing) {
          const remainingPttl = resolveRemainingPttl(existing);
          if (remainingPttl <= 0) {
            return ['CORRUPT_TTL', '', String(remainingPttl)];
          }
          return ['EXISTING', existing.value, String(remainingPttl)];
        }
        const ttlMs = Number(ttlMsStr);
        redisStore.set(redisKey, {
          value: serializedInFlight,
          pttl: ttlMs,
          expiresAtMs: now() + ttlMs,
        });
        return ['ACQUIRED', serializedInFlight, ttlMsStr];
      }

      if (script === COMPLETE_IDEMPOTENCY_SCRIPT) {
        const [expectedEpoch, expectedReservationToken, serializedCompleted] =
          evalOpts.arguments;
        if (!epochValue || epochValue !== expectedEpoch) {
          return 'EPOCH_MISMATCH';
        }
        const existing = expireIfNeeded(redisKey);
        if (!existing) {
          return 'RESERVATION_LOST';
        }
        let decoded: { state?: unknown; reservationToken?: unknown };
        try {
          decoded = JSON.parse(existing.value) as {
            state?: unknown;
            reservationToken?: unknown;
          };
        } catch {
          return 'OWNERSHIP_MISMATCH';
        }
        if (
          typeof decoded !== 'object' ||
          decoded === null ||
          decoded.state !== 'in_flight' ||
          decoded.reservationToken !== expectedReservationToken
        ) {
          return 'OWNERSHIP_MISMATCH';
        }
        const remainingPttl = resolveRemainingPttl(existing);
        if (remainingPttl <= 0) {
          return 'RESERVATION_LOST';
        }
        redisStore.set(redisKey, {
          value: serializedCompleted,
          pttl: remainingPttl,
          expiresAtMs:
            existing.expiresAtMs !== null
              ? existing.expiresAtMs
              : now() + remainingPttl,
        });
        return 'COMPLETED';
      }

      throw new Error('Unexpected Lua script passed to mock eval');
    },
  );

  const client: IdempotencyRedisClient & {
    ping: () => Promise<string>;
    del: (key: string) => Promise<number>;
  } = {
    isReady: true,
    isOpen: true,
    get: getMock,
    set: setMock,
    del: delMock,
    pTTL: pTTLMock,
    eval: evalMock,
    ping: pingMock,
  };

  return { client, getMock, setMock, delMock, pTTLMock, evalMock, pingMock };
}

describe('IdempotencyService (Redis 24h H-IDEM Replay & R14 Loss-Epoch Fail-Closed Barrier)', () => {
  let redisStore: Map<string, MockRedisEntry>;
  let redisDown: boolean;
  let onBeforeEvalHook:
    | ((
        script: string,
        evalOpts: { keys: string[]; arguments: string[] },
      ) => void)
    | undefined;
  let getMock: ReturnType<typeof vi.fn<IdempotencyRedisClient['get']>>;
  let setMock: ReturnType<typeof vi.fn<IdempotencyRedisClient['set']>>;
  let pTTLMock: ReturnType<
    typeof vi.fn<NonNullable<IdempotencyRedisClient['pTTL']>>
  >;
  let evalMock: ReturnType<typeof vi.fn<IdempotencyRedisClient['eval']>>;
  let redisClientMock: IdempotencyRedisClient & {
    ping: () => Promise<string>;
  };
  let config: IdempotencyConfiguration;
  let service: IdempotencyService;

  beforeEach(() => {
    vi.clearAllMocks();
    redisStore = new Map();
    redisDown = false;
    onBeforeEvalHook = undefined;
    // Seed acknowledged epoch by default
    redisStore.set(IDEMPOTENCY_EPOCH_KEY, {
      value: EXPECTED_EPOCH,
      pttl: -1,
      expiresAtMs: null,
    });

    const sim = createSimulatedRedisClient(redisStore, {
      isDown: () => redisDown,
      onBeforeEval: (script, evalOpts) => {
        onBeforeEvalHook?.(script, evalOpts);
      },
    });
    getMock = sim.getMock;
    setMock = sim.setMock;
    pTTLMock = sim.pTTLMock;
    evalMock = sim.evalMock;
    redisClientMock = sim.client;

    config = {
      url: 'redis://127.0.0.1:56379',
      expectedEpoch: EXPECTED_EPOCH,
      ttlSeconds: DEFAULT_IDEMPOTENCY_TTL_SECONDS,
      ttlMs: DEFAULT_IDEMPOTENCY_TTL_MS,
      timeoutMs: 1_000,
      retryAfterSeconds: 5,
    };

    service = new IdempotencyService(undefined, config, redisClientMock);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects missing or non-UUID Idempotency-Key header with 400 INVALID_FORMAT', async () => {
    const handler = vi.fn();

    for (const badKey of [undefined, null, '', 'not-a-uuid', '12345']) {
      await expect(
        service.execute(
          {
            userId: USER_A,
            idempotencyKey: badKey,
            method: 'POST',
            route: '/api/v1/roadmaps/generate',
            body: { career_goal_id: USER_A },
          },
          handler,
        ),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 400, 'INVALID_FORMAT');
        return true;
      });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('executes first H-IDEM call with 24h TTL (86400000ms) and replays cached 202/200 response on identical (user, key, method, route, bodyHash)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T00:00:00.000Z'));

    const handler = vi.fn().mockResolvedValue({
      statusCode: 202,
      responseBody: {
        job_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        status: 'preparing',
        poll_url: '/api/v1/jobs/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        retry_after_seconds: 3,
      },
    });

    // First execution
    const first = await service.execute(
      {
        userId: USER_A,
        idempotencyKey: IDEM_KEY_1,
        method: 'POST',
        route: '/api/v1/roadmaps/generate',
        body: {
          career_goal_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          target_level: 'mid',
          level_confirmed: true,
        },
      },
      handler,
    );

    expect(first.replayed).toBe(false);
    expect(first.statusCode).toBe(202);
    expect(handler).toHaveBeenCalledTimes(1);

    // Verify atomic Lua EVAL acquired with 24h TTL (86400000ms) and did NOT use non-atomic SET NX/XX
    expect(evalMock).toHaveBeenCalledWith(ACQUIRE_IDEMPOTENCY_SCRIPT, {
      keys: [IDEMPOTENCY_EPOCH_KEY, `idempotency:v1:${USER_A}:${IDEM_KEY_1}`],
      arguments: [EXPECTED_EPOCH, expect.any(String), '86400000'],
    });
    expect(evalMock).toHaveBeenCalledWith(COMPLETE_IDEMPOTENCY_SCRIPT, {
      keys: [IDEMPOTENCY_EPOCH_KEY, `idempotency:v1:${USER_A}:${IDEM_KEY_1}`],
      arguments: [EXPECTED_EPOCH, expect.any(String), expect.any(String)],
    });
    expect(setMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    expect(pTTLMock).not.toHaveBeenCalled();
    expect(redisStore.get(`idempotency:v1:${USER_A}:${IDEM_KEY_1}`)?.pttl).toBe(
      86_400_000,
    );

    // Replay with semantically identical body (different key ordering)
    const second = await service.execute(
      {
        userId: USER_A,
        idempotencyKey: IDEM_KEY_1,
        method: 'POST',
        route: '/api/v1/roadmaps/generate',
        body: {
          level_confirmed: true,
          target_level: 'mid',
          career_goal_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
      },
      handler,
    );

    expect(second.replayed).toBe(true);
    expect(second.statusCode).toBe(202);
    expect(second.responseBody).toEqual(first.responseBody);
    // Handler MUST NOT be called a second time
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('scopes H-IDEM keys by userId so a different user with the same key UUID executes independently', async () => {
    const handlerA = vi.fn().mockResolvedValue({
      statusCode: 200,
      responseBody: { owner: 'userA' },
    });
    const handlerB = vi.fn().mockResolvedValue({
      statusCode: 200,
      responseBody: { owner: 'userB' },
    });

    const resA = await service.execute(
      {
        userId: USER_A,
        idempotencyKey: IDEM_KEY_1,
        method: 'POST',
        route: '/api/v1/roadmaps/123/lock',
        body: { version_no: 1 },
      },
      handlerA,
    );

    const resB = await service.execute(
      {
        userId: USER_B,
        idempotencyKey: IDEM_KEY_1,
        method: 'POST',
        route: '/api/v1/roadmaps/123/lock',
        body: { version_no: 1 },
      },
      handlerB,
    );

    expect(resA.replayed).toBe(false);
    expect(resB.replayed).toBe(false);
    expect(resA.responseBody).toEqual({ owner: 'userA' });
    expect(resB.responseBody).toEqual({ owner: 'userB' });
  });

  it('rejects same (userId, idempotencyKey) with different body, route, or method with 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const handler = vi.fn().mockResolvedValue({
      statusCode: 202,
      responseBody: { job_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    });

    await service.execute(
      {
        userId: USER_A,
        idempotencyKey: IDEM_KEY_1,
        method: 'POST',
        route: '/api/v1/roadmaps/generate',
        body: { target_level: 'mid', level_confirmed: true },
      },
      handler,
    );

    // 1. Mutated body
    await expect(
      service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'senior', level_confirmed: true },
        },
        handler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 409, 'IDEMPOTENCY_KEY_REUSED');
      return true;
    });

    // 2. Mutated route
    await expect(
      service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/quiz/generate',
          body: { target_level: 'mid', level_confirmed: true },
        },
        handler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 409, 'IDEMPOTENCY_KEY_REUSED');
      return true;
    });

    // 3. Mutated HTTP method
    await expect(
      service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'PATCH',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'mid', level_confirmed: true },
        },
        handler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 409, 'IDEMPOTENCY_KEY_REUSED');
      return true;
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('maps PostgreSQL 23505 unique constraint violation on uq_ai_requests_idempotency to 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const pgUniqueError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "uq_ai_requests_idempotency"',
      ),
      {
        code: '23505',
        constraint: 'uq_ai_requests_idempotency',
      },
    );

    const handler = vi.fn().mockRejectedValue(pgUniqueError);

    await expect(
      service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'mid' },
        },
        handler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 409, 'IDEMPOTENCY_KEY_REUSED');
      return true;
    });
  });

  it('fails closed with retryable 503 SERVICE_UNAVAILABLE when an earlier attempt is in_flight or crashed in-flight (never clears lock or re-executes)', async () => {
    let callCount = 0;
    const crashingHandler = vi.fn(async () => {
      callCount += 1;
      throw new Error('Simulated worker crash mid-mutation');
    });

    // First attempt crashes mid-flight
    await expect(
      service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'mid' },
        },
        crashingHandler,
      ),
    ).rejects.toThrow('Simulated worker crash mid-mutation');
    expect(callCount).toBe(1);

    // Retry with identical key + payload while record is still in_flight:
    // MUST fail closed with retryable 503 SERVICE_UNAVAILABLE and NEVER re-run handler
    const secondHandler = vi.fn().mockResolvedValue({
      statusCode: 202,
      responseBody: { job_id: USER_A },
    });

    await expect(
      service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'mid' },
        },
        secondHandler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });

    expect(secondHandler).not.toHaveBeenCalled();

    // Retry with SAME key + DIFFERENT payload while in_flight still detects conflict (409 IDEMPOTENCY_KEY_REUSED)
    await expect(
      service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'senior' },
        },
        secondHandler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 409, 'IDEMPOTENCY_KEY_REUSED');
      return true;
    });
  });

  it('fails closed with retryable 503 SERVICE_UNAVAILABLE when Redis is unreachable', async () => {
    redisDown = true;
    const handler = vi.fn();

    await expect(
      service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'mid' },
        },
        handler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('fails closed with retryable 503 SERVICE_UNAVAILABLE when Redis was flushed/restarted (PING succeeds but idempotency:epoch is missing or mismatched)', async () => {
    // Simulate Redis restart/FLUSHALL: PING still succeeds ('PONG'), but keys including idempotency:epoch are wiped
    redisStore.clear();
    expect(await redisClientMock.ping()).toBe('PONG');

    const handler = vi.fn().mockResolvedValue({
      statusCode: 202,
      responseBody: { ok: true },
    });

    await expect(
      service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'mid' },
        },
        handler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });
    expect(handler).not.toHaveBeenCalled();

    // Simulate mismatched epoch in Redis
    redisStore.set(IDEMPOTENCY_EPOCH_KEY, {
      value: 'stale-or-unacknowledged-epoch',
      pttl: -1,
      expiresAtMs: null,
    });

    await expect(
      service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'mid' },
        },
        handler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });
    expect(handler).not.toHaveBeenCalled();

    // Once recovery is explicitly acknowledged via acknowledgeEpoch(), H-IDEM operations resume
    await service.acknowledgeEpoch(EXPECTED_EPOCH);

    const recovered = await service.execute(
      {
        userId: USER_A,
        idempotencyKey: IDEM_KEY_1,
        method: 'POST',
        route: '/api/v1/roadmaps/generate',
        body: { target_level: 'mid' },
      },
      handler,
    );
    expect(recovered.statusCode).toBe(202);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('gives explicit PostgreSQL constraint metadata precedence on 23505 (does not misclassify other constraint names)', async () => {
    const unrelatedConstraintError = {
      code: '23505',
      constraint: 'uq_other_idempotency_key',
      detail: 'Key (idempotency_key) already exists',
    };
    const wrappedDriverError = {
      driverError: {
        code: '23505',
        constraint: 'uq_other_idempotency_key',
        detail: 'Key (idempotency_key) already exists',
      },
    };
    const absentConstraintAiRequestsError = {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "uq_ai_requests_idempotency"',
    };
    const absentConstraintUnrelatedError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "uq_other"',
      detail: 'Key (idempotency_key) already exists',
    };

    expect(isIdempotencyUniqueViolation(unrelatedConstraintError)).toBe(false);
    expect(isIdempotencyUniqueViolation(wrappedDriverError)).toBe(false);
    expect(isIdempotencyUniqueViolation(absentConstraintAiRequestsError)).toBe(
      true,
    );
    expect(isIdempotencyUniqueViolation(absentConstraintUnrelatedError)).toBe(
      false,
    );

    const handler = vi.fn().mockRejectedValue(unrelatedConstraintError);
    await expect(
      service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'mid' },
        },
        handler,
      ),
    ).rejects.toBe(unrelatedConstraintError);
  });

  it('prevents split GET/SET race when Redis flushes right before atomic Lua acquisition', async () => {
    // Inject a flush right as ACQUIRE_IDEMPOTENCY_SCRIPT executes
    onBeforeEvalHook = (script) => {
      if (script === ACQUIRE_IDEMPOTENCY_SCRIPT) {
        redisStore.clear();
      }
    };

    const handler = vi.fn().mockResolvedValue({
      statusCode: 202,
      responseBody: { job_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    });

    await expect(
      service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'mid' },
        },
        handler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });

    expect(handler).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
    expect(redisStore.has(`idempotency:v1:${USER_A}:${IDEM_KEY_1}`)).toBe(
      false,
    );
  });

  it('prevents stale operation A from overwriting operation B record when A reservation expired and B acquired the key', async () => {
    const redisKey = `idempotency:v1:${USER_A}:${IDEM_KEY_1}`;
    let finishOperationA!: (val: {
      statusCode: number;
      responseBody: { owner: string };
    }) => void;
    const operationAPromise = service.execute<{ owner: string }>(
      {
        userId: USER_A,
        idempotencyKey: IDEM_KEY_1,
        method: 'POST',
        route: '/api/v1/roadmaps/generate',
        body: { target_level: 'mid' },
      },
      () =>
        new Promise((resolve) => {
          finishOperationA = resolve;
        }),
    );

    // Wait until operation A has acquired the in-flight reservation in Redis
    await vi.waitFor(() => {
      expect(redisStore.has(redisKey)).toBe(true);
    });
    const recordA = JSON.parse(redisStore.get(redisKey)!.value) as {
      reservationToken?: string;
    };
    expect(typeof recordA.reservationToken).toBe('string');

    // Simulate A's TTL expiring while B acquires the key and pauses in-flight
    redisStore.delete(redisKey);
    let finishOperationB!: (val: {
      statusCode: number;
      responseBody: { owner: string };
    }) => void;
    const operationBPromise = service.execute<{ owner: string }>(
      {
        userId: USER_A,
        idempotencyKey: IDEM_KEY_1,
        method: 'POST',
        route: '/api/v1/roadmaps/generate',
        body: { target_level: 'mid' },
      },
      () =>
        new Promise((resolve) => {
          finishOperationB = resolve;
        }),
    );

    await vi.waitFor(() => {
      expect(redisStore.has(redisKey)).toBe(true);
    });
    const inFlightSnapshotB = redisStore.get(redisKey)!.value;
    const recordB = JSON.parse(inFlightSnapshotB) as {
      state?: string;
      reservationToken?: string;
    };
    expect(recordB.state).toBe('in_flight');
    expect(recordB.reservationToken).not.toBe(recordA.reservationToken);

    // Now stale operation A finally resolves: completion MUST fail closed with 503 and leave B intact
    finishOperationA({
      statusCode: 202,
      responseBody: { owner: 'A' },
    });

    await expect(operationAPromise).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });

    // Verify B's in-flight record was NOT overwritten by stale A
    expect(redisStore.get(redisKey)!.value).toBe(inFlightSnapshotB);

    // Let B finish and confirm subsequent replay returns B's result
    finishOperationB({
      statusCode: 202,
      responseBody: { owner: 'B' },
    });
    const resultB = await operationBPromise;
    expect(resultB.responseBody).toEqual({ owner: 'B' });

    const replayAfter = await service.execute(
      {
        userId: USER_A,
        idempotencyKey: IDEM_KEY_1,
        method: 'POST',
        route: '/api/v1/roadmaps/generate',
        body: { target_level: 'mid' },
      },
      vi.fn(),
    );
    expect(replayAfter.replayed).toBe(true);
    expect(replayAfter.responseBody).toEqual({ owner: 'B' });
  });

  it('recovers instance B immediately once instance A calls acknowledgeEpoch() without local restart (stateless shared Redis barrier)', async () => {
    const simA = createSimulatedRedisClient(redisStore, {
      isDown: () => redisDown,
    });
    const simB = createSimulatedRedisClient(redisStore, {
      isDown: () => redisDown,
    });
    const serviceA = new IdempotencyService(undefined, config, simA.client);
    const serviceB = new IdempotencyService(undefined, config, simB.client);

    // Flush shared Redis epoch
    redisStore.clear();

    const handlerB = vi.fn().mockResolvedValue({
      statusCode: 202,
      responseBody: { instance: 'B' },
    });

    // Instance B observes missing epoch and fails closed with 503
    await expect(
      serviceB.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'mid' },
        },
        handlerB,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });
    expect(handlerB).not.toHaveBeenCalled();

    // Instance A acknowledges and restores the shared Redis epoch
    await serviceA.acknowledgeEpoch(EXPECTED_EPOCH);

    // Instance B immediately recovers on its next atomic check without local restart
    const recoveredB = await serviceB.execute(
      {
        userId: USER_A,
        idempotencyKey: IDEM_KEY_1,
        method: 'POST',
        route: '/api/v1/roadmaps/generate',
        body: { target_level: 'mid' },
      },
      handlerB,
    );
    expect(recoveredB.replayed).toBe(false);
    expect(recoveredB.statusCode).toBe(202);
    expect(recoveredB.responseBody).toEqual({ instance: 'B' });
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it.each(['null', '123', '[]', '{"state":"completed"}'])(
    'fails closed with 503 (never TypeError) when Redis stores malformed payload %s',
    async (corruptedPayload) => {
      const redisKey = `idempotency:v1:${USER_A}:${IDEM_KEY_1}`;
      redisStore.set(redisKey, {
        value: corruptedPayload,
        pttl: 30_000,
        expiresAtMs: Date.now() + 30_000,
      });
      const handler = vi.fn();

      await expect(
        service.execute(
          {
            userId: USER_A,
            idempotencyKey: IDEM_KEY_1,
            method: 'POST',
            route: '/api/v1/roadmaps/generate',
            body: { target_level: 'mid' },
          },
          handler,
        ),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
        return true;
      });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('fails closed with 503 when PTTL reaches <= 0 at completion boundary without renewing TTL', async () => {
    const redisKey = `idempotency:v1:${USER_A}:${IDEM_KEY_1}`;
    const handler = vi.fn().mockImplementation(async () => {
      // Simulate key expiring at the completion boundary (PTTL == 0)
      const current = redisStore.get(redisKey)!;
      current.pttl = 0;
      current.expiresAtMs = null;
      return {
        statusCode: 202,
        responseBody: { status: 'preparing' },
      };
    });

    await expect(
      service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'mid' },
        },
        handler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });

    const entry = redisStore.get(redisKey);
    expect(entry?.pttl).toBe(0);
    expect(JSON.parse(entry!.value).state).toBe('in_flight');
  });

  it('skips empty/blank IDEMPOTENCY_REDIS_URL in readIdempotencyConfiguration and falls back to AUTH_REDIS_URL / REDIS_URL', () => {
    const fromAuth = readIdempotencyConfiguration({
      IDEMPOTENCY_REDIS_URL: '',
      AUTH_REDIS_URL: 'redis://auth-primary:6379',
      REDIS_URL: 'redis://fallback:6379',
      IDEMPOTENCY_REDIS_TIMEOUT_MS: '   ',
      AUTH_REDIS_TIMEOUT_MS: '1500',
    });
    expect(fromAuth?.url).toBe('redis://auth-primary:6379');
    expect(fromAuth?.timeoutMs).toBe(1500);

    const fromRedis = readIdempotencyConfiguration({
      IDEMPOTENCY_REDIS_URL: '  ',
      AUTH_REDIS_URL: '',
      REDIS_URL: 'redis://fallback:6379',
    });
    expect(fromRedis?.url).toBe('redis://fallback:6379');
  });

  it('normalizes concrete route paths and rejects unresolved route templates with 400 INVALID_FORMAT', async () => {
    expect(
      normalizeConcreteRoute('/api/v1//roadmaps/generate/?foo=1#bar'),
    ).toBe('/api/v1/roadmaps/generate');
    const handler = vi.fn();

    for (const badRoute of [
      '/api/v1/jobs/:id',
      '/api/v1/jobs/{id}',
      'api/v1/jobs',
    ]) {
      await expect(
        service.execute(
          {
            userId: USER_A,
            idempotencyKey: IDEM_KEY_1,
            method: 'POST',
            route: badRoute,
            body: {},
          },
          handler,
        ),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 400, 'INVALID_FORMAT');
        return true;
      });
    }
    expect(evalMock).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('retireClient destroys only the failed client and post-connect shutdown destroys newly connected client with 503', async () => {
    const managedService = new IdempotencyService(undefined, config);
    const destroyC1 = vi.fn();
    const destroyC2 = vi.fn();
    const c1: IdempotencyRedisClient = {
      isReady: true,
      isOpen: true,
      get: vi.fn(),
      set: vi.fn(),
      eval: vi.fn(),
      destroy: destroyC1,
    };
    const c2: IdempotencyRedisClient = {
      isReady: true,
      isOpen: true,
      get: vi.fn(),
      set: vi.fn(),
      eval: vi.fn(),
      destroy: destroyC2,
    };

    const internals = managedService as unknown as {
      client?: IdempotencyRedisClient;
      retireClient: (failed?: IdempotencyRedisClient) => void;
    };
    internals.client = c2;
    internals.retireClient(c1);

    expect(destroyC1).toHaveBeenCalledTimes(1);
    expect(destroyC2).not.toHaveBeenCalled();
    expect(internals.client).toBe(c2);

    // Post-connect shutdown recheck: destroy pending client if onModuleDestroy ran during connect()
    let resolveConnect!: () => void;
    const slowClient: IdempotencyRedisClient = {
      isReady: false,
      isOpen: true,
      connect: vi.fn(
        () =>
          new Promise<void>((res) => {
            resolveConnect = () => {
              slowClient.isReady = true;
              res();
            };
          }),
      ),
      get: vi.fn(),
      set: vi.fn(),
      eval: vi.fn(),
      destroy: vi.fn(() => {
        slowClient.isOpen = false;
      }),
    };
    const connectingService = new IdempotencyService(
      undefined,
      { ...config, timeoutMs: 250 },
      slowClient,
    );
    const handler = vi.fn();
    const execPromise = connectingService.execute(
      {
        userId: USER_A,
        idempotencyKey: IDEM_KEY_1,
        method: 'POST',
        route: '/api/v1/roadmaps/generate',
        body: { target_level: 'mid' },
      },
      handler,
    );

    await vi.waitFor(() => {
      expect(slowClient.connect).toHaveBeenCalledTimes(1);
    });
    const destroyPromise = connectingService.onModuleDestroy();
    resolveConnect();

    await expect(execPromise).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });
    await destroyPromise;
    expect(slowClient.destroy).toHaveBeenCalledTimes(1);
    expect(slowClient.eval).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('bounds onModuleDestroy() shutdown wait with deterministic fake timers and calls client.destroy() when quit() hangs', async () => {
    vi.useFakeTimers();
    try {
      const hangClient: IdempotencyRedisClient = {
        isReady: true,
        isOpen: true,
        get: vi.fn(),
        set: vi.fn(),
        eval: vi.fn(),
        quit: vi.fn(() => new Promise<void>(() => undefined)),
        destroy: vi.fn(() => {
          hangClient.isOpen = false;
        }),
      };
      const svc = new IdempotencyService(
        undefined,
        { ...config, timeoutMs: 25 },
        hangClient,
      );

      const destroyPromise = svc.onModuleDestroy();
      expect(hangClient.quit).toHaveBeenCalledTimes(1);
      expect(hangClient.destroy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(25);
      await destroyPromise;

      expect(hangClient.destroy).toHaveBeenCalledTimes(1);

      const handler = vi.fn();
      await expect(
        svc.execute(
          {
            userId: USER_A,
            idempotencyKey: IDEM_KEY_1,
            method: 'POST',
            route: '/api/v1/roadmaps/generate',
            body: {},
          },
          handler,
        ),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
        return true;
      });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroys a late-resolving Redis client immediately when connect() settles after timeout deadline', async () => {
    let resolveDelayedConnect!: () => void;
    const delayedClient: IdempotencyRedisClient = {
      isReady: false,
      isOpen: false,
      connect: vi.fn(
        () =>
          new Promise<void>((res) => {
            resolveDelayedConnect = () => {
              delayedClient.isReady = true;
              delayedClient.isOpen = true;
              res();
            };
          }),
      ),
      get: vi.fn(),
      set: vi.fn(),
      eval: vi.fn(),
      destroy: vi.fn(() => {
        delayedClient.isOpen = false;
      }),
    };
    const svc = new IdempotencyService(
      undefined,
      { ...config, timeoutMs: 25 },
      delayedClient,
    );
    const handler = vi.fn();

    await expect(
      svc.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: {},
        },
        handler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });

    // While handshake was pending, isOpen was false so destroy() had not been called
    expect(delayedClient.destroy).not.toHaveBeenCalled();

    // Once delayed connect() settles after deadline, late-connected socket is destroyed
    resolveDelayedConnect();
    await vi.waitFor(() => {
      expect(delayedClient.destroy).toHaveBeenCalledTimes(1);
    });
    expect(delayedClient.eval).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('preserves original acquisition expiration deadline when simulated clock advances between acquire and complete', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-19T00:00:00.000Z'));
      const acquiredAtMs = Date.now();
      const redisKey = `idempotency:v1:${USER_A}:${IDEM_KEY_1}`;

      const handler = vi.fn().mockImplementation(async () => {
        const inFlightEntry = redisStore.get(redisKey);
        expect(inFlightEntry?.expiresAtMs).toBe(
          acquiredAtMs + DEFAULT_IDEMPOTENCY_TTL_MS,
        );
        await vi.advanceTimersByTimeAsync(15_000);
        return {
          statusCode: 202,
          responseBody: { status: 'queued' },
        };
      });

      const res = await service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'mid' },
        },
        handler,
      );

      expect(res.statusCode).toBe(202);
      const completedEntry = redisStore.get(redisKey);
      expect(completedEntry?.pttl).toBe(DEFAULT_IDEMPOTENCY_TTL_MS - 15_000);
      expect(completedEntry?.expiresAtMs).toBe(
        acquiredAtMs + DEFAULT_IDEMPOTENCY_TTL_MS,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('never auto-seeds idempotency:epoch when missing until acknowledgeEpoch() is explicitly invoked', async () => {
    redisStore.clear();
    const handler = vi.fn();

    await expect(
      service.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: {},
        },
        handler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });

    expect(setMock).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('fails closed with 503 on persistent record (PTTL = -1), non-positive EXISTING PTTL, invalid statusCode (0 / 600), or stored identity mismatch', async () => {
    const redisKey = `idempotency:v1:${USER_A}:${IDEM_KEY_1}`;
    const firstHandler = vi.fn().mockResolvedValue({
      statusCode: 202,
      responseBody: { job_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    });
    await service.execute(
      {
        userId: USER_A,
        idempotencyKey: IDEM_KEY_1,
        method: 'POST',
        route: '/api/v1/roadmaps/generate',
        body: { target_level: 'mid' },
      },
      firstHandler,
    );
    const validRecord = JSON.parse(redisStore.get(redisKey)!.value) as Record<
      string,
      unknown
    >;

    const replayHandler = vi.fn();
    const ctx = {
      userId: USER_A,
      idempotencyKey: IDEM_KEY_1,
      method: 'POST',
      route: '/api/v1/roadmaps/generate',
      body: { target_level: 'mid' },
    };

    // 1. PTTL = -1 (persistent key without expiry) -> 503 without clearing key or running handler
    redisStore.set(redisKey, {
      value: JSON.stringify(validRecord),
      pttl: -1,
      expiresAtMs: null,
    });
    await expect(service.execute(ctx, replayHandler)).rejects.toSatisfy(
      (err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
        return true;
      },
    );
    expect(redisStore.has(redisKey)).toBe(true);

    // 2. Defense-in-depth: 'EXISTING' response with non-positive rawPttl (0) -> 503
    evalMock.mockResolvedValueOnce([
      'EXISTING',
      JSON.stringify(validRecord),
      '0',
    ]);
    await expect(service.execute(ctx, replayHandler)).rejects.toSatisfy(
      (err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
        return true;
      },
    );

    // 3. Invalid completed statusCode (0, 600) -> 503
    for (const badStatus of [0, 99, 600]) {
      redisStore.set(redisKey, {
        value: JSON.stringify({ ...validRecord, statusCode: badStatus }),
        pttl: 30_000,
        expiresAtMs: Date.now() + 30_000,
      });
      await expect(service.execute(ctx, replayHandler)).rejects.toSatisfy(
        (err) => {
          expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
          return true;
        },
      );
    }

    // 4. Stored userId mismatch -> 503
    redisStore.set(redisKey, {
      value: JSON.stringify({ ...validRecord, userId: USER_B }),
      pttl: 30_000,
      expiresAtMs: Date.now() + 30_000,
    });
    await expect(service.execute(ctx, replayHandler)).rejects.toSatisfy(
      (err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
        return true;
      },
    );

    // 5. Stored idempotencyKey mismatch -> 503
    redisStore.set(redisKey, {
      value: JSON.stringify({
        ...validRecord,
        idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
      pttl: 30_000,
      expiresAtMs: Date.now() + 30_000,
    });
    await expect(service.execute(ctx, replayHandler)).rejects.toSatisfy(
      (err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
        return true;
      },
    );

    expect(replayHandler).not.toHaveBeenCalled();
  });

  it('fails closed with 503 before invoking handler() when stopped or when acquisition elapsed time >= ttlMs', async () => {
    // 1. Stopped right after ACQUIRE succeeds, before handler() runs
    const stopSim = createSimulatedRedisClient(redisStore, {
      isDown: () => false,
    });
    const stopService = new IdempotencyService(
      undefined,
      config,
      stopSim.client,
    );
    const originalStopEval = stopSim.evalMock.getMockImplementation()!;
    stopSim.evalMock.mockImplementationOnce(async (script, evalOpts) => {
      const res = await originalStopEval(script, evalOpts);
      void stopService.onModuleDestroy();
      return res;
    });

    const stoppedHandler = vi.fn();
    await expect(
      stopService.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: {},
        },
        stoppedHandler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });
    expect(stoppedHandler).not.toHaveBeenCalled();

    // 2. Acquisition latency reaches >= ttlMs before pre-handler guard (without tripping withDeadline)
    vi.useFakeTimers();
    const perfSpy = vi.spyOn(performance, 'now');
    try {
      const shortTtlConfig: IdempotencyConfiguration = {
        ...config,
        ttlSeconds: 2,
        ttlMs: 2_000,
        timeoutMs: 1_000,
      };
      const slowAcquireSim = createSimulatedRedisClient(redisStore, {
        isDown: () => false,
      });
      slowAcquireSim.client.destroy = vi.fn();
      const slowAcquireSvc = new IdempotencyService(
        undefined,
        shortTtlConfig,
        slowAcquireSim.client,
      );
      const originalAcquireEval =
        slowAcquireSim.evalMock.getMockImplementation()!;
      slowAcquireSim.evalMock.mockImplementationOnce(
        async (script, evalOpts) => {
          const res = await originalAcquireEval(script, evalOpts);
          perfSpy.mockReturnValue(2_100);
          return res;
        },
      );
      perfSpy.mockReturnValueOnce(100);

      const expiredHandler = vi.fn();
      await expect(
        slowAcquireSvc.execute(
          {
            userId: USER_A,
            idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            method: 'POST',
            route: '/api/v1/roadmaps/generate',
            body: {},
          },
          expiredHandler,
        ),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
        expect((err as HttpException).getResponse()).toMatchObject({
          message:
            'Idempotency reservation expired or service stopped before mutation dispatch',
        });
        return true;
      });
      expect(slowAcquireSim.client.destroy).not.toHaveBeenCalled();
      expect(expiredHandler).not.toHaveBeenCalled();
    } finally {
      perfSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('uses replacement active client C2 for completion when C1 retires mid-handler and never re-runs handler on unknown completion failure', async () => {
    const sim1 = createSimulatedRedisClient(redisStore, {
      isDown: () => false,
    });
    const sim2 = createSimulatedRedisClient(redisStore, {
      isDown: () => false,
    });
    sim1.client.destroy = vi.fn(() => {
      sim1.client.isOpen = false;
    });
    sim2.client.destroy = vi.fn(() => {
      sim2.client.isOpen = false;
    });

    const managedSvc = new IdempotencyService(undefined, config);
    const internals = managedSvc as unknown as {
      client?: IdempotencyRedisClient;
      retireClient: (failed?: IdempotencyRedisClient) => void;
    };
    internals.client = sim1.client;

    const handler = vi.fn().mockImplementation(async () => {
      internals.retireClient(sim1.client);
      internals.client = sim2.client;
      return {
        statusCode: 202,
        responseBody: { status: 'preparing' },
      };
    });

    const res = await managedSvc.execute(
      {
        userId: USER_A,
        idempotencyKey: IDEM_KEY_1,
        method: 'POST',
        route: '/api/v1/roadmaps/generate',
        body: { target_level: 'mid' },
      },
      handler,
    );

    expect(res.statusCode).toBe(202);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(sim1.evalMock).toHaveBeenCalledTimes(1);
    expect(sim2.evalMock).toHaveBeenCalledTimes(1);
    expect(sim2.evalMock).toHaveBeenCalledWith(
      COMPLETE_IDEMPOTENCY_SCRIPT,
      expect.any(Object),
    );

    // Unknown completion failure retires active client and fails closed without rerunning handler
    const failKey = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    sim2.evalMock.mockImplementationOnce(
      async (script, opts) =>
        await sim1.evalMock.getMockImplementation()!(script, opts),
    );
    sim2.evalMock.mockRejectedValueOnce(new Error('ECONNRESET'));

    const singleShotHandler = vi.fn().mockResolvedValue({
      statusCode: 202,
      responseBody: { status: 'preparing' },
    });

    await expect(
      managedSvc.execute(
        {
          userId: USER_A,
          idempotencyKey: failKey,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: {},
        },
        singleShotHandler,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });
    expect(singleShotHandler).toHaveBeenCalledTimes(1);
  });

  it('passively expires timed-out keys after IDEMPOTENCY_TTL_SECONDS * 1000 so a fresh acquisition succeeds cleanly instead of returning CORRUPT_TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T00:00:00.000Z'));

    const firstHandler = vi.fn().mockResolvedValue({
      statusCode: 202,
      responseBody: { attempt: 1 },
    });
    const ctx = {
      userId: USER_A,
      idempotencyKey: IDEM_KEY_1,
      method: 'POST',
      route: '/api/v1/roadmaps/generate',
      body: { target_level: 'mid' },
    };

    const first = await service.execute(ctx, firstHandler);
    expect(first.replayed).toBe(false);
    expect(first.responseBody).toEqual({ attempt: 1 });

    // Advance clock past full IDEMPOTENCY_TTL_SECONDS * 1000 lifetime
    await vi.advanceTimersByTimeAsync(DEFAULT_IDEMPOTENCY_TTL_MS + 1);

    const secondHandler = vi.fn().mockResolvedValue({
      statusCode: 202,
      responseBody: { attempt: 2 },
    });
    const second = await service.execute(ctx, secondHandler);
    expect(second.replayed).toBe(false);
    expect(second.responseBody).toEqual({ attempt: 2 });
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });

  it('supports one-time SET NX bootstrapInitialEpoch() for clean deployments while failing closed on mismatched snapshot epochs and runtime misses', async () => {
    redisStore.clear();
    const handler = vi.fn().mockResolvedValue({
      statusCode: 202,
      responseBody: { ok: true },
    });
    const ctx = {
      userId: USER_A,
      idempotencyKey: IDEM_KEY_1,
      method: 'POST',
      route: '/api/v1/roadmaps/generate',
      body: {},
    };

    // Runtime execute() stays fail-closed when idempotency:epoch is missing
    await expect(service.execute(ctx, handler)).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });
    expect(handler).not.toHaveBeenCalled();

    // Clean initial deployment bootstrap initializes epoch via SET NX
    expect(await service.bootstrapInitialEpoch()).toBe('INITIALIZED');
    expect(setMock).toHaveBeenCalledWith(
      IDEMPOTENCY_EPOCH_KEY,
      EXPECTED_EPOCH,
      {
        NX: true,
      },
    );

    // Subsequent bootstrap calls are idempotent when epoch already matches
    expect(await service.bootstrapInitialEpoch()).toBe('ALREADY_SET');

    const okResult = await service.execute(ctx, handler);
    expect(okResult.statusCode).toBe(202);
    expect(handler).toHaveBeenCalledTimes(1);

    // Restored snapshot containing a stale epoch refuses silent NX overwrite during bootstrap
    redisStore.set(IDEMPOTENCY_EPOCH_KEY, {
      value: 'stale-snapshot-epoch',
      pttl: -1,
      expiresAtMs: null,
    });
    await expect(
      service.bootstrapInitialEpoch('rotated-epoch-v2'),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });
    expect(redisStore.get(IDEMPOTENCY_EPOCH_KEY)?.value).toBe(
      'stale-snapshot-epoch',
    );

    // Runtime execute() stays fenced at 503 until explicit operator acknowledgeEpoch()
    await expect(service.execute(ctx, handler)).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
      return true;
    });
    await service.acknowledgeEpoch(EXPECTED_EPOCH);
    const replayed = await service.execute(ctx, handler);
    expect(replayed.replayed).toBe(true);
  });

  it('onModuleInit() does not write idempotency:epoch by default when IDEMPOTENCY_BOOTSTRAP_ON_INIT is unset or false', async () => {
    const prevEnv = process.env.IDEMPOTENCY_BOOTSTRAP_ON_INIT;
    try {
      redisStore.clear();
      delete process.env.IDEMPOTENCY_BOOTSTRAP_ON_INIT;
      await service.onModuleInit();

      expect(setMock).not.toHaveBeenCalled();
      expect(redisStore.has(IDEMPOTENCY_EPOCH_KEY)).toBe(false);

      process.env.IDEMPOTENCY_BOOTSTRAP_ON_INIT = 'false';
      await service.onModuleInit();

      expect(setMock).not.toHaveBeenCalled();
      expect(redisStore.has(IDEMPOTENCY_EPOCH_KEY)).toBe(false);

      const handler = vi.fn();
      await expect(
        service.execute(
          {
            userId: USER_A,
            idempotencyKey: IDEM_KEY_1,
            method: 'POST',
            route: '/api/v1/roadmaps/generate',
            body: {},
          },
          handler,
        ),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
        return true;
      });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      if (prevEnv === undefined) {
        delete process.env.IDEMPOTENCY_BOOTSTRAP_ON_INIT;
      } else {
        process.env.IDEMPOTENCY_BOOTSTRAP_ON_INIT = prevEnv;
      }
    }
  });

  it('onModuleInit() runs bootstrapInitialEpoch() (SET NX) only when IDEMPOTENCY_BOOTSTRAP_ON_INIT === "true" and fails closed on conflicting epoch', async () => {
    const prevEnv = process.env.IDEMPOTENCY_BOOTSTRAP_ON_INIT;
    try {
      redisStore.clear();
      process.env.IDEMPOTENCY_BOOTSTRAP_ON_INIT = 'true';
      await service.onModuleInit();

      expect(setMock).toHaveBeenCalledWith(
        IDEMPOTENCY_EPOCH_KEY,
        EXPECTED_EPOCH,
        {
          NX: true,
        },
      );
      expect(redisStore.get(IDEMPOTENCY_EPOCH_KEY)?.value).toBe(EXPECTED_EPOCH);

      // Conflicting snapshot epoch during explicit bootstrap must fail closed without overwriting
      redisStore.set(IDEMPOTENCY_EPOCH_KEY, {
        value: 'conflicting-snapshot-epoch',
        pttl: -1,
        expiresAtMs: null,
      });
      await expect(service.onModuleInit()).rejects.toSatisfy((err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
        return true;
      });
      expect(redisStore.get(IDEMPOTENCY_EPOCH_KEY)?.value).toBe(
        'conflicting-snapshot-epoch',
      );
    } finally {
      if (prevEnv === undefined) {
        delete process.env.IDEMPOTENCY_BOOTSTRAP_ON_INIT;
      } else {
        process.env.IDEMPOTENCY_BOOTSTRAP_ON_INIT = prevEnv;
      }
    }
  });

  it('passes { idempotencyKey, reservationToken, expiresAtMs, signal } to handler and aborts signal + fails closed 503 if pending past reservation lifetime', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-19T00:00:00.000Z'));
      const shortTtlConfig: IdempotencyConfiguration = {
        ...config,
        ttlSeconds: 2,
        ttlMs: 2_000,
        timeoutMs: 1_000,
      };
      const boundedSim = createSimulatedRedisClient(redisStore, {
        isDown: () => false,
      });
      const boundedSvc = new IdempotencyService(
        undefined,
        shortTtlConfig,
        boundedSim.client,
      );

      const startNowMs = Date.now();
      let capturedSignal: AbortSignal | undefined;
      let capturedKey: string | undefined;
      let capturedToken: string | undefined;
      let capturedExpiresAtMs: number | undefined;
      let notifyHandlerEntered!: () => void;
      const handlerEntered = new Promise<void>((resolve) => {
        notifyHandlerEntered = resolve;
      });
      let resolvePendingHandler!: (val: {
        statusCode: number;
        responseBody: { late: boolean };
      }) => void;

      const execPromise = boundedSvc.execute(
        {
          userId: USER_A,
          idempotencyKey: IDEM_KEY_1,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: { target_level: 'mid' },
        },
        (executionContext) => {
          capturedKey = executionContext.idempotencyKey;
          capturedToken = executionContext.reservationToken;
          capturedExpiresAtMs = executionContext.expiresAtMs;
          capturedSignal = executionContext.signal;
          notifyHandlerEntered();
          return new Promise<{
            statusCode: number;
            responseBody: { late: boolean };
          }>((resolve) => {
            resolvePendingHandler = resolve;
          });
        },
      );

      await handlerEntered;
      expect(capturedSignal).toBeDefined();
      expect(capturedKey).toBe(IDEM_KEY_1);
      expect(typeof capturedToken).toBe('string');
      expect(capturedExpiresAtMs).toBe(startNowMs + 2_000);
      expect(capturedSignal!.aborted).toBe(false);

      // Advance timers past the remaining 2_000ms reservation lifetime
      await vi.advanceTimersByTimeAsync(2_000);
      expect(capturedSignal!.aborted).toBe(true);

      // Even if the late handler resolves, execute() fails closed 503 without invoking COMPLETE_IDEMPOTENCY_SCRIPT
      resolvePendingHandler({
        statusCode: 202,
        responseBody: { late: true },
      });

      await expect(execPromise).rejects.toSatisfy((err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
        return true;
      });
      expect(boundedSim.evalMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('unrefs expiration timer and fails closed 503 via monotonic deadline before completion or 23505->409 translation even while signal.aborted is false', async () => {
    const shortTtlConfig: IdempotencyConfiguration = {
      ...config,
      ttlSeconds: 5,
      ttlMs: 5_000,
      timeoutMs: 1_000,
    };
    const sim = createSimulatedRedisClient(redisStore, {
      isDown: () => false,
    });
    const svc = new IdempotencyService(undefined, shortTtlConfig, sim.client);

    const perfSpy = vi.spyOn(performance, 'now');
    const unrefSpies: Array<ReturnType<typeof vi.spyOn>> = [];
    const realSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((
        fn: (...args: unknown[]) => void,
        delay?: number,
        ...args: unknown[]
      ) => {
        const timer = realSetTimeout(fn, delay, ...args);
        if (delay === shortTtlConfig.ttlMs) {
          unrefSpies.push(vi.spyOn(timer, 'unref'));
        }
        return timer;
      }) as unknown as typeof setTimeout);

    try {
      // (a) Late handler success after monotonic deadline (abort timer has not fired -> signal.aborted === false)
      perfSpy.mockReturnValue(1_000);
      await expect(
        svc.execute(
          {
            userId: USER_A,
            idempotencyKey: IDEM_KEY_1,
            method: 'POST',
            route: '/api/v1/roadmaps/generate',
            body: { target_level: 'mid' },
          },
          async ({ signal }) => {
            expect(signal.aborted).toBe(false);
            perfSpy.mockReturnValue(1_000 + shortTtlConfig.ttlMs);
            expect(signal.aborted).toBe(false);
            return {
              statusCode: 202,
              responseBody: { late: true },
            };
          },
        ),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
        return true;
      });
      // Only ACQUIRE_IDEMPOTENCY_SCRIPT ran; COMPLETE_IDEMPOTENCY_SCRIPT was never invoked
      expect(sim.evalMock).toHaveBeenCalledTimes(1);
      expect(unrefSpies).toHaveLength(1);
      expect(unrefSpies[0]).toHaveBeenCalledTimes(1);

      // (b) Late PostgreSQL 23505 unique violation after monotonic deadline fails closed 503 (never translates to 409)
      perfSpy.mockReturnValue(10_000);
      const uniqueViolation = Object.assign(
        new Error('duplicate key value violates unique constraint'),
        {
          code: '23505',
          constraint: 'uq_ai_requests_idempotency',
        },
      );
      await expect(
        svc.execute(
          {
            userId: USER_A,
            idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            method: 'POST',
            route: '/api/v1/roadmaps/generate',
            body: { target_level: 'senior' },
          },
          async ({ signal }) => {
            expect(signal.aborted).toBe(false);
            perfSpy.mockReturnValue(10_000 + shortTtlConfig.ttlMs);
            expect(signal.aborted).toBe(false);
            throw uniqueViolation;
          },
        ),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
        return true;
      });
      expect(sim.evalMock).toHaveBeenCalledTimes(2);
      expect(unrefSpies).toHaveLength(2);
      expect(unrefSpies[1]).toHaveBeenCalledTimes(1);
    } finally {
      setTimeoutSpy.mockRestore();
      perfSpy.mockRestore();
    }
  });

  it('fails closed 503 without dispatching COMPLETE_IDEMPOTENCY_SCRIPT when getActiveClient() reconnects across the monotonic deadline', async () => {
    const shortTtlConfig: IdempotencyConfiguration = {
      ...config,
      ttlSeconds: 5,
      ttlMs: 5_000,
      timeoutMs: 1_000,
    };
    const sim1 = createSimulatedRedisClient(redisStore, {
      isDown: () => false,
    });
    const sim2 = createSimulatedRedisClient(redisStore, {
      isDown: () => false,
    });
    const svc = new IdempotencyService(undefined, shortTtlConfig, sim1.client);

    const perfSpy = vi.spyOn(performance, 'now');
    const getClientSpy = vi
      .spyOn(
        svc as unknown as {
          getActiveClient: () => Promise<IdempotencyRedisClient>;
        },
        'getActiveClient',
      )
      .mockResolvedValueOnce(sim1.client)
      .mockImplementationOnce(async () => {
        // Handler already finished before deadline; reconnect crosses monotonic deadline
        perfSpy.mockReturnValue(6_000);
        return sim2.client;
      });

    try {
      perfSpy.mockReturnValue(1_000);
      await expect(
        svc.execute(
          {
            userId: USER_A,
            idempotencyKey: IDEM_KEY_1,
            method: 'POST',
            route: '/api/v1/roadmaps/generate',
            body: { target_level: 'mid' },
          },
          async ({ signal }) => {
            expect(signal.aborted).toBe(false);
            perfSpy.mockReturnValue(1_500);
            return {
              statusCode: 202,
              responseBody: { status: 'preparing' },
            };
          },
        ),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE', true);
        return true;
      });

      expect(getClientSpy).toHaveBeenCalledTimes(2);
      expect(sim1.evalMock).toHaveBeenCalledTimes(1);
      expect(sim2.evalMock).not.toHaveBeenCalled();
    } finally {
      getClientSpy.mockRestore();
      perfSpy.mockRestore();
    }
  });
});

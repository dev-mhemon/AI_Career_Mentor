import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { fail } from '../../common/http.js';
import {
  readOptionalPositiveInteger,
  resolveFirstNonBlankValue,
  validateOptionalRedisUrl,
} from '../../config.js';

/** Injection token for optional `IdempotencyConfiguration` override in tests or module wiring. */
export const IDEMPOTENCY_CONFIGURATION = Symbol('IDEMPOTENCY_CONFIGURATION');

/** Injection token for an optional pre-configured Redis client or mock in tests. */
export const IDEMPOTENCY_REDIS_CLIENT = Symbol('IDEMPOTENCY_REDIS_CLIENT');

/** Strict UUID matcher for `Idempotency-Key` header and `userId` validation (`H-IDEM`). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Default TTL for `H-IDEM` keys in seconds (`C05` §13.1 / `ADR-017` / `R14`: 24 hours / 86,400 seconds). */
export const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 86_400;

/** Default TTL for `H-IDEM` keys in milliseconds (`86400000ms`). */
export const DEFAULT_IDEMPOTENCY_TTL_MS =
  DEFAULT_IDEMPOTENCY_TTL_SECONDS * 1_000;

/** Redis key holding the deployment-acknowledged Redis epoch marker (`R14`). */
export const IDEMPOTENCY_EPOCH_KEY = 'idempotency:epoch';

/** Default expected epoch token when `IDEMPOTENCY_REDIS_EPOCH` is not explicitly overridden. */
export const DEFAULT_IDEMPOTENCY_EPOCH = 'epoch-v1';

/**
 * Atomic Lua script checking `idempotency:epoch` and acquiring an `'in_flight'` reservation
 * in a single round-trip (`R14`).
 *
 * KEYS[1]: idempotency:epoch
 * KEYS[2]: idempotency:v1:{userId}:{idempotencyKey}
 * ARGV[1]: expectedEpoch
 * ARGV[2]: serialized in_flight JSON record (including per-invocation reservationToken)
 * ARGV[3]: ttlMs
 */
export const ACQUIRE_IDEMPOTENCY_SCRIPT = `
local epoch = redis.call('GET', KEYS[1])
if not epoch or epoch ~= ARGV[1] then
  return {'EPOCH_MISMATCH', '', '-2'}
end
local existing = redis.call('GET', KEYS[2])
if existing then
  local pttl = redis.call('PTTL', KEYS[2])
  if not pttl or pttl <= 0 then
    return {'CORRUPT_TTL', '', tostring(pttl or -2)}
  end
  return {'EXISTING', existing, tostring(pttl)}
end
redis.call('SET', KEYS[2], ARGV[2], 'PX', tonumber(ARGV[3]))
return {'ACQUIRED', ARGV[2], ARGV[3]}
`;

/**
 * Atomic Lua script verifying `idempotency:epoch`, `'in_flight'` state, per-invocation
 * `reservationToken` ownership, and remaining `PTTL > 0` before writing `'completed'`
 * without extending the original configured acquisition deadline (`R14`).
 *
 * KEYS[1]: idempotency:epoch
 * KEYS[2]: idempotency:v1:{userId}:{idempotencyKey}
 * ARGV[1]: expectedEpoch
 * ARGV[2]: expected reservationToken
 * ARGV[3]: serialized completed JSON record
 */
export const COMPLETE_IDEMPOTENCY_SCRIPT = `
local epoch = redis.call('GET', KEYS[1])
if not epoch or epoch ~= ARGV[1] then
  return 'EPOCH_MISMATCH'
end
local existing = redis.call('GET', KEYS[2])
if not existing then
  return 'RESERVATION_LOST'
end
local ok, decoded = pcall(cjson.decode, existing)
if not ok or type(decoded) ~= 'table' then
  return 'OWNERSHIP_MISMATCH'
end
if decoded['state'] ~= 'in_flight' or decoded['reservationToken'] ~= ARGV[2] then
  return 'OWNERSHIP_MISMATCH'
end
local pttl = redis.call('PTTL', KEYS[2])
if not pttl or pttl <= 0 then
  return 'RESERVATION_LOST'
end
redis.call('SET', KEYS[2], ARGV[3], 'PX', pttl)
return 'COMPLETED'
`;

/**
 * Runtime configuration for `IdempotencyService`.
 */
export interface IdempotencyConfiguration {
  url: string;
  expectedEpoch: string;
  ttlSeconds: number;
  ttlMs: number;
  timeoutMs: number;
  retryAfterSeconds: number;
}

/**
 * Stored Redis record for an `H-IDEM` key (`R14`).
 */
export interface IdempotencyRecord<T = unknown> {
  userId: string;
  idempotencyKey: string;
  method: string;
  route: string;
  bodyHash: string;
  state: 'in_flight' | 'completed';
  reservationToken?: string;
  statusCode?: number;
  responseBody?: T;
  createdAtMs: number;
}

/**
 * Input parameters for beginning or executing an `H-IDEM` operation.
 */
export interface IdempotencyOperationContext {
  userId: string;
  idempotencyKey: unknown;
  method: string;
  route: string;
  body?: unknown;
}

/**
 * Execution context supplied to mutating handlers guarded by `IdempotencyService.execute()`.
 */
export interface IdempotencyExecutionContext {
  idempotencyKey: string;
  reservationToken: string;
  expiresAtMs: number;
  signal: AbortSignal;
}

/**
 * Handler return payload stored when an `H-IDEM` mutation completes cleanly.
 */
export interface IdempotencyHandlerResult<T = unknown> {
  statusCode: number;
  responseBody: T;
}

/**
 * Result returned when an `H-IDEM` operation executes or is replayed from the configured Redis store.
 */
export interface IdempotencyExecutionResult<T = unknown> {
  statusCode: number;
  responseBody: T;
  replayed: boolean;
}

/**
 * Minimal Redis client contract used by `IdempotencyService`.
 */
export interface IdempotencyRedisClient {
  isReady?: boolean;
  isOpen?: boolean;
  connect?: () => Promise<unknown>;
  destroy?: () => void;
  quit?: () => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    options?: { NX?: boolean; XX?: boolean; PX?: number; EX?: number },
  ) => Promise<string | null>;
  pTTL?: (key: string) => Promise<number>;
  ttl?: (key: string) => Promise<number>;
  eval: (
    script: string,
    options: { keys: string[]; arguments: string[] },
  ) => Promise<unknown>;
}

/**
 * Deterministically serializes an arbitrary JSON payload with recursively sorted object keys
 * so semantically identical JSON bodies produce the exact same SHA-256 `bodyHash`.
 */
export function canonicalizePayload(value: unknown): string {
  if (value === undefined || value === null) {
    return 'null';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizePayload(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalizePayload(obj[k])}`,
  );
  return `{${entries.join(',')}}`;
}

/**
 * Computes the SHA-256 hex digest of a canonicalized request payload.
 */
export function computeCanonicalBodyHash(body: unknown): string {
  return createHash('sha256')
    .update(canonicalizePayload(body), 'utf8')
    .digest('hex');
}

/**
 * Checks whether a database error is a PostgreSQL `23505` unique violation on `uq_ai_requests_idempotency`.
 * Explicit `constraint` metadata takes strict precedence over `message`/`detail` inspection.
 */
export function isIdempotencyUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
    detail?: unknown;
    driverError?: {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
      detail?: unknown;
    };
  };
  const code = err.code ?? err.driverError?.code;
  if (code !== '23505') {
    return false;
  }

  const rawConstraint =
    typeof err.constraint === 'string' && err.constraint.trim().length > 0
      ? err.constraint
      : err.driverError?.constraint;
  if (typeof rawConstraint === 'string' && rawConstraint.trim().length > 0) {
    return rawConstraint.trim() === 'uq_ai_requests_idempotency';
  }

  const message = String(err.message ?? err.driverError?.message ?? '');
  const detail = String(err.detail ?? err.driverError?.detail ?? '');
  return (
    message.includes('uq_ai_requests_idempotency') ||
    detail.includes('uq_ai_requests_idempotency')
  );
}

/**
 * Validates that a parsed JSON payload from Redis matches the canonical `IdempotencyRecord` shape.
 */
function isStoredIdempotencyRecord<T>(
  value: unknown,
): value is IdempotencyRecord<T> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  if (rec.state !== 'in_flight' && rec.state !== 'completed') {
    return false;
  }
  if (
    typeof rec.userId !== 'string' ||
    rec.userId.length === 0 ||
    typeof rec.idempotencyKey !== 'string' ||
    rec.idempotencyKey.length === 0 ||
    typeof rec.method !== 'string' ||
    rec.method.length === 0 ||
    typeof rec.route !== 'string' ||
    rec.route.length === 0 ||
    typeof rec.bodyHash !== 'string' ||
    rec.bodyHash.length === 0 ||
    typeof rec.reservationToken !== 'string' ||
    rec.reservationToken.length === 0
  ) {
    return false;
  }
  if (
    rec.state === 'completed' &&
    (typeof rec.statusCode !== 'number' ||
      !Number.isInteger(rec.statusCode) ||
      rec.statusCode < 100 ||
      rec.statusCode > 599)
  ) {
    return false;
  }
  return true;
}

/**
 * Normalizes and validates a concrete resolved route path (strips query/hash, collapses slashes,
 * and rejects unresolved template placeholders such as `/:id` or `{id}` with `400 INVALID_FORMAT`).
 */
export function normalizeConcreteRoute(rawRoute: unknown): string {
  if (typeof rawRoute !== 'string') {
    fail(400, 'INVALID_FORMAT', 'Concrete route path is required', [
      {
        field: 'route',
        code: 'INVALID_FORMAT',
        message: 'route must be a non-empty concrete path',
      },
    ]);
  }
  const withoutQuery = rawRoute.trim().split(/[?#]/, 1)[0].trim();
  const collapsed = withoutQuery.replace(/\/{2,}/g, '/');
  const normalized =
    collapsed.length > 1 && collapsed.endsWith('/')
      ? collapsed.slice(0, -1)
      : collapsed;

  if (
    !normalized.startsWith('/') ||
    /(?:^|\/):[^/]+/.test(normalized) ||
    /\{[^}]*\}/.test(normalized) ||
    /<[^>]+>/.test(normalized) ||
    normalized.includes('*')
  ) {
    fail(
      400,
      'INVALID_FORMAT',
      'Route must be a concrete resolved path without template placeholders',
      [
        {
          field: 'route',
          code: 'INVALID_FORMAT',
          message:
            'route must be a concrete resolved path without template placeholders',
        },
      ],
    );
  }
  return normalized;
}

/**
 * Reads `IdempotencyConfiguration` from raw environment or `ConfigService`.
 */
export function readIdempotencyConfiguration(
  config?: ConfigService | Record<string, unknown>,
): IdempotencyConfiguration | undefined {
  if (!config) {
    return undefined;
  }
  const getVal = (key: string): unknown => {
    if (typeof (config as ConfigService).get === 'function') {
      return (config as ConfigService).get<unknown>(key);
    }
    return (config as Record<string, unknown>)[key];
  };

  const rawUrl = resolveFirstNonBlankValue(getVal, [
    'IDEMPOTENCY_REDIS_URL',
    'AUTH_REDIS_URL',
    'REDIS_URL',
  ]);
  if (!rawUrl) {
    return undefined;
  }
  validateOptionalRedisUrl(rawUrl, 'IDEMPOTENCY_REDIS_URL');

  const rawEpoch = getVal('IDEMPOTENCY_REDIS_EPOCH');
  const expectedEpoch =
    typeof rawEpoch === 'string' && rawEpoch.trim().length > 0
      ? rawEpoch.trim()
      : DEFAULT_IDEMPOTENCY_EPOCH;

  const ttlSeconds =
    readOptionalPositiveInteger(
      getVal('IDEMPOTENCY_TTL_SECONDS'),
      'IDEMPOTENCY_TTL_SECONDS',
    ) ?? DEFAULT_IDEMPOTENCY_TTL_SECONDS;

  const timeoutMs =
    readOptionalPositiveInteger(
      getVal('IDEMPOTENCY_REDIS_TIMEOUT_MS'),
      'IDEMPOTENCY_REDIS_TIMEOUT_MS',
    ) ??
    readOptionalPositiveInteger(
      getVal('AUTH_REDIS_TIMEOUT_MS'),
      'AUTH_REDIS_TIMEOUT_MS',
    ) ??
    1_000;

  const retryAfterSeconds =
    readOptionalPositiveInteger(
      getVal('IDEMPOTENCY_REDIS_RETRY_SECONDS'),
      'IDEMPOTENCY_REDIS_RETRY_SECONDS',
    ) ??
    readOptionalPositiveInteger(
      getVal('AUTH_REDIS_RETRY_SECONDS'),
      'AUTH_REDIS_RETRY_SECONDS',
    ) ??
    5;

  const ttlMs = ttlSeconds * 1_000;
  if (ttlMs <= timeoutMs) {
    throw new Error(
      'IDEMPOTENCY_TTL_SECONDS * 1000 must be greater than IDEMPOTENCY_REDIS_TIMEOUT_MS',
    );
  }

  return {
    url: rawUrl,
    expectedEpoch,
    ttlSeconds,
    ttlMs,
    timeoutMs,
    retryAfterSeconds,
  };
}

/**
 * Service implementing Redis `H-IDEM` Replay Controls (`IDEMPOTENCY_TTL_SECONDS`, default 24h / `86400s`)
 * and the `R14` Loss-Epoch Fail-Closed Barrier.
 *
 * Key invariants (`C05` §13.1, §13.9, `SAD` `R14`):
 * 1. Scoped by `(userId, idempotencyKey)` where `Idempotency-Key` must be a canonical UUID (`400 INVALID_FORMAT` otherwise).
 * 2. Binds `{ method, route, bodyHash, state: 'in_flight' | 'completed', statusCode, responseBody, createdAtMs }` for the configured `IDEMPOTENCY_TTL_SECONDS` lifetime (default `86400s` / 24h).
 * 3. Same `(userId, idempotencyKey)` + identical `(method, route, bodyHash)`:
 *    - `'completed'` -> replays `{ statusCode, responseBody }` without re-running the handler.
 *    - `'in_flight'` -> fails closed with retryable `503 SERVICE_UNAVAILABLE` (NEVER clears an in-flight lock or re-executes).
 * 4. Same `(userId, idempotencyKey)` + different `method`, `route`, or `bodyHash` -> rejects with `409 IDEMPOTENCY_KEY_REUSED`.
 * 5. Maps PostgreSQL `23505` on `uq_ai_requests_idempotency` to `409 IDEMPOTENCY_KEY_REUSED`.
 * 6. **Loss-Epoch Fail-Closed Barrier (`R14`)**:
 *    - Verifies Redis key `idempotency:epoch` matches configured `IDEMPOTENCY_REDIS_EPOCH` before every `H-IDEM` operation.
 *    - Never silently self-seeds `idempotency:epoch` inside `execute()` or `onModuleInit()`.
 *    - If Redis is unreachable, or `idempotency:epoch` is missing/mismatched after a Redis flush/restart/restore
 *      (even when `PING` succeeds), fails closed with retryable `503 SERVICE_UNAVAILABLE` until either durable
 *      `public.ai_requests` reconciliation completes or the longest configured reservation lifetime
 *      (`IDEMPOTENCY_TTL_SECONDS`, default `86400`s / 24h; e.g. 48h if `IDEMPOTENCY_TTL_SECONDS=172800`) elapses
 *      and an operator explicitly acknowledges recovery via `acknowledgeEpoch()`.
 */
@Injectable()
export class IdempotencyService implements OnModuleInit, OnModuleDestroy {
  private readonly configuration?: IdempotencyConfiguration;
  private readonly hasInjectedClient: boolean;
  private client?: IdempotencyRedisClient;
  private connecting?: Promise<unknown>;
  private stopped = false;

  constructor(
    @Optional()
    @Inject(ConfigService)
    private readonly configService?: ConfigService,
    @Optional()
    @Inject(IDEMPOTENCY_CONFIGURATION)
    injectedConfig?: IdempotencyConfiguration,
    @Optional()
    @Inject(IDEMPOTENCY_REDIS_CLIENT)
    injectedClient?: IdempotencyRedisClient,
  ) {
    this.configuration =
      injectedConfig ?? readIdempotencyConfiguration(this.configService);
    this.client = injectedClient;
    this.hasInjectedClient = injectedClient !== undefined;
  }

  /**
   * Executes one-time `bootstrapInitialEpoch()` (`SET ... NX`) ONLY when explicit clean-deployment
   * provisioning (`IDEMPOTENCY_BOOTSTRAP_ON_INIT === 'true'`) is set; normal restarts and runtime
   * instances leave `idempotency:epoch` untouched so lost/mismatched Redis state fails closed (`503`).
   */
  async onModuleInit(): Promise<void> {
    if (!this.isBootstrapOnInitEnabled()) {
      return;
    }
    await this.bootstrapInitialEpoch();
  }

  private isBootstrapOnInitEnabled(): boolean {
    const configured = this.configService?.get<unknown>(
      'IDEMPOTENCY_BOOTSTRAP_ON_INIT',
    );
    const raw =
      configured !== undefined
        ? configured
        : process.env.IDEMPOTENCY_BOOTSTRAP_ON_INIT;
    return raw === 'true';
  }

  /**
   * Formats the Redis key for a user-scoped `H-IDEM` record (`idempotency:v1:{userId}:{idempotencyKey}`).
   */
  formatRedisKey(userId: string, idempotencyKey: string): string {
    return `idempotency:v1:${userId.toLowerCase()}:${idempotencyKey.toLowerCase()}`;
  }

  /**
   * Validates `Idempotency-Key` header and `userId` (`400 INVALID_FORMAT` if missing or non-UUID).
   */
  validateInputs(
    userId: string,
    rawIdempotencyKey: unknown,
  ): { userId: string; idempotencyKey: string } {
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId.trim())) {
      fail(401, 'AUTH_REQUIRED', 'Valid authenticated user ID is required');
    }
    if (
      typeof rawIdempotencyKey !== 'string' ||
      !UUID_PATTERN.test(rawIdempotencyKey.trim())
    ) {
      fail(
        400,
        'INVALID_FORMAT',
        'Idempotency-Key header is required and must be a valid UUID',
        [
          {
            field: 'Idempotency-Key',
            code: 'INVALID_FORMAT',
            message: 'Idempotency-Key must be a valid UUID',
          },
        ],
      );
    }
    return {
      userId: userId.trim().toLowerCase(),
      idempotencyKey: rawIdempotencyKey.trim().toLowerCase(),
    };
  }

  /**
   * Maps a PostgreSQL `23505` unique violation on `uq_ai_requests_idempotency` to `409 IDEMPOTENCY_KEY_REUSED`.
   * Re-throws any other error unchanged.
   */
  handleDatabaseError(error: unknown): never {
    if (isIdempotencyUniqueViolation(error)) {
      fail(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key was already used; use a new UUID key for a new operation',
      );
    }
    throw error;
  }

  /**
   * Provisions the initial `idempotency:epoch` marker using `SET ... NX` during clean
   * deployment setup before live traffic opens (never invoked on runtime request paths).
   *
   * Returns `'INITIALIZED'` if created cleanly, `'ALREADY_SET'` if Redis already holds
   * the matching epoch, or fails closed (`503 SERVICE_UNAVAILABLE`) if Redis holds a
   * mismatched epoch (e.g. a restored snapshot requiring explicit recovery and
   * `acknowledgeEpoch(E_new)` rotation).
   */
  async bootstrapInitialEpoch(
    epochOverride?: string,
  ): Promise<'INITIALIZED' | 'ALREADY_SET'> {
    const expectedEpoch =
      epochOverride?.trim() ||
      this.configuration?.expectedEpoch ||
      DEFAULT_IDEMPOTENCY_EPOCH;
    const client = await this.getActiveClient();
    try {
      const setResult = await this.withDeadline(
        client.set(IDEMPOTENCY_EPOCH_KEY, expectedEpoch, { NX: true }),
      );
      if (setResult === 'OK') {
        return 'INITIALIZED';
      }
      const existingEpoch = await this.withDeadline(
        client.get(IDEMPOTENCY_EPOCH_KEY),
      );
      if (existingEpoch === expectedEpoch) {
        return 'ALREADY_SET';
      }
      this.unavailable(
        'Existing Redis idempotency epoch mismatches expected configuration; rotate IDEMPOTENCY_REDIS_EPOCH and use acknowledgeEpoch() after recovery verification',
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.retireClient(client);
      this.unavailable('Idempotency Redis store unreachable');
    }
  }

  /**
   * Explicitly acknowledges a rotated or restored Redis epoch in `idempotency:epoch`
   * after clean recovery verification or elapsing the longest configured `IDEMPOTENCY_TTL_SECONDS`
   * reservation lifetime (default `86400`s / 24h; e.g. 48h when `IDEMPOTENCY_TTL_SECONDS=172800`),
   * so all service instances sharing Redis immediately resume `H-IDEM` execution.
   */
  async acknowledgeEpoch(epochOverride?: string): Promise<void> {
    const expectedEpoch =
      epochOverride?.trim() ||
      this.configuration?.expectedEpoch ||
      DEFAULT_IDEMPOTENCY_EPOCH;
    const client = await this.getActiveClient();
    try {
      await this.withDeadline(client.set(IDEMPOTENCY_EPOCH_KEY, expectedEpoch));
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.retireClient(client);
      this.unavailable('Idempotency Redis store unreachable');
    }
  }

  /**
   * Executes an `H-IDEM` mutation guarded by atomic Redis Lua scripts (`EVAL`) and the `R14` loss-epoch barrier.
   *
   * Flow:
   * 1. Validates `userId`, `Idempotency-Key` UUID format, HTTP method, and concrete route path (`400 INVALID_FORMAT`).
   * 2. Atomically checks `idempotency:epoch == expectedEpoch` and acquires `'in_flight'` with a unique
   *    per-invocation `reservationToken` in a single Lua `EVAL` (`503 SERVICE_UNAVAILABLE` on mismatch/outage/`CORRUPT_TTL`).
   * 3. If the key already exists:
   *    - Validates stored shape (`userId`, `idempotencyKey`, valid HTTP `statusCode`) and live `PTTL > 0` (`503` on corruption).
   *    - If `method`, `route`, or `bodyHash` differs -> `409 IDEMPOTENCY_KEY_REUSED`.
   *    - If `state === 'completed'` -> returns cached `{ statusCode, responseBody, replayed: true }` without invoking `handler`.
   *    - If `state === 'in_flight'` -> fails closed with retryable `503 SERVICE_UNAVAILABLE` (never clears lock or re-runs).
   * 4. If acquired, checks `!stopped` and `remainingMs = ttlMs - elapsed > 0` before invoking `handler(executionContext)`,
   *    where `executionContext = { idempotencyKey, reservationToken, expiresAtMs, signal }`:
   *    - Mutating handlers MUST honor `executionContext.signal` / `executionContext.expiresAtMs` and/or enforce a durable
   *      unique claim (such as `uq_ai_requests_idempotency` on `(user_id, idempotency_key)`) so reservation expiry cannot
   *      permit overlapping side effects. Cancellation is cooperative via `executionContext.signal` plus post-settlement
   *      expiry rejection (`execute()` awaits handler settlement and can remain pending if a handler ignores `signal` and
   *      never settles).
   *    - On PostgreSQL `23505` (`uq_ai_requests_idempotency`) while the reservation is still active, throws `409 IDEMPOTENCY_KEY_REUSED`.
   *    - If `signal.aborted` becomes `true` or the monotonic reservation deadline elapses during execution, fails closed with
   *      retryable `503 SERVICE_UNAVAILABLE` without attempting completion or deleting the key.
   *    - On any other handler error/crash, leaves `'in_flight'` intact (`R14`).
   *    - On active-reservation success, obtains the currently active client via `getActiveClient()` and executes atomic
   *      ownership-verified completion Lua `EVAL` (`epoch`, `reservationToken`, and `PTTL > 0` without extending TTL).
   *      Never reruns `handler()` or retries unknown completion outcomes.
   */
  async execute<T>(
    context: IdempotencyOperationContext,
    handler: (
      executionContext: IdempotencyExecutionContext,
    ) => Promise<IdempotencyHandlerResult<T>>,
  ): Promise<IdempotencyExecutionResult<T>> {
    const { userId, idempotencyKey } = this.validateInputs(
      context.userId,
      context.idempotencyKey,
    );
    if (typeof context.method !== 'string' || !context.method.trim()) {
      fail(400, 'INVALID_FORMAT', 'HTTP method is required', [
        {
          field: 'method',
          code: 'INVALID_FORMAT',
          message: 'method must be a non-empty HTTP method',
        },
      ]);
    }
    const method = context.method.trim().toUpperCase();
    const route = normalizeConcreteRoute(context.route);
    const bodyHash = computeCanonicalBodyHash(context.body ?? null);

    const client = await this.getActiveClient();
    if (typeof client.eval !== 'function') {
      this.unavailable('Idempotency Redis client missing atomic EVAL support');
    }

    const expectedEpoch =
      this.configuration?.expectedEpoch ?? DEFAULT_IDEMPOTENCY_EPOCH;
    const redisKey = this.formatRedisKey(userId, idempotencyKey);
    const ttlMs = this.configuration?.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
    const nowMs = Date.now();
    const reservationToken = randomUUID();

    const inFlightRecord: IdempotencyRecord<T> = {
      userId,
      idempotencyKey,
      method,
      route,
      bodyHash,
      state: 'in_flight',
      reservationToken,
      createdAtMs: nowMs,
    };

    const acquireStartedMs = performance.now();
    const reservationDeadlineMs = acquireStartedMs + ttlMs;
    let acquireResult: unknown;
    try {
      acquireResult = await this.withDeadline(
        client.eval(ACQUIRE_IDEMPOTENCY_SCRIPT, {
          keys: [IDEMPOTENCY_EPOCH_KEY, redisKey],
          arguments: [
            expectedEpoch,
            JSON.stringify(inFlightRecord),
            String(ttlMs),
          ],
        }),
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.retireClient(client);
      this.unavailable(
        'Idempotency store unavailable; refusing mutation under fail-closed policy',
      );
    }

    if (!Array.isArray(acquireResult) || acquireResult.length < 1) {
      this.unavailable(
        'Invalid response from idempotency store; failing closed',
      );
    }

    const [acquireStatus, rawExistingPayload, rawPttl] = acquireResult as [
      unknown,
      unknown,
      unknown,
    ];

    if (acquireStatus === 'EPOCH_MISMATCH') {
      this.unavailable(
        'Idempotency Redis loss-epoch barrier active: cache epoch is missing or mismatched after restart/flush',
      );
    }

    if (acquireStatus === 'CORRUPT_TTL') {
      this.unavailable(
        'Idempotency record has missing or expired TTL in Redis; failing closed',
      );
    }

    if (acquireStatus === 'EXISTING') {
      return this.resolveExistingPayload<T>(
        rawExistingPayload,
        rawPttl,
        userId,
        idempotencyKey,
        method,
        route,
        bodyHash,
      );
    }

    if (acquireStatus !== 'ACQUIRED') {
      this.unavailable(
        'Unexpected idempotency store state; failing closed to prevent duplicate execution',
      );
    }

    const remainingMs = reservationDeadlineMs - performance.now();
    if (this.stopped || remainingMs <= 0) {
      this.unavailable(
        'Idempotency reservation expired or service stopped before mutation dispatch',
      );
    }

    const expiresAtMs = Date.now() + Math.floor(remainingMs);
    const abortController = new AbortController();
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const MAX_TIMEOUT_MS = 2_147_483_647;
    const armExpiryTimer = (delayMs: number) => {
      const clampedDelayMs = Math.min(delayMs, MAX_TIMEOUT_MS);
      const timer = setTimeout(() => {
        const left = reservationDeadlineMs - performance.now();
        if (delayMs > MAX_TIMEOUT_MS && left > 0) {
          armExpiryTimer(left);
          return;
        }
        abortController.abort(
          new Error('Idempotency reservation expired before handler completed'),
        );
      }, clampedDelayMs);
      timer.unref?.();
      expiryTimer = timer;
    };
    armExpiryTimer(remainingMs);

    const throwIfReservationExpired = () => {
      if (
        abortController.signal.aborted ||
        performance.now() >= reservationDeadlineMs
      ) {
        this.unavailable(
          'Idempotency reservation expired during handler execution; failing closed',
        );
      }
    };

    let result: IdempotencyHandlerResult<T>;
    try {
      result = await handler({
        idempotencyKey,
        reservationToken,
        expiresAtMs,
        signal: abortController.signal,
      });
    } catch (error) {
      throwIfReservationExpired();
      if (isIdempotencyUniqueViolation(error)) {
        fail(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key was already used; use a new UUID key for a new operation',
        );
      }
      // R14 invariant: NEVER auto-delete an 'in_flight' idempotency key on handler error/timeout and re-run.
      throw error;
    } finally {
      clearTimeout(expiryTimer);
    }

    throwIfReservationExpired();

    const activeClient = await this.getActiveClient();
    if (typeof activeClient.eval !== 'function') {
      this.unavailable('Idempotency Redis client missing atomic EVAL support');
    }
    if (
      this.stopped ||
      abortController.signal.aborted ||
      performance.now() >= reservationDeadlineMs
    ) {
      this.unavailable(
        'Idempotency reservation expired or service stopped before completion commit',
      );
    }

    const completedRecord: IdempotencyRecord<T> = {
      ...inFlightRecord,
      state: 'completed',
      statusCode: result.statusCode,
      responseBody: result.responseBody,
    };

    let completeStatus: unknown;
    try {
      completeStatus = await this.withDeadline(
        activeClient.eval(COMPLETE_IDEMPOTENCY_SCRIPT, {
          keys: [IDEMPOTENCY_EPOCH_KEY, redisKey],
          arguments: [
            expectedEpoch,
            reservationToken,
            JSON.stringify(completedRecord),
          ],
        }),
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.retireClient(activeClient);
      this.unavailable(
        'Idempotency store unavailable during completion; failing closed',
      );
    }

    if (completeStatus !== 'COMPLETED') {
      this.unavailable(
        'Idempotency reservation expired, lost ownership, or epoch mismatched before completion',
      );
    }

    return {
      statusCode: result.statusCode,
      responseBody: result.responseBody,
      replayed: false,
    };
  }

  /**
   * Resolves an existing Redis `H-IDEM` record returned atomically from `ACQUIRE_IDEMPOTENCY_SCRIPT`.
   */
  private resolveExistingPayload<T>(
    rawExisting: unknown,
    rawPttl: unknown,
    userId: string,
    idempotencyKey: string,
    method: string,
    route: string,
    bodyHash: string,
  ): IdempotencyExecutionResult<T> {
    if (typeof rawExisting !== 'string' || !rawExisting) {
      this.unavailable(
        'Idempotency key state is ambiguous; failing closed to prevent duplicate execution',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawExisting);
    } catch {
      this.unavailable('Corrupted idempotency record in Redis; failing closed');
    }

    if (!isStoredIdempotencyRecord<T>(parsed)) {
      this.unavailable('Corrupted idempotency record in Redis; failing closed');
    }

    if (
      parsed.userId.toLowerCase() !== userId ||
      parsed.idempotencyKey.toLowerCase() !== idempotencyKey
    ) {
      this.unavailable(
        'Idempotency record identity mismatch in Redis; failing closed',
      );
    }

    const pttl = Number(rawPttl);
    if (!Number.isFinite(pttl) || pttl <= 0) {
      this.unavailable(
        'Idempotency record has missing or expired TTL in Redis; failing closed',
      );
    }

    if (
      parsed.method !== method ||
      parsed.route !== route ||
      parsed.bodyHash !== bodyHash
    ) {
      fail(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency-Key cannot be reused with a different method, route, or request payload',
      );
    }

    if (parsed.state === 'completed') {
      return {
        statusCode: parsed.statusCode!,
        responseBody: parsed.responseBody as T,
        replayed: true,
      };
    }

    // state === 'in_flight': R14 fail-closed rule — never clear lock or re-execute
    const retrySeconds = this.resolveRetrySecondsFromPttl(pttl);
    this.unavailable(
      'An operation with this Idempotency-Key is currently in flight or in an ambiguous crash state',
      retrySeconds,
    );
  }

  private resolveRetrySecondsFromPttl(rawPttl: unknown): number {
    const defaultRetry = this.configuration?.retryAfterSeconds ?? 5;
    const pttl = Number(rawPttl);
    if (Number.isFinite(pttl) && pttl > 0) {
      return Math.min(defaultRetry, Math.max(1, Math.ceil(pttl / 1_000)));
    }
    return defaultRetry;
  }

  private safeDestroy(target?: IdempotencyRedisClient): void {
    try {
      if (target?.isOpen !== false && typeof target?.destroy === 'function') {
        target.destroy();
      }
    } catch {
      // Ignore destroy errors during shutdown/retirement
    }
  }

  private async connectWithDeadline(
    target: IdempotencyRedisClient,
  ): Promise<void> {
    let timedOut = false;
    if (!this.connecting) {
      const rawConnect = target.connect!();
      rawConnect
        .then(() => {
          if (timedOut || this.stopped || this.client !== target) {
            this.safeDestroy(target);
          }
        })
        .catch(() => undefined);
      const tracked = rawConnect.finally(() => {
        if (this.connecting === tracked) {
          this.connecting = undefined;
        }
      });
      this.connecting = tracked;
    }
    try {
      await this.withDeadline(this.connecting);
    } catch (error) {
      timedOut = true;
      throw error;
    }
  }

  private assertClientActiveAfterConnect(
    activeClient: IdempotencyRedisClient,
  ): void {
    if (this.stopped || this.client !== activeClient) {
      this.safeDestroy(activeClient);
      this.unavailable('Idempotency service is shutting down');
    }
  }

  private async getActiveClient(): Promise<IdempotencyRedisClient> {
    if (this.stopped) {
      this.unavailable();
    }
    if (this.client) {
      const existingClient = this.client;
      if (
        existingClient.isReady === false &&
        typeof existingClient.connect === 'function'
      ) {
        try {
          await this.connectWithDeadline(existingClient);
        } catch {
          this.retireClient(existingClient);
          this.unavailable();
        }
        this.assertClientActiveAfterConnect(existingClient);
      }
      return existingClient;
    }

    if (!this.configuration) {
      this.unavailable('Idempotency Redis store is not configured');
    }

    const timeout = this.configuration.timeoutMs;
    let created: IdempotencyRedisClient | undefined;
    try {
      created = createClient({
        url: this.configuration.url,
        RESP: 2,
        maintNotifications: 'disabled',
        disableOfflineQueue: true,
        socket: { connectTimeout: timeout, reconnectStrategy: false },
      }) as unknown as IdempotencyRedisClient;
      created.on?.('error', () => undefined);
      this.client = created;

      if (!created.isReady && typeof created.connect === 'function') {
        await this.connectWithDeadline(created);
      }

      this.assertClientActiveAfterConnect(created);
      return created;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.retireClient(created);
      this.unavailable();
    }
  }

  private retireClient(failedClient?: IdempotencyRedisClient): void {
    const target = failedClient ?? this.client;
    this.safeDestroy(target);
    if (target && this.client === target) {
      this.connecting = undefined;
      if (!this.hasInjectedClient && this.configuration) {
        this.client = undefined;
      }
    }
  }

  private unavailable(
    message = 'Idempotency service temporarily unavailable',
    retryAfterSeconds = this.configuration?.retryAfterSeconds ?? 5,
  ): never {
    fail(503, 'SERVICE_UNAVAILABLE', message, [], true, retryAfterSeconds);
  }

  private async withDeadline<T>(
    operation: Promise<T>,
    milliseconds = this.configuration?.timeoutMs ?? 1_000,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Idempotency Redis deadline exceeded')),
            milliseconds,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    const client = this.client;
    const connecting = this.connecting;
    this.client = undefined;
    this.connecting = undefined;
    const timeoutMs = this.configuration?.timeoutMs ?? 1_000;

    if (connecting) {
      await this.withDeadline(connecting, timeoutMs).catch(() => undefined);
    }

    if (!client) {
      return;
    }

    let destroyed = false;
    const safeDestroy = () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      try {
        if (typeof client.destroy === 'function') {
          client.destroy();
        }
      } catch {
        // Ignore destroy errors during shutdown
      }
    };

    if (client.isOpen && typeof client.quit === 'function') {
      try {
        await this.withDeadline(client.quit(), timeoutMs);
      } catch {
        safeDestroy();
      } finally {
        if (client.isOpen) {
          safeDestroy();
        }
      }
    } else if (client.isOpen) {
      safeDestroy();
    }
  }
}

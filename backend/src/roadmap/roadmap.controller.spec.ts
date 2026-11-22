import {
  Global,
  HttpException,
  Logger,
  type INestApplication,
  Module,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiGatewayService } from '../ai/services/ai-gateway.service.js';
import { AuthModule } from '../auth/auth.module.js';
import type { AccessPolicy } from '../auth/policy.js';
import { DatabaseService } from '../auth/services/database.service.js';
import { configureHttp } from '../common/http.js';
import {
  IDEMPOTENCY_EPOCH_KEY,
  IdempotencyService,
  type IdempotencyRedisClient,
} from '../jobs/services/idempotency.service.js';
import { JobProducerService } from '../jobs/services/job-producer.service.js';
import { PostgresJobQueueConsumer } from '../jobs/services/postgres-job-queue.consumer.js';
import { RoadmapController } from './controllers/roadmap.controller.js';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  ArchiveRoadmapDTO,
  GenerateRoadmapRequestDTO,
  LockRoadmapDTO,
  RevisionRequestDTO,
  type ArchiveRoadmapResponseDTO,
  type FocusSwitchResponseDTO,
  type LockRoadmapResponseDTO,
  type RoadmapDetailDTO,
  type RoadmapSummaryDTO,
  type RoadmapVersionDTO,
} from './dto/roadmap.dto.js';
import { RoadmapModule } from './roadmap.module.js';
import { RoadmapJobHandler } from './services/roadmap-job.handler.js';
import { RoadmapService } from './services/roadmap.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GOAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROADMAP_ID = '22222222-2222-4222-8222-222222222222';
const ROLE_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID = '55555555-5555-4555-8555-555555555555';
const IDEM_KEY_1 = '66666666-6666-4666-8666-666666666666';
const IDEM_KEY_2 = '77777777-7777-4777-8777-777777777777';

function signEs256Jwt(
  privateKey: KeyObject,
  claims: Record<string, unknown>,
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'test-kid-1' }),
  ).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = sign('SHA256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${signingInput}.${signature}`;
}

function createMockDataSource(): DataSource {
  return {
    isInitialized: true,
    query: vi.fn().mockResolvedValue([]),
    destroy: vi.fn().mockResolvedValue(undefined),
  } as unknown as DataSource;
}

@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      useFactory: createMockDataSource,
    },
  ],
  exports: [DataSource],
})
class TestDataSourceModule {}

function expectContractError(
  error: unknown,
  expectedStatus: number,
  expectedCode: string,
) {
  expect(error).toBeInstanceOf(HttpException);
  const httpErr = error as HttpException;
  expect(httpErr.getStatus()).toBe(expectedStatus);
  const body = httpErr.getResponse() as { code?: string };
  expect(body.code).toBe(expectedCode);
}

function createInMemoryIdempotencyService(epoch: string | null = 'epoch-v1') {
  const store = new Map<string, string>();
  if (epoch !== null) {
    store.set(IDEMPOTENCY_EPOCH_KEY, epoch);
  }

  const client: IdempotencyRedisClient = {
    isReady: true,
    isOpen: true,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, opts?: { NX?: boolean }) => {
      if (opts?.NX && store.has(key)) {
        return null;
      }
      store.set(key, value);
      return 'OK';
    }),
    eval: vi.fn(
      async (script: string, opts: { keys: string[]; arguments: string[] }) => {
        const [epochKey, redisKey] = opts.keys;
        if (script.includes('ACQUIRED')) {
          const [expectedEpoch, serializedInFlight, ttlMs] = opts.arguments;
          if (store.get(epochKey) !== expectedEpoch) {
            return ['EPOCH_MISMATCH', '', '-2'];
          }
          const existing = store.get(redisKey);
          if (existing) {
            return ['EXISTING', existing, ttlMs];
          }
          store.set(redisKey, serializedInFlight);
          return ['ACQUIRED', serializedInFlight, ttlMs];
        }
        const [expectedEpoch, token, serializedCompleted] = opts.arguments;
        if (store.get(epochKey) !== expectedEpoch) {
          return 'EPOCH_MISMATCH';
        }
        const existing = store.get(redisKey);
        if (!existing) {
          return 'RESERVATION_LOST';
        }
        const decoded = JSON.parse(existing) as {
          state?: string;
          reservationToken?: string;
        };
        if (
          decoded.state !== 'in_flight' ||
          decoded.reservationToken !== token
        ) {
          return 'OWNERSHIP_MISMATCH';
        }
        store.set(redisKey, serializedCompleted);
        return 'COMPLETED';
      },
    ),
  };

  return new IdempotencyService(
    undefined,
    {
      url: 'redis://127.0.0.1:6379',
      expectedEpoch: epoch ?? 'epoch-v1',
      ttlSeconds: 86_400,
      ttlMs: 86_400_000,
      timeoutMs: 1_000,
      retryAfterSeconds: 5,
    },
    client,
  );
}

const SAMPLE_ACCEPTED_GENERATE = {
  job_id: JOB_ID,
  kind: 'roadmap_generate' as const,
  status: 'queued' as const,
  poll_url: `/api/v1/jobs/${JOB_ID}`,
  retry_after_seconds: 3,
};

const SAMPLE_ACCEPTED_REVISION = {
  job_id: JOB_ID,
  kind: 'roadmap_revision' as const,
  status: 'queued' as const,
  poll_url: `/api/v1/jobs/${JOB_ID}`,
  retry_after_seconds: 3,
};

const SAMPLE_SUMMARY_DTO: RoadmapSummaryDTO = {
  id: ROADMAP_ID,
  career_goal_id: GOAL_ID,
  canonical_role_id: ROLE_ID,
  role_name: 'Backend Development',
  target_level: 'mid',
  status: 'locked',
  is_focus: true,
  current_version_id: VERSION_ID,
  current_version_no: 2,
  draft_version_no: null,
  has_open_draft: false,
  has_open_merge: false,
  has_daily_plan: true,
  stale: false,
  stale_draft: false,
  locked_at: '2026-10-10T08:30:00.000Z',
  archived_at: null,
  created_at: '2026-10-10T08:00:00.000Z',
  updated_at: '2026-10-10T08:30:00.000Z',
};

const SAMPLE_DETAIL_DTO: RoadmapDetailDTO = {
  id: ROADMAP_ID,
  career_goal_id: GOAL_ID,
  canonical_role_id: ROLE_ID,
  role_name: 'Backend Development',
  target_level: 'mid',
  status: 'draft',
  is_focus: false,
  version_id: VERSION_ID,
  version_no: 1,
  version_state: 'draft',
  summary: {
    current_situation: 'Foundational SQL knowledge',
    target_interpretation: 'Mid-level backend API development',
    expected_career_impact: 'Ready for production API engineering',
    next_steps: ['Master PostgreSQL locking'],
  },
  phases: [],
  items: [],
  level_outline: [],
  size_guardrail: {
    active_topic_count: 10,
    soft_max_topics: 45,
    materially_large: false,
    warning: null,
  },
  warnings: [],
  stale: false,
  stale_reason: null,
  locked_at: null,
  created_at: '2026-10-10T08:00:00.000Z',
};

const SAMPLE_LOCK_RESPONSE: LockRoadmapResponseDTO = {
  roadmap_id: ROADMAP_ID,
  status: 'locked',
  version_no: 1,
  current_version_id: VERSION_ID,
  is_focus: true,
  locked_at: '2026-10-10T08:30:00.000Z',
  next_step: 'confirm_learning_hours',
  preferred_daily_hours: 2,
  size_guardrail: {
    active_topic_count: 10,
    soft_max_topics: 45,
    materially_large: false,
    warning: null,
  },
};

const SAMPLE_VERSION_DTO: RoadmapVersionDTO = {
  id: VERSION_ID,
  version_no: 1,
  state: 'draft',
  created_by: 'ai',
  target_level: 'mid',
  base_version_id: null,
  merge_id: null,
  stale: false,
  locked_at: null,
  superseded_at: null,
  created_at: '2026-10-10T08:00:00.000Z',
};

const SAMPLE_FOCUS_DTO: FocusSwitchResponseDTO = {
  focus_roadmap_id: ROADMAP_ID,
  daily_plan: {
    state: 'existing',
    plan_id: '88888888-8888-4888-8888-888888888888',
    requires_learning_hours: false,
  },
};

const SAMPLE_ARCHIVE_DTO: ArchiveRoadmapResponseDTO = {
  archived_roadmap_id: ROADMAP_ID,
  status: 'archived',
  new_focus_roadmap_id: null,
};

describe('RoadmapController (EP-R01–EP-R07, EP-R14, EP-R15 /api/v1/roadmaps)', () => {
  let serviceMock: {
    generateRoadmap: ReturnType<typeof vi.fn>;
    listRoadmaps: ReturnType<typeof vi.fn>;
    getRoadmap: ReturnType<typeof vi.fn>;
    requestRevision: ReturnType<typeof vi.fn>;
    lockRoadmap: ReturnType<typeof vi.fn>;
    listVersions: ReturnType<typeof vi.fn>;
    getVersion: ReturnType<typeof vi.fn>;
    setFocus: ReturnType<typeof vi.fn>;
    archiveRoadmap: ReturnType<typeof vi.fn>;
  };
  let idempotencyService: IdempotencyService;
  let controller: RoadmapController;

  beforeEach(() => {
    vi.clearAllMocks();
    serviceMock = {
      generateRoadmap: vi.fn().mockResolvedValue(SAMPLE_ACCEPTED_GENERATE),
      listRoadmaps: vi.fn().mockResolvedValue({
        items: [SAMPLE_SUMMARY_DTO],
        meta: { limit: 20, next_cursor: null },
      }),
      getRoadmap: vi.fn().mockResolvedValue(SAMPLE_DETAIL_DTO),
      requestRevision: vi.fn().mockResolvedValue(SAMPLE_ACCEPTED_REVISION),
      lockRoadmap: vi.fn().mockResolvedValue(SAMPLE_LOCK_RESPONSE),
      listVersions: vi.fn().mockResolvedValue({
        items: [SAMPLE_VERSION_DTO],
        meta: { limit: 20, next_cursor: null },
      }),
      getVersion: vi.fn().mockResolvedValue(SAMPLE_DETAIL_DTO),
      setFocus: vi.fn().mockResolvedValue(SAMPLE_FOCUS_DTO),
      archiveRoadmap: vi.fn().mockResolvedValue(SAMPLE_ARCHIVE_DTO),
    };
    idempotencyService = createInMemoryIdempotencyService();
    controller = new RoadmapController(
      serviceMock as unknown as RoadmapService,
      idempotencyService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('relies on global APP_GUARD (no duplicate controller @UseGuards) and enforces @Policy gates per EP-R01–EP-R07, EP-R14, EP-R15', () => {
    expect(
      Reflect.getMetadata('__guards__', RoadmapController),
    ).toBeUndefined();

    const writeRoutes = [
      RoadmapController.prototype.generateRoadmap,
      RoadmapController.prototype.requestRevision,
      RoadmapController.prototype.lockRoadmap,
    ];
    for (const handler of writeRoutes) {
      const policy = Reflect.getMetadata(
        'access-policy',
        handler,
      ) as AccessPolicy;
      expect(policy).toEqual({ feature: 'roadmap_generator' });
    }

    const unGatedRoutes = [
      RoadmapController.prototype.listRoadmaps,
      RoadmapController.prototype.getRoadmap,
      RoadmapController.prototype.listVersions,
      RoadmapController.prototype.getVersion,
      RoadmapController.prototype.setFocus,
      RoadmapController.prototype.archiveRoadmap,
    ];
    for (const handler of unGatedRoutes) {
      const policy = Reflect.getMetadata(
        'access-policy',
        handler,
      ) as AccessPolicy;
      expect(policy).toEqual({});
      expect(policy?.feature).toBeUndefined();
    }
  });

  it('strictly excludes EP-R08–EP-R13 merge routes and EP-L01–EP-L07 learning routes', () => {
    for (const key of Object.getOwnPropertyNames(RoadmapController.prototype)) {
      if (key === 'constructor') continue;
      const fn = (
        RoadmapController.prototype as unknown as Record<string, unknown>
      )[key];
      if (typeof fn === 'function') {
        const routePath = String(Reflect.getMetadata('path', fn) ?? '');
        expect(routePath).not.toContain('merge');
        expect(routePath).not.toContain('learning');
        expect(routePath).not.toContain('daily-plan');
      }
    }
  });

  it('enforces H-IDEM on EP-R01, EP-R04, and EP-R05 (missing key -> 400, replay -> same body, reuse different body or If-Match -> 409)', async () => {
    const reqWithoutKey = { user: { sub: USER_ID }, headers: {} };
    await expect(
      controller.generateRoadmap(reqWithoutKey, {
        career_goal_id: GOAL_ID,
        target_level: 'mid',
        level_confirmed: true,
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 400, 'INVALID_FORMAT');
      return true;
    });

    await expect(
      controller.requestRevision(
        {
          user: { sub: USER_ID },
          headers: { 'idempotency-key': 'not-a-uuid' },
        },
        ROADMAP_ID,
        { instruction: 'Expand testing section' },
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 400, 'INVALID_FORMAT');
      return true;
    });

    const headersSet: Record<string, unknown> = {};
    const mockRes = {
      setHeader: (k: string, v: unknown) => {
        headersSet[k] = v;
      },
      status: vi.fn(),
    };

    const req1 = {
      user: { sub: USER_ID },
      headers: {
        'idempotency-key': IDEM_KEY_1,
        'accept-language': 'bn',
      },
    };
    const first = await controller.generateRoadmap(
      req1,
      { career_goal_id: GOAL_ID, target_level: 'mid', level_confirmed: true },
      mockRes as never,
    );
    expect(first).toEqual(SAMPLE_ACCEPTED_GENERATE);
    expect(headersSet.Location).toBe(`/api/v1/jobs/${JOB_ID}`);
    expect(serviceMock.generateRoadmap).toHaveBeenCalledTimes(1);

    // Replay same key + same body -> service NOT called again
    const replay = await controller.generateRoadmap(
      req1,
      { career_goal_id: GOAL_ID, target_level: 'mid', level_confirmed: true },
      mockRes as never,
    );
    expect(replay).toEqual(SAMPLE_ACCEPTED_GENERATE);
    expect(serviceMock.generateRoadmap).toHaveBeenCalledTimes(1);

    // Reuse same key with different payload -> 409 IDEMPOTENCY_KEY_REUSED
    await expect(
      controller.generateRoadmap(req1, {
        career_goal_id: '99999999-9999-4999-8999-999999999999',
        target_level: 'mid',
        level_confirmed: true,
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 409, 'IDEMPOTENCY_KEY_REUSED');
      return true;
    });

    // Lock with H-IDEM + normalized If-Match header: `"1"`, `W/"1"`, and `1` replay; `"2"` conflicts
    const lockReq = {
      user: { sub: USER_ID },
      headers: {
        'idempotency-key': IDEM_KEY_2,
        'if-match': '"1"',
      },
    };
    const lockFirst = await controller.lockRoadmap(lockReq, ROADMAP_ID, {
      version_no: 1,
    });
    expect(lockFirst).toEqual(SAMPLE_LOCK_RESPONSE);
    expect(serviceMock.lockRoadmap).toHaveBeenCalledWith(
      USER_ID,
      ROADMAP_ID,
      { version_no: 1 },
      expect.objectContaining({
        idempotencyKey: IDEM_KEY_2,
        ifMatch: 1,
      }),
    );

    const lockReplayWeak = await controller.lockRoadmap(
      {
        user: { sub: USER_ID },
        headers: { 'idempotency-key': IDEM_KEY_2, 'if-match': 'W/"1"' },
      },
      ROADMAP_ID,
      { version_no: 1 },
    );
    expect(lockReplayWeak).toEqual(SAMPLE_LOCK_RESPONSE);
    expect(serviceMock.lockRoadmap).toHaveBeenCalledTimes(1);

    await expect(
      controller.lockRoadmap(
        {
          user: { sub: USER_ID },
          headers: { 'idempotency-key': IDEM_KEY_2, 'if-match': '"2"' },
        },
        ROADMAP_ID,
        { version_no: 1 },
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 409, 'IDEMPOTENCY_KEY_REUSED');
      return true;
    });

    // Revision with H-IDEM + normalized If-Match header: `1` and `W/"1"` replay; `"2"` conflicts
    const revKey = '99999999-9999-4999-8999-999999999991';
    const revFirst = await controller.requestRevision(
      {
        user: { sub: USER_ID },
        headers: { 'idempotency-key': revKey, 'if-match': '1' },
      },
      ROADMAP_ID,
      { instruction: 'Expand indexing exercises' },
      mockRes as never,
    );
    expect(revFirst).toEqual(SAMPLE_ACCEPTED_REVISION);
    expect(serviceMock.requestRevision).toHaveBeenCalledTimes(1);

    const revReplay = await controller.requestRevision(
      {
        user: { sub: USER_ID },
        headers: { 'idempotency-key': revKey, 'if-match': 'W/"1"' },
      },
      ROADMAP_ID,
      { instruction: 'Expand indexing exercises' },
      mockRes as never,
    );
    expect(revReplay).toEqual(SAMPLE_ACCEPTED_REVISION);
    expect(serviceMock.requestRevision).toHaveBeenCalledTimes(1);

    await expect(
      controller.requestRevision(
        {
          user: { sub: USER_ID },
          headers: { 'idempotency-key': revKey, 'if-match': '"2"' },
        },
        ROADMAP_ID,
        { instruction: 'Expand indexing exercises' },
        mockRes as never,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 409, 'IDEMPOTENCY_KEY_REUSED');
      return true;
    });

    // DTO validation requires target_level and level_confirmed === true
    const missingFieldsDto = plainToInstance(GenerateRoadmapRequestDTO, {
      career_goal_id: GOAL_ID,
    });
    const missingErrors = await validate(missingFieldsDto);
    expect(missingErrors.map((e) => e.property).sort()).toEqual([
      'level_confirmed',
      'target_level',
    ]);
    const unconfirmedDto = plainToInstance(GenerateRoadmapRequestDTO, {
      career_goal_id: GOAL_ID,
      target_level: 'mid',
      level_confirmed: false,
    });
    const unconfirmedErrors = await validate(unconfirmedDto);
    expect(unconfirmedErrors.map((e) => e.property)).toEqual([
      'level_confirmed',
    ]);

    // DTOs block boolean-to-number coercion and int4 overflow on version fields, and count archive reason by Unicode code points
    const boolRevDto = plainToInstance(RevisionRequestDTO, {
      refresh_stale: true,
      expected_version_no: true,
    });
    expect((await validate(boolRevDto)).map((e) => e.property)).toEqual([
      'expected_version_no',
    ]);

    const boolLockDto = plainToInstance(LockRoadmapDTO, {
      expected_version_no: true,
      version_no: 2_147_483_648,
    });
    expect((await validate(boolLockDto)).map((e) => e.property).sort()).toEqual(
      ['expected_version_no', 'version_no'],
    );

    const emoji500Dto = plainToInstance(ArchiveRoadmapDTO, {
      reason: '🚀'.repeat(500),
    });
    expect(await validate(emoji500Dto)).toEqual([]);
    const emoji501Dto = plainToInstance(ArchiveRoadmapDTO, {
      reason: '🚀'.repeat(501),
    });
    expect((await validate(emoji501Dto)).map((e) => e.property)).toEqual([
      'reason',
    ]);

    // int4 overflow in path param / If-Match rejected with 400 INVALID_FORMAT
    await expect(
      controller.getVersion(
        { user: { sub: USER_ID }, headers: {} },
        ROADMAP_ID,
        '2147483648',
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 400, 'INVALID_FORMAT');
      return true;
    });
    await expect(
      controller.lockRoadmap(
        {
          user: { sub: USER_ID },
          headers: {
            'idempotency-key': '99999999-9999-4999-8999-999999999992',
            'if-match': '"2147483648"',
          },
        },
        ROADMAP_ID,
        {},
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 400, 'INVALID_FORMAT');
      return true;
    });
  });

  it('logs safe non-prod metadata (no secrets/PII) when EP-R01 fails closed with 503 SERVICE_UNAVAILABLE (missing Redis idempotency:epoch) and suppresses log in production', async () => {
    const unseededIdempotency = createInMemoryIdempotencyService(null);
    const controllerWithUnseededEpoch = new RoadmapController(
      serviceMock as unknown as RoadmapService,
      unseededIdempotency,
    );
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const prevNodeEnv = process.env.NODE_ENV;
    const req = {
      user: { sub: USER_ID },
      headers: {
        'idempotency-key': IDEM_KEY_1,
        authorization: 'Bearer secret-jwt-must-never-be-logged',
      },
    };
    const mockRes = {
      getHeader: (name: string) =>
        name === 'X-Request-Id' ? 'req-trace-503-test' : undefined,
      setHeader: vi.fn(),
      status: vi.fn(),
    };

    try {
      process.env.NODE_ENV = 'development';
      await expect(
        controllerWithUnseededEpoch.generateRoadmap(
          req,
          {
            career_goal_id: GOAL_ID,
            target_level: 'mid',
            level_confirmed: true,
          },
          mockRes as never,
        ),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE');
        const body = (err as HttpException).getResponse() as {
          retryAfterSeconds?: number;
          retryable?: boolean;
        };
        expect(body.retryAfterSeconds).toBe(5);
        expect(body.retryable).toBe(true);
        return true;
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = String(warnSpy.mock.calls[0]?.[0] ?? '');
      expect(JSON.parse(logged)).toEqual({
        operation: 'ep_r01.idempotency_execute',
        errorName: 'ContractException',
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        requestId: 'req-trace-503-test',
      });
      expect(logged).not.toContain('loss-epoch');
      expect(logged).not.toContain('secret-jwt-must-never-be-logged');
      expect(logged).not.toContain(GOAL_ID);

      // Raw Error.message containing credentials or private goal text must never be logged
      warnSpy.mockClear();
      serviceMock.generateRoadmap.mockRejectedValueOnce(
        new Error('postgres://user:super-secret-pass@db/app private-goal-text'),
      );
      await expect(
        controller.generateRoadmap(
          req,
          {
            career_goal_id: GOAL_ID,
            target_level: 'mid',
            level_confirmed: true,
          },
          mockRes as never,
        ),
      ).rejects.toThrow('super-secret-pass');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const rawErrLogged = String(warnSpy.mock.calls[0]?.[0] ?? '');
      expect(JSON.parse(rawErrLogged)).toEqual({
        operation: 'ep_r01.roadmap_service_generate',
        errorName: 'Error',
        status: 500,
        code: 'INTERNAL_ERROR',
        requestId: 'req-trace-503-test',
      });
      expect(rawErrLogged).not.toContain('super-secret-pass');
      expect(rawErrLogged).not.toContain('private-goal-text');

      warnSpy.mockClear();
      process.env.NODE_ENV = 'production';
      await expect(
        controllerWithUnseededEpoch.generateRoadmap(
          req,
          {
            career_goal_id: GOAL_ID,
            target_level: 'mid',
            level_confirmed: true,
          },
          mockRes as never,
        ),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 503, 'SERVICE_UNAVAILABLE');
        return true;
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      if (prevNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prevNodeEnv;
      }
    }
  });

  it('rejects missing auth (401) and malformed UUID or version_no params (400 INVALID_FORMAT)', async () => {
    await expect(
      controller.listRoadmaps({ headers: {} }, {}),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 401, 'AUTH_REQUIRED');
      return true;
    });

    const req = {
      user: { sub: USER_ID },
      headers: { 'idempotency-key': IDEM_KEY_1 },
    };
    for (const call of [
      () => controller.getRoadmap(req, 'bad-uuid', {}),
      () => controller.listVersions(req, 'bad-uuid', {}),
      () => controller.getVersion(req, 'bad-uuid', '1'),
      () => controller.getVersion(req, ROADMAP_ID, '0'),
      () => controller.getVersion(req, ROADMAP_ID, 'abc'),
      () =>
        controller.requestRevision(req, 'bad-uuid', { refresh_stale: true }),
      () => controller.lockRoadmap(req, 'bad-uuid', {}),
      () => controller.setFocus(req, 'bad-uuid'),
      () => controller.archiveRoadmap(req, 'bad-uuid', {}),
    ]) {
      await expect(call()).rejects.toSatisfy((err) => {
        expectContractError(err, 400, 'INVALID_FORMAT');
        return true;
      });
    }
  });

  it('registers RoadmapJobHandler for roadmap_generate & roadmap_revision on module init when consumer exposes registerHandler', () => {
    const handlerMock = {} as RoadmapJobHandler;
    const registerHandler = vi.fn();
    const moduleWithRegistrar = new RoadmapModule(handlerMock, {
      registerHandler,
    } as unknown as PostgresJobQueueConsumer);
    moduleWithRegistrar.onModuleInit();

    expect(registerHandler).toHaveBeenCalledWith(
      'roadmap_generate',
      handlerMock,
    );
    expect(registerHandler).toHaveBeenCalledWith(
      'roadmap_revision',
      handlerMock,
    );

    const moduleWithoutRegistrar = new RoadmapModule(
      handlerMock,
      {} as PostgresJobQueueConsumer,
    );
    expect(() => moduleWithoutRegistrar.onModuleInit()).not.toThrow();

    // Starts PostgresJobQueueConsumer.start(handler) in non-test runtime when registerHandler is absent
    const startMock = vi.fn();
    const prevNodeEnv = process.env.NODE_ENV;
    const prevVitest = process.env.VITEST;
    try {
      process.env.NODE_ENV = 'development';
      delete process.env.VITEST;
      const moduleWithConsumer = new RoadmapModule(handlerMock, {
        start: startMock,
      } as unknown as PostgresJobQueueConsumer);
      moduleWithConsumer.onModuleInit();
      expect(startMock).toHaveBeenCalledTimes(1);
      expect(startMock).toHaveBeenCalledWith(handlerMock);
    } finally {
      if (prevNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prevNodeEnv;
      }
      if (prevVitest === undefined) {
        delete process.env.VITEST;
      } else {
        process.env.VITEST = prevVitest;
      }
    }
  });

  it('compiles AppModule DI graph sharing AuthModule, AiModule, and JobsModule singletons', async () => {
    const requiredFallbackEnv: Record<string, string> = {
      SUPABASE_URL: 'http://127.0.0.1:56321',
      SUPABASE_ANON_KEY: 'sb_publishable_test_key',
      DB_HOST: '127.0.0.1',
      DB_PORT: '56322',
      DB_USER: 'postgres',
      DB_PASSWORD: 'test-db-password',
      DB_NAME: 'postgres',
    };
    const previousEnv = new Map<string, string | undefined>();
    for (const [key, fallbackVal] of Object.entries(requiredFallbackEnv)) {
      previousEnv.set(key, process.env[key]);
      if (!process.env[key]) {
        process.env[key] = fallbackVal;
      }
    }

    try {
      const { AppModule } = await import('../app.module.js');
      const appModuleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(DataSource)
        .useFactory({ factory: createMockDataSource })
        .compile();

      try {
        const resolvedController = appModuleRef.get(RoadmapController);
        const resolvedService = appModuleRef.get(RoadmapService);
        const resolvedHandler = appModuleRef.get(RoadmapJobHandler);
        const authDatabase = appModuleRef
          .select(AuthModule)
          .get(DatabaseService, { strict: true });

        expect(resolvedController).toBeInstanceOf(RoadmapController);
        expect(resolvedService).toBeInstanceOf(RoadmapService);
        expect(resolvedHandler).toBeInstanceOf(RoadmapJobHandler);
        expect(appModuleRef.get(AiGatewayService)).toBeInstanceOf(
          AiGatewayService,
        );
        expect(appModuleRef.get(JobProducerService)).toBeInstanceOf(
          JobProducerService,
        );
        expect(
          (resolvedService as unknown as { database: DatabaseService })
            .database,
        ).toBe(authDatabase);
        expect(
          (resolvedHandler as unknown as { database: DatabaseService })
            .database,
        ).toBe(authDatabase);
      } finally {
        await appModuleRef.close();
      }
    } finally {
      for (const [key, prevVal] of previousEnv.entries()) {
        if (prevVal === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = prevVal;
        }
      }
    }
  });

  it('allows Gate: none routes (EP-R02, R03, R06, R07, R14, R15) when roadmap_generator is OFF and blocks EP-R01/R04/R05 with 403 FEATURE_DISABLED', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const publicJwk = publicKey.export({ format: 'jwk' });
    const jwksServer = createServer((req, res) => {
      if (req.url === '/auth/v1/.well-known/jwks.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            keys: [
              {
                ...publicJwk,
                kid: 'test-kid-1',
                use: 'sig',
                alg: 'ES256',
              },
            ],
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });

    let app: INestApplication | undefined;
    let jwksClosed = false;
    const closeJwksServer = () =>
      new Promise<void>((resolve) => {
        if (jwksClosed || !jwksServer.listening) {
          jwksClosed = true;
          resolve();
          return;
        }
        jwksClosed = true;
        jwksServer.close(() => resolve());
      });

    await new Promise<void>((resolve, reject) => {
      jwksServer.once('error', reject);
      jwksServer.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = jwksServer.address() as AddressInfo;
      const supabaseUrl = `http://127.0.0.1:${address.port}`;

      const databaseStub = {
        query: vi.fn().mockResolvedValue([]),
        transaction: vi.fn(
          async (
            _userId: string | null,
            op: (db: {
              query: (sql: string) => Promise<unknown[]>;
            }) => Promise<unknown>,
          ) =>
            op({
              query: async (sql: string) => {
                if (sql.includes('FROM public.feature_controls')) {
                  return [
                    {
                      enabled: false,
                      default_user_enabled: true,
                      override: null,
                    },
                  ];
                }
                return [
                  {
                    status: 'active',
                    verified_contact: true,
                    session_approved: true,
                    unrevoked_session_approved: true,
                  },
                ];
              },
            }),
        ),
      };

      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [
              () => ({
                SUPABASE_URL: supabaseUrl,
                SUPABASE_ANON_KEY: 'sb_publishable_test_key',
                SUPABASE_JWKS_URL: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
                DB_HOST: '127.0.0.1',
                DB_PORT: '56322',
                DB_USER: 'postgres',
                DB_PASSWORD: 'test-db-password',
                DB_NAME: 'postgres',
              }),
            ],
          }),
          ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 100 }] }),
          TestDataSourceModule,
          AuthModule,
        ],
        controllers: [RoadmapController],
        providers: [
          { provide: RoadmapService, useValue: serviceMock },
          { provide: IdempotencyService, useValue: idempotencyService },
        ],
      })
        .overrideProvider(DatabaseService)
        .useValue(databaseStub)
        .compile();

      app = moduleRef.createNestApplication();
      configureHttp(app, []);
      await app.init();

      const accessToken = signEs256Jwt(privateKey, {
        sub: USER_ID,
        session_id: SESSION_ID,
        role: 'authenticated',
        iss: `${supabaseUrl}/auth/v1`,
        aud: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 300,
      });

      const listRes = await request(app.getHttpServer())
        .get('/api/v1/roadmaps')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);
      expect(listRes.body.data).toEqual([SAMPLE_SUMMARY_DTO]);
      expect(listRes.body.meta).toEqual({ limit: 20, next_cursor: null });

      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/roadmaps/${ROADMAP_ID}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(getRes.status).toBe(200);

      const versionsRes = await request(app.getHttpServer())
        .get(`/api/v1/roadmaps/${ROADMAP_ID}/versions`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(versionsRes.status).toBe(200);
      expect(versionsRes.body.meta).toEqual({ limit: 20, next_cursor: null });

      const versionRes = await request(app.getHttpServer())
        .get(`/api/v1/roadmaps/${ROADMAP_ID}/versions/1`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(versionRes.status).toBe(200);

      const focusRes = await request(app.getHttpServer())
        .post(`/api/v1/roadmaps/${ROADMAP_ID}/focus`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(focusRes.status).toBe(200);

      const archiveRes = await request(app.getHttpServer())
        .post(`/api/v1/roadmaps/${ROADMAP_ID}/archive`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(archiveRes.status).toBe(200);

      // Gate: write routes blocked with 403 FEATURE_DISABLED
      const genRes = await request(app.getHttpServer())
        .post('/api/v1/roadmaps/generate')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', IDEM_KEY_1)
        .send({ career_goal_id: GOAL_ID });
      expect(genRes.status).toBe(403);
      expect(genRes.body.error?.code).toBe('FEATURE_DISABLED');

      const revRes = await request(app.getHttpServer())
        .post(`/api/v1/roadmaps/${ROADMAP_ID}/revision`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', IDEM_KEY_1)
        .send({ refresh_stale: true });
      expect(revRes.status).toBe(403);
      expect(revRes.body.error?.code).toBe('FEATURE_DISABLED');

      const lockRes = await request(app.getHttpServer())
        .post(`/api/v1/roadmaps/${ROADMAP_ID}/lock`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', IDEM_KEY_1)
        .send({});
      expect(lockRes.status).toBe(403);
      expect(lockRes.body.error?.code).toBe('FEATURE_DISABLED');
    } finally {
      await app?.close();
      await closeJwksServer();
    }
  });
});

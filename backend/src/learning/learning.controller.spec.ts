import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessPolicy } from '../auth/policy.js';
import { configureHttp } from '../common/http.js';
import {
  IDEMPOTENCY_EPOCH_KEY,
  IdempotencyService,
  type IdempotencyRedisClient,
} from '../jobs/services/idempotency.service.js';
import { LearningController } from './controllers/learning.controller.js';
import { LearningModule } from './learning.module.js';
import type { PostgresJobQueueConsumer } from '../jobs/services/postgres-job-queue.consumer.js';
import type { TopicContentJobHandler } from './services/topic-content-job.handler.js';
import {
  assertValidLearningHours,
  GetDailyPlanQueryDTO,
  ListLearningResourcesQueryDTO,
  ListTopicsQueryDTO,
  RebuildDailyPlanDTO,
  type DailyPlanResponseDTO,
  type TodayResponseDTO,
  type TopicDetailDTO,
} from './dto/learning.dto.js';
import { DailyPlanService } from './services/daily-plan.service.js';
import { TodayService } from './services/today.service.js';
import { TopicContentService } from './services/topic-content.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROADMAP_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const TOPIC_ID = '44444444-4444-4444-8444-444444444444';
const IDEM_KEY_1 = '55555555-5555-4555-8555-555555555555';
const IDEM_KEY_2 = '66666666-6666-4666-8666-666666666666';

function createInMemoryIdempotencyService(epoch = 'epoch-v1') {
  const store = new Map<string, string>();
  store.set(IDEMPOTENCY_EPOCH_KEY, epoch);

  const client: IdempotencyRedisClient = {
    isReady: true,
    isOpen: true,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, opts?: { NX?: boolean }) => {
      if (opts?.NX && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    pTTL: vi.fn(async (key: string) => (store.has(key) ? 86_400_000 : -2)),
    eval: vi.fn(
      async (
        script: string,
        options: { keys: string[]; arguments: string[] },
      ) => {
        const [epochKey, recordKey] = options.keys;
        if (script.includes('ACQUIRED')) {
          const [expectedEpoch, payload, ttlMs] = options.arguments;
          if (store.get(epochKey) !== expectedEpoch) {
            return ['EPOCH_MISMATCH', '', '-2'];
          }
          const existing = store.get(recordKey);
          if (existing) {
            return ['EXISTING', existing, '86400000'];
          }
          store.set(recordKey, payload);
          return ['ACQUIRED', payload, ttlMs];
        }
        if (script.includes('COMPLETED')) {
          const [expectedEpoch, expectedToken, completedPayload] =
            options.arguments;
          if (store.get(epochKey) !== expectedEpoch) return 'EPOCH_MISMATCH';
          const raw = store.get(recordKey);
          if (!raw) return 'MISSING';
          const parsed = JSON.parse(raw) as {
            state?: string;
            reservationToken?: string;
          };
          if (parsed.state !== 'in_flight') return 'NOT_IN_FLIGHT';
          if (parsed.reservationToken !== expectedToken)
            return 'TOKEN_MISMATCH';
          store.set(recordKey, completedPayload);
          return 'COMPLETED';
        }
        if (script.includes('RELEASED')) {
          const [expectedEpoch, expectedToken] = options.arguments;
          if (store.get(epochKey) !== expectedEpoch) return 'EPOCH_MISMATCH';
          const raw = store.get(recordKey);
          if (!raw) return 'MISSING';
          const parsed = JSON.parse(raw) as {
            state?: string;
            reservationToken?: string;
          };
          if (
            parsed.state === 'in_flight' &&
            parsed.reservationToken === expectedToken
          ) {
            store.delete(recordKey);
            return 'RELEASED';
          }
          return 'NOT_OWNED';
        }
        return 'OK';
      },
    ),
    quit: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  } as unknown as IdempotencyRedisClient;

  return new IdempotencyService(
    undefined,
    {
      url: 'redis://127.0.0.1:6379',
      expectedEpoch: epoch,
      ttlSeconds: 86_400,
      ttlMs: 86_400_000,
      timeoutMs: 1_000,
      retryAfterSeconds: 5,
    },
    client,
  );
}

const SAMPLE_PLAN: DailyPlanResponseDTO = {
  plan_id: PLAN_ID,
  roadmap_id: ROADMAP_ID,
  is_focus: true,
  hours_per_day: 2,
  roadmap_version_no: 1,
  next_incomplete_day_no: 1,
  total_days: 1,
  completed_days: 0,
  days: [
    {
      day_no: 1,
      status: 'pending',
      topics: [
        {
          plan_item_id: '77777777-7777-4777-8777-777777777777',
          topic_id: TOPIC_ID,
          title: 'SQL Joins',
        },
      ],
      completed_at: null,
    },
  ],
};

const SAMPLE_TODAY: TodayResponseDTO = {
  status: 'no_focus_roadmap',
  roadmap_id: null,
  plan_id: null,
  plan_day: null,
  topic: null,
  quiz: { attempt_id: null, status: null, can_retry: false },
  job: null,
  requires_learning_hours: false,
  preferred_daily_hours: null,
};

const SAMPLE_TOPIC_DETAIL: TopicDetailDTO = {
  topic_id: TOPIC_ID,
  title: 'SQL Joins',
  career_level: 'mid',
  content_version: 1,
  explanation_markdown: '# SQL Joins',
  important_questions: [],
  sources: [],
  learning_state: 'not_started',
  required_depth: 'application',
  rating_allowed: true,
  report_allowed: true,
};

describe('LearningController (EP-L01–EP-L07 routes, policy metadata, DTO strictness & H-IDEM)', () => {
  let app: INestApplication;
  let dailyPlanServiceMock: {
    getDailyPlan: ReturnType<typeof vi.fn>;
    createDailyPlan: ReturnType<typeof vi.fn>;
    rebuildDailyPlan: ReturnType<typeof vi.fn>;
  };
  let todayServiceMock: { getToday: ReturnType<typeof vi.fn> };
  let topicContentServiceMock: {
    listTopics: ReturnType<typeof vi.fn>;
    getTopic: ReturnType<typeof vi.fn>;
    listResources: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    dailyPlanServiceMock = {
      getDailyPlan: vi.fn().mockResolvedValue({
        plan: SAMPLE_PLAN,
        meta: { limit: 20, next_cursor: null },
      }),
      createDailyPlan: vi.fn().mockResolvedValue(SAMPLE_PLAN),
      rebuildDailyPlan: vi.fn().mockResolvedValue({
        ...SAMPLE_PLAN,
        hours_per_day: 1.5,
      }),
    };
    todayServiceMock = {
      getToday: vi.fn().mockResolvedValue(SAMPLE_TODAY),
    };
    topicContentServiceMock = {
      listTopics: vi.fn().mockResolvedValue({
        items: [],
        meta: { limit: 20, next_cursor: null },
      }),
      getTopic: vi.fn().mockResolvedValue(SAMPLE_TOPIC_DETAIL),
      listResources: vi.fn().mockResolvedValue({
        items: [],
        meta: { limit: 20, next_cursor: null },
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [LearningController],
      providers: [
        { provide: DailyPlanService, useValue: dailyPlanServiceMock },
        { provide: TodayService, useValue: todayServiceMock },
        { provide: TopicContentService, useValue: topicContentServiceMock },
        {
          provide: IdempotencyService,
          useValue: createInMemoryIdempotencyService(),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(
      (
        req: { user?: { sub: string; status: string } },
        _res: unknown,
        next: () => void,
      ) => {
        req.user = { sub: USER_ID, status: 'active' };
        next();
      },
    );
    configureHttp(app);
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('does not attach duplicate @UseGuards and applies @Policy({ feature: daily_plan }) ONLY to EP-L02 and EP-L03', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, LearningController),
    ).toBeUndefined();

    const getPolicy = (method: keyof LearningController) =>
      Reflect.getMetadata(
        'access-policy',
        LearningController.prototype[method],
      ) as AccessPolicy | undefined;

    expect(getPolicy('getDailyPlan')).toEqual({});
    expect(getPolicy('getToday')).toEqual({});
    expect(getPolicy('listTopics')).toEqual({});
    expect(getPolicy('getTopic')).toEqual({});
    expect(getPolicy('listResources')).toEqual({});
    expect(getPolicy('createDailyPlan')).toEqual({ feature: 'daily_plan' });
    expect(getPolicy('rebuildDailyPlan')).toEqual({ feature: 'daily_plan' });
  });

  it('rejects explicit null on optional query DTO fields and rejects unknown fields on JSON mutation bodies', async () => {
    const queryErrors = await validate(
      plainToInstance(GetDailyPlanQueryDTO, { roadmap_id: null }),
    );
    expect(queryErrors.length).toBeGreaterThan(0);

    const topicsErrors = await validate(
      plainToInstance(ListTopicsQueryDTO, { priority: null }),
    );
    expect(topicsErrors.length).toBeGreaterThan(0);

    const resourceErrors = await validate(
      plainToInstance(ListLearningResourcesQueryDTO, {}),
    );
    expect(resourceErrors.length).toBeGreaterThan(0);

    // Unknown body property rejected by forbidNonWhitelisted
    const badExtraRes = await request(app.getHttpServer())
      .post('/api/v1/learning/daily-plans')
      .set('Idempotency-Key', IDEM_KEY_1)
      .send({
        roadmap_id: ROADMAP_ID,
        hours_per_day: 2,
        unexpected_field: 'nope',
      });
    expect(badExtraRes.status).toBe(422);

    // Missing or malformed Idempotency-Key fails 400 INVALID_FORMAT before touching service or idempotency cache
    const badIdemRes = await request(app.getHttpServer())
      .post('/api/v1/learning/daily-plans')
      .set('Idempotency-Key', 'not-a-uuid')
      .send({ roadmap_id: ROADMAP_ID, hours_per_day: 2 });
    expect(badIdemRes.status).toBe(400);
    expect(badIdemRes.body.error.code).toBe('INVALID_FORMAT');
    expect(dailyPlanServiceMock.createDailyPlan).not.toHaveBeenCalled();

    // JSON boolean `true` and float drift `1.5000000001` are rejected 422 LEARNING_HOURS_REQUIRED BEFORE reserving Idempotency-Key
    const boolHoursRes = await request(app.getHttpServer())
      .post('/api/v1/learning/daily-plans')
      .set('Idempotency-Key', IDEM_KEY_2)
      .send({ roadmap_id: ROADMAP_ID, hours_per_day: true });
    expect(boolHoursRes.status).toBe(422);
    expect(boolHoursRes.body.error.code).toBe('LEARNING_HOURS_REQUIRED');
    expect(dailyPlanServiceMock.createDailyPlan).not.toHaveBeenCalled();

    const driftHoursRes = await request(app.getHttpServer())
      .post('/api/v1/learning/daily-plans')
      .set('Idempotency-Key', IDEM_KEY_2)
      .send({ roadmap_id: ROADMAP_ID, hours_per_day: 1.5000000001 });
    expect(driftHoursRes.status).toBe(422);
    expect(driftHoursRes.body.error.code).toBe('LEARNING_HOURS_REQUIRED');
    expect(dailyPlanServiceMock.createDailyPlan).not.toHaveBeenCalled();

    // Because invalid hours failed pre-reservation, IDEM_KEY_2 remains free for a valid request
    const validAfterInvalid = await request(app.getHttpServer())
      .post('/api/v1/learning/daily-plans')
      .set('Idempotency-Key', IDEM_KEY_2)
      .send({ roadmap_id: ROADMAP_ID, hours_per_day: 2 });
    expect(validAfterInvalid.status).toBe(201);
    expect(dailyPlanServiceMock.createDailyPlan).toHaveBeenCalledTimes(1);

    // RebuildDTO also preserves raw boolean without coercion
    const rebuildInst = plainToInstance(RebuildDailyPlanDTO, {
      hours_per_day: true,
    });
    expect(rebuildInst.hours_per_day).toBe(true);
    expect(() => assertValidLearningHours(1.5000000001)).toThrow();
  });

  it('enforces H-IDEM replay and 409 IDEMPOTENCY_KEY_REUSED on EP-L02 and wires EP-L01–EP-L07 envelopes', async () => {
    // EP-L02 first call -> 201
    const create1 = await request(app.getHttpServer())
      .post('/api/v1/learning/daily-plans')
      .set('Idempotency-Key', IDEM_KEY_1)
      .send({ roadmap_id: ROADMAP_ID, hours_per_day: 2 });
    expect(create1.status).toBe(201);
    expect(create1.body.success).toBe(true);
    expect(create1.body.data.plan_id).toBe(PLAN_ID);
    expect(dailyPlanServiceMock.createDailyPlan).toHaveBeenCalledTimes(1);

    // EP-L02 identical replay -> 201 cached without invoking service a second time
    const createReplay = await request(app.getHttpServer())
      .post('/api/v1/learning/daily-plans')
      .set('Idempotency-Key', IDEM_KEY_1)
      .send({ roadmap_id: ROADMAP_ID, hours_per_day: 2 });
    expect(createReplay.status).toBe(201);
    expect(dailyPlanServiceMock.createDailyPlan).toHaveBeenCalledTimes(1);

    // EP-L02 same key + different body -> 409 IDEMPOTENCY_KEY_REUSED
    const createConflict = await request(app.getHttpServer())
      .post('/api/v1/learning/daily-plans')
      .set('Idempotency-Key', IDEM_KEY_1)
      .send({ roadmap_id: ROADMAP_ID, hours_per_day: 3 });
    expect(createConflict.status).toBe(409);
    expect(createConflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // EP-L01 GET /learning/daily-plan -> 200 with top-level meta
    const getPlan = await request(app.getHttpServer()).get(
      '/api/v1/learning/daily-plan',
    );
    expect(getPlan.status).toBe(200);
    expect(getPlan.body.success).toBe(true);
    expect(getPlan.body.data.plan_id).toBe(PLAN_ID);
    expect(getPlan.body.meta).toEqual({ limit: 20, next_cursor: null });

    // EP-L03 POST /learning/daily-plans/:id/rebuild -> 200
    const rebuildRes = await request(app.getHttpServer())
      .post(`/api/v1/learning/daily-plans/${PLAN_ID}/rebuild`)
      .send({ hours_per_day: 1.5 });
    expect(rebuildRes.status).toBe(200);
    expect(rebuildRes.body.data.hours_per_day).toBe(1.5);

    // EP-L04 GET /learning/today -> 200
    const todayRes = await request(app.getHttpServer()).get(
      '/api/v1/learning/today',
    );
    expect(todayRes.status).toBe(200);
    expect(todayRes.body.data.status).toBe('no_focus_roadmap');

    // EP-L05 GET /learning/topics -> 200 + meta
    const topicsRes = await request(app.getHttpServer()).get(
      '/api/v1/learning/topics',
    );
    expect(topicsRes.status).toBe(200);
    expect(topicsRes.body.meta).toEqual({ limit: 20, next_cursor: null });

    // EP-L06 GET /learning/topics/:id -> 200
    const topicRes = await request(app.getHttpServer()).get(
      `/api/v1/learning/topics/${TOPIC_ID}`,
    );
    expect(topicRes.status).toBe(200);
    expect(topicRes.body.data.topic_id).toBe(TOPIC_ID);

    // EP-L07 GET /learning/resources?topic_id=... -> 200 + meta
    const resourcesRes = await request(app.getHttpServer()).get(
      `/api/v1/learning/resources?topic_id=${TOPIC_ID}`,
    );
    expect(resourcesRes.status).toBe(200);
    expect(resourcesRes.body.meta).toEqual({ limit: 20, next_cursor: null });
  });

  it('registers topic_content handler on required PostgresJobQueueConsumer in LearningModule.onModuleInit', () => {
    const registerHandler = vi.fn();
    const start = vi.fn();
    const handlerMock = {} as TopicContentJobHandler;
    const consumerMock = {
      registerHandler,
      start,
    } as unknown as PostgresJobQueueConsumer;

    const mod = new LearningModule(handlerMock, consumerMock);
    mod.onModuleInit();

    expect(registerHandler).toHaveBeenCalledWith('topic_content', handlerMock);
    expect(start).not.toHaveBeenCalled();
  });
});

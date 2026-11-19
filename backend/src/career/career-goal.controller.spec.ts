import {
  Global,
  HttpException,
  type INestApplication,
  Module,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { AccessGuard } from '../auth/guards/access.guard.js';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard.js';
import type { AccessPolicy } from '../auth/policy.js';
import { DatabaseService } from '../auth/services/database.service.js';
import { configureHttp } from '../common/http.js';
import { ProfileController } from '../profile/profile.controller.js';
import { ProfileService } from '../profile/profile.service.js';
import { CareerModule } from './career.module.js';
import { CareerGoalController } from './controllers/career-goal.controller.js';
import type { CareerGoalResponseDTO } from './dto/career-goal.dto.js';
import { CareerGoalService } from './services/career-goal.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GOAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROLE_ID = '22222222-2222-4222-8222-222222222222';

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

const SAMPLE_GOAL_DTO: CareerGoalResponseDTO = {
  id: GOAL_ID,
  goal_text: 'Backend developer, mainly Node.js',
  status: 'awaiting_confirmation',
  clarification_round: 0,
  clarification_question: null,
  proposed_role: {
    canonical_role_id: ROLE_ID,
    name: 'Backend Development',
  },
  alternative_roles: [],
  suggested_level: 'junior',
  target_level: null,
  roadmap_id: null,
  created_at: '2026-10-10T08:00:00.000Z',
};

describe('CareerGoalController (EP-C01–EP-C07 /api/v1/career/goals)', () => {
  let serviceMock: {
    createGoal: ReturnType<typeof vi.fn>;
    listGoals: ReturnType<typeof vi.fn>;
    getGoal: ReturnType<typeof vi.fn>;
    answerClarification: ReturnType<typeof vi.fn>;
    confirmGoal: ReturnType<typeof vi.fn>;
    updateGoal: ReturnType<typeof vi.fn>;
    discontinueGoal: ReturnType<typeof vi.fn>;
  };
  let controller: CareerGoalController;

  beforeEach(() => {
    vi.clearAllMocks();
    serviceMock = {
      createGoal: vi.fn().mockResolvedValue(SAMPLE_GOAL_DTO),
      listGoals: vi.fn().mockResolvedValue({
        items: [SAMPLE_GOAL_DTO],
        meta: { limit: 20, next_cursor: null },
      }),
      getGoal: vi.fn().mockResolvedValue(SAMPLE_GOAL_DTO),
      answerClarification: vi.fn().mockResolvedValue(SAMPLE_GOAL_DTO),
      confirmGoal: vi.fn().mockResolvedValue({
        ...SAMPLE_GOAL_DTO,
        status: 'confirmed',
        target_level: 'mid',
      }),
      updateGoal: vi.fn().mockResolvedValue(SAMPLE_GOAL_DTO),
      discontinueGoal: vi.fn().mockResolvedValue({
        id: GOAL_ID,
        status: 'discontinued',
        archived_roadmap_id: null,
        new_focus_roadmap_id: null,
      }),
    };
    controller = new CareerGoalController(
      serviceMock as unknown as CareerGoalService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enforces @UseGuards(SupabaseAuthGuard, AccessGuard) in exact order and @Policy feature gates per EP-C01–EP-C07', () => {
    expect(Reflect.getMetadata('__guards__', CareerGoalController)).toEqual([
      SupabaseAuthGuard,
      AccessGuard,
    ]);

    const writeRoutes = [
      CareerGoalController.prototype.createGoal,
      CareerGoalController.prototype.answerClarification,
      CareerGoalController.prototype.confirmGoal,
      CareerGoalController.prototype.updateGoal,
    ];
    for (const handler of writeRoutes) {
      const policy = Reflect.getMetadata(
        'access-policy',
        handler,
      ) as AccessPolicy;
      expect(policy).toEqual({ feature: 'roadmap_generator' });
    }

    const unGatedRoutes = [
      CareerGoalController.prototype.listGoals,
      CareerGoalController.prototype.getGoal,
      CareerGoalController.prototype.discontinueGoal,
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

  it('removes duplicate career/goals routes from ProfileController so CareerGoalController owns all 7 routes cleanly', () => {
    const proto = ProfileController.prototype as unknown as Record<
      string,
      unknown
    >;
    expect(proto.goal).toBeUndefined();
    expect(proto.confirm).toBeUndefined();

    // Inspect route metadata on ProfileController methods to ensure zero career/goals route registrations
    for (const key of Object.getOwnPropertyNames(ProfileController.prototype)) {
      if (key === 'constructor') continue;
      const fn = (
        ProfileController.prototype as unknown as Record<string, unknown>
      )[key];
      if (typeof fn === 'function') {
        const routePath = Reflect.getMetadata('path', fn);
        expect(String(routePath ?? '')).not.toContain('career/goals');
      }
    }
  });

  it('delegates all 7 endpoints (EP-C01–EP-C07) to CareerGoalService with validated userId and parameters', async () => {
    const req = { user: { sub: USER_ID, status: 'active' } };

    expect(
      await controller.createGoal(req, {
        goal_text: 'Backend developer, mainly Node.js',
      }),
    ).toEqual(SAMPLE_GOAL_DTO);
    expect(serviceMock.createGoal).toHaveBeenCalledWith(USER_ID, {
      goal_text: 'Backend developer, mainly Node.js',
    });

    expect(await controller.listGoals(req, { limit: 10 })).toEqual({
      items: [SAMPLE_GOAL_DTO],
      meta: { limit: 20, next_cursor: null },
    });
    expect(serviceMock.listGoals).toHaveBeenCalledWith(USER_ID, { limit: 10 });

    expect(await controller.getGoal(req, GOAL_ID)).toEqual(SAMPLE_GOAL_DTO);
    expect(serviceMock.getGoal).toHaveBeenCalledWith(USER_ID, GOAL_ID);

    expect(
      await controller.answerClarification(req, GOAL_ID, {
        answer: 'Node.js APIs',
      }),
    ).toEqual(SAMPLE_GOAL_DTO);
    expect(serviceMock.answerClarification).toHaveBeenCalledWith(
      USER_ID,
      GOAL_ID,
      { answer: 'Node.js APIs' },
    );

    expect(
      await controller.confirmGoal(req, GOAL_ID, {
        canonical_role_id: ROLE_ID,
        target_level: 'mid',
      }),
    ).toMatchObject({ status: 'confirmed', target_level: 'mid' });
    expect(serviceMock.confirmGoal).toHaveBeenCalledWith(USER_ID, GOAL_ID, {
      canonical_role_id: ROLE_ID,
      target_level: 'mid',
    });

    expect(
      await controller.updateGoal(req, GOAL_ID, {
        goal_text: 'Updated backend goal',
      }),
    ).toEqual(SAMPLE_GOAL_DTO);
    expect(serviceMock.updateGoal).toHaveBeenCalledWith(USER_ID, GOAL_ID, {
      goal_text: 'Updated backend goal',
    });

    expect(await controller.discontinueGoal(req, GOAL_ID)).toEqual({
      id: GOAL_ID,
      status: 'discontinued',
      archived_roadmap_id: null,
      new_focus_roadmap_id: null,
    });
    expect(serviceMock.discontinueGoal).toHaveBeenCalledWith(USER_ID, GOAL_ID);
  });

  it('rejects missing authentication with 401 AUTH_REQUIRED and malformed :id UUIDs with 400 INVALID_FORMAT', async () => {
    await expect(
      controller.createGoal({}, { goal_text: 'Backend developer' }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 401, 'AUTH_REQUIRED');
      return true;
    });

    const req = { user: { sub: USER_ID } };
    await expect(controller.getGoal(req, 'bad-uuid')).rejects.toSatisfy(
      (err) => {
        expectContractError(err, 400, 'INVALID_FORMAT');
        return true;
      },
    );
    await expect(
      controller.answerClarification(req, 'bad-uuid', { answer: 'APIs' }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 400, 'INVALID_FORMAT');
      return true;
    });
    await expect(
      controller.confirmGoal(req, 'bad-uuid', {
        canonical_role_id: ROLE_ID,
        target_level: 'mid',
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 400, 'INVALID_FORMAT');
      return true;
    });
    await expect(
      controller.updateGoal(req, 'bad-uuid', { goal_text: 'Backend dev' }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 400, 'INVALID_FORMAT');
      return true;
    });
    await expect(controller.discontinueGoal(req, 'bad-uuid')).rejects.toSatisfy(
      (err) => {
        expectContractError(err, 400, 'INVALID_FORMAT');
        return true;
      },
    );
  });

  it('compiles CareerModule and full AppModule DI graph sharing AuthModule DatabaseService & ProfileService singletons', async () => {
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
        const resolvedController = appModuleRef.get(CareerGoalController);
        const resolvedService = appModuleRef.get(CareerGoalService);
        const resolvedAiGateway = appModuleRef.get(AiGatewayService);
        const authDatabase = appModuleRef
          .select(AuthModule)
          .get(DatabaseService, { strict: true });
        const authProfileService = appModuleRef
          .select(AuthModule)
          .get(ProfileService, { strict: true });

        expect(resolvedController).toBeInstanceOf(CareerGoalController);
        expect(resolvedService).toBeInstanceOf(CareerGoalService);
        expect(resolvedAiGateway).toBeInstanceOf(AiGatewayService);
        expect(
          (resolvedService as unknown as { database: DatabaseService })
            .database,
        ).toBe(authDatabase);
        expect(
          (resolvedService as unknown as { profileService: ProfileService })
            .profileService,
        ).toBe(authProfileService);
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

  it('allows EP-C02, EP-C03, and EP-C07 when roadmap_generator feature is OFF, while blocking EP-C01 with 403 FEATURE_DISABLED', async () => {
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
                  // Global roadmap_generator flag is OFF
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
            ignoreEnvVars: true,
            load: [
              () => ({
                SUPABASE_URL: supabaseUrl,
                SUPABASE_ANON_KEY: 'sb_publishable_test_key',
                AI_EXECUTION_MODE: 'synthetic',
              }),
            ],
          }),
          ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
          TestDataSourceModule,
          CareerModule,
        ],
      })
        .overrideProvider(ConfigService)
        .useValue({
          get: (key: string) => {
            if (key === 'SUPABASE_URL') return supabaseUrl;
            if (key === 'SUPABASE_ANON_KEY') return 'sb_publishable_test_key';
            if (key === 'AI_EXECUTION_MODE') return 'synthetic';
            return undefined;
          },
        })
        .overrideProvider(CareerGoalService)
        .useValue(serviceMock)
        .overrideProvider(DatabaseService)
        .useValue(databaseStub)
        .compile();

      app = moduleRef.createNestApplication();
      configureHttp(app);
      await app.init();

      const token = signEs256Jwt(privateKey, {
        sub: USER_ID,
        session_id: SESSION_ID,
        aud: 'authenticated',
        iss: `${supabaseUrl}/auth/v1`,
        exp: Math.floor(Date.now() / 1000) + 300,
      });

      // EP-C01 POST /api/v1/career/goals is blocked by AccessGuard when roadmap_generator is OFF
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/career/goals')
        .set('Authorization', `Bearer ${token}`)
        .send({ goal_text: 'Backend developer, mainly Node.js' });
      expect(createRes.status).toBe(403);
      expect(createRes.body).toMatchObject({
        success: false,
        error: { code: 'FEATURE_DISABLED' },
      });
      expect(serviceMock.createGoal).not.toHaveBeenCalled();

      // EP-C02 GET /api/v1/career/goals succeeds with top-level meta even when roadmap_generator is OFF
      const listRes = await request(app.getHttpServer())
        .get('/api/v1/career/goals')
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toEqual({
        success: true,
        data: [SAMPLE_GOAL_DTO],
        meta: { limit: 20, next_cursor: null },
      });

      // EP-C03 GET /api/v1/career/goals/:id succeeds even when roadmap_generator is OFF
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/career/goals/${GOAL_ID}`)
        .set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toEqual({
        success: true,
        data: SAMPLE_GOAL_DTO,
      });

      // EP-C07 DELETE /api/v1/career/goals/:id succeeds even when roadmap_generator is OFF
      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/v1/career/goals/${GOAL_ID}`)
        .set('Authorization', `Bearer ${token}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body).toEqual({
        success: true,
        data: {
          id: GOAL_ID,
          status: 'discontinued',
          archived_roadmap_id: null,
          new_focus_roadmap_id: null,
        },
      });

      // Verify assembled Express router registers exactly one handler for GET /api/v1/career/goals/:id and POST /api/v1/career/goals/:id/confirm
      const expressInstance = app.getHttpAdapter().getInstance() as {
        _router?: {
          stack?: Array<{
            route?: { path?: string; methods?: Record<string, boolean> };
          }>;
        };
        router?: {
          stack?: Array<{
            route?: { path?: string; methods?: Record<string, boolean> };
          }>;
        };
      };
      const routerStack =
        expressInstance._router?.stack ?? expressInstance.router?.stack ?? [];
      const registeredRoutes = routerStack
        .filter((layer) => layer.route?.path)
        .map((layer) => ({
          path: layer.route!.path,
          methods: layer.route!.methods ?? {},
        }));
      if (registeredRoutes.length > 0) {
        const getGoalByIdRoutes = registeredRoutes.filter(
          (r) => r.path === '/api/v1/career/goals/:id' && r.methods.get,
        );
        const confirmGoalRoutes = registeredRoutes.filter(
          (r) =>
            r.path === '/api/v1/career/goals/:id/confirm' && r.methods.post,
        );
        expect(getGoalByIdRoutes).toHaveLength(1);
        expect(confirmGoalRoutes).toHaveLength(1);
      }

      // Verify invalid status enum returns top-level error.code === 'INVALID_ENUM_VALUE' (422)
      serviceMock.listGoals.mockImplementationOnce(
        async (receivedUserId: string, receivedQuery: unknown) => {
          const realService = new CareerGoalService(
            databaseStub as unknown as DatabaseService,
            {} as unknown as AiGatewayService,
            {} as unknown as ProfileService,
          );
          return realService.listGoals(
            receivedUserId,
            receivedQuery as Record<string, unknown>,
          );
        },
      );
      const badStatusRes = await request(app.getHttpServer())
        .get('/api/v1/career/goals?status=pending')
        .set('Authorization', `Bearer ${token}`);
      expect(badStatusRes.status).toBe(422);
      expect(badStatusRes.body).toMatchObject({
        success: false,
        error: {
          code: 'INVALID_ENUM_VALUE',
        },
      });

      // Verify empty cursor (?cursor=) is normalized to undefined and treated as first page (200 OK)
      const emptyCursorRes = await request(app.getHttpServer())
        .get('/api/v1/career/goals?cursor=')
        .set('Authorization', `Bearer ${token}`);
      expect(emptyCursorRes.status).toBe(200);
      expect(serviceMock.listGoals).toHaveBeenLastCalledWith(USER_ID, {
        cursor: undefined,
      });
    } finally {
      try {
        await app?.close();
      } finally {
        await closeJwksServer();
      }
    }
  });
});

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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../auth/auth.module.js';
import { AccessGuard } from '../auth/guards/access.guard.js';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard.js';
import type { AccessPolicy } from '../auth/policy.js';
import { DatabaseService } from '../auth/services/database.service.js';
import { configureHttp } from '../common/http.js';
import { JobsController } from './controllers/jobs.controller.js';
import type { JobStatusDto } from './dto/job-status.dto.js';
import { JobsModule } from './jobs.module.js';
import { IdempotencyService } from './services/idempotency.service.js';
import { JobService } from './services/job.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

describe('JobsController (EP-J01 GET /api/v1/jobs/:id)', () => {
  let getJobStatusMock: ReturnType<typeof vi.fn>;
  let jobServiceMock: JobService;
  let controller: JobsController;

  beforeEach(() => {
    vi.clearAllMocks();
    getJobStatusMock = vi.fn();
    jobServiceMock = {
      getJobStatus: getJobStatusMock,
    } as unknown as JobService;
    controller = new JobsController(jobServiceMock);
  });

  it('enforces @UseGuards(SupabaseAuthGuard, AccessGuard) in exact order and @Policy({}) (AZ-USER, Gate: none)', () => {
    expect(Reflect.getMetadata('__guards__', JobsController)).toEqual([
      SupabaseAuthGuard,
      AccessGuard,
    ]);
    expect(
      Reflect.getMetadata('__guards__', JobsController.prototype.getJobStatus),
    ).toBeUndefined();

    const policy = Reflect.getMetadata(
      'access-policy',
      JobsController,
    ) as AccessPolicy;
    expect(policy).toEqual({});
    expect(policy?.public).toBeUndefined();
    expect(policy?.feature).toBeUndefined();
  });

  it('delegates valid UUID request to JobService.getJobStatus and returns JobStatusDTO', async () => {
    const expected: JobStatusDto = {
      job_id: JOB_ID,
      kind: 'roadmap_generate',
      status: 'succeeded',
      result_ref: {
        type: 'roadmap',
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      error: null,
      retryable: false,
      created_at: '2026-11-18T10:00:00.000Z',
      finished_at: '2026-11-18T10:00:03.000Z',
    };
    getJobStatusMock.mockResolvedValue(expected);

    const actual = await controller.getJobStatus(
      { user: { sub: USER_ID, status: 'active' } },
      JOB_ID,
    );

    expect(actual).toEqual(expected);
    expect(getJobStatusMock).toHaveBeenCalledWith(USER_ID, JOB_ID);
  });

  it('rejects unauthenticated requests missing user.sub with 401 AUTH_REQUIRED', async () => {
    await expect(controller.getJobStatus({}, JOB_ID)).rejects.toSatisfy(
      (err) => {
        expectContractError(err, 401, 'AUTH_REQUIRED');
        return true;
      },
    );
    expect(getJobStatusMock).not.toHaveBeenCalled();
  });

  it('rejects malformed non-UUID :id parameter with 400 INVALID_FORMAT', async () => {
    await expect(
      controller.getJobStatus({ user: { sub: USER_ID } }, 'invalid-uuid'),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 400, 'INVALID_FORMAT');
      return true;
    });
    expect(getJobStatusMock).not.toHaveBeenCalled();
  });

  it('compiles JobsModule with real AuthModule exports and resolves full DI constructor graph without duplicate providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [
            () => ({
              SUPABASE_URL: 'http://127.0.0.1:56321',
              SUPABASE_ANON_KEY: 'sb_publishable_test_key',
              IDEMPOTENCY_REDIS_URL: 'redis://127.0.0.1:56379',
              IDEMPOTENCY_REDIS_EPOCH: 'di-epoch-v1',
            }),
          ],
        }),
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
        TestDataSourceModule,
        JobsModule,
      ],
    }).compile();

    try {
      const resolvedController = moduleRef.get(JobsController);
      const resolvedJobService = moduleRef.get(JobService);
      const resolvedIdempotency = moduleRef.get(IdempotencyService);
      const resolvedDatabase = moduleRef.get(DatabaseService);
      const resolvedSupabaseGuard = moduleRef.get(SupabaseAuthGuard);
      const resolvedAccessGuard = moduleRef.get(AccessGuard);
      const resolvedConfig = moduleRef.get(ConfigService);

      expect(resolvedController).toBeInstanceOf(JobsController);
      expect(resolvedJobService).toBeInstanceOf(JobService);
      expect(resolvedIdempotency).toBeInstanceOf(IdempotencyService);
      expect(resolvedDatabase).toBeInstanceOf(DatabaseService);
      expect(resolvedSupabaseGuard).toBeInstanceOf(SupabaseAuthGuard);
      expect(resolvedAccessGuard).toBeInstanceOf(AccessGuard);

      // Verify JobsModule reuses AuthModule DatabaseService singleton instead of duplicating providers
      expect(
        moduleRef.select(AuthModule).get(DatabaseService, { strict: true }),
      ).toBe(resolvedDatabase);
      expect(
        moduleRef.select(AuthModule).get(SupabaseAuthGuard, { strict: true }),
      ).toBeInstanceOf(SupabaseAuthGuard);
      expect(
        moduleRef.select(AuthModule).get(AccessGuard, { strict: true }),
      ).toBeInstanceOf(AccessGuard);

      // Verify actual constructor dependency injection (not uninjected undefined fields)
      expect(
        (resolvedController as unknown as { jobService: JobService })
          .jobService,
      ).toBe(resolvedJobService);
      expect(
        (resolvedJobService as unknown as { database: DatabaseService })
          .database,
      ).toBe(resolvedDatabase);
      expect(
        (
          resolvedAccessGuard as unknown as {
            database: DatabaseService;
          }
        ).database,
      ).toBe(resolvedDatabase);
      expect(
        (
          resolvedIdempotency as unknown as {
            configService: ConfigService;
            configuration?: { url: string; expectedEpoch: string };
          }
        ).configService,
      ).toBe(resolvedConfig);
      expect(
        (
          resolvedIdempotency as unknown as {
            configuration?: { url: string; expectedEpoch: string };
          }
        ).configuration,
      ).toMatchObject({
        url: 'redis://127.0.0.1:56379',
        expectedEpoch: 'di-epoch-v1',
      });
    } finally {
      await moduleRef.close();
    }
  });

  it('compiles full AppModule DI graph with JobsModule without missing or duplicate provider errors', async () => {
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
        const resolvedController = appModuleRef.get(JobsController);
        const resolvedJobService = appModuleRef.get(JobService);
        const resolvedIdempotency = appModuleRef.get(IdempotencyService);
        const authDatabase = appModuleRef
          .select(AuthModule)
          .get(DatabaseService, { strict: true });
        const authSupabaseGuard = appModuleRef
          .select(AuthModule)
          .get(SupabaseAuthGuard, { strict: true });
        const authAccessGuard = appModuleRef
          .select(AuthModule)
          .get(AccessGuard, { strict: true });
        const allSupabaseGuards = appModuleRef.get(SupabaseAuthGuard, {
          each: true,
        });
        const allAccessGuards = appModuleRef.get(AccessGuard, {
          each: true,
        });

        expect(resolvedController).toBeInstanceOf(JobsController);
        expect(resolvedJobService).toBeInstanceOf(JobService);
        expect(resolvedIdempotency).toBeInstanceOf(IdempotencyService);
        expect(
          (resolvedJobService as unknown as { database: DatabaseService })
            .database,
        ).toBe(authDatabase);
        expect(
          (authAccessGuard as unknown as { database: DatabaseService })
            .database,
        ).toBe(authDatabase);
        expect(allSupabaseGuards).toContain(authSupabaseGuard);
        expect(allAccessGuards).toContain(authAccessGuard);
        expect(
          (
            appModuleRef
              .select(JobsModule)
              .get(AccessGuard, { strict: true }) as unknown as {
              database: DatabaseService;
            }
          ).database,
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

  it('rejects unauthenticated requests at SupabaseAuthGuard before controller execution and allows active AZ-USER through SupabaseAuthGuard + AccessGuard (Gate: none)', async () => {
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

      const expected: JobStatusDto = {
        job_id: JOB_ID,
        kind: 'roadmap_generate',
        status: 'preparing',
        result_ref: null,
        error: null,
        retryable: false,
        created_at: '2026-11-18T10:00:00.000Z',
        finished_at: null,
      };
      const jobServiceSpy = {
        getJobStatus: vi.fn().mockResolvedValue(expected),
      };
      const accessDbQueries: string[] = [];
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
                accessDbQueries.push(sql);
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
              }),
            ],
          }),
          ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
          TestDataSourceModule,
          JobsModule,
        ],
      })
        .overrideProvider(ConfigService)
        .useValue({
          get: (key: string) => {
            if (key === 'SUPABASE_URL') {
              return supabaseUrl;
            }
            if (key === 'SUPABASE_ANON_KEY') {
              return 'sb_publishable_test_key';
            }
            return undefined;
          },
        })
        .overrideProvider(JobService)
        .useValue(jobServiceSpy)
        .overrideProvider(DatabaseService)
        .useValue(databaseStub)
        .compile();

      app = moduleRef.createNestApplication();
      configureHttp(app);
      await app.init();

      const unauthRes = await request(app.getHttpServer()).get(
        `/api/v1/jobs/${JOB_ID}`,
      );
      expect(unauthRes.status).toBe(401);
      expect(unauthRes.body).toMatchObject({
        success: false,
        error: { code: 'AUTH_REQUIRED' },
      });
      expect(jobServiceSpy.getJobStatus).not.toHaveBeenCalled();

      const token = signEs256Jwt(privateKey, {
        sub: USER_ID,
        session_id: SESSION_ID,
        aud: 'authenticated',
        iss: `${supabaseUrl}/auth/v1`,
        exp: Math.floor(Date.now() / 1000) + 300,
      });

      const authRes = await request(app.getHttpServer())
        .get(`/api/v1/jobs/${JOB_ID}`)
        .set('Authorization', `Bearer ${token}`);

      expect({ status: authRes.status, body: authRes.body }).toEqual({
        status: 200,
        body: {
          success: true,
          data: expected,
        },
      });
      expect(jobServiceSpy.getJobStatus).toHaveBeenCalledTimes(1);
      expect(jobServiceSpy.getJobStatus).toHaveBeenCalledWith(USER_ID, JOB_ID);
      expect(accessDbQueries.length).toBeGreaterThan(0);
      expect(
        accessDbQueries.some((sql) => sql.includes('feature_controls')),
      ).toBe(false);
    } finally {
      try {
        await app?.close();
      } finally {
        await closeJwksServer();
      }
    }
  });
});

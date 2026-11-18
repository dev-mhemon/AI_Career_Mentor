import { Global, HttpException, Module } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../auth/auth.module.js';
import { AccessGuard } from '../auth/guards/access.guard.js';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard.js';
import type { AccessPolicy } from '../auth/policy.js';
import { DatabaseService } from '../auth/services/database.service.js';
import { JobsController } from './controllers/jobs.controller.js';
import type { JobStatusDto } from './dto/job-status.dto.js';
import { JobsModule } from './jobs.module.js';
import { IdempotencyService } from './services/idempotency.service.js';
import { JobService } from './services/job.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

  it('enforces SupabaseAuthGuard, AccessGuard (AZ-USER), and Gate: none policy metadata', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      JobsController,
    ) as unknown[];
    expect(guards).toContain(SupabaseAuthGuard);
    expect(guards).toContain(AccessGuard);

    const policy = Reflect.getMetadata(
      'access-policy',
      JobsController,
    ) as AccessPolicy;
    expect(policy).toBeDefined();
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
        const jobsAccessGuard = appModuleRef
          .select(JobsModule)
          .get(AccessGuard, { strict: true });

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
        expect(
          (jobsAccessGuard as unknown as { database: DatabaseService })
            .database,
        ).toBe(authDatabase);
        expect(appModuleRef.get(SupabaseAuthGuard, { each: true })).toContain(
          authSupabaseGuard,
        );
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
});

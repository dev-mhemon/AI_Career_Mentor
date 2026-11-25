import {
  type INestApplication,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from './app.controller.js';
import {
  AppService,
  HEALTH_CONTRACT_VERSION,
  HEALTH_PROBE_TIMEOUT_MS,
  type HealthResponseDTO,
} from './app.service.js';
import { configureHttp } from './common/http.js';
import { PostgresJobQueueConsumer } from './jobs/services/postgres-job-queue.consumer.js';

type MockDataSource = {
  isInitialized: boolean;
  query: ReturnType<typeof vi.fn>;
};

type MockQueueConsumer = {
  isReady: ReturnType<typeof vi.fn>;
};

describe('AppController — EP-H01 GET /health', () => {
  let app: INestApplication;
  let appController: AppController;
  let mockDataSource: MockDataSource;
  let mockQueueConsumer: MockQueueConsumer;

  beforeEach(async () => {
    mockDataSource = {
      isInitialized: true,
      query: vi.fn(async () => [{ '?column?': 1 }]),
    };
    mockQueueConsumer = {
      isReady: vi.fn(() => true),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: PostgresJobQueueConsumer, useValue: mockQueueConsumer },
      ],
    }).compile();

    appController = moduleRef.get<AppController>(AppController);
    app = moduleRef.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('returns 200 with canonical HealthResponseDTO when DB and durable queue are healthy', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const body = res.body as HealthResponseDTO;
    expect(body).toEqual({
      status: 'ok',
      version: HEALTH_CONTRACT_VERSION,
      time: expect.any(String),
      checks: {
        database: 'ok',
        queue: 'ok',
      },
    });
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);

    // Ensure health probes never touch public.users / R24 activity columns.
    const executedSql = mockDataSource.query.mock.calls.map((c) =>
      String(c[0]),
    );
    expect(executedSql).toContain('SELECT 1');
    expect(executedSql.some((sql) => sql.includes('public.ai_requests'))).toBe(
      true,
    );
    expect(executedSql.some((sql) => sql.includes('last_active_at'))).toBe(
      false,
    );
    expect(executedSql.some((sql) => sql.includes('UPDATE'))).toBe(false);
  });

  it('returns 503 with checks.database=error when DB probe fails and leaks zero secrets or SQL text', async () => {
    const secretError = new Error(
      'postgresql://postgres:s3cr3t-pass@db.internal:5432/mentor FATAL: password authentication failed (gemini-2.5-flash)',
    );
    mockDataSource.query.mockImplementation(async (sql: string) => {
      if (sql === 'SELECT 1') {
        throw secretError;
      }
      return [{ '?column?': 1 }];
    });

    const res = await request(app.getHttpServer()).get('/health').expect(503);

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body).toEqual({
      status: 'unavailable',
      version: HEALTH_CONTRACT_VERSION,
      time: expect.any(String),
      checks: {
        database: 'error',
        queue: 'ok',
      },
    });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('s3cr3t-pass');
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain('password authentication');
    expect(serialized).not.toContain('gemini');
    expect(serialized).not.toContain('at ');
  });

  it('returns 503 with checks.queue=error when durable queue table probe fails', async () => {
    mockDataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('public.ai_requests')) {
        throw new Error(
          'permission denied for relation ai_requests at 10.0.0.4:5432',
        );
      }
      return [{ '?column?': 1 }];
    });

    const res = await request(app.getHttpServer()).get('/health').expect(503);

    expect(res.body).toEqual({
      status: 'unavailable',
      version: HEALTH_CONTRACT_VERSION,
      time: expect.any(String),
      checks: {
        database: 'ok',
        queue: 'error',
      },
    });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('permission denied');
    expect(serialized).not.toContain('10.0.0.4');
  });

  it('returns 503 with checks.queue=error when PostgresJobQueueConsumer is shutting down', async () => {
    mockQueueConsumer.isReady.mockReturnValue(false);

    const res = await request(app.getHttpServer()).get('/health').expect(503);

    expect(res.body).toEqual({
      status: 'unavailable',
      version: HEALTH_CONTRACT_VERSION,
      time: expect.any(String),
      checks: {
        database: 'ok',
        queue: 'error',
      },
    });
  });

  it('returns 503 with both checks=error when DataSource is not initialized', async () => {
    mockDataSource.isInitialized = false;

    await expect(appController.getHealth()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body).toEqual({
      status: 'unavailable',
      version: HEALTH_CONTRACT_VERSION,
      time: expect.any(String),
      checks: {
        database: 'error',
        queue: 'error',
      },
    });
  });

  it('fails closed with 503 when database/queue probes hang past the bounded timeout', async () => {
    vi.useFakeTimers();
    mockDataSource.query.mockImplementation(
      () => new Promise<unknown[]>(() => undefined),
    );

    const pending = appController.getHealth();
    const settled = pending.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(HEALTH_PROBE_TIMEOUT_MS + 50);

    const error = await settled;
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'unavailable',
      version: HEALTH_CONTRACT_VERSION,
      time: expect.any(String),
      checks: {
        database: 'error',
        queue: 'error',
      },
    });
  });

  it('bounds stalled createQueryRunner probes via single-flight coalescing and releases on late completion', async () => {
    vi.useFakeTimers();
    const releases: Array<() => void> = [];
    const releaseSpy = vi.fn(async () => undefined);
    const createQueryRunnerSpy = vi.fn(() => ({
      connect: vi.fn(async () => undefined),
      startTransaction: vi.fn(async () => undefined),
      commitTransaction: vi.fn(async () => undefined),
      rollbackTransaction: vi.fn(async () => undefined),
      release: releaseSpy,
      query: vi.fn(
        (sql: string) =>
          new Promise<unknown[]>((resolve) => {
            if (sql.startsWith('SET LOCAL')) {
              resolve([]);
              return;
            }
            releases.push(() => resolve([{ '?column?': 1 }]));
          }),
      ),
    }));

    const runnerService = new AppService(
      {
        isInitialized: true,
        createQueryRunner: createQueryRunnerSpy,
      } as unknown as DataSource,
      mockQueueConsumer as unknown as PostgresJobQueueConsumer,
    );

    const firstCall = runnerService.getHealth().then(
      () => null,
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(HEALTH_PROBE_TIMEOUT_MS + 50);
    expect(await firstCall).toBeInstanceOf(ServiceUnavailableException);
    // Only 2 runners opened (1 database + 1 queue)
    expect(createQueryRunnerSpy).toHaveBeenCalledTimes(2);

    // Repeated /health while previous runners are still stalled must reuse in-flight probes
    const secondCall = runnerService.getHealth().then(
      () => null,
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(HEALTH_PROBE_TIMEOUT_MS + 50);
    expect(await secondCall).toBeInstanceOf(ServiceUnavailableException);
    expect(createQueryRunnerSpy).toHaveBeenCalledTimes(2);

    // Late completion releases runners cleanly and restores readiness
    for (const done of releases) {
      done();
    }
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve();
    }
    expect(releaseSpy).toHaveBeenCalledTimes(2);
  });

  it('downgrades checks.queue to error and returns 503 if consumer stop() is called mid-probe', async () => {
    const consumer = new PostgresJobQueueConsumer({
      query: vi.fn(),
      transaction: vi.fn(),
    } as never);
    consumer.registerHandler('roadmap_generate', {
      execute: vi.fn(),
      persistArtifact: vi.fn(),
    });
    consumer.start(1);

    let resolveDbProbe!: () => void;
    let resolveQueueProbe!: () => void;
    const midProbeDataSource = {
      isInitialized: true,
      query: vi.fn(
        (sql: string) =>
          new Promise<unknown[]>((resolve) => {
            if (sql === 'SELECT 1') {
              resolveDbProbe = () => resolve([{ '?column?': 1 }]);
            } else {
              resolveQueueProbe = () => resolve([{ '?column?': 1 }]);
            }
          }),
      ),
    } as unknown as DataSource;

    const service = new AppService(midProbeDataSource, consumer);
    const pendingHealth = service.getHealth().then(
      () => null,
      (error: unknown) => error,
    );

    // Wait a tick for both probes to enter flight, then stop consumer mid-probe
    await Promise.resolve();
    consumer.stop();
    expect(consumer.isReady()).toBe(false);

    resolveDbProbe();
    resolveQueueProbe();

    const error = await pendingHealth;
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'unavailable',
      version: HEALTH_CONTRACT_VERSION,
      time: expect.any(String),
      checks: {
        database: 'ok',
        queue: 'error',
      },
    });
    consumer.onModuleDestroy();
  });

  it('requires active polling plus either registered handlers or an active fallback handler for PostgresJobQueueConsumer.isReady()', () => {
    const consumer = new PostgresJobQueueConsumer({
      query: vi.fn(),
      transaction: vi.fn(),
    } as never);
    // Neither polling nor handlers registered yet
    expect(consumer.isReady()).toBe(false);

    // Polling started without registered handlers or fallback handler -> still not ready
    consumer.start(1);
    expect(consumer.isReady()).toBe(false);
    consumer.stop();

    // Polling started with a fallback handler (zero registerHandler calls) -> ready until stop()/destroy
    const fallbackHandler = {
      execute: vi.fn(),
      persistArtifact: vi.fn(),
    };
    consumer.start(fallbackHandler);
    expect(consumer.isReady()).toBe(true);
    consumer.stop();
    expect(consumer.isReady()).toBe(false);

    // Bare start() after stop() does not retain cleared fallback handler
    consumer.start(1);
    expect(consumer.isReady()).toBe(false);

    // Registering a handler while polling is active -> ready
    consumer.registerHandler('roadmap_generate', {
      execute: vi.fn(),
      persistArtifact: vi.fn(),
    });
    expect(consumer.isReady()).toBe(true);

    // Explicit stop() -> not ready
    consumer.stop();
    expect(consumer.isReady()).toBe(false);

    // Restarting while handler remains registered -> ready again
    consumer.start(1);
    expect(consumer.isReady()).toBe(true);

    // Shutdown destroys readiness permanently (even with fallback handler)
    consumer.onModuleDestroy();
    expect(consumer.isReady()).toBe(false);
    consumer.start(fallbackHandler);
    expect(consumer.isReady()).toBe(false);
  });
});

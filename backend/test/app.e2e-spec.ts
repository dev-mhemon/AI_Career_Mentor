import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { type App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from './../src/app.module.js';
import {
  HEALTH_CONTRACT_VERSION,
  type HealthResponseDTO,
} from './../src/app.service.js';
import { configureHttp } from './../src/common/http.js';
import { PostgresJobQueueConsumer } from './../src/jobs/services/postgres-job-queue.consumer.js';

describe('AppController EP-H01 (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureHttp(app);
    await app.init();
    // In test environments modules register handlers without auto-starting timers;
    // explicitly start the consumer loop for live /health readiness verification.
    app.get(PostgresJobQueueConsumer).start();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('GET /health returns 200 with canonical HealthResponseDTO (database=ok, queue=ok)', async () => {
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
  });

  it('GET /health returns 503 with checks.database=error and zero secret leakage when DB probe fails', async () => {
    const dataSource = app.get(DataSource);
    const originalCreateQueryRunner =
      dataSource.createQueryRunner.bind(dataSource);
    vi.spyOn(dataSource, 'createQueryRunner').mockImplementation(() => {
      const qr = originalCreateQueryRunner();
      const originalQuery = qr.query.bind(qr);
      vi.spyOn(qr, 'query').mockImplementation(
        (...args: Parameters<typeof originalQuery>) => {
          if (args[0] === 'SELECT 1') {
            return Promise.reject(
              new Error(
                'postgresql://postgres:topsecret@127.0.0.1:56322/postgres FATAL connection lost',
              ),
            );
          }
          return originalQuery(...args);
        },
      );
      return qr;
    });

    const res = await request(app.getHttpServer()).get('/health').expect(503);

    expect(res.body).toEqual({
      status: 'unavailable',
      version: HEALTH_CONTRACT_VERSION,
      time: expect.any(String),
      checks: {
        database: 'error',
        queue: 'ok',
      },
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('topsecret');
    expect(raw).not.toContain('postgresql://');
    expect(raw).not.toContain('FATAL');
  });

  it('GET /health returns 503 with checks.queue=error when queue consumer is unavailable', async () => {
    const consumer = app.get(PostgresJobQueueConsumer);
    vi.spyOn(consumer, 'isReady').mockReturnValue(false);

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
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  type ExecutionContext,
  HttpException,
  type INestApplication,
} from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AiModule } from '../ai/ai.module.js';
import { AccessGuard } from '../auth/guards/access.guard.js';
import {
  type AccessPolicy,
  type Feature,
  features as CANONICAL_FEATURES,
} from '../auth/policy.js';
import { DatabaseService } from '../auth/services/database.service.js';
import { PostgresJobQueueConsumer } from '../jobs/services/postgres-job-queue.consumer.js';
import { configureHttp } from './http.js';

type RouteKey = string; // "<METHOD> <normalizedPath>"

type OpenApiOperationEntry = {
  method: string;
  path: string;
  operationId: string;
  unversioned: boolean;
};

type ExpressRouteLayer = {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
  };
  name?: string;
  handle?: {
    stack?: ExpressRouteLayer[];
  };
};

const HTTP_METHODS = new Set(['get', 'post', 'patch', 'put', 'delete']);

/**
 * Normalizes dynamic path segments (`:id`, `{id}`, `{version_no}`, etc.) to `{param}`
 * so Express route paths and OpenAPI 3.0 path templates can be compared deterministically.
 */
function normalizeRoutePath(rawPath: string): string {
  const trimmed = rawPath.replace(/\/+$/, '') || '/';
  return trimmed
    .replace(/:[A-Za-z0-9_]+/g, '{param}')
    .replace(/\{[^}]+\}/g, '{param}');
}

/**
 * Zero-dependency deterministic parser for the `paths:` block of `docs/05-api/openapi.yaml`.
 * Extracts every documented `(method, path, operationId)` and checks for duplicate path+method keys.
 */
function parseOpenApiPaths(yamlText: string): {
  entries: OpenApiOperationEntry[];
  duplicates: string[];
} {
  const lines = yamlText.split(/\r?\n/);
  const entries: OpenApiOperationEntry[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  let inPaths = false;
  let currentPath: string | null = null;
  let currentPathUnversioned = false;
  let inPathServers = false;
  let currentMethod: string | null = null;

  for (const line of lines) {
    if (!inPaths) {
      if (line === 'paths:') {
        inPaths = true;
      }
      continue;
    }

    if (/^[A-Za-z0-9_-]+:/.test(line)) {
      break; // Reached top-level `components:` or next root section
    }

    const pathMatch = /^ {2}(\/[^:]*):$/.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1];
      currentPathUnversioned = false;
      inPathServers = false;
      currentMethod = null;
      continue;
    }

    if (!currentPath) {
      continue;
    }

    if (line === '    servers:') {
      inPathServers = true;
      currentMethod = null;
      continue;
    }

    if (inPathServers) {
      const serverUrlMatch = /^ {6}- url:\s*(.+)$/.exec(line);
      if (serverUrlMatch && serverUrlMatch[1].trim() === '/') {
        currentPathUnversioned = true;
      }
    }

    const methodMatch = /^ {4}(get|post|patch|put|delete):$/.exec(line);
    if (methodMatch && HTTP_METHODS.has(methodMatch[1])) {
      inPathServers = false;
      currentMethod = methodMatch[1].toUpperCase();
      const key = `${currentMethod} ${currentPath}`;
      if (seen.has(key)) {
        duplicates.push(key);
      } else {
        seen.add(key);
      }
      entries.push({
        method: currentMethod,
        path: currentPath,
        operationId: '',
        unversioned: currentPathUnversioned,
      });
      continue;
    }

    if (currentMethod) {
      const opMatch = /^ {6}operationId:\s*(.+)$/.exec(line);
      if (opMatch && entries.length > 0) {
        entries[entries.length - 1].operationId = opMatch[1].trim();
      }
    }
  }

  return { entries, duplicates };
}

function collectExpressRoutes(app: INestApplication): {
  routes: Set<RouteKey>;
  duplicates: RouteKey[];
} {
  const instance = app.getHttpAdapter().getInstance() as {
    router?: { stack?: ExpressRouteLayer[] };
    _router?: { stack?: ExpressRouteLayer[] };
  };
  const stack = instance.router?.stack ?? instance._router?.stack ?? [];
  const counts = new Map<RouteKey, number>();

  const walk = (layers: ExpressRouteLayer[]): void => {
    for (const layer of layers) {
      if (layer.route?.path && layer.route.methods) {
        const normalized = normalizeRoutePath(layer.route.path);
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled && method.toLowerCase() !== '_all') {
            const key: RouteKey = `${method.toUpperCase()} ${normalized}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
      } else if (Array.isArray(layer.handle?.stack)) {
        walk(layer.handle.stack);
      }
    }
  };

  walk(stack);

  const routes = new Set<RouteKey>(counts.keys());
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();

  return { routes, duplicates };
}

function createGuardContext(
  policy: AccessPolicy,
  user: { sub: string; sessionId: string },
): { context: ExecutionContext; reflector: Reflector } {
  const handler = () => undefined;
  const cls = class DummyController {};
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(policy);
  const context = {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
  return { context, reflector };
}

describe('M14-A C05 §17.6 Cross-Cutting Contract, Route Parity & R10 Access Matrix', () => {
  let app: INestApplication;
  let savedEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    savedEnv = { ...process.env };
    const isolatedEnv: NodeJS.ProcessEnv = {
      ...savedEnv,
      NODE_ENV: 'test',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: 'sb_publishable_test_anon_key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      SUPABASE_JWKS_URL: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
      DB_HOST: '127.0.0.1',
      DB_PORT: '54322',
      DB_USER: 'postgres',
      DB_PASSWORD: 'postgres-test-password',
      DB_NAME: 'postgres',
      AI_EXECUTION_MODE: 'synthetic',
      TECH_UPDATE_SCHEDULER_ENABLED: 'false',
      TECH_UPDATE_SOURCE_MODE: 'synthetic',
      AUTH_REDIS_URL: 'redis://127.0.0.1:6379',
      AUTH_HMAC_SECRET: '01234567890123456789012345678901',
      AUTH_OTP_HMAC_SECRET: '01234567890123456789012345678901',
      DELETION_RECEIPT_SECRET: '01234567890123456789012345678901',
      PROVIDER_CLEANUP_ENCRYPTION_KEY: '01234567890123456789012345678901',
      IDEMPOTENCY_BOOTSTRAP_ON_INIT: 'false',
    };
    for (const key of [
      'IDEMPOTENCY_REDIS_URL',
      'REDIS_URL',
      'RESEND_API_KEY',
      'AUTH_EMAIL_FROM',
      'AUTH_EMAIL_WEBHOOK_URL',
      'AUTH_EMAIL_TRANSPORT_URL',
      'EMAIL_TRANSPORT_URL',
      'MAILPIT_URL',
      'TEXTBEE_BASE_URL',
      'TEXTBEE_API_KEY',
      'TEXTBEE_DEVICE_ID',
      'GEMINI_API_KEY',
      'TECH_UPDATE_DIRECT_DATABASE_URL',
      'DATABASE_DIRECT_URL',
    ]) {
      delete isolatedEnv[key];
    }
    process.env = isolatedEnv;

    const mockDataSource = {
      isInitialized: true,
      query: vi.fn(async () => [{ '?column?': 1 }]),
      transaction: vi.fn(),
      destroy: vi.fn(async () => undefined),
    };

    const { AppModule } = await import('../app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DataSource)
      .useValue(mockDataSource)
      .compile();

    app = moduleRef.createNestApplication();
    configureHttp(app);
    await app.init();
  }, 30_000);

  afterAll(async () => {
    try {
      if (app) {
        await app.close();
      }
    } finally {
      process.env = savedEnv;
    }
  });

  describe('Route & OpenAPI Parity (81 canonical catalog HTTP routes + transitional sync)', () => {
    it('matches every registered NestJS HTTP route 1-to-1 with docs/05-api/openapi.yaml and zero duplicates', () => {
      const openapiPath = path.resolve(
        process.cwd(),
        '..',
        'docs',
        '05-api',
        'openapi.yaml',
      );
      const rawYaml = readFileSync(openapiPath, 'utf8');
      const { entries, duplicates } = parseOpenApiPaths(rawYaml);

      expect(duplicates).toEqual([]);
      // 81 canonical C05 catalog HTTP operations (including EP-H01 GET /health)
      // + 4 documented transitional/compatibility aliases (POST /auth/sync, POST /auth/resend-otp,
      //   POST /auth/verify-otp, GET /quiz/{id}/results) = 85 total registered & documented routes.
      const canonicalEntries = entries.filter(
        (entry) =>
          entry.operationId !== 'transitionalSync' &&
          !entry.operationId.endsWith('Alias'),
      );
      expect(canonicalEntries.length).toBe(81);
      expect(entries.length).toBe(85);

      const openapiRoutes = new Set<RouteKey>(
        entries.map((entry) => {
          const fullPath = entry.unversioned
            ? entry.path
            : `/api/v1${entry.path}`;
          return `${entry.method} ${normalizeRoutePath(fullPath)}`;
        }),
      );
      const { routes: nestRoutes, duplicates: duplicateExpressRoutes } =
        collectExpressRoutes(app);

      expect(duplicateExpressRoutes).toEqual([]);

      const missingInNest = [...openapiRoutes]
        .filter((route) => !nestRoutes.has(route))
        .sort();
      const undocumentedInOpenApi = [...nestRoutes]
        .filter((route) => !openapiRoutes.has(route))
        .sort();

      expect(missingInNest).toEqual([]);
      expect(undocumentedInOpenApi).toEqual([]);
      expect(nestRoutes.has('GET /health')).toBe(true);
      expect(nestRoutes.has('GET /api/v1/health')).toBe(false);
    });

    it('keeps EP-G04 (internal evidence) and AiModule internal-only with zero HTTP routes (404)', async () => {
      const aiControllers = Reflect.getMetadata(
        MODULE_METADATA.CONTROLLERS,
        AiModule,
      ) as unknown[] | undefined;
      expect(aiControllers ?? []).toEqual([]);

      const { routes: nestRoutes } = collectExpressRoutes(app);
      expect(nestRoutes.has('POST /api/v1/progress/evidence')).toBe(false);
      expect(
        [...nestRoutes].some((route) => route.includes('/api/v1/ai')),
      ).toBe(false);

      const evidenceProbe = await request(app.getHttpServer())
        .post('/api/v1/progress/evidence')
        .send({})
        .expect(404);
      expect(evidenceProbe.body.error.code).toBe('RESOURCE_NOT_FOUND');

      const aiProbe = await request(app.getHttpServer())
        .post('/api/v1/ai/execute')
        .send({})
        .expect(404);
      expect(aiProbe.body.error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('rejects all C05 §14.15 reserved non-MVP prefixes with 404 RESOURCE_NOT_FOUND', async () => {
      const reservedPaths = [
        '/api/v1/notifications',
        '/api/v1/analytics',
        '/api/v1/files',
        '/api/v1/search',
        '/api/v1/account/export',
      ];

      for (const reservedPath of reservedPaths) {
        const res = await request(app.getHttpServer())
          .get(reservedPath)
          .expect(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
      }
    });

    it('serves live unversioned EP-H01 GET /health as 503 before consumer start() and 200 once polling is active on full AppModule', async () => {
      const consumer = app.get(PostgresJobQueueConsumer);
      expect(consumer.getRegisteredKinds().length).toBeGreaterThan(0);

      // Polling is not auto-started in test mode -> queue readiness must fail closed with 503.
      const beforeStart = await request(app.getHttpServer())
        .get('/health')
        .expect(503);
      expect(beforeStart.body).toEqual({
        status: 'unavailable',
        version: '1.5.1',
        time: expect.any(String),
        checks: {
          database: 'ok',
          queue: 'error',
        },
      });

      const pollSpy = vi.spyOn(consumer, 'pollOnce').mockResolvedValue([]);
      try {
        consumer.start();
        const res = await request(app.getHttpServer())
          .get('/health')
          .expect(200);
        expect(res.body).toEqual({
          status: 'ok',
          version: '1.5.1',
          time: expect.any(String),
          checks: {
            database: 'ok',
            queue: 'ok',
          },
        });
      } finally {
        consumer.stop();
        pollSpy.mockRestore();
      }
    });
  });

  describe('R10 7-Feature Access-Precedence Matrix (AccessGuard)', () => {
    const USER_ID = '11111111-1111-4111-8111-111111111111';
    const SESSION_ID = '22222222-2222-4222-8222-222222222222';

    const evaluateGuard = async (opts: {
      feature: Feature;
      userStatus: 'active' | 'suspended';
      globalEnabled: boolean;
      userOverride: boolean | null;
      existingRead?: boolean;
    }): Promise<boolean> => {
      const defaultUserEnabled = opts.feature !== 'technology_update';
      const mockDb = {
        transaction: vi.fn(
          async (
            _userId: string,
            op: (db: { query: ReturnType<typeof vi.fn> }) => Promise<boolean>,
          ) => {
            const db = {
              query: vi.fn(async (sql: string) => {
                if (sql.includes('FROM public.users')) {
                  return [
                    {
                      status: opts.userStatus,
                      verified_contact: true,
                      session_approved: true,
                      unrevoked_session_approved: true,
                    },
                  ];
                }
                if (sql.includes('FROM public.feature_controls')) {
                  return [
                    {
                      enabled: opts.globalEnabled,
                      default_user_enabled: defaultUserEnabled,
                      override: opts.userOverride,
                    },
                  ];
                }
                return [];
              }),
            };
            return op(db);
          },
        ),
      } as unknown as DatabaseService;

      const { context, reflector } = createGuardContext(
        {
          feature: opts.feature,
          ...(opts.existingRead ? { existingRead: true } : {}),
        },
        { sub: USER_ID, sessionId: SESSION_ID },
      );

      const guard = new AccessGuard(reflector, mockDb);
      return guard.canActivate(context);
    };

    const expectGuardFailure = async (
      run: () => Promise<boolean>,
      expectedStatus: number,
      expectedCode: string,
    ): Promise<void> => {
      let caught: unknown = null;
      try {
        await run();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(HttpException);
      const httpErr = caught as HttpException;
      expect(httpErr.getStatus()).toBe(expectedStatus);
      const body = httpErr.getResponse() as { code?: string };
      expect(body.code).toBe(expectedCode);
    };

    it('enforces exact canonical 7 FeatureKeys set', () => {
      expect(CANONICAL_FEATURES).toEqual([
        'roadmap_generator',
        'daily_plan',
        'quiz_practice',
        'ai_practice_review',
        'progress_tracking',
        'ai_mentor',
        'technology_update',
      ]);
    });

    it('blocks suspended users across all 7 features even when global=true and override=true', async () => {
      for (const feature of CANONICAL_FEATURES) {
        await expectGuardFailure(
          () =>
            evaluateGuard({
              feature,
              userStatus: 'suspended',
              globalEnabled: true,
              userOverride: true,
            }),
          403,
          'ACCOUNT_SUSPENDED',
        );
      }
    });

    it('enforces global=false overriding user override=true with 403 FEATURE_DISABLED across all 7 features', async () => {
      for (const feature of CANONICAL_FEATURES) {
        await expectGuardFailure(
          () =>
            evaluateGuard({
              feature,
              userStatus: 'active',
              globalEnabled: false,
              userOverride: true,
            }),
          403,
          'FEATURE_DISABLED',
        );
      }
    });

    it('defaults technology_update to OFF (403 FEATURE_DISABLED) and the other 6 features to ON when global=true and override=null', async () => {
      for (const feature of CANONICAL_FEATURES) {
        if (feature === 'technology_update') {
          await expectGuardFailure(
            () =>
              evaluateGuard({
                feature,
                userStatus: 'active',
                globalEnabled: true,
                userOverride: null,
              }),
            403,
            'FEATURE_DISABLED',
          );
        } else {
          await expect(
            evaluateGuard({
              feature,
              userStatus: 'active',
              globalEnabled: true,
              userOverride: null,
            }),
          ).resolves.toBe(true);
        }
      }
    });

    it('honors per-user overrides when global=true (enables technology_update with true; blocks any feature with false)', async () => {
      await expect(
        evaluateGuard({
          feature: 'technology_update',
          userStatus: 'active',
          globalEnabled: true,
          userOverride: true,
        }),
      ).resolves.toBe(true);

      for (const feature of CANONICAL_FEATURES) {
        await expectGuardFailure(
          () =>
            evaluateGuard({
              feature,
              userStatus: 'active',
              globalEnabled: true,
              userOverride: false,
            }),
          403,
          'FEATURE_DISABLED',
        );
      }
    });

    it('preserves existing-data reads under global=false for the 6 non-tech features while still blocking technology_update (R10)', async () => {
      for (const feature of CANONICAL_FEATURES) {
        if (feature === 'technology_update') {
          await expectGuardFailure(
            () =>
              evaluateGuard({
                feature,
                userStatus: 'active',
                globalEnabled: false,
                userOverride: true,
                existingRead: true,
              }),
            403,
            'FEATURE_DISABLED',
          );
        } else {
          await expect(
            evaluateGuard({
              feature,
              userStatus: 'active',
              globalEnabled: false,
              userOverride: false,
              existingRead: true,
            }),
          ).resolves.toBe(true);
        }
      }
    });
  });
});

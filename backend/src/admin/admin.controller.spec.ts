import {
  CanActivate,
  ExecutionContext,
  type INestApplication,
  Injectable,
  RequestMethod,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { AccessGuard } from '../auth/guards/access.guard.js';
import type { AccessPolicy } from '../auth/policy.js';
import { DatabaseService } from '../auth/services/database.service.js';
import { configureHttp, fail } from '../common/http.js';
import { AdminModule } from './admin.module.js';
import { AdminController } from './controllers/admin.controller.js';
import type {
  AdminUserDetailDTO,
  AdminUserSummaryDTO,
  AuditLogDTO,
  FeatureControlDTO,
  UsageSummaryDTO,
} from './dto/admin.dto.js';
import { AdminUserService } from './services/admin-user.service.js';
import { AuditService } from './services/audit.service.js';
import { FeatureControlService } from './services/feature-control.service.js';
import { UsageService } from './services/usage.service.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const AUDIT_ID = '44444444-4444-4444-8444-444444444444';

interface AuthGateState {
  authenticated: boolean;
  sub: string;
  jwtSpoofedRole?: string;
  dbStatus: 'active' | 'suspended';
  dbVerifiedContact: boolean;
  dbSessionApproved: boolean;
  dbIsAdmin: boolean;
}

const SAMPLE_SUMMARY: AdminUserSummaryDTO = {
  id: TARGET_USER_ID,
  email: 'learner@example.com',
  phone: null,
  contact_masked: 'l***@example.com',
  status: 'active',
  created_at: '2026-11-01T10:00:00.000Z',
  last_active_at: '2026-11-24T08:00:00.000Z',
  roadmap_count: 2,
  technology_update_enabled: false,
};

const SAMPLE_DETAIL: AdminUserDetailDTO = {
  ...SAMPLE_SUMMARY,
  feature_access: [
    {
      feature_key: 'roadmap_generator',
      global_enabled: true,
      user_override: null,
      effective: true,
    },
    {
      feature_key: 'daily_plan',
      global_enabled: true,
      user_override: null,
      effective: true,
    },
    {
      feature_key: 'quiz_practice',
      global_enabled: true,
      user_override: null,
      effective: true,
    },
    {
      feature_key: 'ai_practice_review',
      global_enabled: true,
      user_override: null,
      effective: true,
    },
    {
      feature_key: 'progress_tracking',
      global_enabled: true,
      user_override: null,
      effective: true,
    },
    {
      feature_key: 'ai_mentor',
      global_enabled: true,
      user_override: null,
      effective: true,
    },
    {
      feature_key: 'technology_update',
      global_enabled: true,
      user_override: null,
      effective: false,
    },
  ],
  counts: {
    roadmaps: 2,
    quizzes_submitted: 5,
    mentor_messages: 12,
    ai_requests: 30,
  },
};

const SAMPLE_FEATURES: FeatureControlDTO[] = [
  {
    feature_key: 'technology_update',
    enabled: true,
    updated_at: '2026-11-20T00:00:00.000Z',
    updated_by: ADMIN_ID,
  },
];

const SAMPLE_AUDIT_LOG: AuditLogDTO = {
  id: AUDIT_ID,
  actor_id: ADMIN_ID,
  action: 'user.suspend',
  target_type: 'user',
  target_id: TARGET_USER_ID,
  before: { status: 'active' },
  after: { status: 'suspended', reason: 'Abuse of AI endpoints' },
  request_id: SESSION_ID,
  created_at: '2026-11-24T12:00:00.000Z',
};

const SAMPLE_USAGE: UsageSummaryDTO = {
  range: { from: '2026-11-23', to: '2026-11-24' },
  series: {
    group_by: 'day',
    buckets: [
      {
        key: '2026-11-23',
        requests: 0,
        estimated_cost_usd: 0,
        failures: 0,
        fallbacks_used: 0,
        input_units: 0,
        output_units: 0,
      },
      {
        key: '2026-11-24',
        requests: 12,
        estimated_cost_usd: 0.04,
        failures: 1,
        fallbacks_used: 0,
        input_units: 5000,
        output_units: 2500,
      },
    ],
  },
  users: { total: 40, active_last_7_days: 22 },
  counts: {
    roadmaps_locked: 18,
    quizzes_submitted: 80,
    mentor_messages: 190,
    technology_updates_generated: 15,
  },
  ai: {
    requests: 12,
    failures: 1,
    fallbacks_used: 0,
    usage_units: { input: 5000, output: 2500 },
    estimated_cost_usd: 0.04,
    by_day: [
      {
        day: '2026-11-23',
        requests: 0,
        failures: 0,
        fallbacks_used: 0,
        input_units: 0,
        output_units: 0,
        estimated_cost_usd: 0,
      },
      {
        day: '2026-11-24',
        requests: 12,
        failures: 1,
        fallbacks_used: 0,
        input_units: 5000,
        output_units: 2500,
        estimated_cost_usd: 0.04,
      },
    ],
    by_feature: [
      { feature_key: 'ai_mentor', requests: 12, estimated_cost_usd: 0.04 },
    ],
    by_provider: [
      { provider_id: 'gemini', requests: 12, estimated_cost_usd: 0.04 },
    ],
  },
};

@Injectable()
class StubSupabaseAuthGuard implements CanActivate {
  constructor(private readonly state: AuthGateState) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.state.authenticated) {
      fail(401, 'AUTH_REQUIRED', 'No bearer token');
    }
    const req = context.switchToHttp().getRequest<{
      user?: Record<string, unknown>;
    }>();
    // Simulate a JWT payload that may even carry a spoofed role/app_metadata claim.
    req.user = {
      sub: this.state.sub,
      sessionId: SESSION_ID,
      role: this.state.jwtSpoofedRole ?? 'USER',
      app_metadata: this.state.jwtSpoofedRole
        ? { role: this.state.jwtSpoofedRole }
        : {},
    };
    return true;
  }
}

describe('AdminController (EP-AD01..EP-AD08 & AZ-ADMIN Global Guards)', () => {
  describe('route metadata, AppModule registration, and zero duplicate @UseGuards', () => {
    it('registers AdminModule in AppModule and declares @Policy({ admin: true }) with zero @UseGuards on AdminController', () => {
      const appImports = Reflect.getMetadata(
        MODULE_METADATA.IMPORTS,
        AppModule,
      ) as unknown[];
      expect(appImports).toContain(AdminModule);

      const reflector = new Reflector();
      expect(Reflect.getMetadata(PATH_METADATA, AdminController)).toBe('admin');
      expect(
        reflector.get<AccessPolicy>('access-policy', AdminController),
      ).toEqual({ admin: true });
      expect(
        Reflect.getMetadata(GUARDS_METADATA, AdminController),
      ).toBeUndefined();

      const proto = AdminController.prototype;
      const routes: Array<{
        handler: (...args: never[]) => unknown;
        path: string;
        method: RequestMethod;
      }> = [
        { handler: proto.listUsers, path: 'users', method: RequestMethod.GET },
        {
          handler: proto.getUser,
          path: 'users/:id',
          method: RequestMethod.GET,
        },
        {
          handler: proto.updateUserStatus,
          path: 'users/:id',
          method: RequestMethod.PATCH,
        },
        {
          handler: proto.listGlobalFeatures,
          path: 'features',
          method: RequestMethod.GET,
        },
        {
          handler: proto.setGlobalFeature,
          path: 'features',
          method: RequestMethod.PATCH,
        },
        {
          handler: proto.setUserFeature,
          path: 'users/:id/features',
          method: RequestMethod.PATCH,
        },
        {
          handler: proto.listAuditLogs,
          path: 'audit-logs',
          method: RequestMethod.GET,
        },
        {
          handler: proto.getUsageSummary,
          path: 'usage',
          method: RequestMethod.GET,
        },
      ];

      for (const route of routes) {
        expect(Reflect.getMetadata(PATH_METADATA, route.handler)).toBe(
          route.path,
        );
        expect(Reflect.getMetadata(METHOD_METADATA, route.handler)).toBe(
          route.method,
        );
        expect(
          reflector.get<AccessPolicy>('access-policy', route.handler),
        ).toEqual({ admin: true });
        expect(
          Reflect.getMetadata(GUARDS_METADATA, route.handler),
        ).toBeUndefined();
      }
    });
  });

  describe('HTTP contract, real AccessGuard server-side enforcement, and DTO validation', () => {
    let app: INestApplication;
    let gateState: AuthGateState;
    let mockDatabase: { transaction: ReturnType<typeof vi.fn> };
    let adminUserService: {
      listUsers: ReturnType<typeof vi.fn>;
      getUserDetail: ReturnType<typeof vi.fn>;
      updateUserStatus: ReturnType<typeof vi.fn>;
    };
    let featureControlService: {
      listGlobalFeatures: ReturnType<typeof vi.fn>;
      setGlobalFeature: ReturnType<typeof vi.fn>;
      setUserFeature: ReturnType<typeof vi.fn>;
    };
    let auditService: {
      listAuditLogs: ReturnType<typeof vi.fn>;
      recordInTx: ReturnType<typeof vi.fn>;
    };
    let usageService: {
      getUsageSummary: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      gateState = {
        authenticated: true,
        sub: ADMIN_ID,
        dbStatus: 'active',
        dbVerifiedContact: true,
        dbSessionApproved: true,
        dbIsAdmin: true,
      };

      // Mock DatabaseService backing the REAL AccessGuard SQL queries.
      mockDatabase = {
        transaction: vi.fn(
          async (
            _userId: string | null,
            operation: (db: {
              query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
            }) => Promise<unknown>,
          ) => {
            const db = {
              query: vi.fn(async (sql: string) => {
                if (sql.includes('FROM public.users u WHERE u.id=$1')) {
                  return [
                    {
                      status: gateState.dbStatus,
                      verified_contact: gateState.dbVerifiedContact,
                      session_approved: gateState.dbSessionApproved,
                      unrevoked_session_approved: gateState.dbSessionApproved,
                    },
                  ];
                }
                if (sql.includes('FROM public.admin_users')) {
                  return gateState.dbIsAdmin ? [{ '?column?': 1 }] : [];
                }
                return [];
              }),
            };
            return operation(db);
          },
        ),
      };

      adminUserService = {
        listUsers: vi.fn(async () => ({
          items: [SAMPLE_SUMMARY],
          meta: { limit: 20, next_cursor: null },
        })),
        getUserDetail: vi.fn(async () => SAMPLE_DETAIL),
        updateUserStatus: vi.fn(async () => ({
          ...SAMPLE_DETAIL,
          status: 'suspended' as const,
        })),
      };

      featureControlService = {
        listGlobalFeatures: vi.fn(async () => SAMPLE_FEATURES),
        setGlobalFeature: vi.fn(async () => SAMPLE_FEATURES[0]),
        setUserFeature: vi.fn(async () => SAMPLE_DETAIL),
      };

      auditService = {
        listAuditLogs: vi.fn(async () => ({
          items: [SAMPLE_AUDIT_LOG],
          meta: { limit: 20, next_cursor: null },
        })),
        recordInTx: vi.fn(async () => undefined),
      };

      usageService = {
        getUsageSummary: vi.fn(async () => SAMPLE_USAGE),
      };

      const realFeatureControlService = new FeatureControlService(
        mockDatabase as unknown as DatabaseService,
        auditService as unknown as AuditService,
      );
      const realUsageService = new UsageService(
        mockDatabase as unknown as DatabaseService,
      );
      const realAuditService = new AuditService(
        mockDatabase as unknown as DatabaseService,
      );

      // Delegate validation errors to real service validators when invoked with bad domain inputs.
      featureControlService.setGlobalFeature.mockImplementation(
        async (actorId, dto, ctx) => {
          if (dto?.feature_key === 'unknown_feature_key') {
            return realFeatureControlService.setGlobalFeature(
              actorId,
              dto,
              ctx,
            );
          }
          return SAMPLE_FEATURES[0];
        },
      );
      featureControlService.setUserFeature.mockImplementation(
        async (actorId, id, dto, ctx) => {
          if (dto?.feature_key === 'unknown_feature_key') {
            return realFeatureControlService.setUserFeature(
              actorId,
              id,
              dto,
              ctx,
            );
          }
          return SAMPLE_DETAIL;
        },
      );
      auditService.listAuditLogs.mockImplementation(async (actorId, query) => {
        if (query?.from && query?.to && query.from > query.to) {
          return realAuditService.listAuditLogs(actorId, query);
        }
        return {
          items: [SAMPLE_AUDIT_LOG],
          meta: { limit: 20, next_cursor: null },
        };
      });
      usageService.getUsageSummary.mockImplementation(
        async (actorId, query) => {
          if (
            query?.from === '2026-02-30' ||
            query?.from === '2026-11-25' ||
            query?.from === '2025-01-01'
          ) {
            return realUsageService.getUsageSummary(actorId, query);
          }
          return SAMPLE_USAGE;
        },
      );

      const moduleRef = await Test.createTestingModule({
        controllers: [AdminController],
        providers: [
          { provide: DatabaseService, useValue: mockDatabase },
          { provide: AdminUserService, useValue: adminUserService },
          { provide: FeatureControlService, useValue: featureControlService },
          { provide: AuditService, useValue: auditService },
          { provide: UsageService, useValue: usageService },
          {
            provide: APP_GUARD,
            useFactory: () => new StubSupabaseAuthGuard(gateState),
          },
          {
            provide: APP_GUARD,
            useFactory: (reflector: Reflector, db: DatabaseService) =>
              new AccessGuard(reflector, db),
            inject: [Reflector, DatabaseService],
          },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      configureHttp(app);
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    it('rejects a non-admin carrying a spoofed JWT ADMIN role claim with 403 ADMIN_REQUIRED (PRD §50)', async () => {
      gateState.jwtSpoofedRole = 'ADMIN';
      gateState.dbIsAdmin = false;

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/users')
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ADMIN_REQUIRED');
      expect(adminUserService.listUsers).not.toHaveBeenCalled();
    });

    it('rejects a suspended admin account with 403 ACCOUNT_SUSPENDED', async () => {
      gateState.dbStatus = 'suspended';
      gateState.dbIsAdmin = true;

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/features')
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
      expect(featureControlService.listGlobalFeatures).not.toHaveBeenCalled();
    });

    it('serves all 8 admin routes (EP-AD01..EP-AD08) for server-verified active admins', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/api/v1/admin/users?status=active&limit=10')
        .expect(200);
      expect(listRes.body).toEqual({
        success: true,
        data: [SAMPLE_SUMMARY],
        meta: { limit: 20, next_cursor: null },
      });

      const detailRes = await request(app.getHttpServer())
        .get(`/api/v1/admin/users/${TARGET_USER_ID}`)
        .expect(200);
      expect(detailRes.body.data.id).toBe(TARGET_USER_ID);
      expect(detailRes.body.data.counts).toEqual(SAMPLE_DETAIL.counts);

      const statusRes = await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${TARGET_USER_ID}`)
        .send({ status: 'suspended', reason: 'Abuse of AI endpoints' })
        .expect(200);
      expect(statusRes.body.data.status).toBe('suspended');

      const featListRes = await request(app.getHttpServer())
        .get('/api/v1/admin/features')
        .expect(200);
      expect(featListRes.body.data).toEqual(SAMPLE_FEATURES);

      const featPatchRes = await request(app.getHttpServer())
        .patch('/api/v1/admin/features')
        .send({ feature_key: 'technology_update', enabled: true })
        .expect(200);
      expect(featPatchRes.body.data.feature_key).toBe('technology_update');

      // EP-AD06 supports boolean AND explicit null (inherit)
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${TARGET_USER_ID}/features`)
        .send({ feature_key: 'technology_update', enabled: null })
        .expect(200);

      const auditRes = await request(app.getHttpServer())
        .get('/api/v1/admin/audit-logs?limit=20')
        .expect(200);
      expect(auditRes.body).toEqual({
        success: true,
        data: [SAMPLE_AUDIT_LOG],
        meta: { limit: 20, next_cursor: null },
      });

      const usageRes = await request(app.getHttpServer())
        .get('/api/v1/admin/usage?group_by=day')
        .expect(200);
      expect(usageRes.body.data.series.group_by).toBe('day');
    });

    it('rejects EP-AD03 reason shorter than 3 or longer than 300 Unicode code points and unknown fields with 422', async () => {
      const tooShort = await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${TARGET_USER_ID}`)
        .send({ status: 'suspended', reason: 'ab' })
        .expect(422);
      expect(tooShort.body.error.code).toBe('VALIDATION_FAILED');

      const tooLong = await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${TARGET_USER_ID}`)
        .send({ status: 'suspended', reason: 'a'.repeat(301) })
        .expect(422);
      expect(tooLong.body.error.code).toBe('VALIDATION_FAILED');

      const unknownField = await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${TARGET_USER_ID}`)
        .send({
          status: 'suspended',
          reason: 'Valid reason',
          extra_field: true,
        })
        .expect(422);
      expect(unknownField.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects EP-AD05 and EP-AD06 unknown feature_key with 422 UNKNOWN_FEATURE and missing enabled on EP-AD06 with 422', async () => {
      const globalUnknown = await request(app.getHttpServer())
        .patch('/api/v1/admin/features')
        .send({ feature_key: 'unknown_feature_key', enabled: true })
        .expect(422);
      expect(globalUnknown.body.error.code).toBe('UNKNOWN_FEATURE');

      const userUnknown = await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${TARGET_USER_ID}/features`)
        .send({ feature_key: 'unknown_feature_key', enabled: null })
        .expect(422);
      expect(userUnknown.body.error.code).toBe('UNKNOWN_FEATURE');

      const missingEnabled = await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${TARGET_USER_ID}/features`)
        .send({ feature_key: 'technology_update' })
        .expect(422);
      expect(missingEnabled.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects EP-AD07 from > to and EP-AD08 invalid calendar dates / from > to / > 366 days with 422', async () => {
      const badAuditRange = await request(app.getHttpServer())
        .get(
          '/api/v1/admin/audit-logs?from=2026-11-25T00:00:00Z&to=2026-11-24T00:00:00Z',
        )
        .expect(422);
      expect(badAuditRange.body.error.code).toBe('VALIDATION_FAILED');

      const impossibleDate = await request(app.getHttpServer())
        .get('/api/v1/admin/usage?from=2026-02-30&to=2026-03-01')
        .expect(422);
      expect(impossibleDate.body.error.code).toBe('VALIDATION_FAILED');

      const reversedUsage = await request(app.getHttpServer())
        .get('/api/v1/admin/usage?from=2026-11-25&to=2026-11-20')
        .expect(422);
      expect(reversedUsage.body.error.code).toBe('VALIDATION_FAILED');

      const oversizedUsage = await request(app.getHttpServer())
        .get('/api/v1/admin/usage?from=2025-01-01&to=2026-01-02')
        .expect(422);
      expect(oversizedUsage.body.error.code).toBe('VALIDATION_FAILED');
    });
  });
});

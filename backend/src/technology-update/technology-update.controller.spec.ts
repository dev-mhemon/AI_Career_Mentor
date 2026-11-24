import {
  CanActivate,
  ExecutionContext,
  Global,
  type INestApplication,
  Injectable,
  Module,
  RequestMethod,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessPolicy } from '../auth/policy.js';
import { configureHttp, fail } from '../common/http.js';
import { TechnologyUpdateController } from './controllers/technology-update.controller.js';
import type {
  TechnologyUpdateDTO,
  TechnologyUpdateListDTO,
  TechnologyUpdateViewedDTO,
} from './dto/technology-update.dto.js';
import { TechnologyUpdateService } from './services/technology-update.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const UPDATE_ID = '22222222-2222-4222-8222-222222222222';

const SAMPLE_UPDATE: TechnologyUpdateDTO = {
  id: UPDATE_ID,
  local_date: '2026-11-24',
  title: 'PostgreSQL 17.2 Released',
  what_changed: 'Planner and vacuum fixes.',
  why_it_matters: 'Directly affects your SQL indexing module.',
  publisher: 'PostgreSQL Global Development Group',
  source_url: 'https://www.postgresql.org/docs/release/17.2/',
  fetched_at: '2026-11-24T06:15:00.000Z',
  release_status: 'released',
  relevance: 'high',
  action_timing: 'learn_later',
  roadmap_relation: 'Relates to SQL Performance topic',
  viewed: false,
};

const SAMPLE_LIST: TechnologyUpdateListDTO = {
  today_state: 'available',
  generation_pending: false,
  message: null,
  items: [SAMPLE_UPDATE],
};

const SAMPLE_VIEWED: TechnologyUpdateViewedDTO = {
  id: UPDATE_ID,
  viewed: true,
  viewed_at: '2026-11-24T08:00:00.000Z',
};

interface MockGateState {
  authenticated: boolean;
  status: 'active' | 'suspended';
  technologyUpdateEnabled: boolean;
}

@Injectable()
class StubSupabaseAuthGuard implements CanActivate {
  constructor(private readonly state: MockGateState) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.state.authenticated) {
      fail(401, 'AUTH_REQUIRED', 'No bearer token');
    }
    const req = context.switchToHttp().getRequest<{
      user?: { sub: string; status: string };
    }>();
    req.user = { sub: USER_ID, status: this.state.status };
    return true;
  }
}

@Injectable()
class StubAccessGuard implements CanActivate {
  private readonly reflector = new Reflector();

  constructor(private readonly state: MockGateState) {}

  canActivate(context: ExecutionContext): boolean {
    const policy =
      this.reflector.getAllAndOverride<AccessPolicy>('access-policy', [
        context.getHandler(),
        context.getClass(),
      ]) ?? {};

    if (!policy.allowSuspended && this.state.status !== 'active') {
      fail(403, 'ACCOUNT_SUSPENDED', 'Account suspended');
    }
    if (
      policy.feature === 'technology_update' &&
      !this.state.technologyUpdateEnabled
    ) {
      fail(
        403,
        'FEATURE_DISABLED',
        'Technology updates are disabled for this account',
      );
    }
    return true;
  }
}

describe('TechnologyUpdateController (EP-T01..EP-T03 & Read Gate)', () => {
  describe('route metadata and @Policy feature gating', () => {
    it('registers exact C05 §14.11 paths, HTTP methods, read-gated technology_update policy, and zero duplicate @UseGuards', () => {
      const reflector = new Reflector();
      expect(
        Reflect.getMetadata(PATH_METADATA, TechnologyUpdateController),
      ).toBe('technology-updates');
      expect(
        reflector.get<AccessPolicy>(
          'access-policy',
          TechnologyUpdateController,
        ),
      ).toEqual({ feature: 'technology_update' });
      expect(
        Reflect.getMetadata(GUARDS_METADATA, TechnologyUpdateController),
      ).toBeUndefined();

      const proto = TechnologyUpdateController.prototype;

      // EP-T01 GET /api/v1/technology-updates -> Gate: read (technology_update)
      expect(Reflect.getMetadata(PATH_METADATA, proto.listUpdates)).toBe('/');
      expect(Reflect.getMetadata(METHOD_METADATA, proto.listUpdates)).toBe(
        RequestMethod.GET,
      );
      expect(
        reflector.get<AccessPolicy>('access-policy', proto.listUpdates),
      ).toEqual({ feature: 'technology_update' });
      expect(
        Reflect.getMetadata(GUARDS_METADATA, proto.listUpdates),
      ).toBeUndefined();

      // EP-T02 GET /api/v1/technology-updates/:id -> Gate: read (technology_update)
      expect(Reflect.getMetadata(PATH_METADATA, proto.getUpdate)).toBe(':id');
      expect(Reflect.getMetadata(METHOD_METADATA, proto.getUpdate)).toBe(
        RequestMethod.GET,
      );
      expect(
        reflector.get<AccessPolicy>('access-policy', proto.getUpdate),
      ).toEqual({ feature: 'technology_update' });
      expect(
        Reflect.getMetadata(GUARDS_METADATA, proto.getUpdate),
      ).toBeUndefined();

      // EP-T03 POST /api/v1/technology-updates/:id/view -> Gate: read (technology_update)
      expect(Reflect.getMetadata(PATH_METADATA, proto.markUpdateViewed)).toBe(
        ':id/view',
      );
      expect(Reflect.getMetadata(METHOD_METADATA, proto.markUpdateViewed)).toBe(
        RequestMethod.POST,
      );
      expect(
        reflector.get<AccessPolicy>('access-policy', proto.markUpdateViewed),
      ).toEqual({ feature: 'technology_update' });
      expect(
        Reflect.getMetadata(GUARDS_METADATA, proto.markUpdateViewed),
      ).toBeUndefined();
    });
  });

  describe('HTTP pipeline, envelope wrapping, validation, and read feature gate', () => {
    let app: INestApplication;
    let gateState: MockGateState;
    let serviceMock: {
      listUpdates: ReturnType<typeof vi.fn>;
      getUpdate: ReturnType<typeof vi.fn>;
      markUpdateViewed: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      gateState = {
        authenticated: true,
        status: 'active',
        technologyUpdateEnabled: true,
      };

      serviceMock = {
        listUpdates: vi.fn(
          async (_userId: string, query?: { limit?: number }) => ({
            data: SAMPLE_LIST,
            meta: { limit: query?.limit ?? 20, next_cursor: 'cursor_abc' },
          }),
        ),
        getUpdate: vi.fn(async () => SAMPLE_UPDATE),
        markUpdateViewed: vi.fn(async () => SAMPLE_VIEWED),
      };

      @Global()
      @Module({
        providers: [
          {
            provide: APP_GUARD,
            useFactory: () => new StubSupabaseAuthGuard(gateState),
          },
          {
            provide: APP_GUARD,
            useFactory: () => new StubAccessGuard(gateState),
          },
        ],
      })
      class StubGuardModule {}

      const moduleRef = await Test.createTestingModule({
        imports: [StubGuardModule],
        controllers: [TechnologyUpdateController],
        providers: [
          {
            provide: TechnologyUpdateService,
            useValue: serviceMock,
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

    it('EP-T01 GET /api/v1/technology-updates returns 200 TechnologyUpdateListDTO with top-level meta and parsed query params', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/technology-updates?limit=15&cursor=opaque_token')
        .expect(200);

      expect(res.body).toEqual({
        success: true,
        data: SAMPLE_LIST,
        meta: {
          limit: 15,
          next_cursor: 'cursor_abc',
        },
      });
      expect(serviceMock.listUpdates).toHaveBeenCalledWith(USER_ID, {
        limit: 15,
        cursor: 'opaque_token',
      });
    });

    it('EP-T01 rejects out-of-bounds limit query parameters with 422 VALIDATION_FAILED', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/technology-updates?limit=101')
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(serviceMock.listUpdates).not.toHaveBeenCalled();
    });

    it('EP-T02 GET /api/v1/technology-updates/:id returns 200 TechnologyUpdateDTO', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/technology-updates/${UPDATE_ID}`)
        .expect(200);

      expect(res.body).toEqual({
        success: true,
        data: SAMPLE_UPDATE,
      });
      expect(serviceMock.getUpdate).toHaveBeenCalledWith(USER_ID, UPDATE_ID);
    });

    it('EP-T03 POST /api/v1/technology-updates/:id/view returns 200 TechnologyUpdateViewedDTO', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/technology-updates/${UPDATE_ID}/view`)
        .expect(200);

      expect(res.body).toEqual({
        success: true,
        data: SAMPLE_VIEWED,
      });
      expect(serviceMock.markUpdateViewed).toHaveBeenCalledWith(
        USER_ID,
        UPDATE_ID,
      );
    });

    it('blocks all 3 read/view endpoints with 403 FEATURE_DISABLED when technology_update access is OFF (PRD §7, §38)', async () => {
      gateState.technologyUpdateEnabled = false;

      const listRes = await request(app.getHttpServer())
        .get('/api/v1/technology-updates')
        .expect(403);
      expect(listRes.body.error.code).toBe('FEATURE_DISABLED');

      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/technology-updates/${UPDATE_ID}`)
        .expect(403);
      expect(getRes.body.error.code).toBe('FEATURE_DISABLED');

      const viewRes = await request(app.getHttpServer())
        .post(`/api/v1/technology-updates/${UPDATE_ID}/view`)
        .expect(403);
      expect(viewRes.body.error.code).toBe('FEATURE_DISABLED');

      expect(serviceMock.listUpdates).not.toHaveBeenCalled();
      expect(serviceMock.getUpdate).not.toHaveBeenCalled();
      expect(serviceMock.markUpdateViewed).not.toHaveBeenCalled();
    });
  });
});

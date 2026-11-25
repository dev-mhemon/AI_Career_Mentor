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
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessPolicy } from '../auth/policy.js';
import { configureHttp, fail } from '../common/http.js';
import { FeedbackController } from './controllers/feedback.controller.js';
import {
  validateRatingTargetType,
  type RatingRequestDTO,
  type RatingResponseDTO,
  type ReportResponseDTO,
} from './dto/feedback.dto.js';
import { FeedbackService } from './services/feedback.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const REPORT_ID = '33333333-3333-4333-8333-333333333333';

interface MockGateState {
  authenticated: boolean;
  status: 'active' | 'suspended';
  guardInvocations: string[];
}

@Injectable()
class StubSupabaseAuthGuard implements CanActivate {
  constructor(private readonly state: MockGateState) {}

  canActivate(context: ExecutionContext): boolean {
    this.state.guardInvocations.push('SupabaseAuthGuard');
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
    this.state.guardInvocations.push('AccessGuard');
    const policy =
      this.reflector.getAllAndOverride<AccessPolicy>('access-policy', [
        context.getHandler(),
        context.getClass(),
      ]) ?? {};

    if (!policy.allowSuspended && this.state.status !== 'active') {
      fail(403, 'ACCOUNT_SUSPENDED', 'Account suspended');
    }
    return true;
  }
}

describe('FeedbackController (EP-F01 POST /ratings & EP-F02 POST /reports)', () => {
  describe('route metadata, @Policy({}), and zero duplicate @UseGuards', () => {
    it('registers exact C05 §14.12 paths, HTTP methods/codes, AZ-USER Gate:none policy, and zero controller/method @UseGuards', () => {
      const reflector = new Reflector();

      expect(Reflect.getMetadata(PATH_METADATA, FeedbackController)).toBe('/');
      expect(
        reflector.get<AccessPolicy>('access-policy', FeedbackController),
      ).toEqual({});
      expect(
        Reflect.getMetadata(GUARDS_METADATA, FeedbackController),
      ).toBeUndefined();

      const proto = FeedbackController.prototype;

      // EP-F01 POST /api/v1/ratings -> 200 OK, AZ-USER, Gate: none
      expect(Reflect.getMetadata(PATH_METADATA, proto.submitRating)).toBe(
        'ratings',
      );
      expect(Reflect.getMetadata(METHOD_METADATA, proto.submitRating)).toBe(
        RequestMethod.POST,
      );
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.submitRating)).toBe(
        200,
      );
      expect(
        reflector.get<AccessPolicy>('access-policy', proto.submitRating),
      ).toEqual({});
      expect(
        Reflect.getMetadata(GUARDS_METADATA, proto.submitRating),
      ).toBeUndefined();

      // EP-F02 POST /api/v1/reports -> 201 Created, AZ-USER, Gate: none
      expect(Reflect.getMetadata(PATH_METADATA, proto.submitReport)).toBe(
        'reports',
      );
      expect(Reflect.getMetadata(METHOD_METADATA, proto.submitReport)).toBe(
        RequestMethod.POST,
      );
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.submitReport)).toBe(
        201,
      );
      expect(
        reflector.get<AccessPolicy>('access-policy', proto.submitReport),
      ).toEqual({});
      expect(
        Reflect.getMetadata(GUARDS_METADATA, proto.submitReport),
      ).toBeUndefined();
    });

    it('resolves FeedbackController and FeedbackService via AppModule DI graph without controller-level guard metadata', async () => {
      const prevEnv = { ...process.env };
      process.env.NODE_ENV = 'test';
      process.env.DB_HOST = '127.0.0.1';
      process.env.DB_PORT = '54322';
      process.env.DB_USER = 'postgres';
      process.env.DB_PASSWORD = 'postgres';
      process.env.DB_NAME = 'postgres';
      process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
      process.env.SUPABASE_ANON_KEY =
        'sb_publishable_test_anon_key_for_di_compile';
      process.env.SUPABASE_JWT_SECRET =
        'super-secret-jwt-token-with-at-least-32-characters-long';
      process.env.AUTH_OTP_HMAC_SECRET =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      process.env.DELETION_RECEIPT_SECRET =
        'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
      process.env.PROVIDER_CLEANUP_ENCRYPTION_KEY =
        '1111111111111111111111111111111111111111111111111111111111111111';

      try {
        const { AppModule } = await import('../app.module.js');
        const fakeDataSource = {
          isInitialized: true,
          options: { type: 'postgres' },
          query: vi.fn(async () => []),
          transaction: vi.fn(),
          destroy: vi.fn(async () => undefined),
        };

        const moduleRef = await Test.createTestingModule({
          imports: [AppModule],
        })
          .overrideProvider(DataSource)
          .useValue(fakeDataSource)
          .compile();

        const controller = moduleRef.get(FeedbackController);
        const service = moduleRef.get(FeedbackService);
        expect(controller).toBeInstanceOf(FeedbackController);
        expect(service).toBeInstanceOf(FeedbackService);
        expect(
          Reflect.getMetadata(GUARDS_METADATA, FeedbackController),
        ).toBeUndefined();
      } finally {
        process.env = prevEnv;
      }
    }, 15_000);
  });

  describe('HTTP pipeline, DTO validation, Unicode code-point bounds, and error envelopes', () => {
    let app: INestApplication;
    let gateState: MockGateState;
    let serviceMock: {
      submitRating: ReturnType<typeof vi.fn>;
      submitReport: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      gateState = {
        authenticated: true,
        status: 'active',
        guardInvocations: [],
      };

      serviceMock = {
        submitRating: vi.fn(
          async (
            _userId: string,
            dto: RatingRequestDTO,
          ): Promise<RatingResponseDTO> => {
            const targetType = validateRatingTargetType(dto.target_type);
            return {
              target_type: targetType,
              target_id: dto.target_id,
              score: dto.score,
            };
          },
        ),
        submitReport: vi.fn(async (): Promise<ReportResponseDTO> => ({
          report_id: REPORT_ID,
          status: 'received',
        })),
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
        controllers: [FeedbackController],
        providers: [
          {
            provide: FeedbackService,
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

    it('EP-F01 POST /api/v1/ratings returns 200 { target_type, target_id, score } and runs global guards once', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/ratings')
        .send({
          target_type: 'technology_update',
          target_id: TARGET_ID,
          score: 5,
          comment: '  খুবই উপকারী আপডেট  ',
        })
        .expect(200);

      expect(res.body).toEqual({
        success: true,
        data: {
          target_type: 'technology_update',
          target_id: TARGET_ID,
          score: 5,
        },
      });
      expect(gateState.guardInvocations).toEqual([
        'SupabaseAuthGuard',
        'AccessGuard',
      ]);
      expect(serviceMock.submitRating).toHaveBeenCalledWith(USER_ID, {
        target_type: 'technology_update',
        target_id: TARGET_ID,
        score: 5,
        comment: 'খুবই উপকারী আপডেট',
      });
    });

    it.each([
      'quiz_question',
      'practice_review',
      'roadmap_content',
      'mentor',
      'mentor_message',
      'conversation',
    ])(
      'EP-F01 rejects non-ratable domain target %s with 422 TARGET_NOT_RATABLE (C05 §14.12)',
      async (nonRatableTarget) => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/ratings')
          .send({
            target_type: nonRatableTarget,
            target_id: TARGET_ID,
            score: 4,
          })
          .expect(422);

        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('TARGET_NOT_RATABLE');
      },
    );

    it('EP-F01 rejects unknown arbitrary target_type strings with 422 VALIDATION_FAILED', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/ratings')
        .send({
          target_type: 'totally_unknown_type',
          target_id: TARGET_ID,
          score: 4,
        })
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it.each([0, 6, 3.5, '4', null])(
      'EP-F01 rejects invalid score %p with 422 VALIDATION_FAILED',
      async (badScore) => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/ratings')
          .send({
            target_type: 'topic_content',
            target_id: TARGET_ID,
            score: badScore,
          })
          .expect(422);

        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(serviceMock.submitRating).not.toHaveBeenCalled();
      },
    );

    it('EP-F01 accepts 500 astral emoji Unicode code points (1000 UTF-16 units) and rejects 501', async () => {
      const fiveHundredEmojis = '🚀'.repeat(500);
      expect(fiveHundredEmojis.length).toBe(1000);

      await request(app.getHttpServer())
        .post('/api/v1/ratings')
        .send({
          target_type: 'roadmap_draft',
          target_id: TARGET_ID,
          score: 5,
          comment: fiveHundredEmojis,
        })
        .expect(200);

      const fiveHundredOneEmojis = '🚀'.repeat(501);
      const tooLongRes = await request(app.getHttpServer())
        .post('/api/v1/ratings')
        .send({
          target_type: 'roadmap_draft',
          target_id: TARGET_ID,
          score: 5,
          comment: fiveHundredOneEmojis,
        })
        .expect(422);

      expect(tooLongRes.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('EP-F01 rejects explicit null, NUL byte, and unpaired surrogates in comment', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/ratings')
        .send({
          target_type: 'roadmap_merge',
          target_id: TARGET_ID,
          score: 4,
          comment: null,
        })
        .expect(422);

      await request(app.getHttpServer())
        .post('/api/v1/ratings')
        .send({
          target_type: 'roadmap_merge',
          target_id: TARGET_ID,
          score: 4,
          comment: 'bad\u0000byte',
        })
        .expect(422);

      await request(app.getHttpServer())
        .post('/api/v1/ratings')
        .send({
          target_type: 'roadmap_merge',
          target_id: TARGET_ID,
          score: 4,
          comment: 'unpaired\uD800surrogate',
        })
        .expect(422);

      expect(serviceMock.submitRating).not.toHaveBeenCalled();
    });

    it('EP-F02 POST /api/v1/reports returns 201 { report_id, status: "received" }', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          target_type: 'practice_review',
          target_id: TARGET_ID,
          reason: 'unfair_scoring',
          comment: 'আমার উত্তর সঠিক ছিল',
        })
        .expect(201);

      expect(res.body).toEqual({
        success: true,
        data: {
          report_id: REPORT_ID,
          status: 'received',
        },
      });
      expect(serviceMock.submitReport).toHaveBeenCalledWith(USER_ID, {
        target_type: 'practice_review',
        target_id: TARGET_ID,
        reason: 'unfair_scoring',
        comment: 'আমার উত্তর সঠিক ছিল',
      });
    });

    it('EP-F02 accepts 1000 astral emoji Unicode code points and rejects 1001, explicit null, NUL, and unpaired surrogates', async () => {
      const thousandEmojis = '🔥'.repeat(1000);
      await request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          target_type: 'quiz_question',
          target_id: TARGET_ID,
          reason: 'incorrect',
          comment: thousandEmojis,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          target_type: 'quiz_question',
          target_id: TARGET_ID,
          reason: 'incorrect',
          comment: '🔥'.repeat(1001),
        })
        .expect(422);

      await request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          target_type: 'quiz_question',
          target_id: TARGET_ID,
          reason: 'incorrect',
          comment: null,
        })
        .expect(422);

      await request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          target_type: 'quiz_question',
          target_id: TARGET_ID,
          reason: 'incorrect',
          comment: 'bad\u0000text',
        })
        .expect(422);

      await request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          target_type: 'quiz_question',
          target_id: TARGET_ID,
          reason: 'incorrect',
          comment: 'bad\uDC00surrogate',
        })
        .expect(422);
    });

    it('EP-F02 serializes 409 REPORT_ALREADY_SUBMITTED and 404 TARGET_NOT_FOUND envelopes cleanly', async () => {
      serviceMock.submitReport.mockImplementationOnce(async () => {
        fail(
          409,
          'REPORT_ALREADY_SUBMITTED',
          'You have already submitted a report for this item',
        );
      });

      const dupRes = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          target_type: 'topic_content',
          target_id: TARGET_ID,
          reason: 'outdated',
        })
        .expect(409);

      expect(dupRes.body.success).toBe(false);
      expect(dupRes.body.error.code).toBe('REPORT_ALREADY_SUBMITTED');

      serviceMock.submitReport.mockImplementationOnce(async () => {
        fail(404, 'TARGET_NOT_FOUND', 'Target not found or not visible');
      });

      const notFoundRes = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          target_type: 'roadmap_content',
          target_id: TARGET_ID,
          reason: 'unclear',
        })
        .expect(404);

      expect(notFoundRes.body.success).toBe(false);
      expect(notFoundRes.body.error.code).toBe('TARGET_NOT_FOUND');
    });

    it('rejects unauthenticated (401) and suspended (403) callers via global APP_GUARDs', async () => {
      gateState.authenticated = false;
      const unauthRes = await request(app.getHttpServer())
        .post('/api/v1/ratings')
        .send({
          target_type: 'topic_content',
          target_id: TARGET_ID,
          score: 4,
        })
        .expect(401);
      expect(unauthRes.body.error.code).toBe('AUTH_REQUIRED');

      gateState.authenticated = true;
      gateState.status = 'suspended';
      const suspRes = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          target_type: 'topic_content',
          target_id: TARGET_ID,
          reason: 'other',
        })
        .expect(403);
      expect(suspRes.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });
  });
});

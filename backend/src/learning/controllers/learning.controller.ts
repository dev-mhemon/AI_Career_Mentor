import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Policy } from '../../auth/policy.js';
import { fail } from '../../common/http.js';
import { IdempotencyService } from '../../jobs/services/idempotency.service.js';
import type { PageMetaDTO } from '../../roadmap/dto/roadmap.dto.js';
import {
  CreateDailyPlanDTO,
  type DailyPlanResponseDTO,
  GetDailyPlanQueryDTO,
  type LearningResourceDTO,
  ListLearningResourcesQueryDTO,
  ListTopicsQueryDTO,
  RebuildDailyPlanDTO,
  type TodayResponseDTO,
  type TopicDetailDTO,
  type TopicSummaryDTO,
} from '../dto/learning.dto.js';
import { DailyPlanService } from '../services/daily-plan.service.js';
import { TodayService } from '../services/today.service.js';
import { TopicContentService } from '../services/topic-content.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthenticatedLearningRequest {
  user?: {
    sub?: string;
    sessionId?: string;
    status?: string;
  };
  headers?: Record<string, string | string[] | undefined>;
}

function assertAuthenticatedUserId(req: AuthenticatedLearningRequest): string {
  const userId = req?.user?.sub;
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId.trim())) {
    fail(401, 'AUTH_REQUIRED', 'Application account required');
  }
  return userId.trim();
}

function assertValidUuidParam(
  value: string,
  field: string,
  label: string,
): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    fail(400, 'INVALID_FORMAT', `${label} must be a valid UUID`, [
      {
        field,
        code: 'INVALID_FORMAT',
        message: `${field} must be a valid UUID`,
      },
    ]);
  }
  return value.trim();
}

function readOptionalHeader(
  req: AuthenticatedLearningRequest,
  name: string,
): string | undefined {
  const raw = req?.headers?.[name];
  return typeof raw === 'string' ? raw : undefined;
}

function extractOptionalUuidHeader(
  req: AuthenticatedLearningRequest,
  name: string,
): string | undefined {
  const raw = readOptionalHeader(req, name);
  if (!raw || !UUID_PATTERN.test(raw.trim())) {
    return undefined;
  }
  return raw.trim();
}

function attachPaginationMeta<T>(
  payload: T,
  meta: PageMetaDTO,
  res?: Response,
): T | { data: T; meta: PageMetaDTO } {
  if (res && typeof res.json === 'function') {
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (
        body &&
        typeof body === 'object' &&
        'success' in body &&
        (body as { success?: unknown }).success === true &&
        'data' in body &&
        !('meta' in body)
      ) {
        return originalJson({
          ...(body as Record<string, unknown>),
          meta,
        });
      }
      return originalJson(body);
    }) as Response['json'];
    return payload;
  }
  return { data: payload, meta };
}

/**
 * Controller exposing `C05` §14.6 Learning API (`EP-L01`–`EP-L07`).
 *
 * Protected by the global `APP_GUARD` pipeline (`SupabaseAuthGuard` then `AccessGuard`) registered
 * by `AuthModule` — no duplicate controller-level `@UseGuards` so `AccessGuard` runs once per request:
 * - Write routes (`EP-L02`, `EP-L03`) require `@Policy({ feature: 'daily_plan' })`.
 * - Read routes (`EP-L01`, `EP-L04`, `EP-L05`, `EP-L06`, `EP-L07`) declare `@Policy({})` (`Gate: none`)
 *   so existing plans, topics, and resources stay readable when generation flags are OFF.
 */
@Controller('learning')
@Policy({})
export class LearningController {
  private readonly logger = new Logger(LearningController.name);

  constructor(
    @Inject(DailyPlanService)
    private readonly dailyPlanService: DailyPlanService,
    @Inject(TodayService) private readonly todayService: TodayService,
    @Inject(TopicContentService)
    private readonly topicContentService: TopicContentService,
    @Inject(IdempotencyService)
    private readonly idempotencyService: IdempotencyService,
  ) {}

  private logNonProdServerFailure(
    operation: string,
    req: AuthenticatedLearningRequest,
    res: Response | undefined,
    error: unknown,
  ): void {
    if (process.env.NODE_ENV === 'production') {
      return;
    }
    const status = error instanceof HttpException ? error.getStatus() : 500;
    if (status < 500) {
      return;
    }
    const headerReqId =
      typeof res?.getHeader === 'function'
        ? res.getHeader('X-Request-Id')
        : undefined;
    const requestId =
      typeof headerReqId === 'string' && headerReqId.trim().length > 0
        ? headerReqId.trim()
        : (extractOptionalUuidHeader(req, 'x-request-id') ?? 'unknown');
    const body =
      error instanceof HttpException ? error.getResponse() : undefined;
    const bodyObj =
      body && typeof body === 'object'
        ? (body as { code?: unknown })
        : undefined;
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const code =
      typeof bodyObj?.code === 'string'
        ? bodyObj.code
        : status === 503
          ? 'SERVICE_UNAVAILABLE'
          : 'INTERNAL_ERROR';
    this.logger.warn(
      JSON.stringify({
        operation,
        errorName,
        status,
        code,
        requestId,
      }),
    );
  }

  /**
   * `EP-L01` (`GET /api/v1/learning/daily-plan`, `200 OK`, `Gate: none`).
   */
  @Get('daily-plan')
  @HttpCode(200)
  @Policy({})
  async getDailyPlan(
    @Req() req: AuthenticatedLearningRequest,
    @Query() query?: GetDailyPlanQueryDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<
    DailyPlanResponseDTO | { data: DailyPlanResponseDTO; meta: PageMetaDTO }
  > {
    const userId = assertAuthenticatedUserId(req);
    const result = await this.dailyPlanService.getDailyPlan(userId, query);
    return attachPaginationMeta(result.plan, result.meta, res);
  }

  /**
   * `EP-L02` (`POST /api/v1/learning/daily-plans`, `201 Created`, `H-IDEM`, `Gate: write (daily_plan)`).
   */
  @Post('daily-plans')
  @HttpCode(201)
  @Policy({ feature: 'daily_plan' })
  async createDailyPlan(
    @Req() req: AuthenticatedLearningRequest,
    @Body() dto: CreateDailyPlanDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<DailyPlanResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const idempotencyKeyHeader = req?.headers?.['idempotency-key'];

    let step = 'ep_l02.idempotency_execute';
    let executed;
    try {
      executed = await this.idempotencyService.execute<DailyPlanResponseDTO>(
        {
          userId,
          idempotencyKey: idempotencyKeyHeader,
          method: 'POST',
          route: '/api/v1/learning/daily-plans',
          body: dto ?? null,
        },
        async (execCtx) => {
          if (execCtx.signal.aborted) {
            step = 'ep_l02.idempotency_reservation_expired';
            fail(
              503,
              'SERVICE_UNAVAILABLE',
              'Idempotency reservation expired before mutation dispatch',
              undefined,
              true,
            );
          }
          step = 'ep_l02.daily_plan_service_create';
          const plan = await this.dailyPlanService.createDailyPlan(userId, dto);
          step = 'ep_l02.idempotency_complete';
          return {
            statusCode: 201,
            responseBody: plan,
          };
        },
      );
    } catch (error) {
      this.logNonProdServerFailure(step, req, res, error);
      throw error;
    }

    if (res && typeof res.status === 'function') {
      res.status(executed.statusCode);
    }
    return executed.responseBody;
  }

  /**
   * `EP-L03` (`POST /api/v1/learning/daily-plans/:id/rebuild`, `200 OK`, `Gate: write (daily_plan)`).
   */
  @Post('daily-plans/:id/rebuild')
  @HttpCode(200)
  @Policy({ feature: 'daily_plan' })
  async rebuildDailyPlan(
    @Req() req: AuthenticatedLearningRequest,
    @Param('id') id: string,
    @Body() dto: RebuildDailyPlanDTO,
  ): Promise<DailyPlanResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const planId = assertValidUuidParam(id, 'id', 'Daily Plan id');
    return this.dailyPlanService.rebuildDailyPlan(userId, planId, dto);
  }

  /**
   * `EP-L04` (`GET /api/v1/learning/today`, `200 OK`, `Gate: none` for reads; `daily_plan` checked on enqueue).
   */
  @Get('today')
  @HttpCode(200)
  @Policy({})
  async getToday(
    @Req() req: AuthenticatedLearningRequest,
  ): Promise<TodayResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const httpRequestId = extractOptionalUuidHeader(req, 'x-request-id');
    const acceptLanguage = readOptionalHeader(req, 'accept-language');
    return this.todayService.getToday(userId, {
      httpRequestId,
      acceptLanguage,
    });
  }

  /**
   * `EP-L05` (`GET /api/v1/learning/topics`, `200 OK`, `Gate: none`).
   */
  @Get('topics')
  @HttpCode(200)
  @Policy({})
  async listTopics(
    @Req() req: AuthenticatedLearningRequest,
    @Query() query?: ListTopicsQueryDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<
    TopicSummaryDTO[] | { data: TopicSummaryDTO[]; meta: PageMetaDTO }
  > {
    const userId = assertAuthenticatedUserId(req);
    const result = await this.topicContentService.listTopics(userId, query);
    return attachPaginationMeta(result.items, result.meta, res);
  }

  /**
   * `EP-L06` (`GET /api/v1/learning/topics/:id`, `200 OK`, `Gate: none`).
   */
  @Get('topics/:id')
  @HttpCode(200)
  @Policy({})
  async getTopic(
    @Req() req: AuthenticatedLearningRequest,
    @Param('id') id: string,
  ): Promise<TopicDetailDTO> {
    const userId = assertAuthenticatedUserId(req);
    const topicId = assertValidUuidParam(id, 'id', 'Topic id');
    return this.topicContentService.getTopic(userId, topicId);
  }

  /**
   * `EP-L07` (`GET /api/v1/learning/resources`, `200 OK`, `Gate: none`).
   */
  @Get('resources')
  @HttpCode(200)
  @Policy({})
  async listResources(
    @Req() req: AuthenticatedLearningRequest,
    @Query() query: ListLearningResourcesQueryDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<
    LearningResourceDTO[] | { data: LearningResourceDTO[]; meta: PageMetaDTO }
  > {
    const userId = assertAuthenticatedUserId(req);
    const result = await this.topicContentService.listResources(userId, query);
    return attachPaginationMeta(result.items, result.meta, res);
  }
}

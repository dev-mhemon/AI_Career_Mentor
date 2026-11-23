import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Policy } from '../../auth/policy.js';
import { fail } from '../../common/http.js';
import type { JobAcceptedDto } from '../../jobs/dto/job-status.dto.js';
import { IdempotencyService } from '../../jobs/services/idempotency.service.js';
import {
  QuizAnswersPatchDTO,
  QuizGenerateDTO,
  QuizSubmissionDTO,
  type QuizAnswersSavedResponseDTO,
  type QuizAttemptDTO,
  type QuizResultDTO,
  type QuizSubmitResponseDTO,
} from '../dto/quiz.dto.js';
import { QuizService } from '../services/quiz.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthenticatedQuizRequest {
  user?: {
    sub?: string;
    sessionId?: string;
    status?: string;
  };
  headers?: Record<string, string | string[] | undefined>;
}

function assertAuthenticatedUserId(req: AuthenticatedQuizRequest): string {
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

function assertIdempotencyKeyHeader(req: AuthenticatedQuizRequest): string {
  const headerVal = req?.headers?.['idempotency-key'];
  const raw = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (typeof raw !== 'string' || !UUID_PATTERN.test(raw.trim())) {
    fail(
      400,
      'INVALID_FORMAT',
      'Idempotency-Key header is required and must be a valid UUID',
      [
        {
          field: 'Idempotency-Key',
          code: 'INVALID_FORMAT',
          message: 'Idempotency-Key must be a valid UUID',
        },
      ],
    );
  }
  return raw.trim();
}

function readOptionalHeader(
  req: AuthenticatedQuizRequest,
  name: string,
): string | undefined {
  const raw = req?.headers?.[name];
  return typeof raw === 'string' ? raw : undefined;
}

function extractOptionalUuidHeader(
  req: AuthenticatedQuizRequest,
  name: string,
): string | undefined {
  const raw = readOptionalHeader(req, name);
  if (!raw || !UUID_PATTERN.test(raw.trim())) {
    return undefined;
  }
  return raw.trim();
}

/**
 * Controller exposing `C05` §14.7 Quiz API (`EP-Q01`–`EP-Q07`).
 *
 * Protected by the global `APP_GUARD` pipeline (`SupabaseAuthGuard` + `AccessGuard`):
 * - Write routes (`EP-Q01`, `EP-Q03`, `EP-Q04`, `EP-Q05`, `EP-Q07`) require `@Policy({ feature: 'quiz_practice' })`.
 * - Read routes (`EP-Q02`, `EP-Q06`) declare `@Policy({})` (`Gate: none`) so existing attempts and
 *   results remain readable when generation flags are OFF.
 */
@Controller('quiz')
@Policy({})
export class QuizController {
  private readonly logger = new Logger(QuizController.name);

  constructor(
    @Inject(QuizService) private readonly quizService: QuizService,
    @Inject(IdempotencyService)
    private readonly idempotencyService: IdempotencyService,
  ) {}

  private logNonProdServerFailure(
    operation: string,
    req: AuthenticatedQuizRequest,
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
   * `EP-Q01` (`POST /api/v1/quiz/generate`, `200`/`201`/`202`, `H-IDEM`, `Gate: write (quiz_practice)`).
   */
  @Post('generate')
  @Policy({ feature: 'quiz_practice' })
  async generateQuiz(
    @Req() req: AuthenticatedQuizRequest,
    @Body() dto: QuizGenerateDTO,
    @Res() res?: Response,
  ): Promise<QuizAttemptDTO | JobAcceptedDto> {
    const userId = assertAuthenticatedUserId(req);
    const idempotencyKey = assertIdempotencyKeyHeader(req);
    // Validate daily_plan_item_id BEFORE reserving an H-IDEM in_flight key
    assertValidUuidParam(
      dto?.daily_plan_item_id,
      'daily_plan_item_id',
      'daily_plan_item_id',
    );
    const httpRequestId = extractOptionalUuidHeader(req, 'x-request-id');
    const acceptLanguage = readOptionalHeader(req, 'accept-language');

    let step = 'ep_q01.idempotency_execute';
    let executed;
    try {
      executed = await this.idempotencyService.execute<
        QuizAttemptDTO | JobAcceptedDto
      >(
        {
          userId,
          idempotencyKey,
          method: 'POST',
          route: '/api/v1/quiz/generate',
          body: dto ?? null,
        },
        async (execCtx) => {
          if (execCtx.signal.aborted) {
            step = 'ep_q01.idempotency_reservation_expired';
            fail(
              503,
              'SERVICE_UNAVAILABLE',
              'Idempotency reservation expired before mutation dispatch',
              undefined,
              true,
            );
          }
          step = 'ep_q01.quiz_service_generate';
          const outcome = await this.quizService.generateOrFetchQuizAttempt(
            userId,
            dto,
            {
              httpRequestId,
              acceptLanguage,
            },
          );
          step = 'ep_q01.idempotency_complete';
          return {
            statusCode: outcome.statusCode,
            responseBody: outcome.body,
          };
        },
      );
    } catch (error) {
      this.logNonProdServerFailure(step, req, res, error);
      throw error;
    }

    if (res && typeof res.status === 'function') {
      res.status(executed.statusCode);
      if (typeof res.json === 'function') {
        res.json({ success: true, data: executed.responseBody });
        return undefined as unknown as QuizAttemptDTO | JobAcceptedDto;
      }
    }
    return executed.responseBody;
  }

  /**
   * `EP-Q02` (`GET /api/v1/quiz/:id`, `200 OK`, `Gate: none`).
   */
  @Get(':id')
  @HttpCode(200)
  @Policy({})
  async getQuizAttempt(
    @Req() req: AuthenticatedQuizRequest,
    @Param('id') id: string,
  ): Promise<QuizAttemptDTO> {
    const userId = assertAuthenticatedUserId(req);
    const attemptId = assertValidUuidParam(id, 'id', 'Quiz attempt id');
    return this.quizService.getQuizAttempt(userId, attemptId);
  }

  /**
   * `EP-Q03` (`POST /api/v1/quiz/:id/start`, `200 OK`, `Gate: write (quiz_practice)`).
   */
  @Post(':id/start')
  @HttpCode(200)
  @Policy({ feature: 'quiz_practice' })
  async startQuizAttempt(
    @Req() req: AuthenticatedQuizRequest,
    @Param('id') id: string,
  ): Promise<QuizAttemptDTO> {
    const userId = assertAuthenticatedUserId(req);
    const attemptId = assertValidUuidParam(id, 'id', 'Quiz attempt id');
    return this.quizService.startQuizAttempt(userId, attemptId);
  }

  /**
   * `EP-Q04` (`PATCH /api/v1/quiz/:id/answers`, `200 OK`, `Gate: write (quiz_practice)`).
   */
  @Patch(':id/answers')
  @HttpCode(200)
  @Policy({ feature: 'quiz_practice' })
  async saveAnswers(
    @Req() req: AuthenticatedQuizRequest,
    @Param('id') id: string,
    @Body() dto: QuizAnswersPatchDTO,
  ): Promise<QuizAnswersSavedResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const attemptId = assertValidUuidParam(id, 'id', 'Quiz attempt id');
    return this.quizService.saveAnswers(userId, attemptId, dto);
  }

  /**
   * `EP-Q05` (`POST /api/v1/quiz/:id/submit`, `200`/`202`, `H-IDEM`, `Gate: write (quiz_practice)`).
   */
  @Post(':id/submit')
  @Policy({ feature: 'quiz_practice' })
  async submitQuizAttempt(
    @Req() req: AuthenticatedQuizRequest,
    @Param('id') id: string,
    @Body() dto: QuizSubmissionDTO,
    @Res() res?: Response,
  ): Promise<QuizSubmitResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const attemptId = assertValidUuidParam(id, 'id', 'Quiz attempt id');
    const normalizedRouteAttemptId = attemptId.toLowerCase();
    const idempotencyKey = assertIdempotencyKeyHeader(req);
    if (
      dto?.confirm_unanswered !== undefined &&
      typeof dto.confirm_unanswered !== 'boolean'
    ) {
      fail(422, 'VALIDATION_FAILED', 'confirm_unanswered must be a boolean', [
        {
          field: 'confirm_unanswered',
          code: 'VALIDATION_FAILED',
          message: 'confirm_unanswered must be a boolean',
        },
      ]);
    }
    if (
      dto?.answers !== undefined &&
      dto.answers !== null &&
      !Array.isArray(dto.answers)
    ) {
      fail(422, 'VALIDATION_FAILED', 'answers must be an array', [
        {
          field: 'answers',
          code: 'VALIDATION_FAILED',
          message: 'answers must be an array',
        },
      ]);
    }
    const httpRequestId = extractOptionalUuidHeader(req, 'x-request-id');
    const acceptLanguage = readOptionalHeader(req, 'accept-language');

    let step = 'ep_q05.idempotency_execute';
    let executed;
    try {
      executed = await this.idempotencyService.execute<QuizSubmitResponseDTO>(
        {
          userId,
          idempotencyKey,
          method: 'POST',
          route: `/api/v1/quiz/${normalizedRouteAttemptId}/submit`,
          body: dto ?? null,
        },
        async (execCtx) => {
          if (execCtx.signal.aborted) {
            step = 'ep_q05.idempotency_reservation_expired';
            fail(
              503,
              'SERVICE_UNAVAILABLE',
              'Idempotency reservation expired before mutation dispatch',
              undefined,
              true,
            );
          }
          step = 'ep_q05.quiz_service_submit';
          const outcome = await this.quizService.submitQuizAttempt(
            userId,
            attemptId,
            dto,
            {
              httpRequestId,
              acceptLanguage,
              signal: execCtx.signal,
            },
          );
          step = 'ep_q05.idempotency_complete';
          return {
            statusCode: outcome.statusCode,
            responseBody: outcome.body,
          };
        },
      );
    } catch (error) {
      this.logNonProdServerFailure(step, req, res, error);
      throw error;
    }

    if (res && typeof res.status === 'function') {
      res.status(executed.statusCode);
      if (typeof res.json === 'function') {
        res.json({ success: true, data: executed.responseBody });
        return undefined as unknown as QuizSubmitResponseDTO;
      }
    }
    return executed.responseBody;
  }

  /**
   * `EP-Q06` (`GET /api/v1/quiz/:id/result`, `200 OK`, `Gate: none`).
   * Also accepts `:id/results` alias for client resilience.
   */
  @Get([':id/result', ':id/results'])
  @HttpCode(200)
  @Policy({})
  async getQuizResult(
    @Req() req: AuthenticatedQuizRequest,
    @Param('id') id: string,
  ): Promise<QuizResultDTO> {
    const userId = assertAuthenticatedUserId(req);
    const attemptId = assertValidUuidParam(id, 'id', 'Quiz attempt id');
    return this.quizService.getQuizResult(userId, attemptId);
  }

  /**
   * `EP-Q07` (`POST /api/v1/quiz/:id/retry`, `201`/`202`, `H-IDEM`, `Gate: write (quiz_practice)`).
   */
  @Post(':id/retry')
  @Policy({ feature: 'quiz_practice' })
  async retryQuizAttempt(
    @Req() req: AuthenticatedQuizRequest,
    @Param('id') id: string,
    @Res() res?: Response,
  ): Promise<QuizAttemptDTO | JobAcceptedDto> {
    const userId = assertAuthenticatedUserId(req);
    const attemptId = assertValidUuidParam(id, 'id', 'Quiz attempt id');
    const normalizedRouteAttemptId = attemptId.toLowerCase();
    const idempotencyKey = assertIdempotencyKeyHeader(req);
    const httpRequestId = extractOptionalUuidHeader(req, 'x-request-id');
    const acceptLanguage = readOptionalHeader(req, 'accept-language');

    let step = 'ep_q07.idempotency_execute';
    let executed;
    try {
      executed = await this.idempotencyService.execute<
        QuizAttemptDTO | JobAcceptedDto
      >(
        {
          userId,
          idempotencyKey,
          method: 'POST',
          route: `/api/v1/quiz/${normalizedRouteAttemptId}/retry`,
          body: null,
        },
        async (execCtx) => {
          if (execCtx.signal.aborted) {
            step = 'ep_q07.idempotency_reservation_expired';
            fail(
              503,
              'SERVICE_UNAVAILABLE',
              'Idempotency reservation expired before mutation dispatch',
              undefined,
              true,
            );
          }
          step = 'ep_q07.quiz_service_retry';
          const outcome = await this.quizService.retryQuizAttempt(
            userId,
            attemptId,
            {
              httpRequestId,
              acceptLanguage,
            },
          );
          step = 'ep_q07.idempotency_complete';
          return {
            statusCode: outcome.statusCode,
            responseBody: outcome.body,
          };
        },
      );
    } catch (error) {
      this.logNonProdServerFailure(step, req, res, error);
      throw error;
    }

    if (res && typeof res.status === 'function') {
      res.status(executed.statusCode);
      if (typeof res.json === 'function') {
        res.json({ success: true, data: executed.responseBody });
        return undefined as unknown as QuizAttemptDTO | JobAcceptedDto;
      }
    }
    return executed.responseBody;
  }
}

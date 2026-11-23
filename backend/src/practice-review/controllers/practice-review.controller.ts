import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Policy } from '../../auth/policy.js';
import { fail } from '../../common/http.js';
import type { JobAcceptedDto } from '../../jobs/dto/job-status.dto.js';
import {
  ListPracticeReviewsQueryDTO,
  type PracticeFeedbackDTO,
  type PracticeReviewSummaryDTO,
} from '../dto/practice-review.dto.js';
import { PracticeReviewService } from '../services/practice-review.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthenticatedPracticeReviewRequest {
  user?: {
    sub?: string;
    sessionId?: string;
    status?: string;
  };
  headers?: Record<string, string | string[] | undefined>;
}

function assertAuthenticatedUserId(
  req: AuthenticatedPracticeReviewRequest,
): string {
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
  req: AuthenticatedPracticeReviewRequest,
  name: string,
): string | undefined {
  const raw = req?.headers?.[name];
  return typeof raw === 'string' ? raw : undefined;
}

function extractOptionalUuidHeader(
  req: AuthenticatedPracticeReviewRequest,
  name: string,
): string | undefined {
  const raw = readOptionalHeader(req, name);
  if (!raw || !UUID_PATTERN.test(raw.trim())) {
    return undefined;
  }
  return raw.trim();
}

/**
 * Controller exposing `C05` §14.8 AI Practice Review API (`EP-PR01`–`EP-PR03`).
 *
 * Protected by the global `APP_GUARD` pipeline (`SupabaseAuthGuard` + `AccessGuard`):
 * - Read routes (`EP-PR01`, `EP-PR02`) declare `@Policy({})` (`Gate: none`) so existing reviews
 *   remain readable when `ai_practice_review` is OFF.
 * - Write route (`EP-PR03`) requires `@Policy({ feature: 'ai_practice_review' })`.
 */
@Controller('practice-review')
@Policy({})
export class PracticeReviewController {
  constructor(
    @Inject(PracticeReviewService)
    private readonly practiceReviewService: PracticeReviewService,
  ) {}

  /**
   * `EP-PR01` (`GET /api/v1/practice-review`, `200 OK`, `Gate: none`).
   */
  @Get()
  @HttpCode(200)
  @Policy({})
  async listReviewsForAttempt(
    @Req() req: AuthenticatedPracticeReviewRequest,
    @Query() query: ListPracticeReviewsQueryDTO,
  ): Promise<PracticeReviewSummaryDTO[]> {
    const userId = assertAuthenticatedUserId(req);
    assertValidUuidParam(
      query?.quiz_attempt_id,
      'quiz_attempt_id',
      'quiz_attempt_id',
    );
    return this.practiceReviewService.listReviewsForAttempt(userId, query);
  }

  /**
   * `EP-PR02` (`GET /api/v1/practice-review/:id/feedback`, `200 OK`, `Gate: none`).
   */
  @Get(':id/feedback')
  @HttpCode(200)
  @Policy({})
  async getReviewFeedback(
    @Req() req: AuthenticatedPracticeReviewRequest,
    @Param('id') id: string,
  ): Promise<PracticeFeedbackDTO> {
    const userId = assertAuthenticatedUserId(req);
    const reviewId = assertValidUuidParam(id, 'id', 'Practice review id');
    return this.practiceReviewService.getReviewFeedback(userId, reviewId);
  }

  /**
   * `EP-PR03` (`POST /api/v1/practice-review/:id/review`, `200`/`202`, `Gate: write (ai_practice_review)`).
   */
  @Post(':id/review')
  @HttpCode(200)
  @Policy({ feature: 'ai_practice_review' })
  async triggerOrRetryReview(
    @Req() req: AuthenticatedPracticeReviewRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<PracticeFeedbackDTO | JobAcceptedDto> {
    const userId = assertAuthenticatedUserId(req);
    const reviewId = assertValidUuidParam(id, 'id', 'Practice review id');
    const httpRequestId = extractOptionalUuidHeader(req, 'x-request-id');
    const acceptLanguage = readOptionalHeader(req, 'accept-language');

    const outcome = await this.practiceReviewService.triggerOrRetryReview(
      userId,
      reviewId,
      {
        httpRequestId,
        acceptLanguage,
      },
    );
    if (res && typeof res.status === 'function') {
      res.status(outcome.statusCode);
    }
    return outcome.body;
  }
}

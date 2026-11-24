import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import { Policy } from '../../auth/policy.js';
import { fail } from '../../common/http.js';
import {
  RatingRequestDTO,
  ReportRequestDTO,
  UUID_PATTERN,
  type RatingResponseDTO,
  type ReportResponseDTO,
} from '../dto/feedback.dto.js';
import { FeedbackService } from '../services/feedback.service.js';

export interface AuthenticatedFeedbackRequest {
  user?: {
    sub?: string;
    sessionId?: string;
    status?: string;
  };
}

function assertAuthenticatedUserId(req: AuthenticatedFeedbackRequest): string {
  const userId = req?.user?.sub;
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId.trim())) {
    fail(401, 'AUTH_REQUIRED', 'Application account required');
  }
  return userId.trim().toLowerCase();
}

/**
 * Controller exposing `C05` §14.12 Feedback API (`EP-F01` `POST /api/v1/ratings`,
 * `EP-F02` `POST /api/v1/reports`).
 *
 * - Relies strictly on `AuthModule`'s global `APP_GUARD` pipeline (`SupabaseAuthGuard` -> `AccessGuard`)
 *   with `@Policy({})` (`AZ-USER`, `Gate: none`) — zero duplicate `@UseGuards`.
 */
@Controller()
@Policy({})
export class FeedbackController {
  constructor(
    @Inject(FeedbackService)
    private readonly feedbackService: FeedbackService,
  ) {}

  /**
   * `EP-F01` (`POST /api/v1/ratings`, `200 OK`, `AZ-USER`, `Gate: none`).
   */
  @Post('ratings')
  @HttpCode(HttpStatus.OK)
  @Policy({})
  async submitRating(
    @Req() req: AuthenticatedFeedbackRequest,
    @Body() dto: RatingRequestDTO,
  ): Promise<RatingResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    return this.feedbackService.submitRating(userId, dto);
  }

  /**
   * `EP-F02` (`POST /api/v1/reports`, `201 Created`, `AZ-USER`, `Gate: none`).
   */
  @Post('reports')
  @HttpCode(HttpStatus.CREATED)
  @Policy({})
  async submitReport(
    @Req() req: AuthenticatedFeedbackRequest,
    @Body() dto: ReportRequestDTO,
  ): Promise<ReportResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    return this.feedbackService.submitReport(userId, dto);
  }
}

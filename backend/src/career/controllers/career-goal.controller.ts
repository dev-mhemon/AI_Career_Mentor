import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccessGuard } from '../../auth/guards/access.guard.js';
import { SupabaseAuthGuard } from '../../auth/guards/supabase-auth.guard.js';
import { Policy } from '../../auth/policy.js';
import { fail } from '../../common/http.js';
import {
  CareerGoalCreateDTO,
  CareerGoalListQueryDTO,
  type CareerGoalResponseDTO,
  type DiscontinueCareerGoalResponseDTO,
  GoalClarificationDTO,
  GoalConfirmDTO,
} from '../dto/career-goal.dto.js';
import { CareerGoalService } from '../services/career-goal.service.js';

/** Strict UUID matcher for path parameter `:id` validation (`EP-C03`–`EP-C07`). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthenticatedCareerRequest {
  user?: {
    sub?: string;
    sessionId?: string;
    status?: string;
  };
}

function assertAuthenticatedUserId(req: AuthenticatedCareerRequest): string {
  const userId = req?.user?.sub;
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId.trim())) {
    fail(401, 'AUTH_REQUIRED', 'Application account required');
  }
  return userId.trim();
}

function assertValidGoalIdParam(id: string): string {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id.trim())) {
    fail(400, 'INVALID_FORMAT', 'Career goal id must be a valid UUID', [
      {
        field: 'id',
        code: 'INVALID_FORMAT',
        message: 'id must be a valid UUID',
      },
    ]);
  }
  return id.trim();
}

/**
 * Controller exposing `C05` §14.4 Career Goal API (`EP-C01`–`EP-C07` under `/api/v1/career/goals`).
 *
 * Explicitly binds `@UseGuards(SupabaseAuthGuard, AccessGuard)` (`SupabaseAuthGuard` first,
 * `AccessGuard` second):
 * - Write/AI/confirm routes (`EP-C01`, `EP-C04`, `EP-C05`, `EP-C06`) declare `@Policy({ feature: 'roadmap_generator' })`.
 * - Read and discontinue routes (`EP-C02`, `EP-C03`, `EP-C07`) declare `@Policy({})` (`Gate: none`) so users
 *   can inspect or discontinue goals even when generation flags are OFF (`PRD` §7).
 */
@Controller('career/goals')
@UseGuards(SupabaseAuthGuard, AccessGuard)
@Policy({})
export class CareerGoalController {
  constructor(private readonly careerGoalService: CareerGoalService) {}

  /**
   * `EP-C01` (`POST /api/v1/career/goals`, `201 Created`, `Gate: write (roadmap_generator)`):
   * Submits a free-text career goal and runs synchronous AI interpretation (`< 10s` budget).
   */
  @Post()
  @HttpCode(201)
  @Policy({ feature: 'roadmap_generator' })
  async createGoal(
    @Req() req: AuthenticatedCareerRequest,
    @Body() dto: CareerGoalCreateDTO,
  ): Promise<CareerGoalResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    return this.careerGoalService.createGoal(userId, dto);
  }

  /**
   * `EP-C02` (`GET /api/v1/career/goals`, `200 OK`, `Gate: none`):
   * Lists the authenticated user's career goals with optional `status` filter and cursor pagination (`PageMetaDTO`).
   *
   * When invoked through the NestJS HTTP runtime (`res` provided with `passthrough: true`), attaches `meta`
   * to the top-level JSON response envelope `{ success: true, data: [...], meta: { limit, next_cursor } }`
   * per `C05` §13.5 / §14.4 while returning the `CareerGoalResponseDTO[]` array (or `{ items, meta }` in direct unit calls).
   */
  @Get()
  @HttpCode(200)
  @Policy({})
  async listGoals(
    @Req() req: AuthenticatedCareerRequest,
    @Query() query?: CareerGoalListQueryDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<
    | CareerGoalResponseDTO[]
    | {
        items: CareerGoalResponseDTO[];
        meta: { limit: number; next_cursor: string | null };
      }
  > {
    const userId = assertAuthenticatedUserId(req);
    const result = await this.careerGoalService.listGoals(userId, query);
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
            meta: result.meta,
          });
        }
        return originalJson(body);
      }) as Response['json'];
      return result.items;
    }
    return result;
  }

  /**
   * `EP-C03` (`GET /api/v1/career/goals/:id`, `200 OK`, `Gate: none`):
   * Loads a single career goal owned by the authenticated caller.
   */
  @Get(':id')
  @HttpCode(200)
  @Policy({})
  async getGoal(
    @Req() req: AuthenticatedCareerRequest,
    @Param('id') id: string,
  ): Promise<CareerGoalResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const goalId = assertValidGoalIdParam(id);
    return this.careerGoalService.getGoal(userId, goalId);
  }

  /**
   * `EP-C04` (`POST /api/v1/career/goals/:id/clarifications`, `200 OK`, `Gate: write (roadmap_generator)`):
   * Submits an answer to the AI clarification question (up to 2 rounds; coerces to `awaiting_confirmation` on round 2).
   */
  @Post(':id/clarifications')
  @HttpCode(200)
  @Policy({ feature: 'roadmap_generator' })
  async answerClarification(
    @Req() req: AuthenticatedCareerRequest,
    @Param('id') id: string,
    @Body() dto: GoalClarificationDTO,
  ): Promise<CareerGoalResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const goalId = assertValidGoalIdParam(id);
    return this.careerGoalService.answerClarification(userId, goalId, dto);
  }

  /**
   * `EP-C05` (`POST /api/v1/career/goals/:id/confirm`, `200 OK`, `Gate: write (roadmap_generator)`):
   * Confirms the canonical role and target career level, atomically initializing level-scoped skill progress (`R07`).
   */
  @Post(':id/confirm')
  @HttpCode(200)
  @Policy({ feature: 'roadmap_generator' })
  async confirmGoal(
    @Req() req: AuthenticatedCareerRequest,
    @Param('id') id: string,
    @Body() dto: GoalConfirmDTO,
  ): Promise<CareerGoalResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const goalId = assertValidGoalIdParam(id);
    return this.careerGoalService.confirmGoal(userId, goalId, dto);
  }

  /**
   * `EP-C06` (`PATCH /api/v1/career/goals/:id`, `200 OK`, `Gate: write (roadmap_generator)`):
   * Rewords an unconfirmed career goal, resets clarification rounds, and re-interprets via AI Gateway.
   */
  @Patch(':id')
  @HttpCode(200)
  @Policy({ feature: 'roadmap_generator' })
  async updateGoal(
    @Req() req: AuthenticatedCareerRequest,
    @Param('id') id: string,
    @Body() dto: CareerGoalCreateDTO,
  ): Promise<CareerGoalResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const goalId = assertValidGoalIdParam(id);
    return this.careerGoalService.updateGoal(userId, goalId, dto);
  }

  /**
   * `EP-C07` (`DELETE /api/v1/career/goals/:id`, `200 OK`, `Gate: none`):
   * Discontinues a career goal, archives any linked roadmap safely (`is_focus = false` before promoting a replacement),
   * and preserves all historical evidence and skill progress.
   */
  @Delete(':id')
  @HttpCode(200)
  @Policy({})
  async discontinueGoal(
    @Req() req: AuthenticatedCareerRequest,
    @Param('id') id: string,
  ): Promise<DiscontinueCareerGoalResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const goalId = assertValidGoalIdParam(id);
    return this.careerGoalService.discontinueGoal(userId, goalId);
  }
}

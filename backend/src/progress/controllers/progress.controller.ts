import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Policy } from '../../auth/policy.js';
import { fail } from '../../common/http.js';
import type { PageMetaDTO } from '../../roadmap/dto/roadmap.dto.js';
import {
  GetProgressHistoryQueryDTO,
  GetProgressQueryDTO,
  GetSkillProgressDetailQueryDTO,
  type ProgressHistoryItemDTO,
  type ProgressResponseDTO,
  type SkillProgressDetailDTO,
} from '../dto/progress.dto.js';
import { ProgressService } from '../services/progress.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthenticatedProgressRequest {
  user?: {
    sub?: string;
    sessionId?: string;
    status?: string;
  };
  headers?: Record<string, string | string[] | undefined>;
}

function assertAuthenticatedUserId(req: AuthenticatedProgressRequest): string {
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
 * Controller exposing `C05` §14.9 Progress API (`EP-G01`, `EP-G02`, `EP-G03`).
 *
 * - Protected by the global `APP_GUARD` pipeline (`SupabaseAuthGuard` + `AccessGuard`).
 * - All routes declare `@Policy({})` (`Gate: none`) so existing progress remains readable
 *   even when generation or progress feature flags are disabled (`PRD` §7, `C05` §17.5).
 * - `EP-G04` (`EvidenceService.record`) is strictly internal — no `POST /progress/evidence` route exists (`R28`).
 */
@Controller('progress')
@Policy({})
export class ProgressController {
  constructor(
    @Inject(ProgressService)
    private readonly progressService: ProgressService,
  ) {}

  /**
   * `EP-G01` (`GET /api/v1/progress`, `200 OK`, `Gate: none`).
   */
  @Get()
  @HttpCode(200)
  @Policy({})
  async getProgress(
    @Req() req: AuthenticatedProgressRequest,
    @Query() query?: GetProgressQueryDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<
    ProgressResponseDTO | { data: ProgressResponseDTO; meta: PageMetaDTO }
  > {
    const userId = assertAuthenticatedUserId(req);
    const result = await this.progressService.getProgress(userId, query);
    return attachPaginationMeta(result.progress, result.meta, res);
  }

  /**
   * `EP-G02` (`GET /api/v1/progress/skills/:skill_id`, `200 OK`, `Gate: none`).
   */
  @Get('skills/:skill_id')
  @HttpCode(200)
  @Policy({})
  async getSkillProgressDetail(
    @Req() req: AuthenticatedProgressRequest,
    @Param('skill_id') skillId: string,
    @Query() query?: GetSkillProgressDetailQueryDTO,
  ): Promise<SkillProgressDetailDTO> {
    const userId = assertAuthenticatedUserId(req);
    const validSkillId = assertValidUuidParam(skillId, 'skill_id', 'Skill id');
    return this.progressService.getSkillProgressDetail(
      userId,
      validSkillId,
      query,
    );
  }

  /**
   * `EP-G03` (`GET /api/v1/progress/history`, `200 OK`, `Gate: none`).
   */
  @Get('history')
  @HttpCode(200)
  @Policy({})
  async getProgressHistory(
    @Req() req: AuthenticatedProgressRequest,
    @Query() query?: GetProgressHistoryQueryDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<
    | ProgressHistoryItemDTO[]
    | { data: ProgressHistoryItemDTO[]; meta: PageMetaDTO }
  > {
    const userId = assertAuthenticatedUserId(req);
    const result = await this.progressService.getProgressHistory(userId, query);
    return attachPaginationMeta(result.items, result.meta, res);
  }
}

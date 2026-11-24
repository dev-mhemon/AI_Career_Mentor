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
import {
  ListTechnologyUpdatesQueryDTO,
  type PageMetaDTO,
  type TechnologyUpdateDTO,
  type TechnologyUpdateListDTO,
  type TechnologyUpdateViewedDTO,
} from '../dto/technology-update.dto.js';
import { TechnologyUpdateService } from '../services/technology-update.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthenticatedTechnologyUpdateRequest {
  user?: {
    sub?: string;
    sessionId?: string;
    status?: string;
  };
}

function assertAuthenticatedUserId(
  req: AuthenticatedTechnologyUpdateRequest,
): string {
  const userId = req?.user?.sub;
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId.trim())) {
    fail(401, 'AUTH_REQUIRED', 'Application account required');
  }
  return userId.trim().toLowerCase();
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
 * Controller exposing `C05` §14.11 Technology Update API (`EP-T01`–`EP-T03` under `/api/v1/technology-updates`).
 *
 * - Relies on `AuthModule`'s global `APP_GUARD` pipeline (`SupabaseAuthGuard` -> `AccessGuard`).
 * - All 3 endpoints declare `@Policy({ feature: 'technology_update' })` (`Gate: read (technology_update)`),
 *   so disabled accounts receive `403 FEATURE_DISABLED` (`PRD` §7, §38).
 */
@Controller('technology-updates')
@Policy({ feature: 'technology_update' })
export class TechnologyUpdateController {
  constructor(
    @Inject(TechnologyUpdateService)
    private readonly technologyUpdateService: TechnologyUpdateService,
  ) {}

  /**
   * `EP-T01` (`GET /api/v1/technology-updates`, `200 OK`, `Gate: read (technology_update)`).
   */
  @Get()
  @HttpCode(200)
  @Policy({ feature: 'technology_update' })
  async listUpdates(
    @Req() req: AuthenticatedTechnologyUpdateRequest,
    @Query() query?: ListTechnologyUpdatesQueryDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<
    | TechnologyUpdateListDTO
    | { data: TechnologyUpdateListDTO; meta: PageMetaDTO }
  > {
    const userId = assertAuthenticatedUserId(req);
    const result = await this.technologyUpdateService.listUpdates(
      userId,
      query,
    );
    return attachPaginationMeta(result.data, result.meta, res);
  }

  /**
   * `EP-T02` (`GET /api/v1/technology-updates/{id}`, `200 OK`, `Gate: read (technology_update)`).
   */
  @Get(':id')
  @HttpCode(200)
  @Policy({ feature: 'technology_update' })
  async getUpdate(
    @Req() req: AuthenticatedTechnologyUpdateRequest,
    @Param('id') id: string,
  ): Promise<TechnologyUpdateDTO> {
    const userId = assertAuthenticatedUserId(req);
    return this.technologyUpdateService.getUpdate(userId, id);
  }

  /**
   * `EP-T03` (`POST /api/v1/technology-updates/{id}/view`, `200 OK`, `Gate: read (technology_update)`).
   */
  @Post(':id/view')
  @HttpCode(200)
  @Policy({ feature: 'technology_update' })
  async markUpdateViewed(
    @Req() req: AuthenticatedTechnologyUpdateRequest,
    @Param('id') id: string,
  ): Promise<TechnologyUpdateViewedDTO> {
    const userId = assertAuthenticatedUserId(req);
    return this.technologyUpdateService.markUpdateViewed(userId, id);
  }
}

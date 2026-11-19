import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
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
import type { EnqueuedJobAcceptedDto } from '../../jobs/services/job-producer.service.js';
import { IdempotencyService } from '../../jobs/services/idempotency.service.js';
import {
  ArchiveRoadmapDTO,
  type ArchiveRoadmapResponseDTO,
  type FocusSwitchResponseDTO,
  GenerateRoadmapRequestDTO,
  GetRoadmapQueryDTO,
  ListRoadmapsQueryDTO,
  ListRoadmapVersionsQueryDTO,
  LockRoadmapDTO,
  type LockRoadmapResponseDTO,
  type PageMetaDTO,
  RevisionRequestDTO,
  type RoadmapDetailDTO,
  type RoadmapSummaryDTO,
  type RoadmapVersionDTO,
} from '../dto/roadmap.dto.js';
import { RoadmapService } from '../services/roadmap.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INT_PATTERN = /^[1-9][0-9]*$/;
const IF_MATCH_VERSION_PATTERN = /^(?:W\/)?"?([1-9][0-9]*)"?$/;

export interface AuthenticatedRoadmapRequest {
  user?: {
    sub?: string;
    sessionId?: string;
    status?: string;
  };
  headers?: Record<string, string | string[] | undefined>;
}

function assertAuthenticatedUserId(req: AuthenticatedRoadmapRequest): string {
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

function assertPositiveIntParam(raw: string, field: string): number {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!POSITIVE_INT_PATTERN.test(trimmed)) {
    fail(400, 'INVALID_FORMAT', `${field} must be a positive integer`, [
      {
        field,
        code: 'INVALID_FORMAT',
        message: `${field} must be a positive integer`,
      },
    ]);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail(400, 'INVALID_FORMAT', `${field} must be a positive integer`, [
      {
        field,
        code: 'INVALID_FORMAT',
        message: `${field} must be a positive integer`,
      },
    ]);
  }
  return parsed;
}

function readOptionalHeader(
  req: AuthenticatedRoadmapRequest,
  name: string,
): string | undefined {
  const raw = req?.headers?.[name];
  return typeof raw === 'string' ? raw : undefined;
}

function extractOptionalUuidHeader(
  req: AuthenticatedRoadmapRequest,
  name: string,
): string | undefined {
  const raw = readOptionalHeader(req, name);
  if (!raw || !UUID_PATTERN.test(raw.trim())) {
    return undefined;
  }
  return raw.trim();
}

function parseOptionalIfMatchHeader(
  req: AuthenticatedRoadmapRequest,
): number | undefined {
  const raw = req?.headers?.['if-match'];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    fail(400, 'INVALID_FORMAT', 'If-Match header must be a positive integer', [
      {
        field: 'If-Match',
        code: 'INVALID_FORMAT',
        message: 'If-Match must be a positive integer version number',
      },
    ]);
  }
  const match = IF_MATCH_VERSION_PATTERN.exec(raw.trim());
  if (!match) {
    fail(400, 'INVALID_FORMAT', 'If-Match header must be a positive integer', [
      {
        field: 'If-Match',
        code: 'INVALID_FORMAT',
        message: 'If-Match must be a positive integer version number',
      },
    ]);
  }
  const parsed = Number(match[1]);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail(400, 'INVALID_FORMAT', 'If-Match header must be a positive integer', [
      {
        field: 'If-Match',
        code: 'INVALID_FORMAT',
        message: 'If-Match must be a positive integer version number',
      },
    ]);
  }
  return parsed;
}

function attachPaginationMeta<T>(
  items: T[],
  meta: PageMetaDTO,
  res?: Response,
): T[] | { items: T[]; meta: PageMetaDTO } {
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
    return items;
  }
  return { items, meta };
}

/**
 * Controller exposing `C05` §14.5 Roadmap API (`EP-R01`–`EP-R07`, `EP-R14`, `EP-R15`).
 *
 * Explicitly binds `@UseGuards(SupabaseAuthGuard, AccessGuard)` (`SupabaseAuthGuard` first,
 * `AccessGuard` second):
 * - Generation/revision/lock routes (`EP-R01`, `EP-R04`, `EP-R05`) require
 *   `@Policy({ feature: 'roadmap_generator' })` and `H-IDEM` via `IdempotencyService.execute(...)`.
 * - Read, focus switch, and archive routes (`EP-R02`, `EP-R03`, `EP-R06`, `EP-R07`, `EP-R14`, `EP-R15`)
 *   declare `@Policy({})` (`Gate: none`) so existing data remains usable when generation flags are OFF.
 */
@Controller('roadmaps')
@UseGuards(SupabaseAuthGuard, AccessGuard)
@Policy({})
export class RoadmapController {
  constructor(
    @Inject(RoadmapService) private readonly roadmapService: RoadmapService,
    @Inject(IdempotencyService)
    private readonly idempotencyService: IdempotencyService,
  ) {}

  /**
   * `EP-R01` (`POST /api/v1/roadmaps/generate`, `202 Accepted`, `H-IDEM`, `Gate: write (roadmap_generator)`).
   */
  @Post('generate')
  @HttpCode(202)
  @Policy({ feature: 'roadmap_generator' })
  async generateRoadmap(
    @Req() req: AuthenticatedRoadmapRequest,
    @Body() dto: GenerateRoadmapRequestDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<EnqueuedJobAcceptedDto> {
    const userId = assertAuthenticatedUserId(req);
    const idempotencyKeyHeader = req?.headers?.['idempotency-key'];
    const httpRequestId = extractOptionalUuidHeader(req, 'x-request-id');
    const acceptLanguage = readOptionalHeader(req, 'accept-language');

    const executed =
      await this.idempotencyService.execute<EnqueuedJobAcceptedDto>(
        {
          userId,
          idempotencyKey: idempotencyKeyHeader,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: dto ?? null,
        },
        async (execCtx) => {
          if (execCtx.signal.aborted) {
            fail(
              503,
              'SERVICE_UNAVAILABLE',
              'Idempotency reservation expired before mutation dispatch',
              undefined,
              true,
            );
          }
          const job = await this.roadmapService.generateRoadmap(userId, dto, {
            idempotencyKey: execCtx.idempotencyKey,
            httpRequestId,
            acceptLanguage,
          });
          return {
            statusCode: 202,
            responseBody: job,
          };
        },
      );

    if (res) {
      if (
        typeof res.setHeader === 'function' &&
        executed.responseBody.poll_url
      ) {
        res.setHeader('Location', executed.responseBody.poll_url);
      }
      if (typeof res.status === 'function') {
        res.status(executed.statusCode);
      }
    }
    return executed.responseBody;
  }

  /**
   * `EP-R02` (`GET /api/v1/roadmaps`, `200 OK`, `Gate: none`).
   */
  @Get()
  @HttpCode(200)
  @Policy({})
  async listRoadmaps(
    @Req() req: AuthenticatedRoadmapRequest,
    @Query() query?: ListRoadmapsQueryDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<
    RoadmapSummaryDTO[] | { items: RoadmapSummaryDTO[]; meta: PageMetaDTO }
  > {
    const userId = assertAuthenticatedUserId(req);
    const result = await this.roadmapService.listRoadmaps(userId, query);
    return attachPaginationMeta(result.items, result.meta, res);
  }

  /**
   * `EP-R07` (`GET /api/v1/roadmaps/:id/versions/:version_no`, `200 OK`, `Gate: none`).
   */
  @Get(':id/versions/:version_no')
  @HttpCode(200)
  @Policy({})
  async getVersion(
    @Req() req: AuthenticatedRoadmapRequest,
    @Param('id') id: string,
    @Param('version_no') versionNoParam: string,
  ): Promise<RoadmapDetailDTO> {
    const userId = assertAuthenticatedUserId(req);
    const roadmapId = assertValidUuidParam(id, 'id', 'Roadmap id');
    const versionNo = assertPositiveIntParam(versionNoParam, 'version_no');
    return this.roadmapService.getVersion(userId, roadmapId, versionNo);
  }

  /**
   * `EP-R06` (`GET /api/v1/roadmaps/:id/versions`, `200 OK`, `Gate: none`).
   */
  @Get(':id/versions')
  @HttpCode(200)
  @Policy({})
  async listVersions(
    @Req() req: AuthenticatedRoadmapRequest,
    @Param('id') id: string,
    @Query() query?: ListRoadmapVersionsQueryDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<
    RoadmapVersionDTO[] | { items: RoadmapVersionDTO[]; meta: PageMetaDTO }
  > {
    const userId = assertAuthenticatedUserId(req);
    const roadmapId = assertValidUuidParam(id, 'id', 'Roadmap id');
    const result = await this.roadmapService.listVersions(
      userId,
      roadmapId,
      query,
    );
    return attachPaginationMeta(result.items, result.meta, res);
  }

  /**
   * `EP-R03` (`GET /api/v1/roadmaps/:id`, `200 OK`, `Gate: none`).
   */
  @Get(':id')
  @HttpCode(200)
  @Policy({})
  async getRoadmap(
    @Req() req: AuthenticatedRoadmapRequest,
    @Param('id') id: string,
    @Query() query?: GetRoadmapQueryDTO,
  ): Promise<RoadmapDetailDTO> {
    const userId = assertAuthenticatedUserId(req);
    const roadmapId = assertValidUuidParam(id, 'id', 'Roadmap id');
    return this.roadmapService.getRoadmap(userId, roadmapId, query);
  }

  /**
   * `EP-R04` (`POST /api/v1/roadmaps/:id/revision`, `202 Accepted`, `H-IDEM`, `Gate: write (roadmap_generator)`).
   */
  @Post(':id/revision')
  @HttpCode(202)
  @Policy({ feature: 'roadmap_generator' })
  async requestRevision(
    @Req() req: AuthenticatedRoadmapRequest,
    @Param('id') id: string,
    @Body() dto: RevisionRequestDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<EnqueuedJobAcceptedDto> {
    const userId = assertAuthenticatedUserId(req);
    const roadmapId = assertValidUuidParam(id, 'id', 'Roadmap id');
    const idempotencyKeyHeader = req?.headers?.['idempotency-key'];
    const httpRequestId = extractOptionalUuidHeader(req, 'x-request-id');
    const acceptLanguage = readOptionalHeader(req, 'accept-language');
    const ifMatch = parseOptionalIfMatchHeader(req);

    const executed =
      await this.idempotencyService.execute<EnqueuedJobAcceptedDto>(
        {
          userId,
          idempotencyKey: idempotencyKeyHeader,
          method: 'POST',
          route: `/api/v1/roadmaps/${roadmapId.toLowerCase()}/revision`,
          body: dto ?? null,
        },
        async (execCtx) => {
          if (execCtx.signal.aborted) {
            fail(
              503,
              'SERVICE_UNAVAILABLE',
              'Idempotency reservation expired before mutation dispatch',
              undefined,
              true,
            );
          }
          const job = await this.roadmapService.requestRevision(
            userId,
            roadmapId,
            dto,
            {
              idempotencyKey: execCtx.idempotencyKey,
              httpRequestId,
              acceptLanguage,
              ifMatch,
            },
          );
          return {
            statusCode: 202,
            responseBody: job,
          };
        },
      );

    if (res) {
      if (
        typeof res.setHeader === 'function' &&
        executed.responseBody.poll_url
      ) {
        res.setHeader('Location', executed.responseBody.poll_url);
      }
      if (typeof res.status === 'function') {
        res.status(executed.statusCode);
      }
    }
    return executed.responseBody;
  }

  /**
   * `EP-R05` (`POST /api/v1/roadmaps/:id/lock`, `200 OK`, `H-IDEM`, `Gate: write (roadmap_generator)`).
   */
  @Post(':id/lock')
  @HttpCode(200)
  @Policy({ feature: 'roadmap_generator' })
  async lockRoadmap(
    @Req() req: AuthenticatedRoadmapRequest,
    @Param('id') id: string,
    @Body() dto?: LockRoadmapDTO,
  ): Promise<LockRoadmapResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const roadmapId = assertValidUuidParam(id, 'id', 'Roadmap id');
    const idempotencyKeyHeader = req?.headers?.['idempotency-key'];
    const httpRequestId = extractOptionalUuidHeader(req, 'x-request-id');
    const acceptLanguage = readOptionalHeader(req, 'accept-language');
    const ifMatch = parseOptionalIfMatchHeader(req);

    const executed =
      await this.idempotencyService.execute<LockRoadmapResponseDTO>(
        {
          userId,
          idempotencyKey: idempotencyKeyHeader,
          method: 'POST',
          route: `/api/v1/roadmaps/${roadmapId.toLowerCase()}/lock`,
          body: dto ?? {},
        },
        async (execCtx) => {
          if (execCtx.signal.aborted) {
            fail(
              503,
              'SERVICE_UNAVAILABLE',
              'Idempotency reservation expired before mutation dispatch',
              undefined,
              true,
            );
          }
          const result = await this.roadmapService.lockRoadmap(
            userId,
            roadmapId,
            dto ?? {},
            {
              idempotencyKey: execCtx.idempotencyKey,
              httpRequestId,
              acceptLanguage,
              ifMatch,
            },
          );
          return {
            statusCode: 200,
            responseBody: result,
          };
        },
      );

    return executed.responseBody;
  }

  /**
   * `EP-R14` (`POST /api/v1/roadmaps/:id/focus`, `200 OK`, `Gate: none`).
   */
  @Post(':id/focus')
  @HttpCode(200)
  @Policy({})
  async setFocus(
    @Req() req: AuthenticatedRoadmapRequest,
    @Param('id') id: string,
  ): Promise<FocusSwitchResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const roadmapId = assertValidUuidParam(id, 'id', 'Roadmap id');
    return this.roadmapService.setFocus(userId, roadmapId);
  }

  /**
   * `EP-R15` (`POST /api/v1/roadmaps/:id/archive`, `200 OK`, `Gate: none`).
   */
  @Post(':id/archive')
  @HttpCode(200)
  @Policy({})
  async archiveRoadmap(
    @Req() req: AuthenticatedRoadmapRequest,
    @Param('id') id: string,
    @Body() dto?: ArchiveRoadmapDTO,
  ): Promise<ArchiveRoadmapResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const roadmapId = assertValidUuidParam(id, 'id', 'Roadmap id');
    return this.roadmapService.archiveRoadmap(userId, roadmapId, dto);
  }
}

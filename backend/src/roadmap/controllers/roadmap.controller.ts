import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Logger,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
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
import {
  AcceptMergeProposalDTO,
  CreateMergeProposalDTO,
  ListMergeProposalsQueryDTO,
  type MergeAcceptResponseDTO,
  type MergeJobAcceptedDTO,
  type MergeProposalDTO,
  type MergeRejectResponseDTO,
  type MergeSummaryDTO,
  type MergeUndoResponseDTO,
} from '../dto/roadmap-merge.dto.js';
import { RoadmapMergeService } from '../services/roadmap-merge.service.js';
import { RoadmapService } from '../services/roadmap.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INT_PATTERN = /^[1-9][0-9]*$/;
const IF_MATCH_VERSION_PATTERN = /^(?:W\/)?"?([1-9][0-9]*)"?$/;
const PG_INT4_MAX = 2_147_483_647;

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
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > PG_INT4_MAX) {
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
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > PG_INT4_MAX) {
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
 * Controller exposing `C05` §14.5 Roadmap API (`EP-R01`–`EP-R15`).
 *
 * Protected by the global `APP_GUARD` pipeline (`SupabaseAuthGuard` then `AccessGuard`) registered
 * by `AuthModule` (no duplicate controller-level `@UseGuards` so `AccessGuard` runs once per request):
 * - Generation/revision/lock/merge-proposal/merge-accept routes (`EP-R01`, `EP-R04`, `EP-R05`,
 *   `EP-R08`, `EP-R11`) require `@Policy({ feature: 'roadmap_generator' })` and `H-IDEM` via
 *   `IdempotencyService.execute(...)`.
 * - Read, reject, undo, focus switch, and archive routes (`EP-R02`, `EP-R03`, `EP-R06`, `EP-R07`,
 *   `EP-R09`, `EP-R10`, `EP-R12`, `EP-R13`, `EP-R14`, `EP-R15`) declare `@Policy({})`
 *   (`Gate: none`) so existing data remains usable when generation flags are OFF.
 */
@Controller('roadmaps')
@Policy({})
export class RoadmapController {
  private readonly logger = new Logger(RoadmapController.name);

  constructor(
    @Inject(RoadmapService) private readonly roadmapService: RoadmapService,
    @Inject(IdempotencyService)
    private readonly idempotencyService: IdempotencyService,
    @Optional()
    @Inject(RoadmapMergeService)
    private readonly roadmapMergeService?: RoadmapMergeService,
  ) {}

  private getMergeService(): RoadmapMergeService {
    if (!this.roadmapMergeService) {
      fail(500, 'INTERNAL_ERROR', 'RoadmapMergeService is not configured');
    }
    return this.roadmapMergeService;
  }

  private logNonProdServerFailure(
    step: string,
    req: AuthenticatedRoadmapRequest,
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
        operation: step,
        errorName,
        status,
        code,
        requestId,
      }),
    );
  }

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

    let step = 'ep_r01.idempotency_execute';
    let executed;
    try {
      executed = await this.idempotencyService.execute<EnqueuedJobAcceptedDto>(
        {
          userId,
          idempotencyKey: idempotencyKeyHeader,
          method: 'POST',
          route: '/api/v1/roadmaps/generate',
          body: dto ?? null,
        },
        async (execCtx) => {
          if (execCtx.signal.aborted) {
            step = 'ep_r01.idempotency_reservation_expired';
            fail(
              503,
              'SERVICE_UNAVAILABLE',
              'Idempotency reservation expired before mutation dispatch',
              undefined,
              true,
            );
          }
          step = 'ep_r01.roadmap_service_generate';
          const job = await this.roadmapService.generateRoadmap(userId, dto, {
            idempotencyKey: execCtx.idempotencyKey,
            httpRequestId,
            acceptLanguage,
          });
          step = 'ep_r01.idempotency_complete';
          return {
            statusCode: 202,
            responseBody: job,
          };
        },
      );
    } catch (error) {
      this.logNonProdServerFailure(step, req, res, error);
      throw error;
    }

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
   * `EP-R10` (`GET /api/v1/roadmaps/:id/merges/:merge_id`, `200 OK`, `Gate: none`).
   */
  @Get(':id/merges/:merge_id')
  @HttpCode(200)
  @Policy({})
  async getMergeProposal(
    @Req() req: AuthenticatedRoadmapRequest,
    @Param('id') id: string,
    @Param('merge_id') mergeIdParam: string,
  ): Promise<MergeProposalDTO> {
    const userId = assertAuthenticatedUserId(req);
    const roadmapId = assertValidUuidParam(id, 'id', 'Roadmap id');
    const mergeId = assertValidUuidParam(
      mergeIdParam,
      'merge_id',
      'Merge proposal id',
    );
    return this.getMergeService().getProposal(userId, roadmapId, mergeId);
  }

  /**
   * `EP-R09` (`GET /api/v1/roadmaps/:id/merges`, `200 OK`, `Gate: none`).
   */
  @Get(':id/merges')
  @HttpCode(200)
  @Policy({})
  async listMergeProposals(
    @Req() req: AuthenticatedRoadmapRequest,
    @Param('id') id: string,
    @Query() query?: ListMergeProposalsQueryDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<
    MergeSummaryDTO[] | { items: MergeSummaryDTO[]; meta: PageMetaDTO }
  > {
    const userId = assertAuthenticatedUserId(req);
    const roadmapId = assertValidUuidParam(id, 'id', 'Roadmap id');
    const result = await this.getMergeService().listProposals(
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

    let step = 'ep_r04.idempotency_execute';
    let executed;
    try {
      executed = await this.idempotencyService.execute<EnqueuedJobAcceptedDto>(
        {
          userId,
          idempotencyKey: idempotencyKeyHeader,
          method: 'POST',
          route: `/api/v1/roadmaps/${roadmapId.toLowerCase()}/revision`,
          body: {
            payload: dto ?? null,
            if_match: ifMatch ?? null,
          },
        },
        async (execCtx) => {
          if (execCtx.signal.aborted) {
            step = 'ep_r04.idempotency_reservation_expired';
            fail(
              503,
              'SERVICE_UNAVAILABLE',
              'Idempotency reservation expired before mutation dispatch',
              undefined,
              true,
            );
          }
          step = 'ep_r04.roadmap_service_revision';
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
          step = 'ep_r04.idempotency_complete';
          return {
            statusCode: 202,
            responseBody: job,
          };
        },
      );
    } catch (error) {
      this.logNonProdServerFailure(step, req, res, error);
      throw error;
    }

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

    let step = 'ep_r05.idempotency_execute';
    let executed;
    try {
      executed = await this.idempotencyService.execute<LockRoadmapResponseDTO>(
        {
          userId,
          idempotencyKey: idempotencyKeyHeader,
          method: 'POST',
          route: `/api/v1/roadmaps/${roadmapId.toLowerCase()}/lock`,
          body: {
            payload: dto ?? {},
            if_match: ifMatch ?? null,
          },
        },
        async (execCtx) => {
          if (execCtx.signal.aborted) {
            step = 'ep_r05.idempotency_reservation_expired';
            fail(
              503,
              'SERVICE_UNAVAILABLE',
              'Idempotency reservation expired before mutation dispatch',
              undefined,
              true,
            );
          }
          step = 'ep_r05.roadmap_service_lock';
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
          step = 'ep_r05.idempotency_complete';
          return {
            statusCode: 200,
            responseBody: result,
          };
        },
      );
    } catch (error) {
      this.logNonProdServerFailure(step, req, undefined, error);
      throw error;
    }

    return executed.responseBody;
  }

  /**
   * `EP-R12` (`POST /api/v1/roadmaps/:id/merges/:merge_id/reject`, `200 OK`, `Gate: none`).
   */
  @Post(':id/merges/:merge_id/reject')
  @HttpCode(200)
  @Policy({})
  async rejectMergeProposal(
    @Req() req: AuthenticatedRoadmapRequest,
    @Param('id') id: string,
    @Param('merge_id') mergeIdParam: string,
  ): Promise<MergeRejectResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const roadmapId = assertValidUuidParam(id, 'id', 'Roadmap id');
    const mergeId = assertValidUuidParam(
      mergeIdParam,
      'merge_id',
      'Merge proposal id',
    );
    return this.getMergeService().rejectProposal(userId, roadmapId, mergeId);
  }

  /**
   * `EP-R08` (`POST /api/v1/roadmaps/:id/merges`, `202 Accepted`, `H-IDEM`, `Gate: write (roadmap_generator)`).
   */
  @Post(':id/merges')
  @HttpCode(202)
  @Policy({ feature: 'roadmap_generator' })
  async createMergeProposal(
    @Req() req: AuthenticatedRoadmapRequest,
    @Param('id') id: string,
    @Body() dto: CreateMergeProposalDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<MergeJobAcceptedDTO> {
    const userId = assertAuthenticatedUserId(req);
    const roadmapId = assertValidUuidParam(id, 'id', 'Roadmap id');
    const idempotencyKeyHeader = req?.headers?.['idempotency-key'];
    const httpRequestId = extractOptionalUuidHeader(req, 'x-request-id');
    const acceptLanguage = readOptionalHeader(req, 'accept-language');
    const ifMatch = parseOptionalIfMatchHeader(req);

    let step = 'ep_r08.idempotency_execute';
    let executed;
    try {
      executed = await this.idempotencyService.execute<MergeJobAcceptedDTO>(
        {
          userId,
          idempotencyKey: idempotencyKeyHeader,
          method: 'POST',
          route: `/api/v1/roadmaps/${roadmapId.toLowerCase()}/merges`,
          body: {
            payload: dto ?? null,
            if_match: ifMatch ?? null,
          },
        },
        async (execCtx) => {
          if (execCtx.signal.aborted) {
            step = 'ep_r08.idempotency_reservation_expired';
            fail(
              503,
              'SERVICE_UNAVAILABLE',
              'Idempotency reservation expired before mutation dispatch',
              undefined,
              true,
            );
          }
          step = 'ep_r08.roadmap_merge_service_create';
          const job = await this.getMergeService().createProposal(
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
          step = 'ep_r08.idempotency_complete';
          return {
            statusCode: 202,
            responseBody: job,
          };
        },
      );
    } catch (error) {
      this.logNonProdServerFailure(step, req, res, error);
      throw error;
    }

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
   * `EP-R13` (`POST /api/v1/roadmaps/:id/merges/undo`, `200 OK`, `H-IDEM`, `Gate: none`).
   */
  @Post(':id/merges/undo')
  @HttpCode(200)
  @Policy({})
  async undoLastMerge(
    @Req() req: AuthenticatedRoadmapRequest,
    @Param('id') id: string,
  ): Promise<MergeUndoResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const roadmapId = assertValidUuidParam(id, 'id', 'Roadmap id');
    const ifMatch = parseOptionalIfMatchHeader(req);
    const idempotencyKeyHeader = req?.headers?.['idempotency-key'];

    let step = 'ep_r13.idempotency_execute';
    let executed;
    try {
      executed = await this.idempotencyService.execute<MergeUndoResponseDTO>(
        {
          userId,
          idempotencyKey: idempotencyKeyHeader,
          method: 'POST',
          route: `/api/v1/roadmaps/${roadmapId.toLowerCase()}/merges/undo`,
          body: { if_match: ifMatch ?? null },
        },
        async (execCtx) => {
          if (execCtx.signal.aborted) {
            step = 'ep_r13.idempotency_reservation_expired';
            fail(
              503,
              'SERVICE_UNAVAILABLE',
              'Idempotency reservation expired before mutation dispatch',
              undefined,
              true,
            );
          }
          step = 'ep_r13.roadmap_merge_service_undo';
          const result = await this.getMergeService().undoLastMerge(
            userId,
            roadmapId,
            { ifMatch },
          );
          step = 'ep_r13.idempotency_complete';
          return { statusCode: 200, responseBody: result };
        },
      );
    } catch (error) {
      this.logNonProdServerFailure(step, req, undefined, error);
      throw error;
    }
    return executed.responseBody;
  }

  /**
   * `EP-R11` (`POST /api/v1/roadmaps/:id/merges/:merge_id/accept`, `200 OK`, `H-IDEM`, `Gate: write (roadmap_generator)`).
   */
  @Post(':id/merges/:merge_id/accept')
  @HttpCode(200)
  @Policy({ feature: 'roadmap_generator' })
  async acceptMergeProposal(
    @Req() req: AuthenticatedRoadmapRequest,
    @Param('id') id: string,
    @Param('merge_id') mergeIdParam: string,
    @Body() dto?: AcceptMergeProposalDTO,
  ): Promise<MergeAcceptResponseDTO> {
    const userId = assertAuthenticatedUserId(req);
    const roadmapId = assertValidUuidParam(id, 'id', 'Roadmap id');
    const mergeId = assertValidUuidParam(
      mergeIdParam,
      'merge_id',
      'Merge proposal id',
    );
    const idempotencyKeyHeader = req?.headers?.['idempotency-key'];
    const httpRequestId = extractOptionalUuidHeader(req, 'x-request-id');
    const acceptLanguage = readOptionalHeader(req, 'accept-language');
    const ifMatch = parseOptionalIfMatchHeader(req);

    let step = 'ep_r11.idempotency_execute';
    let executed;
    try {
      executed = await this.idempotencyService.execute<MergeAcceptResponseDTO>(
        {
          userId,
          idempotencyKey: idempotencyKeyHeader,
          method: 'POST',
          route: `/api/v1/roadmaps/${roadmapId.toLowerCase()}/merges/${mergeId.toLowerCase()}/accept`,
          body: { payload: dto ?? {}, if_match: ifMatch ?? null },
        },
        async (execCtx) => {
          if (execCtx.signal.aborted) {
            step = 'ep_r11.idempotency_reservation_expired';
            fail(
              503,
              'SERVICE_UNAVAILABLE',
              'Idempotency reservation expired before mutation dispatch',
              undefined,
              true,
            );
          }
          step = 'ep_r11.roadmap_merge_service_accept';
          const result = await this.getMergeService().acceptProposal(
            userId,
            roadmapId,
            mergeId,
            dto ?? {},
            {
              idempotencyKey: execCtx.idempotencyKey,
              httpRequestId,
              acceptLanguage,
              ifMatch,
            },
          );
          step = 'ep_r11.idempotency_complete';
          return { statusCode: 200, responseBody: result };
        },
      );
    } catch (error) {
      this.logNonProdServerFailure(step, req, undefined, error);
      throw error;
    }
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

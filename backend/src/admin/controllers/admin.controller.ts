import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { trustedClientIp } from '../../auth/client-ip.js';
import { Policy } from '../../auth/policy.js';
import { fail } from '../../common/http.js';
import {
  AdminAuditLogQueryDTO,
  AdminListUsersQueryDTO,
  type AdminMutationAuditContext,
  AdminUsageQueryDTO,
  type AdminUserDetailDTO,
  AdminUserStatusDTO,
  type AdminUserSummaryDTO,
  type AuditLogDTO,
  type FeatureControlDTO,
  FeatureToggleDTO,
  type PageMetaDTO,
  type UsageSummaryDTO,
  UserFeatureToggleDTO,
  UUID_PATTERN,
} from '../dto/admin.dto.js';
import { AdminUserService } from '../services/admin-user.service.js';
import { AuditService } from '../services/audit.service.js';
import { FeatureControlService } from '../services/feature-control.service.js';
import { UsageService } from '../services/usage.service.js';

export interface AuthenticatedAdminRequest extends Request {
  user?: {
    sub?: string;
    sessionId?: string;
    status?: string;
  };
}

function assertAuthenticatedAdminId(req: AuthenticatedAdminRequest): string {
  const userId = req?.user?.sub;
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId.trim())) {
    fail(401, 'AUTH_REQUIRED', 'Application account required');
  }
  return userId.trim().toLowerCase();
}

function extractAuditContext(
  req: AuthenticatedAdminRequest,
  res?: Response,
): AdminMutationAuditContext {
  const headerFromRes =
    res && typeof res.getHeader === 'function'
      ? res.getHeader('X-Request-Id')
      : undefined;
  const headerFromReq = req?.headers?.['x-request-id'];
  const candidateRequestId =
    typeof headerFromRes === 'string'
      ? headerFromRes.trim()
      : typeof headerFromReq === 'string'
        ? headerFromReq.trim()
        : null;
  const requestId =
    candidateRequestId && UUID_PATTERN.test(candidateRequestId)
      ? candidateRequestId.toLowerCase()
      : null;

  let ipAddress: string | null;
  try {
    ipAddress = trustedClientIp(req);
  } catch {
    ipAddress = null;
  }

  return { requestId, ipAddress };
}

function attachPaginationMeta<T>(
  payload: T,
  meta: PageMetaDTO,
  res?: Response,
): T | { items: T; meta: PageMetaDTO } {
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
  return { items: payload, meta };
}

/**
 * Controller exposing `C05` §14.14 Admin API (`EP-AD01`–`EP-AD08` under `/api/v1/admin`).
 *
 * - Relies exclusively on `AuthModule`'s global `APP_GUARD` pipeline (`SupabaseAuthGuard` -> `AccessGuard`)
 *   with `@Policy({ admin: true })` (`AZ-ADMIN`, Gate: none, zero duplicate `@UseGuards`).
 * - Admin privileges are verified server-side against `public.admin_users` (`role = 'platform_admin'`).
 * - Zero endpoints expose private mentor messages, summaries, AI context, or raw practice answers (`PRD §51`).
 */
@Controller('admin')
@Policy({ admin: true })
export class AdminController {
  constructor(
    @Inject(AdminUserService)
    private readonly adminUserService: AdminUserService,
    @Inject(FeatureControlService)
    private readonly featureControlService: FeatureControlService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Inject(UsageService)
    private readonly usageService: UsageService,
  ) {}

  /**
   * `EP-AD01` (`GET /api/v1/admin/users`, `200 OK`).
   */
  @Get('users')
  @HttpCode(200)
  @Policy({ admin: true })
  async listUsers(
    @Req() req: AuthenticatedAdminRequest,
    @Query() query?: AdminListUsersQueryDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<
    AdminUserSummaryDTO[] | { items: AdminUserSummaryDTO[]; meta: PageMetaDTO }
  > {
    const actorId = assertAuthenticatedAdminId(req);
    const result = await this.adminUserService.listUsers(actorId, query);
    return attachPaginationMeta(result.items, result.meta, res);
  }

  /**
   * `EP-AD02` (`GET /api/v1/admin/users/:id`, `200 OK`).
   */
  @Get('users/:id')
  @HttpCode(200)
  @Policy({ admin: true })
  async getUser(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
  ): Promise<AdminUserDetailDTO> {
    const actorId = assertAuthenticatedAdminId(req);
    return this.adminUserService.getUserDetail(actorId, id);
  }

  /**
   * `EP-AD03` (`PATCH /api/v1/admin/users/:id`, `200 OK`).
   */
  @Patch('users/:id')
  @HttpCode(200)
  @Policy({ admin: true })
  async updateUserStatus(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: AdminUserStatusDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<AdminUserDetailDTO> {
    const actorId = assertAuthenticatedAdminId(req);
    return this.adminUserService.updateUserStatus(
      actorId,
      id,
      dto,
      extractAuditContext(req, res),
    );
  }

  /**
   * `EP-AD04` (`GET /api/v1/admin/features`, `200 OK`).
   */
  @Get('features')
  @HttpCode(200)
  @Policy({ admin: true })
  async listGlobalFeatures(
    @Req() req: AuthenticatedAdminRequest,
  ): Promise<FeatureControlDTO[]> {
    const actorId = assertAuthenticatedAdminId(req);
    return this.featureControlService.listGlobalFeatures(actorId);
  }

  /**
   * `EP-AD05` (`PATCH /api/v1/admin/features`, `200 OK`).
   */
  @Patch('features')
  @HttpCode(200)
  @Policy({ admin: true })
  async setGlobalFeature(
    @Req() req: AuthenticatedAdminRequest,
    @Body() dto: FeatureToggleDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<FeatureControlDTO> {
    const actorId = assertAuthenticatedAdminId(req);
    return this.featureControlService.setGlobalFeature(
      actorId,
      dto,
      extractAuditContext(req, res),
    );
  }

  /**
   * `EP-AD06` (`PATCH /api/v1/admin/users/:id/features`, `200 OK`).
   */
  @Patch('users/:id/features')
  @HttpCode(200)
  @Policy({ admin: true })
  async setUserFeature(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: UserFeatureToggleDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<AdminUserDetailDTO> {
    const actorId = assertAuthenticatedAdminId(req);
    return this.featureControlService.setUserFeature(
      actorId,
      id,
      dto,
      extractAuditContext(req, res),
    );
  }

  /**
   * `EP-AD07` (`GET /api/v1/admin/audit-logs`, `200 OK`).
   */
  @Get('audit-logs')
  @HttpCode(200)
  @Policy({ admin: true })
  async listAuditLogs(
    @Req() req: AuthenticatedAdminRequest,
    @Query() query?: AdminAuditLogQueryDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<AuditLogDTO[] | { items: AuditLogDTO[]; meta: PageMetaDTO }> {
    const actorId = assertAuthenticatedAdminId(req);
    const result = await this.auditService.listAuditLogs(actorId, query);
    return attachPaginationMeta(result.items, result.meta, res);
  }

  /**
   * `EP-AD08` (`GET /api/v1/admin/usage`, `200 OK`).
   */
  @Get('usage')
  @HttpCode(200)
  @Policy({ admin: true })
  async getUsageSummary(
    @Req() req: AuthenticatedAdminRequest,
    @Query() query?: AdminUsageQueryDTO,
  ): Promise<UsageSummaryDTO> {
    const actorId = assertAuthenticatedAdminId(req);
    return this.usageService.getUsageSummary(actorId, query);
  }
}

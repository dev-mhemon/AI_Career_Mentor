import {
  Controller,
  Get,
  HttpCode,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccessGuard } from '../../auth/guards/access.guard.js';
import { SupabaseAuthGuard } from '../../auth/guards/supabase-auth.guard.js';
import { Policy } from '../../auth/policy.js';
import { fail } from '../../common/http.js';
import type { JobStatusDto } from '../dto/job-status.dto.js';
import { JobService } from '../services/job.service.js';

/** Strict UUID matcher for path parameter `:id` validation (`EP-J01`). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthenticatedJobRequest {
  user?: {
    sub?: string;
    sessionId?: string;
    status?: string;
  };
}

/**
 * Controller exposing `C05` §14.13 Jobs API (`EP-J01` `GET /api/v1/jobs/:id`).
 *
 * Explicitly binds `@UseGuards(SupabaseAuthGuard, AccessGuard)` (`SupabaseAuthGuard` first,
 * `AccessGuard` second) with `@Policy({})` (`AZ-USER`, `Gate: none` so authenticated owners
 * can poll existing jobs even when AI generation feature flags are disabled).
 */
@Controller('jobs')
@UseGuards(SupabaseAuthGuard, AccessGuard)
@Policy({})
export class JobsController {
  constructor(private readonly jobService: JobService) {}

  /**
   * `EP-J01` (`GET /api/v1/jobs/:id`):
   * Returns the status of an asynchronous AI job belonging to the authenticated caller.
   *
   * @param req - Authenticated request carrying `req.user.sub`.
   * @param id - Job UUID path parameter.
   * @returns `200 OK` with `JobStatusDto`.
   */
  @Get(':id')
  @HttpCode(200)
  async getJobStatus(
    @Req() req: AuthenticatedJobRequest,
    @Param('id') id: string,
  ): Promise<JobStatusDto> {
    const userId = req?.user?.sub;
    if (!userId) {
      fail(401, 'AUTH_REQUIRED', 'Application account required');
    }
    if (typeof id !== 'string' || !UUID_PATTERN.test(id.trim())) {
      fail(400, 'INVALID_FORMAT', 'Job id must be a valid UUID', [
        {
          field: 'id',
          code: 'INVALID_FORMAT',
          message: 'id must be a valid UUID',
        },
      ]);
    }
    return this.jobService.getJobStatus(userId, id.trim());
  }
}

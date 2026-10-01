import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard.js';
import { StatusGuard } from '../guards/status.guard.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { CurrentUser } from '../decorators/current-user.decorator.js';
import { SkipStatusCheck } from '../decorators/skip-status-check.decorator.js';
import { AuthService } from '../services/auth.service.js';
import type { JwtIdentity } from '../services/auth.service.js';
import { VerifyInvitationDto } from '../dtos/verify-invitation.dto.js';
import { UserResponseDto } from '../dtos/user-response.dto.js';

/**
 * Authentication & invitation endpoints.
 *
 * Plan v1.2 §4 defines three routes:
 *  - POST /api/auth/sync
 *  - GET  /api/auth/me
 *  - POST /api/auth/invitation/verify
 *
 * All three require a valid Supabase JWT (SupabaseAuthGuard).
 * StatusGuard and RolesGuard run after auth for standard routes;
 * the three auth routes use @SkipStatusCheck() so PENDING_INVITE
 * users can still call them.
 */
@Controller('auth')
@UseGuards(SupabaseAuthGuard, StatusGuard, RolesGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/auth/sync
   *
   * Frontend-triggered user synchronisation.
   * Creates a local User record on first call; updates
   * Supabase-controlled fields on subsequent calls.
   * Does NOT require an existing local User (the strategy
   * returns the raw JWT identity, not a DB entity).
   */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @SkipStatusCheck()
  async sync(@CurrentUser() identity: JwtIdentity): Promise<UserResponseDto> {
    const user = await this.authService.syncUser(identity);
    return UserResponseDto.fromEntity(user);
  }

  /**
   * GET /api/auth/me
   *
   * Returns the current application-level user.
   * Allowed for PENDING_INVITE users so the frontend can
   * check status before prompting for an invite code.
   */
  @Get('me')
  @SkipStatusCheck()
  async me(@CurrentUser() identity: JwtIdentity): Promise<UserResponseDto> {
    const user = await this.authService.findBySupabaseUid(
      identity.supabase_uid,
    );
    if (!user) {
      throw new NotFoundException(
        'User not found. Please call /api/auth/sync first.',
      );
    }
    return UserResponseDto.fromEntity(user);
  }

  /**
   * POST /api/auth/invitation/verify
   *
   * Verifies an invitation code and activates the user account.
   * Rate-limited per Plan v1.2 §5.
   */
  @Post('invitation/verify')
  @HttpCode(HttpStatus.OK)
  @SkipStatusCheck()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async verifyInvitation(
    @CurrentUser() identity: JwtIdentity,
    @Body() dto: VerifyInvitationDto,
  ): Promise<UserResponseDto> {
    const user = await this.authService.verifyInvitation(
      identity.supabase_uid,
      dto.code,
    );
    return UserResponseDto.fromEntity(user);
  }
}

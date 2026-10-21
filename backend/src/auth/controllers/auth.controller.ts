import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard.js';
import { StatusGuard } from '../guards/status.guard.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { CurrentUser } from '../decorators/current-user.decorator.js';
import { SkipStatusCheck } from '../decorators/skip-status-check.decorator.js';
import { AuthService } from '../services/auth.service.js';
import type { JwtIdentity } from '../services/auth.service.js';
import { UserResponseDto } from '../dtos/user-response.dto.js';

/**
 * Authentication endpoints.
 *
 * Plan v1.3 defines two routes:
 *  - POST /api/auth/sync
 *  - GET  /api/auth/me
 *
 * Both require a valid Supabase JWT (SupabaseAuthGuard).
 * StatusGuard and RolesGuard run after auth for standard routes;
 * the auth routes use @SkipStatusCheck() so newly authenticated
 * users can still call them before having a full active profile.
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
}

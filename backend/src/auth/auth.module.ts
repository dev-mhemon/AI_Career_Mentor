import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity.js';
import { InvitationCode } from '../invitation-codes/entities/invitation-code.entity.js';
import { SupabaseStrategy } from './strategies/supabase.strategy.js';
import { AuthService } from './services/auth.service.js';
import { AuthController } from './controllers/auth.controller.js';

/**
 * AuthModule — Phase 1 Authentication & Access Control.
 *
 * Wires together:
 *  - PassportModule for JWT validation
 *  - SupabaseStrategy for token verification
 *  - AuthService for business logic
 *  - AuthController for HTTP endpoints
 *  - TypeOrmModule for User and InvitationCode repositories
 *
 * Guards (SupabaseAuthGuard, StatusGuard, RolesGuard) are not
 * registered as global providers — they are applied via
 * @UseGuards() on the controller to keep scope explicit.
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'supabase' }),
    TypeOrmModule.forFeature([User, InvitationCode]),
  ],
  controllers: [AuthController],
  providers: [SupabaseStrategy, AuthService],
  exports: [AuthService],
})
export class AuthModule {}

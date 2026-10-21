import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { SupabaseStrategy } from './strategies/supabase.strategy.js';
import { AuthService } from './services/auth.service.js';
import { AuthController } from './controllers/auth.controller.js';
import { SupabaseAuthGuard } from './guards/supabase-auth.guard.js';
import { AccessGuard } from './guards/access.guard.js';
import { DatabaseService } from './services/database.service.js';
import { ProfileController } from '../profile/profile.controller.js';
import { ProfileService } from '../profile/profile.service.js';
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'supabase' })],
  controllers: [AuthController, ProfileController],
  providers: [
    SupabaseStrategy,
    AuthService,
    DatabaseService,
    ProfileService,
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AuthModule {}

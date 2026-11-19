import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CareerGoalController } from './controllers/career-goal.controller.js';
import { CareerGoalService } from './services/career-goal.service.js';

/**
 * Career Intelligence module (`C05` §14.4 `EP-C01`–`EP-C07`).
 *
 * Imports `AuthModule` (for shared `DatabaseService`, `ProfileService`, `SupabaseAuthGuard`, and `AccessGuard`)
 * and `AiModule` (for `AiGatewayService` synchronous `goal_interpretation` execution).
 */
@Module({
  imports: [AuthModule, AiModule],
  controllers: [CareerGoalController],
  providers: [CareerGoalService],
  exports: [CareerGoalService],
})
export class CareerModule {}

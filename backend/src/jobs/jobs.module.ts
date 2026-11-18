import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { JobsController } from './controllers/jobs.controller.js';
import { IdempotencyService } from './services/idempotency.service.js';
import { JobService } from './services/job.service.js';

/**
 * NestJS module encapsulating `EP-J01` (`GET /api/v1/jobs/:id`, C05 §14.13)
 * and Redis 24h `H-IDEM` Replay Controls with the `R14` Loss-Epoch Fail-Closed Barrier.
 */
@Module({
  imports: [AuthModule],
  controllers: [JobsController],
  providers: [JobService, IdempotencyService],
  exports: [JobService, IdempotencyService],
})
export class JobsModule {}

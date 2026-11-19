import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { JobsController } from './controllers/jobs.controller.js';
import { IdempotencyService } from './services/idempotency.service.js';
import { JobProducerService } from './services/job-producer.service.js';
import { JobReaperService } from './services/job-reaper.service.js';
import { JobService } from './services/job.service.js';
import { PostgresJobQueueConsumer } from './services/postgres-job-queue.consumer.js';

/**
 * NestJS module encapsulating `EP-J01` (`GET /api/v1/jobs/:id`, C05 §14.13),
 * Redis 24h `H-IDEM` Replay Controls with the `R14` Loss-Epoch Fail-Closed Barrier,
 * and durable PostgreSQL `FOR UPDATE SKIP LOCKED` job producer, consumer, and reaper (`R12`, `R13`, `ADR-017`).
 */
@Module({
  imports: [AuthModule],
  controllers: [JobsController],
  providers: [
    JobService,
    IdempotencyService,
    JobProducerService,
    PostgresJobQueueConsumer,
    JobReaperService,
  ],
  exports: [
    JobService,
    IdempotencyService,
    JobProducerService,
    PostgresJobQueueConsumer,
    JobReaperService,
  ],
})
export class JobsModule {}

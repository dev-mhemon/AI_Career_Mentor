import { Inject, Module } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { AccountModule } from '../account/account.module.js';
import { AiModule } from '../ai/ai.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { PostgresJobQueueConsumer } from '../jobs/services/postgres-job-queue.consumer.js';
import { ProgressModule } from '../progress/progress.module.js';
import { PracticeReviewController } from './controllers/practice-review.controller.js';
import {
  PracticeReviewJobHandler,
  SUPPORTED_PRACTICE_REVIEW_JOB_KINDS,
} from './services/practice-review-job.handler.js';
import { PracticeReviewService } from './services/practice-review.service.js';

/**
 * Practice Review module (`C05` §14.8 `EP-PR01`–`EP-PR03` and async `PracticeReviewJobHandler`).
 *
 * Registers `PracticeReviewJobHandler` for `practice_review` on the shared `PostgresJobQueueConsumer`.
 */
@Module({
  imports: [AuthModule, AccountModule, AiModule, JobsModule, ProgressModule],
  controllers: [PracticeReviewController],
  providers: [PracticeReviewJobHandler, PracticeReviewService],
  exports: [PracticeReviewJobHandler, PracticeReviewService],
})
export class PracticeReviewModule implements OnModuleInit {
  constructor(
    @Inject(PracticeReviewJobHandler)
    private readonly practiceReviewJobHandler: PracticeReviewJobHandler,
    @Inject(PostgresJobQueueConsumer)
    private readonly jobQueueConsumer: PostgresJobQueueConsumer,
  ) {}

  onModuleInit(): void {
    if (typeof this.jobQueueConsumer.registerHandler === 'function') {
      for (const kind of SUPPORTED_PRACTICE_REVIEW_JOB_KINDS) {
        this.jobQueueConsumer.registerHandler(
          kind,
          this.practiceReviewJobHandler,
        );
      }
      if (
        typeof this.jobQueueConsumer.start === 'function' &&
        process.env.NODE_ENV !== 'test' &&
        !process.env.VITEST
      ) {
        this.jobQueueConsumer.start();
      }
    }
  }
}

import { Inject, Module } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { PostgresJobQueueConsumer } from '../jobs/services/postgres-job-queue.consumer.js';
import { LearningController } from './controllers/learning.controller.js';
import { DailyPlanService } from './services/daily-plan.service.js';
import { TodayService } from './services/today.service.js';
import {
  SUPPORTED_LEARNING_JOB_KINDS,
  TopicContentJobHandler,
} from './services/topic-content-job.handler.js';
import { TopicContentService } from './services/topic-content.service.js';

/**
 * Learning module (`C05` §14.6 `EP-L01`–`EP-L07` and async `TopicContentJobHandler`).
 *
 * Registers `TopicContentJobHandler` for `topic_content` on the shared `PostgresJobQueueConsumer`
 * without starting duplicate poll loops (`start()` is idempotent).
 */
@Module({
  imports: [AuthModule, AiModule, JobsModule],
  controllers: [LearningController],
  providers: [
    DailyPlanService,
    TodayService,
    TopicContentService,
    TopicContentJobHandler,
  ],
  exports: [
    DailyPlanService,
    TodayService,
    TopicContentService,
    TopicContentJobHandler,
  ],
})
export class LearningModule implements OnModuleInit {
  constructor(
    @Inject(TopicContentJobHandler)
    private readonly topicContentJobHandler: TopicContentJobHandler,
    @Inject(PostgresJobQueueConsumer)
    private readonly jobQueueConsumer: PostgresJobQueueConsumer,
  ) {}

  onModuleInit(): void {
    if (typeof this.jobQueueConsumer.registerHandler === 'function') {
      for (const kind of SUPPORTED_LEARNING_JOB_KINDS) {
        this.jobQueueConsumer.registerHandler(
          kind,
          this.topicContentJobHandler,
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

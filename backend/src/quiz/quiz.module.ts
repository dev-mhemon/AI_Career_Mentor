import { Inject, Module } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { AccountModule } from '../account/account.module.js';
import { AiModule } from '../ai/ai.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { PostgresJobQueueConsumer } from '../jobs/services/postgres-job-queue.consumer.js';
import { LearningModule } from '../learning/learning.module.js';
import { ProgressModule } from '../progress/progress.module.js';
import { QuizController } from './controllers/quiz.controller.js';
import {
  QuizGenerateJobHandler,
  SUPPORTED_QUIZ_JOB_KINDS,
} from './services/quiz-generate-job.handler.js';
import { QuizGradingService } from './services/quiz-grading.service.js';
import { QuizService } from './services/quiz.service.js';

/**
 * Quiz module (`C05` §14.7 `EP-Q01`–`EP-Q07` and async `QuizGenerateJobHandler`).
 *
 * Registers `QuizGenerateJobHandler` for `quiz_generate` on the shared `PostgresJobQueueConsumer`.
 */
@Module({
  imports: [
    AuthModule,
    AccountModule,
    AiModule,
    JobsModule,
    LearningModule,
    ProgressModule,
  ],
  controllers: [QuizController],
  providers: [QuizGradingService, QuizGenerateJobHandler, QuizService],
  exports: [QuizGradingService, QuizGenerateJobHandler, QuizService],
})
export class QuizModule implements OnModuleInit {
  constructor(
    @Inject(QuizGenerateJobHandler)
    private readonly quizGenerateJobHandler: QuizGenerateJobHandler,
    @Inject(PostgresJobQueueConsumer)
    private readonly jobQueueConsumer: PostgresJobQueueConsumer,
  ) {}

  onModuleInit(): void {
    if (typeof this.jobQueueConsumer.registerHandler === 'function') {
      for (const kind of SUPPORTED_QUIZ_JOB_KINDS) {
        this.jobQueueConsumer.registerHandler(
          kind,
          this.quizGenerateJobHandler,
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

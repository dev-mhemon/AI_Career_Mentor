import { Inject, Module, Optional } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import {
  PostgresJobQueueConsumer,
  type JobHandler,
} from '../jobs/services/postgres-job-queue.consumer.js';
import { RoadmapController } from './controllers/roadmap.controller.js';
import {
  RoadmapJobHandler,
  SUPPORTED_ROADMAP_JOB_KINDS,
} from './services/roadmap-job.handler.js';
import { RoadmapService } from './services/roadmap.service.js';

interface HandlerRegisterableConsumer {
  registerHandler?: (kind: string, handler: JobHandler) => void;
}

/**
 * Roadmap module (`C05` §14.5 `EP-R01`–`EP-R07`, `EP-R14`, `EP-R15`, and async `RoadmapJobHandler`).
 *
 * Imports `AuthModule`, `AiModule`, and `JobsModule`. Registers `RoadmapJobHandler` for
 * `roadmap_generate` and `roadmap_revision` when the consumer exposes `registerHandler`.
 */
@Module({
  imports: [AuthModule, AiModule, JobsModule],
  controllers: [RoadmapController],
  providers: [RoadmapService, RoadmapJobHandler],
  exports: [RoadmapService, RoadmapJobHandler],
})
export class RoadmapModule implements OnModuleInit {
  constructor(
    @Inject(RoadmapJobHandler)
    private readonly roadmapJobHandler: RoadmapJobHandler,
    @Optional()
    @Inject(PostgresJobQueueConsumer)
    private readonly jobQueueConsumer?: PostgresJobQueueConsumer,
  ) {}

  onModuleInit(): void {
    const registrar = this.jobQueueConsumer as
      (PostgresJobQueueConsumer & HandlerRegisterableConsumer) | undefined;
    if (typeof registrar?.registerHandler === 'function') {
      for (const kind of SUPPORTED_ROADMAP_JOB_KINDS) {
        registrar.registerHandler(kind, this.roadmapJobHandler);
      }
      return;
    }
    if (
      typeof this.jobQueueConsumer?.start === 'function' &&
      process.env.NODE_ENV !== 'test' &&
      !process.env.VITEST
    ) {
      this.jobQueueConsumer.start(this.roadmapJobHandler);
    }
  }
}

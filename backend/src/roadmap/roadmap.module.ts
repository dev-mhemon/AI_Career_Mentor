import { Inject, Module, Optional } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { LearningModule } from '../learning/learning.module.js';
import { PostgresJobQueueConsumer } from '../jobs/services/postgres-job-queue.consumer.js';
import { RoadmapController } from './controllers/roadmap.controller.js';
import {
  MergeProposalJobHandler,
  SUPPORTED_MERGE_PROPOSAL_JOB_KINDS,
} from './services/merge-proposal-job.handler.js';
import {
  RoadmapJobHandler,
  SUPPORTED_ROADMAP_JOB_KINDS,
} from './services/roadmap-job.handler.js';
import { RoadmapMergeService } from './services/roadmap-merge.service.js';
import { RoadmapService } from './services/roadmap.service.js';

/**
 * Roadmap module (`C05` §14.5 `EP-R01`–`EP-R10`, `EP-R12`, `EP-R14`, `EP-R15`,
 * plus async `RoadmapJobHandler` and `MergeProposalJobHandler`).
 *
 * Imports `AuthModule`, `AiModule`, and `JobsModule`. Registers `RoadmapJobHandler` for
 * `roadmap_generate` / `roadmap_revision` and `MergeProposalJobHandler` for
 * `merge_proposal` on the shared `PostgresJobQueueConsumer`.
 */
@Module({
  imports: [AuthModule, AiModule, JobsModule, LearningModule],
  controllers: [RoadmapController],
  providers: [
    RoadmapService,
    RoadmapJobHandler,
    RoadmapMergeService,
    MergeProposalJobHandler,
  ],
  exports: [
    RoadmapService,
    RoadmapJobHandler,
    RoadmapMergeService,
    MergeProposalJobHandler,
  ],
})
export class RoadmapModule implements OnModuleInit {
  constructor(
    @Inject(RoadmapJobHandler)
    private readonly roadmapJobHandler: RoadmapJobHandler,
    @Inject(MergeProposalJobHandler)
    private readonly mergeProposalJobHandler: MergeProposalJobHandler,
    @Optional()
    @Inject(PostgresJobQueueConsumer)
    private readonly jobQueueConsumer?: PostgresJobQueueConsumer,
  ) {}

  onModuleInit(): void {
    if (!this.jobQueueConsumer) {
      return;
    }
    if (typeof this.jobQueueConsumer.registerHandler === 'function') {
      for (const kind of SUPPORTED_ROADMAP_JOB_KINDS) {
        this.jobQueueConsumer.registerHandler(kind, this.roadmapJobHandler);
      }
      for (const kind of SUPPORTED_MERGE_PROPOSAL_JOB_KINDS) {
        this.jobQueueConsumer.registerHandler(
          kind,
          this.mergeProposalJobHandler,
        );
      }
      if (
        typeof this.jobQueueConsumer.start === 'function' &&
        process.env.NODE_ENV !== 'test' &&
        !process.env.VITEST
      ) {
        this.jobQueueConsumer.start();
      }
      return;
    }
    if (
      typeof this.jobQueueConsumer.start === 'function' &&
      process.env.NODE_ENV !== 'test' &&
      !process.env.VITEST
    ) {
      this.jobQueueConsumer.start(this.roadmapJobHandler);
    }
  }
}

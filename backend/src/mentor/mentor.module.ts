import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module.js';
import { AiModule } from '../ai/ai.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MentorController } from './controllers/mentor.controller.js';
import { EpisodicSummaryService } from './services/episodic-summary.service.js';
import { MentorContextAssemblerService } from './services/mentor-context-assembler.service.js';
import { MentorService } from './services/mentor.service.js';

/**
 * AI Career Mentor module (`C05` §14.10 `EP-M01`–`EP-M04`, `C08` §7.1 / §10, `ADR-018` / `R15`).
 */
@Module({
  imports: [AuthModule, AccountModule, AiModule],
  controllers: [MentorController],
  providers: [
    MentorContextAssemblerService,
    EpisodicSummaryService,
    MentorService,
  ],
  exports: [
    MentorService,
    MentorContextAssemblerService,
    EpisodicSummaryService,
  ],
})
export class MentorModule {}

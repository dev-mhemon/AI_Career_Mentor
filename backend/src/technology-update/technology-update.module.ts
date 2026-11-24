import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TechnologyUpdateController } from './controllers/technology-update.controller.js';
import { TechnologyUpdateSchedulerService } from './services/technology-update-scheduler.service.js';
import { TechnologyUpdateSourceService } from './services/technology-update-source.service.js';
import { TechnologyUpdateService } from './services/technology-update.service.js';

/**
 * NestJS module wiring `C05` §14.11 Technology Update API (`EP-T01`–`EP-T03`)
 * and `R25` pinned-session hourly timezone-aware technology intelligence scheduler (`M11`).
 */
@Module({
  imports: [AuthModule, AiModule],
  controllers: [TechnologyUpdateController],
  providers: [
    TechnologyUpdateService,
    TechnologyUpdateSourceService,
    TechnologyUpdateSchedulerService,
  ],
  exports: [
    TechnologyUpdateService,
    TechnologyUpdateSourceService,
    TechnologyUpdateSchedulerService,
  ],
})
export class TechnologyUpdateModule {}

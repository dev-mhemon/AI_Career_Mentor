import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProgressController } from './controllers/progress.controller.js';
import { EvidenceService } from './services/evidence.service.js';
import { ProgressService } from './services/progress.service.js';

/**
 * Progress module (`C05` §14.9 `EP-G01`–`EP-G03` and internal-only `EP-G04` `EvidenceService`).
 */
@Module({
  imports: [AuthModule],
  controllers: [ProgressController],
  providers: [ProgressService, EvidenceService],
  exports: [ProgressService, EvidenceService],
})
export class ProgressModule {}

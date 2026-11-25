import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FeedbackController } from './controllers/feedback.controller.js';
import { FeedbackService } from './services/feedback.service.js';
import { SharedContentQualityService } from './services/shared-content-quality.service.js';

/**
 * Quality Feedback & Shared-Content Safety module (`C05` §14.12 `EP-F01`–`EP-F02`,
 * `C06` `020_gaps_and_alignment.sql`, `R11`, `R24`, `R26`, `R27`, `R34`).
 */
@Module({
  imports: [AuthModule],
  controllers: [FeedbackController],
  providers: [SharedContentQualityService, FeedbackService],
  exports: [FeedbackService, SharedContentQualityService],
})
export class FeedbackModule {}

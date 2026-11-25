import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminController } from './controllers/admin.controller.js';
import { AdminUserService } from './services/admin-user.service.js';
import { AuditService } from './services/audit.service.js';
import { FeatureControlService } from './services/feature-control.service.js';
import { UsageService } from './services/usage.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [
    AuditService,
    AdminUserService,
    FeatureControlService,
    UsageService,
  ],
  exports: [
    AuditService,
    AdminUserService,
    FeatureControlService,
    UsageService,
  ],
})
export class AdminModule {}

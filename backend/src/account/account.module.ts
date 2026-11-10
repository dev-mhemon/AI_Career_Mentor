import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard.js';
import { DatabaseService } from '../auth/services/database.service.js';
import { AccountController } from './controllers/account.controller.js';
import { DeletionReceiptGuard } from './guards/deletion-receipt.guard.js';
import { AccountDeletionService } from './services/account-deletion.service.js';
import { DeletionReceiptService } from './services/deletion-receipt.service.js';
import { PrivacyRetentionService } from './services/privacy-retention.service.js';
import { ProviderCleanupService } from './services/provider-cleanup.service.js';
import { ReauthVerificationService } from './services/reauth-verification.service.js';

/**
 * NestJS module encapsulating the Account Deletion wire contract (`EP-X01` / `EP-X02`),
 * `DeletionReceipt` HMAC-SHA256 authority (`R06`), `ReauthVerificationService` (`EP-X01`),
 * atomic cascade deletion, bounded `ProviderCleanupService` outbox (`R35`), and
 * `PrivacyRetentionService` physical purge worker (`R08`, `R09`, PRD §52).
 */
@Module({
  controllers: [AccountController],
  providers: [
    DatabaseService,
    SupabaseAuthGuard,
    DeletionReceiptService,
    ReauthVerificationService,
    ProviderCleanupService,
    PrivacyRetentionService,
    AccountDeletionService,
    DeletionReceiptGuard,
  ],
  exports: [
    AccountDeletionService,
    DeletionReceiptService,
    ReauthVerificationService,
    ProviderCleanupService,
    PrivacyRetentionService,
    DeletionReceiptGuard,
    SupabaseAuthGuard,
  ],
})
export class AccountModule {}

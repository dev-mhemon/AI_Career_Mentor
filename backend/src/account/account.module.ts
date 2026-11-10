import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard.js';
import { DatabaseService } from '../auth/services/database.service.js';
import { AccountController } from './controllers/account.controller.js';
import { DeletionReceiptGuard } from './guards/deletion-receipt.guard.js';
import { AccountDeletionService } from './services/account-deletion.service.js';
import { DeletionReceiptService } from './services/deletion-receipt.service.js';

/**
 * NestJS module encapsulating the Account Deletion wire contract (`EP-X01` / `EP-X02`),
 * `DeletionReceipt` HMAC-SHA256 authority (`R06`), and `AZ-SUSP` / receipt access guard (`M03-01`).
 */
@Module({
  controllers: [AccountController],
  providers: [
    DatabaseService,
    SupabaseAuthGuard,
    DeletionReceiptService,
    AccountDeletionService,
    DeletionReceiptGuard,
  ],
  exports: [
    AccountDeletionService,
    DeletionReceiptService,
    DeletionReceiptGuard,
    SupabaseAuthGuard,
  ],
})
export class AccountModule {}

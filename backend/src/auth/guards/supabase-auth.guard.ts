import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard that triggers the 'supabase' Passport strategy.
 * Rejects requests with missing, invalid, or expired JWTs (401).
 */
@Injectable()
export class SupabaseAuthGuard extends AuthGuard('supabase') {
  private readonly logger = new Logger(SupabaseAuthGuard.name);

  handleRequest(err: any, user: any, info: any) {
    if (info) {
      this.logger.warn(`JWT Verification Failed: ${info.message || info}`);
    }
    if (err || !user) {
      throw err || new UnauthorizedException();
    }
    return user;
  }
}

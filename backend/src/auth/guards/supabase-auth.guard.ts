import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard that triggers the 'supabase' Passport strategy.
 * Rejects requests with missing, invalid, or expired JWTs (401).
 *
 * Plan v1.2 §5: AuthGuard validates the JWT and attaches the
 * supabase_uid to the request.
 */
@Injectable()
export class SupabaseAuthGuard extends AuthGuard('supabase') {}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';

export interface ReauthCredentials {
  password?: string;
  reauth_token?: string;
}

/**
 * Service enforcing live re-authentication on account deletion (`EP-X01`).
 *
 * Verifies live user credentials (password against GoTrue `/auth/v1/token?grant_type=password`
 * or OAuth `reauth_token` against GoTrue `/auth/v1/user`) without mutating caller session cookies.
 * Rejects unauthenticated or mismatched credentials with canonical `401 REAUTH_REQUIRED`.
 */
@Injectable()
export class ReauthVerificationService {
  private readonly logger = new Logger(ReauthVerificationService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Verifies live user credentials (password or OAuth `reauth_token`) against GoTrue / identity provider.
   * Throws `401 REAUTH_REQUIRED` on missing credentials, mismatch, or invalid provider credentials.
   *
   * @param userId - Application user UUID (`public.users.id`).
   * @param credentials - Supplied `password` or `reauth_token`.
   * @param db - Optional active database transaction runner.
   */
  async verifyReauthentication(
    userId: string,
    credentials: ReauthCredentials,
    db?: { query: DatabaseService['query'] },
  ): Promise<void> {
    const { password, reauth_token } = credentials;

    if (!password && !reauth_token) {
      fail(401, 'REAUTH_REQUIRED', 'Re-authentication is required');
    }

    const runner = db ?? this.database;
    const rawSupabaseUrl =
      this.config.get<string>('SUPABASE_URL') ?? 'http://127.0.0.1:56321';
    const supabaseUrl = rawSupabaseUrl.replace(/\/$/, '');
    const anonKey =
      this.config.get<string>('SUPABASE_ANON_KEY') ?? 'test-anon-key';

    if (password) {
      // 1. Password re-authentication: retrieve primary email or phone for user
      const userRows = await runner.query<
        Array<{ email: string | null; phone: string | null }>
      >(
        `SELECT email, phone
           FROM public.users
          WHERE id = $1::uuid
          LIMIT 1`,
        [userId],
      );

      const user = Array.isArray(userRows) ? userRows[0] : undefined;
      let channel: 'email' | 'phone' | undefined;
      let identifier: string | undefined;

      if (user?.email) {
        channel = 'email';
        identifier = user.email;
      } else if (user?.phone) {
        channel = 'phone';
        identifier = user.phone;
      } else {
        // Fallback: check user_auth_providers for email or phone
        const providerRows = await runner.query<
          Array<{ provider: string; contact_value: string | null }>
        >(
          `SELECT provider, contact_value
             FROM public.user_auth_providers
            WHERE user_id = $1::uuid
              AND provider IN ('email', 'phone')
            ORDER BY is_primary DESC, linked_at ASC
            LIMIT 1`,
          [userId],
        );
        const providerRow = Array.isArray(providerRows)
          ? providerRows[0]
          : undefined;
        if (
          providerRow?.contact_value &&
          (providerRow.provider === 'email' || providerRow.provider === 'phone')
        ) {
          channel = providerRow.provider;
          identifier = providerRow.contact_value;
        }
      }

      if (!channel || !identifier) {
        fail(
          401,
          'REAUTH_REQUIRED',
          'Account does not have a password configured; re-authenticate with reauth_token',
        );
      }

      let response: Response;
      try {
        response = await fetch(
          `${supabaseUrl}/auth/v1/token?grant_type=password`,
          {
            method: 'POST',
            headers: {
              apikey: anonKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              [channel]: identifier,
              password,
            }),
            signal: AbortSignal.timeout(10000),
          },
        );
      } catch (error) {
        this.logger.error('GoTrue password verification unreachable', error);
        fail(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable');
      }

      if (response.status === 400 || response.status === 401) {
        fail(
          401,
          'REAUTH_REQUIRED',
          'Invalid credentials for re-authentication',
        );
      }

      if (!response.ok) {
        fail(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable');
      }

      const body = (await response.json().catch(() => null)) as {
        user?: { id?: string };
      } | null;

      if (body?.user?.id !== userId) {
        fail(
          401,
          'REAUTH_REQUIRED',
          'Invalid credentials for re-authentication',
        );
      }

      return;
    }

    if (reauth_token) {
      // 2. OAuth / passwordless reauth_token verification
      let response: Response;
      try {
        response = await fetch(`${supabaseUrl}/auth/v1/user`, {
          method: 'GET',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${reauth_token}`,
          },
          signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        this.logger.error('GoTrue token verification unreachable', error);
        fail(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable');
      }

      if (response.status === 401 || response.status === 403) {
        fail(
          401,
          'REAUTH_REQUIRED',
          'Invalid or expired re-authentication token',
        );
      }

      if (!response.ok) {
        fail(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable');
      }

      const body = (await response.json().catch(() => null)) as {
        id?: string;
      } | null;

      if (body?.id !== userId) {
        fail(
          401,
          'REAUTH_REQUIRED',
          'Invalid or expired re-authentication token',
        );
      }

      return;
    }
  }
}

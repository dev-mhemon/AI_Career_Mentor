import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';

export interface ReauthCredentials {
  password?: string;
  reauth_token?: string;
}

const SYNTHETIC_EMAIL_DOMAINS = ['@synthetic.mentor', '@phone.invalid'];

function isNonSyntheticEmail(
  value: string | null | undefined,
): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length > 0 &&
    !SYNTHETIC_EMAIL_DOMAINS.some((domain) => normalized.endsWith(domain))
  );
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

      if (isNonSyntheticEmail(user?.email)) {
        channel = 'email';
        identifier = user.email.trim();
      } else if (
        typeof user?.phone === 'string' &&
        user.phone.trim().length > 0
      ) {
        channel = 'phone';
        identifier = user.phone.trim();
      } else {
        // Fallback: check user_auth_providers for non-synthetic email or phone
        const providerRows = await runner.query<
          Array<{ provider: string; contact_value: string | null }>
        >(
          `SELECT provider, contact_value
             FROM public.user_auth_providers
            WHERE user_id = $1::uuid
              AND provider IN ('email', 'phone')
            ORDER BY is_primary DESC, linked_at ASC
            LIMIT 5`,
          [userId],
        );
        const providerRow = Array.isArray(providerRows)
          ? providerRows.find(
              (row) =>
                (row.provider === 'email' &&
                  isNonSyntheticEmail(row.contact_value)) ||
                (row.provider === 'phone' &&
                  typeof row.contact_value === 'string' &&
                  row.contact_value.trim().length > 0),
            )
          : undefined;
        if (
          providerRow?.contact_value &&
          (providerRow.provider === 'email' || providerRow.provider === 'phone')
        ) {
          channel = providerRow.provider;
          identifier = providerRow.contact_value.trim();
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

      if (!response.ok) {
        const errorBody = (
          typeof response.json === 'function'
            ? await response.json().catch(() => null)
            : null
        ) as { code?: string | number; error_code?: string } | null;

        // When GoTrue SMS/Twilio is disabled (local/TextBee OTP setups), fall back
        // to bcrypt comparison against auth.users just like AuthService.loginPhoneWhenProviderDisabled.
        const isPhoneProviderDisabled =
          channel === 'phone' &&
          (response.status === 400 || response.status === 422) &&
          (errorBody?.error_code === 'phone_provider_disabled' ||
            errorBody?.code === 'phone_provider_disabled');

        if (isPhoneProviderDisabled) {
          await this.verifyPhonePasswordFromDatabase(runner, userId, password);
          return;
        }

        if (
          response.status === 400 ||
          response.status === 401 ||
          (response.status === 422 && channel === 'phone')
        ) {
          fail(
            401,
            'REAUTH_REQUIRED',
            'Invalid credentials for re-authentication',
          );
        }

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

  /**
   * Verifies a phone-registered user's password directly against `auth.users` when
   * GoTrue SMS password logins are disabled (`phone_provider_disabled`).
   */
  private async verifyPhonePasswordFromDatabase(
    runner: { query: DatabaseService['query'] },
    userId: string,
    password: string,
  ): Promise<void> {
    let rows: Array<{
      id: string;
      phone_confirmed_at: string | Date | null;
      password_matches: boolean;
    }>;

    try {
      rows = await runner.query<
        Array<{
          id: string;
          phone_confirmed_at: string | Date | null;
          password_matches: boolean;
        }>
      >(
        `SELECT u.id,
                u.phone_confirmed_at,
                CASE
                  WHEN u.encrypted_password IS NOT NULL
                   AND u.encrypted_password LIKE '$2%'
                  THEN (u.encrypted_password = extensions.crypt($2, u.encrypted_password))
                  ELSE false
                END AS password_matches
           FROM auth.users u
          WHERE u.id = $1::uuid
            AND u.deleted_at IS NULL
          LIMIT 1`,
        [userId, password],
      );
    } catch (error) {
      this.logger.error(
        'Database fallback for phone password re-authentication failed',
        error,
      );
      fail(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable');
    }

    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row || !row.phone_confirmed_at || row.password_matches !== true) {
      fail(401, 'REAUTH_REQUIRED', 'Invalid credentials for re-authentication');
    }
  }
}

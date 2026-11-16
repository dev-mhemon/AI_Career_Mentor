import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fail } from '../../common/http.js';
import type { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';
import { DatabaseService } from './database.service.js';
import {
  ORPHAN_ABANDONMENT_WINDOW_MS,
  hasOAuthProviderMetadata,
  purgeOrphanedAuthByContact,
} from './orphaned-auth-cleanup.js';
import { OtpSecretStore } from './otp-secret-store.service.js';

export interface PendingPhoneIdentity {
  id: string;
  subject: string;
  phone: string;
  verified: boolean;
}

export interface SmsDelivery {
  expiresInSeconds: number;
  expiresAt?: Date;
}

/**
 * Masks Bangladesh or international phone number for safe public logging/display.
 * e.g. +8801712345678 -> +8801****5678
 */
export function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length >= 8) {
    return `${trimmed.slice(0, 5)}****${trimmed.slice(-4)}`;
  }
  return `${trimmed.slice(0, 2)}****`;
}

/**
 * SMS registration and OTP delivery provider backed exclusively by TextBee REST API.
 */
@Injectable()
export class TextBeeSmsProvider {
  private readonly logger = new Logger(TextBeeSmsProvider.name);

  constructor(
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly database?: DatabaseService,
    @Optional() private readonly otpStore?: OtpSecretStore,
    @Optional() private readonly abuse?: AuthAbuseControl,
  ) {}

  private getServiceRoleKey(): string | undefined {
    return (
      this.config?.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.config?.get<string>('SERVICE_ROLE_KEY')
    );
  }

  isConfigured(): boolean {
    return Boolean(this.config?.get<string>('TEXTBEE_API_KEY')?.trim());
  }

  ready(): void {
    const hmacSecret = this.config?.get<string>('AUTH_OTP_HMAC_SECRET');
    const serviceRoleKey = this.getServiceRoleKey();
    const redisUrl = this.config?.get<string>('AUTH_REDIS_URL');
    if (
      !hmacSecret ||
      !serviceRoleKey ||
      !redisUrl ||
      !this.otpStore ||
      !this.isConfigured()
    ) {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Phone registration is temporarily unavailable',
        [],
        true,
        5,
      );
    }
  }

  /**
   * Validates SMS delivery readiness and channel reachability without dispatching unsolicited messages.
   */
  async checkDeliveryHealth(_signal?: AbortSignal): Promise<void> {
    void _signal;
    this.ready();
    const apiKey = this.config?.get<string>('TEXTBEE_API_KEY')?.trim();
    if (apiKey) return;
    fail(
      503,
      'SERVICE_UNAVAILABLE',
      'SMS delivery is unavailable',
      [],
      true,
      5,
    );
  }

  private getTimeoutMs(): number {
    const rawTimeout = Number(this.config?.get('TEXTBEE_TIMEOUT_MS'));
    return Number.isInteger(rawTimeout) && rawTimeout > 0 ? rawTimeout : 10000;
  }

  private getSupabaseUrl(): string | undefined {
    try {
      return (
        this.config?.get<string>('SUPABASE_URL') ??
        this.config?.getOrThrow<string>('SUPABASE_URL')
      );
    } catch {
      return undefined;
    }
  }

  /**
   * Purges any deleted or orphaned `auth.users` / `auth.identities` records holding `phone`
   * when no active `public.users` account owns it. Returns `true` if a stale record was purged.
   */
  async purgeOrphanedByPhone(
    phone: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    this.ready();
    return purgeOrphanedAuthByContact({
      channel: 'phone',
      identifier: phone,
      database: this.database,
      supabaseUrl: this.getSupabaseUrl(),
      serviceRoleKey: this.getServiceRoleKey(),
      signal,
      abuseControl: this.abuse,
      preserveSendLimits: true,
    });
  }

  async findByPhone(
    phone: string,
    _signal?: AbortSignal,
  ): Promise<PendingPhoneIdentity | null> {
    void _signal;
    this.ready();
    const normalized = phone.trim();
    if (!this.database) return null;
    const rows = await this.database.query(
      `SELECT u.id,
              COALESCE(p.contact_value, u.phone) AS phone,
              u.phone_confirmed_at,
              u.created_at,
              pu.verified_contact,
              p.verified_at AS provider_verified_at,
              (pu.id IS NOT NULL) AS has_app_user,
              (u.deleted_at IS NOT NULL) AS is_deleted,
              (
                lower(COALESCE(u.raw_app_meta_data->>'provider', '')) IN ('google', 'facebook')
                OR EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements_text(
                      CASE
                        WHEN jsonb_typeof(u.raw_app_meta_data->'providers') = 'array'
                          THEN u.raw_app_meta_data->'providers'
                        ELSE '[]'::jsonb
                      END
                    ) p_el
                   WHERE lower(p_el) IN ('google', 'facebook')
                )
                OR EXISTS (
                  SELECT 1
                    FROM auth.identities oi
                   WHERE oi.user_id = u.id
                     AND lower(oi.provider) IN ('google', 'facebook')
                )
              ) AS is_oauth_user
         FROM auth.users u
         LEFT JOIN public.users pu ON pu.id = u.id
         LEFT JOIN public.user_auth_providers p
           ON p.user_id = u.id AND p.provider = 'phone'
        WHERE u.deleted_at IS NULL
          AND (u.phone IN ($1, ltrim($1, '+')) OR p.contact_value IN ($1, ltrim($1, '+')))
          AND (
            NOT (pu.id IS NULL AND COALESCE(u.created_at, NOW()) < NOW() - INTERVAL '15 minutes')
            OR (
              u.phone_confirmed_at IS NOT NULL
              AND (
                lower(COALESCE(u.raw_app_meta_data->>'provider', '')) IN ('google', 'facebook')
                OR EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements_text(
                      CASE
                        WHEN jsonb_typeof(u.raw_app_meta_data->'providers') = 'array'
                          THEN u.raw_app_meta_data->'providers'
                        ELSE '[]'::jsonb
                      END
                    ) p_el
                   WHERE lower(p_el) IN ('google', 'facebook')
                )
                OR EXISTS (
                  SELECT 1
                    FROM auth.identities oi
                   WHERE oi.user_id = u.id
                     AND lower(oi.provider) IN ('google', 'facebook')
                )
              )
            )
          )
        ORDER BY
          COALESCE(p.contact_value IN ($1, ltrim($1, '+')), false) DESC,
          COALESCE(COALESCE(p.contact_value, u.phone) IN ($1, ltrim($1, '+')), false) DESC,
          COALESCE(pu.verified_contact = true OR p.verified_at IS NOT NULL, false) DESC,
          COALESCE(pu.id IS NOT NULL, false) DESC,
          u.created_at DESC
        LIMIT 1`,
      [normalized],
    );
    if (!rows || rows.length === 0) {
      return null;
    }
    const row = rows[0];
    const createdAtMs =
      row.created_at !== undefined && row.created_at !== null
        ? row.created_at instanceof Date
          ? row.created_at.getTime()
          : Date.parse(String(row.created_at))
        : NaN;
    const isConfirmed = Boolean(row.phone_confirmed_at);
    const isOAuthUser = hasOAuthProviderMetadata(row);
    if (
      row.is_deleted === true ||
      (row.has_app_user === false &&
        (!isOAuthUser || !isConfirmed) &&
        (isConfirmed ||
          (Number.isFinite(createdAtMs) &&
            Date.now() - createdAtMs >= ORPHAN_ABANDONMENT_WINDOW_MS)))
    ) {
      return null;
    }
    const rawPhone = typeof row.phone === 'string' ? row.phone : normalized;
    const canonicalPhone = rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`;
    return {
      id: row.id,
      subject: row.id,
      phone: canonicalPhone,
      verified:
        row.has_app_user === true
          ? Boolean(row.verified_contact || row.provider_verified_at)
          : Boolean(
              row.verified_contact ||
              row.provider_verified_at ||
              (isOAuthUser && isConfirmed),
            ),
    };
  }

  async createPending(
    phone: string,
    password: string,
    signal?: AbortSignal,
  ): Promise<PendingPhoneIdentity> {
    this.ready();
    const supabaseUrl = this.config!.getOrThrow<string>('SUPABASE_URL').replace(
      /\/$/,
      '',
    );
    const serviceRoleKey = this.getServiceRoleKey()!;

    const timeoutSignal = AbortSignal.timeout(this.getTimeoutMs());
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    let response!: Response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phone,
            password,
            phone_confirm: false,
          }),
          signal: combinedSignal,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === 'AbortError' ||
            /timeout|timed out/i.test(error.message))
        ) {
          fail(504, 'PROVIDER_TIMEOUT', 'SMS provider timed out', [], true);
        }
        fail(
          502,
          'SMS_PROVIDER_ERROR',
          'GoTrue createUser failed with network error',
          [],
          true,
        );
      }

      if (response.status === 422) {
        const err = (await response.json().catch(() => null)) as any;
        if (
          err?.error_code === 'phone_exists' ||
          err?.code === 'phone_exists' ||
          /exists|already/i.test(err?.msg || '')
        ) {
          if (
            attempt === 0 &&
            (await this.purgeOrphanedByPhone(phone, combinedSignal))
          ) {
            continue;
          }
          fail(409, 'CONTACT_ALREADY_REGISTERED', 'Contact already registered');
        }
      }
      if (response.status === 429) {
        const retryHeader = Number(response.headers?.get?.('retry-after'));
        const retryAfter =
          Number.isFinite(retryHeader) && retryHeader > 0
            ? Math.ceil(retryHeader)
            : 60;
        fail(
          429,
          'OTP_LIMIT_EXCEEDED',
          'SMS delivery is temporarily rate-limited. Please try again later.',
          [],
          true,
          retryAfter,
        );
      }
      break;
    }

    if (!response.ok) {
      fail(
        502,
        'SMS_PROVIDER_ERROR',
        `GoTrue createUser failed with status ${response.status}`,
        [],
        true,
      );
    }

    const user = (await response.json()) as any;
    const rawUserPhone = user?.phone || phone;
    const canonicalPhone = rawUserPhone.startsWith('+')
      ? rawUserPhone
      : `+${rawUserPhone}`;
    return {
      id: user.id,
      subject: user.id,
      phone: canonicalPhone,
      verified: false,
    };
  }

  async sendChallenge(
    identity: { id: string; phone: string },
    signal?: AbortSignal,
  ): Promise<SmsDelivery> {
    this.ready();
    if (!this.otpStore) {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'OTP secret store is unavailable',
        [],
        true,
        5,
      );
    }
    const otp = this.otpStore.generateOtp();
    const { expiresInSeconds } = await this.otpStore.storeOtp(
      identity.id,
      identity.phone,
      otp,
      600,
      'verify_phone',
    );
    const message = `Your verification code is: ${otp}`;
    await this.dispatchSms(identity.phone, message, signal);
    return { expiresInSeconds };
  }

  async sendPasswordResetChallenge(
    phone: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<SmsDelivery> {
    this.ready();
    if (!this.otpStore) {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'OTP secret store is unavailable',
        [],
        true,
        5,
      );
    }
    const otp = this.otpStore.generateOtp();
    const { expiresInSeconds } = await this.otpStore.storeOtp(
      userId,
      phone,
      otp,
      600,
      'reset_password',
    );
    const message = `Your password reset code is: ${otp}`;
    await this.dispatchSms(phone, message, signal);
    return { expiresInSeconds };
  }

  async dispatchSms(
    phone: string,
    message: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const apiKey = this.config?.get<string>('TEXTBEE_API_KEY')?.trim();
    if (apiKey) {
      await this.dispatchTextBee(phone, message, apiKey, signal);
      return;
    }

    fail(
      503,
      'SERVICE_UNAVAILABLE',
      'SMS delivery is unavailable',
      [],
      true,
      5,
    );
  }

  private async dispatchTextBee(
    phone: string,
    message: string,
    apiKey: string,
    externalSignal?: AbortSignal,
  ): Promise<void> {
    const rawBaseUrl =
      this.config?.get<string>('TEXTBEE_BASE_URL')?.trim() ||
      'https://api.textbee.dev/api/v1';
    const baseUrl = rawBaseUrl.replace(/\/+$/, '');
    const deviceId = this.config?.get<string>('TEXTBEE_DEVICE_ID')?.trim();
    const url = deviceId
      ? `${baseUrl}/gateway/devices/${encodeURIComponent(deviceId)}/send-sms`
      : `${baseUrl}/gateway/send-sms`;

    const timeoutSignal = AbortSignal.timeout(this.getTimeoutMs());
    const combinedSignal = externalSignal
      ? AbortSignal.any([externalSignal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipients: [phone],
          message,
        }),
        redirect: 'error',
        signal: combinedSignal,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' ||
          /timeout|timed out/i.test(error.message))
      ) {
        fail(504, 'PROVIDER_TIMEOUT', 'SMS provider timed out', [], true);
      }
      this.logger.error('TextBee HTTP dispatch network error');
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'SMS delivery failed due to network error',
        [],
        true,
        5,
      );
    }

    if (!response.ok) {
      this.logger.error(
        `TextBee HTTP dispatch returned status ${response.status}`,
      );
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'SMS provider rejected delivery request',
        [],
        true,
        5,
      );
    }
  }
}

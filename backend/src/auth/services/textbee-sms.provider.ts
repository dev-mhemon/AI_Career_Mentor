import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fail } from '../../common/http.js';
import { DatabaseService } from './database.service.js';
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
 * SMS registration and OTP delivery provider backed by TextBee REST API with local Mailpit fallback in non-production.
 */
@Injectable()
export class TextBeeSmsProvider {
  private readonly logger = new Logger(TextBeeSmsProvider.name);

  constructor(
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly database?: DatabaseService,
    @Optional() private readonly otpStore?: OtpSecretStore,
  ) {}

  private getServiceRoleKey(): string | undefined {
    return (
      this.config?.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.config?.get<string>('SERVICE_ROLE_KEY')
    );
  }

  // [ORIGINAL] Pre-fallback isConfigured():
  // isConfigured(): boolean {
  //   const apiKey = this.config?.get<string>('TEXTBEE_API_KEY')?.trim();
  //   if (apiKey) return true;
  //   const isProd =
  //     (this.config?.get<string>('NODE_ENV') || process.env.NODE_ENV) ===
  //     'production';
  //   if (!isProd) {
  //     const mailpit = this.config?.get<string>('MAILPIT_URL')?.trim();
  //     if (mailpit) return true;
  //   }
  //   return false;
  // }
  private resolveDeliveryMode(): 'textbee' | 'mailpit' | 'unconfigured' {
    const isProd =
      (this.config?.get<string>('NODE_ENV') || process.env.NODE_ENV) ===
      'production';
    const smsProvider = this.config
      ?.get<string>('SMS_PROVIDER')
      ?.trim()
      .toLowerCase();
    const apiKey = this.config?.get<string>('TEXTBEE_API_KEY')?.trim();
    const deviceId = this.config?.get<string>('TEXTBEE_DEVICE_ID')?.trim();
    const mailpitUrl = this.config?.get<string>('MAILPIT_URL')?.trim();

    if (isProd) {
      return apiKey ? 'textbee' : 'unconfigured';
    }

    if (smsProvider === 'mailpit') {
      return mailpitUrl ? 'mailpit' : 'unconfigured';
    }

    if (smsProvider === 'textbee') {
      return apiKey ? 'textbee' : 'unconfigured';
    }

    if (apiKey && (deviceId || !mailpitUrl)) {
      return 'textbee';
    }

    if (mailpitUrl) {
      return 'mailpit';
    }

    return 'unconfigured';
  }

  isConfigured(): boolean {
    return this.resolveDeliveryMode() !== 'unconfigured';
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
    // [ORIGINAL] Pre-fallback checkDeliveryHealth():
    // const apiKey = this.config?.get<string>('TEXTBEE_API_KEY')?.trim();
    // if (apiKey) return;
    // const isProd =
    //   (this.config?.get<string>('NODE_ENV') || process.env.NODE_ENV) ===
    //   'production';
    // if (!isProd) {
    //   const mailpit = this.config?.get<string>('MAILPIT_URL')?.trim();
    //   if (mailpit) return;
    // }
    if (this.resolveDeliveryMode() !== 'unconfigured') return;
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
              u.email_confirmed_at,
              pu.verified_contact,
              p.verified_at AS provider_verified_at,
              EXISTS (
                SELECT 1 FROM public.user_auth_providers linked
                 WHERE linked.user_id=u.id
                   AND (linked.verified_at IS NOT NULL OR linked.provider IN ('google','facebook'))
              ) AS has_protected_provider,
              EXISTS (
                SELECT 1 FROM auth.identities identity
                 WHERE identity.user_id=u.id AND identity.provider IN ('google','facebook')
              ) AS has_oauth_identity
         FROM auth.users u
         LEFT JOIN public.users pu ON pu.id = u.id
         LEFT JOIN public.user_auth_providers p
           ON p.user_id = u.id AND p.provider = 'phone'
        WHERE u.phone IN ($1, ltrim($1, '+')) OR p.contact_value IN ($1, ltrim($1, '+'))
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
    const rawPhone = typeof row.phone === 'string' ? row.phone : normalized;
    const canonicalPhone = rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`;
    return {
      id: row.id,
      subject: row.id,
      phone: canonicalPhone,
      verified: Boolean(
        row.email_confirmed_at ||
        row.phone_confirmed_at ||
        row.verified_contact ||
        row.provider_verified_at ||
        row.has_protected_provider ||
        row.has_oauth_identity,
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

    let response: Response;
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
        fail(409, 'CONTACT_ALREADY_REGISTERED', 'Contact already registered');
      }
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
    // [ORIGINAL] Pre-fallback dispatchSms():
    // const apiKey = this.config?.get<string>('TEXTBEE_API_KEY')?.trim();
    // if (apiKey) {
    //   await this.dispatchTextBee(phone, message, apiKey, signal);
    //   return;
    // }
    //
    // const isProd =
    //   (this.config?.get<string>('NODE_ENV') || process.env.NODE_ENV) ===
    //   'production';
    // if (!isProd) {
    //   const mailpitUrl = this.config?.get<string>('MAILPIT_URL')?.trim();
    //   if (mailpitUrl) {
    //     await this.dispatchMailpit(phone, message, mailpitUrl, signal);
    //     return;
    //   }
    // }
    const mode = this.resolveDeliveryMode();
    if (mode === 'textbee') {
      const apiKey = this.config?.get<string>('TEXTBEE_API_KEY')?.trim();
      if (apiKey) {
        await this.dispatchTextBee(phone, message, apiKey, signal);
        return;
      }
    }

    if (mode === 'mailpit') {
      const mailpitUrl = this.config?.get<string>('MAILPIT_URL')?.trim();
      if (mailpitUrl) {
        await this.dispatchMailpit(phone, message, mailpitUrl, signal);
        return;
      }
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

  private async dispatchMailpit(
    phone: string,
    message: string,
    rawMailpitUrl: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const mailpitBase = rawMailpitUrl.replace(/\/+$/, '');
    const mailpitSendUrl = mailpitBase.endsWith('/api/v1/send')
      ? mailpitBase
      : `${mailpitBase}/api/v1/send`;

    const fromAddress =
      this.config?.get<string>('AUTH_EMAIL_FROM')?.trim() ||
      'noreply@mentor.local';
    const sanitizedPhone = phone.replace(/[^a-zA-Z0-9]/g, '');
    const toAddress = `${sanitizedPhone}@sms.local`;

    const timeoutSignal = AbortSignal.timeout(this.getTimeoutMs());
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(mailpitSendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          From: { Email: fromAddress },
          To: [{ Email: toAddress }],
          Subject: 'Your SMS verification code',
          Text: message,
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
      this.logger.error('Mailpit SMS fallback dispatch error');
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Local SMS dispatch failed',
        [],
        true,
        5,
      );
    }

    if (!response.ok) {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        `Local SMS dispatch failed with status ${response.status}`,
        [],
        true,
        5,
      );
    }
    this.logger.log(
      `Local Mailpit SMS fallback dispatched for ${maskPhone(phone)}`,
    );
  }
}

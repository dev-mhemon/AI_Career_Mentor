import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fail } from '../../common/http.js';
import {
  validateAuthEmailFrom,
  validateEmailWebhookUrl,
} from '../../config.js';
import { DatabaseService } from './database.service.js';
import { OtpSecretStore } from './otp-secret-store.service.js';

/** Only a trusted server adapter may return an identity. No public signup response is evidence. */
export interface PendingEmailIdentity {
  id: string;
  subject: string;
  email: string;
  verified: boolean;
}

export interface EmailDelivery {
  /** Confirmed provider challenge lifetime; never inferred from a Redis reservation. */
  expiresInSeconds: number;
}

export type EmailDispatchTransport = (
  to: string,
  otp: string,
  signal?: AbortSignal,
) => Promise<void>;

const EMAIL_TRANSPORT_URL_KEYS = [
  'AUTH_EMAIL_WEBHOOK_URL',
  'AUTH_EMAIL_TRANSPORT_URL',
  'EMAIL_TRANSPORT_URL',
  'MAILPIT_URL',
] as const;

/**
 * Resolves and instantiates a runtime email dispatch transport from application configuration.
 * Supports:
 * 1) Native Mailpit HTTP send API (MAILPIT_URL) posting `{ From: { Email }, To: [{ Email }], Subject, Text }`.
 * 2) Generic HTTP webhook (AUTH_EMAIL_WEBHOOK_URL / AUTH_EMAIL_TRANSPORT_URL / EMAIL_TRANSPORT_URL)
 *    posting `{ to, otp, subject }` with optional `Bearer ${AUTH_EMAIL_TRANSPORT_KEY}`.
 * 3) Resend API (RESEND_API_KEY with required AUTH_EMAIL_FROM).
 * Enforces https: for remote endpoints and allows http: only for explicit loopback addresses.
 * Returns undefined if no valid transport configuration is present, failing closed with 503 SERVICE_UNAVAILABLE in ready().
 */
export function createEmailTransportFromConfig(
  config?: ConfigService,
): EmailDispatchTransport | undefined {
  if (!config) return undefined;

  for (const key of EMAIL_TRANSPORT_URL_KEYS) {
    const rawVal = config.get<string>(key);
    if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
      validateEmailWebhookUrl(rawVal, key);
    }
  }

  const rawMailpitUrl = config.get<string>('MAILPIT_URL')?.trim();
  if (rawMailpitUrl) {
    const mailpitBaseUrl = rawMailpitUrl.replace(/\/+$/, '');
    const mailpitSendUrl = mailpitBaseUrl.endsWith('/api/v1/send')
      ? mailpitBaseUrl
      : `${mailpitBaseUrl}/api/v1/send`;
    const fromAddress =
      config.get<string>('AUTH_EMAIL_FROM')?.trim() || 'noreply@mentor.local';
    return async (to: string, otp: string, signal?: AbortSignal) => {
      const response = await fetch(mailpitSendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          From: { Email: fromAddress },
          To: [{ Email: to }],
          Subject: 'Your verification code',
          Text: `Your verification code is: ${otp}`,
        }),
        redirect: 'error',
        signal,
      });
      if (!response.ok) {
        throw new Error(
          `Mailpit HTTP send failed with status ${response.status}`,
        );
      }
    };
  }

  const webhookUrl =
    config.get<string>('AUTH_EMAIL_WEBHOOK_URL')?.trim() ||
    config.get<string>('AUTH_EMAIL_TRANSPORT_URL')?.trim() ||
    config.get<string>('EMAIL_TRANSPORT_URL')?.trim();
  if (webhookUrl) {
    const apiKey = config.get<string>('AUTH_EMAIL_TRANSPORT_KEY')?.trim();
    return async (to: string, otp: string, signal?: AbortSignal) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to,
          otp,
          subject: 'Your verification code',
        }),
        redirect: 'error',
        signal,
      });
      if (!response.ok) {
        throw new Error(
          `Email transport HTTP dispatch failed with status ${response.status}`,
        );
      }
    };
  }

  const resendApiKey = config.get<string>('RESEND_API_KEY')?.trim();
  if (resendApiKey) {
    const fromAddress = config.get<string>('AUTH_EMAIL_FROM')?.trim();
    if (!fromAddress) {
      throw new Error('AUTH_EMAIL_FROM is required when RESEND_API_KEY is set');
    }
    validateAuthEmailFrom(fromAddress);
    return async (to: string, otp: string, signal?: AbortSignal) => {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [to],
          subject: 'Your verification code',
          text: `Your verification code is: ${otp}`,
        }),
        redirect: 'error',
        signal,
      });
      if (!response.ok) {
        throw new Error(
          `Resend email dispatch failed with status ${response.status}`,
        );
      }
    };
  }

  return undefined;
}

/** A provider implementation must reconcile ambiguous creation before returning an identity. */
@Injectable()
export class EmailRegistrationProvider {
  private transport?: EmailDispatchTransport;

  /**
   * Initializes email registration provider with optional database, config, and OTP stores.
   * Automatically configures a runtime transport from ConfigService when transport settings are present.
   */
  constructor(
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly database?: DatabaseService,
    @Optional() private readonly otpStore?: OtpSecretStore,
  ) {
    if (this.config) {
      const configuredTransport = createEmailTransportFromConfig(this.config);
      if (configuredTransport) {
        this.transport = configuredTransport;
      }
    }
  }

  /** Sets or overrides the active email dispatch transport. */
  setTransport(transport: EmailDispatchTransport): void {
    this.transport = transport;
  }

  private getServiceRoleKey(): string | undefined {
    return (
      this.config?.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.config?.get<string>('SERVICE_ROLE_KEY')
    );
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
      !this.transport
    ) {
      this.unavailable();
    }
  }

  async findByEmail(
    email: string,
    _signal?: AbortSignal,
  ): Promise<PendingEmailIdentity | null> {
    void _signal;
    this.ready();
    const normalized = email.toLowerCase().trim();
    if (!this.database) return null;
    const rows = await this.database.query(
      `SELECT u.id, u.email, u.email_confirmed_at, pu.verified_contact
         FROM auth.users u
         LEFT JOIN public.users pu ON pu.id = u.id
        WHERE lower(u.email) = $1
        LIMIT 1`,
      [normalized],
    );
    if (!rows || rows.length === 0) {
      return null;
    }
    const row = rows[0];
    return {
      id: row.id,
      subject: row.id,
      email: row.email,
      verified: Boolean(row.verified_contact),
    };
  }

  async createPending(
    email: string,
    password: string,
    signal?: AbortSignal,
  ): Promise<PendingEmailIdentity> {
    this.ready();
    const supabaseUrl = this.config!.getOrThrow<string>('SUPABASE_URL').replace(
      /\/$/,
      '',
    );
    const serviceRoleKey = this.getServiceRoleKey()!;

    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: false,
      }),
      signal,
    });

    if (response.status === 422) {
      const err = (await response.json().catch(() => null)) as any;
      if (
        err?.error_code === 'email_exists' ||
        err?.code === 'email_exists' ||
        /exists|already/i.test(err?.msg || '')
      ) {
        fail(409, 'CONTACT_ALREADY_REGISTERED', 'Contact already registered');
      }
    }

    if (!response.ok) {
      fail(
        502,
        'EMAIL_PROVIDER_ERROR',
        `GoTrue createUser failed with status ${response.status}`,
        [],
        true,
      );
    }

    const user = (await response.json()) as any;
    return {
      id: user.id,
      subject: user.id,
      email: user.email,
      verified: false,
    };
  }

  async sendChallenge(
    identity: PendingEmailIdentity,
    signal?: AbortSignal,
  ): Promise<EmailDelivery> {
    this.ready();
    if (!this.otpStore || !this.transport) {
      this.unavailable();
    }
    const otp = this.otpStore.generateOtp();
    const { expiresInSeconds } = await this.otpStore.storeOtp(
      identity.id,
      identity.email,
      otp,
    );
    await this.transport(identity.email, otp, signal);
    return { expiresInSeconds };
  }

  async sendPasswordResetChallenge(
    email: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<EmailDelivery> {
    this.ready();
    if (!this.otpStore || !this.transport) {
      this.unavailable();
    }
    const otp = this.otpStore.generateOtp();
    const { expiresInSeconds } = await this.otpStore.storeOtp(
      userId,
      email,
      otp,
      600,
      'reset_password',
    );
    await this.transport(email, otp, signal);
    return { expiresInSeconds };
  }

  private unavailable(): never {
    return fail(
      503,
      'SERVICE_UNAVAILABLE',
      'Email registration is temporarily unavailable',
      [],
      true,
      5,
    );
  }
}

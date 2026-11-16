import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fail } from '../../common/http.js';
import {
  validateAuthEmailFrom,
  validateEmailWebhookUrl,
} from '../../config.js';
import type { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';
import { DatabaseService } from './database.service.js';
import { purgeOrphanedAuthByContact } from './orphaned-auth-cleanup.js';
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
  /** Optional absolute challenge expiration timestamp when provided by adapter or caller. */
  expiresAt?: Date;
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
    @Optional() private readonly abuse?: AuthAbuseControl,
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

  /**
   * Resolves the configured Supabase service role key from environment variables.
   */
  private getServiceRoleKey(): string | undefined {
    return (
      this.config?.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.config?.get<string>('SERVICE_ROLE_KEY')
    );
  }

  /**
   * Asserts that HMAC secret, service role key, Redis URL, OTP store, and email transport are configured.
   */
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

  /**
   * Looks up an existing or pending email identity in `auth.users` or `public.user_auth_providers`
   * (supporting both direct email signups and unverified OAuth users who added a secondary email via EP-A12).
   */
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
   * Purges any deleted or orphaned `auth.users` / `auth.identities` records holding `email`
   * when no active `public.users` account owns it. Returns `true` if a stale record was purged.
   */
  async purgeOrphanedByEmail(
    email: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    this.ready();
    return purgeOrphanedAuthByContact({
      channel: 'email',
      identifier: email,
      database: this.database,
      supabaseUrl: this.getSupabaseUrl(),
      serviceRoleKey: this.getServiceRoleKey(),
      signal,
      abuseControl: this.abuse,
    });
  }

  /**
   * Looks up existing registered email or pending identity from database when configured.
   * Ignores soft-deleted rows and confirmed auth orphans with no active application account.
   */
  async findByEmail(
    email: string,
    _signal?: AbortSignal,
  ): Promise<PendingEmailIdentity | null> {
    void _signal;
    this.ready();
    const normalized = email.toLowerCase().trim();
    if (!this.database) return null;
    const rows = await this.database.query(
      `SELECT u.id,
              COALESCE(p.contact_value, u.email) AS email,
              u.email_confirmed_at,
              pu.verified_contact,
              p.verified_at AS provider_verified_at,
              (pu.id IS NOT NULL) AS has_app_user,
              (u.deleted_at IS NOT NULL) AS is_deleted
         FROM auth.users u
         LEFT JOIN public.users pu ON pu.id = u.id
         LEFT JOIN public.user_auth_providers p
           ON p.user_id = u.id AND p.provider = 'email'
        WHERE u.deleted_at IS NULL
          AND (lower(u.email) = $1 OR lower(p.contact_value) = $1)
        ORDER BY
          COALESCE(lower(p.contact_value) = $1, false) DESC,
          COALESCE(COALESCE(lower(p.contact_value), lower(u.email)) = $1, false) DESC,
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
    if (
      row.is_deleted === true ||
      (row.has_app_user === false && Boolean(row.email_confirmed_at))
    ) {
      return null;
    }
    return {
      id: row.id,
      subject: row.id,
      email:
        typeof row.email === 'string' ? row.email.toLowerCase() : normalized,
      verified: Boolean(row.verified_contact || row.provider_verified_at),
    };
  }

  /**
   * Creates an unconfirmed GoTrue user via the Supabase Admin API (`email_confirm: false`),
   * self-healing any stale deleted/orphaned auth record on `422 email_exists`.
   */
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

    let response!: Response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
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
          if (
            attempt === 0 &&
            (await this.purgeOrphanedByEmail(email, signal))
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
          'Email delivery is temporarily rate-limited. Please try again later.',
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

  /**
   * Generates, persists in S1 Redis, and dispatches a 6-digit email verification OTP challenge.
   */
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

  /**
   * Generates, persists in S1 Redis (`reset_password` purpose), and dispatches a 6-digit recovery OTP challenge.
   */
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

  /**
   * Fails closed with HTTP 503 `SERVICE_UNAVAILABLE` when email verification prerequisites are unconfigured.
   */
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

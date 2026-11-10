import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryFailedError } from 'typeorm';
import type { Request } from 'express';
import { fail } from '../../common/http.js';
import { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';
import { trustedClientIp } from '../client-ip.js';
import {
  normalizeRegisterRequest,
  normalizeResendRequest,
} from '../registration.dto.js';
import { DatabaseService } from './database.service.js';
import {
  EmailRegistrationProvider,
  type PendingEmailIdentity,
} from './email-registration.provider.js';

/**
 * Wire response payload returned by EP-A01 (`POST /auth/register`) and EP-A04 (`POST /auth/resend-verification`).
 */
export interface RegistrationPendingDTO {
  verification_channel: 'email';
  contact_masked: string;
  expires_in_seconds: number;
  resend_available_at: string;
}

/**
 * Internal deadline error raised when an email provider call exceeds the 10-second timeout budget.
 */
class EmailProviderDeadlineError extends Error {}

/**
 * Masks an email address so only the first character and domain remain visible.
 */
function mask(email: string): string {
  const at = email.lastIndexOf('@');
  return `${email[0]}****${email.slice(at)}`;
}

/**
 * Coordinates email registration (EP-A01) and verification resend (EP-A04) with atomic pending-row persistence.
 */
@Injectable()
export class EmailRegistrationService {
  /**
   * Initializes the email registration service with provider, abuse-control, database, and config dependencies.
   */
  constructor(
    private readonly provider: EmailRegistrationProvider,
    private readonly abuse: AuthAbuseControl,
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Builds the public pending-verification metadata DTO with masked email and resend cooldown timestamp.
   */
  private pending(email: string, cooldown: number): RegistrationPendingDTO {
    return {
      verification_channel: 'email',
      contact_masked: mask(email),
      expires_in_seconds: 600,
      resend_available_at: new Date(Date.now() + cooldown * 1000).toISOString(),
    };
  }

  /**
   * Translates upstream email provider failures and timeouts into contract HTTP 502 or 504 errors.
   */
  private providerError(error?: unknown): never {
    if (
      error instanceof EmailProviderDeadlineError ||
      (error instanceof Error &&
        (error.name === 'AbortError' ||
          /timeout|timed out/i.test(error.message)))
    )
      fail(504, 'PROVIDER_TIMEOUT', 'Email provider timed out', [], true);
    fail(
      502,
      'EMAIL_PROVIDER_ERROR',
      'Email delivery could not be confirmed',
      [],
      true,
    );
  }

  /**
   * Enforces the email-only channel boundary for EP-A01 and EP-A04 while phone registration is gated.
   */
  private emailOnly(channel: 'email' | 'phone'): void {
    if (channel === 'phone')
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Phone registration is unavailable',
        [],
        true,
        5,
      );
  }

  /**
   * Executes a provider operation under a strict 10-second abort deadline.
   */
  private async providerCall<T>(
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        action(controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new EmailProviderDeadlineError(
                'Email provider deadline exceeded',
              ),
            );
          }, 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** A01: no session is issued; pending application rows precede confirmed delivery. */
  async register(
    body: unknown,
    request: Request,
  ): Promise<RegistrationPendingDTO> {
    const input = normalizeRegisterRequest(
      body,
      Number(this.config.get<number>('AUTH_PASSWORD_MIN_LENGTH') ?? 8),
    );
    this.emailOnly(input.channel);
    const ip = trustedClientIp(request);
    const email = input.identifier;
    // The production adapter is deliberately unavailable until its Auth and delivery gates pass.
    this.provider.ready();
    const { retryAfterSeconds } = await this.abuse.reserveSend(
      { channel: 'email', identifier: email },
      ip,
    );
    const metadata = this.pending(email, retryAfterSeconds);
    let identity: PendingEmailIdentity;
    try {
      const existing = await this.providerCall((signal) =>
        this.provider.findByEmail(email, signal),
      );
      // A pending Auth password cannot be compared through this provider port.
      // Treat every existing identity as a duplicate, regardless of the new password.
      if (existing)
        fail(409, 'CONTACT_ALREADY_REGISTERED', 'Contact already registered');
      identity = await this.providerCall((signal) =>
        this.provider.createPending(email, input.password, signal),
      );
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 409)
        throw error;
      return this.providerError(error);
    }
    if (
      identity.email !== email ||
      identity.verified ||
      !identity.id ||
      !identity.subject
    )
      return this.providerError();
    await this.persistPending(identity);
    try {
      const delivery = await this.providerCall((signal) =>
        this.provider.sendChallenge(identity, signal),
      );
      if (delivery.expiresInSeconds !== 600) return this.providerError();
    } catch (error) {
      return this.providerError(error);
    }
    return metadata;
  }

  /** A04: unknown and pending contacts share the same successful wire metadata. */
  async resend(
    body: unknown,
    request: Request,
  ): Promise<RegistrationPendingDTO> {
    const input = normalizeResendRequest(body);
    this.emailOnly(input.channel);
    const ip = trustedClientIp(request);
    const email = input.identifier;
    this.provider.ready();
    const { retryAfterSeconds } = await this.abuse.reserveSend(input, ip);
    const metadata = this.pending(email, retryAfterSeconds);
    let identity: PendingEmailIdentity | null;
    try {
      identity = await this.providerCall((signal) =>
        this.provider.findByEmail(email, signal),
      );
    } catch (error) {
      return this.providerError(error);
    }
    if (
      !identity ||
      identity.verified ||
      identity.email !== email ||
      !identity.id ||
      !identity.subject
    )
      return metadata;
    try {
      await this.persistPending(identity);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 409)
        return metadata;
      throw error;
    }
    try {
      const delivery = await this.providerCall((signal) =>
        this.provider.sendChallenge(identity, signal),
      );
      if (delivery.expiresInSeconds !== 600) return this.providerError();
    } catch (error) {
      return this.providerError(error);
    }
    return metadata;
  }

  /**
   * Persists or reconciles the unverified `public.users` and `public.user_auth_providers` rows
   * for a pending email identity without violating `uq_user_auth_providers_one_primary` when
   * an unverified OAuth user already owns a primary provider row (EP-A12 → EP-A04).
   */
  private async persistPending(identity: PendingEmailIdentity): Promise<void> {
    try {
      await this.database.transaction(
        null,
        async (db) => {
          // The UUID lock used by bootstrap is insufficient when two Auth UUIDs
          // race for the same pending email. All A01/A04 writers take this lock.
          await db.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 1))',
            [`auth:pending-email:${identity.email}`],
          );
          const [otherUser] = await db.query(
            'SELECT id FROM public.users WHERE email=$1 AND id<>$2 LIMIT 1 FOR UPDATE',
            [identity.email, identity.id],
          );
          const [otherProvider] = await db.query(
            `SELECT user_id FROM public.user_auth_providers
             WHERE provider='email' AND lower(contact_value)=$1 AND user_id<>$2
             LIMIT 1 FOR UPDATE`,
            [identity.email, identity.id],
          );
          if (otherUser || otherProvider)
            fail(
              409,
              'CONTACT_ALREADY_REGISTERED',
              'Contact already registered',
            );
          await db.query(
            `INSERT INTO public.users(id,verified_contact) VALUES($1,false)
           ON CONFLICT(id) DO NOTHING`,
            [identity.id],
          );
          const [user] = await db.query(
            'SELECT verified_contact,email,phone FROM public.users WHERE id=$1 FOR UPDATE',
            [identity.id],
          );
          if (!user || user.verified_contact || user.email || user.phone)
            fail(
              409,
              'CONTACT_ALREADY_REGISTERED',
              'Contact already registered',
            );
          await db.query(
            `INSERT INTO public.user_auth_providers
             (user_id,provider,provider_subject,contact_value,verified_at,is_primary)
           VALUES(
             $1,
             'email',
             $2,
             $3,
             NULL,
             NOT EXISTS(SELECT 1 FROM public.user_auth_providers WHERE user_id=$1 AND is_primary=true)
           )
           ON CONFLICT(user_id,provider) DO UPDATE
             SET contact_value = EXCLUDED.contact_value,
                 updated_at = now()
           WHERE public.user_auth_providers.verified_at IS NULL
             AND public.user_auth_providers.provider_subject = EXCLUDED.provider_subject
              AND (
                public.user_auth_providers.contact_value IS NULL
                OR lower(public.user_auth_providers.contact_value) = lower(EXCLUDED.contact_value)
              )`,
            [identity.id, identity.subject, identity.email],
          );
          const [mapping] = await db.query(
            `SELECT provider_subject,contact_value,verified_at
           FROM public.user_auth_providers WHERE user_id=$1 AND provider='email'`,
            [identity.id],
          );
          if (
            !mapping ||
            mapping.provider_subject !== identity.subject ||
            typeof mapping.contact_value !== 'string' ||
            mapping.contact_value.toLowerCase() !==
              identity.email.toLowerCase() ||
            mapping.verified_at
          )
            fail(
              409,
              'CONTACT_ALREADY_REGISTERED',
              'Contact already registered',
            );
        },
        false,
      );
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        error.driverError?.code === '23505'
      )
        fail(409, 'CONTACT_ALREADY_REGISTERED', 'Contact already registered');
      if (error instanceof HttpException) throw error;
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Account storage is unavailable',
        [],
        true,
        5,
      );
    }
  }
}

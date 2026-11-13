import { HttpException, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { fail } from '../../common/http.js';
import { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';
import { trustedClientIp } from '../client-ip.js';
import {
  normalizeRegisterRequest,
  normalizeResendRequest,
} from '../registration.dto.js';
import { DatabaseService } from './database.service.js';
import { isPgUniqueViolation } from './auth.service.js';
import {
  EmailRegistrationProvider,
  type PendingEmailIdentity,
} from './email-registration.provider.js';
import {
  TextBeeSmsProvider,
  type PendingPhoneIdentity,
  maskPhone,
} from './textbee-sms.provider.js';

/**
 * Wire response payload returned by EP-A01 (`POST /auth/register`) and EP-A04 (`POST /auth/resend-verification`).
 */
export interface RegistrationPendingDTO {
  verification_channel: 'email' | 'phone';
  contact_masked: string;
  expires_in_seconds: number;
  resend_available_at: string;
}

/**
 * Internal deadline error raised when a delivery provider call exceeds the 10-second timeout budget.
 */
class ProviderDeadlineError extends Error {}

/**
 * Masks an email or phone address so only non-sensitive fragments remain visible.
 */
function mask(
  identifier: string,
  channel: 'email' | 'phone' = 'email',
): string {
  if (channel === 'phone') {
    return maskPhone(identifier);
  }
  const at = identifier.lastIndexOf('@');
  return `${identifier[0]}****${identifier.slice(at)}`;
}

/**
 * Coordinates email and phone registration (EP-A01) and verification resend (EP-A04) with atomic pending-row persistence.
 */
@Injectable()
export class EmailRegistrationService {
  /**
   * Initializes registration service with email, SMS, abuse-control, database, and config dependencies.
   */
  constructor(
    private readonly provider: EmailRegistrationProvider,
    private readonly abuse: AuthAbuseControl,
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    @Optional() private readonly smsProvider?: TextBeeSmsProvider,
  ) {}

  /**
   * Builds the public pending-verification metadata DTO with masked contact and resend cooldown timestamp.
   */
  private pending(
    identifier: string,
    cooldown: number,
    channel: 'email' | 'phone' = 'email',
  ): RegistrationPendingDTO {
    return {
      verification_channel: channel,
      contact_masked: mask(identifier, channel),
      expires_in_seconds: 600,
      resend_available_at: new Date(Date.now() + cooldown * 1000).toISOString(),
    };
  }

  /**
   * Translates upstream delivery provider failures and timeouts into contract HTTP 502 or 504 errors.
   */
  private providerError(
    error?: unknown,
    channel: 'email' | 'phone' = 'email',
  ): never {
    if (
      error instanceof ProviderDeadlineError ||
      (error instanceof Error &&
        (error.name === 'AbortError' ||
          /timeout|timed out/i.test(error.message)))
    ) {
      fail(
        504,
        'PROVIDER_TIMEOUT',
        `${channel === 'phone' ? 'SMS' : 'Email'} provider timed out`,
        [],
        true,
      );
    }
    fail(
      502,
      channel === 'phone' ? 'SMS_PROVIDER_ERROR' : 'EMAIL_PROVIDER_ERROR',
      `${channel === 'phone' ? 'SMS' : 'Email'} delivery could not be confirmed`,
      [],
      true,
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
            reject(new ProviderDeadlineError('Provider deadline exceeded'));
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
    const ip = trustedClientIp(request);
    const channel = input.channel;
    const identifier = input.identifier;

    if (channel === 'phone') {
      if (!this.smsProvider) {
        fail(
          503,
          'SERVICE_UNAVAILABLE',
          'Phone registration is unavailable',
          [],
          true,
          5,
        );
      }
      this.smsProvider.ready();
      const { retryAfterSeconds } = await this.abuse.reserveSend(
        { channel: 'phone', identifier },
        ip,
      );
      const metadata = this.pending(identifier, retryAfterSeconds, 'phone');
      let identity: PendingPhoneIdentity;
      try {
        const existing = await this.providerCall((signal) =>
          this.smsProvider!.findByPhone(identifier, signal),
        );
        if (existing) {
          fail(409, 'CONTACT_ALREADY_REGISTERED', 'Contact already registered');
        }
        identity = await this.providerCall((signal) =>
          this.smsProvider!.createPending(identifier, input.password, signal),
        );
        if (identity?.phone && !identity.phone.startsWith('+')) {
          identity = { ...identity, phone: `+${identity.phone}` };
        }
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() === 409) {
          throw error;
        }
        return this.providerError(error, 'phone');
      }
      if (
        identity.phone !== identifier ||
        identity.verified ||
        !identity.id ||
        !identity.subject
      ) {
        return this.providerError(undefined, 'phone');
      }
      await this.persistPendingPhone(identity);
      try {
        const delivery = await this.providerCall((signal) =>
          this.smsProvider!.sendChallenge(identity, signal),
        );
        if (delivery.expiresInSeconds !== 600) {
          return this.providerError(undefined, 'phone');
        }
      } catch (error) {
        return this.providerError(error, 'phone');
      }
      return metadata;
    }

    // channel === 'email'
    this.provider.ready();
    const { retryAfterSeconds } = await this.abuse.reserveSend(
      { channel: 'email', identifier },
      ip,
    );
    const metadata = this.pending(identifier, retryAfterSeconds, 'email');
    let identity: PendingEmailIdentity;
    try {
      const existing = await this.providerCall((signal) =>
        this.provider.findByEmail(identifier, signal),
      );
      if (existing) {
        fail(409, 'CONTACT_ALREADY_REGISTERED', 'Contact already registered');
      }
      identity = await this.providerCall((signal) =>
        this.provider.createPending(identifier, input.password, signal),
      );
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 409) {
        throw error;
      }
      return this.providerError(error, 'email');
    }
    if (
      identity.email !== identifier ||
      identity.verified ||
      !identity.id ||
      !identity.subject
    ) {
      return this.providerError(undefined, 'email');
    }
    await this.persistPending(identity);
    try {
      const delivery = await this.providerCall((signal) =>
        this.provider.sendChallenge(identity, signal),
      );
      if (delivery.expiresInSeconds !== 600) {
        return this.providerError(undefined, 'email');
      }
    } catch (error) {
      return this.providerError(error, 'email');
    }
    return metadata;
  }

  /** A04: unknown and pending contacts share the same successful wire metadata. */
  async resend(
    body: unknown,
    request: Request,
  ): Promise<RegistrationPendingDTO> {
    const input = normalizeResendRequest(body);
    const ip = trustedClientIp(request);
    const channel = input.channel;
    const identifier = input.identifier;

    if (channel === 'phone') {
      if (!this.smsProvider) {
        fail(
          503,
          'SERVICE_UNAVAILABLE',
          'Phone registration is unavailable',
          [],
          true,
          5,
        );
      }
      this.smsProvider.ready();
      const { retryAfterSeconds } = await this.abuse.reserveSend(input, ip);
      const metadata = this.pending(identifier, retryAfterSeconds, 'phone');
      let identity: PendingPhoneIdentity | null;
      try {
        identity = await this.providerCall((signal) =>
          this.smsProvider!.findByPhone(identifier, signal),
        );
        if (identity?.phone && !identity.phone.startsWith('+')) {
          identity = { ...identity, phone: `+${identity.phone}` };
        }
      } catch (error) {
        return this.providerError(error, 'phone');
      }
      if (
        !identity ||
        identity.verified ||
        identity.phone !== identifier ||
        !identity.id ||
        !identity.subject
      ) {
        if (typeof this.smsProvider.checkDeliveryHealth === 'function') {
          try {
            await this.providerCall((signal) =>
              this.smsProvider!.checkDeliveryHealth!(signal),
            );
          } catch (error) {
            return this.providerError(error, 'phone');
          }
        }
        return metadata;
      }
      try {
        await this.persistPendingPhone(identity);
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() === 409) {
          return metadata;
        }
        throw error;
      }
      try {
        const delivery = await this.providerCall((signal) =>
          this.smsProvider!.sendChallenge(identity, signal),
        );
        if (delivery.expiresInSeconds !== 600) {
          return this.providerError(undefined, 'phone');
        }
      } catch (error) {
        return this.providerError(error, 'phone');
      }
      return metadata;
    }

    // channel === 'email'
    this.provider.ready();
    const { retryAfterSeconds } = await this.abuse.reserveSend(input, ip);
    const metadata = this.pending(identifier, retryAfterSeconds, 'email');
    let identity: PendingEmailIdentity | null;
    try {
      identity = await this.providerCall((signal) =>
        this.provider.findByEmail(identifier, signal),
      );
    } catch (error) {
      return this.providerError(error, 'email');
    }
    if (
      !identity ||
      identity.verified ||
      identity.email !== identifier ||
      !identity.id ||
      !identity.subject
    ) {
      return metadata;
    }
    try {
      await this.persistPending(identity);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 409) {
        return metadata;
      }
      throw error;
    }
    try {
      const delivery = await this.providerCall((signal) =>
        this.provider.sendChallenge(identity, signal),
      );
      if (delivery.expiresInSeconds !== 600) {
        return this.providerError(undefined, 'email');
      }
    } catch (error) {
      return this.providerError(error, 'email');
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
          await db.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
            identity.id,
          ]);
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
          if (otherUser || otherProvider) {
            fail(
              409,
              'CONTACT_ALREADY_REGISTERED',
              'Contact already registered',
            );
          }
          await db.query(
            `INSERT INTO public.users(id,verified_contact) VALUES($1,false)
           ON CONFLICT(id) DO NOTHING`,
            [identity.id],
          );
          const [user] = await db.query(
            'SELECT verified_contact,email,phone FROM public.users WHERE id=$1 FOR UPDATE',
            [identity.id],
          );
          if (!user || user.verified_contact || user.email || user.phone) {
            fail(
              409,
              'CONTACT_ALREADY_REGISTERED',
              'Contact already registered',
            );
          }
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
          ) {
            fail(
              409,
              'CONTACT_ALREADY_REGISTERED',
              'Contact already registered',
            );
          }
        },
        false,
      );
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        fail(409, 'CONTACT_ALREADY_REGISTERED', 'Contact already registered');
      }
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

  /**
   * Persists or reconciles the unverified `public.users` and `public.user_auth_providers` rows
   * for a pending phone identity with advisory transaction locks and primary provider tracking.
   */
  private async persistPendingPhone(
    identity: PendingPhoneIdentity,
  ): Promise<void> {
    try {
      await this.database.transaction(
        null,
        async (db) => {
          await db.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
            identity.id,
          ]);
          await db.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 1))',
            [`auth:pending-phone:${identity.phone}`],
          );
          const [otherUser] = await db.query(
            "SELECT id FROM public.users WHERE (phone=$1 OR phone=ltrim($1, '+')) AND id<>$2 LIMIT 1 FOR UPDATE",
            [identity.phone, identity.id],
          );
          const [otherProvider] = await db.query(
            `SELECT user_id FROM public.user_auth_providers
             WHERE provider='phone' AND (contact_value=$1 OR contact_value=ltrim($1, '+')) AND user_id<>$2
             LIMIT 1 FOR UPDATE`,
            [identity.phone, identity.id],
          );
          if (otherUser || otherProvider) {
            fail(
              409,
              'CONTACT_ALREADY_REGISTERED',
              'Contact already registered',
            );
          }
          await db.query(
            `INSERT INTO public.users(id,verified_contact) VALUES($1,false)
           ON CONFLICT(id) DO NOTHING`,
            [identity.id],
          );
          const [user] = await db.query(
            'SELECT verified_contact,email,phone FROM public.users WHERE id=$1 FOR UPDATE',
            [identity.id],
          );
          if (!user || user.verified_contact || user.email || user.phone) {
            fail(
              409,
              'CONTACT_ALREADY_REGISTERED',
              'Contact already registered',
            );
          }
          await db.query(
            `INSERT INTO public.user_auth_providers
             (user_id,provider,provider_subject,contact_value,verified_at,is_primary)
           VALUES(
             $1,
             'phone',
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
                OR public.user_auth_providers.contact_value = EXCLUDED.contact_value
                OR public.user_auth_providers.contact_value = ltrim(EXCLUDED.contact_value, '+')
                OR ltrim(public.user_auth_providers.contact_value, '+') = ltrim(EXCLUDED.contact_value, '+')
              )`,
            [identity.id, identity.subject, identity.phone],
          );
          const [mapping] = await db.query(
            `SELECT provider_subject,contact_value,verified_at
           FROM public.user_auth_providers WHERE user_id=$1 AND provider='phone'`,
            [identity.id],
          );
          const mappingContact =
            typeof mapping?.contact_value === 'string'
              ? mapping.contact_value.startsWith('+')
                ? mapping.contact_value
                : `+${mapping.contact_value}`
              : '';
          if (
            !mapping ||
            mapping.provider_subject !== identity.subject ||
            mappingContact !== identity.phone ||
            mapping.verified_at
          ) {
            fail(
              409,
              'CONTACT_ALREADY_REGISTERED',
              'Contact already registered',
            );
          }
        },
        false,
      );
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        fail(409, 'CONTACT_ALREADY_REGISTERED', 'Contact already registered');
      }
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

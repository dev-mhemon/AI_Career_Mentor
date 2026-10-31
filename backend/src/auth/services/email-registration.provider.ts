import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fail } from '../../common/http.js';
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

/** A provider implementation must reconcile ambiguous creation before returning an identity. */
@Injectable()
export class EmailRegistrationProvider {
  private transport?: EmailDispatchTransport;

  constructor(
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly database?: DatabaseService,
    @Optional() private readonly otpStore?: OtpSecretStore,
  ) {}

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

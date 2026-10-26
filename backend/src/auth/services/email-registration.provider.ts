import { Injectable } from '@nestjs/common';
import { fail } from '../../common/http.js';

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

/** A provider implementation must reconcile ambiguous creation before returning an identity. */
@Injectable()
export class EmailRegistrationProvider {
  ready(): void {
    this.unavailable();
  }

  async findByEmail(
    _email: string,
    _signal: AbortSignal,
  ): Promise<PendingEmailIdentity | null> {
    void _email;
    void _signal;
    return this.unavailable();
  }

  async createPending(
    _email: string,
    _password: string,
    _signal: AbortSignal,
  ): Promise<PendingEmailIdentity> {
    void _email;
    void _password;
    void _signal;
    return this.unavailable();
  }

  async sendChallenge(
    _identity: PendingEmailIdentity,
    _signal: AbortSignal,
  ): Promise<EmailDelivery> {
    void _identity;
    void _signal;
    return this.unavailable();
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

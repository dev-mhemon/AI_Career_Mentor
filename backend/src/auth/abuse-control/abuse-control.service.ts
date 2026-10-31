import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { createClient } from 'redis';
import { fail } from '../../common/http.js';
import type { AbuseConfiguration } from './config.js';
import {
  sendScript,
  issueScript,
  challengeScript,
  loginScript,
  policyGuard,
} from './scripts.js';

export const AUTH_ABUSE_CONFIGURATION = Symbol('AUTH_ABUSE_CONFIGURATION');
type ScriptResult = [number, number, string?];
export interface Contact {
  channel: 'email' | 'phone';
  /** Validated, lower-cased email or normalized +880 phone, supplied by the caller. */
  identifier: string;
}

@Injectable()
export class AuthAbuseControl implements OnModuleDestroy {
  private client?: ReturnType<typeof createClient>;
  private connecting?: Promise<unknown>;
  private stopped = false;

  constructor(
    @Inject(AUTH_ABUSE_CONFIGURATION)
    private readonly configuration: AbuseConfiguration | undefined,
  ) {}

  private unavailable(
    seconds = this.configuration?.policy.AUTH_REDIS_RETRY_SECONDS ?? 5,
  ): never {
    fail(
      503,
      'SERVICE_UNAVAILABLE',
      'Authentication temporarily unavailable',
      [],
      true,
      seconds,
    );
  }

  private digest(kind: string, value: unknown): string {
    if (!this.configuration) this.unavailable();
    return createHmac('sha256', this.configuration.secret)
      .update(JSON.stringify([kind, value]))
      .digest('hex');
  }

  private contactKey(contact: Contact): string {
    if (
      !['email', 'phone'].includes(contact.channel) ||
      !contact.identifier ||
      contact.identifier !== contact.identifier.trim() ||
      (contact.channel === 'email' &&
        contact.identifier !== contact.identifier.toLowerCase()) ||
      (contact.channel === 'phone' &&
        !/^\+8801[3-9][0-9]{8}$/.test(contact.identifier))
    )
      throw new Error('Auth abuse control requires a normalized contact');
    return this.digest('contact', [contact.channel, contact.identifier]);
  }

  private ipKey(ip: string): string {
    if (!isIP(ip) || ip.includes('%'))
      throw new Error('Auth abuse control requires a validated client IP');
    let canonical =
      isIP(ip) === 6 ? new URL(`http://[${ip}]`).hostname.slice(1, -1) : ip;
    const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
    if (mapped) {
      const bytes = mapped.slice(1).map((part) => parseInt(part, 16));
      canonical = [
        bytes[0] >> 8,
        bytes[0] & 255,
        bytes[1] >> 8,
        bytes[1] & 255,
      ].join('.');
    }
    return this.digest('ip', canonical);
  }

  private async getConnectedClient(): Promise<ReturnType<typeof createClient>> {
    if (!this.configuration || this.stopped) this.unavailable();
    const timeout = this.configuration.policy.AUTH_REDIS_TIMEOUT_MS;
    try {
      if (!this.client) {
        this.client = createClient({
          url: this.configuration.url,
          disableOfflineQueue: true,
          socket: { connectTimeout: timeout, reconnectStrategy: false },
        });
        // Error events may contain credentials or connection details. Never log their payload.
        this.client.on('error', () => undefined);
      }
      const client = this.client;
      if (!client.isReady) {
        this.connecting ??= client.connect().finally(() => {
          this.connecting = undefined;
        });
        await this.withDeadline(this.connecting, timeout);
      }
      return client;
    } catch {
      if (this.client?.isOpen) this.client.destroy();
      this.client = undefined;
      this.unavailable();
    }
  }

  private async evaluate(
    script: string,
    keys: string[],
    args: (string | number)[],
  ): Promise<ScriptResult> {
    if (!this.configuration || this.stopped) this.unavailable();
    const policy = this.configuration.policy;
    const timeout = policy.AUTH_REDIS_TIMEOUT_MS;
    const policyEntries = Object.entries(policy).filter(
      ([name]) => !name.startsWith('AUTH_REDIS_'),
    );
    const fingerprint = this.digest('policy', policyEntries);
    const lifetime =
      Math.max(
        policy.AUTH_OTP_TTL_SECONDS,
        policy.AUTH_RESEND_COOLDOWN_SECONDS,
        policy.AUTH_SEND_WINDOW_SECONDS,
        policy.AUTH_LOGIN_WINDOW_SECONDS,
        policy.AUTH_LOGIN_LOCKOUT_SECONDS,
      ) * 1000;
    const policyKey = `auth:v1:policy:${this.digest('policy-namespace', 'v1')}`;
    try {
      const client = await this.getConnectedClient();
      return (await this.withDeadline(
        client.withCommandOptions({ timeout }).eval(policyGuard + script, {
          keys: [...keys, policyKey],
          arguments: [fingerprint, String(lifetime), ...args.map(String)],
        }),
        timeout,
      )) as ScriptResult;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // An ambiguous command is never replayed here. It may already have changed state.
      if (this.client?.isOpen) this.client.destroy();
      this.client = undefined;
      this.unavailable();
    }
  }

  /** The driver's queue timeout ends on socket write; this also bounds reply/handshake waits. */
  private async withDeadline<T>(
    operation: Promise<T>,
    milliseconds: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Auth Redis deadline exceeded')),
            milliseconds,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private check([code, milliseconds]: ScriptResult): void {
    const retry = Math.max(1, Math.ceil(milliseconds / 1000));
    switch (code) {
      case 0:
        return;
      case 1:
        return fail(
          429,
          'RESEND_COOLDOWN_ACTIVE',
          'Wait before requesting another code',
          [],
          true,
          retry,
        );
      case 2:
        return fail(
          429,
          'OTP_LIMIT_EXCEEDED',
          'Verification send limit reached',
          [],
          true,
          retry,
        );
      case 3:
        return fail(
          410,
          'VERIFICATION_CODE_EXPIRED',
          'Verification challenge expired',
        );
      case 4:
        return fail(
          409,
          'ALREADY_VERIFIED',
          'Verification challenge already consumed',
        );
      case 5:
        return fail(
          429,
          'VERIFICATION_ATTEMPTS_EXCEEDED',
          'Verification attempt limit reached',
          [],
          true,
          retry,
        );
      case 6:
        return this.unavailable(retry);
      case 7:
        return fail(
          422,
          'VERIFICATION_CODE_INVALID',
          'Verification code is invalid',
        );
      case 8:
        return fail(
          423,
          'ACCOUNT_LOCKED',
          'Login temporarily locked',
          [],
          true,
          retry,
        );
      case 9:
        return fail(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
      default:
        return this.unavailable();
    }
  }

  /** Reserve before provider delivery, including unknown contacts. Delivery failure does not refund quota. */
  async reserveSend(
    contact: Contact,
    ip: string,
  ): Promise<{ retryAfterSeconds: number }> {
    const id = this.contactKey(contact);
    const address = this.ipKey(ip);
    if (!this.configuration) this.unavailable();
    const p = this.configuration.policy;
    const result = await this.evaluate(
      sendScript,
      [
        `auth:v1:send:cooldown:${id}`,
        `auth:v1:send:contact:${id}`,
        `auth:v1:send:ip:${address}`,
      ],
      [
        p.AUTH_RESEND_COOLDOWN_SECONDS * 1000,
        p.AUTH_SEND_CONTACT_LIMIT,
        p.AUTH_SEND_IP_LIMIT,
        p.AUTH_SEND_WINDOW_SECONDS * 1000,
      ],
    );
    this.check(result);
    return { retryAfterSeconds: Math.ceil(result[1] / 1000) };
  }

  /** Store only an opaque generation and attempt state, never the OTP or its digest. */
  async issueChallenge(
    contact: Contact,
    providerValiditySeconds?: number,
  ): Promise<{ expiresInSeconds: number }> {
    if (!this.configuration) this.unavailable();
    const validity =
      providerValiditySeconds ?? this.configuration.policy.AUTH_OTP_TTL_SECONDS;
    if (!Number.isSafeInteger(validity) || validity <= 0)
      throw new Error('Invalid provider challenge validity');
    const ttl = Math.min(
      validity,
      this.configuration.policy.AUTH_OTP_TTL_SECONDS,
    );
    const generation = randomUUID();
    this.check(
      await this.evaluate(
        issueScript,
        [`auth:v1:challenge:${this.contactKey(contact)}`],
        [generation, ttl * 1000],
      ),
    );
    return { expiresInSeconds: ttl };
  }

  isReady(): boolean {
    return Boolean(this.configuration && !this.stopped);
  }

  async setOtpSecret(
    userId: string,
    digestHex: string,
    ttlSeconds = 600,
  ): Promise<void> {
    if (!this.configuration || this.stopped) this.unavailable();
    const timeout = this.configuration.policy.AUTH_REDIS_TIMEOUT_MS;
    const key = `auth:v1:otp:secret:${userId}`;
    try {
      const client = await this.getConnectedClient();
      await this.withDeadline(
        client.withCommandOptions({ timeout }).set(key, digestHex, {
          EX: ttlSeconds,
        }),
        timeout,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (this.client?.isOpen) this.client.destroy();
      this.client = undefined;
      this.unavailable();
    }
  }

  async getOtpSecret(userId: string): Promise<string | null> {
    if (!this.configuration || this.stopped) this.unavailable();
    const timeout = this.configuration.policy.AUTH_REDIS_TIMEOUT_MS;
    const key = `auth:v1:otp:secret:${userId}`;
    try {
      const client = await this.getConnectedClient();
      const val = await this.withDeadline(
        client.withCommandOptions({ timeout }).get(key),
        timeout,
      );
      return val ?? null;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (this.client?.isOpen) this.client.destroy();
      this.client = undefined;
      this.unavailable();
    }
  }

  async deleteOtpSecret(userId: string): Promise<void> {
    if (!this.configuration || this.stopped) this.unavailable();
    const timeout = this.configuration.policy.AUTH_REDIS_TIMEOUT_MS;
    const key = `auth:v1:otp:secret:${userId}`;
    try {
      const client = await this.getConnectedClient();
      await this.withDeadline(
        client.withCommandOptions({ timeout }).del(key),
        timeout,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (this.client?.isOpen) this.client.destroy();
      this.client = undefined;
      this.unavailable();
    }
  }

  /** The code exists only in memory; Redis reserves the current generation before provider verification. */
  async verifyChallenge(
    contact: Contact,
    code: string,
    verify: (code: string) => Promise<boolean>,
    secretKey?: string,
  ): Promise<void> {
    if (!this.configuration) this.unavailable();
    if (!/^[0-9]{6}$/.test(code))
      fail(
        422,
        'VALIDATION_FAILED',
        'Verification code must contain six digits',
        [
          {
            field: 'code',
            code: 'VALIDATION_FAILED',
            message: 'Enter a six-digit verification code',
          },
        ],
      );
    const keys = [`auth:v1:challenge:${this.contactKey(contact)}`];
    if (secretKey) keys.push(secretKey);
    const attempt = randomUUID();
    const max = this.configuration.policy.AUTH_OTP_MAX_FAILURES;
    const begin = await this.evaluate(challengeScript, keys, [
      '',
      attempt,
      'begin',
      max,
    ]);
    this.check(begin);
    const generation = begin[2];
    if (!generation) this.unavailable();
    let valid: boolean;
    try {
      valid = await verify(code);
    } catch (err) {
      if (err instanceof HttpException) {
        await this.evaluate(challengeScript, keys, [
          generation,
          attempt,
          'abort',
          max,
        ]).catch(() => undefined);
        throw err;
      }
      this.unavailable(Math.max(1, Math.ceil(begin[1] / 1000)));
    }
    this.check(
      await this.evaluate(challengeScript, keys, [
        generation,
        attempt,
        valid ? 'valid' : 'invalid',
        max,
      ]),
    );
  }

  /** Serialize provider calls per identifier+IP so racing failures cannot bypass lockout. */
  async login<T>(
    contact: Contact,
    ip: string,
    authenticate: () => Promise<
      { success: true; value: T } | { success: false }
    >,
  ): Promise<T> {
    if (!this.configuration) this.unavailable();
    const pair = this.digest('login-pair', [
      this.contactKey(contact),
      this.ipKey(ip),
    ]);
    const keys = ['failures', 'lock', 'busy'].map(
      (kind) => `auth:v1:login:${kind}:${pair}`,
    );
    const attempt = randomUUID();
    const p = this.configuration.policy;
    const args = [
      attempt,
      p.AUTH_LOGIN_MAX_FAILURES,
      p.AUTH_LOGIN_WINDOW_SECONDS * 1000,
      p.AUTH_LOGIN_LOCKOUT_SECONDS * 1000,
    ];
    this.check(await this.evaluate(loginScript, keys, ['begin', ...args]));
    let result: { success: true; value: T } | { success: false };
    try {
      result = await authenticate();
    } catch {
      this.unavailable(p.AUTH_LOGIN_WINDOW_SECONDS);
    }
    this.check(
      await this.evaluate(loginScript, keys, [
        result.success ? 'valid' : 'invalid',
        ...args,
      ]),
    );
    if (!result.success) this.unavailable();
    return result.value;
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.client?.isOpen) this.client.destroy();
    this.client = undefined;
  }
}

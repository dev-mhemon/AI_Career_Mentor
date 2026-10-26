import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { EmailRegistrationService } from './email-registration.service.js';
import {
  EmailRegistrationProvider,
  type PendingEmailIdentity,
} from './email-registration.provider.js';
import type { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';
import type { DatabaseService } from './database.service.js';
import type { ConfigService } from '@nestjs/config';

const testEmail = 'synthetic.candidate@example.invalid';
const testIdentity: PendingEmailIdentity = {
  id: '00000000-0000-4000-8000-000000000001',
  subject: 'synthetic-candidate-subject',
  email: testEmail,
  verified: false,
};

const registerBody = {
  email: testEmail,
  phone: null,
  password: 'Synthetic!Password123',
  confirm_password: 'Synthetic!Password123',
  privacy_consent: true,
};

const peerRequest = {
  socket: { remoteAddress: '192.0.2.100' },
  ip: '192.0.2.100',
  ips: [],
  headers: {},
  app: { get: () => () => false },
} as unknown as Request;

function createTestHarness() {
  const provider = {
    ready: vi.fn(),
    findByEmail: vi.fn().mockResolvedValue(null),
    createPending: vi.fn().mockResolvedValue(testIdentity),
    sendChallenge: vi.fn().mockResolvedValue({ expiresInSeconds: 600 }),
  };

  const abuse = {
    reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
    issueChallenge: vi.fn().mockResolvedValue({ expiresInSeconds: 600 }),
    verifyChallenge: vi.fn().mockResolvedValue(undefined),
  };

  const executedQueries: Array<{ sql: string; params?: unknown[] }> = [];
  const queryHandler = vi.fn(async (sql: string, params?: unknown[]) => {
    executedQueries.push({ sql, params });
    if (sql.includes('SELECT verified_contact,email,phone FROM public.users')) {
      return [{ verified_contact: false, email: null, phone: null }];
    }
    if (sql.includes('SELECT provider_subject,contact_value,verified_at')) {
      return [
        {
          provider_subject: testIdentity.subject,
          contact_value: testEmail,
          verified_at: null,
        },
      ];
    }
    return [];
  });

  const database = {
    transaction: vi.fn(
      async (
        _id: string | null,
        op: (db: { query: typeof queryHandler }) => Promise<unknown>,
      ) => op({ query: queryHandler }),
    ),
  };

  const config = {
    get: vi.fn((key: string) => {
      if (key === 'AUTH_PASSWORD_MIN_LENGTH') return 8;
      return undefined;
    }),
  };

  const service = new EmailRegistrationService(
    provider as unknown as EmailRegistrationProvider,
    abuse as unknown as AuthAbuseControl,
    database as unknown as DatabaseService,
    config as unknown as ConfigService,
  );

  return { provider, abuse, queryHandler, executedQueries, database, service };
}

describe('M01-03 Authority Boundary & Provider Characterization (Synthetic)', () => {
  describe('B1: Service abuse-control invocation boundary', () => {
    it('calls mocked reserveSend and does not invoke issueChallenge or verifyChallenge during registration', async () => {
      const { service, abuse, provider } = createTestHarness();

      // Calling register triggers abuse.reserveSend
      await service.register(registerBody, peerRequest);

      // reserveSend is called with channel and identifier
      expect(abuse.reserveSend).toHaveBeenCalledWith(
        { channel: 'email', identifier: testEmail },
        '192.0.2.100',
      );

      // The service does not invoke issueChallenge or verifyChallenge during registration;
      // OTP generation and revocation are not managed by Redis reservation keys.
      expect(abuse.issueChallenge).not.toHaveBeenCalled();
      expect(abuse.verifyChallenge).not.toHaveBeenCalled();

      // Provider sendChallenge receives the identity, but provider-side revocation behavior
      // for prior tokens is unexercised and UNKNOWN.
      expect(provider.sendChallenge).toHaveBeenCalledWith(
        testIdentity,
        expect.any(AbortSignal),
      );
    });
  });

  describe('B2: Conditional identity handling on mock existing identity', () => {
    it('exercises conditional same-UUID parameter passing when provider mock returns existing identity', async () => {
      const { service, provider, database, executedQueries } =
        createTestHarness();

      // Step 1: Simulate A01 where provider created user, but database threw an error
      provider.findByEmail.mockResolvedValueOnce(null);
      provider.createPending.mockResolvedValueOnce(testIdentity);
      database.transaction.mockRejectedValueOnce(
        new HttpException({ code: 'SERVICE_UNAVAILABLE' }, 503),
      );

      await expect(
        service.register(registerBody, peerRequest),
      ).rejects.toMatchObject({
        status: 503,
      });

      // Step 2: Subsequent A01 retry with a DIFFERENT password
      // Provider mock now reports the identity already exists
      provider.findByEmail.mockResolvedValue(testIdentity);

      const retryBodyWithDifferentPassword = {
        ...registerBody,
        password: 'Different!Password456',
        confirm_password: 'Different!Password456',
      };

      // Service rejects with 409 duplicate without inspecting password or calling createPending
      await expect(
        service.register(retryBodyWithDifferentPassword, peerRequest),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'CONTACT_ALREADY_REGISTERED' },
      });
      expect(provider.createPending).toHaveBeenCalledTimes(1);

      // Step 3: A04 resend is triggered
      const resendResult = await service.resend(
        { channel: 'email', contact: testEmail },
        peerRequest,
      );

      expect(resendResult).toMatchObject({
        verification_channel: 'email',
        contact_masked: 's****@example.invalid',
        expires_in_seconds: 600,
      });

      // Verify that persistPending received the exact UUID returned by findByEmail
      const insertUserQuery = executedQueries.find((q) =>
        q.sql.includes('INSERT INTO public.users'),
      );
      expect(insertUserQuery).toBeDefined();
      expect(insertUserQuery?.params?.[0]).toBe(testIdentity.id);

      const insertProviderQuery = executedQueries.find((q) =>
        q.sql.includes('INSERT INTO public.user_auth_providers'),
      );
      expect(insertProviderQuery).toBeDefined();
      expect(insertProviderQuery?.params?.[0]).toBe(testIdentity.id);
      expect(insertProviderQuery?.params?.[1]).toBe(testIdentity.subject);
    });
  });

  describe('B5: Anti-enumeration observable status and failure discrepancy', () => {
    it('observes that unknown contacts invoke Redis reservation and provider.findByEmail but exit without DB transaction or sendChallenge', async () => {
      const { service, provider, database, abuse } = createTestHarness();

      // Unknown contact
      provider.findByEmail.mockResolvedValueOnce(null);
      await service.resend(
        { channel: 'email', contact: 'unknown@example.invalid' },
        peerRequest,
      );

      // Verify that Redis reservation and provider lookup occurred with expected arguments
      expect(abuse.reserveSend).toHaveBeenCalledWith(
        { channel: 'email', identifier: 'unknown@example.invalid' },
        '192.0.2.100',
      );
      expect(provider.findByEmail).toHaveBeenCalledWith(
        'unknown@example.invalid',
        expect.any(AbortSignal),
      );

      // Exits early: 0 database transactions, 0 provider sendChallenge calls (Redis reservation and findByEmail occur)
      expect(database.transaction).not.toHaveBeenCalled();
      expect(provider.sendChallenge).not.toHaveBeenCalled();

      // Pending contact: executes DB transaction and calls provider sendChallenge
      provider.findByEmail.mockResolvedValueOnce(testIdentity);
      await service.resend(
        { channel: 'email', contact: testEmail },
        peerRequest,
      );

      expect(database.transaction).toHaveBeenCalledTimes(1);
      expect(provider.sendChallenge).toHaveBeenCalledTimes(1);
    });

    it('observes failure discrepancy: provider delivery failure causes 502 for pending vs 200 for unknown', async () => {
      const { service, provider } = createTestHarness();

      // Provider delivery service is failing (e.g. SMTP outage / 502)
      provider.sendChallenge.mockRejectedValue(
        new Error('SMTP connection failed'),
      );

      // 1. Unknown contact: returns 200 success because it exits before provider delivery
      provider.findByEmail.mockResolvedValueOnce(null);
      const unknownResult = await service.resend(
        { channel: 'email', contact: 'unknown@example.invalid' },
        peerRequest,
      );
      expect(unknownResult.verification_channel).toBe('email');

      // 2. Pending contact: throws 502 EMAIL_PROVIDER_ERROR
      provider.findByEmail.mockResolvedValueOnce(testIdentity);
      await expect(
        service.resend({ channel: 'email', contact: testEmail }, peerRequest),
      ).rejects.toMatchObject({
        status: 502,
        response: { code: 'EMAIL_PROVIDER_ERROR' },
      });
    });

    it('observes failure discrepancy: database outage causes 503 for pending vs 200 for unknown', async () => {
      const { service, provider, database } = createTestHarness();

      // Database is unavailable
      database.transaction.mockRejectedValue(
        new HttpException({ code: 'SERVICE_UNAVAILABLE' }, 503),
      );

      // 1. Unknown contact: returns 200 (never touches DB)
      provider.findByEmail.mockResolvedValueOnce(null);
      const unknownResult = await service.resend(
        { channel: 'email', contact: 'unknown@example.invalid' },
        peerRequest,
      );
      expect(unknownResult.verification_channel).toBe('email');

      // 2. Pending contact: throws 503
      provider.findByEmail.mockResolvedValueOnce(testIdentity);
      await expect(
        service.resend({ channel: 'email', contact: testEmail }, peerRequest),
      ).rejects.toMatchObject({
        status: 503,
      });
    });
  });

  describe('B6: Advisory-lock query parameterization and participating writer scope', () => {
    it('characterizes that persistPending takes an advisory lock scoped to participating A01/A04 writers', async () => {
      const { service, executedQueries } = createTestHarness();

      await service.register(registerBody, peerRequest);

      // Inspect the exact advisory lock SQL query and parameter
      const lockQuery = executedQueries.find((q) =>
        q.sql.includes('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))'),
      );

      expect(lockQuery).toBeDefined();
      expect(lockQuery?.params?.[0]).toBe(`auth:pending-email:${testEmail}`);

      // Characterization:
      // This lock key formula is specific to EmailRegistrationService.persistPending.
      // Other database write paths (such as DatabaseService.transaction locking hashtextextended(userId, 0))
      // and direct SQL writers do not acquire this key.
      // Concurrency protection is strictly conditional on participating writers, not a global SQL constraint.
    });
  });
});

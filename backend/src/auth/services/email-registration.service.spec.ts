import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { EmailRegistrationService } from './email-registration.service.js';
import { EmailRegistrationProvider } from './email-registration.provider.js';
import type { PendingEmailIdentity } from './email-registration.provider.js';
import type {
  TextBeeSmsProvider,
  PendingPhoneIdentity,
} from './textbee-sms.provider.js';
import type { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';
import type { DatabaseService } from './database.service.js';
import type { ConfigService } from '@nestjs/config';
import { QueryFailedError } from 'typeorm';

const email = 'person@example.invalid';
const identity: PendingEmailIdentity = {
  id: '00000000-0000-4000-8000-000000000001',
  subject: 'synthetic-email-subject',
  email,
  verified: false,
};
const body = {
  email: ' Person@Example.Invalid ',
  phone: null,
  password: 'Synthetic!Pass123',
  confirm_password: 'Synthetic!Pass123',
  privacy_consent: true,
};
const peer = {
  socket: { remoteAddress: '192.0.2.4' },
  ip: '192.0.2.4',
  ips: [],
  headers: {},
  app: { get: () => () => false },
} as unknown as Request;

const phone = '+8801712345678';
const phoneIdentity: PendingPhoneIdentity = {
  id: '00000000-0000-4000-8000-000000000002',
  subject: 'synthetic-phone-subject',
  phone,
  verified: false,
};
const phoneBody = {
  email: null,
  phone: ' 01712345678 ',
  password: 'Synthetic!Pass123',
  confirm_password: 'Synthetic!Pass123',
  privacy_consent: true,
};

function harness() {
  const provider = {
    ready: vi.fn(),
    findByEmail: vi.fn().mockResolvedValue(null),
    createPending: vi.fn().mockResolvedValue(identity),
    sendChallenge: vi.fn().mockResolvedValue({ expiresInSeconds: 600 }),
  };
  const smsProvider = {
    ready: vi.fn(),
    findByPhone: vi.fn().mockResolvedValue(null),
    createPending: vi.fn().mockResolvedValue(phoneIdentity),
    sendChallenge: vi.fn().mockResolvedValue({ expiresInSeconds: 600 }),
    checkDeliveryHealth: vi.fn().mockResolvedValue(undefined),
  };
  const abuse = {
    reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
  };
  const queries = vi.fn(
    async (sql: string, params?: unknown[]): Promise<any[]> => {
      if (sql.includes('FROM auth.users') && sql.includes('FOR UPDATE')) {
        const isPhone = params?.[0] === phoneIdentity.id;
        return [
          {
            id: params?.[0],
            email: isPhone ? null : email,
            phone: isPhone ? phone : null,
            email_confirmed_at: null,
            phone_confirmed_at: null,
          },
        ];
      }
      if (sql.startsWith('SELECT verified_contact FROM public.users')) {
        return [{ verified_contact: false }];
      }
      if (sql.includes('SELECT provider,provider_subject')) {
        const isPhone = params?.[0] === phoneIdentity.id;
        return [
          {
            provider: isPhone ? 'phone' : 'email',
            provider_subject: isPhone
              ? phoneIdentity.subject
              : identity.subject,
            contact_value: isPhone ? phone : email,
            verified_at: null,
          },
        ];
      }
      if (sql.includes('FROM auth.identities')) return [];
      if (sql.startsWith('UPDATE auth.users')) return [{ id: params?.[0] }];
      if (sql.startsWith('SELECT verified_contact'))
        return [{ verified_contact: false, email: null, phone: null }];
      if (sql.startsWith('SELECT provider_subject')) {
        if (sql.includes("provider='phone'")) {
          return [
            {
              provider_subject: phoneIdentity.subject,
              contact_value: phone,
              verified_at: null,
            },
          ];
        }
        return [
          {
            provider_subject: identity.subject,
            contact_value: email,
            verified_at: null,
          },
        ];
      }
      return [];
    },
  );
  const database = {
    transaction: vi.fn(
      async (
        _id: string | null,
        operation: (db: { query: typeof queries }) => Promise<unknown>,
      ) => operation({ query: queries }),
    ),
  };
  const service = new EmailRegistrationService(
    provider as unknown as EmailRegistrationProvider,
    abuse as unknown as AuthAbuseControl,
    database as unknown as DatabaseService,
    { get: () => undefined } as unknown as ConfigService,
    smsProvider as unknown as TextBeeSmsProvider,
  );
  return { provider, smsProvider, abuse, queries, database, service };
}

async function rejection(
  action: () => Promise<unknown>,
  status: number,
  code: string,
) {
  try {
    await action();
    expect.fail('Expected a contract error');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    expect((error as HttpException).getResponse()).toMatchObject({ code });
  }
}

describe('A01/A04 email service with synthetic provider', () => {
  it('creates only pending rows before confirmed challenge delivery and returns no session', async () => {
    const { service, provider, abuse, queries } = harness();
    const result = await service.register(body, peer);
    expect(result).toMatchObject({
      verification_channel: 'email',
      contact_masked: 'p****@example.invalid',
      expires_in_seconds: 600,
    });
    expect(result).not.toHaveProperty('access_token');
    expect(abuse.reserveSend).toHaveBeenCalledWith(
      { channel: 'email', identifier: email },
      '192.0.2.4',
    );
    expect(provider.createPending).toHaveBeenCalledWith(
      email,
      body.password,
      expect.any(AbortSignal),
    );
    expect(queries.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining('pg_advisory_xact_lock(hashtext($1::text))'),
      expect.stringContaining('pg_advisory_xact_lock(hashtextextended($1, 1))'),
      expect.stringContaining('SELECT id FROM public.users'),
      expect.stringContaining('SELECT user_id FROM public.user_auth_providers'),
      expect.stringContaining('INSERT INTO public.users'),
      expect.stringContaining('SELECT verified_contact'),
      expect.stringContaining('INSERT INTO public.user_auth_providers'),
      expect.stringContaining('SELECT provider_subject'),
    ]);
    expect(queries).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1::text))',
      [identity.id],
    );
    expect(provider.sendChallenge.mock.invocationCallOrder[0]).toBeGreaterThan(
      queries.mock.invocationCallOrder.at(-1) ?? 0,
    );
    expect(JSON.stringify(result)).not.toContain(body.password);
  });

  it('applies the configured backend password minimum before any reservation', async () => {
    const { provider, abuse, database } = harness();
    const service = new EmailRegistrationService(
      provider as unknown as EmailRegistrationProvider,
      abuse as unknown as AuthAbuseControl,
      database as unknown as DatabaseService,
      { get: () => 20 } as unknown as ConfigService,
    );
    await rejection(
      () => service.register(body, peer),
      422,
      'PASSWORD_POLICY_FAILED',
    );
    expect(abuse.reserveSend).not.toHaveBeenCalled();
    expect(provider.findByEmail).not.toHaveBeenCalled();
  });

  it('protects a verified contact and does not create or send', async () => {
    const { service, provider, database } = harness();
    provider.findByEmail.mockResolvedValue({ ...identity, verified: true });
    await rejection(
      () => service.register(body, peer),
      409,
      'CONTACT_ALREADY_REGISTERED',
    );
    expect(provider.createPending).not.toHaveBeenCalled();
    expect(provider.sendChallenge).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['matching', body],
    [
      'different',
      {
        ...body,
        password: 'Different!Pass123',
        confirm_password: 'Different!Pass123',
      },
    ],
  ])(
    'resumes a %s pending email registration, replaces its password, and sends a fresh OTP',
    async (_kind, retry) => {
      const { service, provider, database, queries } = harness();
      provider.findByEmail.mockResolvedValue(identity);
      const result = await service.register(retry, peer);
      expect(result.verification_channel).toBe('email');
      expect(provider.createPending).not.toHaveBeenCalled();
      expect(provider.sendChallenge).toHaveBeenCalledWith(
        identity,
        expect.any(AbortSignal),
      );
      expect(database.transaction).toHaveBeenCalledTimes(2);
      expect(queries).toHaveBeenCalledWith(
        expect.stringContaining('SET encrypted_password=extensions.crypt'),
        [identity.id, retry.password],
      );
    },
  );

  it('repairs a pending Auth identity through A04 after an A01 application transaction failure', async () => {
    const { service, provider, database } = harness();
    database.transaction.mockRejectedValueOnce(
      new Error('synthetic database outage'),
    );
    await rejection(
      () => service.register(body, peer),
      503,
      'SERVICE_UNAVAILABLE',
    );
    provider.findByEmail.mockResolvedValue(identity);
    const result = await service.register(body, peer);
    expect(result.verification_channel).toBe('email');
    expect(provider.createPending).toHaveBeenCalledTimes(1);
    expect(provider.sendChallenge).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'confirmed email',
      { email_confirmed_at: '2026-01-01T00:00:00Z' },
      false,
      [],
      [],
    ],
    [
      'confirmed phone',
      { phone_confirmed_at: '2026-01-01T00:00:00Z' },
      false,
      [],
      [],
    ],
    ['aggregate verified state', {}, true, [], []],
    [
      'verified provider mapping',
      {},
      false,
      [{ provider: 'email', verified_at: '2026-01-01T00:00:00Z' }],
      [],
    ],
    [
      'linked OAuth provider',
      {},
      false,
      [{ provider: 'google', verified_at: null }],
      [],
    ],
    ['linked OAuth identity', {}, false, [], [{ exists: 1 }]],
  ])(
    'fails closed without changing a pending email password when account has %s',
    async (_case, authOverrides, appVerified, providerRows, oauthRows) => {
      const { service, provider, queries } = harness();
      provider.findByEmail.mockResolvedValue(identity);
      queries.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM auth.users') && sql.includes('FOR UPDATE')) {
          return [
            {
              id: identity.id,
              email,
              phone: null,
              email_confirmed_at: null,
              phone_confirmed_at: null,
              ...authOverrides,
            },
          ];
        }
        if (sql.startsWith('SELECT verified_contact FROM public.users')) {
          return [{ verified_contact: appVerified }];
        }
        if (sql.includes('SELECT provider,provider_subject')) {
          return providerRows;
        }
        if (sql.includes('FROM auth.identities')) return oauthRows;
        if (sql.startsWith('UPDATE auth.users')) return [{ id: params?.[0] }];
        return [];
      });
      await rejection(
        () => service.register(body, peer),
        409,
        'CONTACT_ALREADY_REGISTERED',
      );
      expect(
        queries.mock.calls.some(([sql]) => sql.startsWith('UPDATE auth.users')),
      ).toBe(false);
      expect(provider.sendChallenge).not.toHaveBeenCalled();
    },
  );

  it('maps provider create and send failures to retryable 502 with retained reservations', async () => {
    for (const method of [
      'findByEmail',
      'createPending',
      'sendChallenge',
    ] as const) {
      const { service, provider, abuse } = harness();
      provider[method].mockRejectedValue(
        new Error('synthetic provider failure'),
      );
      await rejection(
        () => service.register(body, peer),
        502,
        'EMAIL_PROVIDER_ERROR',
      );
      expect(abuse.reserveSend).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects a provider challenge without the contracted 600-second validity', async () => {
    const { service, provider, abuse } = harness();
    provider.sendChallenge.mockResolvedValue({ expiresInSeconds: 3600 });
    await rejection(
      () => service.register(body, peer),
      502,
      'EMAIL_PROVIDER_ERROR',
    );
    expect(abuse.reserveSend).toHaveBeenCalledTimes(1);
  });

  it('does not issue a challenge when a pending row belongs to a different subject', async () => {
    const { service, provider, queries } = harness();
    queries.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT verified_contact'))
        return [{ verified_contact: false, email: null, phone: null }];
      if (sql.startsWith('SELECT provider_subject'))
        return [
          {
            provider_subject: 'different-subject',
            contact_value: email,
            verified_at: null,
          },
        ];
      return [];
    });
    await rejection(
      () => service.register(body, peer),
      409,
      'CONTACT_ALREADY_REGISTERED',
    );
    expect(provider.sendChallenge).not.toHaveBeenCalled();
  });

  it.each([
    [
      'confirmed users contact',
      'SELECT id FROM public.users',
      [{ id: 'other-uuid' }],
    ],
    [
      'pending provider contact',
      'SELECT user_id FROM public.user_auth_providers',
      [{ user_id: 'other-uuid' }],
    ],
  ])(
    'blocks a different UUID owning the same normalized email in %s',
    async (_case, query, rows) => {
      const { service, provider, queries } = harness();
      queries.mockImplementation(async (sql: string) => {
        if (sql.startsWith(query)) return rows;
        if (sql.startsWith('SELECT verified_contact'))
          return [{ verified_contact: false, email: null, phone: null }];
        if (sql.startsWith('SELECT provider_subject'))
          return [
            {
              provider_subject: identity.subject,
              contact_value: email,
              verified_at: null,
            },
          ];
        return [];
      });
      await rejection(
        () => service.register(body, peer),
        409,
        'CONTACT_ALREADY_REGISTERED',
      );
      expect(
        queries.mock.calls.some(([sql]) =>
          sql.startsWith('INSERT INTO public.users'),
        ),
      ).toBe(false);
      expect(provider.sendChallenge).not.toHaveBeenCalled();
    },
  );

  it('serializes two UUIDs racing for one normalized email and sends only for the winner', async () => {
    const first = harness();
    const second = harness();
    const secondIdentity = {
      ...identity,
      id: '00000000-0000-4000-8000-000000000002',
      subject: 'second-subject',
    };
    second.provider.createPending.mockResolvedValue(secondIdentity);
    let owner: PendingEmailIdentity | null = null;
    let previous = Promise.resolve();
    const locks: string[] = [];
    const sharedDatabase = {
      transaction: vi.fn(
        async (
          _id: unknown,
          operation: (db: {
            query: (sql: string, args?: unknown[]) => Promise<unknown[]>;
          }) => Promise<unknown>,
        ) => {
          let release!: () => void;
          const turn = new Promise<void>((resolve) => {
            release = resolve;
          });
          const ahead = previous;
          previous = turn;
          await ahead;
          try {
            return await operation({
              query: async (sql, args = []) => {
                if (sql.includes('pg_advisory_xact_lock')) {
                  locks.push(String(args[0]));
                  return [];
                }
                if (
                  sql.startsWith(
                    'SELECT user_id FROM public.user_auth_providers',
                  )
                )
                  return owner && owner.id !== args[1]
                    ? [{ user_id: owner.id }]
                    : [];
                if (sql.startsWith('SELECT verified_contact'))
                  return [
                    { verified_contact: false, email: null, phone: null },
                  ];
                if (sql.startsWith('INSERT INTO public.user_auth_providers')) {
                  owner = args[0] === identity.id ? identity : secondIdentity;
                  return [];
                }
                if (sql.startsWith('SELECT provider_subject'))
                  return owner
                    ? [
                        {
                          provider_subject: owner.subject,
                          contact_value: owner.email,
                          verified_at: null,
                        },
                      ]
                    : [];
                return [];
              },
            });
          } finally {
            release();
          }
        },
      ),
    };
    const makeService = (fixture: ReturnType<typeof harness>) =>
      new EmailRegistrationService(
        fixture.provider as unknown as EmailRegistrationProvider,
        fixture.abuse as unknown as AuthAbuseControl,
        sharedDatabase as unknown as DatabaseService,
        { get: () => undefined } as unknown as ConfigService,
      );
    const results = await Promise.allSettled([
      makeService(first).register(body, peer),
      makeService(second).register(body, peer),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(
      rejected?.status === 'rejected' && rejected.reason.getResponse(),
    ).toMatchObject({ code: 'CONTACT_ALREADY_REGISTERED' });
    expect(
      first.provider.sendChallenge.mock.calls.length +
        second.provider.sendChallenge.mock.calls.length,
    ).toBe(1);
    expect(locks).toEqual([
      identity.id,
      `auth:pending-email:${email}`,
      '00000000-0000-4000-8000-000000000002',
      `auth:pending-email:${email}`,
    ]);
  });

  it('maps a concurrent database uniqueness violation to the A01 duplicate contract', async () => {
    const { service, provider, database } = harness();
    database.transaction.mockRejectedValueOnce(
      new QueryFailedError(
        'INSERT INTO public.user_auth_providers',
        [],
        Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'uq_user_auth_providers_subject',
        }),
      ),
    );
    await rejection(
      () => service.register(body, peer),
      409,
      'CONTACT_ALREADY_REGISTERED',
    );
    expect(provider.sendChallenge).not.toHaveBeenCalled();
  });

  it('fails before any provider call when the shared Redis reservation fails', async () => {
    const { service, provider, abuse } = harness();
    abuse.reserveSend.mockRejectedValue(
      new HttpException({ code: 'SERVICE_UNAVAILABLE' }, 503),
    );
    await rejection(
      () => service.register(body, peer),
      503,
      'SERVICE_UNAVAILABLE',
    );
    expect(provider.findByEmail).not.toHaveBeenCalled();
  });

  it('returns identical metadata for unknown and pending resend contacts', async () => {
    const { service, provider } = harness();
    const input = { channel: 'email', contact: email };
    const unknown = await service.resend(input, peer);
    provider.findByEmail.mockResolvedValue(identity);
    const pending = await service.resend(input, peer);
    expect(pending).toMatchObject({
      verification_channel: unknown.verification_channel,
      contact_masked: unknown.contact_masked,
      expires_in_seconds: unknown.expires_in_seconds,
      resend_available_at: expect.any(String),
    });
    expect(provider.sendChallenge).toHaveBeenCalledTimes(1);
  });

  it('preserves a database outage as 503 during resend', async () => {
    const { service, provider, database } = harness();
    provider.findByEmail.mockResolvedValue(identity);
    database.transaction.mockRejectedValueOnce(
      new Error('synthetic database outage'),
    );
    await rejection(
      () => service.resend({ channel: 'email', contact: email }, peer),
      503,
      'SERVICE_UNAVAILABLE',
    );
    expect(provider.sendChallenge).not.toHaveBeenCalled();
  });

  it.each([
    ['verified Auth identity', true],
    ['conflicting application identity', false],
  ])(
    'keeps %s indistinguishable from unknown resend',
    async (_case, verified) => {
      const { service, provider, database } = harness();
      const unknown = await service.resend(
        { channel: 'email', contact: email },
        peer,
      );
      provider.findByEmail.mockResolvedValue({ ...identity, verified });
      if (!verified) {
        database.transaction.mockRejectedValueOnce(
          new HttpException({ code: 'CONTACT_ALREADY_REGISTERED' }, 409),
        );
      }
      const protectedResponse = await service.resend(
        { channel: 'email', contact: email },
        peer,
      );
      expect(protectedResponse).toMatchObject({
        verification_channel: unknown.verification_channel,
        contact_masked: unknown.contact_masked,
        expires_in_seconds: unknown.expires_in_seconds,
      });
      expect(provider.sendChallenge).not.toHaveBeenCalled();
    },
  );

  it('returns generic success metadata without overwriting staged contact or sending challenge when identity email mismatches requested email', async () => {
    const { service, provider, database } = harness();
    provider.findByEmail.mockResolvedValue({
      ...identity,
      email: 'newer-staged@example.invalid',
    });

    const result = await service.resend(
      { channel: 'email', contact: email },
      peer,
    );

    expect(result).toMatchObject({
      verification_channel: 'email',
      contact_masked: expect.any(String),
      expires_in_seconds: 600,
      resend_available_at: expect.any(String),
    });
    expect(database.transaction).not.toHaveBeenCalled();
    expect(provider.sendChallenge).not.toHaveBeenCalled();
  });

  it('maps resend provider failure to retryable 502 without exposing details', async () => {
    const { service, provider } = harness();
    provider.findByEmail.mockResolvedValue(identity);
    provider.sendChallenge.mockRejectedValueOnce(
      new Error('synthetic private provider detail'),
    );
    try {
      await service.resend({ channel: 'email', contact: email }, peer);
      expect.fail('Expected provider error');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(502);
      expect(exception.getResponse()).toMatchObject({
        code: 'EMAIL_PROVIDER_ERROR',
        retryable: true,
      });
      expect(JSON.stringify(exception.getResponse())).not.toContain(
        'synthetic private provider detail',
      );
    }
  });

  it('a concurrent retry cannot send when its Redis reservation rejects', async () => {
    const { service, provider, abuse } = harness();
    let complete!: (value: { expiresInSeconds: number }) => void;
    provider.sendChallenge.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const first = service.register(body, peer);
    await vi.waitFor(() =>
      expect(provider.sendChallenge).toHaveBeenCalledTimes(1),
    );
    abuse.reserveSend.mockRejectedValueOnce(
      new HttpException({ code: 'RESEND_COOLDOWN_ACTIVE' }, 429),
    );
    await rejection(
      () => service.register(body, peer),
      429,
      'RESEND_COOLDOWN_ACTIVE',
    );
    complete({ expiresInSeconds: 600 });
    await first;
    expect(provider.sendChallenge).toHaveBeenCalledTimes(1);
  });

  it('a late provider completion cannot change the 504 or the newer reservation result', async () => {
    vi.useFakeTimers();
    try {
      const { service, provider, abuse } = harness();
      let complete!: (value: { expiresInSeconds: number }) => void;
      provider.sendChallenge.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      const first = service
        .register(body, peer)
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(10000);
      const firstError = (await first) as HttpException;
      expect(firstError).toBeInstanceOf(HttpException);
      expect(firstError.getStatus()).toBe(504);
      expect(firstError.getResponse()).toMatchObject({
        code: 'PROVIDER_TIMEOUT',
      });
      provider.findByEmail.mockResolvedValue(identity);
      const second = await service.resend(
        { channel: 'email', contact: email },
        peer,
      );
      complete({ expiresInSeconds: 600 });
      await Promise.resolve();
      expect(second.verification_channel).toBe('email');
      expect(abuse.reserveSend).toHaveBeenCalledTimes(2);
      expect(provider.sendChallenge).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('production adapter is a fail-closed gate before any budget or identity effect', async () => {
    const { abuse, database } = harness();
    const service = new EmailRegistrationService(
      new EmailRegistrationProvider(),
      abuse as unknown as AuthAbuseControl,
      database as unknown as DatabaseService,
      { get: () => undefined } as unknown as ConfigService,
    );
    await rejection(
      () => service.register(body, peer),
      503,
      'SERVICE_UNAVAILABLE',
    );
    await rejection(
      () => service.resend({ channel: 'email', contact: email }, peer),
      503,
      'SERVICE_UNAVAILABLE',
    );
    expect(abuse.reserveSend).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  describe('Phone registration and OTP resend via TextBee provider', () => {
    it('successfully registers phone contact, persists pending row, and dispatches SMS challenge', async () => {
      const { service, smsProvider, abuse, queries } = harness();
      const result = await service.register(phoneBody, peer);
      expect(result).toMatchObject({
        verification_channel: 'phone',
        contact_masked: '+8801****5678',
        expires_in_seconds: 600,
      });
      expect(smsProvider.ready).toHaveBeenCalled();
      expect(abuse.reserveSend).toHaveBeenCalledWith(
        { channel: 'phone', identifier: phone },
        '192.0.2.4',
      );
      expect(smsProvider.findByPhone).toHaveBeenCalledWith(
        phone,
        expect.any(Object),
      );
      expect(smsProvider.createPending).toHaveBeenCalledWith(
        phone,
        phoneBody.password,
        expect.any(Object),
      );
      expect(smsProvider.sendChallenge).toHaveBeenCalledWith(
        phoneIdentity,
        expect.any(Object),
      );
      expect(queries).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1::text))',
        [phoneIdentity.id],
      );
    });

    it('rejects phone registration with 409 when phone contact is already registered', async () => {
      const { service, smsProvider } = harness();
      smsProvider.findByPhone.mockResolvedValueOnce({
        id: 'existing-id',
        subject: 'existing-id',
        phone,
        verified: true,
      });
      await rejection(
        () => service.register(phoneBody, peer),
        409,
        'CONTACT_ALREADY_REGISTERED',
      );
    });

    it('resumes an unverified phone registration, replaces its password, and dispatches a fresh OTP', async () => {
      const { service, smsProvider, queries, database } = harness();
      smsProvider.findByPhone.mockResolvedValueOnce(phoneIdentity);
      const result = await service.register(phoneBody, peer);
      expect(result.verification_channel).toBe('phone');
      expect(smsProvider.createPending).not.toHaveBeenCalled();
      expect(smsProvider.sendChallenge).toHaveBeenCalledWith(
        phoneIdentity,
        expect.any(AbortSignal),
      );
      expect(database.transaction).toHaveBeenCalledTimes(2);
      expect(queries).toHaveBeenCalledWith(
        expect.stringContaining('SET encrypted_password=extensions.crypt'),
        [phoneIdentity.id, phoneBody.password],
      );
    });

    it('successfully resends OTP challenge for unverified phone contact', async () => {
      const { service, smsProvider, abuse } = harness();
      smsProvider.findByPhone.mockResolvedValueOnce(phoneIdentity);
      const result = await service.resend(
        { channel: 'phone', contact: phone },
        peer,
      );
      expect(result).toMatchObject({
        verification_channel: 'phone',
        contact_masked: '+8801****5678',
        expires_in_seconds: 600,
      });
      expect(smsProvider.ready).toHaveBeenCalled();
      expect(abuse.reserveSend).toHaveBeenCalledWith(
        { channel: 'phone', identifier: phone },
        '192.0.2.4',
      );
      expect(smsProvider.sendChallenge).toHaveBeenCalledWith(
        phoneIdentity,
        expect.any(Object),
      );
    });

    it('returns anti-enumeration uniform metadata on resend for unknown phone contact', async () => {
      const { service, smsProvider } = harness();
      smsProvider.findByPhone.mockResolvedValueOnce(null);
      const result = await service.resend(
        { channel: 'phone', contact: phone },
        peer,
      );
      expect(result).toMatchObject({
        verification_channel: 'phone',
        contact_masked: '+8801****5678',
        expires_in_seconds: 600,
      });
      expect(smsProvider.sendChallenge).not.toHaveBeenCalled();
    });

    it('translates smsProvider delivery failure to 502 retryable error on phone resend for pending contact', async () => {
      const { service, smsProvider } = harness();
      smsProvider.findByPhone.mockResolvedValueOnce(phoneIdentity);
      smsProvider.sendChallenge.mockRejectedValueOnce(
        new Error('SMS Gateway failure'),
      );
      await rejection(
        () => service.resend({ channel: 'phone', contact: phone }, peer),
        502,
        'SMS_PROVIDER_ERROR',
      );
    });

    it('translates smsProvider delivery outage to 502 error on phone resend for unknown contact (failure parity)', async () => {
      const { service, smsProvider } = harness();
      smsProvider.findByPhone.mockResolvedValueOnce(null);
      smsProvider.checkDeliveryHealth = vi
        .fn()
        .mockRejectedValueOnce(new Error('SMS Gateway outage'));
      await rejection(
        () => service.resend({ channel: 'phone', contact: phone }, peer),
        502,
        'SMS_PROVIDER_ERROR',
      );
    });

    it('translates smsProvider delivery outage to 502 error on phone resend for verified contact (failure parity)', async () => {
      const { service, smsProvider } = harness();
      smsProvider.findByPhone.mockResolvedValueOnce({
        ...phoneIdentity,
        verified: true,
      });
      smsProvider.checkDeliveryHealth = vi
        .fn()
        .mockRejectedValueOnce(new Error('SMS Gateway outage'));
      await rejection(
        () => service.resend({ channel: 'phone', contact: phone }, peer),
        502,
        'SMS_PROVIDER_ERROR',
      );
    });

    it('normalizes digits-only phone identity from provider during phone registration', async () => {
      const { service, smsProvider } = harness();
      smsProvider.createPending.mockResolvedValueOnce({
        id: phoneIdentity.id,
        subject: phoneIdentity.subject,
        phone: '8801712345678', // digits-only from GoTrue
        verified: false,
      });
      const result = await service.register(phoneBody, peer);
      expect(result).toMatchObject({
        verification_channel: 'phone',
        contact_masked: '+8801****5678',
        expires_in_seconds: 600,
      });
    });

    it('reconciles existing pending mapping with digits-only phone to canonical E.164 without 409 conflict', async () => {
      const { service, smsProvider, database } = harness();
      let capturedUpsertSql = '';
      database.transaction.mockImplementationOnce(
        async (
          _id: string | null,
          operation: (db: any) => Promise<unknown>,
        ) => {
          return operation({
            query: async (sql: string) => {
              if (sql.startsWith('SELECT pg_advisory_xact_lock')) return [];
              if (sql.startsWith('SELECT id FROM public.users')) return [];
              if (
                sql.startsWith('SELECT user_id FROM public.user_auth_providers')
              )
                return [];
              if (sql.startsWith('INSERT INTO public.users')) return [];
              if (sql.startsWith('SELECT verified_contact'))
                return [{ verified_contact: false, email: null, phone: null }];
              if (sql.startsWith('INSERT INTO public.user_auth_providers')) {
                capturedUpsertSql = sql;
                return [];
              }
              if (sql.startsWith('SELECT provider_subject')) {
                return [
                  {
                    provider_subject: phoneIdentity.subject,
                    contact_value: '8801712345678', // digits-only prior to or during reconciliation
                    verified_at: null,
                  },
                ];
              }
              return [];
            },
          });
        },
      );

      const result = await service.register(phoneBody, peer);
      expect(result).toMatchObject({
        verification_channel: 'phone',
        contact_masked: '+8801****5678',
        expires_in_seconds: 600,
      });
      expect(capturedUpsertSql).toContain(
        "public.user_auth_providers.contact_value = ltrim(EXCLUDED.contact_value, '+')",
      );
      expect(smsProvider.sendChallenge).toHaveBeenCalledWith(
        phoneIdentity,
        expect.any(Object),
      );
    });

    it('fails closed with 503 when smsProvider is missing for phone registration', async () => {
      const { abuse, database, provider } = harness();
      const service = new EmailRegistrationService(
        provider as unknown as EmailRegistrationProvider,
        abuse as unknown as AuthAbuseControl,
        database as unknown as DatabaseService,
        { get: () => undefined } as unknown as ConfigService,
        undefined, // smsProvider omitted
      );
      await rejection(
        () => service.register(phoneBody, peer),
        503,
        'SERVICE_UNAVAILABLE',
      );
      await rejection(
        () => service.resend({ channel: 'phone', contact: phone }, peer),
        503,
        'SERVICE_UNAVAILABLE',
      );
    });
  });
});

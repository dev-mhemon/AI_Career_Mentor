import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { configureHttp, fail } from '../common/http.js';
import { AuthController } from './controllers/auth.controller.js';
import { AuthService } from './services/auth.service.js';
import { EmailRegistrationProvider } from './services/email-registration.provider.js';
import { EmailRegistrationService } from './services/email-registration.service.js';
import { AuthAbuseControl } from './abuse-control/abuse-control.service.js';
import { DatabaseService } from './services/database.service.js';

const body = {
  email: 'Person@Example.Invalid',
  password: 'Synthetic!Pass123',
  confirm_password: 'Synthetic!Pass123',
  privacy_consent: true,
};

describe('canonical A01/A04 HTTP boundary', () => {
  let app: INestApplication;
  const provider = {
    ready: vi.fn(),
    findByEmail: vi.fn().mockResolvedValue(null),
    createPending: vi.fn().mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      subject: 'synthetic-subject',
      email: 'person@example.invalid',
      verified: false,
    }),
    sendChallenge: vi.fn().mockResolvedValue({ expiresInSeconds: 600 }),
  };
  const abuse = {
    reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
  };
  const database = {
    transaction: vi.fn(
      async (_id: string, operation: (db: unknown) => Promise<unknown>) =>
        operation({
          query: async (sql: string) => {
            if (sql.startsWith('SELECT verified_contact'))
              return [{ verified_contact: false, email: null, phone: null }];
            if (sql.startsWith('SELECT provider_subject'))
              return [
                {
                  provider_subject: 'synthetic-subject',
                  contact_value: 'person@example.invalid',
                  verified_at: null,
                },
              ];
            return [];
          },
        }),
    ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        EmailRegistrationService,
        { provide: AuthService, useValue: {} },
        { provide: EmailRegistrationProvider, useValue: provider },
        { provide: AuthAbuseControl, useValue: abuse },
        { provide: DatabaseService, useValue: database },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => app.close());
  beforeEach(() => {
    provider.findByEmail.mockReset().mockResolvedValue(null);
    provider.sendChallenge.mockClear();
    abuse.reserveSend.mockReset().mockResolvedValue({ retryAfterSeconds: 60 });
  });

  it('returns 201 pending metadata on synthetic confirmed delivery', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(body);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        verification_channel: 'email',
        contact_masked: 'p****@example.invalid',
        expires_in_seconds: 600,
        resend_available_at: expect.any(String),
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(body.password);
    expect(response.body.data).not.toHaveProperty('access_token');
  });

  it('returns 200 identical resend metadata for unknown and pending contacts', async () => {
    const path = '/api/v1/auth/resend-verification';
    const input = { channel: 'email', contact: 'Person@Example.Invalid' };
    const unknown = await request(app.getHttpServer()).post(path).send(input);
    provider.findByEmail.mockResolvedValue(await provider.createPending());
    const pending = await request(app.getHttpServer()).post(path).send(input);
    expect(unknown.status).toBe(200);
    expect(pending.status).toBe(200);
    expect(pending.body.data.verification_channel).toBe('email');
    expect(pending.body.data.contact_masked).toBe(
      unknown.body.data.contact_masked,
    );
    expect(pending.body.data.expires_in_seconds).toBe(
      unknown.body.data.expires_in_seconds,
    );
    expect(provider.sendChallenge).toHaveBeenCalledTimes(1);
  });

  it('uses canonical status and error envelope for duplicate, invalid and outage', async () => {
    provider.findByEmail.mockResolvedValue({
      ...(await provider.createPending()),
      verified: true,
    });
    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(body);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toMatchObject({
      code: 'CONTACT_ALREADY_REGISTERED',
      requestId: expect.any(String),
    });
    const invalid = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ ...body, confirm_password: 'different' });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.details[0]).toMatchObject({
      field: 'confirm_password',
      code: 'PASSWORD_MISMATCH',
    });
    provider.findByEmail.mockResolvedValue(null);
    provider.sendChallenge.mockRejectedValueOnce(
      new Error('synthetic timeout'),
    );
    const outage = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(body);
    expect(outage.status).toBe(502);
    expect(outage.body.error).toMatchObject({
      code: 'EMAIL_PROVIDER_ERROR',
      retryable: true,
      requestId: expect.any(String),
    });
  });

  it('fails closed on both production routes before claiming a send', async () => {
    provider.ready.mockImplementationOnce(() => {
      throw new HttpException({ code: 'SERVICE_UNAVAILABLE' }, 503);
    });
    const register = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(body);
    provider.ready.mockImplementationOnce(() => {
      throw new HttpException({ code: 'SERVICE_UNAVAILABLE' }, 503);
    });
    const resend = await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ channel: 'email', contact: 'Person@Example.Invalid' });
    for (const response of [register, resend]) {
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', requestId: expect.any(String) },
      });
    }
  });

  it.each([
    ['RESEND_COOLDOWN_ACTIVE', 60],
    ['OTP_LIMIT_EXCEEDED', 900],
  ])('returns %s with authoritative retry metadata', async (code, retry) => {
    abuse.reserveSend.mockImplementationOnce(() =>
      fail(429, code, 'Wait before requesting another code', [], true, retry),
    );
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ channel: 'email', contact: 'Person@Example.Invalid' });
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe(String(retry));
    expect(response.body.error).toMatchObject({
      code,
      retryable: true,
      retryAfterSeconds: retry,
      requestId: expect.any(String),
    });
    expect(provider.findByEmail).not.toHaveBeenCalled();
  });

  it('keeps a resend database outage at canonical 503', async () => {
    provider.findByEmail.mockResolvedValue(await provider.createPending());
    database.transaction.mockRejectedValueOnce(
      new HttpException({ code: 'SERVICE_UNAVAILABLE' }, 503),
    );
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ channel: 'email', contact: 'Person@Example.Invalid' });
    expect(response.status).toBe(503);
    expect(response.body.error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      requestId: expect.any(String),
    });
    expect(provider.sendChallenge).not.toHaveBeenCalled();
  });

  it('masks a conflicting resend identity like an unknown contact', async () => {
    const input = { channel: 'email', contact: 'Person@Example.Invalid' };
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send(input);
    provider.findByEmail.mockResolvedValue(await provider.createPending());
    database.transaction.mockRejectedValueOnce(
      new HttpException({ code: 'CONTACT_ALREADY_REGISTERED' }, 409),
    );
    const conflict = await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send(input);
    expect(unknown.status).toBe(200);
    expect(conflict.status).toBe(200);
    expect(conflict.body.data).toMatchObject({
      verification_channel: unknown.body.data.verification_channel,
      contact_masked: unknown.body.data.contact_masked,
      expires_in_seconds: unknown.body.data.expires_in_seconds,
    });
    expect(provider.sendChallenge).not.toHaveBeenCalled();
  });
});

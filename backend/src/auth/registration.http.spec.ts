import 'reflect-metadata';
import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureHttp } from '../common/http.js';
import {
  normalizeRegisterRequest,
  normalizeResendRequest,
} from './registration.dto.js';

/** Test-only validation probe; canonical A01/A04 routes are tested separately. */
@Controller('validation-probe')
class ValidationProbeController {
  @Post('register')
  register(@Body() body: unknown) {
    normalizeRegisterRequest(body);
    return { accepted: true };
  }

  @Post('resend')
  resend(@Body() body: unknown) {
    return normalizeResendRequest(body);
  }
}

describe('C05 validation error HTTP envelope', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ValidationProbeController],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => app.close());

  it('reports mismatch at confirm_password without returning secrets', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/validation-probe/register')
      .send({
        email: 'rahim@example.com',
        phone: null,
        password: 'S3cure!Pass',
        confirm_password: 'mismatch',
        privacy_consent: true,
      });
    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [
        {
          field: 'confirm_password',
          code: 'PASSWORD_MISMATCH',
          message: 'Passwords do not match',
        },
      ],
      retryable: false,
      requestId: expect.any(String),
    });
    expect(JSON.stringify(response.body)).not.toContain('S3cure!Pass');
  });

  it('reports email and enum fields with canonical 422 envelopes', async () => {
    const badEmail = await request(app.getHttpServer())
      .post('/api/v1/validation-probe/register')
      .send({
        email: 'bad@@email',
        password: 'S3cure!Pass',
        confirm_password: 'S3cure!Pass',
        privacy_consent: true,
      });
    const badChannel = await request(app.getHttpServer())
      .post('/api/v1/validation-probe/resend')
      .send({ channel: 'social', contact: 'rahim@example.com' });
    expect(badEmail.status).toBe(422);
    expect(badEmail.body.error.details[0]).toMatchObject({
      field: 'email',
      code: 'VALIDATION_FAILED',
    });
    expect(badChannel.status).toBe(422);
    expect(badChannel.body.error.details[0]).toMatchObject({
      field: 'channel',
      code: 'INVALID_ENUM_VALUE',
    });
  });

  it('reports invalid phone with its canonical code and field', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/validation-probe/register')
      .send({
        email: null,
        phone: '123',
        password: 'S3cure!Pass',
        confirm_password: 'S3cure!Pass',
        privacy_consent: true,
      });
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({
      code: 'INVALID_PHONE_NUMBER',
      details: [{ field: 'phone', code: 'INVALID_PHONE_NUMBER' }],
      requestId: expect.any(String),
    });
  });
});

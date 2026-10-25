import { HttpException } from '@nestjs/common';
import {
  normalizeRegisterRequest,
  normalizeResendRequest,
} from './registration.dto.js';

const valid = {
  email: '  Rahim@Example.COM  ',
  phone: null,
  password: 'S3cure!Pass',
  confirm_password: 'S3cure!Pass',
  privacy_consent: true,
};

function errorOf(operation: () => unknown): {
  status: number;
  body: Record<string, unknown>;
} {
  try {
    operation();
    throw new Error('Expected validation failure');
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return {
      status: error.getStatus(),
      body: error.getResponse() as Record<string, unknown>,
    };
  }
}

describe('C05 shared registration and resend input', () => {
  it('normalizes email and keeps the unused phone nullable', () => {
    expect(normalizeRegisterRequest(valid)).toMatchObject({
      channel: 'email',
      identifier: 'rahim@example.com',
      email: 'rahim@example.com',
      phone: null,
    });
  });

  it('retains the phone form of the shared DTO', () => {
    expect(
      normalizeRegisterRequest({ ...valid, email: null, phone: '01712345678' }),
    ).toMatchObject({ channel: 'phone', identifier: '+8801712345678' });
  });

  it.each([
    [{ ...valid, phone: '01712345678' }, 'email'],
    [{ ...valid, email: null }, 'email'],
    [{ ...valid, email: '' }, 'email'],
    [{ ...valid, email: 'bad@@example' }, 'email'],
    [{ ...valid, email: null, phone: '123' }, 'phone'],
    [{ ...valid, privacy_consent: false }, 'privacy_consent'],
    [{ ...valid, surprise: 'value' }, 'surprise'],
  ])(
    'rejects invalid contact, consent or unknown fields before any effect',
    (input, field) => {
      const result = errorOf(() => normalizeRegisterRequest(input));
      expect(result.status).toBe(422);
      expect(result.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
    },
  );

  it('returns password-specific errors without echoing secret input', () => {
    const weak = errorOf(() =>
      normalizeRegisterRequest({ ...valid, password: '12345678' }),
    );
    expect(weak.status).toBe(422);
    expect(weak.body.code).toBe('PASSWORD_POLICY_FAILED');
    expect(JSON.stringify(weak.body)).not.toContain('12345678');
  });

  it('honors a stronger configured minimum without adding a contact side effect', () => {
    const result = errorOf(() => normalizeRegisterRequest(valid, 16));
    expect(result.body.code).toBe('PASSWORD_POLICY_FAILED');
  });

  it('attributes mismatch to confirm_password', () => {
    const result = errorOf(() =>
      normalizeRegisterRequest({ ...valid, confirm_password: 'different' }),
    );
    expect(result.body.details).toEqual([
      {
        field: 'confirm_password',
        code: 'PASSWORD_MISMATCH',
        message: 'Passwords do not match',
      },
    ]);
  });

  it('normalizes resend email and rejects channel/contact mismatch', () => {
    expect(
      normalizeResendRequest({
        channel: 'email',
        contact: 'Rahim@Example.COM',
      }),
    ).toEqual({ channel: 'email', identifier: 'rahim@example.com' });
    const mismatch = errorOf(() =>
      normalizeResendRequest({ channel: 'email', contact: '+8801712345678' }),
    );
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'contact' })]),
    );
  });

  it('marks an invalid resend channel as an enum field error', () => {
    const result = errorOf(() =>
      normalizeResendRequest({
        channel: 'social',
        contact: 'rahim@example.com',
      }),
    );
    expect(result.status).toBe(422);
    expect(result.body.details).toEqual([
      {
        field: 'channel',
        code: 'INVALID_ENUM_VALUE',
        message: 'Choose email or phone',
      },
    ]);
  });

  it('uses the C05 phone error for bad phone input without narrowing the shared DTO', () => {
    const registration = errorOf(() =>
      normalizeRegisterRequest({ ...valid, email: null, phone: 17 }),
    );
    const resend = errorOf(() =>
      normalizeResendRequest({ channel: 'phone', contact: 'not-a-phone' }),
    );
    expect(registration.status).toBe(422);
    expect(registration.body).toMatchObject({
      code: 'INVALID_PHONE_NUMBER',
      details: [{ field: 'phone', code: 'INVALID_PHONE_NUMBER' }],
    });
    expect(resend.body).toMatchObject({
      code: 'INVALID_PHONE_NUMBER',
      details: [{ field: 'contact', code: 'INVALID_PHONE_NUMBER' }],
    });
  });
});

import { isEmail } from 'class-validator';
import { fail } from '../common/http.js';

/** C05's shared registration shape remains valid for both email and phone. */
export interface RegisterRequestDTO {
  email?: string | null;
  phone?: string | null;
  password: string;
  confirm_password: string;
  privacy_consent: true;
}

export interface ResendVerificationDTO {
  channel: 'email' | 'phone';
  contact: string;
}

export interface NormalizedContact {
  channel: 'email' | 'phone';
  identifier: string;
}

function invalid(
  field: string,
  message: string,
  code = 'VALIDATION_FAILED',
): never {
  fail(422, 'VALIDATION_FAILED', 'Invalid request', [{ field, code, message }]);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('body', 'Expected an object');
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[]): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) invalid(extra, 'Field is not allowed');
}

function invalidPhone(field: 'phone' | 'contact'): never {
  fail(422, 'INVALID_PHONE_NUMBER', 'Enter a Bangladesh mobile number', [
    {
      field,
      code: 'INVALID_PHONE_NUMBER',
      message: 'Enter a Bangladesh mobile number',
    },
  ]);
}

export function normalizeContact(
  channel: 'email' | 'phone',
  value: unknown,
  field: 'email' | 'phone' | 'contact' = 'contact',
): NormalizedContact {
  if (typeof value !== 'string') {
    if (channel === 'phone') invalidPhone(field as 'phone' | 'contact');
    invalid(field, 'Enter a valid contact');
  }
  if (channel === 'email') {
    const identifier = value.trim().toLowerCase();
    if (identifier.length > 254 || !isEmail(identifier))
      invalid(field, 'Enter a valid email address');
    return { channel, identifier };
  }
  const compact = value.trim();
  const identifier = /^01[3-9][0-9]{8}$/.test(compact)
    ? `+88${compact}`
    : compact;
  if (!/^\+8801[3-9][0-9]{8}$/.test(identifier))
    invalidPhone(field as 'phone' | 'contact');
  return { channel, identifier };
}

export function normalizeRegisterRequest(
  value: unknown,
  minimumPasswordLength = 8,
): RegisterRequestDTO & NormalizedContact {
  if (
    !Number.isSafeInteger(minimumPasswordLength) ||
    minimumPasswordLength < 8 ||
    minimumPasswordLength > 128
  )
    throw new Error('Invalid registration password minimum');
  const input = object(value);
  keys(input, [
    'email',
    'phone',
    'password',
    'confirm_password',
    'privacy_consent',
  ]);
  const hasEmail = input.email !== undefined && input.email !== null;
  const hasPhone = input.phone !== undefined && input.phone !== null;
  if (hasEmail === hasPhone)
    invalid('email', 'Provide exactly one of email or phone');
  const channel = hasEmail ? 'email' : 'phone';
  const contact = normalizeContact(channel, input[channel], channel);
  if (
    typeof input.password !== 'string' ||
    input.password.length < minimumPasswordLength ||
    input.password.length > 128 ||
    /^[0-9]+$/.test(input.password)
  )
    fail(422, 'PASSWORD_POLICY_FAILED', 'Password does not meet policy', [
      {
        field: 'password',
        code: 'PASSWORD_POLICY_FAILED',
        message: `Use ${minimumPasswordLength}–128 characters and a nonnumeric password`,
      },
    ]);
  if (input.confirm_password !== input.password)
    invalid('confirm_password', 'Passwords do not match', 'PASSWORD_MISMATCH');
  if (input.privacy_consent !== true)
    invalid('privacy_consent', 'Privacy consent is required');
  return {
    email: channel === 'email' ? contact.identifier : null,
    phone: channel === 'phone' ? contact.identifier : null,
    password: input.password,
    confirm_password: input.confirm_password as string,
    privacy_consent: true,
    ...contact,
  };
}

export function normalizeResendRequest(value: unknown): NormalizedContact {
  const input = object(value);
  keys(input, ['channel', 'contact']);
  if (input.channel !== 'email' && input.channel !== 'phone')
    invalid('channel', 'Choose email or phone', 'INVALID_ENUM_VALUE');
  return normalizeContact(input.channel, input.contact);
}

import { describe, it, expect } from 'vitest';
import {
  isNonSyntheticEmail,
  isValidExperienceLevel,
  normalizeFullName,
  parseValidDailyHours,
  validateCurrentRole,
  validateDailyHours,
  validateEducation,
  validateExperienceLevel,
  validateFullName,
  validateIanaTimezone,
  validateOptionalBdPhone,
  validateOptionalEmail,
} from '@/lib/validation/profile-schemas';

describe('profile-schemas', () => {
  describe('validateFullName', () => {
    it('trims and collapses internal whitespace for valid names including Unicode', () => {
      expect(normalizeFullName('  Alice   M.   Smith  ')).toBe('Alice M. Smith');
      expect(validateFullName('  Alice   Smith  ')).toEqual({
        ok: true,
        value: 'Alice Smith',
      });
      expect(validateFullName('মেহেদী হাসান')).toEqual({
        ok: true,
        value: 'মেহেদী হাসান',
      });
      expect(validateFullName("O'Connor 2nd")).toEqual({
        ok: true,
        value: "O'Connor 2nd",
      });
    });

    it('rejects empty, too short, too long, control characters, and digit-only names', () => {
      expect(validateFullName('   ')).toEqual({
        ok: false,
        error: 'Enter your full name.',
      });
      expect(validateFullName('A')).toEqual({
        ok: false,
        error: 'Full name must be at least 2 characters.',
      });
      expect(validateFullName('a'.repeat(101))).toEqual({
        ok: false,
        error: 'Full name must be 100 characters or fewer.',
      });
      expect(validateFullName('Alice\x00Smith')).toEqual({
        ok: false,
        error: 'Full name cannot contain control characters.',
      });
      expect(validateFullName('Alice\nSmith')).toEqual({
        ok: false,
        error: 'Full name cannot contain control characters.',
      });
      expect(validateFullName('12345')).toEqual({
        ok: false,
        error: 'Full name cannot contain only digits.',
      });
      expect(validateFullName('12 34')).toEqual({
        ok: false,
        error: 'Full name cannot contain only digits.',
      });
    });
  });

  describe('validateCurrentRole', () => {
    it('validates trimmed 2-120 chars and rejects blank or out-of-range values', () => {
      expect(validateCurrentRole('  Backend Developer  ')).toEqual({
        ok: true,
        value: 'Backend Developer',
      });
      expect(validateCurrentRole('   ')).toEqual({
        ok: false,
        error: 'Enter your current role or profession.',
      });
      expect(validateCurrentRole('A')).toEqual({
        ok: false,
        error: 'Current role must be between 2 and 120 characters.',
      });
      expect(validateCurrentRole('r'.repeat(121))).toEqual({
        ok: false,
        error: 'Current role must be between 2 and 120 characters.',
      });
      expect(validateCurrentRole('Dev\x07Role')).toEqual({
        ok: false,
        error: 'Current role cannot contain control characters.',
      });
    });
  });

  describe('validateEducation', () => {
    it('allows empty optional education and caps at 160 chars', () => {
      expect(validateEducation('   ')).toEqual({ ok: true, value: '' });
      expect(validateEducation('a'.repeat(160))).toEqual({
        ok: true,
        value: 'a'.repeat(160),
      });
      expect(validateEducation('a'.repeat(161))).toEqual({
        ok: false,
        error: 'Education must be 160 characters or fewer.',
      });
      expect(validateEducation('BSc\x1bCSE')).toEqual({
        ok: false,
        error: 'Education cannot contain control characters.',
      });
    });
  });

  describe('validateExperienceLevel', () => {
    it('accepts beginner, junior, mid, senior and rejects empty or unsupported values', () => {
      for (const level of ['beginner', 'junior', 'mid', 'senior'] as const) {
        expect(isValidExperienceLevel(level)).toBe(true);
        expect(validateExperienceLevel(level)).toEqual({
          ok: true,
          value: level,
        });
      }
      expect(isValidExperienceLevel('intermediate')).toBe(false);
      expect(validateExperienceLevel('')).toEqual({
        ok: false,
        error: 'Select your experience level.',
      });
      expect(validateExperienceLevel('advanced')).toEqual({
        ok: false,
        error: 'Select your experience level.',
      });
    });
  });

  describe('validateIanaTimezone', () => {
    it('accepts valid IANA timezones and rejects empty, offsets, and unrecognized zones', () => {
      expect(validateIanaTimezone('Asia/Dhaka')).toEqual({
        ok: true,
        value: 'Asia/Dhaka',
      });
      expect(validateIanaTimezone(' UTC ')).toEqual({
        ok: true,
        value: 'UTC',
      });
      expect(validateIanaTimezone('')).toEqual({
        ok: false,
        error: 'Enter a valid IANA timezone (e.g. Asia/Dhaka, UTC).',
      });
      expect(validateIanaTimezone('Invalid/Zone')).toEqual({
        ok: false,
        error: 'Enter a valid IANA timezone (e.g. Asia/Dhaka, UTC).',
      });
      expect(validateIanaTimezone('+06:00')).toEqual({
        ok: false,
        error: 'Enter a valid IANA timezone (e.g. Asia/Dhaka, UTC).',
      });
    });
  });

  describe('validateDailyHours', () => {
    it('accepts 0.5..12 in 0.5 steps and rejects non-0.5 increments or non-decimals', () => {
      for (const [raw, num] of [
        ['0.5', 0.5],
        ['1', 1],
        ['2.5', 2.5],
        ['12', 12],
        ['12.0', 12],
      ] as const) {
        expect(parseValidDailyHours(raw)).toBe(num);
        expect(validateDailyHours(raw)).toEqual({ ok: true, value: num });
      }

      for (const bad of ['', '0', '0.4', '1.3', '2.75', '12.5', '1e1', 'abc', 'Infinity']) {
        expect(parseValidDailyHours(bad)).toBeNull();
        expect(validateDailyHours(bad)).toEqual({
          ok: false,
          error:
            'Enter daily study hours between 0.5 and 12 in 0.5 increments.',
        });
      }
    });
  });

  describe('optional contacts and synthetic email check', () => {
    it('allows empty optional email/phone and delegates non-empty validation to auth-schemas', () => {
      expect(validateOptionalEmail('   ')).toEqual({ ok: true, value: '' });
      expect(validateOptionalEmail('  Alice@Example.COM ')).toEqual({
        ok: true,
        value: 'alice@example.com',
      });
      expect(validateOptionalEmail('not-an-email').ok).toBe(false);

      expect(validateOptionalBdPhone('')).toEqual({ ok: true, value: '' });
      expect(validateOptionalBdPhone('01712345678')).toEqual({
        ok: true,
        value: '+8801712345678',
      });
      expect(validateOptionalBdPhone('01212345678').ok).toBe(false);
    });

    it('detects real vs synthetic emails', () => {
      expect(isNonSyntheticEmail('user@example.com')).toBe(true);
      expect(isNonSyntheticEmail('u@synthetic.mentor')).toBe(false);
      expect(isNonSyntheticEmail('u@phone.invalid')).toBe(false);
      expect(isNonSyntheticEmail(null)).toBe(false);
    });
  });
});

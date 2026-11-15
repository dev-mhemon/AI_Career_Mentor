import { describe, expect, it } from 'vitest';
import {
  getUserDisplayName,
  getUserInitials,
  getUserRoleLabel,
  resolveShellUserDisplay,
} from './user-display';

describe('user-display helpers', () => {
  describe('getUserInitials', () => {
    it('extracts first and last initials from multi-word full names', () => {
      expect(getUserInitials({ fullName: 'Mehedi Hasan' })).toBe('MH');
      expect(getUserInitials({ fullName: '  Mehedi   Bin   Hasan  ' })).toBe('MH');
    });

    it('extracts up to two uppercase characters from single-word names', () => {
      expect(getUserInitials({ fullName: 'Mehedi' })).toBe('ME');
      expect(getUserInitials({ fullName: 'X' })).toBe('X');
    });

    it('handles unicode names cleanly', () => {
      expect(getUserInitials({ fullName: 'José Álvarez' })).toBe('JÁ');
    });

    it('falls back to email username initials when fullName is blank, punctuation, or digits only', () => {
      expect(
        getUserInitials({ fullName: '   ', email: 'mehedi.hasan@example.com' }),
      ).toBe('MH');
      expect(
        getUserInitials({ fullName: '---', email: 'alice_smith@example.com' }),
      ).toBe('AS');
      expect(
        getUserInitials({ fullName: '12345', email: 'bob@example.com' }),
      ).toBe('BO');
    });

    it('ignores synthetic emails and never returns undefined for phone-only or empty users', () => {
      expect(
        getUserInitials({
          fullName: '',
          email: 'phone_8801712345678@synthetic.mentor',
          phone: '+8801712345678',
        }),
      ).toBe('U');
      expect(
        getUserInitials({ email: 'user@phone.invalid', phone: '01712345678' }),
      ).toBe('U');
      expect(getUserInitials(null)).toBe('U');
      expect(getUserInitials(undefined)).toBe('U');
      expect(getUserInitials({})).toBe('U');
    });
  });

  describe('getUserDisplayName', () => {
    it('prefers normalized fullName', () => {
      expect(
        getUserDisplayName({
          fullName: '  Mehedi   Hasan ',
          email: 'mehedi@example.com',
        }),
      ).toBe('Mehedi Hasan');
    });

    it('falls back to non-synthetic email username', () => {
      expect(getUserDisplayName({ email: 'mehedi.hasan@example.com' })).toBe(
        'mehedi.hasan',
      );
    });

    it('skips synthetic email and formats BD phone numbers', () => {
      expect(
        getUserDisplayName({
          email: 'phone_8801712345678@synthetic.mentor',
          phone: '01712345678',
        }),
      ).toBe('+880 1712-345678');
    });

    it('returns trimmed non-BD phone or Account fallback when no contact info exists', () => {
      expect(getUserDisplayName({ phone: ' +1 555 0100 ' })).toBe('+1 555 0100');
      expect(getUserDisplayName(null)).toBe('Account');
      expect(getUserDisplayName({ fullName: '   ', email: '', phone: '' })).toBe(
        'Account',
      );
    });
  });

  describe('getUserRoleLabel', () => {
    it('returns trimmed role or defaults to Learner', () => {
      expect(getUserRoleLabel({ currentRole: '  Backend Developer  ' })).toBe(
        'Backend Developer',
      );
      expect(getUserRoleLabel({ currentRole: '   ' })).toBe('Learner');
      expect(getUserRoleLabel(undefined)).toBe('Learner');
    });
  });

  describe('resolveShellUserDisplay', () => {
    it('combines displayName, initials, and roleLabel cleanly', () => {
      expect(
        resolveShellUserDisplay({
          fullName: 'Mehedi Hasan',
          currentRole: 'Backend Developer',
          email: 'mehedi@example.com',
        }),
      ).toEqual({
        displayName: 'Mehedi Hasan',
        initials: 'MH',
        roleLabel: 'Backend Developer',
      });
    });
  });
});

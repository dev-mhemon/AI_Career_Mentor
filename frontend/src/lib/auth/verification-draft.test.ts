import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  VERIFICATION_DRAFT_STORAGE_KEY,
  MAX_VERIFICATION_DRAFT_TTL_SECONDS,
  normalizeVerificationIdentifier,
  maskVerificationContact,
  computeDraftExpiresAt,
  buildVerificationPath,
  saveVerificationDraft,
  loadVerificationDraft,
  updateVerificationDraftExpiry,
  clearVerificationDraft,
} from './verification-draft';

describe('R18 verification draft helper', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  describe('normalizeVerificationIdentifier', () => {
    it('normalizes email addresses by trimming and lowercasing', () => {
      expect(normalizeVerificationIdentifier('email', '  User@Example.COM  ')).toBe(
        'user@example.com',
      );
    });

    it('normalizes local Bangladesh mobile numbers to +880 format', () => {
      expect(
        normalizeVerificationIdentifier('phone', '01712-345678'),
      ).toBe('+8801712345678');
      expect(
        normalizeVerificationIdentifier('phone', '+8801812345678'),
      ).toBe('+8801812345678');
    });

    it('returns empty string on empty input', () => {
      expect(normalizeVerificationIdentifier('email', '   ')).toBe('');
    });
  });

  describe('maskVerificationContact', () => {
    it('masks email showing first char and domain', () => {
      expect(maskVerificationContact('email', 'rahim@example.com')).toBe(
        'r****@example.com',
      );
    });

    it('masks phone showing first 6 and last 2 characters', () => {
      expect(maskVerificationContact('phone', '+8801712345678')).toBe(
        '+88017****78',
      );
    });
  });

  describe('computeDraftExpiresAt and buildVerificationPath', () => {
    it('enforces min(challenge expiry, 10min)', () => {
      const now = 1000000000000;
      // 5 minutes (300s) -> 300s
      const exp300 = new Date(computeDraftExpiresAt(300, now)).getTime();
      expect(exp300 - now).toBe(300 * 1000);

      // 15 minutes (900s) -> clamped to 600s (10min)
      const exp900 = new Date(computeDraftExpiresAt(900, now)).getTime();
      expect(exp900 - now).toBe(MAX_VERIFICATION_DRAFT_TTL_SECONDS * 1000);

      // invalid / omitted -> clamped to 600s
      const expDefault = new Date(computeDraftExpiresAt(undefined, now)).getTime();
      expect(expDefault - now).toBe(MAX_VERIFICATION_DRAFT_TTL_SECONDS * 1000);
    });

    it('builds canonical PII-free verification URL', () => {
      expect(buildVerificationPath('email')).toBe('/verify?channel=email');
      expect(buildVerificationPath('phone')).toBe('/verify?channel=phone');
    });
  });

  describe('saveVerificationDraft and loadVerificationDraft', () => {
    it('saves draft containing only permitted fields and never secrets', () => {
      const now = 1700000000000;
      const draft = saveVerificationDraft(
        {
          channel: 'email',
          identifier: 'Candidate@Test.COM',
          contactMasked: 'c****@test.com',
          expiresInSeconds: 300,
          context: 'registration',
        },
        now,
      );

      expect(draft).not.toBeNull();
      const rawStored = window.sessionStorage.getItem(
        VERIFICATION_DRAFT_STORAGE_KEY,
      );
      expect(rawStored).not.toBeNull();
      const parsed = JSON.parse(rawStored!);

      expect(parsed).toEqual({
        channel: 'email',
        normalized_identifier: 'candidate@test.com',
        contact_masked: 'c****@test.com',
        expires_at: new Date(now + 300 * 1000).toISOString(),
        context: 'registration',
      });

      // Assert negative side effects / secrets absence
      expect(rawStored).not.toContain('password');
      expect(rawStored).not.toContain('code');
      expect(rawStored).not.toContain('token');
    });

    it('loads unexpired draft and clears expired draft', () => {
      const now = 1700000000000;
      saveVerificationDraft(
        {
          channel: 'email',
          identifier: 'user@example.com',
          expiresInSeconds: 60,
        },
        now,
      );

      // Unexpired: 30s later
      const loaded = loadVerificationDraft('email', now + 30 * 1000);
      expect(loaded.draft).not.toBeNull();
      expect(loaded.expired).toBe(false);
      expect(loaded.draft?.normalized_identifier).toBe('user@example.com');

      // Expired: 61s later
      const expired = loadVerificationDraft('email', now + 61 * 1000);
      expect(expired.draft).toBeNull();
      expect(expired.expired).toBe(true);
      expect(
        window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY),
      ).toBeNull();
    });

    it('clears draft if storage contains forbidden secret fields or invalid structure', () => {
      // Injected forbidden field
      window.sessionStorage.setItem(
        VERIFICATION_DRAFT_STORAGE_KEY,
        JSON.stringify({
          channel: 'email',
          normalized_identifier: 'user@example.com',
          contact_masked: 'u****@example.com',
          expires_at: new Date(Date.now() + 60000).toISOString(),
          context: 'registration',
          password: 'leaked-secret',
        }),
      );

      const loaded = loadVerificationDraft('email');
      expect(loaded.draft).toBeNull();
      expect(
        window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY),
      ).toBeNull();
    });

    it('returns null draft if channel does not match expected channel', () => {
      saveVerificationDraft({
        channel: 'email',
        identifier: 'user@example.com',
      });
      const result = loadVerificationDraft('phone');
      expect(result.draft).toBeNull();
      expect(result.expired).toBe(false);
    });
  });

  describe('updateVerificationDraftExpiry and clearVerificationDraft', () => {
    it('updates expiry on resend', () => {
      const now = 1700000000000;
      saveVerificationDraft(
        {
          channel: 'email',
          identifier: 'user@example.com',
          expiresInSeconds: 60,
        },
        now,
      );

      const updated = updateVerificationDraftExpiry(300, 'u****@newmask.com', now + 10000);
      expect(updated).not.toBeNull();
      expect(updated?.contact_masked).toBe('u****@newmask.com');
      expect(new Date(updated!.expires_at).getTime()).toBe(now + 10000 + 300 * 1000);
    });

    it('rejects expiry update when expectedChannel or expectedIdentifier does not match stored draft', () => {
      const now = 1700000000000;
      saveVerificationDraft(
        {
          channel: 'email',
          identifier: 'user@example.com',
          expiresInSeconds: 60,
        },
        now,
      );

      // Channel mismatch
      const wrongChannel = updateVerificationDraftExpiry(300, undefined, now, 'phone');
      expect(wrongChannel).toBeNull();

      // Identifier mismatch
      const wrongIdentifier = updateVerificationDraftExpiry(300, undefined, now, 'email', 'different@example.com');
      expect(wrongIdentifier).toBeNull();

      // Matching channel and identifier succeeds
      const matched = updateVerificationDraftExpiry(300, undefined, now, 'email', 'user@example.com');
      expect(matched).not.toBeNull();
    });

    it('clearVerificationDraft removes draft from sessionStorage', () => {
      saveVerificationDraft({
        channel: 'email',
        identifier: 'user@example.com',
      });
      expect(
        window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY),
      ).not.toBeNull();

      clearVerificationDraft();
      expect(
        window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY),
      ).toBeNull();
    });
  });
});

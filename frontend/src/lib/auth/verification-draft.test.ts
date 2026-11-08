import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  VERIFICATION_DRAFT_STORAGE_KEY,
  MAX_VERIFICATION_DRAFT_TTL_SECONDS,
  normalizeVerificationIdentifier,
  maskVerificationContact,
  computeDraftExpiresAt,
  buildVerificationPath,
  saveVerificationDraft,
  saveFallbackVerificationDraft,
  loadVerificationDraft,
  updateVerificationDraftExpiry,
  clearVerificationDraft,
  setPersistedCooldown,
  getPersistedCooldown,
  clearPersistedCooldown,
  RESEND_COOLDOWN_STORAGE_PREFIX,
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

    it('supports password_recovery context and loads without expectedChannel', () => {
      saveVerificationDraft({
        channel: 'email',
        identifier: 'recovery@example.com',
        context: 'password_recovery',
      });
      const result = loadVerificationDraft();
      expect(result.draft).not.toBeNull();
      expect(result.draft?.context).toBe('password_recovery');
      expect(result.draft?.contact_masked).toBe('r****@example.com');
      expect(result.expired).toBe(false);
    });

    it('filters by expectedContext and preserves other contexts without clearing', () => {
      saveVerificationDraft({
        channel: 'email',
        identifier: 'registering@example.com',
        context: 'registration',
      });

      // Calling with expectedContext 'password_recovery' must return null draft and expired false
      const result = loadVerificationDraft(null, Date.now(), 'password_recovery');
      expect(result.draft).toBeNull();
      expect(result.expired).toBe(false);

      // Stored registration draft must remain intact in sessionStorage
      const raw = window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!).context).toBe('registration');
    });

    it('filters by array of expectedContexts', () => {
      saveVerificationDraft({
        channel: 'email',
        identifier: 'recovery@example.com',
        context: 'password_recovery',
      });

      const allowedResult = loadVerificationDraft(null, Date.now(), [
        'password_recovery',
        'unverified_login',
      ]);
      expect(allowedResult.draft).not.toBeNull();
      expect(allowedResult.draft?.context).toBe('password_recovery');

      const rejectedResult = loadVerificationDraft(null, Date.now(), [
        'registration',
        'unverified_login',
      ]);
      expect(rejectedResult.draft).toBeNull();
      expect(rejectedResult.expired).toBe(false);
    });

    it('clears expired draft from storage while not reporting expired for a mismatched context', () => {
      const expiredRegistrationDraft = {
        channel: 'email',
        normalized_identifier: 'expired-reg@example.com',
        contact_masked: 'e****@example.com',
        expires_at: new Date(Date.now() - 10000).toISOString(),
        context: 'registration',
      };
      window.sessionStorage.setItem(
        VERIFICATION_DRAFT_STORAGE_KEY,
        JSON.stringify(expiredRegistrationDraft),
      );

      const result = loadVerificationDraft(null, Date.now(), 'password_recovery');
      expect(result.draft).toBeNull();
      expect(result.expired).toBe(false);

      // Expired draft must be cleared from storage, avoiding stale state
      expect(
        window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY),
      ).toBeNull();
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

    it('saveFallbackVerificationDraft saves when storage is missing or expired, but leaves another flow live draft intact', () => {
      const now = 1700000000000;

      // 1. Storage is empty: fallback saves successfully
      const savedWhenEmpty = saveFallbackVerificationDraft(
        {
          channel: 'email',
          identifier: 'fallback-user@example.com',
          expiresInSeconds: 300,
        },
        now,
      );
      expect(savedWhenEmpty).not.toBeNull();
      expect(savedWhenEmpty?.normalized_identifier).toBe('fallback-user@example.com');

      // 2. Storage has an active live draft: fallback returns null and leaves live draft intact
      const liveAttempt = saveFallbackVerificationDraft(
        {
          channel: 'email',
          identifier: 'older-form@example.com',
          expiresInSeconds: 300,
        },
        now + 5000,
      );
      expect(liveAttempt).toBeNull();
      const rawAfter = JSON.parse(
        window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY)!,
      );
      expect(rawAfter.normalized_identifier).toBe('fallback-user@example.com');

      // 3. Storage has an expired draft: fallback clears expired and saves
      const expiredAttempt = saveFallbackVerificationDraft(
        {
          channel: 'email',
          identifier: 'resurrected@example.com',
          expiresInSeconds: 300,
        },
        now + 301 * 1000, // 301 seconds later -> original draft expired
      );
      expect(expiredAttempt).not.toBeNull();
      expect(expiredAttempt?.normalized_identifier).toBe('resurrected@example.com');

      // 4. Storage has an active email draft: phone fallback returns null and leaves email draft intact
      const channelMismatchAttempt = saveFallbackVerificationDraft(
        {
          channel: 'phone',
          identifier: '01712345678',
          expiresInSeconds: 300,
        },
        now + 302 * 1000,
      );
      expect(channelMismatchAttempt).toBeNull();
      const rawAfterChannel = JSON.parse(
        window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY)!,
      );
      expect(rawAfterChannel.channel).toBe('email');
      expect(rawAfterChannel.normalized_identifier).toBe('resurrected@example.com');
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

  describe('resend cooldown persistence', () => {
    it('persists and retrieves cooldown deadline for email channel', () => {
      const now = 1000000;
      setPersistedCooldown('email', now + 45000, 45, now);

      const retrieved = getPersistedCooldown('email');
      expect(retrieved).toEqual({
        deadlineMs: now + 45000,
        originalSeconds: 45,
        createdAt: now,
      });
    });

    it('returns null and cleans up malformed stored cooldown', () => {
      window.sessionStorage.setItem(`${RESEND_COOLDOWN_STORAGE_PREFIX}email`, 'invalid-json');
      expect(getPersistedCooldown('email')).toBeNull();
      expect(window.sessionStorage.getItem(`${RESEND_COOLDOWN_STORAGE_PREFIX}email`)).toBeNull();
    });

    it('clears persisted cooldown when requested', () => {
      setPersistedCooldown('email', 1045000, 45, 1000000);
      expect(getPersistedCooldown('email')).not.toBeNull();

      clearPersistedCooldown('email');
      expect(getPersistedCooldown('email')).toBeNull();
    });
  });
});

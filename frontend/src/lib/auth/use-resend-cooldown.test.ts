import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResendCooldown } from '@/lib/auth/use-resend-cooldown';
import {
  clearVerificationDraft,
  getPersistedCooldown,
  setPersistedCooldown,
} from '@/lib/auth/verification-draft';

describe('useResendCooldown', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    clearVerificationDraft();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
    clearVerificationDraft();
  });

  it('clears persisted cooldown for the owning overrideIdentifier rather than active identifier', async () => {
    const now = Date.now();
    // Seed active identifier's cooldown that must remain untouched when override owner expires
    setPersistedCooldown('email', now + 60_000, 60, now, 'active@example.com');

    const { result } = renderHook(() =>
      useResendCooldown({ channel: 'email', identifier: 'active@example.com' }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Start a short cooldown specifically owned by override identifier `owner@example.com`
    act(() => {
      result.current.startCooldown(2, now + 2_000, 'owner@example.com');
    });

    expect(getPersistedCooldown('email', 'owner@example.com')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    // Owner's expired cooldown is cleared, while active@example.com retains its persisted cooldown
    expect(getPersistedCooldown('email', 'owner@example.com')).toBeNull();
    expect(getPersistedCooldown('email', 'active@example.com')).not.toBeNull();
  });
});

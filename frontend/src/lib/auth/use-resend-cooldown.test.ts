import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { computeInitialCooldown, useResendCooldown } from '@/lib/auth/use-resend-cooldown';
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

  it('removes expired storage entry and applies fresh relative URL cooldown parameter', () => {
    const now = 1_000_000;
    setPersistedCooldown('email', now - 5_000, 60, now - 65_000, 'user@example.com');

    const result = computeInitialCooldown(
      'email',
      new URLSearchParams('?cooldown=45'),
      now,
      'user@example.com',
    );

    expect(getPersistedCooldown('email', 'user@example.com')).toBeNull();
    expect(result).toEqual({
      seconds: 45,
      deadlineMs: now + 45_000,
      originalSeconds: 45,
    });
  });

  it('prefers live persisted storage deadline over fresh relative URL cooldown parameter', () => {
    const now = 1_000_000;
    setPersistedCooldown('email', now + 20_000, 60, now - 40_000, 'user@example.com');

    const result = computeInitialCooldown(
      'email',
      new URLSearchParams('?cooldown=60'),
      now,
      'user@example.com',
    );

    expect(result).toEqual({
      seconds: 20,
      deadlineMs: now + 20_000,
      originalSeconds: 60,
    });
  });

  it('still resolves expired explicit cooldownUntil param as expired even with expired storage', () => {
    const now = 1_000_000;
    setPersistedCooldown('email', now - 5_000, 60, now - 65_000, 'user@example.com');

    const result = computeInitialCooldown(
      'email',
      new URLSearchParams(`?cooldownUntil=${now - 1_000}`),
      now,
      'user@example.com',
    );

    expect(getPersistedCooldown('email', 'user@example.com')).toBeNull();
    expect(result).toEqual({
      seconds: 0,
      deadlineMs: null,
      originalSeconds: 60,
    });
  });
});

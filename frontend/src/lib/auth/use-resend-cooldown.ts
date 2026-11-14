'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearPersistedCooldown,
  getPersistedCooldown,
  getRawVerificationDraft,
  MAX_COOLDOWN_DURATION_SECONDS,
  setPersistedCooldown,
  type VerificationChannel,
} from '@/lib/auth/verification-draft';

/** Search params interface compatible with Next.js ReadonlyURLSearchParams and URLSearchParams. */
export interface CooldownSearchParamsLike {
  get(name: string): string | null;
  has(name: string): boolean;
}

const EMPTY_SEARCH_PARAMS: CooldownSearchParamsLike = {
  get: () => null,
  has: () => false,
};

/**
 * Safely parses and validates a cooldown query parameter in seconds.
 * Strictly accepts only digit-only strings in the range [1, 600].
 *
 * @param param - Raw query parameter string from search params.
 * @returns Validated cooldown duration in seconds, or 0 if missing or invalid.
 */
export function parseCooldownParam(param: string | null): number {
  if (!param) return 0;
  const trimmed = param.trim();
  if (!/^\d+$/.test(trimmed)) return 0;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, MAX_COOLDOWN_DURATION_SECONDS);
}

/**
 * Parses and validates an absolute expiry timestamp from query parameter or storage.
 *
 * @param param - Raw expiry string (epoch milliseconds or ISO 8601 date string).
 * @returns Validated expiry timestamp in epoch milliseconds, or null if invalid.
 */
export function parseExpiryTimestamp(param: string | null): number | null {
  if (!param) return null;
  const trimmed = param.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const epochMs = Number(trimmed);
    return Number.isSafeInteger(epochMs) && epochMs > 0 ? epochMs : null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Result structure for computeInitialCooldown containing seconds, target deadline, and original duration. */
export interface InitialCooldownResult {
  seconds: number;
  deadlineMs: number | null;
  originalSeconds: number;
}

/**
 * Computes the initial resend cooldown state purely on mount without writing to sessionStorage.
 * Reads existing persisted deadline (if in browser) or parses query parameters.
 */
export function computeInitialCooldown(
  channel: VerificationChannel | null | undefined,
  searchParams: { get(name: string): string | null },
  nowMs: number = Date.now(),
  identifier?: string | null,
): InitialCooldownResult {
  const expiryParam =
    searchParams.get('cooldownUntil') ||
    searchParams.get('resendAvailableAt') ||
    searchParams.get('resend_available_at');
  const directExpiryMs = parseExpiryTimestamp(expiryParam);

  const cooldownParam = searchParams.get('cooldown');
  const paramSeconds = parseCooldownParam(cooldownParam);

  const persisted = getPersistedCooldown(channel, identifier);

  if (
    typeof directExpiryMs === 'number' &&
    Number.isFinite(directExpiryMs) &&
    directExpiryMs > 0
  ) {
    const authoritativeMs =
      persisted !== null && persisted.deadlineMs > nowMs
        ? Math.max(directExpiryMs, persisted.deadlineMs)
        : directExpiryMs;

    if (authoritativeMs <= nowMs) {
      clearPersistedCooldown(channel, identifier);
      return {
        seconds: 0,
        deadlineMs: null,
        originalSeconds:
          persisted !== null && persisted.originalSeconds > 0
            ? persisted.originalSeconds
            : paramSeconds,
      };
    }

    const cappedMs = Math.min(authoritativeMs, nowMs + MAX_COOLDOWN_DURATION_SECONDS * 1000);
    const remaining = Math.max(0, Math.ceil((cappedMs - nowMs) / 1000));
    const originalSecs =
      persisted !== null && persisted.originalSeconds > 0
        ? persisted.originalSeconds
        : paramSeconds > 0
          ? paramSeconds
          : remaining;
    return {
      seconds: remaining,
      deadlineMs: cappedMs,
      originalSeconds: originalSecs,
    };
  }

  if (persisted !== null) {
    if (persisted.deadlineMs > nowMs) {
      const cappedMs = Math.min(persisted.deadlineMs, nowMs + MAX_COOLDOWN_DURATION_SECONDS * 1000);
      const remaining = Math.max(0, Math.ceil((cappedMs - nowMs) / 1000));
      return {
        seconds: remaining,
        deadlineMs: cappedMs,
        originalSeconds: persisted.originalSeconds,
      };
    }

    clearPersistedCooldown(channel, identifier);
    return {
      seconds: 0,
      deadlineMs: null,
      originalSeconds: persisted.originalSeconds,
    };
  }

  if (paramSeconds > 0) {
    const deadlineMs = nowMs + paramSeconds * 1000;
    return {
      seconds: paramSeconds,
      deadlineMs,
      originalSeconds: paramSeconds,
    };
  }

  return {
    seconds: 0,
    deadlineMs: null,
    originalSeconds: 0,
  };
}

export interface UseResendCooldownOptions {
  channel: VerificationChannel | null | undefined;
  identifier?: string | null;
  searchParams?: CooldownSearchParamsLike | null;
  consumeUrlParams?: boolean;
}

/**
 * Unified OTP resend cooldown hook with dual monotonic + wall-clock deadline countdown
 * and sessionStorage persistence across reloads.
 */
export function useResendCooldown({
  channel,
  identifier,
  searchParams,
  consumeUrlParams = false,
}: UseResendCooldownOptions) {
  const [cooldown, setCooldown] = useState<number>(0);
  const [isCooldownHydrated, setIsCooldownHydrated] = useState<boolean>(false);
  const [timerRunId, setTimerRunId] = useState<number>(0);
  const cooldownDeadlineRef = useRef<number | null>(null);
  const cooldownOwnerRef = useRef<string | null>(null);
  const activeSearchParams = searchParams ?? EMPTY_SEARCH_PARAMS;

  const resolveIdentifier = useCallback(
    (override?: string | null) =>
      override ?? identifier ?? getRawVerificationDraft()?.normalized_identifier ?? null,
    [identifier],
  );

  /** Hydrate persisted or query-param cooldown safely after mount. */
  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const initial = computeInitialCooldown(channel, activeSearchParams, now, identifier);
    if (initial.deadlineMs && initial.deadlineMs > now) {
      const hydratedOwner = resolveIdentifier();
      cooldownDeadlineRef.current = initial.deadlineMs;
      cooldownOwnerRef.current = hydratedOwner;
      setPersistedCooldown(
        channel,
        initial.deadlineMs,
        initial.originalSeconds,
        now,
        hydratedOwner,
      );
    } else {
      cooldownDeadlineRef.current = null;
      cooldownOwnerRef.current = null;
    }

    queueMicrotask(() => {
      if (cancelled) return;
      if (initial.seconds > 0) {
        setCooldown(initial.seconds);
        setTimerRunId((n) => n + 1);
      } else {
        setCooldown(0);
      }
      setIsCooldownHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, [channel, activeSearchParams, identifier, resolveIdentifier]);

  /** Consume one-time cooldown query parameters cleanly from browser history. */
  useEffect(() => {
    if (!consumeUrlParams) return;
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    if (
      activeSearchParams.has('cooldown') ||
      activeSearchParams.has('cooldownUntil') ||
      activeSearchParams.has('resendAvailableAt') ||
      activeSearchParams.has('resend_available_at')
    ) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('cooldown');
        url.searchParams.delete('cooldownUntil');
        url.searchParams.delete('resendAvailableAt');
        url.searchParams.delete('resend_available_at');
        window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
      } catch {
        // Ignore URL parsing errors in mocked test environments
      }
    }
  }, [consumeUrlParams, activeSearchParams]);

  /** Dual monotonic + wall-clock countdown loop with tab visibility catch-up. */
  useEffect(() => {
    if (cooldown <= 0) return;

    const now = Date.now();
    if (!cooldownDeadlineRef.current) {
      cooldownOwnerRef.current = resolveIdentifier();
      const initial = computeInitialCooldown(channel, activeSearchParams, now, identifier);
      if (initial.deadlineMs && initial.deadlineMs > now) {
        cooldownDeadlineRef.current = initial.deadlineMs;
      } else {
        cooldownDeadlineRef.current = now + cooldown * 1000;
      }
    }

    const wallDeadline = cooldownDeadlineRef.current;
    const ownerIdentifier = cooldownOwnerRef.current ?? resolveIdentifier();
    const initialRemainingMs = Math.max(0, wallDeadline - now);
    const monoDeadline = performance.now() + initialRemainingMs;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    const tick = () => {
      if (done) return;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      const remainingMs = Math.min(
        monoDeadline - performance.now(),
        wallDeadline - Date.now(),
      );
      if (remainingMs <= 0) {
        done = true;
        if (cooldownDeadlineRef.current === wallDeadline) {
          cooldownDeadlineRef.current = null;
          cooldownOwnerRef.current = null;
        }
        clearPersistedCooldown(channel, ownerIdentifier);
        setCooldown(0);
        return;
      }
      const next = Math.max(0, Math.ceil(remainingMs / 1000));
      setCooldown((prev) => (prev === next ? prev : next));
      timerId = setTimeout(tick, Math.min(250, Math.max(16, remainingMs)));
    };

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        tick();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    timerId = setTimeout(tick, Math.min(250, Math.max(16, initialRemainingMs)));

    return () => {
      done = true;
      if (timerId !== null) clearTimeout(timerId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
    // Re-arm timer whenever a new deadline run starts or cooldown transitions from <= 0 to > 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerRunId, cooldown > 0, channel, activeSearchParams, identifier, resolveIdentifier]);

  const startCooldown = useCallback(
    (seconds: number, absoluteDeadlineMs?: number, overrideIdentifier?: string | null) => {
      const now = Date.now();
      const ownerIdentifier = resolveIdentifier(overrideIdentifier);
      const cappedSecs = Math.min(
        MAX_COOLDOWN_DURATION_SECONDS,
        Math.max(0, Math.ceil(seconds)),
      );
      if (cappedSecs <= 0) {
        cooldownDeadlineRef.current = null;
        cooldownOwnerRef.current = null;
        clearPersistedCooldown(channel, ownerIdentifier);
        setCooldown(0);
        return;
      }
      const maxDeadline = now + MAX_COOLDOWN_DURATION_SECONDS * 1000;
      const deadlineMs =
        typeof absoluteDeadlineMs === 'number' && absoluteDeadlineMs > now
          ? Math.min(absoluteDeadlineMs, maxDeadline)
          : now + cappedSecs * 1000;
      const effectiveSecs = Math.max(1, Math.ceil((deadlineMs - now) / 1000));

      cooldownDeadlineRef.current = deadlineMs;
      cooldownOwnerRef.current = ownerIdentifier;
      setPersistedCooldown(
        channel,
        deadlineMs,
        effectiveSecs,
        now,
        ownerIdentifier,
      );
      setCooldown(effectiveSecs);
      setTimerRunId((n) => n + 1);
    },
    [channel, resolveIdentifier],
  );

  const startCooldownFromIso = useCallback(
    (
      isoOrUndefined?: string | null,
      fallbackSeconds = 60,
      overrideIdentifier?: string | null,
    ) => {
      const now = Date.now();
      const parsedMs = isoOrUndefined ? Date.parse(isoOrUndefined) : NaN;
      if (typeof parsedMs === 'number' && Number.isFinite(parsedMs) && parsedMs > 0) {
        if (parsedMs <= now) {
          startCooldown(0, undefined, overrideIdentifier);
          return;
        }
        const cappedMs = Math.min(parsedMs, now + MAX_COOLDOWN_DURATION_SECONDS * 1000);
        const secs = Math.max(0, Math.ceil((cappedMs - now) / 1000));
        startCooldown(secs, cappedMs, overrideIdentifier);
      } else {
        startCooldown(fallbackSeconds, now + fallbackSeconds * 1000, overrideIdentifier);
      }
    },
    [startCooldown],
  );

  const clearCooldown = useCallback(
    (overrideIdentifier?: string | null) => {
      cooldownDeadlineRef.current = null;
      cooldownOwnerRef.current = null;
      clearPersistedCooldown(channel, resolveIdentifier(overrideIdentifier));
      setCooldown(0);
    },
    [channel, resolveIdentifier],
  );

  return {
    cooldown,
    isCooldownHydrated,
    startCooldown,
    startCooldownFromIso,
    clearCooldown,
  };
}

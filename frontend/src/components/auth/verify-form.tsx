'use client';

import { useActionState, useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { verifyOtpAction, resendOtpAction, type AuthActionResult } from '@/lib/auth/actions';
import {
  loadVerificationDraft,
  saveFallbackVerificationDraft,
  updateVerificationDraftExpiry,
  clearVerificationDraft,
  setPersistedCooldown,
  getPersistedCooldown,
  clearPersistedCooldown,
  MAX_COOLDOWN_DURATION_SECONDS,
  type VerificationDraft,
  type VerificationChannel,
} from '@/lib/auth/verification-draft';

/**
 * Safely parses and validates a cooldown query parameter in seconds.
 * Strictly accepts only digit-only strings in the range [1, 600].
 * Any non-digit characters (e.g. "600junk", "-10", "12.5") or out-of-range
 * values return 0.
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
 * Strictly validates digit-only epoch timestamps or valid ISO 8601 strings.
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

/** Result structure for computeInitialCooldown containing seconds and target deadline. */
export interface InitialCooldownResult {
  seconds: number;
  deadlineMs: number | null;
}

/**
 * Computes the initial resend cooldown state purely on mount without writing to sessionStorage.
 * Reads existing persisted deadline (if in browser) or parses query parameters.
 *
 * @param channel - Active verification channel ('email' | 'phone').
 * @param searchParams - Readonly search parameters from the active URL.
 * @param nowMs - Current timestamp in epoch milliseconds (defaults to Date.now()).
 * @returns Initial remaining seconds and target deadline timestamp in milliseconds.
 */
export function computeInitialCooldown(
  channel: VerificationChannel | null | undefined,
  searchParams: { get(name: string): string | null },
  nowMs: number = Date.now(),
): InitialCooldownResult {
  const expiryParam =
    searchParams.get('cooldownUntil') ||
    searchParams.get('resendAvailableAt') ||
    searchParams.get('resend_available_at');
  const directExpiryMs = parseExpiryTimestamp(expiryParam);

  const cooldownParam = searchParams.get('cooldown');
  const paramSeconds = parseCooldownParam(cooldownParam);

  const persisted = getPersistedCooldown(channel);

  // Do not let an expired URL deadline (directExpiryMs <= nowMs) override a newer valid persisted.deadlineMs > nowMs
  const effectiveExpiryMs =
    directExpiryMs !== null && directExpiryMs > nowMs
      ? persisted !== null && persisted.deadlineMs > nowMs
        ? Math.max(directExpiryMs, persisted.deadlineMs)
        : directExpiryMs
      : null;

  if (effectiveExpiryMs !== null) {
    const cappedMs = Math.min(effectiveExpiryMs, nowMs + MAX_COOLDOWN_DURATION_SECONDS * 1000);
    const remaining = Math.max(0, Math.ceil((cappedMs - nowMs) / 1000));
    return {
      seconds: remaining,
      deadlineMs: cappedMs,
    };
  }

  if (persisted !== null) {
    if (persisted.deadlineMs > nowMs) {
      const cappedMs = Math.min(persisted.deadlineMs, nowMs + MAX_COOLDOWN_DURATION_SECONDS * 1000);
      const remaining = Math.max(0, Math.ceil((cappedMs - nowMs) / 1000));
      return {
        seconds: remaining,
        deadlineMs: cappedMs,
      };
    }

    if (
      paramSeconds > 0 &&
      persisted.originalSeconds === paramSeconds &&
      nowMs - persisted.deadlineMs < MAX_COOLDOWN_DURATION_SECONDS * 1000
    ) {
      return {
        seconds: 0,
        deadlineMs: null,
      };
    }
  }

  if (paramSeconds > 0) {
    const deadlineMs = nowMs + paramSeconds * 1000;
    return {
      seconds: paramSeconds,
      deadlineMs,
    };
  }

  return {
    seconds: 0,
    deadlineMs: null,
  };
}

/**
 * Verification form content component enforcing R18 draft lifecycle and contact privacy.
 * Reads the verification draft exactly once on mount via a dedicated useEffect to avoid
 * SSR hydration mismatches (sessionStorage is unavailable on the server).
 */
function VerifyFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const channelParam = (searchParams.get('channel') || searchParams.get('type')) as
    | 'email'
    | 'phone'
    | null;

  const [state, formAction, isPending] = useActionState<AuthActionResult, FormData>(
    verifyOtpAction,
    {},
  );

  /* SSR-safe: initialize to null/false; single mount effect hydrates from sessionStorage */
  const [draft, setDraft] = useState<VerificationDraft | null>(null);
  const [isDraftExpired, setIsDraftExpired] = useState<boolean>(false);
  const draftLoaded = useRef(false);

  const [reenteredIdentifier, setReenteredIdentifier] = useState('');

  // SSR-deterministic initial state (0/false); restored asynchronously on client mount
  const [cooldown, setCooldown] = useState<number>(0);
  const [isCooldownHydrated, setIsCooldownHydrated] = useState<boolean>(false);
  const cooldownDeadlineRef = useRef<number | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);

  /** Draft loading: single-responsibility mount effect, runs exactly once. */
  useEffect(() => {
    if (draftLoaded.current || !channelParam) return;
    draftLoaded.current = true;
    const { draft: loaded, expired } = loadVerificationDraft(
      channelParam,
      Date.now(),
      ['registration', 'unverified_login', 'secondary_contact'],
    );
    setDraft(loaded);
    setIsDraftExpired(expired);
  }, [channelParam]);

  /** Restore cooldown from query params or sessionStorage after mount (SSR-safe). */
  useEffect(() => {
    let cancelled = false;
    const initial = computeInitialCooldown(channelParam, searchParams, Date.now());
    if (initial.deadlineMs && initial.deadlineMs > Date.now()) {
      cooldownDeadlineRef.current = initial.deadlineMs;
      const remaining = Math.max(0, Math.ceil((initial.deadlineMs - Date.now()) / 1000));
      setPersistedCooldown(channelParam, initial.deadlineMs, remaining, Date.now());
    }

    queueMicrotask(() => {
      if (cancelled) return;
      if (initial.seconds > 0) {
        setCooldown(initial.seconds);
      }
      setIsCooldownHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, [channelParam, searchParams]);

  /** Successful verification navigation & draft clearance. */
  useEffect(() => {
    if (state?.success && state?.redirectTo) {
      const { draft: currentDraft } = loadVerificationDraft(
        channelParam,
        Date.now(),
        ['registration', 'unverified_login', 'secondary_contact'],
      );
      if (currentDraft) {
        clearVerificationDraft();
      }
      cooldownDeadlineRef.current = null;
      clearPersistedCooldown(channelParam);
      router.push(state.redirectTo);
    }
  }, [state, router, channelParam]);

  /** Cooldown timer: single-responsibility effect computing remaining time from deadline on each tick. */
  useEffect(() => {
    if (cooldown <= 0) return;

    if (!cooldownDeadlineRef.current) {
      const initial = computeInitialCooldown(channelParam, searchParams, Date.now());
      if (initial.deadlineMs && initial.deadlineMs > Date.now()) {
        cooldownDeadlineRef.current = initial.deadlineMs;
      } else {
        cooldownDeadlineRef.current = Date.now() + cooldown * 1000;
      }
    }

    const timer = setTimeout(() => {
      const deadline = cooldownDeadlineRef.current;
      if (!deadline) {
        setCooldown(0);
        return;
      }
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setCooldown(remaining);
      if (remaining <= 0) {
        cooldownDeadlineRef.current = null;
        clearPersistedCooldown(channelParam);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [cooldown, channelParam, searchParams]);

  /** Consume one-time cooldown query parameter to ensure clean browser history on reload. */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    if (
      searchParams.has('cooldown') ||
      searchParams.has('cooldownUntil') ||
      searchParams.has('resendAvailableAt') ||
      searchParams.has('resend_available_at')
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
  }, [searchParams]);

  /**
   * Handles resend: calls server action, updates or creates draft on success.
   * If updateVerificationDraftExpiry returns null (expired or cleared draft), falls back
   * to saveVerificationDraft while preserving the original draft context.
   */
  const handleResend = async () => {
    if (!channelParam || cooldown > 0) return;

    setIsResending(true);
    setResendError(null);
    setResendSuccess(null);

    try {
      const identifierToSend = draft?.normalized_identifier || reenteredIdentifier.trim();
      const result = await resendOtpAction(channelParam, identifierToSend);

      if (result.error) {
        setResendError(result.error);
      } else {
        setResendSuccess('Verification code sent successfully.');
        const availableAtRaw = (result as { resendAvailableAt?: string }).resendAvailableAt;
        const availableAtMs = availableAtRaw ? Date.parse(availableAtRaw) : NaN;
        const hasValidAvailableAt = Number.isFinite(availableAtMs) && availableAtMs > Date.now();
        const cappedAvailableAtMs = hasValidAvailableAt
          ? Math.min(availableAtMs, Date.now() + MAX_COOLDOWN_DURATION_SECONDS * 1000)
          : null;
        const cooldownSecs =
          cappedAvailableAtMs !== null
            ? Math.max(0, Math.ceil((cappedAvailableAtMs - Date.now()) / 1000))
            : 60;
        const deadlineMs =
          cappedAvailableAtMs !== null
            ? cappedAvailableAtMs
            : Date.now() + cooldownSecs * 1000;

        cooldownDeadlineRef.current = deadlineMs;
        setPersistedCooldown(channelParam, deadlineMs, cooldownSecs, Date.now());
        setCooldown(cooldownSecs);
        if (result.expiresInSeconds) {
          const updated = identifierToSend
            ? updateVerificationDraftExpiry(
                result.expiresInSeconds,
                result.contactMasked,
                Date.now(),
                channelParam,
                identifierToSend,
              )
            : null;
          const next =
            updated ??
            (identifierToSend
              ? saveFallbackVerificationDraft({
                  channel: channelParam,
                  identifier: identifierToSend,
                  contactMasked: result.contactMasked || draft?.contact_masked,
                  expiresInSeconds: result.expiresInSeconds,
                  context: draft?.context ?? 'registration',
                })
              : null);
          if (next) {
            setDraft(next);
            setIsDraftExpired(false);
          }
        }
      }
    } catch {
      setResendError('Failed to resend verification code. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  if (!channelParam || !['email', 'phone'].includes(channelParam)) {
    return (
      <div className="text-center text-sm text-red-600">
        Invalid verification link. Please go back and try again.
      </div>
    );
  }

  const maskedDisplay = draft?.contact_masked;
  const instructionText =
    channelParam === 'email'
      ? maskedDisplay
        ? `Enter the verification code sent to ${maskedDisplay}.`
        : 'Enter the verification code sent to your email.'
      : maskedDisplay
        ? `Enter the verification code sent to ${maskedDisplay} via SMS.`
        : 'Enter the verification code sent to your phone via SMS.';

  return (
    <div className="flex flex-col gap-6">
      <form
        action={formAction}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="channel" value={channelParam} />
        <input type="hidden" name="type" value={channelParam} />

        {draft ? (
          <input
            type="hidden"
            name="identifier"
            value={draft.normalized_identifier}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="identifier"
              className="text-sm font-medium text-foreground"
            >
              {channelParam === 'email' ? 'Email Address' : 'Phone Number'}
            </label>
            <input
              id="identifier"
              name="identifier"
              type={channelParam === 'email' ? 'email' : 'tel'}
              required
              value={reenteredIdentifier}
              onChange={(e) => setReenteredIdentifier(e.target.value)}
              disabled={isPending}
              className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
              placeholder={channelParam === 'email' ? 'you@example.com' : '+88017...'}
            />
            {isDraftExpired && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Verification draft expired. Please re-enter your{' '}
                {channelParam === 'email' ? 'email' : 'phone number'}.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="token" className="text-sm font-medium text-foreground">
            {instructionText}
          </label>
          <input
            id="token"
            name="token"
            type="text"
            required
            disabled={isPending}
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
            placeholder="Verification code"
          />
        </div>

        {state.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="mt-2 h-11 w-full rounded-lg bg-foreground font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50"
        >
          {isPending ? 'Verifying...' : 'Verify Code'}
        </button>
      </form>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          disabled={!isCooldownHydrated || cooldown > 0 || isResending}
          onClick={() => handleResend()}
          className="text-sm font-medium text-foreground underline underline-offset-4 hover:text-foreground/80 disabled:opacity-50"
        >
          {isResending
            ? 'Sending...'
            : cooldown > 0
              ? `Resend code in ${cooldown}s`
              : 'Resend verification code'}
        </button>

        {resendError && (
          <p role="alert" className="text-sm text-red-600 text-center">
            {resendError}
          </p>
        )}
        {resendSuccess && (
          <p role="alert" className="text-sm text-green-600 text-center">
            {resendSuccess}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Verify form wrapped in Suspense boundary for Next.js searchParams compatibility.
 */
export function VerifyForm() {
  return (
    <Suspense fallback={<div className="text-sm text-center">Loading...</div>}>
      <VerifyFormContent />
    </Suspense>
  );
}

'use client';

import { useActionState, useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { verifyOtpAction, resendOtpAction, type AuthActionResult } from '@/lib/auth/actions';
import {
  loadVerificationDraft,
  saveVerificationDraft,
  saveFallbackVerificationDraft,
  updateVerificationDraftExpiry,
  clearVerificationDraft,
  type VerificationDraft,
} from '@/lib/auth/verification-draft';

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
  const [cooldown, setCooldown] = useState(0);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);

  /** Draft loading: single-responsibility mount effect, runs exactly once. */
  useEffect(() => {
    if (draftLoaded.current || !channelParam) return;
    draftLoaded.current = true;
    const { draft: loaded, expired } = loadVerificationDraft(channelParam);
    setDraft(loaded);
    setIsDraftExpired(expired);
  }, [channelParam]);

  /** Successful verification navigation & draft clearance. */
  useEffect(() => {
    if (state?.success && state?.redirectTo) {
      clearVerificationDraft();
      router.push(state.redirectTo);
    }
  }, [state, router]);

  /** Cooldown timer: single-responsibility effect. */
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

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
        setCooldown(60);
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
          disabled={cooldown > 0 || isResending}
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

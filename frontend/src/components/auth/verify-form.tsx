'use client';

import { type SyntheticEvent, useActionState, useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { verifyOtpAction, resendOtpAction, type AuthActionResult } from '@/lib/auth/actions';
import { AuthAlert, useDismissedActionState } from '@/components/auth/auth-alert';
import { Alert, formatCountdown } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  normalizeBdPhone,
  validateBdPhone,
  validateBdPhoneOnChange,
  validateEmail,
  validateEmailLive,
  validateOtp,
  validateOtpLive,
} from '@/lib/validation/auth-schemas';
import type { ActionErrorLike } from '@/lib/api/error-mapper';
import {
  loadVerificationDraft,
  getRawVerificationDraft,
  saveFallbackVerificationDraft,
  updateVerificationDraftExpiry,
  clearVerificationDraft,
  type VerificationDraft,
} from '@/lib/auth/verification-draft';
import {
  parseCooldownParam,
  parseExpiryTimestamp,
  computeInitialCooldown,
  useResendCooldown,
  type InitialCooldownResult,
} from '@/lib/auth/use-resend-cooldown';

export {
  parseCooldownParam,
  parseExpiryTimestamp,
  computeInitialCooldown,
  type InitialCooldownResult,
};

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
  const { visibleState: visibleAlertState, onFormActivity } =
    useDismissedActionState(state);

  /* SSR-safe: initialize to null/false; single mount effect hydrates from sessionStorage */
  const [draft, setDraft] = useState<VerificationDraft | null>(null);
  const [isDraftExpired, setIsDraftExpired] = useState<boolean>(false);
  const draftLoaded = useRef(false);

  const [reenteredIdentifier, setReenteredIdentifier] = useState('');
  const [identifierError, setIdentifierError] = useState<string | undefined>();
  const [codeError, setCodeError] = useState<string | undefined>();
  const [dismissedServer, setDismissedServer] = useState<{
    ref: AuthActionResult;
    fields: Set<string>;
  } | null>(null);
  const identifierBlurredRef = useRef(false);

  const normalizedReentered =
    channelParam === 'phone'
      ? normalizeBdPhone(reenteredIdentifier) ?? reenteredIdentifier.trim()
      : reenteredIdentifier.trim().toLowerCase();
  const activeIdentifier = draft?.normalized_identifier || normalizedReentered || null;
  const activeContactKey =
    channelParam && activeIdentifier ? `${channelParam}:${activeIdentifier}` : null;
  const activeContactRef = useRef<string | null>(activeContactKey);
  useEffect(() => {
    activeContactRef.current = activeContactKey;
  }, [activeContactKey]);

  // Cooldown managed cleanly via shared monotonic + wall-clock hook
  const {
    cooldown,
    isCooldownHydrated,
    startCooldown,
    startCooldownFromIso,
    clearCooldown,
  } = useResendCooldown({
    channel: channelParam,
    identifier: activeIdentifier,
    searchParams,
    consumeUrlParams: true,
  });
  const [resendError, setResendError] = useState<ActionErrorLike | null>(null);
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

  /** Successful verification navigation & draft clearance. */
  useEffect(() => {
    if (state?.success && state?.redirectTo) {
      const { draft: currentDraft } = loadVerificationDraft(
        channelParam,
        Date.now(),
        ['registration', 'unverified_login', 'secondary_contact'],
      );
      const contactIdentifier =
        currentDraft?.normalized_identifier ||
        getRawVerificationDraft()?.normalized_identifier ||
        reenteredIdentifier;

      clearCooldown(contactIdentifier);
      if (currentDraft || getRawVerificationDraft()) {
        clearVerificationDraft();
      }
      router.push(state.redirectTo);
    }
  }, [state, router, channelParam, reenteredIdentifier, clearCooldown]);

  /**
   * Handles resend: calls server action, updates or creates draft on success.
   * If updateVerificationDraftExpiry returns null (expired or cleared draft), falls back
   * to saveVerificationDraft while preserving the original draft context.
   */
  const handleResend = async () => {
    if (!channelParam || cooldown > 0 || isResending || isPending) return;

    const requestChannel = channelParam;
    const identifierToSend = activeIdentifier ?? '';
    const requestKey =
      requestChannel && identifierToSend ? `${requestChannel}:${identifierToSend}` : null;

    setIsResending(true);
    setResendError(null);
    setResendSuccess(null);

    try {
      const result = await resendOtpAction(requestChannel, identifierToSend);

      if (activeContactRef.current !== requestKey) {
        return;
      }

      if (result.error) {
        setResendError(result);
        if (typeof result.retryAfterSeconds === 'number' && result.retryAfterSeconds > 0) {
          startCooldown(result.retryAfterSeconds, undefined, identifierToSend);
        }
      } else {
        setResendSuccess('Verification code sent successfully.');
        startCooldownFromIso(
          (result as { resendAvailableAt?: string }).resendAvailableAt,
          60,
          identifierToSend,
        );
        if (result.expiresInSeconds) {
          const updated = identifierToSend
            ? updateVerificationDraftExpiry(
                result.expiresInSeconds,
                result.contactMasked,
                Date.now(),
                requestChannel,
                identifierToSend,
              )
            : null;
          const next =
            updated ??
            (identifierToSend
              ? saveFallbackVerificationDraft({
                  channel: requestChannel,
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
      if (activeContactRef.current === requestKey) {
        setResendError({ error: 'Failed to resend verification code. Please try again.' });
      }
    } finally {
      setIsResending(false);
    }
  };

  if (!channelParam || !['email', 'phone'].includes(channelParam)) {
    return (
      <Alert variant="error_retryable" action={{ label: 'Back to sign in', href: '/login' }}>
        Invalid verification link. Please go back and try again.
      </Alert>
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

  const dismissServerField = (field: string) =>
    setDismissedServer((prev) => {
      if (!state?.fieldErrors?.[field]) return prev;
      if (prev?.ref === state && prev.fields.has(field)) return prev;
      const fields = new Set(prev?.ref === state ? prev.fields : []);
      fields.add(field);
      return { ref: state, fields };
    });

  const serverFieldError = (field: string) =>
    dismissedServer?.ref === state && dismissedServer.fields.has(field)
      ? undefined
      : state?.fieldErrors?.[field];

  const handleFormActivity = (e: SyntheticEvent<HTMLFormElement>) => {
    onFormActivity(e);
    if (
      resendError &&
      (e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement)
    ) {
      setResendError(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <form
        action={formAction}
        noValidate
        onFocusCapture={handleFormActivity}
        onChangeCapture={handleFormActivity}
        onSubmit={(e) => {
          const form = e.currentTarget;
          let invalid = false;
          let invalidIdentifier = false;
          let invalidCode = false;
          if (!draft) {
            const check =
              channelParam === 'email'
                ? validateEmail(reenteredIdentifier)
                : validateBdPhone(reenteredIdentifier);
            if (!check.ok) {
              if (channelParam === 'phone' && reenteredIdentifier.trim()) {
                identifierBlurredRef.current = true;
              }
              setIdentifierError(check.error);
              invalid = true;
              invalidIdentifier = true;
            } else {
              setIdentifierError(undefined);
              if (channelParam === 'email') {
                const emailEl = form.elements.namedItem('identifier') as HTMLInputElement | null;
                if (emailEl) emailEl.value = check.value;
              }
            }
          }
          const code = validateOtp(
            (form.elements.namedItem('token') as HTMLInputElement).value,
          );
          if (!code.ok) {
            setCodeError(code.error);
            invalid = true;
            invalidCode = true;
          } else {
            setCodeError(undefined);
          }
          if (invalid) {
            e.preventDefault();
            const targetSelector = invalidIdentifier
              ? '#identifier, [name="identifier"]:not([type="hidden"])'
              : invalidCode
                ? '#token, [name="token"]:not([type="hidden"])'
                : null;
            if (targetSelector) {
              form.querySelector<HTMLElement>(targetSelector)?.focus();
            }
          }
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="channel" value={channelParam} />
        <input type="hidden" name="type" value={channelParam} />
        {draft?.context && (
          <input type="hidden" name="context" value={draft.context} />
        )}

        {draft ? (
          <input
            type="hidden"
            name="identifier"
            value={draft.normalized_identifier}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <Input
              id="identifier"
              name="identifier"
              variant={channelParam === 'email' ? 'email' : 'phone_bd'}
              label={channelParam === 'email' ? 'Email Address' : 'Phone Number'}
              required
              value={reenteredIdentifier}
              error={identifierError ?? serverFieldError('identifier')}
              onChange={(e) => {
                const v = e.target.value;
                setReenteredIdentifier(v);
                if (channelParam) {
                  const nextNormalized =
                    channelParam === 'phone'
                      ? normalizeBdPhone(v) ?? v.trim()
                      : v.trim().toLowerCase();
                  activeContactRef.current = nextNormalized
                    ? `${channelParam}:${nextNormalized}`
                    : null;
                }
                setResendError(null);
                setResendSuccess(null);
                dismissServerField('identifier');
                if (channelParam === 'email') {
                  const check = validateEmailLive(v);
                  setIdentifierError(check.ok ? undefined : check.error);
                } else {
                  const check = validateBdPhoneOnChange(v, identifierBlurredRef.current);
                  if (check.resetBlurred) identifierBlurredRef.current = false;
                  setIdentifierError(check.error);
                }
              }}
              onBlur={(e) => {
                if (!e.target.value.trim()) {
                  identifierBlurredRef.current = false;
                  return;
                }
                identifierBlurredRef.current = true;
                const check =
                  channelParam === 'email'
                    ? validateEmail(e.target.value)
                    : validateBdPhone(e.target.value);
                if (!check.ok) setIdentifierError(check.error);
                else {
                  if (channelParam === 'email') {
                    setReenteredIdentifier(check.value);
                  }
                  setIdentifierError(undefined);
                }
              }}
              readOnly={isPending || isResending}
              placeholder={channelParam === 'email' ? 'you@example.com' : '01712-345678'}
            />
            {isDraftExpired && (
              <Alert variant="warning">
                Verification draft expired. Please re-enter your{' '}
                {channelParam === 'email' ? 'email' : 'phone number'}.
              </Alert>
            )}
          </div>
        )}

        <Input
          id="token"
          name="token"
          variant="otp_6"
          label={instructionText}
          required
          readOnly={isPending}
          error={codeError ?? serverFieldError('token') ?? serverFieldError('code')}
          onChange={(e) => {
            dismissServerField('token');
            dismissServerField('code');
            const check = validateOtpLive(e.target.value);
            setCodeError(check.ok ? undefined : check.error);
          }}
          onBlur={(e) => {
            if (!e.target.value.trim()) return;
            const check = validateOtp(e.target.value);
            setCodeError(check.ok ? undefined : check.error);
          }}
        />

        <AuthAlert result={visibleAlertState} />

        <Button type="submit" size="lg" fullWidth isLoading={isPending} loadingText="Verifying…">
          Verify Code
        </Button>
      </form>

      <div className="flex flex-col items-center gap-2 text-body-sm text-text-secondary">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <span>Didn&apos;t receive a code?</span>
          <Button
            variant="link"
            isLoading={isResending}
            loadingText="Sending…"
            disabled={!isCooldownHydrated || cooldown > 0 || isResending}
            onClick={() => handleResend()}
            className={cooldown > 0 ? 'no-underline tabular-nums' : 'underline-offset-4'}
          >
            {cooldown > 0 ? `Resend code in ${formatCountdown(cooldown)}` : 'Resend code'}
          </Button>
          <span className="sr-only" aria-live="polite">
            {isCooldownHydrated && cooldown === 0 ? 'You can now resend the verification code.' : ''}
          </span>
        </div>

        <AuthAlert result={resendError} />
        {resendSuccess && <Alert variant="success">{resendSuccess}</Alert>}
      </div>
    </div>
  );
}
/**
 * Verify form wrapped in Suspense boundary for Next.js searchParams compatibility.
 */
export function VerifyForm() {
  return (
    <Suspense fallback={<div role="status" className="text-center text-body-sm text-text-secondary">Loading…</div>}>
      <VerifyFormContent />
    </Suspense>
  );
}

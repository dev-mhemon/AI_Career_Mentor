'use client';

import { useActionState, useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { verifyOtpAction, resendOtpAction, type AuthActionResult } from '@/lib/auth/actions';

function VerifyFormContent() {
  const searchParams = useSearchParams();
  const typeParam = searchParams.get('type') as 'email' | 'phone' | null;
  const identifierParam = searchParams.get('identifier');

  const [state, formAction, isPending] = useActionState<AuthActionResult, FormData>(
    verifyOtpAction,
    {},
  );

  const [cooldown, setCooldown] = useState(0);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const handleResend = async () => {
    if (!typeParam || !identifierParam || cooldown > 0) return;

    setIsResending(true);
    setResendError(null);
    setResendSuccess(null);

    const result = await resendOtpAction(typeParam, identifierParam);

    if (result.error) {
      setResendError(result.error);
    } else {
      setResendSuccess('Verification code sent successfully.');
      setCooldown(60);
    }
    setIsResending(false);
  };

  if (!typeParam || !identifierParam) {
    return (
      <div className="text-center text-sm text-red-600">
        Invalid verification link. Please go back and try again.
      </div>
    );
  }

  const instructionText =
    typeParam === 'email'
      ? 'Enter the verification code sent to your email.'
      : 'Enter the verification code sent to your phone via SMS.';

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="type" value={typeParam} />
        <input type="hidden" name="identifier" value={identifierParam} />

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

export function VerifyForm() {
  return (
    <Suspense fallback={<div className="text-sm text-center">Loading...</div>}>
      <VerifyFormContent />
    </Suspense>
  );
}

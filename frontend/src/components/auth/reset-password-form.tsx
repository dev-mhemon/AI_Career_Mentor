"use client";

import { type SyntheticEvent, useActionState, useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  resetPasswordAction,
  forgotPasswordAction,
  type AuthActionResult,
} from "@/lib/auth/actions";
import { AuthAlert, useDismissedActionState } from "@/components/auth/auth-alert";
import { Alert, formatCountdown } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionErrorLike } from "@/lib/api/error-mapper";
import {
  loadVerificationDraft,
  clearVerificationDraft,
  updateVerificationDraftExpiry,
  saveVerificationDraft,
  type VerificationChannel,
  type VerificationDraft,
} from "@/lib/auth/verification-draft";
import { useResendCooldown } from "@/lib/auth/use-resend-cooldown";
import {
  PASSWORD_MAX,
  passwordStrength,
  validateIdentifier,
  validateIdentifierOnChange,
  validateOtp,
  validateOtpLive,
  validatePassword,
  validatePasswordLive,
  validatePasswordMatch,
} from "@/lib/validation/auth-schemas";

/**
 * Screen 06: Password Reset Form component.
 * Verifies OTP code, validates password confirmation, and updates password (EP-A09).
 */
export function ResetPasswordForm() {
  const [state, formAction, isPending] = useActionState<
    AuthActionResult,
    FormData
  >(resetPasswordAction, {});

  const [draft, setDraft] = useState<VerificationDraft | null>(null);
  const [isDraftExpired, setIsDraftExpired] = useState<boolean>(false);
  const draftLoaded = useRef(false);
  const identifierBlurredRef = useRef(false);
  const [enteredIdentifier, setEnteredIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isResending, setIsResending] = useState(false);
  const [resendError, setResendError] = useState<ActionErrorLike | null>(null);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const { visibleState: visibleAlertState, onFormActivity } =
    useDismissedActionState(state);
  const [dismissedServer, setDismissedServer] = useState<{
    ref: AuthActionResult;
    fields: Set<string>;
  } | null>(null);

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

  const resolvedContact = (() => {
    if (draft?.normalized_identifier) {
      return {
        channel: draft.channel as VerificationChannel,
        identifier: draft.normalized_identifier,
      };
    }
    const trimmed = enteredIdentifier.trim();
    if (!trimmed) return null;
    const check = validateIdentifier(trimmed);
    if (!check.ok) return null;
    return {
      channel: check.value.kind as VerificationChannel,
      identifier: check.value.value,
    };
  })();

  const activeContactKey = resolvedContact
    ? `${resolvedContact.channel}:${resolvedContact.identifier}`
    : null;
  const activeContactRef = useRef<string | null>(activeContactKey);
  useEffect(() => {
    activeContactRef.current = activeContactKey;
  }, [activeContactKey]);

  const {
    cooldown,
    isCooldownHydrated,
    startCooldown,
    clearCooldown,
  } = useResendCooldown({
    channel: resolvedContact?.channel ?? null,
    identifier: resolvedContact?.identifier ?? null,
  });

  useEffect(() => {
    if (draftLoaded.current) return;
    draftLoaded.current = true;
    const { draft: loaded, expired } = loadVerificationDraft(
      null,
      Date.now(),
      "password_recovery",
    );
    setDraft(loaded?.context === "password_recovery" ? loaded : null);
    setIsDraftExpired(expired);
  }, []);

  useEffect(() => {
    if (state?.success) {
      clearCooldown(draft?.normalized_identifier ?? resolvedContact?.identifier);
      if (draft?.context === "password_recovery") {
        clearVerificationDraft();
      }
    }
  }, [state, draft, clearCooldown, resolvedContact?.identifier]);

  const handleResend = async () => {
    if (!resolvedContact || cooldown > 0 || isResending || isPending) return;

    const requestContact = resolvedContact;
    const requestKey = `${requestContact.channel}:${requestContact.identifier}`;

    setIsResending(true);
    setResendError(null);
    setResendSuccess(null);

    try {
      const formData = new FormData();
      formData.set("identifier", requestContact.identifier);
      formData.set("mode", "resend");
      const result = await forgotPasswordAction({}, formData);

      if (activeContactRef.current !== requestKey) {
        return;
      }

      if (result?.error) {
        setResendError(result);
        if (typeof result.retryAfterSeconds === "number" && result.retryAfterSeconds > 0) {
          startCooldown(result.retryAfterSeconds, undefined, requestContact.identifier);
        }
      } else {
        setResendSuccess("Verification code sent successfully.");
        startCooldown(60, undefined, requestContact.identifier);
        const updated =
          updateVerificationDraftExpiry(
            600,
            draft?.contact_masked,
            Date.now(),
            requestContact.channel,
            requestContact.identifier,
          ) ??
          saveVerificationDraft({
            channel: requestContact.channel,
            identifier: requestContact.identifier,
            contactMasked: draft?.contact_masked,
            context: "password_recovery",
          });
        if (updated) {
          setDraft(updated);
          setIsDraftExpired(false);
        }
      }
    } catch {
      if (activeContactRef.current === requestKey) {
        setResendError({
          error: "Failed to resend verification code. Please try again.",
        });
      }
    } finally {
      setIsResending(false);
    }
  };

  const setFieldError = (field: string, error?: string) =>
    setClientErrors((prev) => {
      if (!error) {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      }
      if (prev[field] === error) return prev;
      return { ...prev, [field]: error };
    });

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

  const strength = passwordStrength(password);
  const mismatch =
    confirm.length > 0 && !validatePasswordMatch(password, confirm).ok
      ? "Passwords do not match."
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      {draft?.contact_masked ? (
        <Alert variant="info">
          Reset code sent to: <span className="font-semibold">{draft.contact_masked}</span>
        </Alert>
      ) : isDraftExpired ? (
        <Alert variant="warning">
          Recovery session expired. Please re-enter your email or phone below.
        </Alert>
      ) : null}

      <form
        action={formAction}
        noValidate
        onFocusCapture={handleFormActivity}
        onChangeCapture={handleFormActivity}
        onSubmit={(e) => {
          const form = e.currentTarget;
          const errors: Record<string, string> = {};
          const idEl = form.elements.namedItem("identifier") as HTMLInputElement | null;
          if (idEl && idEl.type !== "hidden") {
            const id = validateIdentifier(idEl.value);
            if (!id.ok) {
              errors.identifier = id.error;
              if (idEl.value.trim()) identifierBlurredRef.current = true;
            } else {
              idEl.value = id.value.value;
            }
          }
          const code = validateOtp(
            (form.elements.namedItem("code") as HTMLInputElement).value,
          );
          if (!code.ok) errors.code = code.error;
          const pw = validatePassword(password);
          if (!pw.ok) errors.new_password = pw.error;
          const match = validatePasswordMatch(password, confirm);
          if (!match.ok) errors.confirm_new_password = match.error;
          if (Object.keys(errors).length) {
            e.preventDefault();
            setClientErrors(errors);
            const firstField = (
              [
                "identifier",
                "code",
                "new_password",
                "confirm_new_password",
              ] as const
            ).find((key) => Boolean(errors[key]));
            if (firstField) {
              form
                .querySelector<HTMLElement>(
                  `#${firstField}, [name="${firstField}"]:not([type="hidden"])`,
                )
                ?.focus();
            }
            return;
          }
          setClientErrors({});
        }}
        className="flex flex-col gap-4"
      >
        {draft?.normalized_identifier ? (
          <input
            type="hidden"
            name="identifier"
            value={draft.normalized_identifier}
          />
        ) : (
          <Input
            id="identifier"
            name="identifier"
            label="Email or Phone"
            required
            readOnly={isPending || isResending}
            error={clientErrors.identifier ?? serverFieldError("identifier")}
            onChange={(e) => {
              const nextVal = e.target.value;
              setEnteredIdentifier(nextVal);
              if (!draft?.normalized_identifier) {
                const nextCheck = validateIdentifier(nextVal.trim());
                activeContactRef.current = nextCheck.ok
                  ? `${nextCheck.value.kind}:${nextCheck.value.value}`
                  : null;
              }
              setResendError(null);
              setResendSuccess(null);
              dismissServerField("identifier");
              const check = validateIdentifierOnChange(
                e.target.value,
                identifierBlurredRef.current,
              );
              if (check.resetBlurred) identifierBlurredRef.current = false;
              setFieldError("identifier", check.error);
            }}
            onBlur={(e) => {
              if (!e.target.value.trim()) {
                identifierBlurredRef.current = false;
                setEnteredIdentifier("");
                return;
              }
              identifierBlurredRef.current = true;
              const res = validateIdentifier(e.target.value);
              if (!res.ok) {
                setEnteredIdentifier(e.target.value);
                setFieldError("identifier", res.error);
              } else {
                if (res.value.kind === "email") e.target.value = res.value.value;
                setEnteredIdentifier(e.target.value);
                setFieldError("identifier", undefined);
              }
            }}
            placeholder="you@example.com or +8801712345678"
          />
        )}

        <Input
          id="code"
          name="code"
          variant="otp_6"
          label="6-Digit Verification Code"
          required
          readOnly={isPending}
          error={clientErrors.code ?? serverFieldError("code")}
          onChange={(e) => {
            dismissServerField("code");
            const res = validateOtpLive(e.target.value);
            setFieldError("code", res.ok ? undefined : res.error);
          }}
          onBlur={(e) => {
            if (!e.target.value.trim()) return;
            const res = validateOtp(e.target.value);
            setFieldError("code", res.ok ? undefined : res.error);
          }}
        />

        <div className="flex flex-col gap-2">
          <Input
            id="new_password"
            name="new_password"
            variant="password"
            label="New Password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={PASSWORD_MAX}
            readOnly={isPending}
            value={password}
            error={clientErrors.new_password ?? serverFieldError("new_password")}
            onChange={(e) => {
              const v = e.target.value;
              setPassword(v);
              dismissServerField("new_password");
              const pw = validatePasswordLive(v);
              setFieldError("new_password", pw.ok ? undefined : pw.error);
              if (!confirm || validatePasswordMatch(v, confirm).ok) {
                setFieldError("confirm_new_password", undefined);
              }
            }}
            onBlur={(e) => {
              if (!e.target.value) return;
              const pw = validatePassword(e.target.value);
              setFieldError("new_password", pw.ok ? undefined : pw.error);
            }}
            placeholder="At least 8 characters"
          />
          {password && (
            <p aria-live="polite" className="text-caption text-text-secondary">
              Strength: <strong className="text-text-primary">{strength.label}</strong> ({strength.score}/4)
            </p>
          )}
        </div>

        <Input
          id="confirm_new_password"
          name="confirm_new_password"
          variant="password"
          label="Confirm New Password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={PASSWORD_MAX}
          readOnly={isPending}
          value={confirm}
          error={
            clientErrors.confirm_new_password ??
            serverFieldError("confirm_new_password") ??
            mismatch
          }
          onChange={(e) => {
            setConfirm(e.target.value);
            dismissServerField("confirm_new_password");
            setFieldError("confirm_new_password", undefined);
          }}
          placeholder="Repeat new password"
        />

        <AuthAlert result={visibleAlertState} />

        <Button type="submit" size="lg" fullWidth isLoading={isPending} loadingText="Resetting password…">
          Set New Password
        </Button>
      </form>

      <div className="flex flex-col items-center gap-2 text-body-sm text-text-secondary">
        {resolvedContact ? (
          <div className="flex w-full flex-col items-center gap-2">
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <span>Didn&apos;t receive a code?</span>
              <Button
                type="button"
                variant="link"
                isLoading={isResending}
                loadingText="Sending…"
                disabled={!isCooldownHydrated || cooldown > 0 || isResending || isPending}
                onClick={() => handleResend()}
                className={cooldown > 0 ? "no-underline tabular-nums" : "underline-offset-4"}
              >
                {cooldown > 0 ? `Resend code in ${formatCountdown(cooldown)}` : "Resend code"}
              </Button>
              <span className="sr-only" aria-live="polite">
                {isCooldownHydrated && cooldown === 0 ? "You can now resend the verification code." : ""}
              </span>
            </div>
            <AuthAlert result={resendError} />
            {resendSuccess && <Alert variant="success">{resendSuccess}</Alert>}
          </div>
        ) : (
          <p>
            Didn&apos;t receive a code?{" "}
            <Link
              href="/forgot-password"
              className="font-medium text-text-link underline underline-offset-4 hover:text-text-link-hover"
            >
              Resend code
            </Link>
          </p>
        )}
        <p>
          Remember your password?{" "}
          <Link
            href="/login"
            className="font-medium text-text-link underline underline-offset-4 hover:text-text-link-hover"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

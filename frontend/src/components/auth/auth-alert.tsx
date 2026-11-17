"use client";

import { useCallback, useState, type FocusEvent, type SyntheticEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { mapActionResult, type ActionErrorLike } from "@/lib/api/error-mapper";

/**
 * Tracks dismissal of the active server-action result on user field focus or change,
 * re-exposing the alert whenever a new submission returns a new state reference.
 */
export function useDismissedActionState<T>(state: T) {
  const [dismissedState, setDismissedState] = useState<T | null>(null);
  const isDismissed = state !== null && state !== undefined && dismissedState === state;

  const dismiss = useCallback(() => {
    if (state !== null && state !== undefined && dismissedState !== state) {
      setDismissedState(state);
    }
  }, [state, dismissedState]);

  const onFormActivity = useCallback(
    (e: SyntheticEvent<HTMLFormElement>) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        dismiss();
      }
    },
    [dismiss],
  );

  return {
    visibleState: isDismissed ? null : state,
    isDismissed,
    dismiss,
    onFormActivity,
  };
}

/**
 * Returns true when an action error represents an explicit resend/rate-limit cooldown
 * (as opposed to an invalid code or transient 5xx failure).
 */
export function isCooldownWaitResult(
  result: ActionErrorLike | null | undefined,
): boolean {
  if (!result?.error) return false;
  if (
    result.code === "RESEND_COOLDOWN_ACTIVE" ||
    /wait before requesting another code/i.test(result.error)
  ) {
    return true;
  }
  return (
    result.status === 429 &&
    result.code !== "OTP_LIMIT_EXCEEDED" &&
    typeof result.retryAfterSeconds === "number" &&
    result.retryAfterSeconds > 0
  );
}

/**
 * Renders a failed server-action result through the central error mapper.
 * Errors -> role="alert"; rate-limit/conflict tones -> role="status" with live countdown.
 */
export function AuthAlert({
  result,
  message,
  action,
  resetKey,
}: {
  result?: ActionErrorLike | null;
  /** Override copy (e.g. 401 login). */
  message?: string;
  action?: { label: string; href?: string; onClick?: () => void };
  resetKey?: unknown;
}) {
  const mapped = mapActionResult(result);
  if (!mapped) return null;
  const isRateLimitWait =
    mapped.status === 423 ||
    mapped.status === 429 ||
    mapped.code === "RESEND_COOLDOWN_ACTIVE" ||
    mapped.code === "RATE_LIMITED" ||
    mapped.code === "OTP_LIMIT_EXCEEDED" ||
    mapped.code === "ACCOUNT_LOCKED";
  const hasWait =
    isRateLimitWait &&
    mapped.retryAfterSeconds !== null &&
    mapped.retryAfterSeconds > 0;
  const variant = mapped.tone === "error" && !hasWait ? "error_retryable" : "warning";
  return (
    <Alert
      variant={variant}
      role={hasWait ? "status" : "alert"}
      retryAfterSeconds={hasWait ? mapped.retryAfterSeconds : null}
      resetKey={resetKey ?? result}
      action={action}
    >
      {message ?? mapped.message}
    </Alert>
  );
}

/**
 * Returns true when blur moves focus onto the password visibility toggle
 * button inside the same input wrapper so toggling visibility preserves field state.
 */
export function isPasswordToggleBlur(
  e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
): boolean {
  const related = e.relatedTarget;
  if (!(related instanceof Element)) return false;
  const toggle = related.closest('[data-password-toggle="true"], button');
  return Boolean(toggle && e.currentTarget.parentElement?.contains(toggle));
}

/**
 * Clears transient inline validation errors when an empty field loses focus,
 * validates non-empty values, and ignores focus transitions to the password toggle.
 */
export function handleAuthBlur(
  e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  options: {
    clearError: () => void;
    validate?: (value: string) => { ok: boolean; error?: string };
    setError?: (error: string | undefined) => void;
    ignorePasswordToggle?: boolean;
  },
): void {
  if (options.ignorePasswordToggle && isPasswordToggleBlur(e)) return;
  if (!e.target.value.trim()) {
    options.clearError();
    return;
  }
  if (options.validate && options.setError) {
    const res = options.validate(e.target.value);
    options.setError(res.ok ? undefined : res.error);
  }
}

/**
 * Moves keyboard/screen-reader focus to the first invalid control within a form after client validation fails.
 */
export function focusFirstInvalidControl(form: HTMLFormElement): void {
  setTimeout(() => {
    if (!form.isConnected) return;
    const target = form.querySelector<HTMLElement>(
      'input[aria-invalid="true"], textarea[aria-invalid="true"], select[aria-invalid="true"], [data-invalid="true"]',
    );
    if (!target) return;
    target.scrollIntoView?.({ behavior: "smooth", block: "center" });
    target.focus();
  }, 0);
}

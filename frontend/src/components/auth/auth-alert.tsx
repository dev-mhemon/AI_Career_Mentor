"use client";

import { useCallback, useState, type SyntheticEvent } from "react";
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
  const hasWait = mapped.retryAfterSeconds !== null && mapped.retryAfterSeconds > 0;
  const variant = mapped.tone === "error" && !hasWait ? "error_retryable" : "warning";
  return (
    <Alert
      variant={variant}
      role={hasWait ? "status" : "alert"}
      retryAfterSeconds={mapped.retryAfterSeconds}
      resetKey={resetKey ?? result}
      action={action}
    >
      {message ?? mapped.message}
    </Alert>
  );
}

"use client";

import { Alert } from "@/components/ui/alert";
import { mapActionResult, type ActionErrorLike } from "@/lib/api/error-mapper";

/**
 * Renders a failed server-action result through the central error mapper.
 * Errors -> role="alert"; rate-limit/conflict tones -> role="status" with live countdown.
 */
export function AuthAlert({
  result,
  message,
  action,
}: {
  result?: ActionErrorLike | null;
  /** Override copy (e.g. 401 login). */
  message?: string;
  action?: { label: string; href?: string; onClick?: () => void };
}) {
  const mapped = mapActionResult(result);
  if (!mapped) return null;
  const hasWait = mapped.retryAfterSeconds !== null && mapped.retryAfterSeconds > 0;
  const variant = mapped.tone === "error" && !hasWait ? "error_retryable" : "warning";
  return (
    <Alert
      key={`${mapped.message}-${mapped.retryAfterSeconds ?? 0}`}
      variant={variant}
      role="alert"
      retryAfterSeconds={mapped.retryAfterSeconds}
      action={action}
    >
      {message ?? mapped.message}
    </Alert>
  );
}

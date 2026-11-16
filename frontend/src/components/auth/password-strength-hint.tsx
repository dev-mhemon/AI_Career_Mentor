"use client";

import { cn } from "@/components/ui/cn";
import {
  passwordStrength,
  type PasswordStrength,
} from "@/lib/validation/auth-schemas";

export const PASSWORD_HELPER_TEXT =
  "Must be at least 8 characters. Mixed with uppercase, lowercase, numbers, and symbols is stronger.";

const STRENGTH_COLOR_CLASS: Record<PasswordStrength["score"], string> = {
  0: "text-red-600 dark:text-red-400",
  1: "text-red-600 dark:text-red-400",
  2: "text-amber-600 dark:text-amber-400",
  3: "text-teal-600 dark:text-teal-400",
  4: "text-emerald-600 dark:text-emerald-400",
};

/**
 * Password policy helper copy and semantic color-coded strength feedback.
 */
export function PasswordStrengthHint({ password }: { password: string }) {
  const strength = passwordStrength(password);

  return (
    <p aria-live="polite" className="text-caption text-text-secondary">
      {PASSWORD_HELPER_TEXT}
      {password && (
        <>
          {" "}
          Strength:{" "}
          <strong
            className={cn(
              "font-semibold tracking-wide",
              STRENGTH_COLOR_CLASS[strength.score],
            )}
          >
            {strength.label}
          </strong>{" "}
          ({strength.score}/4)
        </>
      )}
    </p>
  );
}

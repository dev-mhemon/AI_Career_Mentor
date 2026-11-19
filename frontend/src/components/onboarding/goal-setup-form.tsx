'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { M05Invoke, MappedError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  MultiStepFormWrapper,
  toneToAlertVariant,
} from '@/components/ui/multi-step-form-wrapper';

export const GOAL_TEXT_MIN = 3;
export const GOAL_TEXT_MAX = 300;

/** Unicode code-point length (matches backend `Array.from(value).length` / PostgreSQL `char_length`). */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

const MALFORMED_UNICODE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Validates trimmed text against inclusive code-point bounds and rejects NUL / unpaired surrogates,
 * mirroring the backend DTO rules. Returns a safe message or `null` when valid.
 */
export function validateBoundedText(
  raw: string,
  min: number,
  max: number,
  noun: string,
): string | null {
  const text = raw.trim();
  if (MALFORMED_UNICODE.test(text)) {
    return `${noun} contains characters that are not supported.`;
  }
  const length = codePointLength(text);
  if (length < min) {
    return min === 1
      ? `Enter your ${noun.toLowerCase()}.`
      : `${noun} must be at least ${min} characters.`;
  }
  if (length > max) return `${noun} must be at most ${max} characters.`;
  return null;
}

export const EXAMPLE_GOAL_ROLES = [
  'Backend developer',
  'Frontend developer',
  'Data analyst',
  'AI engineer',
  'DevOps engineer',
  'Mobile app developer',
] as const;

export interface GoalSetupFormProps {
  invoke: M05Invoke;
  initialGoalText?: string;
}

/**
 * Screen 10 (`/onboarding/goal`, Step 4 of 5). Submits `goal_text` via EP-C01 and routes to
 * `/onboarding/clarify?goalId=<id>` for both `clarifying` and `awaiting_confirmation` outcomes.
 */
export function GoalSetupForm({ invoke, initialGoalText = '' }: GoalSetupFormProps) {
  const router = useRouter();
  const [text, setText] = useState(initialGoalText);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [apiError, setApiError] = useState<MappedError | null>(null);

  const count = codePointLength(text.trim());
  const validation = validateBoundedText(text, GOAL_TEXT_MIN, GOAL_TEXT_MAX, 'Goal');
  const showValidation = touched && validation !== null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (validation !== null || pending) return;
    setPending(true);
    setApiError(null);
    const result = await invoke('createCareerGoal', { goal_text: text.trim() });
    setPending(false);
    if (!result.ok) {
      setApiError(result.error); // input text is preserved for retry
      return;
    }
    router.push(`/onboarding/clarify?goalId=${encodeURIComponent(result.data.id)}`);
  }

  const outOfScope = apiError?.code === 'OUT_OF_SCOPE_GOAL';
  const limitReached = apiError?.code === 'ROADMAP_LIMIT_REACHED';

  return (
    <form onSubmit={submit} noValidate>
      <MultiStepFormWrapper
        currentStep={4}
        heading="What is your career goal?"
        description="Tell us the technology role you want, in Bangla, English or a mix. Up to 3 goals can be active."
        status={pending ? 'submitting' : 'editing'}
        actions={
          <>
            <Link
              href="/onboarding/preferences"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border-default px-4 py-2.5 text-label-lg text-text-primary hover:bg-surface-subtle"
            >
              Back
            </Link>
            <Button
              type="submit"
              size="lg"
              isLoading={pending}
              disabled={pending}
              loadingText="Analyzing your goal..."
            >
              Analyze Goal
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <Input
            variant="textarea"
            label="Career goal"
            name="goal_text"
            rows={3}
            value={text}
            required
            readOnly={pending}
            placeholder="e.g. Backend developer, mainly Node.js"
            error={showValidation ? (validation ?? undefined) : undefined}
            onChange={(e) => {
              setText(e.target.value);
              if (apiError && apiError.code !== 'ROADMAP_LIMIT_REACHED') {
                setApiError(null);
              }
            }}
            onBlur={() => setTouched(true)}
          />
          <p
            aria-live="polite"
            className="text-caption tabular-nums text-text-secondary"
          >
            {count} / {GOAL_TEXT_MAX} characters (minimum {GOAL_TEXT_MIN})
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-label text-text-secondary">Example roles</p>
          <ul className="flex flex-wrap gap-2" aria-label="Example technology roles">
            {EXAMPLE_GOAL_ROLES.map((role) => (
              <li key={role}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setText(role);
                    setTouched(false);
                    setApiError(null);
                  }}
                  className="min-h-11 cursor-pointer rounded-full border border-border-default bg-surface-sunken px-3 text-body-sm text-text-primary hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:text-text-disabled"
                >
                  {role}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div role="status" aria-live="polite" className="empty:hidden">
          {pending && (
            <p className="text-body-sm text-text-secondary">
              Analyzing your goal. This usually takes a few seconds.
            </p>
          )}
        </div>

        {apiError && (
          <Alert
            variant={toneToAlertVariant(apiError.tone)}
            role="alert"
            title={
              outOfScope
                ? 'Technology goals only'
                : limitReached
                  ? 'Goal limit reached'
                  : undefined
            }
            action={
              limitReached
                ? { label: 'Manage your goals', href: '/career-profile' }
                : undefined
            }
          >
            {apiError.message}
            {outOfScope && ' Pick one of the example roles above or describe a technology role in your own words.'}
          </Alert>
        )}
      </MultiStepFormWrapper>
    </form>
  );
}

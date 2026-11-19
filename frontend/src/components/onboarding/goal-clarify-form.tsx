'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { CareerGoalResponse, CareerLevel } from '@/lib/api/client';
import type { M05Invoke, MappedError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CareerCard, CareerCardGroup } from '@/components/ui/career-card';
import { Input } from '@/components/ui/input';
import {
  MultiStepFormWrapper,
  toneToAlertVariant,
} from '@/components/ui/multi-step-form-wrapper';
import { validateBoundedText } from './goal-setup-form';

export const CLARIFICATION_ROUNDS_MAX = 2;
export const CLARIFICATION_ANSWER_MAX = 300;

const LEVEL_OPTIONS: ReadonlyArray<{ value: CareerLevel; label: string }> = [
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
];

export interface GoalClarifyFormProps {
  /** Goal loaded server-side from EP-C03; `null` when it could not be loaded. */
  goal: CareerGoalResponse | null;
  loadError?: string | null;
  invoke: M05Invoke;
}

/**
 * Screen 11 (`/onboarding/clarify`, Step 5 of 5).
 * `clarifying` → answer round (EP-C04); `awaiting_confirmation` → pick role + explicit level (EP-C05).
 */
export function GoalClarifyForm({ goal: initialGoal, loadError, invoke }: GoalClarifyFormProps) {
  const router = useRouter();
  const [goal, setGoal] = useState<CareerGoalResponse | null>(initialGoal);
  const [answer, setAnswer] = useState('');
  const [answerTouched, setAnswerTouched] = useState(false);
  const [roleId, setRoleId] = useState<string | null>(
    () => initialGoal?.proposed_role?.canonical_role_id ?? null,
  );
  const [level, setLevel] = useState<CareerLevel | ''>('');
  const [pending, setPending] = useState(false);
  const [apiError, setApiError] = useState<MappedError | null>(null);

  const answerError = validateBoundedText(answer, 1, CLARIFICATION_ANSWER_MAX, 'Answer');

  /** Re-syncs with the server after a state conflict (`409`) so the screen shows the real step. */
  async function resync(goalId: string) {
    const fresh = await invoke('getCareerGoal', { id: goalId });
    if (fresh.ok) {
      setGoal(fresh.data);
      setRoleId(fresh.data.proposed_role?.canonical_role_id ?? null);
    }
  }

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAnswerTouched(true);
    if (!goal || answerError !== null || pending) return;
    setPending(true);
    setApiError(null);
    const result = await invoke('submitGoalClarification', {
      id: goal.id,
      body: { answer: answer.trim() },
    });
    if (!result.ok) {
      setApiError(result.error);
      if (
        result.error.code === 'CLARIFICATION_LIMIT_REACHED' ||
        result.error.code === 'INVALID_STATE_TRANSITION'
      ) {
        await resync(goal.id);
      }
      setPending(false);
      return;
    }
    setPending(false);
    setGoal(result.data);
    setRoleId(result.data.proposed_role?.canonical_role_id ?? null);
    setAnswer('');
    setAnswerTouched(false);
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!goal || !roleId || !level || pending) return;
    setPending(true);
    setApiError(null);
    const result = await invoke('confirmCareerGoal', {
      id: goal.id,
      body: { canonical_role_id: roleId, target_level: level },
    });
    setPending(false);
    if (!result.ok) {
      setApiError(result.error);
      return;
    }
    router.push('/career-profile');
  }

  const errorAlert = apiError && (
    <Alert variant={toneToAlertVariant(apiError.tone)} role="alert">
      {apiError.message}
    </Alert>
  );

  const backLink = (
    <Link
      href="/onboarding/goal"
      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border-default px-4 py-2.5 text-label-lg text-text-primary hover:bg-surface-subtle"
    >
      Back to goal
    </Link>
  );

  if (!goal) {
    return (
      <MultiStepFormWrapper
        currentStep={5}
        heading="Clarify & Confirm"
        errorMessage={loadError ?? 'We could not load this goal.'}
        actions={
          <>
            {backLink}
            <Link
              href="/career-profile"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-action-primary-background px-5 text-label-lg text-action-primary-foreground hover:bg-action-primary-background-hover"
            >
              Open Career Profile
            </Link>
          </>
        }
      >
        <p className="text-body-sm text-text-secondary">
          Go back and submit your goal again, or open your Career Profile to see saved goals.
        </p>
      </MultiStepFormWrapper>
    );
  }

  if (goal.status === 'clarifying') {
    const round = Math.min(Math.max(goal.clarification_round, 1), CLARIFICATION_ROUNDS_MAX);
    return (
      <form onSubmit={submitAnswer} noValidate>
        <MultiStepFormWrapper
          currentStep={5}
          heading="One quick question"
          description={`Your goal: “${goal.goal_text}”`}
          status={pending ? 'submitting' : 'editing'}
          actions={
            <>
              {backLink}
              <Button
                type="submit"
                size="lg"
                isLoading={pending}
                disabled={pending}
                loadingText="Analyzing your answer..."
              >
                Submit Answer
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 rounded-lg border border-border-default bg-surface-default p-4">
            <span className="inline-flex w-fit items-center rounded-full border border-feedback-info-border bg-feedback-info-background px-2.5 py-0.5 text-caption font-medium text-feedback-info-text">
              Round {round} of {CLARIFICATION_ROUNDS_MAX}
            </span>
            <p dir="auto" className="text-body text-text-primary">
              {goal.clarification_question ?? 'Tell us a little more about the role you want.'}
            </p>
          </div>
          <Input
            variant="textarea"
            label="Your answer"
            rows={3}
            value={answer}
            required
            readOnly={pending}
            error={answerTouched && answerError ? answerError : undefined}
            onChange={(e) => setAnswer(e.target.value)}
            onBlur={() => setAnswerTouched(true)}
          />
          <p aria-live="polite" className="text-caption tabular-nums text-text-secondary">
            {Array.from(answer.trim()).length} / {CLARIFICATION_ANSWER_MAX} characters
          </p>
          {errorAlert}
        </MultiStepFormWrapper>
      </form>
    );
  }

  if (goal.status === 'awaiting_confirmation') {
    const proposed = goal.proposed_role;
    const hasOptions = proposed !== null || goal.alternative_roles.length > 0;
    const capped = goal.clarification_round >= CLARIFICATION_ROUNDS_MAX;
    return (
      <form onSubmit={confirm} noValidate>
        <MultiStepFormWrapper
          currentStep={5}
          heading="Confirm your role and level"
          description={
            capped
              ? 'This is the best interpretation of your goal. Please confirm it or choose an alternative.'
              : `Your goal: “${goal.goal_text}”`
          }
          status={pending ? 'submitting' : 'editing'}
          actions={
            <>
              {backLink}
              <Button
                type="submit"
                size="lg"
                isLoading={pending}
                disabled={!roleId || !level || pending}
                loadingText="Confirming..."
              >
                Confirm Role &amp; Level
              </Button>
            </>
          }
        >
          {hasOptions ? (
            <CareerCardGroup label="Career role options">
              {proposed && (
                <CareerCard
                  title={proposed.name}
                  recommended
                  selected={roleId === proposed.canonical_role_id}
                  disabled={pending}
                  onSelect={() => setRoleId(proposed.canonical_role_id)}
                />
              )}
              {goal.alternative_roles.map((role) => (
                <CareerCard
                  key={role.canonical_role_id}
                  title={role.name}
                  rationale={role.rationale}
                  recommended={false}
                  selected={roleId === role.canonical_role_id}
                  disabled={pending}
                  onSelect={() => setRoleId(role.canonical_role_id)}
                />
              ))}
            </CareerCardGroup>
          ) : (
            <Alert variant="warning" role="alert">
              We could not find a matching role for this goal. Go back and reword it.
            </Alert>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="target-level" className="text-label-lg text-text-primary">
              Target career level
            </label>
            <select
              id="target-level"
              value={level}
              disabled={pending}
              onChange={(e) => setLevel(e.target.value as CareerLevel | '')}
              className="min-h-11 w-full rounded-md border border-border-default bg-surface-default px-3 text-body text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:cursor-not-allowed disabled:bg-surface-disabled"
            >
              <option value="">Select your target level</option>
              {LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {goal.suggested_level && (
              <p className="text-caption text-text-secondary">
                Suggested level: {LEVEL_OPTIONS.find((o) => o.value === goal.suggested_level)?.label}.
                Choose the level you want to aim for.
              </p>
            )}
          </div>
          {errorAlert}
        </MultiStepFormWrapper>
      </form>
    );
  }

  return (
    <MultiStepFormWrapper
      currentStep={5}
      heading={goal.status === 'confirmed' ? 'Goal confirmed' : 'Goal discontinued'}
      actions={
        <Link
          href="/career-profile"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-action-primary-background px-5 text-label-lg text-action-primary-foreground hover:bg-action-primary-background-hover"
        >
          Go to Career Profile
        </Link>
      }
    >
      <p dir="auto" className="text-body text-text-secondary">
        {goal.status === 'confirmed'
          ? `“${goal.goal_text}” is already confirmed.`
          : `“${goal.goal_text}” was discontinued and can no longer be changed.`}
      </p>
    </MultiStepFormWrapper>
  );
}

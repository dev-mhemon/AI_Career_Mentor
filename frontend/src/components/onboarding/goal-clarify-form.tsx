'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type SVGProps,
} from 'react';
import type { CareerGoalResponse, CareerLevel } from '@/lib/api/client';
import {
  mapApiError,
  type M05Invoke,
  type MappedError,
} from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CareerCard, CareerCardGroup } from '@/components/ui/career-card';
import { Input } from '@/components/ui/input';
import { toneToAlertVariant } from '@/components/ui/multi-step-form-wrapper';
import {
  clearGoalDraft,
  clearPendingGoalTargetLevel,
  parseGoalDraft,
  readGoalDraft,
  readGoalDraftRaw,
  readPendingGoalTargetLevels,
  subscribeGoalDraft,
  validateBoundedText,
  type GoalDraftScope,
} from './goal-setup-form';
import { StepFrame } from './step-shell';

export const CLARIFICATION_ROUNDS_MAX = 2;
export const CLARIFICATION_ANSWER_MAX = 300;

function TargetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

/**
 * Exact normalized preset-to-canonical-role mappings for `EXAMPLE_GOAL_ROLES`.
 * Used strictly for explicit preset/catalog selections — never substring/keyword overlap.
 */
const PRESET_ROLE_MATCHES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['backend developer', new Set(['backend development', 'backend developer', 'backend'])],
  ['frontend developer', new Set(['frontend development', 'frontend developer', 'frontend'])],
  ['data analyst', new Set(['data analyst', 'data analytics', 'data analysis', 'data engineering'])],
  ['ai engineer', new Set(['ai engineer', 'ai engineering', 'ai machine learning', 'machine learning', 'ai ml'])],
  ['devops engineer', new Set(['devops engineer', 'devops engineering', 'devops', 'cloud devops'])],
  ['mobile app developer', new Set(['mobile app developer', 'mobile development', 'mobile engineering', 'mobile'])],
]);

function normalizeRoleText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Returns `true` ONLY when the user's goal text is an explicit exact catalog/preset role selection
 * matching the proposed canonical role name or slug (never substring/keyword overlap such as
 * `"Backend developer, not frontend"` matching `"Frontend Development"`).
 */
export function doesGoalMatchRole(
  goalText: string,
  roleName: string,
  roleSlug?: string | null,
): boolean {
  const normGoal = normalizeRoleText(goalText);
  const normRoleName = normalizeRoleText(roleName);
  const normRoleSlug = roleSlug ? normalizeRoleText(roleSlug) : '';
  if (!normGoal || !normRoleName) return false;

  if (normGoal === normRoleName) return true;
  if (normRoleSlug && normGoal === normRoleSlug) return true;

  const presetTargets = PRESET_ROLE_MATCHES.get(normGoal);
  if (presetTargets) {
    return (
      presetTargets.has(normRoleName) ||
      (normRoleSlug.length > 0 && presetTargets.has(normRoleSlug))
    );
  }
  return false;
}

export interface GoalClarifyFormProps {
  /** Goal loaded server-side from EP-C03 or passed from wizard state; `null` when unavailable. */
  goal: CareerGoalResponse | null;
  /** Target career level selected in Step 4; falls back to `goal.suggested_level`. */
  initialTargetLevel?: CareerLevel | null;
  /** Authenticated user ID for clearing account-scoped Step 4 drafts on confirmation. */
  userId?: string;
  /** Draft storage scope isolating onboarding Step 4 drafts from inline Career Profile add drafts. */
  draftScope?: GoalDraftScope;
  loadError?: string | null;
  invoke: M05Invoke;
  /** Notifies an outer wizard container whenever clarification/confirmation enters or exits pending state. */
  onPendingChange?: (pending: boolean) => void;
  /** Optional callback fired whenever clarification or resync updates the goal object. */
  onGoalUpdated?: (goal: CareerGoalResponse) => void;
  /** Optional callback fired when EP-C05 confirms the goal instead of navigating to `/career-profile`. */
  onSuccess?: (goal: CareerGoalResponse) => void;
  /** Optional Back handler when embedded inside a wizard or inline view. */
  onBack?: () => void;
  /** When true, omits the standalone stepper header so an outer shell owns stepper chrome. */
  embedded?: boolean;
}

/**
 * Screen 11 (`/onboarding`, Step 5 of 5).
 * `clarifying` → answer round (EP-C04); `awaiting_confirmation` → confirm role (EP-C05) using
 * the target career level carried over from Step 4 (or AI `suggested_level` fallback).
 */
export function GoalClarifyForm({
  goal: initialGoal,
  initialTargetLevel = null,
  userId,
  draftScope = 'onboarding',
  loadError,
  invoke,
  onPendingChange,
  onGoalUpdated,
  onSuccess,
  onBack,
  embedded = false,
}: GoalClarifyFormProps) {
  const router = useRouter();
  const [syncedPropGoal, setSyncedPropGoal] =
    useState<CareerGoalResponse | null>(initialGoal);
  const [goal, setGoal] = useState<CareerGoalResponse | null>(initialGoal);
  const [answer, setAnswer] = useState('');
  const [answerTouched, setAnswerTouched] = useState(false);
  const [roleId, setRoleId] = useState<string | null>(
    () =>
      initialGoal?.proposed_role?.canonical_role_id ??
      initialGoal?.alternative_roles[0]?.canonical_role_id ??
      null,
  );
  const [pending, setPending] = useState(false);
  const [apiError, setApiError] = useState<MappedError | null>(null);

  useEffect(() => {
    onPendingChange?.(pending);
    return () => {
      onPendingChange?.(false);
    };
  }, [pending, onPendingChange]);

  if (initialGoal !== syncedPropGoal) {
    setSyncedPropGoal(initialGoal);
    setGoal(initialGoal);
    setRoleId(
      initialGoal?.proposed_role?.canonical_role_id ??
        initialGoal?.alternative_roles[0]?.canonical_role_id ??
        null,
    );
    if (
      initialGoal?.id !== syncedPropGoal?.id ||
      initialGoal?.status !== syncedPropGoal?.status
    ) {
      setAnswer('');
      setAnswerTouched(false);
    }
  }

  const rawDraft = useSyncExternalStore(
    subscribeGoalDraft,
    () => readGoalDraftRaw(userId, draftScope),
    () => null,
  );
  const draft = parseGoalDraft(rawDraft);
  const persistedGoalLevel: CareerLevel | null =
    goal && !goal.target_level
      ? (readPendingGoalTargetLevels(userId)[goal.id] ?? null)
      : null;
  const draftTargetLevel: CareerLevel | null =
    goal &&
    !goal.target_level &&
    draft?.goalId === goal.id &&
    draft.targetLevel !== '' &&
    draft.targetLevelExplicit !== false
      ? draft.targetLevel
      : null;

  const resolvedLevel: CareerLevel =
    draftTargetLevel ??
    initialTargetLevel ??
    persistedGoalLevel ??
    goal?.target_level ??
    goal?.suggested_level ??
    'junior';
  const answerError = validateBoundedText(answer, 1, CLARIFICATION_ANSWER_MAX, 'Answer');

  /** Re-syncs with the server after a state conflict (`409`) so the screen shows the real step. */
  async function resync(goalId: string) {
    try {
      const fresh = await invoke('getCareerGoal', { id: goalId });
      if (fresh.ok) {
        setGoal(fresh.data);
        setRoleId(
          fresh.data.proposed_role?.canonical_role_id ??
            fresh.data.alternative_roles[0]?.canonical_role_id ??
            null,
        );
        onGoalUpdated?.(fresh.data);
      }
    } catch {
      // Preserve the existing conflict error when the resync transport fails.
    }
  }

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAnswerTouched(true);
    if (!goal || answerError !== null || pending) return;
    setPending(true);
    setApiError(null);
    let result: Awaited<ReturnType<typeof invoke<'submitGoalClarification'>>>;
    try {
      result = await invoke('submitGoalClarification', {
        id: goal.id,
        body: { answer: answer.trim() },
      });
    } catch (err) {
      setPending(false);
      setApiError(mapApiError(err));
      return;
    }
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
    setRoleId(
      result.data.proposed_role?.canonical_role_id ??
        result.data.alternative_roles[0]?.canonical_role_id ??
        null,
    );
    setAnswer('');
    setAnswerTouched(false);
    onGoalUpdated?.(result.data);
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!goal || !roleId || !resolvedLevel || pending) return;
    setPending(true);
    setApiError(null);
    let result: Awaited<ReturnType<typeof invoke<'confirmCareerGoal'>>>;
    try {
      result = await invoke('confirmCareerGoal', {
        id: goal.id,
        body: { canonical_role_id: roleId, target_level: resolvedLevel },
      });
    } catch (err) {
      setPending(false);
      setApiError(mapApiError(err));
      return;
    }
    if (!result.ok) {
      setApiError(result.error);
      if (
        result.error.code === 'ROLE_MISMATCH' ||
        result.error.code === 'INVALID_STATE_TRANSITION' ||
        result.error.code === 'CLARIFICATION_LIMIT_REACHED'
      ) {
        await resync(goal.id);
      }
      setPending(false);
      return;
    }
    const currentDraft = readGoalDraft(userId, draftScope);
    if (
      currentDraft &&
      (currentDraft.goalId === goal.id ||
        (!currentDraft.goalId && draftScope === 'onboarding'))
    ) {
      clearGoalDraft(userId, draftScope);
    }
    clearPendingGoalTargetLevel(goal.id, userId);
    setGoal(result.data);
    setPending(false);
    if (onSuccess) {
      onSuccess(result.data);
      return;
    }
    router.push('/career-profile');
  }

  const errorAlert = apiError && (
    <Alert variant={toneToAlertVariant(apiError.tone)} role="alert">
      {apiError.message}
    </Alert>
  );

  const backLink = onBack ? (
    <button
      type="button"
      onClick={onBack}
      disabled={pending}
      className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border-default px-4 py-2.5 text-label-lg text-text-primary hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
    >
      Back to goal
    </button>
  ) : (
    <Link
      href="/onboarding"
      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border-default px-4 py-2.5 text-label-lg text-text-primary hover:bg-surface-subtle"
    >
      Back to goal
    </Link>
  );

  if (!goal) {
    return (
      <StepFrame
        currentStep={5}
        embedded={embedded}
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
      </StepFrame>
    );
  }

  if (goal.status === 'clarifying') {
    const round = Math.min(Math.max(goal.clarification_round, 1), CLARIFICATION_ROUNDS_MAX);
    return (
      <form onSubmit={submitAnswer} noValidate>
        <StepFrame
          currentStep={5}
          embedded={embedded}
          heading="One quick question"
          description={
            <span className="mt-1.5 inline-flex items-center gap-2 rounded-full border border-teal-200/80 bg-teal-50/80 px-3.5 py-1 text-sm">
              <TargetIcon className="h-3.5 w-3.5 shrink-0 text-teal-600" />
              <span className="font-normal text-slate-600">Goal:</span>
              <span dir="auto" className="font-semibold text-teal-900">
                {goal.goal_text}
              </span>
            </span>
          }
          status="editing"
          actions={
            <>
              {backLink}
              <Button
                type="submit"
                size="lg"
                isLoading={pending}
                disabled={answer.trim().length === 0 || pending}
                loadingText="Analyzing your answer..."
                className="min-w-[220px]"
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
        </StepFrame>
      </form>
    );
  }

  if (goal.status === 'awaiting_confirmation') {
    const proposed = goal.proposed_role;
    const hasOptions = proposed !== null || goal.alternative_roles.length > 0;
    const capped = goal.clarification_round >= CLARIFICATION_ROUNDS_MAX;
    const isPrimaryMatched =
      proposed !== null
        ? doesGoalMatchRole(
            goal.goal_text,
            proposed.name,
            proposed.canonical_role_id,
          )
        : false;
    const primaryBadgeLabel = isPrimaryMatched ? 'Your choice' : 'Suggested';
    const fallbackNote =
      proposed !== null && !isPrimaryMatched
        ? `Closest technology tracks for “${goal.goal_text}”:`
        : undefined;

    return (
      <form onSubmit={confirm} noValidate>
        <StepFrame
          currentStep={5}
          embedded={embedded}
          heading="Confirm your role"
          description={
            capped
              ? 'This is the best interpretation of your goal. Please confirm it or choose an alternative.'
              : fallbackNote
          }
          status="editing"
          actions={
            <>
              {backLink}
              <Button
                type="submit"
                size="lg"
                isLoading={pending}
                disabled={!roleId || !resolvedLevel || pending}
                loadingText="Confirming..."
                className="min-w-[176px]"
              >
                Confirm Role
              </Button>
            </>
          }
        >
          {hasOptions ? (
            <CareerCardGroup
              label="Career role options"
              className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-3"
            >
              {proposed && (
                <CareerCard
                  title={proposed.name}
                  recommended
                  badgeLabel={primaryBadgeLabel}
                  selected={roleId === proposed.canonical_role_id}
                  disabled={pending}
                  onSelect={() => setRoleId(proposed.canonical_role_id)}
                  className="min-h-[128px]"
                />
              )}
              {goal.alternative_roles.map((role) => (
                <CareerCard
                  key={role.canonical_role_id}
                  title={role.name}
                  recommended={false}
                  selected={roleId === role.canonical_role_id}
                  disabled={pending}
                  onSelect={() => setRoleId(role.canonical_role_id)}
                  className="min-h-[128px]"
                />
              ))}
            </CareerCardGroup>
          ) : (
            <Alert variant="warning" role="alert">
              We could not find a matching role for this goal. Go back and reword it.
            </Alert>
          )}
          {errorAlert}
        </StepFrame>
      </form>
    );
  }

  return (
    <StepFrame
      currentStep={5}
      embedded={embedded}
      heading={goal.status === 'confirmed' ? 'Goal confirmed' : 'Goal discontinued'}
      actions={
        <Link
          href={embedded ? '/dashboard' : '/career-profile'}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-action-primary-background px-5 text-label-lg text-action-primary-foreground hover:bg-action-primary-background-hover"
        >
          {embedded ? 'Go to Dashboard' : 'Go to Career Profile'}
        </Link>
      }
    >
      <p dir="auto" className="text-body text-text-secondary">
        {goal.status === 'confirmed'
          ? `“${goal.goal_text}” is already confirmed.`
          : `“${goal.goal_text}” was discontinued and can no longer be changed.`}
      </p>
    </StepFrame>
  );
}

'use client';

import { useEffect, useRef, useState, type FormEvent, type SVGProps } from 'react';
import type {
  CareerGoalResponse,
  CareerLevel,
  GenerateRoadmapRequestDTO,
  GoalStatus,
  JobAcceptedDTO,
  JobStatusDTO,
  ProfileResponse,
} from '@/lib/api/client';
import { ApiError } from '@/lib/api/client';
import {
  mapApiError,
  type M05Invoke,
  type MappedError,
} from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { ChevronDownIcon, CompassIcon, InfoIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { toneToAlertVariant } from '@/components/ui/multi-step-form-wrapper';
import { Stepper } from '@/components/ui/stepper';
import { Toast } from '@/components/ui/toast';
import {
  GOAL_TEXT_MAX,
  GOAL_TEXT_MIN,
  GoalSetupForm,
  clearGoalDraft,
  clearPendingGoalTargetLevel,
  readPendingGoalTargetLevels,
  validateBoundedText,
  writePendingGoalTargetLevel,
} from '@/components/onboarding/goal-setup-form';
import { GoalClarifyForm } from '@/components/onboarding/goal-clarify-form';
import { CareerGoalItem } from './career-goal-item';
import { CareerPreferencesCard } from './career-preferences-card';
import { CareerSkillsSection } from './career-skills-section';

export const MAX_ACTIVE_GOALS = 3;

const STATUS_ORDER: readonly GoalStatus[] = [
  'confirmed',
  'awaiting_confirmation',
  'clarifying',
  'discontinued',
];

const STATUS_HEADING: Record<GoalStatus, string> = {
  confirmed: 'Confirmed goals',
  awaiting_confirmation: 'Awaiting confirmation',
  clarifying: 'Needs clarification',
  discontinued: 'Discontinued goals',
};

function PlusIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('block shrink-0', className)}
      {...props}
    >
      <path d="M5 12h14M12 5v14" />
    </svg>
  );
}

function ArchiveIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      className={cn('block shrink-0', className)}
      {...props}
    >
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  );
}

const INLINE_GOAL_STEPS = [
  { number: 1, label: '1. Career Goal', title: 'Career Goal' },
  { number: 2, label: '2. Confirm Role', title: 'Confirm Role' },
] as const;

function InlineGoalStepHeader({ currentStep }: { currentStep: 1 | 2 }) {
  const total = INLINE_GOAL_STEPS.length;
  const active = INLINE_GOAL_STEPS[currentStep - 1];
  return (
    <Stepper
      className="mb-6"
      title={active.title}
      stepCounterText={`Step ${currentStep} of ${total}`}
      percentComplete={Math.round((currentStep / total) * 100)}
      ariaLabel="Add career goal steps"
      progressAriaLabel={`Add career goal progress: Step ${currentStep} of ${total}`}
      progressValueNow={currentStep}
      progressValueMin={1}
      progressValueMax={total}
      progressValueText={`Step ${currentStep} of ${total}: ${active.title}`}
      steps={INLINE_GOAL_STEPS.map((step) => ({
        id: String(step.number),
        label: step.label,
        status:
          step.number === currentStep
            ? 'current'
            : step.number < currentStep
              ? 'completed'
              : 'upcoming',
      }))}
    />
  );
}

export interface CareerProfileViewProps {
  initialGoals: CareerGoalResponse[];
  initialNextCursor?: string | null;
  profile: ProfileResponse | null;
  goalsError?: string | null;
  profileError?: string | null;
  userId?: string;
  invoke: M05Invoke;
}

/**
 * Screen 14 (`/career-profile`): goals grouped by status (EP-C02), reword unconfirmed goals (EP-C06),
 * discontinue with confirmation (EP-C07) and a read/modal-edit view of skills/preferences (EP-P01..P05).
 */
export function CareerProfileView({
  initialGoals,
  initialNextCursor = null,
  profile: initialProfile,
  goalsError,
  profileError,
  userId,
  invoke,
}: CareerProfileViewProps) {
  const [goals, setGoals] = useState<CareerGoalResponse[]>(initialGoals);
  const [profile, setProfile] = useState<ProfileResponse | null>(initialProfile);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editTouched, setEditTouched] = useState(false);
  const [discontinueTarget, setDiscontinueTarget] = useState<CareerGoalResponse | null>(null);
  const [discontinuedExpanded, setDiscontinuedExpanded] = useState(false);
  const [inlineAddSessionId, setInlineAddSessionId] = useState<number | null>(null);
  const isAddingGoal = inlineAddSessionId !== null;
  const inlineAddSessionRef = useRef(0);
  const activeAddSessionIdRef = useRef<number | null>(null);
  const learningSettingsAppliedSessionRef = useRef(0);
  const clarifyingInstanceRef = useRef(0);
  const goalMutationRevisionsRef = useRef(new Map<string, number>());
  const [selectedTargetLevels, setSelectedTargetLevels] = useState<
    Record<string, CareerLevel>
  >({});
  const [clarifyingGoal, setClarifyingGoal] = useState<{
    instanceId: number;
    goalRevision: number;
    goal: CareerGoalResponse;
    targetLevel: CareerLevel | null;
  } | null>(null);
  const clarifyingGoalRef = useRef(clarifyingGoal);
  const goalsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    clarifyingGoalRef.current = clarifyingGoal;
  }, [clarifyingGoal]);
  const [isEditingSkills, setIsEditingSkills] = useState(false);
  const [isEditingPreferences, setIsEditingPreferences] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);

  function showSuccessToast(message: string) {
    setToast((prev) => ({ id: (prev?.id ?? 0) + 1, message }));
  }

  function closeAddGoalModal() {
    activeAddSessionIdRef.current = null;
    setInlineAddSessionId(null);
  }

  function mergeLearningSettingsProfile(
    updatedProfile: ProfileResponse,
    sessionId?: number | null,
  ) {
    if (
      sessionId !== null &&
      sessionId !== undefined &&
      sessionId < learningSettingsAppliedSessionRef.current
    ) {
      return;
    }
    if (sessionId !== null && sessionId !== undefined) {
      learningSettingsAppliedSessionRef.current = sessionId;
    }
    setProfile((prev) =>
      prev
        ? {
            ...prev,
            preferred_daily_hours: updatedProfile.preferred_daily_hours,
            timezone: updatedProfile.timezone,
            timezone_detected: updatedProfile.timezone_detected,
            updated_at: updatedProfile.updated_at,
          }
        : updatedProfile,
    );
  }

  function mergeSkillsProfile(updatedProfile: ProfileResponse) {
    setProfile((prev) =>
      prev
        ? {
            ...prev,
            existing_skills: updatedProfile.existing_skills,
            existing_skills_none: updatedProfile.existing_skills_none,
            unresolved_skills: updatedProfile.unresolved_skills,
            progress_initialization: updatedProfile.progress_initialization,
            profile_complete: updatedProfile.profile_complete,
            missing_fields: updatedProfile.missing_fields,
            updated_at: updatedProfile.updated_at,
          }
        : updatedProfile,
    );
  }

  function getGoalRevision(goalId: string): number {
    return goalMutationRevisionsRef.current.get(goalId) ?? 0;
  }

  function bumpGoalRevision(goalId: string): number {
    const next = getGoalRevision(goalId) + 1;
    goalMutationRevisionsRef.current.set(goalId, next);
    return next;
  }

  function openClarifyingGoal(
    goal: CareerGoalResponse,
    targetLevel: CareerLevel | null,
  ) {
    activeAddSessionIdRef.current = null;
    clarifyingInstanceRef.current += 1;
    setClarifyingGoal({
      instanceId: clarifyingInstanceRef.current,
      goalRevision: getGoalRevision(goal.id),
      goal,
      targetLevel,
    });
  }

  function handleClarifyGoalUpdated(
    capturedGoalRevision: number,
    updatedGoal: CareerGoalResponse,
  ) {
    if (getGoalRevision(updatedGoal.id) !== capturedGoalRevision) {
      return;
    }
    const nextRevision = bumpGoalRevision(updatedGoal.id);
    setGoals((prev) =>
      prev.map((g) => (g.id === updatedGoal.id ? updatedGoal : g)),
    );
    setClarifyingGoal((prev) =>
      prev &&
      prev.goal.id === updatedGoal.id &&
      prev.goalRevision === capturedGoalRevision
        ? { ...prev, goal: updatedGoal, goalRevision: nextRevision }
        : prev,
    );
  }

  function handleClarifyGoalConfirmed(
    capturedGoalRevision: number,
    confirmedGoal: CareerGoalResponse,
  ) {
    if (getGoalRevision(confirmedGoal.id) !== capturedGoalRevision) {
      return;
    }
    bumpGoalRevision(confirmedGoal.id);
    clearPendingGoalTargetLevel(confirmedGoal.id, userId);
    setGoals((prev) =>
      prev.map((g) => (g.id === confirmedGoal.id ? confirmedGoal : g)),
    );
    setEditingId((prev) => (prev === confirmedGoal.id ? null : prev));
    setSelectedTargetLevels((prev) => {
      if (!(confirmedGoal.id in prev)) return prev;
      const next = { ...prev };
      delete next[confirmedGoal.id];
      return next;
    });
    setClarifyingGoal((prev) =>
      prev && prev.goal.id === confirmedGoal.id ? null : prev,
    );
    showSuccessToast('Career goal confirmed.');
  }

  const activeCount = goals.filter((g) => g.status !== 'discontinued').length;
  const canAddGoal = activeCount < MAX_ACTIVE_GOALS;
  const editError = validateBoundedText(editText, GOAL_TEXT_MIN, GOAL_TEXT_MAX, 'Goal');

  function isEditableGoalStatus(status: GoalStatus): boolean {
    return status === 'clarifying' || status === 'awaiting_confirmation';
  }

  function hasGoalSnapshotChanged(
    current: CareerGoalResponse,
    refreshed: CareerGoalResponse,
  ): boolean {
    if (
      current.status !== refreshed.status ||
      current.goal_text !== refreshed.goal_text ||
      current.clarification_round !== refreshed.clarification_round ||
      current.clarification_question !== refreshed.clarification_question ||
      current.proposed_role?.canonical_role_id !==
        refreshed.proposed_role?.canonical_role_id ||
      current.proposed_role?.name !== refreshed.proposed_role?.name ||
      current.suggested_level !== refreshed.suggested_level ||
      current.target_level !== refreshed.target_level ||
      current.alternative_roles.length !== refreshed.alternative_roles.length
    ) {
      return true;
    }
    for (let i = 0; i < current.alternative_roles.length; i += 1) {
      const prevRole = current.alternative_roles[i];
      const nextRole = refreshed.alternative_roles[i];
      if (
        prevRole.canonical_role_id !== nextRole?.canonical_role_id ||
        prevRole.name !== nextRole?.name
      ) {
        return true;
      }
    }
    return false;
  }

  function startEdit(goal: CareerGoalResponse) {
    if (!isEditableGoalStatus(goal.status)) return;
    setEditingId(goal.id);
    setEditText(goal.goal_text);
    setEditTouched(false);
    setError(null);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, goal: CareerGoalResponse) {
    event.preventDefault();
    setEditTouched(true);
    if (!isEditableGoalStatus(goal.status) || editError !== null || pending) return;
    const capturedRevision = getGoalRevision(goal.id);
    setPending(true);
    setError(null);
    let result: Awaited<ReturnType<typeof invoke<'updateCareerGoal'>>>;
    try {
      result = await invoke('updateCareerGoal', {
        id: goal.id,
        body: { goal_text: editText.trim() },
      });
    } catch (err) {
      setPending(false);
      setError(mapApiError(err));
      return;
    }
    setPending(false);
    if (getGoalRevision(goal.id) !== capturedRevision) {
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    bumpGoalRevision(goal.id);
    setGoals((prev) => prev.map((g) => (g.id === goal.id ? result.data : g)));
    setClarifyingGoal((prev) => (prev?.goal.id === goal.id ? null : prev));
    setEditingId(null);
    showSuccessToast('Goal updated.');
  }

  async function confirmDiscontinue() {
    const target = discontinueTarget;
    if (!target || pending) return;
    setPending(true);
    setError(null);
    let result: Awaited<ReturnType<typeof invoke<'deleteCareerGoal'>>>;
    try {
      result = await invoke('deleteCareerGoal', { id: target.id });
    } catch (err) {
      setPending(false);
      setDiscontinueTarget(null);
      setError(mapApiError(err));
      return;
    }
    if (!result.ok) {
      setPending(false);
      setDiscontinueTarget(null);
      setError(result.error);
      return;
    }
    bumpGoalRevision(target.id);
    clearPendingGoalTargetLevel(target.id, userId);
    const snapshotRevisions = new Map(goalMutationRevisionsRef.current);
    let refreshed: Awaited<ReturnType<typeof invoke<'listCareerGoals'>>> | null = null;
    try {
      refreshed = await invoke('listCareerGoals', { limit: 100 });
    } catch {
      refreshed = null;
    }
    setPending(false);
    setDiscontinueTarget(null);
    if (refreshed?.ok) {
      const refreshedItems = refreshed.data.items;
      // Pre-compute every goal whose local revision advanced while refresh was in flight
      // BEFORE applying any refresh-driven revision bumps, and reuse this single snapshot everywhere.
      const advancedGoalIds = new Set<string>();
      for (const [goalId, rev] of goalMutationRevisionsRef.current.entries()) {
        if (rev > (snapshotRevisions.get(goalId) ?? 0)) {
          advancedGoalIds.add(goalId);
        }
      }
      const hasAdvanced = (goalId: string) => advancedGoalIds.has(goalId);

      setGoals((prev) => {
        const prevById = new Map(prev.map((g) => [g.id, g]));
        const refreshedById = new Map(refreshedItems.map((g) => [g.id, g]));
        const reconciled: CareerGoalResponse[] = [];
        for (const item of refreshedItems) {
          if (hasAdvanced(item.id) && prevById.has(item.id)) {
            reconciled.push(prevById.get(item.id)!);
          } else {
            reconciled.push(item);
          }
        }
        for (const localGoal of prev) {
          if (!refreshedById.has(localGoal.id) && hasAdvanced(localGoal.id)) {
            reconciled.unshift(localGoal);
          }
        }
        return reconciled;
      });
      setNextCursor(refreshed.data.meta.next_cursor);
      if (editingId && !hasAdvanced(editingId)) {
        const stillEditable = refreshedItems.some(
          (g) => g.id === editingId && isEditableGoalStatus(g.status),
        );
        if (!stillEditable) setEditingId(null);
      }
      const openPanel = clarifyingGoalRef.current;
      if (openPanel && !hasAdvanced(openPanel.goal.id)) {
        const refreshedMatch = refreshedItems.find(
          (g) => g.id === openPanel.goal.id,
        );
        if (!refreshedMatch || !isEditableGoalStatus(refreshedMatch.status)) {
          bumpGoalRevision(openPanel.goal.id);
          setClarifyingGoal((prev) =>
            prev && prev.instanceId === openPanel.instanceId ? null : prev,
          );
        } else if (hasGoalSnapshotChanged(openPanel.goal, refreshedMatch)) {
          const nextRevision = bumpGoalRevision(refreshedMatch.id);
          clarifyingInstanceRef.current += 1;
          const nextInstanceId = clarifyingInstanceRef.current;
          setClarifyingGoal((prev) =>
            prev && prev.instanceId === openPanel.instanceId
              ? {
                  ...prev,
                  instanceId: nextInstanceId,
                  goalRevision: nextRevision,
                  goal: refreshedMatch,
                }
              : prev,
          );
        }
      }
      // Clear non-editable persisted target levels outside the React state updater.
      for (const item of refreshedItems) {
        if (!hasAdvanced(item.id) && !isEditableGoalStatus(item.status)) {
          clearPendingGoalTargetLevel(item.id, userId);
        }
      }
      setSelectedTargetLevels((prev) => {
        const next: Record<string, CareerLevel> = {};
        for (const [id, level] of Object.entries(prev)) {
          if (hasAdvanced(id)) {
            next[id] = level;
          }
        }
        for (const item of refreshedItems) {
          if (!hasAdvanced(item.id) && isEditableGoalStatus(item.status) && prev[item.id]) {
            next[item.id] = prev[item.id];
          }
        }
        return next;
      });
    } else {
      setGoals((prev) =>
        prev.map((g) => (g.id === target.id ? { ...g, status: 'discontinued' } : g)),
      );
      if (editingId === target.id) setEditingId(null);
      setClarifyingGoal((prev) => (prev?.goal.id === target.id ? null : prev));
      setSelectedTargetLevels((prev) => {
        if (!(target.id in prev)) return prev;
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
    }
    showSuccessToast(
      result.data.archived_roadmap_id
        ? 'Goal discontinued. Its roadmap was archived and your progress and evidence were kept.'
        : 'Goal discontinued. Your progress and evidence were kept.',
    );
  }

  async function loadMore() {
    if (!nextCursor || pending) return;
    setPending(true);
    setError(null);
    let result: Awaited<ReturnType<typeof invoke<'listCareerGoals'>>>;
    try {
      result = await invoke('listCareerGoals', { limit: 100, cursor: nextCursor });
    } catch (err) {
      setPending(false);
      setError(mapApiError(err));
      return;
    }
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setGoals((prev) => [...prev, ...result.data.items]);
    setNextCursor(result.data.meta.next_cursor);
  }

  async function invokeGenerateRoadmap(
    body: GenerateRoadmapRequestDTO,
    idempotencyKey: string,
  ): Promise<JobAcceptedDTO> {
    const res = await invoke('generateRoadmap', { body, idempotencyKey });
    if (!res.ok) {
      throw new ApiError(
        res.error.status ?? 500,
        res.error.message,
        res.error.code,
        res.error.requestId,
        [],
        res.error.retryable,
        res.error.retryAfterSeconds,
      );
    }
    return res.data;
  }

  async function invokePollJobStatus(jobId: string): Promise<JobStatusDTO> {
    const res = await invoke('getJobStatus', { jobId });
    if (!res.ok) {
      throw new ApiError(
        res.error.status ?? 500,
        res.error.message,
        res.error.code,
        res.error.requestId,
        [],
        res.error.retryable,
        res.error.retryAfterSeconds,
      );
    }
    return res.data;
  }

  const grouped = STATUS_ORDER.map((status) => ({
    status,
    items: goals.filter((g) => g.status === status),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      {/* Page Header Band */}
      <header className="flex flex-col justify-between gap-4 border-b border-border-default pb-6 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.025em] text-text-primary sm:text-[30px]">
            Career Profile
          </h1>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-text-secondary">
            Your goals, skills and learning preferences in one place.
          </p>
        </div>

        <div className="shrink-0">
          {canAddGoal ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                clearGoalDraft(userId, 'inline');
                setClarifyingGoal(null);
                if (isAddingGoal) {
                  closeAddGoalModal();
                } else {
                  inlineAddSessionRef.current += 1;
                  const nextSession = inlineAddSessionRef.current;
                  activeAddSessionIdRef.current = nextSession;
                  setInlineAddSessionId(nextSession);
                }
              }}
              className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-action-primary-background px-4 text-[14px] leading-none font-semibold text-action-primary-foreground shadow-xs transition-all duration-150 hover:bg-action-primary-background-hover active:bg-action-primary-background-active disabled:cursor-not-allowed disabled:bg-action-primary-background-disabled disabled:text-action-primary-foreground-disabled sm:w-auto"
            >
              <PlusIcon className="h-4 w-4" />
              <span>Add a career goal</span>
            </button>
          ) : (
            <div className="group relative inline-flex w-full sm:w-auto">
              <button
                type="button"
                aria-disabled="true"
                aria-describedby="goal-limit-tooltip"
                onClick={(event) => {
                  event.preventDefault();
                }}
                className="inline-flex h-10 w-full cursor-not-allowed select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-200/90 bg-slate-100 px-4 text-[14px] leading-none font-semibold text-slate-400 shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring sm:w-auto dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-500"
              >
                <InfoIcon className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                <span>Add a career goal</span>
              </button>
              <div
                id="goal-limit-tooltip"
                role="tooltip"
                className="pointer-events-none invisible absolute top-full right-0 z-30 mt-2 w-64 rounded-lg border border-slate-800 bg-slate-900 px-3.5 py-2.5 text-left text-caption leading-snug font-normal text-white opacity-0 shadow-lg transition-all duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800"
              >
                You have {activeCount} active goals (maximum {MAX_ACTIVE_GOALS}). Discontinue one to add another.
              </div>
            </div>
          )}
        </div>
      </header>

      {toast && (
        <Toast
          key={toast.id}
          variant="success"
          position="top-center"
          role="status"
          ariaLive="polite"
          autoDismissMs={4000}
          onDismiss={() => setToast(null)}
        >
          {toast.message}
        </Toast>
      )}
      {error && (
        <Alert variant={toneToAlertVariant(error.tone)} role="alert">
          {error.message}
        </Alert>
      )}

      {/* Asymmetric 2-Column Layout: Left Primary Career Goals, Right Sticky Skills + Learning Preferences */}
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_370px]">
        {/* Left Column: Primary Focus — Career Goals */}
        <section
          aria-labelledby="goals-heading"
          aria-busy={pending ? 'true' : undefined}
          className="flex min-w-0 flex-col gap-5"
        >
          <div className="flex min-h-[32px] flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2
                id="goals-heading"
                ref={goalsHeadingRef}
                tabIndex={-1}
                className="text-[17px] font-semibold tracking-[-0.015em] text-text-primary focus:outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                Career goals
              </h2>
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] leading-none font-semibold tabular-nums text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                {activeCount} / {MAX_ACTIVE_GOALS} active
              </span>
            </div>
          </div>

          {/* Inline 2-Step Add Career Goal Flow (Step 1: Career Goal -> Step 2: Confirm Role) */}
          {isAddingGoal && (
            <section
              aria-label="Add a career goal"
              className="rounded-xl border border-border-default bg-surface-default p-6 shadow-xs"
            >
              <InlineGoalStepHeader currentStep={1} />
              <GoalSetupForm
                embedded
                draftScope="inline"
                invoke={invoke}
                userId={userId}
                initialDailyHours={profile?.preferred_daily_hours ?? null}
                backLabel="Cancel"
                onBack={closeAddGoalModal}
                shouldPersistDraft={() =>
                  inlineAddSessionId !== null &&
                  activeAddSessionIdRef.current === inlineAddSessionId
                }
                onLearningSettingsSaved={(updatedProfile) =>
                  mergeLearningSettingsProfile(updatedProfile, inlineAddSessionId)
                }
                onSuccess={({ goal: createdGoal, targetLevel }) => {
                  const stillOwnsInteraction =
                    inlineAddSessionId !== null &&
                    activeAddSessionIdRef.current === inlineAddSessionId;
                  bumpGoalRevision(createdGoal.id);
                  writePendingGoalTargetLevel(createdGoal.id, targetLevel, userId);
                  setGoals((prev) => [
                    createdGoal,
                    ...prev.filter((g) => g.id !== createdGoal.id),
                  ]);
                  setSelectedTargetLevels((prev) => ({
                    ...prev,
                    [createdGoal.id]: targetLevel,
                  }));
                  if (stillOwnsInteraction) {
                    closeAddGoalModal();
                    openClarifyingGoal(createdGoal, targetLevel);
                  }
                }}
              />
            </section>
          )}

          {clarifyingGoal && (
            <section
              aria-label="Review and confirm career goal"
              className="rounded-xl border border-border-default bg-surface-default p-6 shadow-xs"
            >
              <InlineGoalStepHeader currentStep={2} />
              <GoalClarifyForm
                key={`${clarifyingGoal.goal.id}:${clarifyingGoal.instanceId}`}
                embedded
                draftScope="inline"
                goal={clarifyingGoal.goal}
                initialTargetLevel={clarifyingGoal.targetLevel}
                userId={userId}
                invoke={invoke}
                onBack={() => setClarifyingGoal(null)}
                onGoalUpdated={(updatedGoal) =>
                  handleClarifyGoalUpdated(
                    clarifyingGoal.goalRevision,
                    updatedGoal,
                  )
                }
                onSuccess={(confirmedGoal) =>
                  handleClarifyGoalConfirmed(
                    clarifyingGoal.goalRevision,
                    confirmedGoal,
                  )
                }
              />
            </section>
          )}

          {goalsError && (
            <Alert variant="warning" role="alert">
              {goalsError}
            </Alert>
          )}

          {!goalsError && goals.length === 0 && (
            <div className="rounded-xl border border-border-default bg-surface-default px-6 py-10 text-center shadow-xs">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-primary-100 bg-primary-50 text-primary-600">
                <CompassIcon className="h-5 w-5" />
              </div>
              <p className="mt-3.5 text-[16px] font-semibold text-text-primary">
                You have no career goals yet. Add one to get started.
              </p>
              <p className="mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed text-text-secondary">
                Add a technology career goal and confirm your target level to
                build a structured roadmap.
              </p>
            </div>
          )}

          {grouped.map((group) => {
            const isDiscontinuedGroup = group.status === 'discontinued';
            const isActionGroup =
              group.status === 'awaiting_confirmation' ||
              group.status === 'clarifying';

            if (isDiscontinuedGroup) {
              return (
                <div
                  key={group.status}
                  className="mt-2 flex flex-col gap-3 border-t border-border-subtle pt-5"
                >
                  <h3 className="w-full">
                    <button
                      type="button"
                      aria-expanded={discontinuedExpanded}
                      aria-controls="discontinued-goals-panel"
                      onClick={() => setDiscontinuedExpanded((prev) => !prev)}
                      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 text-left transition-colors hover:border-slate-300/80 hover:bg-slate-100/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring dark:border-slate-800 dark:bg-slate-900/50 dark:hover:bg-slate-900"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <ArchiveIcon className="h-4 w-4 text-slate-400" />
                        <span className="text-[13.5px] leading-none font-semibold text-text-secondary">
                          {STATUS_HEADING[group.status]}
                        </span>{' '}
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11.5px] leading-none font-semibold tabular-nums text-text-muted dark:border-slate-700 dark:bg-slate-800">
                          ({group.items.length})
                        </span>
                      </span>
                      <ChevronDownIcon
                        className={
                          discontinuedExpanded
                            ? 'h-4 w-4 shrink-0 rotate-180 text-text-muted transition-transform duration-150'
                            : 'h-4 w-4 shrink-0 text-text-muted transition-transform duration-150'
                        }
                      />
                    </button>
                  </h3>
                  {discontinuedExpanded && (
                    <ul
                      id="discontinued-goals-panel"
                      className="flex flex-col gap-2.5"
                    >
                      {group.items.map((goal) => (
                        <CareerGoalItem
                          key={goal.id}
                          goal={goal}
                          editing={false}
                          editable={false}
                          editText=""
                          editTouched={false}
                          editError={null}
                          pending={pending}
                          onEditTextChange={() => {}}
                          onEditBlur={() => {}}
                          onStartEdit={() => {}}
                          onCancelEdit={() => {}}
                          onSaveEdit={(e) => e.preventDefault()}
                          onReviewOrClarify={() => {}}
                          onDiscontinue={() => {}}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            }

            return (
              <div key={group.status} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={
                      group.status === 'confirmed'
                        ? 'h-2 w-2 rounded-full bg-teal-600'
                        : isActionGroup
                          ? 'h-2 w-2 rounded-full bg-amber-500'
                          : 'h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600'
                    }
                  />
                  <h3 className="text-[13.5px] font-semibold tabular-nums text-text-secondary">
                    {STATUS_HEADING[group.status]} ({group.items.length})
                  </h3>
                </div>
                <ul className="flex flex-col gap-3.5">
                  {group.items.map((goal) => {
                    const editing = editingId === goal.id;
                    const editable =
                      goal.status === 'clarifying' ||
                      goal.status === 'awaiting_confirmation';

                    return (
                      <CareerGoalItem
                        key={goal.id}
                        goal={goal}
                        editing={editing}
                        editable={editable}
                        editText={editText}
                        editTouched={editTouched}
                        editError={editError}
                        pending={pending}
                        onEditTextChange={(value) => setEditText(value)}
                        onEditBlur={() => setEditTouched(true)}
                        onStartEdit={() => startEdit(goal)}
                        onCancelEdit={() => setEditingId(null)}
                        onSaveEdit={(e) => saveEdit(e, goal)}
                        onReviewOrClarify={() => {
                          closeAddGoalModal();
                          openClarifyingGoal(
                            goal,
                            selectedTargetLevels[goal.id] ??
                              readPendingGoalTargetLevels(userId)[goal.id] ??
                              goal.target_level ??
                              null,
                          );
                        }}
                        onDiscontinue={() => setDiscontinueTarget(goal)}
                        generateHandoffProps={
                          goal.status === 'confirmed' && !goal.roadmap_id
                            ? {
                                careerGoalId: goal.id,
                                targetLevel:
                                  goal.target_level ??
                                  goal.suggested_level ??
                                  'junior',
                                levelConfirmed: true,
                                onGenerateRoadmap: invokeGenerateRoadmap,
                                pollJobStatus: invokePollJobStatus,
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {nextCursor && (
            <div>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={loadMore}
              >
                Show more goals
              </Button>
            </div>
          )}
        </section>

        {/* Right Column: Sticky Context Sidebar (Skills on top + Learning Preferences below) */}
        <aside
          aria-label="Skills and learning preferences"
          className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6"
        >
          <CareerSkillsSection
            profile={profile}
            profileError={profileError}
            isEditingSkills={isEditingSkills}
            pending={pending}
            invoke={invoke}
            onStartEditSkills={() => setIsEditingSkills(true)}
            onCancelEditSkills={() => setIsEditingSkills(false)}
            onProfileCommitted={mergeSkillsProfile}
            onSkillsSaved={(updatedProfile) => {
              mergeSkillsProfile(updatedProfile);
              setIsEditingSkills(false);
              showSuccessToast('Skills updated.');
            }}
          />

          <CareerPreferencesCard
            profile={profile}
            isEditingPreferences={isEditingPreferences}
            pending={pending}
            invoke={invoke}
            onStartEditPreferences={() => setIsEditingPreferences(true)}
            onCancelEditPreferences={() => setIsEditingPreferences(false)}
            onPreferencesSaved={(updatedProfile) => {
              setProfile((prev) =>
                prev
                  ? {
                      ...prev,
                      learning_preference: updatedProfile.learning_preference,
                      profile_complete: updatedProfile.profile_complete,
                      missing_fields: updatedProfile.missing_fields,
                      updated_at:
                        updatedProfile.updated_at > prev.updated_at
                          ? updatedProfile.updated_at
                          : prev.updated_at,
                    }
                  : updatedProfile,
              );
              setIsEditingPreferences(false);
              showSuccessToast('Learning preferences updated.');
            }}
          />
        </aside>
      </div>

      {/* Compound Modal: Discontinue Goal */}
      <Modal
        open={discontinueTarget !== null}
        onClose={() => {
          if (!pending) setDiscontinueTarget(null);
        }}
        disableClose={pending}
        fallbackReturnFocusTo={goalsHeadingRef}
        size="sm"
      >
        <Modal.Header>
          <div className="min-w-0">
            <Modal.Title>Discontinue this goal?</Modal.Title>
            <Modal.Description>
              Its linked roadmap will be archived and Focus will move to another
              active roadmap if needed. Your progress and learning evidence are
              kept. If you only want to change Career Level or adjust topics on
              this same goal, use Change Career Level or Request Change (Merge)
              on the roadmap instead of discontinuing.
            </Modal.Description>
          </div>
          <Modal.Close />
        </Modal.Header>
        {discontinueTarget && (
          <Modal.Body>
            <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/60">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Career goal
                </p>
                <p
                  dir="auto"
                  className="mt-0.5 text-sm font-semibold text-slate-900 [overflow-wrap:anywhere] dark:text-slate-100"
                >
                  {discontinueTarget.goal_text}
                </p>
              </div>
              {discontinueTarget.proposed_role && (
                <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-2.5 dark:border-slate-800">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-teal-200/80 bg-teal-50/70 px-2.5 py-1 text-[12px] leading-none font-semibold text-teal-800 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-200">
                    <CompassIcon
                      className="h-3.5 w-3.5 text-teal-600 dark:text-teal-300"
                      aria-hidden="true"
                    />
                    <span className="font-normal opacity-80">Roadmap:</span>
                    <span>{discontinueTarget.proposed_role.name}</span>
                  </span>
                </div>
              )}
            </div>
          </Modal.Body>
        )}
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setDiscontinueTarget(null)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={pending}
            onClick={confirmDiscontinue}
          >
            Discontinue goal
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

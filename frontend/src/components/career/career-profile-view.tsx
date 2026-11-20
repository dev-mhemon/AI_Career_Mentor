'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  CareerGoalResponse,
  CareerLevel,
  GoalStatus,
  LearningPreference,
  ProfileResponse,
} from '@/lib/api/client';
import {
  mapApiError,
  type M05Invoke,
  type MappedError,
} from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { GoalStatusBadge } from '@/components/ui/career-card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { toneToAlertVariant } from '@/components/ui/multi-step-form-wrapper';
import { SkillCard } from '@/components/ui/skill-card';
import { Toast } from '@/components/ui/toast';
import {
  GOAL_TEXT_MAX,
  GOAL_TEXT_MIN,
  GoalSetupForm,
  clearGoalDraft,
  clearPendingGoalTargetLevel,
  codePointLength,
  readPendingGoalTargetLevels,
  validateBoundedText,
  writePendingGoalTargetLevel,
} from '@/components/onboarding/goal-setup-form';
import { GoalClarifyForm } from '@/components/onboarding/goal-clarify-form';
import { SkillsSetupForm } from '@/components/onboarding/skills-setup-form';
import { PreferencesSetupForm } from '@/components/onboarding/preferences-setup-form';

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

const PREFERENCE_LABEL: Record<LearningPreference, string> = {
  reading: 'Reading',
  hands_on: 'Hands-on',
  visual: 'Visual',
  mixed: 'Mixed',
};

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
 * discontinue with confirmation (EP-C07) and a read view of skills/preferences (EP-P01).
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
  const [inlineAddSessionId, setInlineAddSessionId] = useState<number | null>(null);
  const isAddingGoal = inlineAddSessionId !== null;
  const inlineAddSessionRef = useRef(0);
  const activeAddSessionIdRef = useRef<number | null>(null);
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

  function mergeLearningSettingsProfile(updatedProfile: ProfileResponse) {
    setProfile((prev) =>
      prev
        ? {
            ...prev,
            preferred_daily_hours: updatedProfile.preferred_daily_hours,
            timezone: updatedProfile.timezone,
            timezone_detected: updatedProfile.timezone_detected,
            updated_at:
              updatedProfile.updated_at > prev.updated_at
                ? updatedProfile.updated_at
                : prev.updated_at,
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

  const grouped = STATUS_ORDER.map((status) => ({
    status,
    items: goals.filter((g) => g.status === status),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-xl text-text-primary">Career Profile</h1>
          <p className="text-body-sm text-text-secondary">
            Your goals, skills and learning preferences in one place.
          </p>
        </div>
        {canAddGoal ? (
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={pending}
            onClick={() => {
              clearGoalDraft(userId, 'inline');
              setClarifyingGoal(null);
              if (isAddingGoal) {
                activeAddSessionIdRef.current = null;
                setInlineAddSessionId(null);
              } else {
                inlineAddSessionRef.current += 1;
                const nextSession = inlineAddSessionRef.current;
                activeAddSessionIdRef.current = nextSession;
                setInlineAddSessionId(nextSession);
              }
            }}
          >
            {isAddingGoal ? 'Close' : 'Add a career goal'}
          </Button>
        ) : (
          <p className="max-w-xs text-caption text-text-secondary">
            You have {activeCount} active goals (maximum {MAX_ACTIVE_GOALS}). Discontinue one to add another.
          </p>
        )}
      </header>

      {isAddingGoal && (
        <section
          aria-label="Add a career goal"
          className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
        >
          <GoalSetupForm
            embedded
            draftScope="inline"
            invoke={invoke}
            userId={userId}
            initialDailyHours={profile?.preferred_daily_hours ?? null}
            onBack={() => {
              activeAddSessionIdRef.current = null;
              setInlineAddSessionId(null);
            }}
            shouldPersistDraft={() =>
              inlineAddSessionId !== null &&
              activeAddSessionIdRef.current === inlineAddSessionId
            }
            onLearningSettingsSaved={mergeLearningSettingsProfile}
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
                activeAddSessionIdRef.current = null;
                setInlineAddSessionId(null);
                openClarifyingGoal(createdGoal, targetLevel);
              }
            }}
          />
        </section>
      )}

      {clarifyingGoal && (
        <section
          aria-label="Review and confirm career goal"
          className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
        >
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

      <section aria-labelledby="goals-heading" aria-busy={pending ? 'true' : undefined} className="flex flex-col gap-5">
        <h2 id="goals-heading" className="text-heading-md text-text-primary">
          Career goals
        </h2>
        {goalsError && (
          <Alert variant="warning" role="alert">
            {goalsError}
          </Alert>
        )}
        {!goalsError && goals.length === 0 && (
          <p className="rounded-lg border border-dashed border-border-default p-6 text-body-sm text-text-secondary">
            You have no career goals yet. Add one to get started.
          </p>
        )}
        {grouped.map((group) => (
          <div key={group.status} className="flex flex-col gap-3">
            <h3 className="text-heading-sm text-text-secondary">
              {STATUS_HEADING[group.status]} ({group.items.length})
            </h3>
            <ul className="flex flex-col gap-3">
              {group.items.map((goal) => {
                const editing = editingId === goal.id;
                const editable = goal.status === 'clarifying' || goal.status === 'awaiting_confirmation';
                const levelText = goal.target_level ?? goal.suggested_level;
                return (
                  <li
                    key={goal.id}
                    className="flex flex-col gap-3 rounded-lg border border-border-default bg-surface-default p-4 shadow-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p dir="auto" className="text-body font-medium text-text-primary">
                        {goal.goal_text}
                      </p>
                      <GoalStatusBadge status={goal.status} />
                    </div>
                    {goal.proposed_role && (
                      <p className="text-caption text-text-secondary">
                        {goal.status === 'confirmed' ? 'Role' : 'Proposed role'}: {goal.proposed_role.name}
                        {levelText ? ` · ${levelText.charAt(0).toUpperCase()}${levelText.slice(1)} level` : ''}
                      </p>
                    )}

                    {editing && (
                      <form onSubmit={(e) => saveEdit(e, goal)} noValidate className="flex flex-col gap-2">
                        <Input
                          variant="textarea"
                          label="Edit goal"
                          rows={3}
                          value={editText}
                          readOnly={pending}
                          error={editTouched && editError ? editError : undefined}
                          onChange={(e) => setEditText(e.target.value)}
                          onBlur={() => setEditTouched(true)}
                        />
                        <p aria-live="polite" className="text-caption tabular-nums text-text-secondary">
                          {codePointLength(editText.trim())} / {GOAL_TEXT_MAX} characters
                        </p>
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" isLoading={pending} loadingText="Saving...">
                            Save goal
                          </Button>
                          <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    )}

                    {!editing && goal.status !== 'discontinued' && (
                      <div className="flex flex-wrap items-center gap-2">
                        {editable && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={pending}
                            onClick={() => {
                              activeAddSessionIdRef.current = null;
                              setInlineAddSessionId(null);
                              openClarifyingGoal(
                                goal,
                                selectedTargetLevels[goal.id] ??
                                  readPendingGoalTargetLevels(userId)[goal.id] ??
                                  goal.target_level ??
                                  null,
                              );
                            }}
                          >
                            {goal.status === 'clarifying' ? 'Resume clarification' : 'Review & confirm'}
                          </Button>
                        )}
                        {editable && (
                          <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => startEdit(goal)}>
                            Edit goal text
                          </Button>
                        )}
                        {goal.status === 'confirmed' && (
                          <p className="self-center text-caption text-text-secondary">
                            Confirmed goal text cannot be edited.
                          </p>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => setDiscontinueTarget(goal)}
                          aria-label={`Discontinue goal: ${goal.goal_text}`}
                        >
                          Discontinue
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {nextCursor && (
          <Button type="button" variant="secondary" disabled={pending} onClick={loadMore}>
            Show more goals
          </Button>
        )}
      </section>

      <section aria-labelledby="skills-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="skills-heading" className="text-heading-md text-text-primary">
            Skills
          </h2>
          {!isEditingSkills && (
            <Button
              type="button"
              variant="link"
              size="sm"
              disabled={pending || !profile}
              onClick={() => setIsEditingSkills(true)}
            >
              Edit skills
            </Button>
          )}
        </div>
        {profileError && (
          <Alert variant="warning" role="alert">
            {profileError}
          </Alert>
        )}
        {isEditingSkills ? (
          <div className="rounded-xl border border-border-default bg-surface-raised p-5 shadow-xs">
            <SkillsSetupForm
              mode="standalone"
              initialProfile={profile}
              invoke={invoke}
              onCancel={() => setIsEditingSkills(false)}
              onSuccess={(updatedProfile) => {
                setProfile((prev) =>
                  prev
                    ? {
                        ...prev,
                        existing_skills: updatedProfile.existing_skills,
                        existing_skills_none: updatedProfile.existing_skills_none,
                        unresolved_skills: updatedProfile.unresolved_skills,
                        progress_initialization:
                          updatedProfile.progress_initialization,
                        profile_complete: updatedProfile.profile_complete,
                        missing_fields: updatedProfile.missing_fields,
                        updated_at:
                          updatedProfile.updated_at > prev.updated_at
                            ? updatedProfile.updated_at
                            : prev.updated_at,
                      }
                    : updatedProfile,
                );
                setIsEditingSkills(false);
                showSuccessToast('Skills updated.');
              }}
            />
          </div>
        ) : (
          <>
            {profile && profile.existing_skills.length > 0 && (
              <ul aria-label="Your skills" className="flex flex-col gap-2">
                {profile.existing_skills.map((skill) => (
                  <SkillCard
                    key={skill.skill_id}
                    name={skill.name}
                    aliasResolved={skill.alias_resolved}
                    learningState={skill.learning_state}
                  />
                ))}
              </ul>
            )}
            {profile && profile.existing_skills.length === 0 && (
              <p className="text-body-sm text-text-secondary">
                {profile.existing_skills_none
                  ? 'No prior technical skills (you are starting from zero).'
                  : 'No skills added yet.'}
              </p>
            )}
          </>
        )}
      </section>

      <section
        id="preferences"
        aria-labelledby="prefs-heading"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="prefs-heading" className="text-heading-md text-text-primary">
            Learning preferences
          </h2>
          <span className="flex items-center gap-4">
            {!isEditingPreferences && (
              <Button
                type="button"
                variant="link"
                size="sm"
                disabled={pending || !profile}
                onClick={() => setIsEditingPreferences(true)}
              >
                Edit preferences
              </Button>
            )}
            <Link href="/profile" className="text-label-lg text-text-link underline underline-offset-2">
              Edit profile
            </Link>
          </span>
        </div>
        {isEditingPreferences ? (
          <div className="rounded-xl border border-border-default bg-surface-raised p-5 shadow-xs">
            <PreferencesSetupForm
              mode="standalone"
              initialProfile={profile}
              invoke={invoke}
              onCancel={() => setIsEditingPreferences(false)}
              onSuccess={(updatedProfile) => {
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
          </div>
        ) : (
          profile && (
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-caption text-text-secondary">Learning style</dt>
                <dd className="text-body text-text-primary">
                  {profile.learning_preference ? PREFERENCE_LABEL[profile.learning_preference] : 'Not set'}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-text-secondary">Daily study hours</dt>
                <dd className="text-body text-text-primary">
                  {profile.preferred_daily_hours !== null ? `${profile.preferred_daily_hours} h` : 'Not set'}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-text-secondary">Timezone</dt>
                <dd className="text-body text-text-primary">{profile.timezone ?? 'Not set'}</dd>
              </div>
            </dl>
          )
        )}
      </section>

      <Modal
        open={discontinueTarget !== null}
        onClose={() => {
          if (!pending) setDiscontinueTarget(null);
        }}
        title="Discontinue this goal?"
        description="Its linked roadmap will be archived and Focus will move to another active roadmap if needed. Your progress and learning evidence are kept."
        confirmLabel="Discontinue goal"
        onConfirm={confirmDiscontinue}
        loading={pending}
      />
    </div>
  );
}

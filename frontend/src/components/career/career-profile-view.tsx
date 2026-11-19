'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type {
  CareerGoalResponse,
  GoalStatus,
  LearningPreference,
  ProfileResponse,
} from '@/lib/api/client';
import type { M05Invoke, MappedError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { GoalStatusBadge } from '@/components/ui/career-card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { toneToAlertVariant } from '@/components/ui/multi-step-form-wrapper';
import { SkillCard } from '@/components/ui/skill-card';
import {
  GOAL_TEXT_MAX,
  GOAL_TEXT_MIN,
  codePointLength,
  validateBoundedText,
} from '@/components/onboarding/goal-setup-form';

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
  invoke: M05Invoke;
}

/**
 * Screen 14 (`/career-profile`): goals grouped by status (EP-C02), reword unconfirmed goals (EP-C06),
 * discontinue with confirmation (EP-C07) and a read view of skills/preferences (EP-P01).
 */
export function CareerProfileView({
  initialGoals,
  initialNextCursor = null,
  profile,
  goalsError,
  profileError,
  invoke,
}: CareerProfileViewProps) {
  const [goals, setGoals] = useState<CareerGoalResponse[]>(initialGoals);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editTouched, setEditTouched] = useState(false);
  const [discontinueTarget, setDiscontinueTarget] = useState<CareerGoalResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeCount = goals.filter((g) => g.status !== 'discontinued').length;
  const canAddGoal = activeCount < MAX_ACTIVE_GOALS;
  const editError = validateBoundedText(editText, GOAL_TEXT_MIN, GOAL_TEXT_MAX, 'Goal');

  function isEditableGoalStatus(status: GoalStatus): boolean {
    return status === 'clarifying' || status === 'awaiting_confirmation';
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
    const result = await invoke('updateCareerGoal', {
      id: goal.id,
      body: { goal_text: editText.trim() },
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setGoals((prev) => prev.map((g) => (g.id === goal.id ? result.data : g)));
    setEditingId(null);
    setNotice('Goal updated.');
  }

  async function confirmDiscontinue() {
    const target = discontinueTarget;
    if (!target || pending) return;
    setPending(true);
    setError(null);
    const result = await invoke('deleteCareerGoal', { id: target.id });
    if (!result.ok) {
      setPending(false);
      setDiscontinueTarget(null);
      setError(result.error);
      return;
    }
    let refreshed: Awaited<ReturnType<typeof invoke<'listCareerGoals'>>> | null = null;
    try {
      refreshed = await invoke('listCareerGoals', { limit: 100 });
    } catch {
      refreshed = null;
    }
    setPending(false);
    setDiscontinueTarget(null);
    if (refreshed?.ok) {
      setGoals(refreshed.data.items);
      setNextCursor(refreshed.data.meta.next_cursor);
      if (editingId) {
        const stillEditable = refreshed.data.items.some(
          (g) => g.id === editingId && isEditableGoalStatus(g.status),
        );
        if (!stillEditable) setEditingId(null);
      }
    } else {
      setGoals((prev) =>
        prev.map((g) => (g.id === target.id ? { ...g, status: 'discontinued' } : g)),
      );
      if (editingId === target.id) setEditingId(null);
    }
    setNotice(
      result.data.archived_roadmap_id
        ? 'Goal discontinued. Its roadmap was archived and your progress and evidence were kept.'
        : 'Goal discontinued. Your progress and evidence were kept.',
    );
  }

  async function loadMore() {
    if (!nextCursor || pending) return;
    setPending(true);
    setError(null);
    const result = await invoke('listCareerGoals', { limit: 100, cursor: nextCursor });
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
          <Link
            href="/onboarding/goal"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-action-primary-background px-5 text-label-lg text-action-primary-foreground hover:bg-action-primary-background-hover"
          >
            Add a career goal
          </Link>
        ) : (
          <p className="max-w-xs text-caption text-text-secondary">
            You have {MAX_ACTIVE_GOALS} active goals. Discontinue one to add another.
          </p>
        )}
      </header>

      <div role="status" aria-live="polite" className="empty:hidden">
        {notice && <Alert variant="success">{notice}</Alert>}
      </div>
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
                      <div className="flex flex-wrap gap-2">
                        {editable && (
                          <Link
                            href={`/onboarding/clarify?goalId=${encodeURIComponent(goal.id)}`}
                            className="inline-flex min-h-11 items-center rounded-lg border border-border-default px-4 text-label-lg text-text-primary hover:bg-surface-subtle"
                          >
                            {goal.status === 'clarifying' ? 'Resume clarification' : 'Review & confirm'}
                          </Link>
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
          <Link href="/onboarding/skills" className="text-label-lg text-text-link underline underline-offset-2">
            Edit skills
          </Link>
        </div>
        {profileError && (
          <Alert variant="warning" role="alert">
            {profileError}
          </Alert>
        )}
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
      </section>

      <section aria-labelledby="prefs-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="prefs-heading" className="text-heading-md text-text-primary">
            Learning preferences
          </h2>
          <span className="flex gap-4">
            <Link href="/onboarding/preferences" className="text-label-lg text-text-link underline underline-offset-2">
              Edit preferences
            </Link>
            <Link href="/onboarding/profile" className="text-label-lg text-text-link underline underline-offset-2">
              Edit profile
            </Link>
          </span>
        </div>
        {profile && (
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

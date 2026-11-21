'use client';

import type { FormEvent, SVGProps } from 'react';
import type { CareerGoalResponse } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { GoalStatusBadge } from '@/components/ui/career-card';
import { cn } from '@/components/ui/cn';
import { AlertCircleIcon, CompassIcon, LockIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import {
  GOAL_TEXT_MAX,
  codePointLength,
} from '@/components/onboarding/goal-setup-form';

function ShieldCheckIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function SignalBarsIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M4 20v-4" />
      <path d="M10 20v-9" />
      <path d="M16 20v-14" />
      <path d="M22 20V4" />
    </svg>
  );
}

function formatArchivedDate(
  goal: CareerGoalResponse & { discontinued_at?: string | null },
): string | null {
  const raw = goal.discontinued_at;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

export interface CareerGoalItemProps {
  goal: CareerGoalResponse & { discontinued_at?: string | null };
  editing: boolean;
  editable: boolean;
  editText: string;
  editTouched: boolean;
  editError: string | null;
  pending: boolean;
  onEditTextChange: (value: string) => void;
  onEditBlur: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (event: FormEvent<HTMLFormElement>) => void;
  onReviewOrClarify: () => void;
  onDiscontinue: () => void;
}

/**
 * Presentational goal card for Screen 14 (`/career-profile`).
 * Clearly distinguishes the user's stated career goal from its mapped canonical roadmap & level:
 * - Action-needed (`awaiting_confirmation` / `clarifying`): warm amber accent + `Suggested roadmap:` + `Level:`
 * - Active (`confirmed`): teal accent + `Roadmap:` + `Level:`
 * - Archived (`discontinued`): compact muted slate archive card with preserved-evidence footer
 */
export function CareerGoalItem({
  goal,
  editing,
  editable,
  editText,
  editTouched,
  editError,
  pending,
  onEditTextChange,
  onEditBlur,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onReviewOrClarify,
  onDiscontinue,
}: CareerGoalItemProps) {
  const isDiscontinued = goal.status === 'discontinued';
  const isConfirmed = goal.status === 'confirmed';
  const isActionNeeded =
    goal.status === 'awaiting_confirmation' || goal.status === 'clarifying';
  const levelText = goal.target_level ?? goal.suggested_level;
  const capitalizedLevel = levelText
    ? `${levelText.charAt(0).toUpperCase()}${levelText.slice(1)}`
    : null;
  const roadmapLabel = isActionNeeded ? 'Suggested roadmap' : 'Roadmap';
  const archivedDate = isDiscontinued ? formatArchivedDate(goal) : null;

  if (isDiscontinued) {
    return (
      <li className="group overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/70 transition-colors duration-150 hover:border-slate-300/80 dark:border-slate-800 dark:bg-slate-900/50 dark:hover:border-slate-700">
        <div className="px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p
                dir="auto"
                className="text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-text-secondary [overflow-wrap:anywhere]"
              >
                {goal.goal_text}
              </p>
              <GoalStatusBadge status={goal.status} />
            </div>

            {archivedDate && (
              <span className="shrink-0 text-[12px] leading-none tabular-nums text-text-muted">
                Archived {archivedDate}
              </span>
            )}
          </div>

          {(goal.proposed_role || capitalizedLevel) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="sr-only">
                {goal.proposed_role
                  ? `${roadmapLabel}: ${goal.proposed_role.name}`
                  : ''}
                {goal.proposed_role && capitalizedLevel ? ' · ' : ''}
                {capitalizedLevel ? `Level: ${capitalizedLevel}` : ''}
              </span>
              {goal.proposed_role && (
                <span
                  aria-hidden="true"
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200/90 bg-white/80 px-2.5 py-1 text-[12px] leading-none font-medium text-text-secondary dark:border-slate-700 dark:bg-slate-800/70"
                >
                  <CompassIcon className="h-3.5 w-3.5 text-text-muted" />
                  <span className="font-normal text-text-muted">
                    {roadmapLabel}:
                  </span>
                  <span>{goal.proposed_role.name}</span>
                </span>
              )}
              {capitalizedLevel && (
                <span
                  aria-hidden="true"
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200/90 bg-white/80 px-2.5 py-1 text-[12px] leading-none font-medium text-text-secondary dark:border-slate-700 dark:bg-slate-800/70"
                >
                  <SignalBarsIcon className="h-3.5 w-3.5 text-text-muted" />
                  <span className="font-normal text-text-muted">Level:</span>
                  <span>{capitalizedLevel}</span>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200/70 bg-slate-100/50 px-4 py-2.5 sm:px-5 dark:border-slate-800/80 dark:bg-slate-900/80">
          <p className="inline-flex items-center gap-2 text-[12px] leading-snug text-text-secondary">
            <ShieldCheckIcon className="h-3.5 w-3.5 text-teal-600/80 dark:text-teal-400/80" />
            <span>Progress &amp; shared skill evidence preserved</span>
          </p>
        </div>
      </li>
    );
  }

  const cardClassName = isActionNeeded
    ? 'group overflow-hidden rounded-xl border border-amber-200/90 border-l-4 border-l-amber-400 bg-gradient-to-r from-amber-50/50 via-white to-white shadow-xs transition-all duration-150 hover:border-amber-300 hover:shadow-sm dark:border-amber-800/70 dark:from-amber-950/20 dark:via-slate-900 dark:to-slate-900'
    : 'group overflow-hidden rounded-xl border border-teal-200/80 border-l-4 border-l-teal-600 bg-white shadow-xs transition-all duration-150 hover:border-teal-300 hover:shadow-sm dark:border-teal-800/70 dark:bg-slate-900';

  return (
    <li className={cardClassName}>
      {/* Card Primary Content */}
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              Career goal
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <p
                dir="auto"
                className="text-[18px] font-bold leading-snug tracking-[-0.015em] text-text-primary [overflow-wrap:anywhere]"
              >
                {goal.goal_text}
              </p>
              <GoalStatusBadge status={goal.status} />
            </div>

            {(goal.proposed_role || capitalizedLevel) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="sr-only">
                  {goal.proposed_role
                    ? `${roadmapLabel}: ${goal.proposed_role.name}`
                    : ''}
                  {goal.proposed_role && capitalizedLevel ? ' · ' : ''}
                  {capitalizedLevel ? `Level: ${capitalizedLevel}` : ''}
                </span>
                {goal.proposed_role && (
                  <span
                    aria-hidden="true"
                    className={
                      isConfirmed
                        ? 'inline-flex items-center gap-1.5 rounded-md border border-teal-200/80 bg-teal-50/70 px-2.5 py-1 text-[12.5px] leading-none font-semibold text-teal-800 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-200'
                        : 'inline-flex items-center gap-1.5 rounded-md border border-amber-200/90 bg-amber-50/80 px-2.5 py-1 text-[12.5px] leading-none font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
                    }
                  >
                    <CompassIcon
                      className={
                        isConfirmed
                          ? 'h-3.5 w-3.5 text-teal-600 dark:text-teal-300'
                          : 'h-3.5 w-3.5 text-amber-600 dark:text-amber-300'
                      }
                    />
                    <span className="font-normal opacity-80">
                      {roadmapLabel}:
                    </span>
                    <span>{goal.proposed_role.name}</span>
                  </span>
                )}
                {capitalizedLevel && (
                  <span
                    aria-hidden="true"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-surface-subtle px-2.5 py-1 text-[12.5px] leading-none font-semibold text-text-primary"
                  >
                    <SignalBarsIcon className="h-3.5 w-3.5 text-text-muted" />
                    <span className="font-normal text-text-secondary">
                      Level:
                    </span>
                    <span>{capitalizedLevel}</span>
                  </span>
                )}
              </div>
            )}

            {isActionNeeded && !editing && (
              <p className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] leading-snug font-medium text-amber-800 dark:text-amber-300">
                <AlertCircleIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span>
                  {goal.status === 'clarifying'
                    ? 'Action needed — answer one quick question to match your roadmap.'
                    : 'Action needed — confirm your roadmap and level to lock this goal.'}
                </span>
              </p>
            )}
          </div>
        </div>

        {editing && editable && (
          <form
            onSubmit={onSaveEdit}
            noValidate
            className="mt-4 flex flex-col gap-2.5 rounded-lg border border-border-default bg-surface-subtle p-4"
          >
            <Input
              variant="textarea"
              label="Edit goal"
              rows={3}
              value={editText}
              readOnly={pending}
              error={editTouched && editError ? editError : undefined}
              onChange={(e) => onEditTextChange(e.target.value)}
              onBlur={onEditBlur}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p
                aria-live="polite"
                className="font-mono text-caption tabular-nums text-text-secondary"
              >
                {codePointLength(editText.trim())} / {GOAL_TEXT_MAX} characters
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={onCancelEdit}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  isLoading={pending}
                  loadingText="Saving..."
                >
                  Save goal
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* Card Footer Band: Immutability Notice / Status Guidance + Actions */}
      {!editing && (
        <div
          className={
            isActionNeeded
              ? 'flex flex-col gap-3 border-t border-amber-200/70 bg-amber-50/40 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-amber-900/50 dark:bg-amber-950/15'
              : 'flex flex-col gap-3 border-t border-border-subtle bg-surface-subtle px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6'
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            {editable && (
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={pending}
                onClick={onReviewOrClarify}
              >
                {goal.status === 'clarifying'
                  ? 'Resume clarification'
                  : 'Review & confirm'}
              </Button>
            )}
            {editable && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={onStartEdit}
              >
                Edit goal text
              </Button>
            )}
            {isConfirmed && (
              <div className="inline-flex items-center gap-2 text-[12.5px] leading-snug text-text-secondary">
                <LockIcon className="h-3.5 w-3.5 text-text-muted" />
                <p>Confirmed goal text cannot be edited.</p>
              </div>
            )}
          </div>

          <Button
            type="button"
            size="sm"
            variant={isActionNeeded ? 'ghost' : 'secondary'}
            disabled={pending}
            onClick={onDiscontinue}
            aria-label={`Discontinue goal: ${goal.goal_text}`}
            className="self-start text-text-secondary hover:border-border-danger hover:bg-feedback-danger-background hover:text-feedback-danger-text sm:self-auto"
          >
            Discontinue
          </Button>
        </div>
      )}
    </li>
  );
}

'use client';

import type { KeyboardEvent } from 'react';
import { cn } from './cn';
import { CloseIcon } from './icons';
import type { ProfileSkillDTO } from '@/lib/api/client';

export const PROFICIENCY_LEVELS = [
  'beginner',
  'intermediate',
  'advanced',
  'expert',
] as const;
export type Proficiency = (typeof PROFICIENCY_LEVELS)[number];

const LEARNING_STATE_LABEL: Record<ProfileSkillDTO['learning_state'], string> = {
  not_started: 'Not started',
  learning: 'Learning',
  practicing: 'Practicing',
  proficient: 'Proficient',
};

export interface SkillCardProps {
  name: string;
  /** Raw text the user typed when it differs from the canonical `name` (alias badge). */
  aliasInput?: string | null;
  /** `false` flags an unresolved alias that needs clarification. */
  aliasResolved?: boolean;
  learningState?: ProfileSkillDTO['learning_state'];
  /** Optional proficiency; selector renders only when `onProficiencyChange` is provided. */
  proficiency?: Proficiency;
  onProficiencyChange?: (next: Proficiency) => void;
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Component #14 `SkillCard` (`profile_skill` variant).
 * The backend `EP-P02` contract stores skill names only, so `proficiency` is a purely presentational
 * opt-in and screens must not offer it as persisted data until a contract field exists.
 */
export function SkillCard({
  name,
  aliasInput,
  aliasResolved = true,
  learningState,
  proficiency,
  onProficiencyChange,
  onRemove,
  disabled = false,
  className,
}: SkillCardProps) {
  const showAlias =
    typeof aliasInput === 'string' &&
    aliasInput.trim() !== '' &&
    aliasInput.trim().toLowerCase() !== name.trim().toLowerCase();

  const onRemoveKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && onRemove && !disabled) {
      e.preventDefault();
      onRemove();
    }
  };

  return (
    <li
      className={cn(
        'flex min-h-11 flex-wrap items-center gap-2 rounded-lg border border-border-default bg-surface-default px-3 py-2 shadow-xs',
        className,
      )}
    >
      <span dir="auto" className="text-label-lg text-text-primary">
        {name}
      </span>
      {showAlias && (
        <span className="inline-flex items-center rounded-full border border-border-default bg-surface-sunken px-2 py-0.5 text-caption text-text-secondary">
          Alias: {aliasInput}
        </span>
      )}
      {!aliasResolved && (
        <span className="inline-flex items-center rounded-full border border-feedback-warning-border bg-feedback-warning-background px-2 py-0.5 text-caption text-feedback-warning-text">
          Needs clarification
        </span>
      )}
      {learningState && (
        <span className="inline-flex items-center rounded-full border border-border-default px-2 py-0.5 text-caption text-text-secondary">
          {LEARNING_STATE_LABEL[learningState]}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {onProficiencyChange && (
          <select
            aria-label={`Proficiency for ${name}`}
            value={proficiency ?? ''}
            disabled={disabled}
            onChange={(e) => onProficiencyChange(e.target.value as Proficiency)}
            className="min-h-11 rounded-md border border-border-default bg-surface-default px-2 text-body-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:cursor-not-allowed disabled:bg-surface-disabled"
          >
            <option value="" disabled>
              Select proficiency
            </option>
            {PROFICIENCY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </option>
            ))}
          </select>
        )}
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove skill ${name}`}
            disabled={disabled}
            onClick={onRemove}
            onKeyDown={onRemoveKey}
            className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-md text-text-secondary hover:text-text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:text-text-disabled"
          >
            <CloseIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

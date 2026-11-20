'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type SVGProps,
} from 'react';
import type {
  ProfileResponse,
  ProfileSkillDTO,
  UnresolvedSkillDTO,
} from '@/lib/api/client';
import {
  mapApiError,
  type M05Invoke,
  type MappedError,
} from '@/lib/api/error-mapper';
import {
  APPROVED_SKILL_CATALOG_OPTIONS,
  findCatalogSkillOption,
} from '@/lib/skills/catalog-options';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  AlertCircleIcon,
  CheckIcon,
  WarningIcon,
} from '@/components/ui/icons';
import {
  MultiSelectCombobox,
  type MultiSelectOption,
  type MultiSelectSelectedItem,
} from '@/components/ui/multi-select-combobox';
import { toneToAlertVariant } from '@/components/ui/multi-step-form-wrapper';
import { Toast } from '@/components/ui/toast';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { StepFrame } from './step-shell';

function TrashIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export const MAX_SKILLS = 100;
export const MAX_SKILL_NAME_CODE_POINTS = 80;

type SkillEntryStatus = 'valid' | 'ambiguous' | 'unrecognized';

interface SkillEntry {
  key: string;
  label: string;
  status: SkillEntryStatus;
  candidates?: UnresolvedSkillDTO['candidates'];
}

export interface SkillsSetupFormProps {
  initialProfile: ProfileResponse | null;
  loadError?: string | null;
  /** Optional catalog options override; defaults to the seeded approved skill catalog. */
  catalogOptions?: readonly MultiSelectOption[];
  /**
   * Optional profession-derived quick-add suggestions; renders nothing extra when empty.
   */
  suggestedSkills?: string[];
  invoke: M05Invoke;
  /** Rendering mode: `'wizard'` (onboarding step) or `'standalone'` (inline editing on `/career-profile`). */
  mode?: 'wizard' | 'standalone';
  /** Notifies an outer wizard container whenever submission enters or exits pending state. */
  onPendingChange?: (pending: boolean) => void;
  /** Optional callback invoked on successful save/continue instead of router navigation. */
  onSuccess?: (profile: ProfileResponse) => void;
  /** Optional callback for the Back action when embedded in a wizard or inline view. */
  onBack?: () => void;
  /** Optional Cancel handler when used in `mode="standalone"`. */
  onCancel?: () => void;
  /** When true, omits the standalone stepper header so an outer shell owns stepper chrome. */
  embedded?: boolean;
}

/** Returns an inline validation message for a candidate skill name, or `null` when it can be added. */
export function validateNewSkill(raw: string, existing: string[]): string | null {
  const name = raw.trim();
  if (!name) return 'Enter a skill name.';
  if (Array.from(name).length > MAX_SKILL_NAME_CODE_POINTS) {
    return `Skill names can be at most ${MAX_SKILL_NAME_CODE_POINTS} characters.`;
  }
  if (existing.length >= MAX_SKILLS) {
    return `You can add up to ${MAX_SKILLS} skills. Remove a skill before adding another.`;
  }
  if (existing.some((s) => s.trim().toLowerCase() === name.toLowerCase())) {
    return 'That skill is already in your list.';
  }
  return null;
}

function hydrateEntries(existing: ProfileSkillDTO[]): SkillEntry[] {
  const seen = new Set<string>();
  const entries: SkillEntry[] = [];
  for (const skill of existing) {
    const label = skill.name.trim();
    const key = label.toLowerCase();
    if (label && !seen.has(key)) {
      seen.add(key);
      entries.push({ key, label, status: 'valid' });
    }
  }
  return entries;
}

const REMOVE_PILL_CLASS =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-2xs transition-colors hover:border-rose-300 hover:bg-rose-100 hover:text-rose-800 active:bg-rose-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)';

const CANDIDATE_PILL_CLASS =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 shadow-2xs transition-colors hover:border-teal-300 hover:bg-teal-100 hover:text-teal-900 active:bg-teal-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)';

/**
 * Screen 08 (`/onboarding`, Step 2 of 5) and standalone inline skills editor (`/career-profile`).
 * Uses `MultiSelectCombobox` over the approved skill catalog with immediate validation for custom entries.
 */
export function SkillsSetupForm({
  initialProfile,
  loadError,
  catalogOptions = APPROVED_SKILL_CATALOG_OPTIONS,
  suggestedSkills = [],
  invoke,
  mode = 'wizard',
  onPendingChange,
  onSuccess,
  onBack,
  onCancel,
  embedded = false,
}: SkillsSetupFormProps) {
  const isStandalone = mode === 'standalone';
  const isEmbedded = embedded || isStandalone;
  const router = useRouter();
  const fieldId = useId();
  const inputId = `${fieldId}-skill-input`;
  const errorId = `${fieldId}-skill-error`;

  const [entries, setEntries] = useState<SkillEntry[]>(() =>
    hydrateEntries(initialProfile?.existing_skills ?? []),
  );
  const [none, setNone] = useState<boolean>(
    () =>
      Boolean(initialProfile?.existing_skills_none) &&
      (initialProfile?.existing_skills.length ?? 0) === 0,
  );
  const [draftError, setDraftError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [apiError, setApiError] = useState<MappedError | null>(null);

  useEffect(() => {
    onPendingChange?.(pending);
    return () => {
      onPendingChange?.(false);
    };
  }, [pending, onPendingChange]);

  const entriesRef = useRef<SkillEntry[]>(entries);
  const noneRef = useRef<boolean>(none);
  const saveRequestTokenRef = useRef(0);
  const pendingFocusInputRef = useRef(false);

  function commitEntries(next: SkillEntry[]) {
    entriesRef.current = next;
    setEntries(next);
  }

  const validEntries = useMemo(
    () => entries.filter((e) => e.status === 'valid'),
    [entries],
  );
  const ambiguousEntries = useMemo(
    () => entries.filter((e) => e.status === 'ambiguous'),
    [entries],
  );
  const unrecognizedEntries = useMemo(
    () => entries.filter((e) => e.status === 'unrecognized'),
    [entries],
  );
  const hasAmbiguous = ambiguousEntries.length > 0;
  const hasUnrecognized = unrecognizedEntries.length > 0;

  useEffect(() => {
    if (!pendingFocusInputRef.current || pending || hasAmbiguous || none) return;
    pendingFocusInputRef.current = false;
    if (typeof document !== 'undefined') {
      document.getElementById(inputId)?.focus();
    }
  }, [entries, pending, hasAmbiguous, none, inputId]);
  const canSubmit =
    !pending &&
    !loadError &&
    (none || (validEntries.length > 0 && !hasAmbiguous));

  const selectedItems = useMemo<MultiSelectSelectedItem[]>(
    () =>
      entries.map((entry) => ({
        id: entry.key,
        label: entry.label,
        tone: entry.status === 'valid' ? 'default' : 'warning',
        statusLabel:
          entry.status === 'ambiguous' || entry.status === 'unrecognized'
            ? 'Needs clarification'
            : undefined,
      })),
    [entries],
  );

  const availableSuggestions = suggestedSkills.filter(
    (s) =>
      s.trim().length > 0 &&
      !entries.some((e) => e.key === s.trim().toLowerCase()),
  );

  function addCatalogSkill(option: MultiSelectOption): boolean {
    const trimmedLabel = option.label.trim();
    const existingLabels = entriesRef.current.map((e) => e.label);
    const error = validateNewSkill(trimmedLabel, existingLabels);
    if (error) {
      setDraftError(error);
      return false;
    }
    setDraftError(null);
    setNotice(null);
    setApiError(null);
    noneRef.current = false;
    setNone(false);
    commitEntries([
      ...entriesRef.current,
      {
        key: trimmedLabel.toLowerCase(),
        label: trimmedLabel,
        status: 'valid',
      },
    ]);
    return true;
  }

  function handleCreateCustom(rawValue: string): boolean {
    const trimmed = rawValue.trim();
    const matchedCatalog = findCatalogSkillOption(trimmed, catalogOptions);
    if (matchedCatalog) {
      return addCatalogSkill(matchedCatalog);
    }

    const existingLabels = entriesRef.current.map((e) => e.label);
    const error = validateNewSkill(trimmed, existingLabels);
    if (error) {
      setDraftError(error);
      return false;
    }

    const customKey = trimmed.toLowerCase();

    setDraftError(null);
    setNotice(null);
    setApiError(null);
    noneRef.current = false;
    setNone(false);

    // Never call mutating EP-P02 (updateSkills) on draft skill entry: EP-P05 requires a chosen
    // skill_id and also mutates user_profiles, so deferring EP-P02 strictly to explicit Save
    // guarantees adding/canceling a custom skill never persists draft skills or races against None.
    commitEntries([
      ...entriesRef.current,
      { key: customKey, label: trimmed, status: 'valid' },
    ]);
    return true;
  }

  function removeEntry(key: string) {
    const target = key.trim().toLowerCase();
    const removed = entriesRef.current.find((e) => e.key === target);
    commitEntries(entriesRef.current.filter((e) => e.key !== target));
    setDraftError(null);
    setApiError(null);
    setNotice(removed ? `Removed ${removed.label}.` : null);
  }

  function removeClarificationEntry(entry: SkillEntry) {
    const target = entry.key.trim().toLowerCase();
    pendingFocusInputRef.current = true;
    commitEntries(entriesRef.current.filter((e) => e.key !== target));
    setDraftError(null);
    setApiError(null);
    setNotice(`Removed “${entry.label}”.`);
  }

  function changeNone(next: boolean) {
    saveRequestTokenRef.current += 1;
    noneRef.current = next;
    setNone(next);
    setDraftError(null);
    setNotice(null);
    setApiError(null);
    if (next) {
      commitEntries([]); // None clears pills and creates no artificial skills (R07)
    }
  }

  async function resolveAlias(
    entryKey: string,
    inputLabel: string,
    skillId: string,
    candidateName: string,
  ) {
    setPending(true);
    setApiError(null);
    let result: Awaited<ReturnType<typeof invoke<'interpretSkillAlias'>>>;
    try {
      result = await invoke('interpretSkillAlias', {
        input: inputLabel,
        skill_id: skillId,
      });
    } catch (err) {
      setPending(false);
      setApiError(mapApiError(err));
      return;
    }
    setPending(false);
    if (!result.ok) {
      setApiError(result.error);
      return;
    }
    const canonicalLabel = candidateName.trim();
    const canonicalKey = canonicalLabel.toLowerCase();
    const nextEntries: SkillEntry[] = [];
    const seen = new Set<string>();
    for (const entry of entriesRef.current) {
      const updated: SkillEntry =
        entry.key === entryKey
          ? { key: canonicalKey, label: canonicalLabel, status: 'valid' }
          : entry;
      if (!seen.has(updated.key)) {
        seen.add(updated.key);
        nextEntries.push(updated);
      }
    }
    commitEntries(nextEntries);
    setNotice(`Saved your meaning for “${inputLabel}”.`);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setPending(true);
    setApiError(null);
    const requestToken = ++saveRequestTokenRef.current;
    // Internally submit only valid skills (unrecognized entries are silently excluded)
    const namesToSave = validEntries.map((e) => e.label);
    let result: Awaited<ReturnType<typeof invoke<'updateSkills'>>>;
    try {
      result = await invoke(
        'updateSkills',
        none ? { none: true } : { names: namesToSave },
      );
    } catch (err) {
      if (saveRequestTokenRef.current !== requestToken) return;
      setPending(false);
      setApiError(mapApiError(err));
      return;
    }
    if (saveRequestTokenRef.current !== requestToken) return;
    if (!result.ok) {
      setPending(false);
      setApiError(result.error);
      return;
    }
    const pendingAliases = result.data.unresolved_skills ?? [];
    if (pendingAliases.length > 0) {
      const nextEntries: SkillEntry[] = hydrateEntries(
        result.data.existing_skills,
      );
      const seen = new Set(nextEntries.map((e) => e.key));
      for (const item of pendingAliases) {
        const label = item.input.trim();
        const key = label.toLowerCase();
        if (label && !seen.has(key)) {
          seen.add(key);
          nextEntries.push(
            item.candidates.length > 0
              ? {
                  key,
                  label,
                  status: 'ambiguous',
                  candidates: item.candidates,
                }
              : { key, label, status: 'unrecognized' },
          );
        }
      }
      commitEntries(nextEntries);
      setPending(false);
      return;
    }
    if (onSuccess) {
      setPending(false);
      onSuccess(result.data);
      return;
    }
    if (isStandalone) {
      commitEntries(hydrateEntries(result.data.existing_skills));
      const nextNone =
        Boolean(result.data.existing_skills_none) &&
        result.data.existing_skills.length === 0;
      noneRef.current = nextNone;
      setNone(nextNone);
      setPending(false);
      setSuccessToast('Skills updated.');
      return;
    }
    if (
      typeof window !== 'undefined' &&
      window.location.pathname === '/onboarding'
    ) {
      setPending(false);
    }
    router.push('/onboarding');
  }

  const backControl = isStandalone ? (
    onCancel ? (
      <Button
        type="button"
        variant="secondary"
        size="md"
        disabled={pending}
        onClick={onCancel}
      >
        Cancel
      </Button>
    ) : (
      <span aria-hidden="true" className="hidden sm:block" />
    )
  ) : onBack ? (
    <button
      type="button"
      onClick={onBack}
      disabled={pending}
      className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border-default px-4 py-2.5 text-label-lg text-text-primary hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
    >
      Back
    </button>
  ) : (
    <Link
      href="/onboarding"
      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border-default px-4 py-2.5 text-label-lg text-text-primary hover:bg-surface-subtle"
    >
      Back
    </Link>
  );

  return (
    <form onSubmit={save} noValidate>
      <StepFrame
        currentStep={2}
        embedded={isEmbedded}
        heading={isStandalone ? undefined : 'Your Skills'}
        description={
          isStandalone
            ? undefined
            : 'Add the technology skills you already have, or confirm that you are starting from zero. You are never blocked for being a beginner.'
        }
        status="editing"
        errorMessage={loadError ?? null}
        actions={
          <>
            {backControl}
            <Button
              type="submit"
              size={isStandalone ? 'md' : 'lg'}
              disabled={!canSubmit}
              isLoading={pending}
              loadingText="Saving skills..."
              className={isStandalone ? 'min-w-[140px]' : 'min-w-[176px]'}
            >
              {isStandalone ? 'Save Skills' : 'Save & Next'}
            </Button>
          </>
        }
      >
        <ToggleSwitch
          checked={none}
          onCheckedChange={changeNone}
          label="No prior technical skills"
          description="Choose this if you are a complete beginner. No skills are created for you."
          disabled={pending}
        />

        {!none && (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-1.5">
                <div className="flex items-baseline">
                  <label htmlFor={inputId} className="text-label-lg text-text-primary">
                    Add a skill
                  </label>
                  <span aria-hidden="true" className="ml-0.5 font-medium text-text-danger">
                    *
                  </span>
                </div>
                <span className="text-caption text-text-secondary">
                  (Add at least one skill)
                </span>
              </div>

              <MultiSelectCombobox
                id={inputId}
                options={catalogOptions}
                selected={selectedItems}
                onSelectOption={addCatalogSkill}
                onCreateCustom={handleCreateCustom}
                onRemove={removeEntry}
                onQueryChange={() => setDraftError(null)}
                placeholder="Search or type a skill (e.g., React, SQL, Python)"
                secondaryPlaceholder="Add another skill..."
                disabled={pending || hasAmbiguous}
                selectedListAriaLabel="Your skills"
                listboxAriaLabel="Skill suggestions"
                emptyMessage="No matching skill"
                openOnFocus={false}
                ariaDescribedBy={draftError ? errorId : undefined}
                ariaInvalid={Boolean(draftError)}
                allowCustom
              />

              {draftError && (
                <p
                  id={errorId}
                  role="alert"
                  className="flex items-center gap-1.5 text-caption leading-snug text-text-danger"
                >
                  <AlertCircleIcon className="h-3.5 w-3.5 shrink-0" />
                  <span dir="auto">{draftError}</span>
                </p>
              )}
            </div>

            {availableSuggestions.length > 0 && !hasAmbiguous && (
              <div className="flex flex-col gap-2">
                <p className="text-caption text-text-muted">Suggested skills</p>
                <ul aria-label="Suggested skills" className="flex flex-wrap gap-2">
                  {availableSuggestions.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => handleCreateCustom(suggestion)}
                        className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-border-default bg-surface-subtle px-3 text-caption font-medium text-text-secondary transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none hover:border-border-focus hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:text-text-disabled"
                      >
                        + {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {(hasAmbiguous || hasUnrecognized) && (
          <section
            aria-label="Skill clarification"
            className="flex flex-col gap-4 rounded-lg border border-feedback-warning-border bg-feedback-warning-background p-4"
          >
            {hasAmbiguous && (
              <div className="flex flex-col gap-3">
                <p className="text-label-lg text-feedback-warning-text">
                  Help us understand these skills
                </p>
                {ambiguousEntries.map((entry) => (
                  <div key={entry.key} className="flex flex-col gap-2">
                    <p className="text-body-sm text-text-primary">
                      What did you mean by “{entry.label}”?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(entry.candidates ?? []).map((candidate) => (
                        <button
                          key={candidate.skill_id}
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            resolveAlias(
                              entry.key,
                              entry.label,
                              candidate.skill_id,
                              candidate.name,
                            )
                          }
                          className={CANDIDATE_PILL_CLASS}
                        >
                          <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                          <span>{candidate.name}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => removeClarificationEntry(entry)}
                        className={REMOVE_PILL_CLASS}
                      >
                        <TrashIcon className="h-3.5 w-3.5 shrink-0" />
                        <span>Remove “{entry.label}”</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {hasUnrecognized && (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <WarningIcon className="h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-label-lg text-feedback-warning-text">
                    {unrecognizedEntries.length === 1
                      ? 'Skill not recognized'
                      : 'Skills not recognized'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {unrecognizedEntries.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      disabled={pending}
                      onClick={() => removeClarificationEntry(entry)}
                      className={REMOVE_PILL_CLASS}
                    >
                      <TrashIcon className="h-3.5 w-3.5 shrink-0" />
                      <span>Remove “{entry.label}”</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <p role="status" aria-live="polite" className="text-caption text-text-secondary empty:hidden">
          {notice}
        </p>

        {apiError && (
          <Alert variant={toneToAlertVariant(apiError.tone)} role="alert">
            {apiError.message}
          </Alert>
        )}
      </StepFrame>
      {successToast && (
        <Toast
          variant="success"
          position="top-center"
          role="status"
          ariaLive="polite"
          autoDismissMs={4000}
          onDismiss={() => setSuccessToast(null)}
        >
          {successToast}
        </Toast>
      )}
    </form>
  );
}

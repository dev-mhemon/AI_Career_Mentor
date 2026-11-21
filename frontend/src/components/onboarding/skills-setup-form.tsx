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
} from 'react';
import type {
  ProfileResponse,
  ProfileSkillDTO,
  UnresolvedSkillCandidateDTO,
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

export const MAX_SKILLS = 100;
export const MAX_SKILL_NAME_CODE_POINTS = 80;

interface SkillEntry {
  key: string;
  label: string;
}

interface QueuedUnresolvedSkill extends UnresolvedSkillDTO {
  /** True only for an inline custom entry typed by the user; cleared when the user edits/replaces it. */
  clearOnQueryEdit?: boolean;
}

function normalizeUnresolvedQueue(
  items: readonly UnresolvedSkillDTO[] | undefined,
): QueuedUnresolvedSkill[] {
  if (!items || items.length === 0) return [];
  const seen = new Set<string>();
  const ambiguous: QueuedUnresolvedSkill[] = [];
  const unrecognized: QueuedUnresolvedSkill[] = [];
  for (const item of items) {
    const trimmed = item.input.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    const validCandidates = Array.isArray(item.candidates)
      ? item.candidates.filter(
          (c) =>
            c &&
            typeof c.skill_id === 'string' &&
            typeof c.name === 'string' &&
            c.name.trim().length > 0,
        )
      : [];
    if (validCandidates.length > 0) {
      ambiguous.push({ input: trimmed, candidates: validCandidates });
    } else {
      unrecognized.push({ input: trimmed, candidates: [] });
    }
  }
  return [...ambiguous, ...unrecognized];
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
  /** Rendering mode: `'wizard'` (onboarding step) or `'standalone'` (editing on `/career-profile`). */
  mode?: 'wizard' | 'standalone';
  /** Notifies an outer wizard or modal container whenever submission enters or exits pending state. */
  onPendingChange?: (pending: boolean) => void;
  /** Fired whenever EP-P02 commits skills on the server even if unresolved aliases keep the user on this step. */
  onProfileCommitted?: (profile: ProfileResponse) => void;
  /** Optional callback invoked on successful save/continue instead of router navigation. */
  onSuccess?: (profile: ProfileResponse) => void;
  /** Optional callback for the Back action when embedded in a wizard or inline view. */
  onBack?: () => void;
  /** Optional Cancel handler when used in `mode="standalone"`. */
  onCancel?: () => void;
  /** When true, omits the standalone stepper header so an outer shell owns stepper chrome. */
  embedded?: boolean;
  /** When true, right-aligns modal footer actions and omits outer header chrome. */
  inModal?: boolean;
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

function hydrateValidEntries(existing: ProfileSkillDTO[]): SkillEntry[] {
  const seen = new Set<string>();
  const entries: SkillEntry[] = [];
  for (const skill of existing) {
    const label = skill.name.trim();
    const key = label.toLowerCase();
    if (label && !seen.has(key)) {
      seen.add(key);
      entries.push({ key, label });
    }
  }
  return entries;
}

function findCatalogSubstringCandidates(
  rawInput: string,
  options: readonly MultiSelectOption[],
): UnresolvedSkillCandidateDTO[] {
  const q = rawInput.trim().toLowerCase();
  if (q.length < 2) return [];
  const matches: UnresolvedSkillCandidateDTO[] = [];
  for (const opt of options) {
    const label = opt.label.trim();
    const labelLower = label.toLowerCase();
    const keywordMatch =
      opt.keywords?.some((kw) => kw.trim().toLowerCase().includes(q)) ?? false;
    if (labelLower.includes(q) || keywordMatch) {
      matches.push({ skill_id: opt.id, name: label });
    }
  }
  return matches.slice(0, 5);
}

const CANDIDATE_PILL_CLASS =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 shadow-2xs transition-colors hover:border-teal-300 hover:bg-teal-100 hover:text-teal-900 active:bg-teal-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)';

/**
 * Screen 08 (`/onboarding`, Step 2 of 5) and standalone/modal skills editor (`/career-profile`).
 * Uses `MultiSelectCombobox` over the approved skill catalog with immediate read-only validation
 * (`interpretSkillAlias`, EP-P05) for custom non-catalog entries. Unrecognized entries are never
 * added to the chip list and instead display a concise inline message.
 */
export function SkillsSetupForm({
  initialProfile,
  loadError,
  catalogOptions = APPROVED_SKILL_CATALOG_OPTIONS,
  suggestedSkills = [],
  invoke,
  mode = 'wizard',
  onPendingChange,
  onProfileCommitted,
  onSuccess,
  onBack,
  onCancel,
  embedded = false,
  inModal = false,
}: SkillsSetupFormProps) {
  const isStandalone = mode === 'standalone';
  const isEmbedded = embedded || isStandalone || inModal;
  const router = useRouter();
  const fieldId = useId();
  const inputId = `${fieldId}-skill-input`;
  const errorId = `${fieldId}-skill-error`;

  const [entries, setEntries] = useState<SkillEntry[]>(() =>
    hydrateValidEntries(initialProfile?.existing_skills ?? []),
  );
  const [none, setNone] = useState<boolean>(
    () =>
      Boolean(initialProfile?.existing_skills_none) &&
      (initialProfile?.existing_skills.length ?? 0) === 0,
  );
  const [isValidating, setIsValidating] = useState(false);
  const [unresolvedQueue, setUnresolvedQueue] = useState<
    QueuedUnresolvedSkill[]
  >(() => normalizeUnresolvedQueue(initialProfile?.unresolved_skills));
  const currentUnresolved = unresolvedQueue[0] ?? null;
  const ambiguousPrompt =
    currentUnresolved && currentUnresolved.candidates.length > 0
      ? currentUnresolved
      : null;
  const unrecognizedSkill =
    currentUnresolved && currentUnresolved.candidates.length === 0
      ? currentUnresolved.input
      : null;
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
  const lookupSessionRef = useRef(0);
  const nextLookupIdRef = useRef(0);
  const inFlightLookupIdsRef = useRef<Set<number>>(new Set());

  function commitEntries(next: SkillEntry[]) {
    entriesRef.current = next;
    setEntries(next);
  }

  function appendValidSkill(canonicalLabel: string): boolean {
    const trimmed = canonicalLabel.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed) return false;
    if (entriesRef.current.some((e) => e.key === key)) return true;
    if (entriesRef.current.length >= MAX_SKILLS) {
      setDraftError(
        `You can add up to ${MAX_SKILLS} skills. Remove a skill before adding another.`,
      );
      return false;
    }
    commitEntries([...entriesRef.current, { key, label: trimmed }]);
    return true;
  }

  function enqueueUnresolvedHead(item: QueuedUnresolvedSkill) {
    const trimmed = item.input.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    setUnresolvedQueue((prev) => [
      {
        input: trimmed,
        candidates: item.candidates,
        clearOnQueryEdit: item.clearOnQueryEdit,
      },
      ...prev.filter((existing) => existing.input.trim().toLowerCase() !== key),
    ]);
  }

  function shiftUnresolvedHead() {
    setUnresolvedQueue((prev) => prev.slice(1));
  }

  function clearInlineUnrecognizedWarning() {
    setUnresolvedQueue((prev) =>
      prev.filter(
        (item) => !(item.candidates.length === 0 && item.clearOnQueryEdit),
      ),
    );
  }

  const canSubmit =
    !pending &&
    !isValidating &&
    !loadError &&
    (none || entries.length > 0);

  const selectedItems = useMemo<MultiSelectSelectedItem[]>(
    () =>
      entries.map((entry) => ({
        id: entry.key,
        label: entry.label,
        tone: 'default',
      })),
    [entries],
  );

  const availableSuggestions = suggestedSkills.filter(
    (s) =>
      s.trim().length > 0 &&
      !entries.some((e) => e.key === s.trim().toLowerCase()),
  );

  async function validateCustomSkill(
    rawLabel: string,
    requestId: number,
    session: number,
  ) {
    let result: Awaited<ReturnType<typeof invoke<'interpretSkillAlias'>>>;
    try {
      result = await invoke('interpretSkillAlias', {
        input: rawLabel,
        skill_id: '',
      });
    } catch (err) {
      inFlightLookupIdsRef.current.delete(requestId);
      if (inFlightLookupIdsRef.current.size === 0) {
        setIsValidating(false);
      }
      if (noneRef.current || lookupSessionRef.current !== session) {
        return;
      }
      setApiError(mapApiError(err));
      return;
    }

    inFlightLookupIdsRef.current.delete(requestId);
    if (inFlightLookupIdsRef.current.size === 0) {
      setIsValidating(false);
    }

    if (noneRef.current || lookupSessionRef.current !== session) {
      return;
    }

    if (!result.ok) {
      setApiError(result.error);
      return;
    }

    const data =
      result.data && typeof result.data === 'object'
        ? (result.data as unknown as Record<string, unknown>)
        : null;

    if (data) {
      // 1. Auto-resolved canonical match
      const directCanonical =
        typeof data.canonical_name === 'string' && data.canonical_name.trim()
          ? data.canonical_name.trim()
          : typeof data.name === 'string' && data.name.trim()
            ? data.name.trim()
            : data.resolved_skill &&
                typeof (data.resolved_skill as { name?: unknown }).name ===
                  'string' &&
                ((data.resolved_skill as { name: string }).name.trim() || '')
              ? (data.resolved_skill as { name: string }).name.trim()
              : null;

      if (directCanonical) {
        clearInlineUnrecognizedWarning();
        appendValidSkill(directCanonical);
        return;
      }

      if (
        data.added_to_profile === true &&
        typeof data.skill_id === 'string' &&
        data.skill_id.trim()
      ) {
        const matchedOpt = catalogOptions.find((o) => o.id === data.skill_id);
        clearInlineUnrecognizedWarning();
        appendValidSkill(matchedOpt ? matchedOpt.label.trim() : rawLabel);
        return;
      }

      // 2. Ambiguous match (candidate suggestions)
      if (Array.isArray(data.candidates)) {
        const candidates = (
          data.candidates as UnresolvedSkillCandidateDTO[]
        ).filter(
          (c) =>
            c &&
            typeof c.skill_id === 'string' &&
            typeof c.name === 'string' &&
            c.name.trim().length > 0,
        );
        enqueueUnresolvedHead({
          input: rawLabel,
          candidates,
          clearOnQueryEdit: candidates.length === 0,
        });
        return;
      }

      // 3. Profile-shaped response with unresolved_skills
      if (Array.isArray(data.unresolved_skills)) {
        const normalized = normalizeUnresolvedQueue(
          data.unresolved_skills as UnresolvedSkillDTO[],
        );
        if (normalized.length > 0) {
          setUnresolvedQueue((prev) => {
            const incomingKeys = new Set(
              normalized.map((item) => item.input.toLowerCase()),
            );
            return [
              ...normalized,
              ...prev.filter(
                (existing) => !incomingKeys.has(existing.input.toLowerCase()),
              ),
            ];
          });
          return;
        }
      }
    }

    // Fallback after a successful no-match response: check substring candidates in catalogOptions; otherwise show unrecognized warning
    const fallbackCandidates = findCatalogSubstringCandidates(
      rawLabel,
      catalogOptions,
    );
    enqueueUnresolvedHead({
      input: rawLabel,
      candidates: fallbackCandidates,
      clearOnQueryEdit: fallbackCandidates.length === 0,
    });
  }

  function addCatalogSkill(option: MultiSelectOption): boolean {
    const trimmedLabel = option.label.trim();
    const existingLabels = entriesRef.current.map((e) => e.label);
    const error = validateNewSkill(trimmedLabel, existingLabels);
    if (error) {
      setDraftError(error);
      return false;
    }
    setDraftError(null);
    clearInlineUnrecognizedWarning();
    setNotice(null);
    setApiError(null);
    noneRef.current = false;
    setNone(false);
    commitEntries([
      ...entriesRef.current,
      {
        key: trimmedLabel.toLowerCase(),
        label: trimmedLabel,
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

    const requestId = ++nextLookupIdRef.current;
    const session = lookupSessionRef.current;
    inFlightLookupIdsRef.current.add(requestId);

    setDraftError(null);
    clearInlineUnrecognizedWarning();
    setNotice(null);
    setApiError(null);
    noneRef.current = false;
    setNone(false);
    setIsValidating(true);

    void validateCustomSkill(trimmed, requestId, session);
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

  function changeNone(next: boolean) {
    saveRequestTokenRef.current += 1;
    lookupSessionRef.current += 1;
    inFlightLookupIdsRef.current.clear();
    setIsValidating(false);
    noneRef.current = next;
    setNone(next);
    setDraftError(null);
    setUnresolvedQueue([]);
    setNotice(null);
    setApiError(null);
    if (next) {
      commitEntries([]); // None clears pills and creates no artificial skills (R07)
    }
  }

  async function resolveAlias(
    inputLabel: string,
    skillId: string,
    candidateName: string,
  ) {
    const candidateKey = candidateName.trim().toLowerCase();
    if (
      !entriesRef.current.some((e) => e.key === candidateKey) &&
      entriesRef.current.length >= MAX_SKILLS
    ) {
      setDraftError(
        `You can add up to ${MAX_SKILLS} skills. Remove a skill before adding another.`,
      );
      return;
    }

    setPending(true);
    setApiError(null);
    setDraftError(null);
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
    if (!appendValidSkill(candidateName)) {
      return;
    }
    const resolvedKey = inputLabel.trim().toLowerCase();
    setUnresolvedQueue((prev) =>
      prev.filter((item) => item.input.trim().toLowerCase() !== resolvedKey),
    );
    setNotice(`Saved your meaning for “${inputLabel}”.`);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setPending(true);
    setApiError(null);
    const requestToken = ++saveRequestTokenRef.current;
    const namesToSave = entries.map((e) => e.label);
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
    const pendingAliases = normalizeUnresolvedQueue(
      result.data.unresolved_skills,
    );
    if (pendingAliases.length > 0) {
      commitEntries(hydrateValidEntries(result.data.existing_skills));
      setUnresolvedQueue(pendingAliases);
      noneRef.current = false;
      setNone(false);
      onProfileCommitted?.(result.data);
      setPending(false);
      return;
    }
    if (onSuccess) {
      setPending(false);
      onSuccess(result.data);
      return;
    }
    if (isStandalone) {
      commitEntries(hydrateValidEntries(result.data.existing_skills));
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
        inModal={isStandalone || inModal}
        heading={isStandalone || inModal ? undefined : 'Your Skills'}
        description={
          isStandalone || inModal
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
                onQueryChange={(q) => {
                  setDraftError(null);
                  if (q.trim().length > 0) {
                    clearInlineUnrecognizedWarning();
                  }
                }}
                placeholder="Search or type a skill (e.g., React, SQL, Python)"
                secondaryPlaceholder="Add another skill..."
                disabled={pending}
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

              {unrecognizedSkill && (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center justify-between gap-2 rounded-lg border border-feedback-warning-border bg-feedback-warning-background px-3 py-2 text-caption font-medium leading-snug text-feedback-warning-text"
                >
                  <span className="flex items-center gap-2">
                    <WarningIcon className="h-4 w-4 shrink-0 text-amber-600" />
                    <span dir="auto">
                      “{unrecognizedSkill}” is not a recognized skill.
                    </span>
                  </span>
                  {unresolvedQueue.length > 1 && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={shiftUnresolvedHead}
                      className="cursor-pointer rounded-md px-2 py-0.5 text-caption font-medium text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              )}

              {ambiguousPrompt && (
                <section
                  aria-label="Skill clarification"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-feedback-warning-border bg-feedback-warning-background px-3.5 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption font-medium text-feedback-warning-text">
                      For “{ambiguousPrompt.input}”:
                    </span>
                    {ambiguousPrompt.candidates.map((candidate) => (
                      <button
                        key={candidate.skill_id}
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          resolveAlias(
                            ambiguousPrompt.input,
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
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={shiftUnresolvedHead}
                    className="cursor-pointer rounded-md px-2 py-1 text-caption font-medium text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary"
                  >
                    Dismiss
                  </button>
                </section>
              )}
            </div>

            {availableSuggestions.length > 0 && (
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

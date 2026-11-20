'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type {
  CareerGoalResponse,
  CareerLevel,
  ProfileResponse,
} from '@/lib/api/client';
import {
  mapApiError,
  type ActionResult,
  type M05Invoke,
  type MappedError,
} from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { CheckIcon, ChevronDownIcon } from '@/components/ui/icons';
import { FieldShell, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toneToAlertVariant } from '@/components/ui/multi-step-form-wrapper';
import { validateDailyHours } from '@/lib/validation/profile-schemas';
import { StepFrame } from './step-shell';

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

export const TARGET_LEVEL_OPTIONS: ReadonlyArray<{
  value: CareerLevel;
  label: string;
}> = [
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
];

export const GOAL_DRAFT_STORAGE_KEY = 'mentor_onboarding_goal_draft';
export const PENDING_GOAL_LEVELS_STORAGE_KEY = 'mentor_pending_goal_levels';

export type GoalDraftScope = 'onboarding' | 'inline';

const VALID_CAREER_LEVELS: ReadonlySet<string> = new Set([
  'junior',
  'mid',
  'senior',
]);

export interface GoalDraft {
  goal: string;
  dailyHours: string;
  targetLevel: CareerLevel | '';
  targetLevelExplicit?: boolean;
  goalId?: string | null;
}

const goalDraftListeners = new Set<() => void>();
const fallbackGoalDraftMap = new Map<string, string>();
const fallbackAuthoritativeKeys = new Set<string>();
const fallbackPendingLevelsMap = new Map<string, Record<string, CareerLevel>>();
const fallbackPendingLevelsAuthoritative = new Set<string>();

const TERMINAL_UPDATE_FALLBACK_CODES: ReadonlySet<string> = new Set([
  'GOAL_ALREADY_CONFIRMED',
  'INVALID_STATE_TRANSITION',
]);

function getGoalDraftStorageKey(
  userId?: string,
  scope: GoalDraftScope = 'onboarding',
): string {
  if (scope === 'inline') {
    return userId
      ? `${GOAL_DRAFT_STORAGE_KEY}:inline:${userId}`
      : `${GOAL_DRAFT_STORAGE_KEY}:inline`;
  }
  return userId ? `${GOAL_DRAFT_STORAGE_KEY}:${userId}` : GOAL_DRAFT_STORAGE_KEY;
}

function getPendingLevelsStorageKey(userId?: string): string {
  return userId
    ? `${PENDING_GOAL_LEVELS_STORAGE_KEY}:${userId}`
    : PENDING_GOAL_LEVELS_STORAGE_KEY;
}

function notifyGoalDraftListeners(): void {
  goalDraftListeners.forEach((listener) => listener());
}

export function subscribeGoalDraft(listener: () => void): () => void {
  goalDraftListeners.add(listener);
  return () => {
    goalDraftListeners.delete(listener);
  };
}

export function readGoalDraftRaw(
  userId?: string,
  scope: GoalDraftScope = 'onboarding',
): string | null {
  if (typeof window === 'undefined') return null;
  const key = getGoalDraftStorageKey(userId, scope);
  if (fallbackAuthoritativeKeys.has(key)) {
    return fallbackGoalDraftMap.get(key) ?? null;
  }
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return fallbackGoalDraftMap.get(key) ?? null;
  }
}

export function parseGoalDraft(raw: string | null): GoalDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GoalDraft> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const goal = typeof parsed.goal === 'string' ? parsed.goal : '';
    const dailyHours =
      typeof parsed.dailyHours === 'string' ? parsed.dailyHours : '';
    const targetLevel =
      typeof parsed.targetLevel === 'string' &&
      VALID_CAREER_LEVELS.has(parsed.targetLevel)
        ? (parsed.targetLevel as CareerLevel)
        : '';
    const targetLevelExplicit =
      typeof parsed.targetLevelExplicit === 'boolean'
        ? parsed.targetLevelExplicit
        : undefined;
    const goalId =
      typeof parsed.goalId === 'string' && parsed.goalId.trim().length > 0
        ? parsed.goalId.trim()
        : null;
    return {
      goal,
      dailyHours,
      targetLevel,
      ...(targetLevelExplicit !== undefined ? { targetLevelExplicit } : {}),
      goalId,
    };
  } catch {
    return null;
  }
}

export function readGoalDraft(
  userId?: string,
  scope: GoalDraftScope = 'onboarding',
): GoalDraft | null {
  return parseGoalDraft(readGoalDraftRaw(userId, scope));
}

export function writeGoalDraft(
  draft: GoalDraft,
  userId?: string,
  scope: GoalDraftScope = 'onboarding',
): void {
  if (typeof window === 'undefined') return;
  const key = getGoalDraftStorageKey(userId, scope);
  const serialized = JSON.stringify(draft);
  fallbackGoalDraftMap.set(key, serialized);
  try {
    window.sessionStorage.setItem(key, serialized);
    fallbackAuthoritativeKeys.delete(key);
  } catch {
    // Storage quota exceeded or blocked: mark in-memory snapshot authoritative over stale sessionStorage.
    fallbackAuthoritativeKeys.add(key);
  }
  notifyGoalDraftListeners();
}

export function clearGoalDraft(
  userId?: string,
  scope: GoalDraftScope = 'onboarding',
): void {
  const key = getGoalDraftStorageKey(userId, scope);
  fallbackGoalDraftMap.delete(key);
  if (scope === 'onboarding' && userId) {
    fallbackGoalDraftMap.delete(GOAL_DRAFT_STORAGE_KEY);
  }
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(key);
      fallbackAuthoritativeKeys.delete(key);
    } catch {
      // Removal failed: retain authoritative empty marker in memory so stale sessionStorage cannot resurrect the draft.
      fallbackAuthoritativeKeys.add(key);
    }
    if (scope === 'onboarding' && userId) {
      try {
        window.sessionStorage.removeItem(GOAL_DRAFT_STORAGE_KEY);
        fallbackAuthoritativeKeys.delete(GOAL_DRAFT_STORAGE_KEY);
      } catch {
        fallbackAuthoritativeKeys.add(GOAL_DRAFT_STORAGE_KEY);
      }
    }
  } else {
    fallbackAuthoritativeKeys.delete(key);
    if (scope === 'onboarding' && userId) {
      fallbackAuthoritativeKeys.delete(GOAL_DRAFT_STORAGE_KEY);
    }
  }
  notifyGoalDraftListeners();
}

function parsePendingLevels(raw: string | null): Record<string, CareerLevel> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return {};
    const result: Record<string, CareerLevel> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && VALID_CAREER_LEVELS.has(v)) {
        result[k] = v as CareerLevel;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function readPendingGoalTargetLevels(
  userId?: string,
): Record<string, CareerLevel> {
  if (typeof window === 'undefined') return {};
  const key = getPendingLevelsStorageKey(userId);
  if (fallbackPendingLevelsAuthoritative.has(key)) {
    return { ...(fallbackPendingLevelsMap.get(key) ?? {}) };
  }
  try {
    return parsePendingLevels(window.sessionStorage.getItem(key));
  } catch {
    return { ...(fallbackPendingLevelsMap.get(key) ?? {}) };
  }
}

export function writePendingGoalTargetLevel(
  goalId: string,
  level: CareerLevel,
  userId?: string,
): void {
  if (typeof window === 'undefined' || !goalId) return;
  const key = getPendingLevelsStorageKey(userId);
  const next = { ...readPendingGoalTargetLevels(userId), [goalId]: level };
  fallbackPendingLevelsMap.set(key, next);
  try {
    window.sessionStorage.setItem(key, JSON.stringify(next));
    fallbackPendingLevelsAuthoritative.delete(key);
  } catch {
    fallbackPendingLevelsAuthoritative.add(key);
  }
  notifyGoalDraftListeners();
}

export function clearPendingGoalTargetLevel(
  goalId: string,
  userId?: string,
): void {
  if (typeof window === 'undefined' || !goalId) return;
  const key = getPendingLevelsStorageKey(userId);
  const current = readPendingGoalTargetLevels(userId);
  if (!(goalId in current)) return;
  const next = { ...current };
  delete next[goalId];
  fallbackPendingLevelsMap.set(key, next);
  try {
    if (Object.keys(next).length === 0) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, JSON.stringify(next));
    }
    fallbackPendingLevelsAuthoritative.delete(key);
  } catch {
    fallbackPendingLevelsAuthoritative.add(key);
  }
  notifyGoalDraftListeners();
}

export interface GoalSetupFormProps {
  invoke: M05Invoke;
  /** Authenticated user ID for account-scoped draft isolation. */
  userId?: string;
  /** Draft storage scope isolating onboarding Step 4 drafts from inline Career Profile add drafts. */
  draftScope?: GoalDraftScope;
  initialGoalText?: string;
  initialDailyHours?: number | null;
  initialTargetLevel?: CareerLevel | null;
  /** Whether `initialTargetLevel` came from an explicit user choice (`'explicit'`) or an AI suggestion (`'suggested'`). */
  initialTargetLevelSource?: 'explicit' | 'suggested';
  /**
   * Active unconfirmed goal ID (if resuming or returning via Back to goal).
   * When present, Step 4 calls EP-C06 (`updateCareerGoal`) instead of creating a duplicate goal,
   * falling back to EP-C01 (`createCareerGoal`) only on HTTP 404 or terminal 409.
   */
  activeDraftGoalId?: string | null;
  /** Optional server-side load error (e.g., failed EP-C02 fetch); disables submission to avoid duplicate goal creation. */
  loadError?: string | null;
  /** Notifies an outer wizard container whenever submission enters or exits pending state. */
  onPendingChange?: (pending: boolean) => void;
  /** Optional ownership guard preventing a superseded inline add session from overwriting the shared inline draft. */
  shouldPersistDraft?: () => boolean;
  /** Fired immediately after EP-P04 saves daily study hours, even if subsequent goal analysis fails. */
  onLearningSettingsSaved?: (profile: ProfileResponse) => void;
  /** Optional callback fired on successful goal analysis instead of router navigation. */
  onSuccess?: (payload: {
    goal: CareerGoalResponse;
    targetLevel: CareerLevel;
    targetLevelExplicit: boolean;
    profile: ProfileResponse;
  }) => void;
  /** Optional Back handler when embedded inside a wizard or inline view. */
  onBack?: () => void;
  /** When true, omits the standalone stepper header so an outer shell owns stepper chrome. */
  embedded?: boolean;
}

/**
 * Screen 10 (`/onboarding`, Step 4 of 5).
 * Persists `preferred_daily_hours` via EP-P04, submits/updates `goal_text` via EP-C01/EP-C06,
 * and either hands the result to `onSuccess` or routes to `/onboarding`.
 */
export function GoalSetupForm({
  invoke,
  userId,
  draftScope = 'onboarding',
  initialGoalText = '',
  initialDailyHours = null,
  initialTargetLevel = null,
  initialTargetLevelSource = 'explicit',
  activeDraftGoalId = null,
  loadError = null,
  onPendingChange,
  shouldPersistDraft,
  onLearningSettingsSaved,
  onSuccess,
  onBack,
  embedded = false,
}: GoalSetupFormProps) {
  const router = useRouter();
  const fieldId = useId();
  const goalInputId = `${fieldId}-goal`;
  const listboxId = `${fieldId}-goal-listbox`;
  const comboboxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const rawDraft = useSyncExternalStore(
    subscribeGoalDraft,
    () => readGoalDraftRaw(userId, draftScope),
    () => null,
  );
  const parsedDraft = parseGoalDraft(rawDraft);
  // Prevent cross-goal draft prefill: ignore a stored draft belonging to a different goal ID.
  const draft =
    parsedDraft &&
    (!activeDraftGoalId ||
      !parsedDraft.goalId ||
      parsedDraft.goalId === activeDraftGoalId)
      ? parsedDraft
      : null;
  const initialHoursStr =
    initialDailyHours !== null && initialDailyHours !== undefined
      ? String(initialDailyHours)
      : '';
  const text = draft ? draft.goal : initialGoalText;
  const dailyHours = draft ? draft.dailyHours : initialHoursStr;
  const targetLevel: CareerLevel | '' =
    draft && draft.targetLevelExplicit !== false
      ? draft.targetLevel
      : (initialTargetLevel ?? draft?.targetLevel ?? '');
  const [levelExplicitlyChosen, setLevelExplicitlyChosen] = useState(false);
  const isTargetLevelExplicit: boolean =
    levelExplicitlyChosen ||
    (draft
      ? draft.targetLevelExplicit ??
        (draft.targetLevel !== '' && initialTargetLevelSource === 'explicit')
      : initialTargetLevel !== null && initialTargetLevelSource === 'explicit');

  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [hoursTouched, setHoursTouched] = useState(false);
  const [levelTouched, setLevelTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [apiError, setApiError] = useState<MappedError | null>(null);

  useEffect(() => {
    onPendingChange?.(pending);
    return () => {
      onPendingChange?.(false);
    };
  }, [pending, onPendingChange]);

  const trimmedText = text.trim();
  const validation =
    trimmedText.length === 0
      ? 'Select a role'
      : validateBoundedText(text, GOAL_TEXT_MIN, GOAL_TEXT_MAX, 'Goal');
  const showValidation = touched && validation !== null;
  const hoursCheck = validateDailyHours(dailyHours);
  const showHoursValidation = hoursTouched && !hoursCheck.ok;
  const showLevelValidation = levelTouched && targetLevel === '';
  const canSubmit =
    !loadError &&
    trimmedText.length > 0 &&
    hoursCheck.ok &&
    targetLevel !== '' &&
    !pending;

  const query = trimmedText.toLowerCase();
  const isExactPreset = EXAMPLE_GOAL_ROLES.some((role) => role.toLowerCase() === query);
  const filteredRoles =
    query === '' || isExactPreset
      ? [...EXAMPLE_GOAL_ROLES]
      : EXAMPLE_GOAL_ROLES.filter((role) => role.toLowerCase().includes(query));
  const showListbox = open && !pending && filteredRoles.length > 0;

  useEffect(() => {
    if (!open) return;
    function handleOutsideMouseDown(event: MouseEvent) {
      if (comboboxRef.current && !comboboxRef.current.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleOutsideMouseDown);
    return () => document.removeEventListener('mousedown', handleOutsideMouseDown);
  }, [open]);

  const draftGoalId =
    activeDraftGoalId ??
    (draftScope === 'onboarding' ? (draft?.goalId ?? null) : null);

  function selectRole(role: string) {
    setTouched(false);
    setOpen(false);
    setActiveIndex(-1);
    writeGoalDraft(
      {
        goal: role,
        dailyHours,
        targetLevel,
        targetLevelExplicit: isTargetLevelExplicit,
        goalId: draftGoalId,
      },
      userId,
      draftScope,
    );
    if (apiError && apiError.code !== 'ROADMAP_LIMIT_REACHED') {
      setApiError(null);
    }
  }

  function handleGoalKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (pending) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(filteredRoles.length > 0 ? 0 : -1);
      } else if (filteredRoles.length > 0) {
        setActiveIndex((prev) => (prev + 1) % filteredRoles.length);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(filteredRoles.length > 0 ? filteredRoles.length - 1 : -1);
      } else if (filteredRoles.length > 0) {
        setActiveIndex((prev) => (prev <= 0 ? filteredRoles.length - 1 : prev - 1));
      }
    } else if (event.key === 'Enter') {
      if (showListbox && activeIndex >= 0 && activeIndex < filteredRoles.length) {
        event.preventDefault();
        selectRole(filteredRoles[activeIndex]);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    } else if (event.key === 'Tab') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOpen(false);
    setActiveIndex(-1);
    setTouched(true);
    setHoursTouched(true);
    setLevelTouched(true);
    if (loadError || validation !== null || !hoursCheck.ok || targetLevel === '' || pending) return;
    setPending(true);
    setApiError(null);
    writeGoalDraft(
      {
        goal: trimmedText,
        dailyHours,
        targetLevel,
        targetLevelExplicit: isTargetLevelExplicit,
        goalId: draftGoalId,
      },
      userId,
      draftScope,
    );
    try {
      const hoursResult = await invoke('updateLearningSettings', {
        preferred_daily_hours: hoursCheck.value,
      });
      if (!hoursResult.ok) {
        setPending(false);
        setApiError(hoursResult.error);
        return;
      }
      onLearningSettingsSaved?.(hoursResult.data);

      let result: ActionResult<CareerGoalResponse>;
      if (draftGoalId) {
        const updateResult = await invoke('updateCareerGoal', {
          id: draftGoalId,
          body: { goal_text: trimmedText },
        });
        if (
          !updateResult.ok &&
          (updateResult.error.status === 404 ||
            (updateResult.error.status === 409 &&
              updateResult.error.code !== undefined &&
              TERMINAL_UPDATE_FALLBACK_CODES.has(updateResult.error.code)))
        ) {
          result = await invoke('createCareerGoal', { goal_text: trimmedText });
        } else {
          result = updateResult;
        }
      } else {
        result = await invoke('createCareerGoal', { goal_text: trimmedText });
      }

      if (!result.ok) {
        setPending(false);
        setApiError(result.error); // input text, daily hours & target level are preserved for retry
        return;
      }
      if (isTargetLevelExplicit) {
        writePendingGoalTargetLevel(result.data.id, targetLevel, userId);
      }
      if (!shouldPersistDraft || shouldPersistDraft()) {
        writeGoalDraft(
          {
            goal: trimmedText,
            dailyHours,
            targetLevel,
            targetLevelExplicit: isTargetLevelExplicit,
            goalId: result.data.id,
          },
          userId,
          draftScope,
        );
      }
      if (onSuccess) {
        setPending(false);
        onSuccess({
          goal: result.data,
          targetLevel,
          targetLevelExplicit: isTargetLevelExplicit,
          profile: hoursResult.data,
        });
        return;
      }
      if (
        typeof window !== 'undefined' &&
        window.location.pathname === '/onboarding'
      ) {
        setPending(false);
      }
      router.push('/onboarding');
    } catch (err) {
      setPending(false);
      setApiError(mapApiError(err));
    }
  }

  const outOfScope = apiError?.code === 'OUT_OF_SCOPE_GOAL';
  const limitReached = apiError?.code === 'ROADMAP_LIMIT_REACHED';

  const backControl = onBack ? (
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
    <form onSubmit={submit} noValidate>
      <StepFrame
        currentStep={4}
        embedded={embedded}
        heading="What is your career goal?"
        description="Choose or describe the technology role you want to work toward."
        status="editing"
        errorMessage={loadError}
        actions={
          <>
            {backControl}
            <Button
              type="submit"
              size="lg"
              isLoading={pending}
              disabled={!canSubmit}
              loadingText="Analyzing your goal..."
              className="min-w-[210px]"
            >
              Analyze Goal
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="w-full">
            <FieldShell
              id={goalInputId}
              label="Career goal"
              required
              error={showValidation ? (validation ?? undefined) : undefined}
            >
              <div ref={comboboxRef} className="relative">
                <input
                  ref={inputRef}
                  id={goalInputId}
                  name="goal_text"
                  type="text"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={showListbox}
                  aria-controls={showListbox ? listboxId : undefined}
                  aria-activedescendant={
                    showListbox && activeIndex >= 0
                      ? `${listboxId}-opt-${activeIndex}`
                      : undefined
                  }
                  aria-invalid={showValidation ? 'true' : undefined}
                  aria-describedby={showValidation ? `${goalInputId}-error` : undefined}
                  autoComplete="off"
                  dir="auto"
                  required
                  readOnly={pending}
                  value={text}
                  placeholder="Select or type a role"
                  onFocus={() => {
                    if (!pending) setOpen(true);
                  }}
                  onClick={() => {
                    if (!pending) setOpen(true);
                  }}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setOpen(true);
                    setActiveIndex(-1);
                    writeGoalDraft(
                      {
                        goal: nextValue,
                        dailyHours,
                        targetLevel,
                        targetLevelExplicit: isTargetLevelExplicit,
                        goalId: draftGoalId,
                      },
                      userId,
                      draftScope,
                    );
                    if (apiError && apiError.code !== 'ROADMAP_LIMIT_REACHED') {
                      setApiError(null);
                    }
                  }}
                  onKeyDown={handleGoalKeyDown}
                  onBlur={(e) => {
                    setTouched(true);
                    if (!comboboxRef.current?.contains(e.relatedTarget as Node | null)) {
                      setOpen(false);
                      setActiveIndex(-1);
                    }
                  }}
                  className={cn(
                    'min-h-11 w-full rounded-md border bg-surface-default py-2 pl-3 pr-10 text-body text-text-primary placeholder:font-light placeholder:text-slate-500 dark:placeholder:text-slate-400',
                    'transition-colors duration-(--duration-fast) ease-standard',
                    'focus:outline-none focus:ring-2 read-only:bg-surface-subtle',
                    showValidation
                      ? 'border-2 border-border-danger focus:ring-border-danger'
                      : 'border-border-default hover:border-border-strong focus:border-border-focus focus:ring-focus-ring',
                  )}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={pending}
                  aria-label="Toggle role suggestions"
                  aria-expanded={showListbox}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (pending) return;
                    setOpen((prev) => !prev);
                    setActiveIndex(-1);
                    inputRef.current?.focus();
                  }}
                  className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center text-text-muted transition-colors duration-(--duration-fast) hover:text-text-primary disabled:cursor-not-allowed disabled:text-text-disabled"
                >
                  <ChevronDownIcon
                    className={cn(
                      'h-4 w-4 transition-transform duration-(--duration-fast) ease-standard motion-reduce:transition-none',
                      showListbox && 'rotate-180',
                    )}
                  />
                </button>

                {showListbox && (
                  <ul
                    id={listboxId}
                    role="listbox"
                    aria-label="Suggested technology roles"
                    className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-border-default bg-surface-default py-1 shadow-md [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.6)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-400/50 hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/80 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600/70"
                  >
                    {filteredRoles.map((role, index) => {
                      const isSelected = role.toLowerCase() === query;
                      const isActive = index === activeIndex;
                      return (
                        <li
                          key={role}
                          id={`${listboxId}-opt-${index}`}
                          role="option"
                          aria-selected={isSelected}
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => selectRole(role)}
                          className={cn(
                            'flex min-h-10 cursor-pointer items-center justify-between px-3 py-2 text-body-sm text-text-primary transition-colors duration-(--duration-fast)',
                            isActive || isSelected
                              ? 'bg-surface-subtle font-medium text-text-brand'
                              : 'hover:bg-surface-subtle',
                          )}
                        >
                          <span>{role}</span>
                          {isSelected && (
                            <CheckIcon className="h-4 w-4 shrink-0 text-text-brand" />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </FieldShell>
          </div>

          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
            <Input
              id="preferred_daily_hours"
              name="preferred_daily_hours"
              variant="number"
              label="Preferred Daily Hours"
              required
              min={0.5}
              max={12}
              step={0.5}
              readOnly={pending}
              value={dailyHours}
              error={showHoursValidation && !hoursCheck.ok ? hoursCheck.error : undefined}
              placeholder="2"
              onChange={(e) => {
                const nextHours = e.target.value;
                writeGoalDraft(
                  {
                    goal: text,
                    dailyHours: nextHours,
                    targetLevel,
                    targetLevelExplicit: isTargetLevelExplicit,
                    goalId: draftGoalId,
                  },
                  userId,
                  draftScope,
                );
                if (apiError && apiError.code !== 'ROADMAP_LIMIT_REACHED') {
                  setApiError(null);
                }
              }}
              onBlur={() => setHoursTouched(true)}
            />

            <Select
              id="target_career_level"
              name="target_career_level"
              label="Target career level"
              required
              disabled={pending}
              value={targetLevel}
              placeholder="Select level"
              options={TARGET_LEVEL_OPTIONS}
              error={showLevelValidation ? 'Select your target career level.' : undefined}
              onChange={(e) => {
                const nextLevel = e.target.value as CareerLevel | '';
                setLevelExplicitlyChosen(nextLevel !== '');
                writeGoalDraft(
                  {
                    goal: text,
                    dailyHours,
                    targetLevel: nextLevel,
                    targetLevelExplicit: nextLevel !== '',
                    goalId: draftGoalId,
                  },
                  userId,
                  draftScope,
                );
                if (apiError && apiError.code !== 'ROADMAP_LIMIT_REACHED') {
                  setApiError(null);
                }
              }}
              onBlur={() => setLevelTouched(true)}
            />
          </div>
        </div>

        <span role="status" aria-live="polite" className="sr-only">
          {pending ? 'Analyzing your goal. This usually takes a few seconds.' : ''}
        </span>

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
      </StepFrame>
    </form>
  );
}

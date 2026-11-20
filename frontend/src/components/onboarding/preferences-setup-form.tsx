'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { LearningPreference, ProfileResponse } from '@/lib/api/client';
import {
  mapApiError,
  type M05Invoke,
  type MappedError,
} from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CareerCard, CareerCardGroup } from '@/components/ui/career-card';
import { toneToAlertVariant } from '@/components/ui/multi-step-form-wrapper';
import { Toast } from '@/components/ui/toast';
import { StepFrame } from './step-shell';

export const LEARNING_PREFERENCE_OPTIONS: ReadonlyArray<{
  value: LearningPreference;
  title: string;
  description: string;
}> = [
  {
    value: 'reading',
    title: 'Reading',
    description: 'Learn from docs, articles and written explanations.',
  },
  {
    value: 'hands_on',
    title: 'Hands-on',
    description: 'Learn by building, experimenting and practicing.',
  },
  {
    value: 'visual',
    title: 'Visual',
    description: 'Learn from diagrams, walkthroughs and visual material.',
  },
  {
    value: 'mixed',
    title: 'Mixed',
    description: 'A balanced blend of reading, practice and visuals.',
  },
];

export interface PreferencesSetupFormProps {
  initialProfile: ProfileResponse | null;
  loadError?: string | null;
  invoke: M05Invoke;
  /** Rendering mode: `'wizard'` (onboarding step) or `'standalone'` (inline editing on `/career-profile`). */
  mode?: 'wizard' | 'standalone';
  /** Notifies an outer wizard container whenever submission enters or exits pending state. */
  onPendingChange?: (pending: boolean) => void;
  /** Optional callback invoked on successful save instead of router navigation. */
  onSuccess?: (profile: ProfileResponse) => void;
  /** Optional callback for the Back action when embedded in a wizard or inline view. */
  onBack?: () => void;
  /** Optional Cancel handler when used in `mode="standalone"`. */
  onCancel?: () => void;
  /** When true, omits the standalone stepper header so an outer shell owns stepper chrome. */
  embedded?: boolean;
}

/**
 * Screen 09 (`/onboarding`, Step 3 of 5) or standalone inline editor on `/career-profile`.
 * Saves the learning preference via EP-P03.
 */
export function PreferencesSetupForm({
  initialProfile,
  loadError,
  invoke,
  mode = 'wizard',
  onPendingChange,
  onSuccess,
  onBack,
  onCancel,
  embedded = false,
}: PreferencesSetupFormProps) {
  const isStandalone = mode === 'standalone';
  const isEmbedded = embedded || isStandalone;
  const router = useRouter();
  const [selected, setSelected] = useState<LearningPreference | null>(
    () => initialProfile?.learning_preference ?? null,
  );
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [apiError, setApiError] = useState<MappedError | null>(null);

  useEffect(() => {
    onPendingChange?.(pending);
    return () => {
      onPendingChange?.(false);
    };
  }, [pending, onPendingChange]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || pending) return;
    setPending(true);
    setApiError(null);
    let result: Awaited<ReturnType<typeof invoke<'updatePreferences'>>>;
    try {
      result = await invoke('updatePreferences', {
        learning_preference: selected,
      });
    } catch (err) {
      setPending(false);
      setApiError(mapApiError(err));
      return;
    }
    if (!result.ok) {
      setPending(false);
      setApiError(result.error);
      return;
    }
    if (onSuccess) {
      setPending(false);
      onSuccess(result.data);
      return;
    }
    if (isStandalone) {
      setPending(false);
      setSuccessToast('Learning preferences updated.');
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
        currentStep={3}
        embedded={isEmbedded}
        heading={isStandalone ? undefined : 'How do you like to learn?'}
        description={
          isStandalone
            ? undefined
            : 'Pick the style that fits you best. You can change it later.'
        }
        status="editing"
        errorMessage={loadError ?? null}
        actions={
          <>
            {backControl}
            <Button
              type="submit"
              size={isStandalone ? 'md' : 'lg'}
              disabled={!selected || pending}
              isLoading={pending}
              loadingText="Saving..."
              className={isStandalone ? 'min-w-[160px]' : 'min-w-[160px]'}
            >
              {isStandalone ? 'Save Preferences' : 'Save & Next'}
            </Button>
          </>
        }
      >
        <CareerCardGroup
          label="Learning preference"
          className="grid grid-cols-1 gap-3 lg:grid-cols-2"
        >
          {LEARNING_PREFERENCE_OPTIONS.map((option) => (
            <CareerCard
              key={option.value}
              title={option.title}
              rationale={option.description}
              selected={selected === option.value}
              disabled={pending}
              onSelect={() => setSelected(option.value)}
            />
          ))}
        </CareerCardGroup>

        {!selected && (
          <p className="text-body-sm text-text-secondary">
            Choose one option to continue.
          </p>
        )}

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

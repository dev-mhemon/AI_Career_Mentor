'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { LearningPreference, ProfileResponse } from '@/lib/api/client';
import type { M05Invoke, MappedError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CareerCard, CareerCardGroup } from '@/components/ui/career-card';
import {
  MultiStepFormWrapper,
  toneToAlertVariant,
} from '@/components/ui/multi-step-form-wrapper';
import { ToggleSwitch } from '@/components/ui/toggle-switch';

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
}

/**
 * Screen 09 (`/onboarding/preferences`, Step 3 of 5). Saves the learning preference via EP-P03.
 * Daily hours and timezone are collected on Screen 07 (EP-P04).
 */
export function PreferencesSetupForm({
  initialProfile,
  loadError,
  invoke,
}: PreferencesSetupFormProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<LearningPreference | null>(
    () => initialProfile?.learning_preference ?? null,
  );
  const [practiceReminders, setPracticeReminders] = useState<boolean>(true);
  const [pending, setPending] = useState(false);
  const [apiError, setApiError] = useState<MappedError | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || pending) return;
    setPending(true);
    setApiError(null);
    const result = await invoke('updatePreferences', {
      learning_preference: selected,
    });
    setPending(false);
    if (!result.ok) {
      setApiError(result.error);
      return;
    }
    router.push('/onboarding/goal');
  }

  return (
    <form onSubmit={save} noValidate>
      <MultiStepFormWrapper
        currentStep={3}
        heading="How do you like to learn?"
        description="Pick the style that fits you best. You can change it later."
        status={pending ? 'submitting' : 'editing'}
        errorMessage={loadError ?? null}
        actions={
          <>
            <Link
              href="/onboarding/skills"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border-default px-4 py-2.5 text-label-lg text-text-primary hover:bg-surface-subtle"
            >
              Back
            </Link>
            <Button
              type="submit"
              size="lg"
              disabled={!selected || pending}
              isLoading={pending}
              loadingText="Saving..."
            >
              Save &amp; Next
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

        <ToggleSwitch
          checked={practiceReminders}
          onCheckedChange={setPracticeReminders}
          label="Prioritize interactive hands-on practice"
          description="Emphasize guided practice checkpoints alongside daily reading and visual exercises."
          disabled={pending}
        />

        {apiError && (
          <Alert variant={toneToAlertVariant(apiError.tone)} role="alert">
            {apiError.message}
          </Alert>
        )}
      </MultiStepFormWrapper>
    </form>
  );
}

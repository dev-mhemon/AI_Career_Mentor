'use client';

import Link from 'next/link';
import { useState, type SVGProps } from 'react';
import type { LearningPreference, ProfileResponse } from '@/lib/api/client';
import type { M05Invoke } from '@/lib/api/error-mapper';
import { cn } from '@/components/ui/cn';
import { ClockIcon, GlobeIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { PreferencesSetupForm } from '@/components/onboarding/preferences-setup-form';

function LayersIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </svg>
  );
}

function SlidersHorizontalIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <line x1="21" x2="14" y1="4" y2="4" />
      <line x1="10" x2="3" y1="4" y2="4" />
      <line x1="21" x2="12" y1="12" y2="12" />
      <line x1="8" x2="3" y1="12" y2="12" />
      <line x1="21" x2="16" y1="20" y2="20" />
      <line x1="12" x2="3" y1="20" y2="20" />
      <line x1="14" x2="14" y1="2" y2="6" />
      <line x1="8" x2="8" y1="10" y2="14" />
      <line x1="16" x2="16" y1="18" y2="22" />
    </svg>
  );
}

function UserPenIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M11.5 15H7a4 4 0 0 0-4 4v2" />
      <path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
      <circle cx="10" cy="7" r="4" />
    </svg>
  );
}

const PREFERENCE_LABEL: Record<LearningPreference, string> = {
  reading: 'Reading',
  hands_on: 'Hands-on',
  visual: 'Visual',
  mixed: 'Mixed',
};

export interface CareerPreferencesCardProps {
  profile: ProfileResponse | null;
  isEditingPreferences: boolean;
  pending: boolean;
  invoke: M05Invoke;
  onStartEditPreferences: () => void;
  onCancelEditPreferences: () => void;
  onPreferencesSaved: (updatedProfile: ProfileResponse) => void;
}

/**
 * Presentational Learning Preferences card for Screen 14 (`/career-profile`).
 * Matches the AI Studio LearningPreferencesCard layout with icon rows, a vertically
 * stacked action footer band, and a Compound Component `Modal` hosting `PreferencesSetupForm`.
 */
export function CareerPreferencesCard({
  profile,
  isEditingPreferences,
  pending,
  invoke,
  onStartEditPreferences,
  onCancelEditPreferences,
  onPreferencesSaved,
}: CareerPreferencesCardProps) {
  const [prefsSaving, setPrefsSaving] = useState(false);

  return (
    <section
      id="preferences"
      aria-labelledby="prefs-heading"
      className="flex flex-col gap-3.5"
    >
      {/* Section Header */}
      <div className="flex min-h-[32px] items-center justify-between gap-4">
        <h2
          id="prefs-heading"
          className="text-[17px] font-semibold tracking-[-0.015em] text-text-primary"
        >
          Learning preferences
        </h2>
      </div>

      {/* Unified Single-Elevation Surface */}
      <div className="overflow-hidden rounded-xl border border-border-default bg-surface-default shadow-xs">
        {profile && (
          <dl className="divide-y divide-border-subtle">
            {/* Learning style */}
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-subtle text-text-secondary"
                  aria-hidden="true"
                >
                  <LayersIcon className="h-4 w-4" />
                </div>
                <dt className="text-[13px] font-medium text-text-secondary">
                  Learning style
                </dt>
              </div>
              <dd className="text-right text-[14.5px] font-semibold text-text-primary">
                {profile.learning_preference
                  ? PREFERENCE_LABEL[profile.learning_preference]
                  : 'Not set'}
              </dd>
            </div>

            {/* Daily study hours */}
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-subtle text-text-secondary"
                  aria-hidden="true"
                >
                  <ClockIcon className="h-4 w-4" />
                </div>
                <dt className="text-[13px] font-medium text-text-secondary">
                  Daily study hours
                </dt>
              </div>
              <dd className="text-right font-mono text-[14.5px] font-semibold tabular-nums text-text-primary">
                {profile.preferred_daily_hours !== null
                  ? `${profile.preferred_daily_hours} h`
                  : 'Not set'}
              </dd>
            </div>

            {/* Timezone */}
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-subtle text-text-secondary"
                  aria-hidden="true"
                >
                  <GlobeIcon className="h-4 w-4" />
                </div>
                <dt className="text-[13px] font-medium text-text-secondary">
                  Timezone
                </dt>
              </div>
              <dd className="truncate text-right font-mono text-[13.5px] font-medium text-text-primary">
                {profile.timezone ?? 'Not set'}
              </dd>
            </div>
          </dl>
        )}

        {/* Vertically Stacked Action Footer Band */}
        <div className="flex flex-col items-start gap-2 border-t border-slate-100 bg-surface-subtle px-5 pt-3 pb-3.5 dark:border-slate-800">
          <button
            type="button"
            disabled={pending || !profile}
            onClick={onStartEditPreferences}
            className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-3 text-[13px] leading-none font-semibold text-text-brand transition-colors hover:bg-action-ghost-background-hover active:bg-action-ghost-background-active disabled:cursor-not-allowed disabled:text-text-disabled"
          >
            <SlidersHorizontalIcon className="h-3.5 w-3.5" />
            <span>Edit preferences</span>
          </button>

          <Link
            href="/profile"
            className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-[13px] leading-none font-medium text-text-secondary transition-colors hover:bg-border-default/50 hover:text-text-primary"
          >
            <UserPenIcon className="h-3.5 w-3.5" />
            <span>Edit profile</span>
          </Link>
        </div>
      </div>

      {/* Compound Modal: Edit Learning Preferences */}
      <Modal
        open={isEditingPreferences}
        onClose={onCancelEditPreferences}
        disableClose={pending || prefsSaving}
        size="md"
      >
        <Modal.Header>
          <div className="min-w-0">
            <Modal.Title>Edit learning preferences</Modal.Title>
            <Modal.Description>
              Pick the learning style that fits you best.
            </Modal.Description>
          </div>
          <Modal.Close />
        </Modal.Header>
        <Modal.Body>
          <PreferencesSetupForm
            mode="standalone"
            inModal
            initialProfile={profile}
            invoke={invoke}
            onPendingChange={setPrefsSaving}
            onCancel={onCancelEditPreferences}
            onSuccess={onPreferencesSaved}
          />
        </Modal.Body>
      </Modal>
    </section>
  );
}

'use client';

import { useState, type ComponentType, type SVGProps } from 'react';
import type { ProfileResponse, ProfileSkillDTO } from '@/lib/api/client';
import type { M05Invoke } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { cn } from '@/components/ui/cn';
import {
  AlertCircleIcon,
  BookOpenIcon,
  CheckCircleIcon,
  UserIcon,
} from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { SkillsSetupForm } from '@/components/onboarding/skills-setup-form';

function PencilIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function CircleDashedIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M10.1 2.182a10 10 0 0 1 3.8 0" />
      <path d="M13.9 21.818a10 10 0 0 1-3.8 0" />
      <path d="M17.609 3.721a10 10 0 0 1 2.69 2.7" />
      <path d="M2.182 13.9a10 10 0 0 1 0-3.8" />
      <path d="M20.279 17.609a10 10 0 0 1-2.7 2.69" />
      <path d="M21.818 10.1a10 10 0 0 1 0 3.8" />
      <path d="M3.721 6.391a10 10 0 0 1 2.7-2.69" />
      <path d="M6.391 20.279a10 10 0 0 1-2.69-2.7" />
    </svg>
  );
}

function Repeat2Icon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="m2 9 3-3 3 3" />
      <path d="M13 18H7a2 2 0 0 1-2-2V6" />
      <path d="m22 15-3 3-3-3" />
      <path d="M11 6h6a2 2 0 0 1 2 2v10" />
    </svg>
  );
}

interface SkillStateMeta {
  label: string;
  title?: string;
  containerClass: string;
  iconClass: string;
  Icon: ComponentType<{ className?: string }>;
}

const SELF_REPORTED_META: SkillStateMeta = {
  label: 'Self-reported',
  title: 'Self-reported skill — starts at Learning until verified by practice',
  containerClass:
    'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300',
  iconClass: 'text-slate-500 dark:text-slate-400',
  Icon: UserIcon,
};

const LEARNING_STATE_META: Record<
  ProfileSkillDTO['learning_state'],
  SkillStateMeta
> = {
  not_started: {
    label: 'Not started',
    containerClass:
      'border-learning-not-started-border bg-learning-not-started-background text-learning-not-started-text',
    iconClass: 'text-learning-not-started-text',
    Icon: CircleDashedIcon,
  },
  learning: {
    label: 'Learning',
    containerClass:
      'border-learning-learning-border bg-learning-learning-background text-learning-learning-text',
    iconClass: 'text-learning-learning-text',
    Icon: BookOpenIcon,
  },
  practicing: {
    label: 'Practicing',
    containerClass:
      'border-learning-practicing-border bg-learning-practicing-background text-learning-practicing-text',
    iconClass: 'text-learning-practicing-text',
    Icon: Repeat2Icon,
  },
  proficient: {
    label: 'Proficient',
    containerClass:
      'border-learning-proficient-border bg-learning-proficient-background text-learning-proficient-text',
    iconClass: 'text-learning-proficient-text',
    Icon: CheckCircleIcon,
  },
};

function resolveSkillBadgeMeta(skill: ProfileSkillDTO): SkillStateMeta {
  if (skill.learning_state === 'learning' && skill.source === 'self_reported') {
    return SELF_REPORTED_META;
  }
  return LEARNING_STATE_META[skill.learning_state] ?? SELF_REPORTED_META;
}

export interface CareerSkillsSectionProps {
  profile: ProfileResponse | null;
  profileError?: string | null;
  isEditingSkills: boolean;
  pending: boolean;
  invoke: M05Invoke;
  onStartEditSkills: () => void;
  onCancelEditSkills: () => void;
  onProfileCommitted: (updatedProfile: ProfileResponse) => void;
  onSkillsSaved: (updatedProfile: ProfileResponse) => void;
}

/**
 * Presentational Skills section for Screen 14 (`/career-profile`).
 * Renders the unified single-elevation skills list and opens `SkillsSetupForm`
 * (`mode="standalone"`) inside the Compound Component `Modal`.
 */
export function CareerSkillsSection({
  profile,
  profileError,
  isEditingSkills,
  pending,
  invoke,
  onStartEditSkills,
  onCancelEditSkills,
  onProfileCommitted,
  onSkillsSaved,
}: CareerSkillsSectionProps) {
  const [skillsSaving, setSkillsSaving] = useState(false);
  const skills = profile?.existing_skills ?? [];
  const unresolvedSkills = profile?.unresolved_skills ?? [];
  const totalSkillCount = skills.length;

  return (
    <section
      id="skills-section"
      aria-labelledby="skills-heading"
      className="flex flex-col gap-3.5"
    >
      {/* Section Header */}
      <div className="flex min-h-[32px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2
            id="skills-heading"
            className="text-[17px] font-semibold tracking-[-0.015em] tabular-nums text-text-primary"
          >
            {totalSkillCount > 0 ? `Skills (${totalSkillCount})` : 'Skills'}
          </h2>
        </div>

        <button
          type="button"
          disabled={pending || !profile}
          onClick={onStartEditSkills}
          className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] leading-none font-semibold text-text-brand transition-colors hover:bg-action-ghost-background-hover active:bg-action-ghost-background-active disabled:cursor-not-allowed disabled:text-text-disabled"
        >
          <PencilIcon className="h-3.5 w-3.5" />
          <span>Edit skills</span>
        </button>
      </div>

      {profileError && !profile && (
        <Alert variant="warning" role="alert">
          {profileError}
        </Alert>
      )}

      {profile && (totalSkillCount > 0 || unresolvedSkills.length > 0) && (
        <div className="overflow-hidden rounded-xl border border-border-default bg-surface-default shadow-xs">
          <ul
            aria-label="Your skills"
            className="divide-y divide-border-subtle"
          >
            {skills.map((skill) => {
              const stateMeta = resolveSkillBadgeMeta(skill);
              const StateIcon = stateMeta.Icon;

              return (
                <li
                  key={skill.skill_id}
                  className="group flex items-center justify-between gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-subtle/85"
                >
                  <div className="min-w-0 flex-1">
                    <span
                      dir="auto"
                      className="block truncate text-[14.5px] font-semibold leading-snug text-text-primary"
                    >
                      {skill.name}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center">
                    <span
                      title={stateMeta.title}
                      className={`inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11.5px] leading-none font-medium ${stateMeta.containerClass}`}
                    >
                      <StateIcon className={`h-3 w-3 ${stateMeta.iconClass}`} />
                      <span>{stateMeta.label}</span>
                    </span>
                  </div>
                </li>
              );
            })}

            {unresolvedSkills.map((item) => (
              <li
                key={`unresolved-${item.input}`}
                className="group flex items-center justify-between gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-subtle/85"
              >
                <div className="min-w-0 flex-1">
                  <span
                    dir="auto"
                    className="block truncate text-[14.5px] font-semibold leading-snug text-text-primary"
                  >
                    {item.input}
                  </span>
                </div>

                <div className="flex shrink-0 items-center">
                  <span className="inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-feedback-warning-border bg-feedback-warning-background px-2 text-[11.5px] leading-none font-medium text-feedback-warning-text">
                    <AlertCircleIcon className="h-3 w-3 text-feedback-warning-icon" />
                    <span>Needs clarification</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {profile && totalSkillCount === 0 && unresolvedSkills.length === 0 && (
        <div className="rounded-xl border border-border-default bg-surface-default px-6 py-8 text-center shadow-xs">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-border-default bg-surface-subtle text-text-secondary">
            <BookOpenIcon className="h-5 w-5" />
          </div>
          <p className="mt-3 text-[15px] font-semibold text-text-primary">
            {profile.existing_skills_none
              ? 'No prior technical skills (you are starting from zero).'
              : 'No skills added yet.'}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-[13.5px] leading-relaxed text-text-secondary">
            {profile.existing_skills_none
              ? 'Your profile is set to complete beginner. You can add skills anytime as you learn.'
              : 'Add your existing technical skills so your career roadmaps match your background.'}
          </p>
        </div>
      )}

      {/* Compound Modal: Edit Skills */}
      <Modal
        open={isEditingSkills}
        onClose={onCancelEditSkills}
        disableClose={pending || skillsSaving}
        size="md"
      >
        <Modal.Header>
          <div className="min-w-0">
            <Modal.Title>Edit skills</Modal.Title>
            <Modal.Description>
              Self-reported skills start at Learning unless stronger practice
              evidence exists. Updating skills never silently alters a locked
              roadmap.
            </Modal.Description>
          </div>
          <Modal.Close />
        </Modal.Header>
        <Modal.Body>
          <SkillsSetupForm
            mode="standalone"
            inModal
            initialProfile={profile}
            invoke={invoke}
            onPendingChange={setSkillsSaving}
            onProfileCommitted={onProfileCommitted}
            onCancel={onCancelEditSkills}
            onSuccess={onSkillsSaved}
          />
        </Modal.Body>
      </Modal>
    </section>
  );
}

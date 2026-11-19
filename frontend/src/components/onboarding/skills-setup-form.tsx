'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type {
  ProfileResponse,
  ProfileSkillDTO,
  UnresolvedSkillDTO,
} from '@/lib/api/client';
import type { M05Invoke, MappedError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  MultiStepFormWrapper,
  toneToAlertVariant,
} from '@/components/ui/multi-step-form-wrapper';
import { SkillCard } from '@/components/ui/skill-card';
import { ToggleSwitch } from '@/components/ui/toggle-switch';

export const MAX_SKILLS = 100;
export const MAX_SKILL_NAME_CODE_POINTS = 80;

export interface SkillsSetupFormProps {
  initialProfile: ProfileResponse | null;
  loadError?: string | null;
  invoke: M05Invoke;
}

/** Returns an inline validation message for a candidate skill name, or `null` when it can be added. */
export function validateNewSkill(raw: string, existing: string[]): string | null {
  const name = raw.trim();
  if (!name) return 'Enter a skill name.';
  if (Array.from(name).length > MAX_SKILL_NAME_CODE_POINTS) {
    return `Skill names can be at most ${MAX_SKILL_NAME_CODE_POINTS} characters.`;
  }
  if (existing.length >= MAX_SKILLS) {
    return `You can add up to ${MAX_SKILLS} skills. Remove one to add another.`;
  }
  if (existing.some((s) => s.toLowerCase() === name.toLowerCase())) {
    return 'That skill is already in your list.';
  }
  return null;
}

/**
 * Screen 08 (`/onboarding/skills`, Step 2 of 5). Skills or explicit beginner `None` (`R07`) via EP-P02;
 * unresolved aliases are answered per user via EP-P05.
 */
export function SkillsSetupForm({
  initialProfile,
  loadError,
  invoke,
}: SkillsSetupFormProps) {
  const router = useRouter();
  const [skills, setSkills] = useState<string[]>(
    () => initialProfile?.existing_skills.map((s) => s.name) ?? [],
  );
  const [none, setNone] = useState<boolean>(
    () => initialProfile?.existing_skills_none ?? false,
  );
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [apiError, setApiError] = useState<MappedError | null>(null);
  const [unresolved, setUnresolved] = useState<UnresolvedSkillDTO[] | null>(null);

  const knownSkills = new Map<string, ProfileSkillDTO>(
    (initialProfile?.existing_skills ?? []).map((s) => [s.name.toLowerCase(), s]),
  );
  const atCap = skills.length >= MAX_SKILLS;
  const canSubmit = (none || skills.length > 0) && !pending && !loadError;
  const resolving = unresolved !== null && unresolved.length > 0;

  function addSkill() {
    const message = validateNewSkill(draft, skills);
    if (message) {
      setDraftError(message);
      return;
    }
    setDraftError(null);
    setNotice(null);
    setSkills((prev) => [...prev, draft.trim()]);
    setNone(false); // adding a skill flips None off (PRD §14)
    setUnresolved(null);
    setDraft('');
  }

  function removeSkill(name: string) {
    setSkills((prev) => prev.filter((s) => s !== name));
    setUnresolved((prev) => {
      if (!prev) return null;
      const next = prev.filter((u) => u.input.toLowerCase() !== name.toLowerCase());
      return next.length > 0 ? next : null;
    });
    setNotice(`Removed ${name}.`);
  }

  function changeNone(next: boolean) {
    setNone(next);
    setDraftError(null);
    setUnresolved(null);
    if (next) {
      setSkills([]); // None clears tags and creates no artificial skills (R07)
      setNotice('Marked as no prior technical skills. Skill list cleared.');
    } else {
      setNotice(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setApiError(null);
    const result = await invoke(
      'updateSkills',
      none ? { none: true } : { names: skills },
    );
    setPending(false);
    if (!result.ok) {
      setApiError(result.error);
      return;
    }
    const pendingAliases = result.data.unresolved_skills ?? [];
    if (pendingAliases.length > 0) {
      setUnresolved(pendingAliases);
      return;
    }
    router.push('/onboarding/preferences');
  }

  async function resolveAlias(input: string, skillId: string) {
    setPending(true);
    setApiError(null);
    const result = await invoke('interpretSkillAlias', {
      input,
      skill_id: skillId,
    });
    setPending(false);
    if (!result.ok) {
      setApiError(result.error);
      return;
    }
    setUnresolved((prev) => (prev ?? []).filter((u) => u.input !== input));
    setNotice(`Saved your meaning for “${input}”.`);
  }

  return (
    <form onSubmit={save} noValidate>
      <MultiStepFormWrapper
        currentStep={2}
        heading="Your Skills"
        description="Add the technology skills you already have, or confirm that you are starting from zero. You are never blocked for being a beginner."
        status={pending ? 'submitting' : 'editing'}
        errorMessage={loadError ?? null}
        actions={
          <>
            <Link
              href="/onboarding/profile"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border-default px-4 py-2.5 text-label-lg text-text-primary hover:bg-surface-subtle"
            >
              Back
            </Link>
            {resolving ? (
              <p className="text-body-sm text-text-secondary">
                Resolve the highlighted skills to continue.
              </p>
            ) : unresolved !== null ? (
              <Button
                type="button"
                size="lg"
                onClick={() => router.push('/onboarding/preferences')}
              >
                Continue to Preferences
              </Button>
            ) : (
              <Button
                type="submit"
                size="lg"
                disabled={!canSubmit}
                isLoading={pending}
                loadingText="Saving skills..."
              >
                Save &amp; Next
              </Button>
            )}
          </>
        }
      >
        <ToggleSwitch
          checked={none}
          onCheckedChange={changeNone}
          label="None / No prior technical skills"
          description="Choose this if you are a complete beginner. No skills are created for you."
          disabled={pending || resolving}
        />

        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-2">
            <div
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
                  e.preventDefault(); // Enter adds the skill instead of submitting the step
                  if (!(pending || atCap || none || resolving)) addSkill();
                }
              }}
            >
              <Input
                label="Add a skill"
                value={draft}
                disabled={pending || atCap || none || resolving}
                error={draftError ?? undefined}
                hint={
                  none
                    ? 'Turn off "None" to add skills.'
                    : atCap
                      ? `You reached the limit of ${MAX_SKILLS} skills.`
                      : 'For example: React, SQL, Python'
                }
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDraftError(null);
                }}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={pending || atCap || none || resolving}
              onClick={addSkill}
            >
              Add skill
            </Button>
          </div>
          <p
            aria-live="polite"
            className="text-caption tabular-nums text-text-secondary"
          >
            {skills.length} of {MAX_SKILLS} skills
          </p>
        </div>

        {skills.length > 0 && (
          <ul aria-label="Your skills" className="flex flex-col gap-2">
            {skills.map((name) => {
              const known = knownSkills.get(name.toLowerCase());
              return (
                <SkillCard
                  key={name}
                  name={known?.name ?? name}
                  aliasInput={name}
                  aliasResolved={known?.alias_resolved ?? true}
                  learningState={known?.learning_state}
                  disabled={pending || resolving}
                  onRemove={() => removeSkill(name)}
                />
              );
            })}
          </ul>
        )}

        {resolving && (
          <section
            aria-label="Skill clarification"
            className="flex flex-col gap-4 rounded-lg border border-feedback-warning-border bg-feedback-warning-background p-4"
          >
            <p className="text-label-lg text-feedback-warning-text">
              Help us understand these skills
            </p>
            {unresolved.map((item) => (
              <div key={item.input} className="flex flex-col gap-2">
                <p className="text-body-sm text-text-primary">
                  What did you mean by “{item.input}”?
                </p>
                <div className="flex flex-wrap gap-2">
                  {item.candidates.map((candidate) => (
                    <Button
                      key={candidate.skill_id}
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => resolveAlias(item.input, candidate.skill_id)}
                    >
                      {candidate.name}
                    </Button>
                  ))}
                  {item.candidates.length === 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => removeSkill(item.input)}
                    >
                      Remove “{item.input}”
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}

        {!none && skills.length === 0 && !resolving && (
          <p className="text-body-sm text-text-secondary">
            Add at least one skill, or turn on &quot;None&quot; to continue.
          </p>
        )}

        <p role="status" aria-live="polite" className="text-caption text-text-secondary empty:hidden">
          {notice}
        </p>

        {apiError && (
          <Alert variant={toneToAlertVariant(apiError.tone)} role="alert">
            {apiError.message}
          </Alert>
        )}
      </MultiStepFormWrapper>
    </form>
  );
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  ApiError,
  type CareerGoalResponse,
  type ProfileResponse,
} from '@/lib/api/client';
import { mapApiError, type M05Invoke } from '@/lib/api/error-mapper';
import { SkillsSetupForm, validateNewSkill } from './skills-setup-form';
import { PreferencesSetupForm } from './preferences-setup-form';
import {
  GoalSetupForm,
  clearGoalDraft,
  codePointLength,
  readGoalDraft,
  validateBoundedText,
} from './goal-setup-form';
import { GoalClarifyForm, doesGoalMatchRole } from './goal-clarify-form';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const GOAL_ID = '11111111-1111-4111-8111-111111111111';

function profile(overrides: Partial<ProfileResponse> = {}): ProfileResponse {
  return {
    current_role: 'Student',
    education: null,
    experience_level: 'beginner',
    existing_skills: [],
    existing_skills_none: false,
    learning_preference: null,
    preferred_daily_hours: 2,
    timezone: 'Asia/Dhaka',
    timezone_detected: true,
    active_career_goal_ids: [],
    profile_complete: false,
    missing_fields: [],
    updated_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function goal(overrides: Partial<CareerGoalResponse> = {}): CareerGoalResponse {
  return {
    id: GOAL_ID,
    goal_text: 'I want to build APIs',
    status: 'clarifying',
    clarification_round: 1,
    clarification_question: 'Which part of backend interests you most?',
    proposed_role: null,
    alternative_roles: [],
    suggested_level: null,
    target_level: null,
    roadmap_id: null,
    created_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

const AWAITING = goal({
  status: 'awaiting_confirmation',
  clarification_round: 2,
  clarification_question: null,
  proposed_role: { canonical_role_id: 'role-1', name: 'Backend Development' },
  alternative_roles: [
    { canonical_role_id: 'role-2', name: 'DevOps Engineering', rationale: 'Infra overlap' },
    { canonical_role_id: 'role-3', name: 'Data Engineering', rationale: null },
  ],
  suggested_level: 'junior',
});

const failure = (code: string, status: number) => ({
  ok: false as const,
  error: mapApiError(new ApiError(status, 'RAW internal gpt trace', code)),
});

function makeInvoke(handler: (op: string, input: unknown) => unknown) {
  const fn = vi.fn(async (op: string, input: unknown) => handler(op, input));
  return fn as unknown as M05Invoke & typeof fn;
}

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  window.sessionStorage.clear();
});

describe('Screen 08 — SkillsSetupForm', () => {
  it('starts unchecked for brand-new users, uses MultiSelectCombobox with zero network calls for catalog selections, and saves names via EP-P02', async () => {
    const invoke = makeInvoke(() => ({ ok: true, data: profile() }));
    render(<SkillsSetupForm initialProfile={profile({ existing_skills_none: false })} invoke={invoke} />);
    expect(screen.getByRole('progressbar', { name: /step 2 of 5/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save & next/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add skill' })).not.toBeInTheDocument();

    const label = screen.getByText('Add a skill');
    const headerRow = label.parentElement!.parentElement!;
    expect(within(label.parentElement!).getByText('*')).toHaveClass('text-text-danger');
    const inlineHint = within(headerRow).getByText('(Add at least one skill)');
    expect(inlineHint).toHaveClass('text-caption', 'text-text-secondary');

    const toggle = screen.getByRole('switch', { name: 'No prior technical skills' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    const input = screen.getByRole('combobox', { name: /add a skill/i });
    expect(screen.queryByText('↵ Enter')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'React' } });
    expect(screen.getByText('↵ Enter')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.queryByText('↵ Enter')).not.toBeInTheDocument();

    // Select "React" from catalog via Enter -> zero network validation round-trip
    fireEvent.change(input, { target: { value: 'React' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByText('↵ Enter')).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    // Select "SQL" from dropdown click
    fireEvent.change(input, { target: { value: 'SQL' } });
    const listbox = screen.getByRole('listbox', { name: 'Skill suggestions' });
    fireEvent.click(within(listbox).getByRole('option', { name: 'SQL' }));
    expect(invoke).not.toHaveBeenCalled();

    // Duplicate entry via Enter shows inline validation alert
    fireEvent.change(input, { target: { value: 'react' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('That skill is already in your list.');

    const list = screen.getByRole('list', { name: 'Your skills' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByRole('button', { name: 'Remove React' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Remove SQL' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding'));
    expect(refresh).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('updateSkills', { names: ['React', 'SQL'] });
  });

  it('hydrates No prior technical skills as checked and hides combobox for returning explicit-none users', async () => {
    const invoke = makeInvoke(() => ({ ok: true, data: profile({ existing_skills_none: true }) }));
    render(<SkillsSetupForm initialProfile={profile({ existing_skills_none: true })} invoke={invoke} />);

    const toggle = screen.getByRole('switch', { name: 'No prior technical skills' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('combobox', { name: /add a skill/i })).not.toBeInTheDocument();
    expect(screen.queryByText('(Add at least one skill)')).not.toBeInTheDocument();

    const saveBtn = screen.getByRole('button', { name: /save & next/i });
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding'));
    expect(invoke).toHaveBeenCalledWith('updateSkills', { none: true });
  });

  it('enforces the 100-skill cap by showing an inline alert when attempting to add a 101st skill', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      skill_id: `s${i}`,
      name: `Skill ${i}`,
      alias_resolved: true,
      learning_state: 'learning' as const,
      source: 'self_reported' as const,
    }));
    render(
      <SkillsSetupForm
        initialProfile={profile({ existing_skills: many })}
        invoke={makeInvoke(() => ({ ok: true, data: profile() }))}
      />,
    );
    const input = screen.getByRole('combobox', { name: /add a skill/i });
    expect(input).toBeEnabled();

    fireEvent.change(input, { target: { value: 'Extra Skill 101' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/you can add up to 100 skills/i);
    expect(within(screen.getByRole('list', { name: 'Your skills' })).getAllByRole('listitem')).toHaveLength(100);
    expect(validateNewSkill('Extra', many.map((s) => s.name))).toMatch(/up to 100 skills/i);
    expect(validateNewSkill('x'.repeat(81), [])).toMatch(/at most 80/i);
    expect(validateNewSkill('   ', [])).toMatch(/enter a skill/i);
  });

  it('submits explicit None (R07) with no skills, clears pills and hides combobox', async () => {
    const invoke = makeInvoke(() => ({ ok: true, data: profile({ existing_skills_none: true }) }));
    render(
      <SkillsSetupForm
        initialProfile={profile({
          existing_skills: [
            { skill_id: 's1', name: 'React', alias_resolved: true, learning_state: 'learning', source: 'self_reported' },
          ],
        })}
        invoke={invoke}
      />,
    );
    const toggle = screen.getByRole('switch', { name: 'No prior technical skills' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('combobox', { name: /add a skill/i })).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('list', { name: 'Your skills' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /add a skill/i })).not.toBeInTheDocument();
    expect(screen.queryByText('(Add at least one skill)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding'));
    expect(invoke).toHaveBeenCalledWith('updateSkills', { none: true });
  });

  it('removes a skill pill cleanly via button or Backspace and announces the removal in the status region', () => {
    const invoke = makeInvoke(() => ({ ok: true, data: profile() }));
    render(<SkillsSetupForm initialProfile={profile()} invoke={invoke} />);
    const input = screen.getByRole('combobox', { name: /add a skill/i });
    fireEvent.change(input, { target: { value: 'Go' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(invoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Go' }));
    expect(screen.queryByRole('button', { name: 'Remove Go' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Your skills' })).not.toBeInTheDocument();
    expect(screen.getByText('Removed Go.')).toHaveAttribute('role', 'status');
  });

  it('resolves ambiguous custom alias locally without calling EP-P05 with an empty UUID, shows teal Check suggestions + Dismiss, and keeps EP-P05 strictly for server candidates with real UUIDs', async () => {
    const invoke = makeInvoke((op, input) => {
      const payload = input as { input?: string; skill_id?: string };
      if (op === 'interpretSkillAlias' && payload?.skill_id === '11111111-1111-4111-8111-111111111111') {
        return {
          ok: true,
          data: {
            input: 'Py',
            skill_id: '11111111-1111-4111-8111-111111111111',
            scope: 'user',
            added_to_profile: true,
            progress_initialization: 'deferred_until_level_confirmation',
          },
        };
      }
      return { ok: true, data: profile() };
    });

    render(
      <SkillsSetupForm
        initialProfile={profile({
          unresolved_skills: [
            {
              input: 'Py',
              candidates: [
                { skill_id: '11111111-1111-4111-8111-111111111111', name: 'Python' },
              ],
            },
          ],
        })}
        invoke={invoke}
      />,
    );
    const input = screen.getByRole('combobox', { name: /add a skill/i });
    // Custom partial match ("Next") matches local catalog ("Next.js") without calling EP-P05 or EP-P02
    fireEvent.change(input, { target: { value: 'Next' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(invoke).not.toHaveBeenCalled();
    // Ambiguous entry is NOT added to the chip list
    expect(screen.queryByRole('list', { name: 'Your skills' })).not.toBeInTheDocument();

    const panel = await screen.findByRole('region', { name: 'Skill clarification' });
    expect(panel).toHaveTextContent('For “Next”:');
    expect(screen.getByRole('button', { name: /save & next/i })).toBeDisabled();

    const nextCandidateBtn = within(panel).getByRole('button', { name: 'Next.js' });
    expect(nextCandidateBtn).toHaveClass('border-teal-200', 'bg-teal-50', 'text-teal-800');
    expect(within(panel).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();

    // Selecting a local catalog candidate adds the canonical skill without calling EP-P05 with a slug
    fireEvent.click(nextCandidateBtn);
    expect(invoke).not.toHaveBeenCalled();
    expect(within(screen.getByRole('list', { name: 'Your skills' })).getByText('Next.js')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save & next/i })).toBeEnabled();

    // Next queued item is the server-returned unresolved alias ("Py") -> clicking it confirms via EP-P05 with its real UUID
    const serverPanel = await screen.findByRole('region', { name: 'Skill clarification' });
    expect(serverPanel).toHaveTextContent('For “Py”:');
    fireEvent.click(within(serverPanel).getByRole('button', { name: 'Python' }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('interpretSkillAlias', {
        input: 'Py',
        skill_id: '11111111-1111-4111-8111-111111111111',
      }),
    );
    expect(screen.queryByRole('region', { name: 'Skill clarification' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Your skills' })).getByText('Python')).toBeInTheDocument();
  });

  it('never adds unrecognized custom skills (e.g. "Boss") to the chip list, renders no Remove button, shows inline unrecognized message without calling EP-P05, and clears it on typing or selecting a valid skill', async () => {
    const invoke = makeInvoke(() => ({ ok: true, data: profile() }));

    render(<SkillsSetupForm initialProfile={profile()} invoke={invoke} />);
    const input = screen.getByRole('combobox', { name: /add a skill/i });
    const saveBtn = screen.getByRole('button', { name: /save & next/i });
    expect(saveBtn).toBeDisabled();

    // Add unrecognized custom skill ("Boss") -> does NOT call EP-P05/EP-P02, does NOT add chip, shows message only
    fireEvent.change(input, { target: { value: 'Boss' } });
    expect(screen.queryByRole('listbox', { name: 'Skill suggestions' })).not.toBeInTheDocument();
    expect(screen.getByText('No matching skill')).toHaveAttribute('role', 'status');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText('“Boss” is not a recognized skill.')).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: 'Your skills' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove “?boss”?/i })).not.toBeInTheDocument();
    expect(saveBtn).toBeDisabled();

    // Typing a new query automatically clears the unrecognized message
    fireEvent.change(input, { target: { value: 'R' } });
    expect(screen.queryByText('“Boss” is not a recognized skill.')).not.toBeInTheDocument();

    // Another unrecognized skill ("Dim"), then selecting a valid catalog skill ("React") clears message and enables Save
    fireEvent.change(input, { target: { value: 'Dim' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('“Dim” is not a recognized skill.')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'React' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByText('“Dim” is not a recognized skill.')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Your skills' })).getByText('React')).toBeInTheDocument();
    expect(saveBtn).toBeEnabled();

    // Leaving unadded draft text in input must not be auto-committed
    fireEvent.change(input, { target: { value: 'UnaddedDraft' } });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding'));
    expect(invoke).toHaveBeenLastCalledWith('updateSkills', { names: ['React'] });
  });

  it('clears apiError when removing a skill pill or clarification entry', async () => {
    const invoke = makeInvoke(() => failure('SKILL_NOT_FOUND', 404));
    render(<SkillsSetupForm initialProfile={profile()} invoke={invoke} />);
    const input = screen.getByRole('combobox', { name: /add a skill/i });
    fireEvent.change(input, { target: { value: 'React' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not find that skill/i);

    fireEvent.click(screen.getByRole('button', { name: 'Remove React' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('normalizes padded catalog labels consistently and hydrates canonical skills on standalone save without onSuccess callback', async () => {
    const invoke = makeInvoke(() => ({
      ok: true,
      data: profile({
        existing_skills: [
          { skill_id: 'sk-react', name: 'React', alias_resolved: true, learning_state: 'learning', source: 'self_reported' },
          { skill_id: 'sk-py', name: 'Python', alias_resolved: true, learning_state: 'learning', source: 'self_reported' },
        ],
      }),
    }));

    render(
      <SkillsSetupForm
        mode="standalone"
        initialProfile={profile()}
        catalogOptions={[
          { id: 'react', label: ' React ', keywords: [' ReactJS '] },
          { id: 'python', label: 'Python' },
        ]}
        invoke={invoke}
      />,
    );

    const input = screen.getByRole('combobox', { name: /add a skill/i });
    fireEvent.change(input, { target: { value: 'React' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Duplicate detection recognizes trimmed padded catalog label
    fireEvent.change(input, { target: { value: 'react' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('That skill is already in your list.');

    // Partial input 'py' matches local catalog suggestion 'Python' -> click candidate -> save in standalone mode
    fireEvent.change(input, { target: { value: 'py' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const panel = await screen.findByRole('region', { name: 'Skill clarification' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Python' }));
    expect(within(screen.getByRole('list', { name: 'Your skills' })).getByText('Python')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Skills' }));

    expect(await screen.findByTestId('toast-container')).toHaveTextContent('Skills updated.');
    const list = screen.getByRole('list', { name: 'Your skills' });
    expect(within(list).getByText('React')).toBeInTheDocument();
    expect(within(list).getByText('Python')).toBeInTheDocument();
    expect(within(list).queryByText('py')).not.toBeInTheDocument();
  });

  it('shows mapped safe copy for SKILL_NOT_FOUND and never raw backend text', async () => {
    const invoke = makeInvoke(() => failure('SKILL_NOT_FOUND', 404));
    render(<SkillsSetupForm initialProfile={profile()} invoke={invoke} />);
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not find that skill/i);
    expect(alert).not.toHaveTextContent(/gpt|trace/i);
    expect(push).not.toHaveBeenCalled();
  });

  it('blocks saving when the profile failed to load (avoids overwriting stored skills)', () => {
    render(
      <SkillsSetupForm
        initialProfile={null}
        loadError="Could not load"
        invoke={makeInvoke(() => ({ ok: true, data: profile() }))}
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByRole('button', { name: /save & next/i })).toBeDisabled();
  });

  it('does not leak saved skills across users when remounting SkillsSetupForm in the same runtime', async () => {
    const userASavedProfile = profile({
      existing_skills: [
        { skill_id: 'sk-react', name: 'React', alias_resolved: true, learning_state: 'learning', source: 'self_reported' },
      ],
      updated_at: '2026-12-01T00:00:00.000Z',
    });
    const invoke = makeInvoke(() => ({ ok: true, data: userASavedProfile }));
    const first = render(<SkillsSetupForm initialProfile={profile()} invoke={invoke} />);
    const input = screen.getByRole('combobox', { name: /add a skill/i });
    fireEvent.change(input, { target: { value: 'React' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding'));
    first.unmount();

    // User B has an older updated_at timestamp and no skills -> must NOT receive User A's React pill
    render(
      <SkillsSetupForm
        initialProfile={profile({ existing_skills: [], updated_at: '2026-11-01T00:00:00.000Z' })}
        invoke={invoke}
      />,
    );
    expect(screen.queryByRole('list', { name: 'Your skills' })).not.toBeInTheDocument();
  });

  it('does not mutate saved profile skills when adding a custom skill and toggling None before saving', async () => {
    const invoke = makeInvoke(() => ({
      ok: true,
      data: profile({ existing_skills_none: true }),
    }));
    render(<SkillsSetupForm initialProfile={profile()} invoke={invoke} />);
    const input = screen.getByRole('combobox', { name: /add a skill/i });

    fireEvent.change(input, { target: { value: 'Reacy' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('“Reacy” is not a recognized skill.')).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('switch', { name: 'No prior technical skills' }));
    fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding'));
    expect(invoke).toHaveBeenCalledWith('updateSkills', { none: true });
  });

  it('defers custom-skill EP-P02 calls in standalone mode so adding/canceling never mutates saved skills', async () => {
    const invoke = makeInvoke(() => ({ ok: true, data: profile() }));
    const onCancel = vi.fn();
    render(
      <SkillsSetupForm
        mode="standalone"
        initialProfile={profile({
          existing_skills: [
            { skill_id: 'sk-sql', name: 'SQL', alias_resolved: true, learning_state: 'learning', source: 'self_reported' },
          ],
        })}
        invoke={invoke}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove SQL' }));
    const input = screen.getByRole('combobox', { name: /add a skill/i });
    fireEvent.change(input, { target: { value: 'boss' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('“boss” is not a recognized skill.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('queues multiple unresolved/ambiguous skills and advances cleanly on resolve or dismiss without dropping unseen aliases', async () => {
    const invoke = makeInvoke((op, input) => {
      const payload = input as { input?: string; skill_id?: string };
      if (op === 'interpretSkillAlias' && payload.skill_id === 'sk-next') {
        return { ok: true, data: { input: 'Next', skill_id: 'sk-next', added_to_profile: true } };
      }
      return { ok: true, data: profile() };
    });

    render(
      <SkillsSetupForm
        initialProfile={profile({
          unresolved_skills: [
            {
              input: 'Next',
              candidates: [{ skill_id: 'sk-next', name: 'Next.js' }],
            },
            {
              input: 'Py',
              candidates: [{ skill_id: 'sk-py', name: 'Python' }],
            },
            {
              input: 'UnknownFoo',
              candidates: [],
            },
          ],
        })}
        invoke={invoke}
      />,
    );

    const panel1 = screen.getByRole('region', { name: 'Skill clarification' });
    expect(panel1).toHaveTextContent('For “Next”:');
    fireEvent.click(within(panel1).getByRole('button', { name: 'Next.js' }));

    // Advances to second queued ambiguous alias "Py"
    const panel2 = await screen.findByRole('region', { name: 'Skill clarification' });
    expect(panel2).toHaveTextContent('For “Py”:');
    fireEvent.click(within(panel2).getByRole('button', { name: 'Dismiss' }));

    // Advances to third queued unrecognized skill "UnknownFoo"
    expect(await screen.findByText('“UnknownFoo” is not a recognized skill.')).toBeInTheDocument();
  });

  it('rechecks the 100-skill limit before appending a resolved alias candidate', async () => {
    const ninetyNine = Array.from({ length: 99 }, (_, i) => ({
      skill_id: `s${i}`,
      name: `Skill ${i}`,
      alias_resolved: true,
      learning_state: 'learning' as const,
      source: 'self_reported' as const,
    }));
    const invoke = makeInvoke(() => ({
      ok: true,
      data: { input: 'Py', skill_id: '11111111-1111-4111-8111-111111111111', added_to_profile: true },
    }));

    render(
      <SkillsSetupForm
        initialProfile={profile({
          existing_skills: ninetyNine,
          unresolved_skills: [
            {
              input: 'Py',
              candidates: [{ skill_id: '11111111-1111-4111-8111-111111111111', name: 'Python' }],
            },
          ],
        })}
        invoke={invoke}
      />,
    );

    const input = screen.getByRole('combobox', { name: /add a skill/i });
    // User adds a 100th catalog skill before clicking the server candidate
    fireEvent.change(input, { target: { value: 'React' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(screen.getByRole('list', { name: 'Your skills' })).getAllByRole('listitem')).toHaveLength(100);

    // Clicking the candidate MUST enforce 100-skill cap instead of appending a 101st skill
    const panel = screen.getByRole('region', { name: 'Skill clarification' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Python' }));

    expect(within(screen.getByRole('list', { name: 'Your skills' })).getAllByRole('listitem')).toHaveLength(100);
    expect(screen.getByRole('alert')).toHaveTextContent(/you can add up to 100 skills/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('preserves the clarification prompt and displays an error when interpretSkillAlias fails for a server candidate', async () => {
    const invoke = makeInvoke(() => failure('INTERNAL_ERROR', 500));

    render(
      <SkillsSetupForm
        initialProfile={profile({
          unresolved_skills: [
            {
              input: 'Next',
              candidates: [{ skill_id: 'sk-next', name: 'Next.js' }],
            },
          ],
        })}
        invoke={invoke}
      />,
    );

    const panel = screen.getByRole('region', { name: 'Skill clarification' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Next.js' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Skill clarification' })).toHaveTextContent('For “Next”:');
    expect(screen.queryByText(/saved your meaning/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Your skills' })).not.toBeInTheDocument();
  });

  it('clears only the specific inline warning when typing or adding a catalog skill without popping server-queued unresolved items', async () => {
    const invoke = makeInvoke(() => ({ ok: true, data: profile() }));

    render(
      <SkillsSetupForm
        initialProfile={profile({
          unresolved_skills: [
            { input: 'ServerUnrecA', candidates: [] },
            { input: 'ServerUnrecB', candidates: [] },
          ],
        })}
        invoke={invoke}
      />,
    );

    expect(screen.getByText('“ServerUnrecA” is not a recognized skill.')).toBeInTheDocument();

    const input = screen.getByRole('combobox', { name: /add a skill/i });
    // Typing multiple characters must NOT pop queued server unresolved items
    fireEvent.change(input, { target: { value: 'R' } });
    fireEvent.change(input, { target: { value: 'Re' } });
    fireEvent.change(input, { target: { value: 'Rea' } });
    expect(screen.getByText('“ServerUnrecA” is not a recognized skill.')).toBeInTheDocument();

    // Selecting a catalog skill also preserves server-queued unresolved items
    fireEvent.change(input, { target: { value: 'React' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('“ServerUnrecA” is not a recognized skill.')).toBeInTheDocument();
  });
});

describe('Screen 09 — PreferencesSetupForm', () => {
  it('shows four radio cards, highlights the stored value and saves via EP-P03', async () => {
    const invoke = makeInvoke(() => ({ ok: true, data: profile({ learning_preference: 'visual' }) }));
    render(<PreferencesSetupForm initialProfile={profile({ learning_preference: 'reading' })} invoke={invoke} />);
    expect(screen.getByRole('progressbar', { name: /step 3 of 5/i })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Learning preference' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(within(group).getByRole('radio', { name: /^Reading/ })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(within(group).getByRole('radio', { name: /^Visual/ }));
    expect(within(group).getByRole('radio', { name: /^Visual/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('radio', { name: /^Reading/ })).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.queryByRole('switch', { name: /prioritize interactive hands-on practice/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding'));
    expect(invoke).toHaveBeenCalledWith('updatePreferences', { learning_preference: 'visual' });
  });

  it('requires a choice and reports mapped errors without navigating', async () => {
    const invoke = makeInvoke(() => failure('FEATURE_DISABLED', 403));
    render(<PreferencesSetupForm initialProfile={profile()} invoke={invoke} />);
    expect(screen.getByRole('button', { name: /save & next/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /hands-on/i }));
    fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/currently unavailable/i);
    expect(push).not.toHaveBeenCalled();
  });
});

describe('Screen 10 — GoalSetupForm', () => {
  it('counts Unicode code points, not UTF-16 units', () => {
    expect(codePointLength('😀😀😀')).toBe(3);
    expect('😀😀😀'.length).toBe(6);
    expect(validateBoundedText('😀😀', 3, 300, 'Goal')).toMatch(/at least 3/i);
    expect(validateBoundedText('😀😀😀', 3, 300, 'Goal')).toBeNull();
    expect(validateBoundedText('😀'.repeat(300), 3, 300, 'Goal')).toBeNull();
    expect(validateBoundedText('😀'.repeat(301), 3, 300, 'Goal')).toMatch(/at most 300/i);
    expect(validateBoundedText('ab\u0000c', 3, 300, 'Goal')).toMatch(/not supported/i);
    expect(validateBoundedText('abc\uD800', 3, 300, 'Goal')).toMatch(/not supported/i);
  });

  it('disables Analyze Goal until Career goal, valid Preferred Daily Hours, and Target career level are filled, hides counter, and splits empty vs too-short errors', () => {
    const invoke = makeInvoke(() => ({ ok: true, data: goal() }));
    render(<GoalSetupForm invoke={invoke} initialDailyHours={2} />);
    expect(screen.getByRole('progressbar', { name: /step 4 of 5/i })).toBeInTheDocument();
    expect(
      screen.getByText('Choose or describe the technology role you want to work toward.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/bangla|up to 3 goals/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/ 300 characters/i)).not.toBeInTheDocument();

    const hoursInput = screen.getByLabelText(/preferred daily hours/i);
    expect(hoursInput).toBeRequired();
    expect(hoursInput).toHaveValue(2);

    const levelSelect = screen.getByLabelText(/target career level/i);
    expect(levelSelect).toBeRequired();
    expect(levelSelect).toHaveClass('appearance-none');
    expect(levelSelect).toHaveValue('');

    const goalCombobox = screen.getByRole('combobox', { name: /career goal/i });
    expect(goalCombobox).toHaveAttribute('placeholder', 'Select or type a role');

    const analyzeBtn = screen.getByRole('button', { name: /analyze goal/i });
    // Empty Career goal and Target career level keep Analyze Goal disabled even when hours default to 2
    expect(analyzeBtn).toBeDisabled();

    // Blurring empty Career goal shows "Select a role"
    fireEvent.blur(goalCombobox);
    expect(screen.getByText('Select a role')).toBeInTheDocument();

    // Typing "ab" without selecting Target career level still keeps Analyze Goal disabled
    fireEvent.change(goalCombobox, { target: { value: 'ab' } });
    expect(analyzeBtn).toBeDisabled();

    // Selecting Target career level enables Analyze Goal; clicking triggers too-short validation
    fireEvent.change(levelSelect, { target: { value: 'mid' } });
    expect(analyzeBtn).toBeEnabled();
    fireEvent.click(analyzeBtn);
    expect(screen.getByText('Goal must be at least 3 characters.')).toBeInTheDocument();
    expect(screen.queryByText('Select a role')).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    // Clearing Preferred Daily Hours disables Analyze Goal again
    fireEvent.change(hoursInput, { target: { value: '' } });
    expect(analyzeBtn).toBeDisabled();
    fireEvent.blur(hoursInput);
    expect(screen.getByText(/enter daily study hours between 0\.5 and 12/i)).toBeInTheDocument();

    // Restoring valid hours + selecting a role enables Analyze Goal
    fireEvent.change(hoursInput, { target: { value: '2' } });
    fireEvent.change(goalCombobox, { target: { value: 'Backend developer' } });
    expect(analyzeBtn).toBeEnabled();
  });

  it('persists Preferred Daily Hours via EP-P04 before EP-C01 and routes to /onboarding in standalone mode', async () => {
    const invoke = makeInvoke((op) => {
      if (op === 'updateLearningSettings') return { ok: true, data: profile({ preferred_daily_hours: 2.5 }) };
      return { ok: true, data: goal({ id: GOAL_ID, status: 'awaiting_confirmation' }) };
    });
    render(<GoalSetupForm invoke={invoke} initialDailyHours={2.5} />);
    expect(screen.getByLabelText(/preferred daily hours/i)).toHaveValue(2.5);
    fireEvent.change(screen.getByLabelText(/career goal/i), { target: { value: '  Backend developer  ' } });
    fireEvent.change(screen.getByLabelText(/target career level/i), { target: { value: 'mid' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/onboarding'),
    );
    expect(invoke).toHaveBeenNthCalledWith(1, 'updateLearningSettings', { preferred_daily_hours: 2.5 });
    expect(invoke).toHaveBeenNthCalledWith(2, 'createCareerGoal', { goal_text: 'Backend developer' });
    // Keeps submitting state locked until unmount to avoid pre-navigation UI bounce
    expect(screen.getByRole('button', { name: /analyzing your goal/i })).toBeDisabled();
  });

  it('stops without creating goal when saving Preferred Daily Hours fails', async () => {
    const invoke = makeInvoke(() => failure('FEATURE_DISABLED', 403));
    render(<GoalSetupForm invoke={invoke} initialDailyHours={2} initialTargetLevel="junior" />);
    fireEvent.change(screen.getByLabelText(/career goal/i), { target: { value: 'Backend developer' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/currently unavailable/i);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('updateLearningSettings', { preferred_daily_hours: 2 });
    expect(push).not.toHaveBeenCalled();
  });

  it('renders Career goal full-width above the 50/50 Preferred Daily Hours and Target career level row without external example pills', () => {
    render(<GoalSetupForm invoke={makeInvoke(() => ({ ok: true, data: goal() }))} />);
    const goalCombobox = screen.getByRole('combobox', { name: /career goal/i });
    const hoursInput = screen.getByLabelText(/preferred daily hours/i);
    const levelSelect = screen.getByLabelText(/target career level/i);
    expect(
      goalCombobox.compareDocumentPosition(hoursInput) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      hoursInput.compareDocumentPosition(levelSelect) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(goalCombobox.closest('.w-full')).toBeInTheDocument();
    const row2 = hoursInput.closest('.sm\\:grid-cols-2');
    expect(row2).not.toBeNull();
    expect(row2).toContainElement(levelSelect);
    expect(row2).not.toContainElement(goalCombobox);
    expect(screen.queryByText('Example roles')).not.toBeInTheDocument();
  });

  it('persists Step 4 goal, dailyHours, and targetLevel across remount (Back to goal) and clears draft after Step 5 confirmation', async () => {
    const invoke = makeInvoke((op) => {
      if (op === 'updateLearningSettings') return { ok: true, data: profile({ preferred_daily_hours: 3 }) };
      if (op === 'confirmCareerGoal') return { ok: true, data: { ...AWAITING, status: 'confirmed', target_level: 'senior' } };
      return { ok: true, data: goal({ id: GOAL_ID, status: 'awaiting_confirmation' }) };
    });
    const first = render(<GoalSetupForm invoke={invoke} initialDailyHours={2} />);
    fireEvent.change(screen.getByRole('combobox', { name: /career goal/i }), {
      target: { value: 'Frontend developer' },
    });
    fireEvent.change(screen.getByLabelText(/preferred daily hours/i), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText(/target career level/i), {
      target: { value: 'senior' },
    });
    first.unmount();

    // Simulate returning via "Back to goal" with fresh mount
    const second = render(<GoalSetupForm invoke={invoke} initialDailyHours={2} />);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /career goal/i })).toHaveValue('Frontend developer'),
    );
    expect(screen.getByLabelText(/preferred daily hours/i)).toHaveValue(3);
    expect(screen.getByLabelText(/target career level/i)).toHaveValue('senior');
    second.unmount();

    // Confirming on Step 5 clears the temporary Step 4 draft
    render(<GoalClarifyForm goal={AWAITING} initialTargetLevel="senior" invoke={invoke} />);
    fireEvent.click(screen.getByRole('button', { name: /^confirm role$/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/career-profile'));
    expect(window.sessionStorage.getItem('mentor_onboarding_goal_draft')).toBeNull();
  });

  it('opens suggested roles in the combobox, filters on typing, selects an option, and submits cleanly', async () => {
    const invoke = makeInvoke((op) => {
      if (op === 'updateLearningSettings') return { ok: true, data: profile({ preferred_daily_hours: 2 }) };
      return { ok: true, data: goal({ id: GOAL_ID, status: 'awaiting_confirmation' }) };
    });
    render(<GoalSetupForm invoke={invoke} initialDailyHours={2} />);
    const goalCombobox = screen.getByRole('combobox', { name: /career goal/i });
    expect(goalCombobox).toHaveAttribute('aria-expanded', 'false');

    fireEvent.focus(goalCombobox);
    expect(goalCombobox).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox', { name: /suggested technology roles/i });
    expect(within(listbox).getAllByRole('option')).toHaveLength(6);

    fireEvent.change(goalCombobox, { target: { value: 'data' } });
    expect(within(listbox).getAllByRole('option')).toHaveLength(1);
    const dataOption = within(listbox).getByRole('option', { name: 'Data analyst' });
    fireEvent.mouseDown(dataOption);
    fireEvent.click(dataOption);

    expect(goalCombobox).toHaveValue('Data analyst');
    expect(goalCombobox).toHaveAttribute('aria-expanded', 'false');

    fireEvent.change(screen.getByLabelText(/target career level/i), { target: { value: 'junior' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/onboarding'),
    );
    expect(invoke).toHaveBeenNthCalledWith(1, 'updateLearningSettings', { preferred_daily_hours: 2 });
    expect(invoke).toHaveBeenNthCalledWith(2, 'createCareerGoal', { goal_text: 'Data analyst' });
  });

  it('accepts and submits a custom career goal not in the dropdown list and supports keyboard selection', async () => {
    const invoke = makeInvoke((op) => {
      if (op === 'updateLearningSettings') return { ok: true, data: profile({ preferred_daily_hours: 1.5 }) };
      return { ok: true, data: goal({ id: GOAL_ID, status: 'clarifying' }) };
    });
    render(<GoalSetupForm invoke={invoke} initialDailyHours={1.5} initialTargetLevel="senior" />);
    const goalCombobox = screen.getByRole('combobox', { name: /career goal/i });

    fireEvent.keyDown(goalCombobox, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(goalCombobox, { key: 'Enter' });
    expect(goalCombobox).toHaveValue('Backend developer');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.change(goalCombobox, { target: { value: 'Quantum Rust Engineer' } });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/onboarding'),
    );
    expect(invoke).toHaveBeenNthCalledWith(1, 'updateLearningSettings', { preferred_daily_hours: 1.5 });
    expect(invoke).toHaveBeenNthCalledWith(2, 'createCareerGoal', { goal_text: 'Quantum Rust Engineer' });
  });

  it('renders actionable guidance for OUT_OF_SCOPE_GOAL (422) and keeps the input', async () => {
    const invoke = makeInvoke((op) =>
      op === 'updateLearningSettings'
        ? { ok: true, data: profile({ preferred_daily_hours: 2 }) }
        : failure('OUT_OF_SCOPE_GOAL', 422),
    );
    render(<GoalSetupForm invoke={invoke} initialDailyHours={2} initialTargetLevel="junior" />);
    fireEvent.change(screen.getByLabelText(/career goal/i), { target: { value: 'Become a pastry chef' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/technology careers only/i);
    expect(alert).toHaveTextContent(/pick one of the example roles/i);
    expect(alert).not.toHaveTextContent(/gpt|trace/i);
    expect(screen.getByLabelText(/career goal/i)).toHaveValue('Become a pastry chef');
    expect(push).not.toHaveBeenCalled();
  });

  it('links to Career Profile on ROADMAP_LIMIT_REACHED (409)', async () => {
    const invoke = makeInvoke((op) =>
      op === 'updateLearningSettings'
        ? { ok: true, data: profile({ preferred_daily_hours: 2 }) }
        : failure('ROADMAP_LIMIT_REACHED', 409),
    );
    render(<GoalSetupForm invoke={invoke} initialDailyHours={2} initialTargetLevel="mid" />);
    fireEvent.change(screen.getByLabelText(/career goal/i), { target: { value: 'Backend developer' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/3 active goals/i);
    expect(screen.getByRole('link', { name: /manage your goals/i })).toHaveAttribute('href', '/career-profile');
  });

  it('isolates unsaved goal drafts per userId and unlocks retry when invoke rejects', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error('Transport dropped'));
    const first = render(
      <GoalSetupForm
        invoke={invoke as unknown as M05Invoke}
        userId="user-a"
        initialDailyHours={2}
        initialTargetLevel="mid"
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: /career goal/i }), {
      target: { value: 'Backend developer' },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(screen.getByRole('button', { name: /analyze goal/i })).toBeEnabled();
    first.unmount();

    // User B opening onboarding in the same tab must not see User A's unsaved goal draft
    render(
      <GoalSetupForm
        invoke={makeInvoke(() => ({ ok: true, data: goal() }))}
        userId="user-b"
        initialDailyHours={2}
      />,
    );
    expect(screen.getByRole('combobox', { name: /career goal/i })).toHaveValue('');
  });

  it('keeps in-memory goal draft authoritative when sessionStorage.setItem throws and ignores IME composition keys', () => {
    window.sessionStorage.setItem(
      'mentor_onboarding_goal_draft:user-quota',
      JSON.stringify({ goal: 'Stale Goal', dailyHours: '2', targetLevel: 'junior' }),
    );
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

    try {
      render(
        <GoalSetupForm
          invoke={makeInvoke(() => ({ ok: true, data: goal() }))}
          userId="user-quota"
          initialDailyHours={2}
        />,
      );
      const combobox = screen.getByRole('combobox', { name: /career goal/i });
      expect(combobox).toHaveValue('Stale Goal');

      fireEvent.change(combobox, { target: { value: 'Back' } });
      expect(combobox).toHaveValue('Back');

      // Highlight real matching preset option ("Backend developer")
      fireEvent.keyDown(combobox, { key: 'ArrowDown' });
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      // IME composition Enter/ArrowDown must leave input unchanged
      fireEvent.keyDown(combobox, { key: 'Enter', isComposing: true });
      fireEvent.keyDown(combobox, { key: 'Enter', keyCode: 229 });
      expect(combobox).toHaveValue('Back');

      // Normal Enter selects the highlighted preset option
      fireEvent.keyDown(combobox, { key: 'Enter' });
      expect(combobox).toHaveValue('Backend developer');
    } finally {
      setItemSpy.mockRestore();
      window.sessionStorage.clear();
    }
  });

  it('does NOT fall back from updateCareerGoal to createCareerGoal on transient non-terminal 409 conflicts', async () => {
    const invoke = makeInvoke((op) => {
      if (op === 'updateLearningSettings') return { ok: true, data: profile() };
      if (op === 'updateCareerGoal') {
        return failure('ROADMAP_LIMIT_REACHED', 409);
      }
      return { ok: true, data: goal() };
    });

    render(
      <GoalSetupForm
        invoke={invoke}
        activeDraftGoalId={GOAL_ID}
        initialGoalText="Backend developer"
        initialDailyHours={2}
        initialTargetLevel="mid"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/3 active goals/i);
    expect(invoke).toHaveBeenCalledWith('updateCareerGoal', {
      id: GOAL_ID,
      body: { goal_text: 'Backend developer' },
    });
    expect(invoke).not.toHaveBeenCalledWith('createCareerGoal', expect.anything());
  });

  it('ignores cross-goal drafts when editing Goal B and keeps cleared drafts hidden when sessionStorage.removeItem throws', () => {
    window.sessionStorage.setItem(
      'mentor_onboarding_goal_draft:user-cross',
      JSON.stringify({
        goal: 'Goal A Draft',
        dailyHours: '5',
        targetLevel: 'senior',
        goalId: 'goal-a',
      }),
    );

    render(
      <GoalSetupForm
        invoke={makeInvoke(() => ({ ok: true, data: goal() }))}
        userId="user-cross"
        activeDraftGoalId="goal-b"
        initialGoalText="Goal B Server Text"
        initialDailyHours={2}
        initialTargetLevel="mid"
      />,
    );

    // Mismatched Goal A draft must NOT prefill Goal B
    expect(screen.getByRole('combobox', { name: /career goal/i })).toHaveValue('Goal B Server Text');
    expect(screen.getByLabelText(/preferred daily hours/i)).toHaveValue(2);
    expect(screen.getByLabelText(/target career level/i)).toHaveValue('mid');

    // When removeItem throws, cleared draft must remain hidden from reads
    const removeSpy = vi
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });
    try {
      act(() => {
        clearGoalDraft('user-cross', 'onboarding');
      });
      expect(readGoalDraft('user-cross', 'onboarding')).toBeNull();
    } finally {
      removeSpy.mockRestore();
      act(() => {
        clearGoalDraft('user-cross', 'onboarding');
      });
    }
  });
});

describe('Screen 11 — GoalClarifyForm', () => {
  it('shows the question, round counter and runs clarifying → awaiting_confirmation (3-card grid) → Confirm Role with carried target_level', async () => {
    const invoke = makeInvoke((op) => {
      if (op === 'submitGoalClarification') return { ok: true, data: AWAITING };
      if (op === 'confirmCareerGoal') return { ok: true, data: { ...AWAITING, status: 'confirmed', target_level: 'mid' } };
      return failure('RESOURCE_NOT_FOUND', 404);
    });
    render(<GoalClarifyForm goal={goal()} initialTargetLevel="mid" invoke={invoke} />);
    expect(screen.getByRole('progressbar', { name: /step 5 of 5/i })).toBeInTheDocument();
    expect(screen.getByText('5. Confirm Role')).toBeInTheDocument();
    const goalTextEl = screen.getByText('I want to build APIs');
    expect(goalTextEl).toHaveClass('font-semibold', 'text-teal-900');
    const goalPill = goalTextEl.parentElement!;
    expect(goalPill).toHaveClass('rounded-full', 'border-teal-200/80', 'bg-teal-50/80');
    expect(within(goalPill).getByText('Goal:')).toBeInTheDocument();
    expect(screen.getByText('Round 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Which part of backend interests you most?')).toBeInTheDocument();

    const answerInput = screen.getByLabelText(/your answer/i);
    const submitAnswerBtn = screen.getByRole('button', { name: /submit answer/i });
    expect(submitAnswerBtn).toBeDisabled();
    fireEvent.blur(answerInput);
    expect(screen.getByText(/enter your answer/i)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    fireEvent.change(answerInput, { target: { value: 'Server-side APIs' } });
    expect(screen.getByText('16 / 300 characters')).toBeInTheDocument();
    expect(submitAnswerBtn).toBeEnabled();
    fireEvent.click(submitAnswerBtn);

    const group = await screen.findByRole('radiogroup', { name: 'Career role options' });
    expect(group).toHaveClass('grid', 'items-stretch', 'md:grid-cols-3');
    expect(screen.getByRole('heading', { name: 'Confirm your role' })).toBeInTheDocument();
    expect(screen.queryByText(/your goal:/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/target career level/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/suggested level/i)).not.toBeInTheDocument();

    expect(invoke).toHaveBeenCalledWith('submitGoalClarification', { id: GOAL_ID, body: { answer: 'Server-side APIs' } });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true'); // proposed role preselected
    expect(radios[0]).toHaveClass('h-full', 'flex-col', 'border-teal-600', 'ring-teal-500/20', 'cursor-pointer');
    const primaryBadge = within(radios[0]).getByText('Suggested');
    const primaryTitle = within(radios[0]).getByText('Backend Development');
    expect(
      primaryBadge.compareDocumentPosition(primaryTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(radios[1]).toHaveAttribute('aria-checked', 'false');
    expect(radios[1]).not.toHaveClass('border-teal-600');
    expect(within(radios[0]).getByText('Suggested')).toBeInTheDocument();
    expect(within(radios[1]).getByText('Alternative')).toBeInTheDocument();
    expect(within(radios[2]).getByText('Alternative')).toBeInTheDocument();
    expect(within(group).queryByText(/matches the career goal/i)).not.toBeInTheDocument();
    expect(within(group).queryByText('Infra overlap')).not.toBeInTheDocument();
    expect(within(group).queryByText('Recommended')).not.toBeInTheDocument();
    expect(within(group).queryByText('Selected')).not.toBeInTheDocument();
    expect(screen.getByText(/best interpretation/i)).toBeInTheDocument(); // round-2 cap copy

    const confirmBtn = screen.getByRole('button', { name: /^confirm role$/i });
    expect(confirmBtn).toBeEnabled(); // preselected role + carried target_level
    fireEvent.click(radios[1]);
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[1]).toHaveClass('border-teal-600', 'ring-teal-500/20');
    expect(radios[0]).toHaveAttribute('aria-checked', 'false');
    expect(radios[0]).not.toHaveClass('border-teal-600');
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/career-profile'));
    expect(invoke).toHaveBeenLastCalledWith('confirmCareerGoal', {
      id: GOAL_ID,
      body: { canonical_role_id: 'role-2', target_level: 'mid' },
    });
  });

  it('handles a goal that is already awaiting_confirmation and falls back to suggested_level when opened directly', async () => {
    const invoke = makeInvoke(() => ({ ok: true, data: { ...AWAITING, status: 'confirmed', target_level: 'junior' } }));
    render(<GoalClarifyForm goal={{ ...AWAITING, clarification_round: 0 }} invoke={invoke} />);
    expect(screen.queryByText(/round \d of 2/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/your goal:/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/target career level/i)).not.toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Career role options' });
    expect(group).toHaveClass('grid', 'items-stretch', 'md:grid-cols-3');
    expect(within(group).getAllByRole('radio')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: /^confirm role$/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/career-profile'));
    expect(invoke).toHaveBeenCalledWith('confirmCareerGoal', {
      id: GOAL_ID,
      body: { canonical_role_id: 'role-1', target_level: 'junior' },
    });
  });

  it('re-syncs the goal after a CLARIFICATION_LIMIT_REACHED conflict', async () => {
    const invoke = makeInvoke((op) =>
      op === 'submitGoalClarification' ? failure('CLARIFICATION_LIMIT_REACHED', 409) : { ok: true, data: AWAITING },
    );
    render(<GoalClarifyForm goal={goal({ clarification_round: 2 })} invoke={invoke} />);
    fireEvent.change(screen.getByLabelText(/your answer/i), { target: { value: 'More detail' } });
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));
    expect(await screen.findByRole('radiogroup', { name: 'Career role options' })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('getCareerGoal', { id: GOAL_ID });
    expect(screen.getByRole('alert')).toHaveTextContent(/clarification limit/i);
  });

  it('shows mapped ROLE_MISMATCH copy and stays on the page', async () => {
    const invoke = makeInvoke(() => failure('ROLE_MISMATCH', 422));
    render(<GoalClarifyForm goal={AWAITING} initialTargetLevel="junior" invoke={invoke} />);
    fireEvent.click(screen.getByRole('button', { name: /^confirm role$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not one of the proposed/i);
    expect(push).not.toHaveBeenCalled();
  });

  it('shows a recovery path when the goal could not be loaded', () => {
    render(<GoalClarifyForm goal={null} loadError="We could not find that item." invoke={makeInvoke(() => failure('RESOURCE_NOT_FOUND', 404))} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/could not find that item/i);
    expect(screen.getByRole('link', { name: /back to goal/i })).toHaveAttribute('href', '/onboarding');
  });

  it('reserves "Your choice" strictly for exact catalog/preset role selections and labels free-text or negated mentions as "Suggested"', () => {
    expect(doesGoalMatchRole('Frontend developer', 'Frontend Development')).toBe(true);
    expect(doesGoalMatchRole('Backend Development', 'Backend Development')).toBe(true);
    expect(doesGoalMatchRole('Data analyst', 'Data Engineering')).toBe(true);
    expect(doesGoalMatchRole('Backend developer, not frontend', 'Frontend Development')).toBe(false);
    expect(doesGoalMatchRole('I want to build APIs', 'Backend Development')).toBe(false);
    expect(doesGoalMatchRole('Seo Specialist', 'Backend Development')).toBe(false);
    expect(doesGoalMatchRole('constructor', 'Backend Development')).toBe(false);
    expect(doesGoalMatchRole('toString', 'Backend Development')).toBe(false);
    expect(doesGoalMatchRole('Backend developer — 前端开发', 'Backend Development')).toBe(false);

    const invoke = makeInvoke(() => ({ ok: true, data: AWAITING }));

    const { rerender } = render(
      <GoalClarifyForm
        key="matched"
        goal={{
          ...AWAITING,
          clarification_round: 0,
          goal_text: 'Frontend developer',
          proposed_role: {
            canonical_role_id: 'role-fe',
            name: 'Frontend Development',
          },
        }}
        invoke={invoke}
      />,
    );

    const matchedGroup = screen.getByRole('radiogroup', { name: 'Career role options' });
    const matchedRadios = within(matchedGroup).getAllByRole('radio');
    expect(within(matchedRadios[0]).getByText('Your choice')).toBeInTheDocument();
    expect(within(matchedRadios[0]).queryByText('Suggested')).not.toBeInTheDocument();
    expect(screen.queryByText(/closest technology tracks/i)).not.toBeInTheDocument();

    rerender(
      <GoalClarifyForm
        key="fallback"
        goal={{
          ...AWAITING,
          clarification_round: 0,
          goal_text: 'Seo Specialist',
          proposed_role: {
            canonical_role_id: 'role-be',
            name: 'Backend Development',
          },
        }}
        invoke={invoke}
      />,
    );

    const fallbackGroup = screen.getByRole('radiogroup', { name: 'Career role options' });
    const fallbackRadios = within(fallbackGroup).getAllByRole('radio');
    expect(within(fallbackRadios[0]).getByText('Suggested')).toBeInTheDocument();
    expect(within(fallbackRadios[0]).queryByText('Your choice')).not.toBeInTheDocument();
    expect(within(fallbackRadios[1]).getByText('Alternative')).toBeInTheDocument();
    expect(
      screen.getByText('Closest technology tracks for “Seo Specialist”:'),
    ).toBeInTheDocument();
  });
});

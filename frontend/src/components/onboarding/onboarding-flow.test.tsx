import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  ApiError,
  type CareerGoalResponse,
  type ProfileResponse,
} from '@/lib/api/client';
import { mapApiError, type M05Invoke } from '@/lib/api/error-mapper';
import { SkillsSetupForm, validateNewSkill } from './skills-setup-form';
import { PreferencesSetupForm } from './preferences-setup-form';
import { GoalSetupForm, codePointLength, validateBoundedText } from './goal-setup-form';
import { GoalClarifyForm } from './goal-clarify-form';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
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
});

describe('Screen 08 — SkillsSetupForm', () => {
  it('renders Step 2 of 5, adds skills (Enter key too) and saves names via EP-P02', async () => {
    const invoke = makeInvoke(() => ({ ok: true, data: profile() }));
    render(<SkillsSetupForm initialProfile={profile()} invoke={invoke} />);
    expect(screen.getByRole('progressbar', { name: /step 2 of 5/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save & next/i })).toBeDisabled();

    const input = screen.getByLabelText('Add a skill');
    fireEvent.change(input, { target: { value: 'React' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'react' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add skill' }));
    expect(screen.getByText('That skill is already in your list.')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'SQL' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add skill' }));
    expect(screen.getByText('2 of 100 skills')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/preferences'));
    expect(invoke).toHaveBeenCalledWith('updateSkills', { names: ['React', 'SQL'] });
  });

  it('enforces the 100-skill cap with clear feedback', () => {
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
    expect(screen.getByText('100 of 100 skills')).toBeInTheDocument();
    expect(screen.getByLabelText('Add a skill')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add skill' })).toBeDisabled();
    expect(screen.getByText(/reached the limit of 100 skills/i)).toBeInTheDocument();
    expect(validateNewSkill('Extra', many.map((s) => s.name))).toMatch(/up to 100 skills/i);
    expect(validateNewSkill('x'.repeat(81), [])).toMatch(/at most 80/i);
    expect(validateNewSkill('   ', [])).toMatch(/enter a skill/i);
  });

  it('submits explicit None (R07) with no skills, clearing tags and blocking additions', async () => {
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
    const toggle = screen.getByRole('switch', { name: /none \/ no prior technical skills/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('list', { name: 'Your skills' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Add a skill')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/preferences'));
    expect(invoke).toHaveBeenCalledWith('updateSkills', { none: true });
  });

  it('keeps Save disabled until a skill or None is chosen', () => {
    render(
      <SkillsSetupForm initialProfile={profile()} invoke={makeInvoke(() => ({ ok: true, data: profile() }))} />,
    );
    expect(screen.getByRole('button', { name: /save & next/i })).toBeDisabled();
    expect(screen.getByText(/add at least one skill/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByRole('button', { name: /save & next/i })).toBeEnabled();
  });

  it('removes a skill from the list', () => {
    render(
      <SkillsSetupForm initialProfile={profile()} invoke={makeInvoke(() => ({ ok: true, data: profile() }))} />,
    );
    fireEvent.change(screen.getByLabelText('Add a skill'), { target: { value: 'Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add skill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove skill Go' }));
    expect(screen.queryByRole('button', { name: 'Remove skill Go' })).not.toBeInTheDocument();
    expect(screen.getByText('0 of 100 skills')).toBeInTheDocument();
  });

  it('resolves unresolved aliases via EP-P05 before continuing', async () => {
    const invoke = makeInvoke((op) => {
      if (op === 'updateSkills') {
        return {
          ok: true,
          data: profile({
            unresolved_skills: [
              { input: 'node', candidates: [{ skill_id: 'sk-node', name: 'Node.js' }, { skill_id: 'sk-nodered', name: 'Node-RED' }] },
            ],
          }),
        };
      }
      return { ok: true, data: { input: 'node', skill_id: 'sk-node', scope: 'user', added_to_profile: true, progress_initialization: 'deferred_until_level_confirmation' } };
    });
    render(<SkillsSetupForm initialProfile={profile()} invoke={invoke} />);
    fireEvent.change(screen.getByLabelText('Add a skill'), { target: { value: 'node' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add skill' }));
    fireEvent.click(screen.getByRole('button', { name: /save & next/i }));

    const panel = await screen.findByRole('region', { name: 'Skill clarification' });
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole('button', { name: 'Node.js' }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('interpretSkillAlias', { input: 'node', skill_id: 'sk-node' }),
    );
    const next = await screen.findByRole('button', { name: /continue to preferences/i });
    fireEvent.click(next);
    expect(push).toHaveBeenCalledWith('/onboarding/preferences');
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
    const practiceSwitch = screen.getByRole('switch', { name: /prioritize interactive hands-on practice/i });
    expect(practiceSwitch).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(practiceSwitch);
    expect(practiceSwitch).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/goal'));
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

  it('shows a live code-point counter and blocks too-short goals before calling the API', () => {
    const invoke = makeInvoke(() => ({ ok: true, data: goal() }));
    render(<GoalSetupForm invoke={invoke} />);
    expect(screen.getByRole('progressbar', { name: /step 4 of 5/i })).toBeInTheDocument();
    const textarea = screen.getByLabelText(/career goal/i);
    fireEvent.change(textarea, { target: { value: '😀😀' } });
    expect(screen.getByText(/2 \/ 300 characters/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));
    expect(screen.getByText(/must be at least 3 characters/i)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('submits EP-C01 and routes to /onboarding/clarify?goalId= for clarifying and awaiting goals', async () => {
    const invoke = makeInvoke(() => ({ ok: true, data: goal({ id: GOAL_ID, status: 'awaiting_confirmation' }) }));
    render(<GoalSetupForm invoke={invoke} />);
    fireEvent.change(screen.getByLabelText(/career goal/i), { target: { value: '  Backend developer  ' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/onboarding/clarify?goalId=${GOAL_ID}`));
    expect(invoke).toHaveBeenCalledWith('createCareerGoal', { goal_text: 'Backend developer' });
  });

  it('fills the textarea from example role chips', () => {
    render(<GoalSetupForm invoke={makeInvoke(() => ({ ok: true, data: goal() }))} />);
    fireEvent.click(screen.getByRole('button', { name: 'Data analyst' }));
    expect(screen.getByLabelText(/career goal/i)).toHaveValue('Data analyst');
  });

  it('renders actionable guidance for OUT_OF_SCOPE_GOAL (422) and keeps the input', async () => {
    const invoke = makeInvoke(() => failure('OUT_OF_SCOPE_GOAL', 422));
    render(<GoalSetupForm invoke={invoke} />);
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
    const invoke = makeInvoke(() => failure('ROADMAP_LIMIT_REACHED', 409));
    render(<GoalSetupForm invoke={invoke} />);
    fireEvent.change(screen.getByLabelText(/career goal/i), { target: { value: 'Backend developer' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/3 active goals/i);
    expect(screen.getByRole('link', { name: /manage your goals/i })).toHaveAttribute('href', '/career-profile');
  });
});

describe('Screen 11 — GoalClarifyForm', () => {
  it('shows the question, round counter and runs clarifying → awaiting_confirmation → confirm', async () => {
    const invoke = makeInvoke((op) => {
      if (op === 'submitGoalClarification') return { ok: true, data: AWAITING };
      if (op === 'confirmCareerGoal') return { ok: true, data: { ...AWAITING, status: 'confirmed', target_level: 'mid' } };
      return failure('RESOURCE_NOT_FOUND', 404);
    });
    render(<GoalClarifyForm goal={goal()} invoke={invoke} />);
    expect(screen.getByRole('progressbar', { name: /step 5 of 5/i })).toBeInTheDocument();
    expect(screen.getByText('Round 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Which part of backend interests you most?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));
    expect(screen.getByText(/enter your answer/i)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/your answer/i), { target: { value: 'Server-side APIs' } });
    expect(screen.getByText('16 / 300 characters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));

    const group = await screen.findByRole('radiogroup', { name: 'Career role options' });
    expect(invoke).toHaveBeenCalledWith('submitGoalClarification', { id: GOAL_ID, body: { answer: 'Server-side APIs' } });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true'); // proposed role preselected
    expect(within(radios[0]).getByText('Recommended')).toBeInTheDocument();
    expect(within(radios[1]).getByText('Infra overlap')).toBeInTheDocument(); // R29 rationale
    expect(within(radios[2]).queryByText(/null/i)).not.toBeInTheDocument(); // null rationale
    expect(screen.getByText(/best interpretation/i)).toBeInTheDocument(); // round-2 cap copy

    const confirmBtn = screen.getByRole('button', { name: /confirm role & level/i });
    expect(confirmBtn).toBeDisabled(); // explicit level required
    fireEvent.click(radios[1]);
    fireEvent.change(screen.getByLabelText(/target career level/i), { target: { value: 'mid' } });
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/career-profile'));
    expect(invoke).toHaveBeenLastCalledWith('confirmCareerGoal', {
      id: GOAL_ID,
      body: { canonical_role_id: 'role-2', target_level: 'mid' },
    });
  });

  it('handles a goal that is already awaiting_confirmation (no clarification step)', () => {
    render(<GoalClarifyForm goal={{ ...AWAITING, clarification_round: 0 }} invoke={makeInvoke(() => failure('RESOURCE_NOT_FOUND', 404))} />);
    expect(screen.queryByText(/round \d of 2/i)).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Career role options' })).toBeInTheDocument();
    expect(screen.getByText(/suggested level: junior/i)).toBeInTheDocument();
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
    render(<GoalClarifyForm goal={AWAITING} invoke={invoke} />);
    fireEvent.change(screen.getByLabelText(/target career level/i), { target: { value: 'junior' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm role & level/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not one of the proposed/i);
    expect(push).not.toHaveBeenCalled();
  });

  it('shows a recovery path when the goal could not be loaded', () => {
    render(<GoalClarifyForm goal={null} loadError="We could not find that item." invoke={makeInvoke(() => failure('RESOURCE_NOT_FOUND', 404))} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/could not find that item/i);
    expect(screen.getByRole('link', { name: /back to goal/i })).toHaveAttribute('href', '/onboarding/goal');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  ApiError,
  type CareerGoalResponse,
  type GoalStatus,
  type ProfileResponse,
} from '@/lib/api/client';
import { mapApiError, type M05Invoke } from '@/lib/api/error-mapper';
import { CareerProfileView } from './career-profile-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function goal(id: string, status: GoalStatus, text: string, extra: Partial<CareerGoalResponse> = {}): CareerGoalResponse {
  return {
    id,
    goal_text: text,
    status,
    clarification_round: status === 'clarifying' ? 1 : 0,
    clarification_question: status === 'clarifying' ? 'Which area?' : null,
    proposed_role: status === 'clarifying' ? null : { canonical_role_id: 'r1', name: 'Backend Development' },
    alternative_roles: [],
    suggested_level: null,
    target_level: status === 'confirmed' ? 'mid' : null,
    roadmap_id: null,
    created_at: '2026-11-01T00:00:00.000Z',
    ...extra,
  };
}

const GOALS: CareerGoalResponse[] = [
  goal('g-discontinued', 'discontinued', 'Old mobile goal'),
  goal('g-clarifying', 'clarifying', 'Something with AI'),
  goal('g-confirmed', 'confirmed', 'Backend developer'),
  goal('g-awaiting', 'awaiting_confirmation', 'Data analyst'),
];

const PROFILE: ProfileResponse = {
  current_role: 'Student',
  education: null,
  experience_level: 'junior',
  existing_skills: [
    { skill_id: 's1', name: 'React', alias_resolved: false, learning_state: 'learning', source: 'self_reported' },
    { skill_id: 's2', name: 'Next.js', alias_resolved: false, learning_state: 'learning', source: 'self_reported' },
  ],
  existing_skills_none: false,
  learning_preference: 'hands_on',
  preferred_daily_hours: 2,
  timezone: 'Asia/Dhaka',
  timezone_detected: true,
  active_career_goal_ids: [],
  profile_complete: false,
  missing_fields: [],
  updated_at: '2026-11-01T00:00:00.000Z',
};

function makeInvoke(handler: (op: string, input: unknown) => unknown) {
  const fn = vi.fn(async (op: string, input: unknown) => handler(op, input));
  return fn as unknown as M05Invoke & typeof fn;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe('Screen 14 — CareerProfileView', () => {
  it('groups goals by status with text badges and resume links', () => {
    render(
      <CareerProfileView initialGoals={GOALS} profile={PROFILE} invoke={makeInvoke(() => ({ ok: true, data: {} }))} />,
    );
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Confirmed goals (1)',
      'Awaiting confirmation (1)',
      'Needs clarification (1)',
      'Discontinued goals (1)',
    ]);
    const confirmed = screen.getByText('Backend developer').closest('li')!;
    expect(within(confirmed).getByText('Confirmed')).toBeInTheDocument();
    expect(
      within(confirmed).getByText(/Roadmap: Backend Development · Level: Mid/),
    ).toBeInTheDocument();

    const clarifying = screen.getByText('Something with AI').closest('li')!;
    const resumeBtn = within(clarifying).getByRole('button', { name: 'Resume clarification' });
    expect(resumeBtn).toHaveClass('h-8');
    const awaiting = screen.getByText('Data analyst').closest('li')!;
    expect(within(awaiting).getByText(/Suggested roadmap: Backend Development/)).toBeInTheDocument();
    const reviewBtn = within(awaiting).getByRole('button', { name: 'Review & confirm' });
    expect(reviewBtn).toHaveClass('h-8');
    expect(within(awaiting).getByRole('button', { name: 'Edit goal text' })).toHaveClass('h-8');
    expect(within(awaiting).getByRole('button', { name: /discontinue/i })).toHaveClass('h-8');

    // Discontinued archive is collapsed by default and expands on click
    const archiveToggle = screen.getByRole('button', { name: /discontinued goals \(1\)/i });
    expect(archiveToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Old mobile goal')).not.toBeInTheDocument();
    fireEvent.click(archiveToggle);
    expect(archiveToggle).toHaveAttribute('aria-expanded', 'true');
    const discontinued = screen.getByText('Old mobile goal').closest('li')!;
    expect(within(discontinued).getByText('Discontinued')).toBeInTheDocument();
    expect(within(discontinued).getByText(/Roadmap: Backend Development/)).toBeInTheDocument();
    expect(
      within(discontinued).getByText('Progress & shared skill evidence preserved'),
    ).toBeInTheDocument();
    expect(within(discontinued).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows skills, preferences, links Edit profile to /profile, and supports inline editing for skills and preferences', async () => {
    const updatedSkillsProfile: ProfileResponse = {
      ...PROFILE,
      existing_skills: [
        ...PROFILE.existing_skills,
        { skill_id: 's3', name: 'SQL', alias_resolved: false, learning_state: 'learning', source: 'self_reported' },
      ],
    };
    const updatedPrefsProfile: ProfileResponse = {
      ...updatedSkillsProfile,
      learning_preference: 'visual',
    };
    const invoke = makeInvoke((op) => {
      if (op === 'updateSkills') return { ok: true, data: updatedSkillsProfile };
      if (op === 'updatePreferences') return { ok: true, data: updatedPrefsProfile };
      if (op === 'interpretSkillAlias') return { ok: true, data: { input: 'boss', candidates: [] } };
      return { ok: true, data: {} };
    });

    render(<CareerProfileView initialGoals={[]} profile={PROFILE} invoke={invoke} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Skills (2)' })).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('Next.js')).toBeInTheDocument();
    // Self-reported skills at learning_state='learning' show calm "Self-reported" badge + explanatory tooltip
    const selfReportedBadges = screen.getAllByText('Self-reported');
    expect(selfReportedBadges).toHaveLength(2);
    expect(selfReportedBadges[0].closest('span[title]')).toHaveAttribute(
      'title',
      'Self-reported skill — starts at Learning until verified by practice',
    );
    // Valid existing_skills with alias_resolved: false must NEVER render "Needs clarification"
    expect(screen.queryByText('Needs clarification')).not.toBeInTheDocument();
    expect(screen.getByText('Hands-on')).toBeInTheDocument();
    expect(screen.getByText('2 h')).toBeInTheDocument();
    expect(screen.getByText('Asia/Dhaka')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit profile' })).toHaveAttribute('href', '/profile');
    expect(screen.getByText(/no career goals yet/i)).toBeInTheDocument();

    // Edit skills opens inside Compound Modal (role="dialog", name="Edit skills") -> fires Toast & closes modal
    fireEvent.click(screen.getByRole('button', { name: 'Edit skills' }));
    const skillsDialog = screen.getByRole('dialog', { name: 'Edit skills' });
    const skillInput = within(skillsDialog).getByLabelText('Add a skill');

    // Adding an unrecognized custom skill ("Boss") immediately calls interpretSkillAlias, does NOT add "Boss" to the chip list, renders NO Remove button, and shows inline warning message
    fireEvent.change(skillInput, { target: { value: 'Boss' } });
    fireEvent.keyDown(skillInput, { key: 'Enter' });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('interpretSkillAlias', {
        input: 'Boss',
        skill_id: '',
      }),
    );
    expect(await within(skillsDialog).findByText('“Boss” is not a recognized skill.')).toBeInTheDocument();
    const chipList = within(skillsDialog).getByRole('list', { name: 'Your skills' });
    expect(within(chipList).queryByText('Boss')).not.toBeInTheDocument();
    expect(within(skillsDialog).queryByRole('button', { name: /remove “?boss”?/i })).not.toBeInTheDocument();

    // Typing / selecting a valid skill ("SQL") automatically clears the unrecognized message
    fireEvent.change(skillInput, { target: { value: 'SQL' } });
    expect(within(skillsDialog).queryByText('“Boss” is not a recognized skill.')).not.toBeInTheDocument();
    fireEvent.keyDown(skillInput, { key: 'Enter' });
    fireEvent.click(within(skillsDialog).getByRole('button', { name: 'Save Skills' }));
    await waitFor(() => expect(screen.getByText('SQL')).toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: 'Edit skills' })).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('updateSkills', { names: ['React', 'Next.js', 'SQL'] });
    expect(screen.getByTestId('toast-container')).toHaveTextContent('Skills updated.');
    expect(screen.getByTestId('toast-countdown-bar')).toBeInTheDocument();

    // Edit preferences opens inside Compound Modal (role="dialog", name="Edit learning preferences") -> fires Toast & closes modal
    fireEvent.click(screen.getByRole('button', { name: 'Edit preferences' }));
    const prefsDialog = screen.getByRole('dialog', { name: 'Edit learning preferences' });
    fireEvent.click(within(prefsDialog).getByRole('radio', { name: /^Visual/ }));
    fireEvent.click(within(prefsDialog).getByRole('button', { name: 'Save Preferences' }));
    await waitFor(() => expect(screen.getByText('Visual')).toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: 'Edit learning preferences' })).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('updatePreferences', { learning_preference: 'visual' });
    expect(screen.getByTestId('toast-container')).toHaveTextContent('Learning preferences updated.');
  });

  it('shows the explicit-None message when the profile declares no skills', () => {
    render(
      <CareerProfileView
        initialGoals={[]}
        profile={{ ...PROFILE, existing_skills: [], existing_skills_none: true }}
        invoke={makeInvoke(() => ({ ok: true, data: {} }))}
      />,
    );
    expect(screen.getByText(/no prior technical skills/i)).toBeInTheDocument();
  });

  it('blocks EP-C06 edit on confirmed goals (no edit control, explanatory note)', () => {
    render(
      <CareerProfileView
        initialGoals={[goal('g-confirmed', 'confirmed', 'Backend developer')]}
        profile={PROFILE}
        invoke={makeInvoke(() => ({ ok: true, data: {} }))}
      />,
    );
    expect(screen.queryByRole('button', { name: /edit goal text/i })).not.toBeInTheDocument();
    expect(screen.getByText(/confirmed goal text cannot be edited/i)).toBeInTheDocument();
  });

  it('edits an unconfirmed goal via EP-C06 with code-point validation and updates the row', async () => {
    const updated = goal('g-clarifying', 'awaiting_confirmation', 'Machine learning engineer');
    const invoke = makeInvoke(() => ({ ok: true, data: updated }));
    render(<CareerProfileView initialGoals={[goal('g-clarifying', 'clarifying', 'Something with AI')]} profile={PROFILE} invoke={invoke} />);

    fireEvent.click(screen.getByRole('button', { name: /edit goal text/i }));
    const field = screen.getByLabelText('Edit goal');
    expect(field).toHaveValue('Something with AI');
    fireEvent.change(field, { target: { value: '😀😀' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));
    expect(screen.getByText(/at least 3 characters/i)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '  Machine learning engineer ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));
    await waitFor(() => expect(screen.getByText('Machine learning engineer')).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith('updateCareerGoal', {
      id: 'g-clarifying',
      body: { goal_text: 'Machine learning engineer' },
    });
    expect(screen.getByText('Goal updated.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit goal')).not.toBeInTheDocument();
  });

  it('maps GOAL_ALREADY_CONFIRMED on a stale edit to safe copy', async () => {
    const invoke = makeInvoke(() => ({
      ok: false,
      error: mapApiError(new ApiError(409, 'raw', 'GOAL_ALREADY_CONFIRMED')),
    }));
    render(<CareerProfileView initialGoals={[goal('g1', 'awaiting_confirmation', 'Data analyst')]} profile={PROFILE} invoke={invoke} />);
    fireEvent.click(screen.getByRole('button', { name: /edit goal text/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already confirmed/i);
  });

  it('requires confirmation before EP-C07 discontinue, then refreshes the list via EP-C02', async () => {
    const refreshed = [
      goal('g-awaiting', 'awaiting_confirmation', 'Data analyst'),
      goal('g-confirmed', 'discontinued', 'Backend developer'),
    ];
    const invoke = makeInvoke((op) => {
      if (op === 'deleteCareerGoal') {
        return { ok: true, data: { id: 'g-confirmed', status: 'discontinued', archived_roadmap_id: 'rm1', new_focus_roadmap_id: null } };
      }
      return { ok: true, data: { items: refreshed, meta: { limit: 100, next_cursor: null } } };
    });
    render(<CareerProfileView initialGoals={GOALS} profile={PROFILE} invoke={invoke} />);

    const row = screen.getByText('Backend developer').closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: /discontinue goal/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/roadmap will be archived/i);
    expect(dialog).toHaveTextContent(/focus will move/i);
    expect(dialog).toHaveTextContent(/progress and learning evidence are kept/i);
    expect(invoke).not.toHaveBeenCalled(); // nothing happens before explicit confirm

    fireEvent.click(within(dialog).getByRole('button', { name: 'Discontinue goal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(invoke).toHaveBeenNthCalledWith(1, 'deleteCareerGoal', { id: 'g-confirmed' });
    expect(invoke).toHaveBeenNthCalledWith(2, 'listCareerGoals', { limit: 100 });
    expect(screen.getByText(/goal discontinued/i)).toBeInTheDocument();
    expect(screen.queryByText('Something with AI')).not.toBeInTheDocument(); // list replaced by refresh
    expect(screen.getByRole('heading', { level: 3, name: 'Discontinued goals (1)' })).toBeInTheDocument();
  });

  it('cancelling the dialog never calls EP-C07', () => {
    const invoke = makeInvoke(() => ({ ok: true, data: {} }));
    render(<CareerProfileView initialGoals={[goal('g1', 'confirmed', 'Backend developer')]} profile={PROFILE} invoke={invoke} />);
    fireEvent.click(screen.getByRole('button', { name: /discontinue goal: backend developer/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('falls back to a local discontinued mark when the refresh read fails', async () => {
    const invoke = makeInvoke((op) =>
      op === 'deleteCareerGoal'
        ? { ok: true, data: { id: 'g1', status: 'discontinued', archived_roadmap_id: null, new_focus_roadmap_id: null } }
        : { ok: false, error: mapApiError(new ApiError(503, 'x')) },
    );
    render(<CareerProfileView initialGoals={[goal('g1', 'confirmed', 'Backend developer')]} profile={PROFILE} invoke={invoke} />);
    fireEvent.click(screen.getByRole('button', { name: /discontinue goal: backend developer/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discontinue goal' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Discontinued goals (1)' })).toBeInTheDocument();
  });

  it('disables adding a fourth active goal with Info icon + accessible tooltip (showing actual count) and opens inline 2-step Add a career goal flow when under cap', () => {
    const three = [goal('a', 'confirmed', 'A'), goal('b', 'confirmed', 'B'), goal('c', 'clarifying', 'C'), goal('d', 'discontinued', 'D')];
    const { unmount } = render(<CareerProfileView initialGoals={three} profile={PROFILE} invoke={makeInvoke(() => ({ ok: true, data: {} }))} />);
    const disabledAddBtn = screen.getByRole('button', { name: 'Add a career goal' });
    expect(disabledAddBtn).toHaveAttribute('aria-disabled', 'true');
    expect(disabledAddBtn).toHaveAttribute('aria-describedby', 'goal-limit-tooltip');
    expect(disabledAddBtn).toHaveClass('bg-slate-100', 'text-slate-400', 'cursor-not-allowed', 'select-none');
    const capacityPill = screen.getByText('3 / 3 active');
    expect(capacityPill).toBeInTheDocument();
    expect(capacityPill).toHaveClass('border-emerald-200', 'bg-emerald-50', 'text-emerald-700');
    expect(screen.getByRole('complementary', { name: 'Skills and learning preferences' })).toBeInTheDocument();
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip).toHaveAttribute('id', 'goal-limit-tooltip');
    expect(tooltip).toHaveTextContent(
      'You have 3 active goals (maximum 3). Discontinue one to add another.',
    );
    fireEvent.click(disabledAddBtn);
    expect(screen.queryByRole('region', { name: 'Add a career goal' })).not.toBeInTheDocument();
    unmount();
    render(<CareerProfileView initialGoals={three.slice(0, 2)} profile={PROFILE} invoke={makeInvoke(() => ({ ok: true, data: {} }))} />);
    expect(screen.getByText('2 / 3 active')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a career goal' }));
    expect(screen.queryByRole('dialog', { name: 'Add a career goal' })).not.toBeInTheDocument();
    const inlineRegion = screen.getByRole('region', { name: 'Add a career goal' });
    expect(inlineRegion).toBeInTheDocument();
    expect(
      within(inlineRegion).getByRole('progressbar', {
        name: /add career goal progress: step 1 of 2/i,
      }),
    ).toBeInTheDocument();
    expect(within(inlineRegion).getByText('1. Career Goal')).toBeInTheDocument();
    expect(within(inlineRegion).getByText('2. Confirm Role')).toBeInTheDocument();
    fireEvent.click(within(inlineRegion).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', { name: 'Add a career goal' })).not.toBeInTheDocument();
  });

  it('shows load errors without hiding the other section and loads more goals', async () => {
    const invoke = makeInvoke(() => ({
      ok: true,
      data: { items: [goal('g2', 'confirmed', 'Second page goal')], meta: { limit: 100, next_cursor: null } },
    }));
    render(
      <CareerProfileView
        initialGoals={[goal('g1', 'confirmed', 'First page goal')]}
        initialNextCursor="cur1"
        profile={null}
        profileError="We could not load your profile."
        invoke={invoke}
      />,
    );
    expect(screen.getByText('We could not load your profile.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show more goals' }));
    expect(await screen.findByText('Second page goal')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('listCareerGoals', { limit: 100, cursor: 'cur1' });
    expect(screen.queryByRole('button', { name: 'Show more goals' })).not.toBeInTheDocument();
  });

  it('restores the user-selected target level when reopening Review & confirm after closing the panel', async () => {
    const createdGoal = goal('g-new', 'awaiting_confirmation', 'Backend developer', {
      suggested_level: 'junior',
      target_level: null,
    });
    const invoke = makeInvoke((op) => {
      if (op === 'updateLearningSettings') return { ok: true, data: PROFILE };
      if (op === 'createCareerGoal') return { ok: true, data: createdGoal };
      if (op === 'confirmCareerGoal') {
        return { ok: true, data: { ...createdGoal, status: 'confirmed', target_level: 'senior' } };
      }
      return { ok: true, data: {} };
    });

    render(<CareerProfileView initialGoals={[]} profile={PROFILE} userId="u-1" invoke={invoke} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a career goal' }));
    fireEvent.change(screen.getByRole('combobox', { name: /career goal/i }), {
      target: { value: 'Backend developer' },
    });
    fireEvent.change(screen.getByLabelText(/target career level/i), {
      target: { value: 'senior' },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));

    const confirmRegion = await screen.findByRole('region', { name: 'Review and confirm career goal' });
    expect(confirmRegion).toBeInTheDocument();
    expect(
      within(confirmRegion).getByRole('progressbar', {
        name: /add career goal progress: step 2 of 2/i,
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back to goal/i }));
    expect(screen.queryByRole('region', { name: 'Review and confirm career goal' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review & confirm' }));
    fireEvent.click(screen.getByRole('button', { name: /^confirm role$/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('confirmCareerGoal', {
        id: 'g-new',
        body: { canonical_role_id: 'r1', target_level: 'senior' },
      }),
    );
  });

  it('invalidates the open confirmation panel when its goal is edited or discontinued without affecting other goals', async () => {
    const goalA = goal('g-a', 'awaiting_confirmation', 'Data analyst');
    const goalB = goal('g-b', 'awaiting_confirmation', 'Frontend developer', {
      proposed_role: { canonical_role_id: 'r2', name: 'Frontend Development' },
    });
    const invoke = makeInvoke((op) => {
      if (op === 'updateCareerGoal') {
        return { ok: true, data: { ...goalA, goal_text: 'Data engineer' } };
      }
      if (op === 'deleteCareerGoal') {
        return { ok: true, data: { id: 'g-a', status: 'discontinued', archived_roadmap_id: null, new_focus_roadmap_id: null } };
      }
      if (op === 'listCareerGoals') {
        return { ok: true, data: { items: [{ ...goalA, status: 'discontinued' }, goalB], meta: { limit: 100, next_cursor: null } } };
      }
      return { ok: true, data: {} };
    });

    render(<CareerProfileView initialGoals={[goalA, goalB]} profile={PROFILE} invoke={invoke} />);

    // Open confirmation panel for goalA, then edit goalA -> panel closes
    const rowA = screen.getByText('Data analyst').closest('li')!;
    fireEvent.click(within(rowA).getByRole('button', { name: 'Review & confirm' }));
    expect(screen.getByRole('region', { name: 'Review and confirm career goal' })).toBeInTheDocument();
    fireEvent.click(within(rowA).getByRole('button', { name: 'Edit goal text' }));
    fireEvent.change(screen.getByLabelText('Edit goal'), { target: { value: 'Data engineer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));
    await waitFor(() => expect(screen.getByText('Data engineer')).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Review and confirm career goal' })).not.toBeInTheDocument();

    // Open confirmation panel for goalB, then discontinue goalA -> goalB's panel stays open
    const rowB = screen.getByText('Frontend developer').closest('li')!;
    fireEvent.click(within(rowB).getByRole('button', { name: 'Review & confirm' }));
    expect(screen.getByRole('region', { name: 'Review and confirm career goal' })).toBeInTheDocument();
    const updatedRowA = screen.getByText('Data engineer').closest('li')!;
    fireEvent.click(within(updatedRowA).getByRole('button', { name: /discontinue goal/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discontinue goal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Review and confirm career goal' })).toBeInTheDocument();
  });

  it('keeps late clarification results from Goal A out of Goal B panel when switching goals mid-flight', async () => {
    let resolveA!: (value: unknown) => void;
    const goalA = goal('g-a', 'clarifying', 'Something with AI');
    const goalB = goal('g-b', 'awaiting_confirmation', 'Frontend developer', {
      proposed_role: { canonical_role_id: 'r2', name: 'Frontend Development' },
      suggested_level: 'mid',
    });
    const invoke = makeInvoke((op) => {
      if (op === 'submitGoalClarification') {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return { ok: true, data: {} };
    });

    render(<CareerProfileView initialGoals={[goalA, goalB]} profile={PROFILE} invoke={invoke} />);
    const rowA = screen.getByText('Something with AI').closest('li')!;
    fireEvent.click(within(rowA).getByRole('button', { name: 'Resume clarification' }));
    fireEvent.change(screen.getByLabelText(/your answer/i), { target: { value: 'LLM engineering' } });
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));

    // Switch to Goal B while Goal A's clarification is still in flight
    const rowB = screen.getByText('Frontend developer').closest('li')!;
    fireEvent.click(within(rowB).getByRole('button', { name: 'Review & confirm' }));
    const panel = screen.getByRole('region', { name: 'Review and confirm career goal' });
    expect(within(panel).getByText('Frontend Development')).toBeInTheDocument();

    // Goal A resolves late -> Goal A row updates, Goal B panel stays intact
    await act(async () => {
      resolveA({
        ok: true,
        data: {
          ...goalA,
          status: 'awaiting_confirmation',
          proposed_role: { canonical_role_id: 'r-ai', name: 'AI Engineering' },
        },
      });
    });
    await waitFor(() => expect(screen.getByText(/Suggested roadmap: AI Engineering/)).toBeInTheDocument());
    expect(within(screen.getByRole('region', { name: 'Review and confirm career goal' })).getByText('Frontend Development')).toBeInTheDocument();
  });

  it('merges Skills and Preferences slices independently during concurrent inline saves', async () => {
    let resolveSkills!: (value: unknown) => void;
    let resolvePrefs!: (value: unknown) => void;
    const invoke = makeInvoke((op) => {
      if (op === 'updateSkills') {
        return new Promise((resolve) => {
          resolveSkills = resolve;
        });
      }
      if (op === 'updatePreferences') {
        return new Promise((resolve) => {
          resolvePrefs = resolve;
        });
      }
      return { ok: true, data: {} };
    });

    render(<CareerProfileView initialGoals={[]} profile={PROFILE} invoke={invoke} />);

    // Open both Skills and Preferences inline editors simultaneously
    fireEvent.click(screen.getByRole('button', { name: 'Edit skills' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit preferences' }));

    const skillInput = screen.getByLabelText('Add a skill');
    fireEvent.change(skillInput, { target: { value: 'SQL' } });
    fireEvent.keyDown(skillInput, { key: 'Enter' });
    fireEvent.click(screen.getByRole('radio', { name: /^Visual/ }));

    // Trigger both saves concurrently
    fireEvent.click(screen.getByRole('button', { name: 'Save Skills' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }));

    // Preferences resolves first with old skills, then Skills resolves later with old preferences
    await act(async () => {
      resolvePrefs({
        ok: true,
        data: {
          ...PROFILE,
          learning_preference: 'visual',
          updated_at: '2026-11-02T00:00:00.000Z',
        },
      });
      resolveSkills({
        ok: true,
        data: {
          ...PROFILE,
          existing_skills: [
            ...PROFILE.existing_skills,
            { skill_id: 's3', name: 'SQL', alias_resolved: false, learning_state: 'learning', source: 'self_reported' },
          ],
          learning_preference: 'hands_on', // stale preference in skills response must NOT wipe 'visual'
          updated_at: '2026-11-01T23:59:59.000Z',
        },
      });
    });

    await waitFor(() => expect(screen.getByText('SQL')).toBeInTheDocument());
    expect(screen.getByText('Visual')).toBeInTheDocument();
  });

  it('ignores late clarification responses for a goal that was edited after clarification began', async () => {
    let resolveClarify!: (value: unknown) => void;
    const goalA = goal('g-a', 'clarifying', 'Something with AI');
    const invoke = makeInvoke((op) => {
      if (op === 'submitGoalClarification') {
        return new Promise((resolve) => {
          resolveClarify = resolve;
        });
      }
      if (op === 'updateCareerGoal') {
        return {
          ok: true,
          data: {
            ...goalA,
            goal_text: 'Edited Cloud Architect',
            status: 'awaiting_confirmation',
            proposed_role: { canonical_role_id: 'r-cloud', name: 'Cloud Engineering' },
          },
        };
      }
      return { ok: true, data: {} };
    });

    render(<CareerProfileView initialGoals={[goalA]} profile={PROFILE} invoke={invoke} />);
    const rowA = screen.getByText('Something with AI').closest('li')!;
    fireEvent.click(within(rowA).getByRole('button', { name: 'Resume clarification' }));
    fireEvent.change(screen.getByLabelText(/your answer/i), { target: { value: 'Old answer' } });
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));

    // Edit goalA while clarification is in flight -> bumps goal revision & closes panel
    fireEvent.click(within(rowA).getByRole('button', { name: 'Edit goal text' }));
    fireEvent.change(screen.getByLabelText('Edit goal'), { target: { value: 'Edited Cloud Architect' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));
    await waitFor(() => expect(screen.getByText('Edited Cloud Architect')).toBeInTheDocument());

    // Late clarification response arrives -> MUST be ignored so edited goal is not overwritten
    await act(async () => {
      resolveClarify({
        ok: true,
        data: {
          ...goalA,
          goal_text: 'Something with AI',
          status: 'awaiting_confirmation',
          proposed_role: { canonical_role_id: 'r-ai', name: 'AI Engineering' },
        },
      });
    });
    expect(screen.getByText('Edited Cloud Architect')).toBeInTheDocument();
    expect(screen.queryByText(/Suggested roadmap: AI Engineering/)).not.toBeInTheDocument();
  });

  it('does not hijack another goal review panel when inline Add Goal resolves late, and isolates inline drafts from onboarding drafts', async () => {
    window.sessionStorage.setItem(
      'mentor_onboarding_goal_draft:u-scope',
      JSON.stringify({ goal: 'Onboarding Draft Goal', dailyHours: '4', targetLevel: 'mid', goalId: 'g-onb' }),
    );
    let resolveCreate!: (value: unknown) => void;
    const existingGoal = goal('g-b', 'awaiting_confirmation', 'Frontend developer', {
      proposed_role: { canonical_role_id: 'r2', name: 'Frontend Development' },
    });
    const invoke = makeInvoke((op) => {
      if (op === 'updateLearningSettings') return { ok: true, data: { ...PROFILE, preferred_daily_hours: 3 } };
      if (op === 'createCareerGoal') {
        return new Promise((resolve) => {
          resolveCreate = resolve;
        });
      }
      return { ok: true, data: {} };
    });

    render(<CareerProfileView initialGoals={[existingGoal]} profile={PROFILE} userId="u-scope" invoke={invoke} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a career goal' }));

    // Onboarding draft must NOT be cleared or loaded into inline form
    expect(screen.getByRole('combobox', { name: /career goal/i })).toHaveValue('');
    expect(window.sessionStorage.getItem('mentor_onboarding_goal_draft:u-scope')).toContain('Onboarding Draft Goal');

    fireEvent.change(screen.getByRole('combobox', { name: /career goal/i }), { target: { value: 'AI engineer' } });
    fireEvent.change(screen.getByLabelText(/preferred daily hours/i), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/target career level/i), { target: { value: 'senior' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));

    await waitFor(() => expect(typeof resolveCreate).toBe('function'));

    // While inline create is pending, user switches to Goal B's review panel
    const rowB = screen.getByText('Frontend developer').closest('li')!;
    fireEvent.click(within(rowB).getByRole('button', { name: 'Review & confirm' }));
    expect(within(screen.getByRole('region', { name: 'Review and confirm career goal' })).getByText('Frontend Development')).toBeInTheDocument();

    // Inline create resolves -> adds AI engineer to list, does NOT hijack Goal B's open panel
    await act(async () => {
      resolveCreate({
        ok: true,
        data: goal('g-new-ai', 'awaiting_confirmation', 'AI engineer', {
          proposed_role: { canonical_role_id: 'r-ai', name: 'AI Engineering' },
        }),
      });
    });

    expect(screen.getByText('AI engineer')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Review and confirm career goal' })).getByText('Frontend Development')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('mentor_onboarding_goal_draft:u-scope')).toContain('Onboarding Draft Goal');
  });

  it('updates a reopened Goal A panel on late clarification, closes reopened Goal A panel on late confirm, and reconciles discontinue refresh against newer mutations', async () => {
    let resolveClarify!: (value: unknown) => void;
    let resolveConfirm!: (value: unknown) => void;
    let resolveRefresh!: (value: unknown) => void;
    const goalA = goal('g-a', 'clarifying', 'Something with AI');
    const goalB = goal('g-b', 'awaiting_confirmation', 'Frontend developer', {
      proposed_role: { canonical_role_id: 'r2', name: 'Frontend Development' },
      suggested_level: 'mid',
    });

    const invoke = makeInvoke((op) => {
      if (op === 'submitGoalClarification') {
        return new Promise((resolve) => {
          resolveClarify = resolve;
        });
      }
      if (op === 'confirmCareerGoal') {
        return new Promise((resolve) => {
          resolveConfirm = resolve;
        });
      }
      if (op === 'deleteCareerGoal') {
        return { ok: true, data: { id: 'g-a', status: 'discontinued', archived_roadmap_id: null, new_focus_roadmap_id: null } };
      }
      if (op === 'listCareerGoals') {
        return new Promise((resolve) => {
          resolveRefresh = resolve;
        });
      }
      return { ok: true, data: {} };
    });

    render(<CareerProfileView initialGoals={[goalA, goalB]} profile={PROFILE} userId="u-race" invoke={invoke} />);

    // Submit clarification on Goal A, close & reopen Goal A panel while in flight
    const rowA = screen.getByText('Something with AI').closest('li')!;
    fireEvent.click(within(rowA).getByRole('button', { name: 'Resume clarification' }));
    fireEvent.change(screen.getByLabelText(/your answer/i), { target: { value: 'Deep learning' } });
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));
    fireEvent.click(screen.getByRole('button', { name: /back to goal/i }));
    fireEvent.click(within(rowA).getByRole('button', { name: 'Resume clarification' }));

    // Late clarification arrives -> reopened Goal A panel transitions to Confirm your role
    await act(async () => {
      resolveClarify({
        ok: true,
        data: {
          ...goalA,
          status: 'awaiting_confirmation',
          proposed_role: { canonical_role_id: 'r-ai', name: 'AI Engineering' },
        },
      });
    });
    expect(within(screen.getByRole('region', { name: 'Review and confirm career goal' })).getByText('AI Engineering')).toBeInTheDocument();

    // Start confirming Goal A, close & reopen Goal A panel while confirm is in flight
    fireEvent.click(screen.getByRole('button', { name: /^confirm role$/i }));
    fireEvent.click(screen.getByRole('button', { name: /back to goal/i }));
    fireEvent.click(within(screen.getByText('Something with AI').closest('li')!).getByRole('button', { name: 'Review & confirm' }));
    expect(screen.getByRole('region', { name: 'Review and confirm career goal' })).toBeInTheDocument();

    // Confirm resolves -> closes obsolete reopened Goal A panel
    await act(async () => {
      resolveConfirm({
        ok: true,
        data: {
          ...goalA,
          status: 'confirmed',
          proposed_role: { canonical_role_id: 'r-ai', name: 'AI Engineering' },
          target_level: 'junior',
        },
      });
    });
    expect(screen.queryByRole('region', { name: 'Review and confirm career goal' })).not.toBeInTheDocument();

    // Open Goal B panel, discontinue Goal A -> while discontinue list refresh is in flight, confirm Goal B
    const rowB = screen.getByText('Frontend developer').closest('li')!;
    fireEvent.click(within(rowB).getByRole('button', { name: 'Review & confirm' }));
    const confirmedRowA = screen.getByText('Something with AI').closest('li')!;
    fireEvent.click(within(confirmedRowA).getByRole('button', { name: /discontinue goal/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discontinue goal' }));
    await waitFor(() => expect(typeof resolveRefresh).toBe('function'));

    // Confirm Goal B while refresh is still pending (Goal A not yet marked discontinued in local list -> 2 confirmed)
    fireEvent.click(screen.getByRole('button', { name: /^confirm role$/i }));
    await act(async () => {
      resolveConfirm({
        ok: true,
        data: { ...goalB, status: 'confirmed', target_level: 'mid' },
      });
    });
    expect(screen.getByText('Confirmed goals (2)')).toBeInTheDocument();

    // Stale refresh returns Goal B still awaiting_confirmation -> MUST preserve locally confirmed Goal B
    await act(async () => {
      resolveRefresh({
        ok: true,
        data: {
          items: [{ ...goalA, status: 'discontinued' }, goalB],
          meta: { limit: 100, next_cursor: null },
        },
      });
    });
    expect(screen.getByText('Confirmed goals (1)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Discontinued goals (1)' })).toBeInTheDocument();
    expect(screen.queryByText('Awaiting confirmation (1)')).not.toBeInTheDocument();
  });

  it('reflects saved daily study hours in profile immediately even when goal creation fails, and persists pending targetLevel per goalId across remount', async () => {
    const goalA = goal('g-a', 'awaiting_confirmation', 'Backend developer', { suggested_level: 'junior' });
    const goalB = goal('g-b', 'awaiting_confirmation', 'Data analyst', { suggested_level: 'junior' });
    let createCount = 0;
    const invoke = makeInvoke((op) => {
      if (op === 'updateLearningSettings') {
        return { ok: true, data: { ...PROFILE, preferred_daily_hours: 4.5, updated_at: '2026-11-05T00:00:00.000Z' } };
      }
      if (op === 'createCareerGoal') {
        createCount += 1;
        if (createCount === 1) {
          return { ok: false, error: mapApiError(new ApiError(422, 'Out of scope', 'OUT_OF_SCOPE_GOAL')) };
        }
        return { ok: true, data: createCount === 2 ? goalA : goalB };
      }
      if (op === 'confirmCareerGoal') {
        return { ok: true, data: { ...goalA, status: 'confirmed', target_level: 'senior' } };
      }
      return { ok: true, data: {} };
    });

    const first = render(<CareerProfileView initialGoals={[]} profile={PROFILE} userId="u-persist" invoke={invoke} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a career goal' }));
    fireEvent.change(screen.getByRole('combobox', { name: /career goal/i }), { target: { value: 'Pastry chef' } });
    fireEvent.change(screen.getByLabelText(/preferred daily hours/i), { target: { value: '4.5' } });
    fireEvent.change(screen.getByLabelText(/target career level/i), { target: { value: 'senior' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));

    // Goal creation fails, but 4.5 h saved via EP-P04 is immediately reflected in profile summary
    expect(await screen.findByRole('alert')).toHaveTextContent(/technology careers only/i);
    expect(screen.getByText('4.5 h')).toBeInTheDocument();

    // Retry with valid Goal A (Senior), then add Goal B (Mid), then unmount & remount
    fireEvent.change(screen.getByRole('combobox', { name: /career goal/i }), { target: { value: 'Backend developer' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));
    expect(await screen.findByRole('region', { name: 'Review and confirm career goal' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add a career goal' }));
    fireEvent.change(screen.getByRole('combobox', { name: /career goal/i }), { target: { value: 'Data analyst' } });
    fireEvent.change(screen.getByLabelText(/target career level/i), { target: { value: 'mid' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));
    await waitFor(() => expect(screen.getByText('Data analyst')).toBeInTheDocument());
    first.unmount();

    // Remount CareerProfileView -> Goal A still preserves 'senior' instead of falling back to 'junior'
    render(<CareerProfileView initialGoals={[goalA, goalB]} profile={PROFILE} userId="u-persist" invoke={invoke} />);
    const rowA = screen.getByText('Backend developer').closest('li')!;
    fireEvent.click(within(rowA).getByRole('button', { name: 'Review & confirm' }));
    fireEvent.click(screen.getByRole('button', { name: /^confirm role$/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('confirmCareerGoal', {
        id: 'g-a',
        body: { canonical_role_id: 'r1', target_level: 'senior' },
      }),
    );
  });

  it('syncs open review panel when discontinue list refresh returns an updated snapshot (clarifying -> awaiting_confirmation)', async () => {
    const goalA = goal('g-a', 'confirmed', 'Backend developer');
    const goalB = goal('g-b', 'clarifying', 'Something with AI');
    const refreshedGoalB = goal('g-b', 'awaiting_confirmation', 'Something with AI', {
      proposed_role: { canonical_role_id: 'r-ai', name: 'AI Engineering' },
    });
    const invoke = makeInvoke((op) => {
      if (op === 'deleteCareerGoal') {
        return { ok: true, data: { id: 'g-a', status: 'discontinued', archived_roadmap_id: null, new_focus_roadmap_id: null } };
      }
      if (op === 'listCareerGoals') {
        return {
          ok: true,
          data: { items: [{ ...goalA, status: 'discontinued' }, refreshedGoalB], meta: { limit: 100, next_cursor: null } },
        };
      }
      return { ok: true, data: {} };
    });

    render(<CareerProfileView initialGoals={[goalA, goalB]} profile={PROFILE} invoke={invoke} />);
    const rowB = screen.getByText('Something with AI').closest('li')!;
    fireEvent.click(within(rowB).getByRole('button', { name: 'Resume clarification' }));
    expect(screen.getByRole('heading', { name: 'One quick question' })).toBeInTheDocument();

    const rowA = screen.getByText('Backend developer').closest('li')!;
    fireEvent.click(within(rowA).getByRole('button', { name: /discontinue goal/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discontinue goal' }));

    // Open panel for Goal B updates cleanly to the refreshed awaiting_confirmation snapshot
    expect(await screen.findByRole('heading', { name: 'Confirm your role' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Review and confirm career goal' })).getByText('AI Engineering')).toBeInTheDocument();
  });
});

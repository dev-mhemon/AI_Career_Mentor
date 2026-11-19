import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  ApiError,
  type CareerGoalResponse,
  type GoalStatus,
  type ProfileResponse,
} from '@/lib/api/client';
import { mapApiError, type M05Invoke } from '@/lib/api/error-mapper';
import { CareerProfileView } from './career-profile-view';

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
    { skill_id: 's1', name: 'React', alias_resolved: true, learning_state: 'learning', source: 'self_reported' },
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
    expect(within(confirmed).getByText(/Role: Backend Development · Mid level/)).toBeInTheDocument();

    const clarifying = screen.getByText('Something with AI').closest('li')!;
    expect(within(clarifying).getByRole('link', { name: 'Resume clarification' })).toHaveAttribute(
      'href',
      '/onboarding/clarify?goalId=g-clarifying',
    );
    const awaiting = screen.getByText('Data analyst').closest('li')!;
    expect(within(awaiting).getByRole('link', { name: 'Review & confirm' })).toHaveAttribute(
      'href',
      '/onboarding/clarify?goalId=g-awaiting',
    );
    const discontinued = screen.getByText('Old mobile goal').closest('li')!;
    expect(within(discontinued).getByText('Discontinued')).toBeInTheDocument();
    expect(within(discontinued).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows skills, preferences and quick-edit links', () => {
    render(<CareerProfileView initialGoals={[]} profile={PROFILE} invoke={makeInvoke(() => ({ ok: true, data: {} }))} />);
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('Hands-on')).toBeInTheDocument();
    expect(screen.getByText('2 h')).toBeInTheDocument();
    expect(screen.getByText('Asia/Dhaka')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit skills' })).toHaveAttribute('href', '/onboarding/skills');
    expect(screen.getByRole('link', { name: 'Edit preferences' })).toHaveAttribute('href', '/onboarding/preferences');
    expect(screen.getByText(/no career goals yet/i)).toBeInTheDocument();
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
    expect(screen.getByText('Discontinued goals (1)')).toBeInTheDocument();
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
    expect(await screen.findByText('Discontinued goals (1)')).toBeInTheDocument();
  });

  it('disables adding a fourth active goal but ignores discontinued goals in the cap', () => {
    const three = [goal('a', 'confirmed', 'A'), goal('b', 'confirmed', 'B'), goal('c', 'clarifying', 'C'), goal('d', 'discontinued', 'D')];
    const { unmount } = render(<CareerProfileView initialGoals={three} profile={PROFILE} invoke={makeInvoke(() => ({ ok: true, data: {} }))} />);
    expect(screen.queryByRole('link', { name: 'Add a career goal' })).not.toBeInTheDocument();
    expect(screen.getByText(/3 active goals/i)).toBeInTheDocument();
    unmount();
    render(<CareerProfileView initialGoals={three.slice(0, 2)} profile={PROFILE} invoke={makeInvoke(() => ({ ok: true, data: {} }))} />);
    expect(screen.getByRole('link', { name: 'Add a career goal' })).toHaveAttribute('href', '/onboarding/goal');
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
});

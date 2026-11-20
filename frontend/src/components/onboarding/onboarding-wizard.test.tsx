import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  ApiError,
  type CareerGoalResponse,
  type ProfileResponse,
} from '@/lib/api/client';
import { mapApiError, type M05Invoke } from '@/lib/api/error-mapper';
import { saveProfileSetupAction } from '@/lib/profile/actions';
import { OnboardingWizard } from './onboarding-wizard';
import {
  createInitialWizardState,
  onboardingWizardReducer,
} from './onboarding-wizard-context';

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

vi.mock('@/lib/profile/actions', () => ({
  saveProfileSetupAction: vi.fn(),
}));

const GOAL_ID = '11111111-1111-4111-8111-111111111111';
const GOAL_ID_2 = '22222222-2222-4222-8222-222222222222';

function makeProfile(overrides: Partial<ProfileResponse> = {}): ProfileResponse {
  return {
    current_role: null,
    education: null,
    experience_level: null,
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

function makeGoal(
  overrides: Partial<CareerGoalResponse> = {},
): CareerGoalResponse {
  return {
    id: GOAL_ID,
    goal_text: 'Backend developer',
    status: 'awaiting_confirmation',
    clarification_round: 0,
    clarification_question: null,
    proposed_role: { canonical_role_id: 'role-1', name: 'Backend Development' },
    alternative_roles: [
      { canonical_role_id: 'role-2', name: 'DevOps Engineering', rationale: null },
      { canonical_role_id: 'role-3', name: 'Data Engineering', rationale: null },
    ],
    suggested_level: 'junior',
    target_level: null,
    roadmap_id: null,
    created_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeInvoke(handler: (op: string, input: unknown) => unknown) {
  const fn = vi.fn(async (op: string, input: unknown) => handler(op, input));
  return fn as unknown as M05Invoke & typeof fn;
}

const EMAIL_CONTACT = {
  email: 'mehedi@example.com',
  emailVerified: true,
  phone: '',
  phoneVerified: false,
};

describe('OnboardingWizard (unified multi-step state machine)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('transitions Steps 1 → 2 → 3 → 4 → 5 purely in client state (zero router.push between steps), updates live completion %, and navigates to /dashboard on Confirm Role', async () => {
    const profileAfterStep1 = makeProfile({
      current_role: 'CS Student',
      experience_level: 'beginner',
    });
    const profileAfterStep2 = makeProfile({
      ...profileAfterStep1,
      existing_skills_none: true,
    });
    const profileAfterStep3 = makeProfile({
      ...profileAfterStep2,
      learning_preference: 'hands_on',
    });
    const profileAfterStep4 = makeProfile({
      ...profileAfterStep3,
      preferred_daily_hours: 3,
    });

    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      success: true,
      message: 'Profile saved.',
      profile: profileAfterStep1,
      values: {
        full_name: 'Mehedi Hasan',
        email: 'mehedi@example.com',
        phone: '',
        current_role: 'CS Student',
        education: '',
        experience_level: 'beginner',
        existing_skills_none: false,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '2',
      },
    });

    const invoke = makeInvoke((op) => {
      if (op === 'updateSkills') return { ok: true, data: profileAfterStep2 };
      if (op === 'updatePreferences') return { ok: true, data: profileAfterStep3 };
      if (op === 'updateLearningSettings') return { ok: true, data: profileAfterStep4 };
      if (op === 'createCareerGoal') return { ok: true, data: makeGoal() };
      if (op === 'confirmCareerGoal') {
        return {
          ok: true,
          data: makeGoal({ status: 'confirmed', target_level: 'mid' }),
        };
      }
      return {
        ok: false,
        error: mapApiError(new ApiError(404, 'Not found', 'RESOURCE_NOT_FOUND')),
      };
    });

    render(
      <OnboardingWizard
        initialStep="profile"
        initialProfile={makeProfile()}
        initialGoals={[]}
        initialContact={EMAIL_CONTACT}
        initialFullName=""
        userId="user-1"
        invoke={invoke}
      />,
    );

    // Step 1: 0% Complete, only 1 progressbar (no duplicate stepper)
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getByText('0% Complete')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Complete Your Profile' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: 'Mehedi Hasan' },
    });
    fireEvent.change(screen.getByLabelText(/current role \/ profession/i), {
      target: { value: 'CS Student' },
    });
    fireEvent.change(screen.getByLabelText(/experience level/i), {
      target: { value: 'beginner' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    });

    // Step 2: 20% Complete, zero router.push, Step 1 unmounted
    expect(await screen.findByRole('heading', { name: 'Your Skills' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Complete Your Profile' })).not.toBeInTheDocument();
    expect(screen.getByText('20% Complete')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('switch', { name: 'No prior technical skills' }));
    fireEvent.click(screen.getByRole('button', { name: /save & next/i }));

    // Step 3: 40% Complete, zero router.push
    expect(await screen.findByRole('heading', { name: 'How do you like to learn?' })).toBeInTheDocument();
    expect(screen.getByText('40% Complete')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: /^Hands-on/ }));
    fireEvent.click(screen.getByRole('button', { name: /save & next/i }));

    // Step 4: 60% Complete, zero router.push
    expect(await screen.findByRole('heading', { name: 'What is your career goal?' })).toBeInTheDocument();
    expect(screen.getByText('60% Complete')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('combobox', { name: /career goal/i }), {
      target: { value: 'Backend developer' },
    });
    fireEvent.change(screen.getByLabelText(/preferred daily hours/i), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText(/target career level/i), {
      target: { value: 'mid' },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));

    // Step 5: 80% Complete, zero router.push yet
    expect(await screen.findByRole('heading', { name: 'Confirm your role' })).toBeInTheDocument();
    expect(screen.getByText('80% Complete')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    // Confirm Role -> navigates smoothly to /dashboard
    fireEvent.click(screen.getByRole('button', { name: /^confirm role$/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'));
    expect(invoke).toHaveBeenLastCalledWith('confirmCareerGoal', {
      id: GOAL_ID,
      body: { canonical_role_id: 'role-1', target_level: 'mid' },
    });
  });

  it('uses EP-C06 (updateCareerGoal) instead of creating a duplicate goal when clicking Back to goal from Step 5', async () => {
    const baseProfile = makeProfile({
      current_role: 'Developer',
      experience_level: 'junior',
      existing_skills_none: true,
      learning_preference: 'mixed',
      preferred_daily_hours: 2,
    });

    const invoke = makeInvoke((op, input) => {
      if (op === 'updateLearningSettings') return { ok: true, data: baseProfile };
      if (op === 'updateCareerGoal') {
        const body = (input as { id: string; body: { goal_text: string } }).body;
        return {
          ok: true,
          data: makeGoal({ id: GOAL_ID, goal_text: body.goal_text }),
        };
      }
      return { ok: true, data: makeGoal({ id: GOAL_ID_2 }) };
    });

    // Smart-resumed directly on Step 5 with an existing unconfirmed goal
    render(
      <OnboardingWizard
        initialStep="confirm"
        initialProfile={baseProfile}
        initialGoals={[makeGoal({ id: GOAL_ID, goal_text: 'Backend developer' })]}
        initialContact={EMAIL_CONTACT}
        initialFullName="Mehedi Hasan"
        userId="user-1"
        invoke={invoke}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Confirm your role' })).toBeInTheDocument();
    expect(screen.getByText('80% Complete')).toBeInTheDocument();

    // Click "Back to goal" -> client-state transition to Step 4
    fireEvent.click(screen.getByRole('button', { name: /back to goal/i }));
    expect(screen.getByRole('heading', { name: 'What is your career goal?' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /career goal/i })).toHaveValue('Backend developer');

    // Reword goal and click Analyze Goal -> must call updateCareerGoal (EP-C06), NOT createCareerGoal
    fireEvent.change(screen.getByRole('combobox', { name: /career goal/i }), {
      target: { value: 'AI engineer' },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));

    expect(await screen.findByRole('heading', { name: 'Confirm your role' })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('updateCareerGoal', {
      id: GOAL_ID,
      body: { goal_text: 'AI engineer' },
    });
    expect(invoke).not.toHaveBeenCalledWith('createCareerGoal', expect.anything());
    expect(push).not.toHaveBeenCalled();
  });

  it('falls back to createCareerGoal ONLY when updateCareerGoal fails with 404 or 409', async () => {
    const baseProfile = makeProfile({
      current_role: 'Developer',
      experience_level: 'junior',
      existing_skills_none: true,
      learning_preference: 'reading',
      preferred_daily_hours: 2,
    });

    const invoke = makeInvoke((op) => {
      if (op === 'updateLearningSettings') return { ok: true, data: baseProfile };
      if (op === 'updateCareerGoal') {
        return {
          ok: false,
          error: mapApiError(new ApiError(409, 'Already confirmed', 'GOAL_ALREADY_CONFIRMED')),
        };
      }
      if (op === 'createCareerGoal') {
        return {
          ok: true,
          data: makeGoal({ id: GOAL_ID_2, goal_text: 'DevOps engineer' }),
        };
      }
      return { ok: true, data: baseProfile };
    });

    render(
      <OnboardingWizard
        initialStep="goal"
        initialProfile={baseProfile}
        initialGoals={[makeGoal({ id: GOAL_ID, goal_text: 'Old draft' })]}
        initialContact={EMAIL_CONTACT}
        initialFullName="Mehedi Hasan"
        userId="user-1"
        invoke={invoke}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: /career goal/i }), {
      target: { value: 'DevOps engineer' },
    });
    fireEvent.change(screen.getByLabelText(/target career level/i), {
      target: { value: 'mid' },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));

    expect(await screen.findByRole('heading', { name: 'Confirm your role' })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('updateCareerGoal', {
      id: GOAL_ID,
      body: { goal_text: 'DevOps engineer' },
    });
    expect(invoke).toHaveBeenCalledWith('createCareerGoal', {
      goal_text: 'DevOps engineer',
    });
  });

  it('does NOT fall back to createCareerGoal when updateCareerGoal fails with 422 OUT_OF_SCOPE_GOAL', async () => {
    const baseProfile = makeProfile({
      current_role: 'Developer',
      experience_level: 'junior',
      existing_skills_none: true,
      learning_preference: 'reading',
      preferred_daily_hours: 2,
    });

    const invoke = makeInvoke((op) => {
      if (op === 'updateLearningSettings') return { ok: true, data: baseProfile };
      if (op === 'updateCareerGoal') {
        return {
          ok: false,
          error: mapApiError(new ApiError(422, 'Out of scope', 'OUT_OF_SCOPE_GOAL')),
        };
      }
      return { ok: true, data: makeGoal({ id: GOAL_ID_2 }) };
    });

    render(
      <OnboardingWizard
        initialStep="goal"
        initialProfile={baseProfile}
        initialGoals={[makeGoal({ id: GOAL_ID, goal_text: 'Backend developer' })]}
        initialContact={EMAIL_CONTACT}
        initialFullName="Mehedi Hasan"
        userId="user-1"
        invoke={invoke}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: /career goal/i }), {
      target: { value: 'Pastry chef' },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/technology careers only/i);
    expect(invoke).toHaveBeenCalledWith('updateCareerGoal', {
      id: GOAL_ID,
      body: { goal_text: 'Pastry chef' },
    });
    expect(invoke).not.toHaveBeenCalledWith('createCareerGoal', expect.anything());
  });

  it('enforces strictly sequential clickable stepper: allows revisiting completed earlier steps, blocks skipping past firstIncompleteStep, and removes stray stepper border', () => {
    const partialProfile = makeProfile({
      current_role: 'Developer',
      experience_level: 'junior',
      existing_skills_none: true,
      learning_preference: null, // Step 3 (preferences) is the frontier (index 2)
    });

    const invoke = makeInvoke(() => ({ ok: true, data: partialProfile }));

    render(
      <OnboardingWizard
        initialStep="preferences"
        initialProfile={partialProfile}
        initialGoals={[]}
        initialContact={EMAIL_CONTACT}
        initialFullName="Mehedi Hasan"
        userId="user-1"
        invoke={invoke}
      />,
    );

    const progressbar = screen.getByRole('progressbar');
    const nav = screen.getByRole('navigation', { name: 'Onboarding steps' });
    // Interactive step buttons sit in a sibling <nav>, outside role="progressbar"
    expect(progressbar).not.toContainElement(nav);
    // No outer border line below steps
    expect(progressbar.parentElement).not.toHaveClass('border', 'border-border-subtle');

    const step1Btn = screen.getByRole('button', { name: /1\. profile/i });
    const step2Btn = screen.getByRole('button', { name: /2\. skills/i });
    const step3Btn = screen.getByRole('button', { name: /3\. preferences/i });
    const step4Btn = screen.getByRole('button', { name: /4\. career goal/i });
    const step5Btn = screen.getByRole('button', { name: /5\. confirm role/i });

    // Steps 1..3 unlocked (index <= 2); Steps 4..5 strictly locked (index > 2)
    expect(step1Btn).toBeEnabled();
    expect(step2Btn).toBeEnabled();
    expect(step3Btn).toBeEnabled();
    expect(step3Btn).toHaveAttribute('aria-current', 'step');
    expect(step4Btn).toBeDisabled();
    expect(step4Btn).toHaveAttribute('aria-disabled', 'true');
    expect(step4Btn).toHaveClass('cursor-not-allowed', 'opacity-60');
    expect(step5Btn).toBeDisabled();
    expect(step5Btn).toHaveAttribute('aria-disabled', 'true');

    // Attempting to click locked Step 4 or Step 5 does NOT skip Step 3
    fireEvent.click(step4Btn);
    fireEvent.click(step5Btn);
    expect(
      screen.getByRole('heading', { name: 'How do you like to learn?' }),
    ).toBeInTheDocument();

    // Clicking completed earlier Step 1 switches cleanly via GO_TO_STEP
    fireEvent.click(step1Btn);
    expect(
      screen.getByRole('heading', { name: 'Complete Your Profile' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1\. profile/i })).toHaveAttribute(
      'aria-current',
      'step',
    );

    // Clicking unlocked frontier Step 3 returns cleanly to Preferences
    fireEvent.click(screen.getByRole('button', { name: /3\. preferences/i }));
    expect(
      screen.getByRole('heading', { name: 'How do you like to learn?' }),
    ).toBeInTheDocument();

    // Reducer directly enforces the exact same sequential guard on GO_TO_STEP
    const state = createInitialWizardState({
      initialStep: 'preferences',
      initialProfile: partialProfile,
      initialGoals: [],
      initialContact: EMAIL_CONTACT,
      initialFullName: 'Mehedi Hasan',
    });
    expect(
      onboardingWizardReducer(state, { type: 'GO_TO_STEP', step: 'goal' }),
    ).toBe(state);
    expect(
      onboardingWizardReducer(state, { type: 'GO_TO_STEP', step: 'confirm' }),
    ).toBe(state);
    expect(
      onboardingWizardReducer(state, { type: 'GO_TO_STEP', step: 'skills' })
        .currentStep,
    ).toBe('skills');
    // NEXT cannot advance past an incomplete step
    expect(onboardingWizardReducer(state, { type: 'NEXT' })).toBe(state);

    // SET_ACTIVE_GOAL replaces targetLevel when switching to a different goal ID without explicit targetLevel
    const withGoalA = onboardingWizardReducer(
      {
        ...state,
        activeGoal: makeGoal({ id: GOAL_ID, suggested_level: 'junior' }),
        explicitTargetLevel: 'senior',
        targetLevel: 'senior',
      },
      {
        type: 'SET_ACTIVE_GOAL',
        goal: makeGoal({ id: GOAL_ID_2, suggested_level: 'mid', target_level: null }),
      },
    );
    expect(withGoalA.activeGoal?.id).toBe(GOAL_ID_2);
    expect(withGoalA.targetLevel).toBe('mid');
    expect(withGoalA.explicitTargetLevel).toBeNull();

    // When user did NOT explicitly pick a level, clarification updating suggested_level (junior -> senior) updates targetLevel
    const clarifyingInit = createInitialWizardState({
      initialStep: 'confirm',
      initialProfile: partialProfile,
      initialGoals: [makeGoal({ id: GOAL_ID, status: 'clarifying', suggested_level: 'junior', target_level: null })],
      initialContact: EMAIL_CONTACT,
      initialFullName: 'Mehedi Hasan',
    });
    expect(clarifyingInit.explicitTargetLevel).toBeNull();
    expect(clarifyingInit.targetLevel).toBe('junior');
    const afterClarify = onboardingWizardReducer(clarifyingInit, {
      type: 'SET_ACTIVE_GOAL',
      goal: makeGoal({ id: GOAL_ID, status: 'awaiting_confirmation', suggested_level: 'senior', target_level: null }),
    });
    expect(afterClarify.explicitTargetLevel).toBeNull();
    expect(afterClarify.targetLevel).toBe('senior');
  });

  it('restores user-scoped Step 4 targetLevel across Step 5 reload ONLY when draft goalId matches', async () => {
    const completePreConfirmProfile = makeProfile({
      current_role: 'Developer',
      experience_level: 'junior',
      existing_skills_none: true,
      learning_preference: 'hands_on',
      preferred_daily_hours: 2,
    });
    const goal1 = makeGoal({ id: GOAL_ID, suggested_level: 'junior', target_level: null });
    const goal2 = makeGoal({ id: GOAL_ID_2, suggested_level: 'mid', target_level: null });

    window.sessionStorage.setItem(
      'mentor_onboarding_goal_draft:user-reload',
      JSON.stringify({
        goal: 'Backend developer',
        dailyHours: '2',
        targetLevel: 'senior',
        goalId: GOAL_ID,
      }),
    );

    const invoke = makeInvoke((op) => {
      if (op === 'confirmCareerGoal') {
        return { ok: true, data: { ...goal1, status: 'confirmed', target_level: 'senior' } };
      }
      return { ok: true, data: completePreConfirmProfile };
    });

    // Matching goalId -> restores 'senior' from draft instead of falling back to suggested_level 'junior'
    const first = render(
      <OnboardingWizard
        initialStep="confirm"
        initialProfile={completePreConfirmProfile}
        initialGoals={[goal1]}
        initialContact={EMAIL_CONTACT}
        initialFullName="Mehedi Hasan"
        userId="user-reload"
        invoke={invoke}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^confirm role$/i }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('confirmCareerGoal', {
        id: GOAL_ID,
        body: { canonical_role_id: 'role-1', target_level: 'senior' },
      }),
    );
    first.unmount();

    // Non-matching goalId -> ignores GOAL_ID draft and uses GOAL_ID_2's suggested_level ('mid')
    window.sessionStorage.setItem(
      'mentor_onboarding_goal_draft:user-reload',
      JSON.stringify({
        goal: 'Backend developer',
        dailyHours: '2',
        targetLevel: 'senior',
        goalId: GOAL_ID,
      }),
    );
    invoke.mockClear();
    render(
      <OnboardingWizard
        initialStep="confirm"
        initialProfile={completePreConfirmProfile}
        initialGoals={[goal2]}
        initialContact={EMAIL_CONTACT}
        initialFullName="Mehedi Hasan"
        userId="user-reload"
        invoke={invoke}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^confirm role$/i }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('confirmCareerGoal', {
        id: GOAL_ID_2,
        body: { canonical_role_id: 'role-1', target_level: 'mid' },
      }),
    );
  });

  it('calls updateCareerGoal on Step 4 reload with editable server goal + matching draft, and updates target_level when clarification changes suggested_level without explicit user pick', async () => {
    const preConfirmProfile = makeProfile({
      current_role: 'Developer',
      experience_level: 'junior',
      existing_skills_none: true,
      learning_preference: 'hands_on',
      preferred_daily_hours: 2,
    });
    const clarifyingGoal = makeGoal({
      id: GOAL_ID,
      goal_text: 'Backend developer',
      status: 'clarifying',
      clarification_round: 1,
      clarification_question: 'Scale focus?',
      proposed_role: null,
      alternative_roles: [],
      suggested_level: 'junior',
      target_level: null,
    });

    window.sessionStorage.setItem(
      'mentor_onboarding_goal_draft:user-step4',
      JSON.stringify({
        goal: 'Backend developer edited',
        dailyHours: '2',
        targetLevel: 'mid',
        goalId: GOAL_ID,
      }),
    );

    const invoke = makeInvoke((op, input) => {
      if (op === 'updateLearningSettings') return { ok: true, data: preConfirmProfile };
      if (op === 'updateCareerGoal') {
        const body = (input as { id: string; body: { goal_text: string } }).body;
        return { ok: true, data: { ...clarifyingGoal, goal_text: body.goal_text } };
      }
      if (op === 'submitGoalClarification') {
        return {
          ok: true,
          data: makeGoal({
            id: GOAL_ID,
            status: 'awaiting_confirmation',
            suggested_level: 'senior',
            target_level: null,
          }),
        };
      }
      if (op === 'confirmCareerGoal') {
        return {
          ok: true,
          data: makeGoal({ id: GOAL_ID, status: 'confirmed', target_level: 'senior' }),
        };
      }
      return { ok: true, data: preConfirmProfile };
    });

    // Reload on Step 4 with editable server goal + matching draft -> MUST call updateCareerGoal
    const first = render(
      <OnboardingWizard
        initialStep="goal"
        initialProfile={preConfirmProfile}
        initialGoals={[clarifyingGoal]}
        initialContact={EMAIL_CONTACT}
        initialFullName="Mehedi Hasan"
        userId="user-step4"
        invoke={invoke}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));
    expect(await screen.findByRole('heading', { name: 'One quick question' })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('updateCareerGoal', {
      id: GOAL_ID,
      body: { goal_text: 'Backend developer edited' },
    });
    expect(invoke).not.toHaveBeenCalledWith('createCareerGoal', expect.anything());
    first.unmount();

    // Reload directly on Step 5 without an explicit draft targetLevel -> clarification shifts suggested_level junior -> senior
    window.sessionStorage.clear();
    invoke.mockClear();
    render(
      <OnboardingWizard
        initialStep="confirm"
        initialProfile={preConfirmProfile}
        initialGoals={[clarifyingGoal]}
        initialContact={EMAIL_CONTACT}
        initialFullName="Mehedi Hasan"
        userId="user-step4"
        invoke={invoke}
      />,
    );
    fireEvent.change(screen.getByLabelText(/your answer/i), { target: { value: 'Distributed systems lead' } });
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));
    expect(await screen.findByRole('heading', { name: 'Confirm your role' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^confirm role$/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('confirmCareerGoal', {
        id: GOAL_ID,
        body: { canonical_role_id: 'role-1', target_level: 'senior' },
      }),
    );
  });

  it('disables stepper navigation while a step save is in flight and does not promote suggested_level to explicit when editing only goal text', async () => {
    const preConfirmProfile = makeProfile({
      current_role: 'Developer',
      experience_level: 'junior',
      existing_skills_none: true,
      learning_preference: 'hands_on',
      preferred_daily_hours: 2,
    });
    const clarifyingGoal = makeGoal({
      id: GOAL_ID,
      goal_text: 'Backend developer',
      status: 'clarifying',
      clarification_round: 1,
      clarification_question: 'Scale focus?',
      proposed_role: null,
      alternative_roles: [],
      suggested_level: 'junior',
      target_level: null,
    });

    let resolveUpdate!: (value: unknown) => void;
    const invoke = makeInvoke((op) => {
      if (op === 'updateLearningSettings') return { ok: true, data: preConfirmProfile };
      if (op === 'updateCareerGoal') {
        return new Promise((resolve) => {
          resolveUpdate = resolve;
        });
      }
      if (op === 'submitGoalClarification') {
        return {
          ok: true,
          data: makeGoal({
            id: GOAL_ID,
            status: 'awaiting_confirmation',
            suggested_level: 'senior',
            target_level: null,
          }),
        };
      }
      if (op === 'confirmCareerGoal') {
        return {
          ok: true,
          data: makeGoal({ id: GOAL_ID, status: 'confirmed', target_level: 'senior' }),
        };
      }
      return { ok: true, data: preConfirmProfile };
    });

    // Start on Step 5 with AI suggested_level='junior' (explicitTargetLevel=null), go Back to Step 4
    render(
      <OnboardingWizard
        initialStep="confirm"
        initialProfile={preConfirmProfile}
        initialGoals={[clarifyingGoal]}
        initialContact={EMAIL_CONTACT}
        initialFullName="Mehedi Hasan"
        userId="user-pending"
        invoke={invoke}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /back to goal/i }));
    expect(screen.getByRole('heading', { name: 'What is your career goal?' })).toBeInTheDocument();

    // Edit ONLY goal text (do NOT change Target career level select) and click Analyze Goal
    fireEvent.change(screen.getByRole('combobox', { name: /career goal/i }), {
      target: { value: 'Distributed backend systems' },
    });
    fireEvent.click(screen.getByRole('button', { name: /analyze goal/i }));

    // While updateCareerGoal is pending, stepper buttons for other steps MUST be disabled
    await waitFor(() => expect(typeof resolveUpdate).toBe('function'));
    expect(screen.getByRole('button', { name: /1\. profile/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /2\. skills/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /3\. preferences/i })).toBeDisabled();

    await act(async () => {
      resolveUpdate({
        ok: true,
        data: { ...clarifyingGoal, goal_text: 'Distributed backend systems' },
      });
    });

    // Back on Step 5: answer clarification which returns suggested_level='senior'
    expect(await screen.findByRole('heading', { name: 'One quick question' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/your answer/i), { target: { value: 'Staff architect' } });
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));
    expect(await screen.findByRole('heading', { name: 'Confirm your role' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^confirm role$/i }));

    // Unedited suggested_level='junior' was NOT promoted to explicit -> confirms with updated 'senior'!
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('confirmCareerGoal', {
        id: GOAL_ID,
        body: { canonical_role_id: 'role-1', target_level: 'senior' },
      }),
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Stepper, type StepperStep } from './stepper';

const FIVE_STEPS: ReadonlyArray<StepperStep> = [
  { id: 'profile', label: 'Profile', status: 'completed', interactive: true },
  { id: 'skills', label: 'Skills', status: 'current', interactive: true },
  { id: 'preferences', label: 'Preferences', status: 'upcoming', interactive: true },
  { id: 'goal', label: 'Career Goal', status: 'upcoming', interactive: false },
  { id: 'confirm', label: 'Confirm Role', status: 'upcoming', interactive: false },
];

const TWO_STEPS: ReadonlyArray<StepperStep> = [
  { id: '1', label: 'Career Goal', status: 'completed' },
  { id: '2', label: 'Confirm Role', status: 'current' },
];

describe('Stepper reusable UI primitive', () => {
  it('renders interactive <nav> + <button> steps in exact DOM order while keeping role="progressbar" outside step controls', () => {
    const onStepClick = vi.fn();
    render(
      <Stepper
        steps={FIVE_STEPS}
        title="Existing Skills"
        stepCounterText="Step 2 of 5"
        percentComplete={20}
        ariaLabel="Onboarding steps"
        onStepClick={onStepClick}
      />,
    );

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '20');
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('20% Complete')).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Onboarding steps' });
    expect(progressbar).not.toContainElement(nav);
    expect(progressbar.parentElement).not.toHaveClass('border', 'border-border-subtle');

    const buttons = within(nav).getAllByRole('button');
    expect(buttons).toHaveLength(5);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Profile (completed)',
      'Skills (current step)',
      'Preferences',
      'Career Goal',
      'Confirm Role',
    ]);
    expect(
      buttons.map((b) => b.querySelector('span[aria-hidden="true"]')?.textContent),
    ).toEqual(['✓', '2', '3', '4', '5']);

    // Current step has aria-current="step" and does not trigger navigation on click
    expect(buttons[1]).toHaveAttribute('aria-current', 'step');
    fireEvent.click(buttons[1]);
    expect(onStepClick).not.toHaveBeenCalled();

    // Completed step (1) and unlocked frontier step (3) trigger onStepClick
    fireEvent.click(buttons[0]);
    expect(onStepClick).toHaveBeenCalledWith('profile');
    fireEvent.click(buttons[2]);
    expect(onStepClick).toHaveBeenCalledWith('preferences');

    // Locked upcoming steps (4 and 5) are disabled
    expect(buttons[3]).toBeDisabled();
    expect(buttons[3]).toHaveAttribute('aria-disabled', 'true');
    expect(buttons[4]).toBeDisabled();
    expect(buttons[4]).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables non-active step buttons when disabled=true (submitting guard) while keeping current step un-disabled', () => {
    const onStepClick = vi.fn();
    render(
      <Stepper
        steps={FIVE_STEPS}
        title="Existing Skills"
        stepCounterText="Step 2 of 5"
        percentComplete={20}
        ariaLabel="Onboarding steps"
        disabled
        onStepClick={onStepClick}
      />,
    );

    const profileBtn = screen.getByRole('button', { name: /profile/i });
    const skillsBtn = screen.getByRole('button', { name: /skills/i });
    const prefsBtn = screen.getByRole('button', { name: /preferences/i });

    expect(profileBtn).toBeDisabled();
    expect(prefsBtn).toBeDisabled();
    expect(skillsBtn).not.toBeDisabled();

    fireEvent.click(profileBtn);
    expect(onStepClick).not.toHaveBeenCalled();
  });

  it('maps percentComplete onto custom [progressValueMin, progressValueMax] without integer rounding when progressValueNow is omitted', () => {
    const { rerender } = render(
      <Stepper
        steps={FIVE_STEPS}
        title="Preferences"
        stepCounterText="Step 3 of 5"
        percentComplete={50}
        progressValueMin={1}
        progressValueMax={5}
      />,
    );

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuemin', '1');
    expect(progressbar).toHaveAttribute('aria-valuemax', '5');
    expect(progressbar).toHaveAttribute('aria-valuenow', '3');

    rerender(
      <Stepper
        steps={FIVE_STEPS}
        title="Preferences"
        stepCounterText="Step 2 of 5"
        percentComplete={25}
        progressValueMin={1}
        progressValueMax={5}
      />,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');

    rerender(
      <Stepper
        steps={FIVE_STEPS}
        title="Preferences"
        stepCounterText="Step 2 of 5"
        percentComplete={37.5}
        progressValueMin={1}
        progressValueMax={5}
      />,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2.5');
    expect(screen.getByText('38% Complete')).toBeInTheDocument();
  });

  it('renders static <ol role="list"> without <nav> or <button> elements when onStepClick is omitted', () => {
    render(
      <Stepper
        steps={TWO_STEPS}
        title="Confirm Role"
        stepCounterText="Step 2 of 2"
        percentComplete={100}
        ariaLabel="Add career goal steps"
        progressAriaLabel="Add career goal progress: Step 2 of 2"
        progressValueNow={2}
        progressValueMin={1}
        progressValueMax={2}
      />,
    );

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    const list = screen.getByRole('list', { name: 'Add career goal steps' });
    expect(list).toHaveAttribute('role', 'list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).not.toHaveAttribute('aria-current');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
  });

  it('prevents connector line bleed-through with 100% opaque circle fills, z-10 stacking, mask rings, and edge-to-edge connector geometry', () => {
    const { container } = render(
      <Stepper
        steps={[
          { id: '1', label: 'Goal', status: 'completed' },
          { id: '2', label: 'Confirm', status: 'current' },
          { id: '3', label: 'Done', status: 'upcoming' },
        ]}
        title="Confirm"
        stepCounterText="Step 2 of 3"
        percentComplete={67}
      />,
    );

    const items = container.querySelectorAll('ol > li');
    expect(items).toHaveLength(3);

    // Connector line spans strictly between circle edges (left-[calc(50%+14px)] w-[calc(100%-28px)]) on z-0
    const firstConnector = items[0].querySelector('span[aria-hidden="true"]')!;
    expect(firstConnector.className).toContain('z-0');
    expect(firstConnector.className).toContain('left-[calc(50%+14px)]');
    expect(firstConnector.className).toContain('w-[calc(100%-28px)]');

    // Completed, current, and upcoming step circles all have relative z-10 + 100% opaque background (never translucent bg-teal-500/15)
    const completedCircle = items[0].querySelectorAll('span[aria-hidden="true"]')[1]!;
    const currentCircle = items[1].querySelectorAll('span[aria-hidden="true"]')[1]!;
    const upcomingCircle = items[2].querySelectorAll('span[aria-hidden="true"]')[0]!;

    for (const circle of [completedCircle, currentCircle, upcomingCircle]) {
      expect(circle.className).toContain('relative');
      expect(circle.className).toContain('z-10');
      expect(circle.className).not.toContain('bg-teal-500/15');
    }

    expect(completedCircle.className).toContain('bg-[#e6f6f4]');
    expect(completedCircle.className).toContain('ring-2');
    expect(currentCircle.className).toContain('bg-teal-500');
    expect(upcomingCircle.className).toContain('bg-white');
  });
});

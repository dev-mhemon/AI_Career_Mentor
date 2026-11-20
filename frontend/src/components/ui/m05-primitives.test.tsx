import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import {
  MultiStepFormWrapper,
  OnboardingStepHeader,
} from '@/components/ui/multi-step-form-wrapper';
import { CareerCard, CareerCardGroup } from '@/components/ui/career-card';
import { SkillCard } from '@/components/ui/skill-card';

describe('ToggleSwitch (#08)', () => {
  it('is a native button switch with aria-checked, label and description', () => {
    render(
      <ToggleSwitch
        checked={false}
        onCheckedChange={() => {}}
        label="None / No prior technical skills"
        description="For complete beginners"
      />,
    );
    const toggle = screen.getByRole('switch', { name: 'None / No prior technical skills' });
    expect(toggle.tagName).toBe('BUTTON'); // native Space/Enter activation
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription('For complete beginners');
  });

  it('toggles to the next value on activation', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ToggleSwitch checked={false} onCheckedChange={onChange} label="Beginner" />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(<ToggleSwitch checked onCheckedChange={onChange} label="Beginner" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('ignores activation when disabled or saving and exposes aria-busy', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ToggleSwitch checked={false} disabled onCheckedChange={onChange} label="Beginner" />,
    );
    expect(screen.getByRole('switch')).toBeDisabled();
    fireEvent.click(screen.getByRole('switch'));
    rerender(<ToggleSwitch checked={false} saving onCheckedChange={onChange} label="Beginner" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('MultiStepFormWrapper (#09)', () => {
  it('marks only the active step with aria-current and reports Step X of 5', () => {
    render(
      <MultiStepFormWrapper currentStep={3} heading="Prefs" actions={<button>Continue</button>}>
        <p>body</p>
      </MultiStepFormWrapper>,
    );
    const bar = screen.getByRole('progressbar', { name: /step 3 of 5/i });
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument();
    expect(screen.getByText('60% Complete')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Onboarding steps' })).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Onboarding steps' });
    expect(bar).not.toContainElement(list);
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items.filter((li) => li.getAttribute('aria-current') === 'step')).toHaveLength(1);
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items[2]).toHaveTextContent('3. Preferences');
    expect(items[0]).toHaveTextContent('(completed)');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prefs' })).toBeInTheDocument();
  });

  it('lists the five steps in exact DOM order', () => {
    render(<OnboardingStepHeader currentStep={5} />);
    expect(screen.getByText('Clarify & Confirm')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Onboarding steps' });
    const labels = within(list)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('span:not([aria-hidden="true"])')?.textContent?.trim());
    expect(labels).toEqual([
      '1. Profile',
      '2. Skills',
      '3. Preferences',
      '4. Career Goal',
      '5. Confirm Role',
    ]);
  });

  it('renders busy state and an alert for errors', () => {
    const { container } = render(
      <MultiStepFormWrapper currentStep={2} status="submitting" errorMessage="Save failed">
        <p>x</p>
      </MultiStepFormWrapper>,
    );
    expect(container.querySelector('section')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
  });
});

describe('CareerCard (#13)', () => {
  it('omits rationale text when R29 rationale is null, defaults recommended badge to "Recommended", and supports custom badgeLabel overrides', () => {
    const { rerender } = render(
      <CareerCard title="Backend Development" rationale={null} recommended />,
    );
    expect(screen.getByRole('heading', { name: 'Backend Development' })).toBeInTheDocument();
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.queryByText(/null/i)).not.toBeInTheDocument();

    rerender(
      <CareerCard
        title="Backend Development"
        rationale={null}
        recommended
        badgeLabel="Your choice"
      />,
    );
    expect(screen.getByText('Your choice')).toBeInTheDocument();
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();

    rerender(
      <CareerCard
        title="Backend Development"
        rationale={null}
        recommended
        badgeLabel="Suggested"
      />,
    );
    expect(screen.getByText('Suggested')).toBeInTheDocument();
    expect(screen.queryByText('Your choice')).not.toBeInTheDocument();
  });

  it('shows rationale, category/level metadata and an alternative badge', () => {
    render(
      <CareerCard
        title="DevOps"
        rationale="Fits your infra interest"
        category="Infrastructure"
        level="mid"
        recommended={false}
      />,
    );
    expect(screen.getByText('Fits your infra interest')).toBeInTheDocument();
    expect(screen.getByText('Infrastructure · Mid level')).toBeInTheDocument();
    expect(screen.getByText('Alternative')).toBeInTheDocument();
  });

  it('behaves as a radio inside a radiogroup with arrow-key selection', () => {
    const onA = vi.fn();
    const onB = vi.fn();
    render(
      <CareerCardGroup label="Roles">
        <CareerCard title="A" selected onSelect={onA} />
        <CareerCard title="B" selected={false} onSelect={onB} />
      </CareerCardGroup>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Roles' });
    const radios = within(group).getAllByRole('radio');
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(radios[1]).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(radios[1]);
    expect(onB).toHaveBeenCalledTimes(1);
    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: 'ArrowDown' });
    expect(onB).toHaveBeenCalledTimes(2);
    expect(radios[1]).toHaveFocus();
  });

  it('does not select when disabled', () => {
    const onSelect = vi.fn();
    render(<CareerCard title="A" onSelect={onSelect} disabled />);
    fireEvent.click(screen.getByRole('radio'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('SkillCard (#14)', () => {
  it('shows name, alias badge and learning state', () => {
    render(
      <ul>
        <SkillCard name="React" aliasInput="react.js" learningState="learning" aliasResolved={false} />
      </ul>,
    );
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('Alias: react.js')).toBeInTheDocument();
    expect(screen.getByText('Learning')).toBeInTheDocument();
    expect(screen.getByText('Needs clarification')).toBeInTheDocument();
  });

  it('hides alias badge when input equals the canonical name', () => {
    render(
      <ul>
        <SkillCard name="React" aliasInput="react" />
      </ul>,
    );
    expect(screen.queryByText(/alias:/i)).not.toBeInTheDocument();
  });

  it('offers the four proficiency levels with an accessible label', () => {
    const onChange = vi.fn();
    render(
      <ul>
        <SkillCard name="SQL" proficiency="beginner" onProficiencyChange={onChange} />
      </ul>,
    );
    const select = screen.getByRole('combobox', { name: 'Proficiency for SQL' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Select proficiency',
      'Beginner',
      'Intermediate',
      'Advanced',
      'Expert',
    ]);
    fireEvent.change(select, { target: { value: 'expert' } });
    expect(onChange).toHaveBeenCalledWith('expert');
  });

  it('removes via click and via Delete/Backspace on the remove button', () => {
    const onRemove = vi.fn();
    render(
      <ul>
        <SkillCard name="Go" onRemove={onRemove} />
      </ul>,
    );
    const remove = screen.getByRole('button', { name: 'Remove skill Go' });
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(remove, { key: 'Delete' });
    expect(onRemove).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(remove, { key: 'Backspace' });
    expect(onRemove).toHaveBeenCalledTimes(3);
  });

  it('renders no controls without handlers', () => {
    render(
      <ul>
        <SkillCard name="Go" />
      </ul>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('supports compact pill variant with accessible remove button and keyboard Delete/Backspace', () => {
    const onRemove = vi.fn();
    render(
      <ul className="flex flex-wrap gap-2">
        <SkillCard variant="pill" name="React" aliasInput="react.js" onRemove={onRemove} />
      </ul>,
    );
    const pill = screen.getByRole('listitem');
    expect(pill).toHaveClass('rounded-full');
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('(react.js)')).toBeInTheDocument();
    const remove = screen.getByRole('button', { name: 'Remove React' });
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(remove, { key: 'Delete' });
    expect(onRemove).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(remove, { key: 'Backspace' });
    expect(onRemove).toHaveBeenCalledTimes(3);
  });
});

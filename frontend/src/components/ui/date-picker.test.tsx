import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DatePicker } from './date-picker';

describe('DatePicker', () => {
  it('opens calendar popover, navigates months, selects a date emitting YYYY-MM-DD, and restores focus', () => {
    const onChange = vi.fn();
    render(
      <DatePicker
        id="test-date"
        label="Start Date"
        value="2026-11-15"
        onChange={onChange}
      />,
    );

    const trigger = screen.getByLabelText('Start Date');
    expect(trigger).toHaveTextContent('Nov 15, 2026');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger.className).toContain('rounded-md');
    expect(trigger.className).toContain('h-11');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const dialog = screen.getByRole('dialog', { name: 'Start Date calendar' });
    expect(dialog).toHaveAttribute('aria-modal', 'false');
    expect(within(dialog).getByText('November 2026')).toBeInTheDocument();

    // Navigate to next month (December 2026) and back
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next month' }));
    expect(within(dialog).getByText('December 2026')).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Previous month' }),
    );
    expect(within(dialog).getByText('November 2026')).toBeInTheDocument();

    // Select a day -> emits YYYY-MM-DD, closes popover, restores trigger focus
    fireEvent.click(within(dialog).getByRole('button', { name: '2026-11-20' }));
    expect(onChange).toHaveBeenCalledWith('2026-11-20');
    expect(
      screen.queryByRole('dialog', { name: 'Start Date calendar' }),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('supports Today (UTC) and Clear shortcuts', () => {
    const onChange = vi.fn();
    render(
      <DatePicker
        id="shortcut-date"
        label="Filter Date"
        value="2026-11-10"
        clearable={true}
        onChange={onChange}
      />,
    );

    const trigger = screen.getByLabelText('Filter Date');
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Filter Date calendar' });

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Today (UTC)' }),
    );
    const now = new Date();
    const expectedToday = `${String(now.getUTCFullYear()).padStart(4, '0')}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    expect(onChange).toHaveBeenLastCalledWith(expectedToday);

    // Reopen and click Clear
    fireEvent.click(trigger);
    const reopened = screen.getByRole('dialog', {
      name: 'Filter Date calendar',
    });
    fireEvent.click(within(reopened).getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('closes on Escape and restores focus to trigger', () => {
    render(
      <DatePicker
        id="esc-date"
        label="Escape Date"
        value=""
        placeholder="Pick a date"
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByLabelText('Escape Date');
    expect(trigger).toHaveTextContent('Pick a date');

    fireEvent.click(trigger);
    expect(
      screen.getByRole('dialog', { name: 'Escape Date calendar' }),
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.queryByRole('dialog', { name: 'Escape Date calendar' }),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});

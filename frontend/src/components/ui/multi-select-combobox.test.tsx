import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  MultiSelectCombobox,
  type MultiSelectOption,
  type MultiSelectSelectedItem,
} from './multi-select-combobox';

const OPTIONS: MultiSelectOption[] = [
  { id: 'react', label: 'React', keywords: ['ReactJS'] },
  { id: 'react-native', label: 'React Native' },
  { id: 'sql', label: 'SQL' },
  { id: 'postgresql', label: 'PostgreSQL', keywords: ['Postgres'] },
  { id: 'python', label: 'Python' },
];

describe('MultiSelectCombobox', () => {
  it('filters suggestions by label and keywords, excludes already-selected options, and selects on click', () => {
    const onSelectOption = vi.fn();
    const onRemove = vi.fn();
    const selected: MultiSelectSelectedItem[] = [{ id: 'python', label: 'Python' }];

    render(
      <MultiSelectCombobox
        options={OPTIONS}
        selected={selected}
        onSelectOption={onSelectOption}
        onRemove={onRemove}
        ariaLabel="Skills"
        placeholder="Search skills"
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Skills' });
    // Pills render inline inside the combobox container
    const pillsList = screen.getByRole('list', { name: 'Selected items' });
    expect(within(pillsList).getByText('Python')).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'Add another...');

    fireEvent.focus(input);
    const listbox = screen.getByRole('listbox', { name: 'Suggestions' });
    expect(within(listbox).queryByRole('option', { name: 'Python' })).not.toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: 'React' })).toBeInTheDocument();

    // Filter by keyword alias ("Postgres" -> "PostgreSQL")
    fireEvent.change(input, { target: { value: 'Postgres' } });
    expect(within(listbox).getAllByRole('option')).toHaveLength(1);
    const pgOption = within(listbox).getByRole('option', { name: 'PostgreSQL' });
    fireEvent.click(pgOption);

    expect(onSelectOption).toHaveBeenCalledWith(OPTIONS[3]);
    expect(input).toHaveValue('');
  });

  it('shows inline ↵ Enter hint only when query is non-empty and supports ArrowDown + Enter selection', () => {
    const onSelectOption = vi.fn();
    render(
      <MultiSelectCombobox
        options={OPTIONS}
        selected={[]}
        onSelectOption={onSelectOption}
        onRemove={vi.fn()}
        ariaLabel="Skills"
        placeholder="Search skills"
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Skills' });
    expect(input).toHaveAttribute('placeholder', 'Search skills');
    expect(screen.queryByText('↵ Enter')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Reac' } });
    expect(screen.getByText('↵ Enter')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelectOption).toHaveBeenCalledWith(OPTIONS[0]);
    expect(screen.queryByText('↵ Enter')).not.toBeInTheDocument();
  });

  it('renders clean "No matching options" status outside listbox with aria-expanded=false, keeps Enter for onCreateCustom, and preserves query when rejected', () => {
    const onSelectOption = vi.fn();
    const onCreateCustom = vi.fn((label: string) => (label === 'TooLong' ? false : true));
    render(
      <MultiSelectCombobox
        options={OPTIONS}
        selected={[]}
        onSelectOption={onSelectOption}
        onCreateCustom={onCreateCustom}
        onRemove={vi.fn()}
        allowCustom
        ariaLabel="Skills"
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Skills' });
    fireEvent.change(input, { target: { value: 'Dim' } });

    expect(screen.queryByRole('listbox', { name: 'Suggestions' })).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    const emptyStatus = screen.getByRole('status');
    expect(emptyStatus).toHaveTextContent('No matching options');
    expect(emptyStatus).not.toHaveTextContent(/not in catalog/i);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreateCustom).toHaveBeenCalledWith('Dim');
    expect(onSelectOption).not.toHaveBeenCalled();
    expect(input).toHaveValue('');

    // When onCreateCustom returns false, keep the user's input for editing
    fireEvent.change(input, { target: { value: 'TooLong' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreateCustom).toHaveBeenCalledWith('TooLong');
    expect(input).toHaveValue('TooLong');
  });

  it('removes the last selected pill on Backspace when input is empty and supports Escape to close', () => {
    const onRemove = vi.fn();
    render(
      <MultiSelectCombobox
        options={OPTIONS}
        selected={[
          { id: 'react', label: 'React', tone: 'default' },
          { id: 'dim', label: 'Dim', tone: 'warning', statusLabel: 'Needs clarification' },
        ]}
        onSelectOption={vi.fn()}
        onRemove={onRemove}
        ariaLabel="Skills"
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Skills' });
    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenNthCalledWith(1, 'dim');

    // Second Backspace also removes cleanly and increments call count individually
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onRemove).toHaveBeenCalledTimes(2);
    expect(onRemove).toHaveBeenNthCalledWith(2, 'dim');

    // Warning pill renders distinct amber styling and status label
    const dimPill = screen.getByText('Dim').closest('li')!;
    expect(dimPill).toHaveClass('border-amber-300', 'bg-amber-50/70', 'text-amber-900');
    expect(within(dimPill).getByText(/needs clarification/i)).toBeInTheDocument();
  });

  it('keeps dropdown closed on focus/click when openOnFocus={false}, opens on typing, and closes on clear or selection', () => {
    const onSelectOption = vi.fn();
    render(
      <MultiSelectCombobox
        options={OPTIONS}
        selected={[]}
        onSelectOption={onSelectOption}
        onRemove={vi.fn()}
        openOnFocus={false}
        ariaLabel="Skills"
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Skills' });
    expect(input).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(input);
    fireEvent.focus(input);
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // Typing opens dropdown immediately
    fireEvent.change(input, { target: { value: 'Rea' } });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    // Clearing back to empty closes dropdown immediately
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // Typing again and selecting an option closes dropdown
    fireEvent.change(input, { target: { value: 'SQL' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'SQL' }));
    expect(onSelectOption).toHaveBeenCalledWith(OPTIONS[2]);
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('guards IME composition keys, returns focus to input on pill removal, closes dropdown on blur keeping query, and scrolls active option into view', () => {
    const onSelectOption = vi.fn();
    const onRemove = vi.fn();
    const scrollMock = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollMock;

    try {
      render(
        <div>
          <MultiSelectCombobox
            options={OPTIONS}
            selected={[{ id: 'python', label: 'Python' }]}
            onSelectOption={onSelectOption}
            onRemove={onRemove}
            ariaLabel="Skills"
          />
          <button type="button">Outside</button>
        </div>,
      );

      const input = screen.getByRole('combobox', { name: 'Skills' });
      const removeBtn = screen.getByRole('button', { name: 'Remove Python' });

      // Removing a pill moves focus back to the combobox input
      fireEvent.click(removeBtn);
      expect(onRemove).toHaveBeenCalledWith('python');
      expect(input).toHaveFocus();

      // Open & type query
      fireEvent.change(input, { target: { value: 'Reac' } });
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      // IME composition keys must be ignored
      fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: true });
      fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
      fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
      expect(onSelectOption).not.toHaveBeenCalled();
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      // ArrowDown activates option and calls scrollIntoView({ block: 'nearest' })
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(scrollMock).toHaveBeenCalledWith({ block: 'nearest' });

      // Blurring to outside element closes dropdown and resets active option while preserving query
      const outsideBtn = screen.getByRole('button', { name: 'Outside' });
      fireEvent.blur(input, { relatedTarget: outsideBtn });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(input).toHaveValue('Reac');
      expect(input).not.toHaveAttribute('aria-activedescendant');
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});

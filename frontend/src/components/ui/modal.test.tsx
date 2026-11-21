import { StrictMode, createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './modal';

describe('Modal backdrop dismissal', () => {
  it('closes on direct backdrop click or keyboard click (detail=0 without mousedown), but ignores panel->backdrop drags', () => {
    const onClose = vi.fn();
    render(
      <Modal
        open
        onClose={onClose}
        onConfirm={vi.fn()}
        title="Confirm action"
        description="Are you sure?"
      />,
    );

    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement!;

    // Drag starting inside white dialog panel and releasing over backdrop (mouse click detail=1)
    fireEvent.mouseDown(dialog);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop, { detail: 1 });
    expect(onClose).not.toHaveBeenCalled();

    // Drag starting inside dialog and releasing over backdrop even with default jsdom detail=0
    fireEvent.mouseDown(dialog);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    // Drag starting on backdrop and releasing inside dialog
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(dialog);
    fireEvent.click(backdrop, { detail: 1 });
    expect(onClose).not.toHaveBeenCalled();

    // Direct mouse click starting and ending on backdrop closes modal
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop, { detail: 1 });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Keyboard / synthetic activation with detail=0 and no preceding pointer down closes modal
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not dismiss on backdrop click while loading', () => {
    const onClose = vi.fn();
    render(
      <Modal
        open
        loading
        onClose={onClose}
        onConfirm={vi.fn()}
        title="Working"
      />,
    );

    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop, { detail: 1 });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Compound Component Modal', () => {
  it('auto-binds aria-labelledby and aria-describedby from Modal.Title and Modal.Description and closes via Modal.Close or Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} size="md">
        <Modal.Header>
          <div>
            <Modal.Title>Add a career goal</Modal.Title>
            <Modal.Description>
              Define a technology career goal and confirm your target level.
            </Modal.Description>
          </div>
          <Modal.Close />
        </Modal.Header>
        <Modal.Body>
          <input aria-label="Goal input" />
        </Modal.Body>
        <Modal.Footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </Modal.Footer>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add a career goal' });
    const titleEl = screen.getByRole('heading', { name: 'Add a career goal' });
    const descEl = screen.getByText(
      /define a technology career goal and confirm your target level/i,
    );

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', titleEl.id);
    expect(dialog).toHaveAttribute('aria-describedby', descEl.id);

    // Initial focus moves to the dialog container itself rather than auto-focusing inner inputs
    expect(dialog).toHaveFocus();
    expect(screen.getByLabelText('Goal input')).not.toHaveFocus();

    // Clicking Modal.Close calls onClose
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Pressing Escape calls onClose
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('guards Escape, backdrop click, and Modal.Close when disableClose is true', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} disableClose>
        <Modal.Header>
          <Modal.Title>Edit skills</Modal.Title>
          <Modal.Close />
        </Modal.Header>
        <Modal.Body>
          <p>Saving skills...</p>
        </Modal.Body>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Edit skills' });
    const closeBtn = screen.getByRole('button', { name: 'Close dialog' });
    expect(closeBtn).toBeDisabled();

    fireEvent.click(closeBtn);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });

    const backdrop = dialog.parentElement!;
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop, { detail: 1 });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('traps Tab focus within the modal and restores previous focus on unmount', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open modal';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const { unmount } = render(
      <Modal open onClose={vi.fn()}>
        <Modal.Header>
          <Modal.Title>Focus Trap</Modal.Title>
          <Modal.Close />
        </Modal.Header>
        <Modal.Body>
          <input aria-label="First field" />
        </Modal.Body>
        <Modal.Footer>
          <button type="button">Last action</button>
        </Modal.Footer>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Focus Trap' });
    const closeBtn = screen.getByRole('button', { name: 'Close dialog' });
    const lastBtn = screen.getByRole('button', { name: 'Last action' });

    // Forward tab from last focusable element wraps to first (Modal.Close)
    lastBtn.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: false });
    expect(closeBtn).toHaveFocus();

    // Shift+Tab from first focusable element wraps to last
    closeBtn.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(lastBtn).toHaveFocus();

    // Unmounting restores focus to the trigger button
    unmount();
    expect(trigger).toHaveFocus();
    document.body.removeChild(trigger);
  });

  it('registers custom id on Modal.Title and Modal.Description and never leaks legacy title/description in compound mode', () => {
    render(
      <Modal open onClose={vi.fn()}>
        <Modal.Header>
          <div>
            <Modal.Title id="custom-modal-title">Custom Title</Modal.Title>
            <Modal.Description id="custom-modal-desc">
              Custom Description
            </Modal.Description>
          </div>
          <Modal.Close />
        </Modal.Header>
        <Modal.Body>
          <p>Body</p>
        </Modal.Body>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Custom Title' });
    expect(dialog).toHaveAttribute('aria-labelledby', 'custom-modal-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'custom-modal-desc');
    expect(screen.getByRole('heading', { name: 'Custom Title' })).toHaveAttribute(
      'id',
      'custom-modal-title',
    );
  });

  it('supports legacy ariaLabel without visible title and ignores Escape when a nested combobox prevents default', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} ariaLabel="Edit skills dialog">
        <Modal.Body>
          <input
            aria-label="Combobox input"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && e.currentTarget.dataset.open === 'true') {
                e.preventDefault();
                e.currentTarget.dataset.open = 'false';
              }
            }}
            data-open="true"
          />
        </Modal.Body>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Edit skills dialog' });
    expect(dialog).toHaveAttribute('aria-label', 'Edit skills dialog');
    expect(dialog).not.toHaveAttribute('aria-labelledby');

    const input = screen.getByLabelText('Combobox input');
    // 1st Escape closes the open combobox (calls preventDefault) -> Modal stays open
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    // 2nd Escape now closes the Modal
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the opener button on close even when compound Modal content has an autoFocus input', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Edit profile';
    document.body.appendChild(opener);
    opener.focus();
    expect(opener).toHaveFocus();

    const { rerender } = render(
      <Modal open onClose={vi.fn()}>
        <Modal.Header>
          <Modal.Title>AutoFocus Dialog</Modal.Title>
          <Modal.Close />
        </Modal.Header>
        <Modal.Body>
          <input aria-label="Auto focused input" autoFocus />
        </Modal.Body>
      </Modal>,
    );

    const autoFocusedInput = screen.getByLabelText('Auto focused input');
    expect(autoFocusedInput).toHaveFocus();

    rerender(
      <Modal open={false} onClose={vi.fn()}>
        <Modal.Header>
          <Modal.Title>AutoFocus Dialog</Modal.Title>
          <Modal.Close />
        </Modal.Header>
        <Modal.Body>
          <input aria-label="Auto focused input" autoFocus />
        </Modal.Body>
      </Modal>,
    );

    expect(opener).toHaveFocus();
    document.body.removeChild(opener);
  });

  it('never leaves a title-free compound Modal unnamed and warns in dev when neither Modal.Title nor ariaLabel is provided', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <Modal open onClose={vi.fn()}>
          <Modal.Body>
            <p>Unnamed body only</p>
          </Modal.Body>
        </Modal>,
      );

      const dialog = screen.getByRole('dialog', { name: 'Dialog' });
      expect(dialog).toHaveAttribute('aria-label', 'Dialog');
      expect(dialog).not.toHaveAttribute('aria-labelledby');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '<Modal> compound dialogs must render a <Modal.Title> or provide a non-empty ariaLabel prop',
        ),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('excludes hidden inputs from Tab trapping and traps Tab at document level while buttons are disabled', () => {
    render(
      <Modal open onClose={vi.fn()} disableClose>
        <Modal.Header>
          <Modal.Title>Pending Modal</Modal.Title>
          <Modal.Close />
        </Modal.Header>
        <Modal.Body>
          <input type="hidden" name="secret" value="1" />
          <button type="button" disabled>
            Saving...
          </button>
        </Modal.Body>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Pending Modal' });
    // Simulate browser dropping focus to document.body when active button becomes disabled
    (document.activeElement as HTMLElement | null)?.blur?.();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
    expect(dialog).toHaveFocus();
  });

  it('preserves autoFocus inside React StrictMode without premature opener restoration and restores opener on actual close', () => {
    const opener = document.createElement('button');
    opener.textContent = 'StrictMode Opener';
    document.body.appendChild(opener);
    opener.focus();

    const { rerender } = render(
      <StrictMode>
        <Modal open onClose={vi.fn()}>
          <Modal.Header>
            <Modal.Title>StrictMode Dialog</Modal.Title>
            <Modal.Close />
          </Modal.Header>
          <Modal.Body>
            <input aria-label="StrictMode input" autoFocus />
          </Modal.Body>
        </Modal>
      </StrictMode>,
    );

    expect(screen.getByLabelText('StrictMode input')).toHaveFocus();

    rerender(
      <StrictMode>
        <Modal open={false} onClose={vi.fn()}>
          <Modal.Header>
            <Modal.Title>StrictMode Dialog</Modal.Title>
            <Modal.Close />
          </Modal.Header>
          <Modal.Body>
            <input aria-label="StrictMode input" autoFocus />
          </Modal.Body>
        </Modal>
      </StrictMode>,
    );

    expect(opener).toHaveFocus();
    document.body.removeChild(opener);
  });

  it('restores original opener on Cancel and falls back to fallbackReturnFocusTo when opener is removed from DOM', () => {
    const fallbackRef = createRef<HTMLHeadingElement>();
    const opener = document.createElement('button');
    opener.textContent = 'Discontinue';
    document.body.appendChild(opener);
    opener.focus();

    const { rerender } = render(
      <div>
        <h2 ref={fallbackRef} tabIndex={-1}>
          Career goals
        </h2>
        <Modal open onClose={vi.fn()} fallbackReturnFocusTo={fallbackRef}>
          <Modal.Header>
            <Modal.Title>Discontinue this goal?</Modal.Title>
            <Modal.Close />
          </Modal.Header>
        </Modal>
      </div>,
    );

    // Cancel path: opener still in DOM -> restores opener
    rerender(
      <div>
        <h2 ref={fallbackRef} tabIndex={-1}>
          Career goals
        </h2>
        <Modal open={false} onClose={vi.fn()} fallbackReturnFocusTo={fallbackRef}>
          <Modal.Header>
            <Modal.Title>Discontinue this goal?</Modal.Title>
            <Modal.Close />
          </Modal.Header>
        </Modal>
      </div>,
    );
    expect(opener).toHaveFocus();

    // Confirm path: re-open, remove opener from DOM before close -> falls back to heading ref
    rerender(
      <div>
        <h2 ref={fallbackRef} tabIndex={-1}>
          Career goals
        </h2>
        <Modal open onClose={vi.fn()} fallbackReturnFocusTo={fallbackRef}>
          <Modal.Header>
            <Modal.Title>Discontinue this goal?</Modal.Title>
            <Modal.Close />
          </Modal.Header>
        </Modal>
      </div>,
    );
    document.body.removeChild(opener);

    rerender(
      <div>
        <h2 ref={fallbackRef} tabIndex={-1}>
          Career goals
        </h2>
        <Modal open={false} onClose={vi.fn()} fallbackReturnFocusTo={fallbackRef}>
          <Modal.Header>
            <Modal.Title>Discontinue this goal?</Modal.Title>
            <Modal.Close />
          </Modal.Header>
        </Modal>
      </div>,
    );
    expect(fallbackRef.current).toHaveFocus();
  });
});

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

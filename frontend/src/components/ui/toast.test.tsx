import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Toast } from './toast';

describe('Toast (#11) with countdown progress bar', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a tone-matched countdown bar synced to autoDismissMs and auto-dismisses on timeout', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(
      <Toast variant="success" autoDismissMs={4000} onDismiss={onDismiss}>
        Profile updated successfully.
      </Toast>,
    );

    const container = screen.getByTestId('toast-container');
    expect(container).toHaveClass('w-max', 'max-w-[min(92vw,28rem)]');
    expect(container).not.toHaveClass('w-[calc(100%-2rem)]', 'w-full', 'w-fit');
    const bar = screen.getByTestId('toast-countdown-bar');
    expect(bar).toHaveClass('agy-toast-bar', 'origin-left', 'bg-emerald-500', 'motion-reduce:[animation:none]');
    expect(bar.style.getPropertyValue('--toast-duration')).toBe('4000ms');
    expect(bar.style.animationName).toBe('');
    expect(bar.style.animationDuration).toBe('');
    expect(bar).toHaveStyle({
      animationPlayState: 'running',
    });

    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('pauses both countdown bar animation and auto-dismiss timer on hover, resuming for remaining time on leave', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(
      <Toast variant="warning" autoDismissMs={4000} onDismiss={onDismiss}>
        Check your input.
      </Toast>,
    );

    const container = screen.getByTestId('toast-container');
    expect(container).toHaveClass('w-max', 'max-w-[min(92vw,28rem)]');
    expect(container).not.toHaveClass('w-[calc(100%-2rem)]', 'w-full', 'w-fit');
    const bar = screen.getByTestId('toast-countdown-bar');
    expect(bar).toHaveClass('bg-amber-500');

    // Run 1500ms -> 2500ms remaining
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    // Hover pauses timer and CSS animation
    fireEvent.mouseEnter(container);
    expect(bar).toHaveStyle({ animationPlayState: 'paused' });

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    // Mouse leave resumes with remaining 2500ms
    fireEvent.mouseLeave(container);
    expect(bar).toHaveStyle({ animationPlayState: 'running' });

    act(() => {
      vi.advanceTimersByTime(2499);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps error_retryable toasts sticky without auto-dismiss or countdown bar', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(
      <Toast variant="error_retryable" autoDismissMs={4000} onDismiss={onDismiss}>
        Save failed.
      </Toast>,
    );

    expect(screen.queryByTestId('toast-countdown-bar')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('restarts countdown bar animation and timer cleanly when autoDismissMs changes while preserving hover pause/resume', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    const { rerender } = render(
      <Toast variant="success" autoDismissMs={4000} onDismiss={onDismiss}>
        Saved.
      </Toast>,
    );

    const firstBar = screen.getByTestId('toast-countdown-bar');
    expect(firstBar.style.getPropertyValue('--toast-duration')).toBe('4000ms');

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    rerender(
      <Toast variant="success" autoDismissMs={6000} onDismiss={onDismiss}>
        Saved.
      </Toast>,
    );

    const restartedBar = screen.getByTestId('toast-countdown-bar');
    expect(restartedBar).not.toBe(firstBar);
    expect(restartedBar.style.getPropertyValue('--toast-duration')).toBe('6000ms');
    expect(restartedBar).toHaveStyle({ animationPlayState: 'running' });

    // Hover pause & leave still work after duration change
    const container = screen.getByTestId('toast-container');
    fireEvent.mouseEnter(container);
    expect(restartedBar).toHaveStyle({ animationPlayState: 'paused' });
    fireEvent.mouseLeave(container);
    expect(restartedBar).toHaveStyle({ animationPlayState: 'running' });

    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('clears isPaused on mouseLeave even while switched to sticky error_retryable so returning to timed resumes countdown', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    const { rerender } = render(
      <Toast variant="success" autoDismissMs={4000} onDismiss={onDismiss}>
        Saved.
      </Toast>,
    );

    const container = screen.getByTestId('toast-container');
    // Hover pauses timed toast
    fireEvent.mouseEnter(container);
    expect(screen.getByTestId('toast-countdown-bar')).toHaveStyle({
      animationPlayState: 'paused',
    });

    // Switch to sticky error_retryable while pointer is still over toast
    rerender(
      <Toast variant="error_retryable" autoDismissMs={4000} onDismiss={onDismiss}>
        Retryable error.
      </Toast>,
    );
    expect(screen.queryByTestId('toast-countdown-bar')).not.toBeInTheDocument();

    // Pointer leaves while sticky -> MUST clear isPaused
    fireEvent.mouseLeave(container);

    // Switch back to timed toast -> countdown MUST run with full reset autoDismissMs (4000ms)
    rerender(
      <Toast variant="success" autoDismissMs={4000} onDismiss={onDismiss}>
        Saved again.
      </Toast>,
    );
    expect(screen.getByTestId('toast-countdown-bar')).toHaveStyle({
      animationPlayState: 'running',
    });

    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

'use client';

import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Alert, type AlertProps, type AlertVariant } from './alert';
import { cn } from './cn';
import { IconButton } from './icon-button';
import { CloseIcon } from './icons';

export type ToastPosition = 'bottom-right' | 'top-right' | 'top-center';

const POSITION_CLASSES: Record<ToastPosition, string> = {
  'bottom-right': 'bottom-4 right-4',
  'top-right': 'top-4 right-4',
  'top-center': 'top-4 left-1/2 -translate-x-1/2',
};

const COUNTDOWN_TRACK_CLASSES: Record<AlertVariant, string> = {
  success: 'bg-emerald-500/15 dark:bg-teal-400/15',
  error_retryable: 'bg-rose-500/15 dark:bg-rose-400/15',
  warning: 'bg-amber-500/15 dark:bg-amber-400/15',
  info: 'bg-sky-500/15 dark:bg-sky-400/15',
};

const COUNTDOWN_BAR_CLASSES: Record<AlertVariant, string> = {
  success: 'bg-emerald-500 dark:bg-teal-400',
  error_retryable: 'bg-rose-500 dark:bg-rose-400',
  warning: 'bg-amber-500 dark:bg-amber-400',
  info: 'bg-sky-500 dark:bg-sky-400',
};

const COUNTDOWN_KEYFRAMES_CSS =
  '@keyframes agy-toast-countdown{from{transform:scaleX(1)}to{transform:scaleX(0)}}' +
  '.agy-toast-bar{animation:agy-toast-countdown var(--toast-duration,6000ms) linear forwards}' +
  '@media(prefers-reduced-motion:reduce){.agy-toast-bar{animation:none}}';

export interface ToastProps extends Omit<AlertProps, 'className'> {
  onDismiss?: () => void;
  /** Auto-dismiss ms. Ignored for error_retryable (needs user action). */
  autoDismissMs?: number;
  position?: ToastPosition;
}

/**
 * Shared floating Toast primitive with a tone-matched bottom countdown bar
 * that smoothly animates `scaleX(1)` → `scaleX(0)` synced to `autoDismissMs`
 * and pauses both timer and CSS animation on pointer hover.
 */
export const Toast = memo(function Toast({
  onDismiss,
  autoDismissMs = 6000,
  position = 'top-center',
  ariaLive,
  ...alert
}: ToastProps) {
  const variant: AlertVariant = alert.variant ?? 'info';
  const sticky = variant === 'error_retryable';
  const hasDismiss = Boolean(onDismiss);
  const hasAutoDismiss = !sticky && hasDismiss && autoDismissMs > 0;

  const [isHovered, setIsHovered] = useState(false);
  const [wasAutoDismiss, setWasAutoDismiss] = useState(hasAutoDismiss);
  const [countdownCycle, setCountdownCycle] = useState(0);
  const remainingMsRef = useRef(autoDismissMs);
  const startedAtRef = useRef<number | null>(null);
  const onDismissRef = useRef(onDismiss);

  if (hasAutoDismiss !== wasAutoDismiss) {
    setWasAutoDismiss(hasAutoDismiss);
    if (hasAutoDismiss) {
      setCountdownCycle((c) => c + 1);
    }
  }

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    remainingMsRef.current = autoDismissMs;
  }, [autoDismissMs, countdownCycle]);

  useEffect(() => {
    if (!hasAutoDismiss || isHovered) return;

    const delay = Math.max(0, remainingMsRef.current);
    startedAtRef.current = Date.now();
    const timer = setTimeout(() => {
      remainingMsRef.current = 0;
      startedAtRef.current = null;
      onDismissRef.current?.();
    }, delay);

    return () => {
      clearTimeout(timer);
      if (startedAtRef.current !== null) {
        const elapsed = Date.now() - startedAtRef.current;
        remainingMsRef.current = Math.max(0, remainingMsRef.current - elapsed);
        startedAtRef.current = null;
      }
    };
  }, [hasAutoDismiss, autoDismissMs, countdownCycle, isHovered]);

  return (
    <div
      data-testid="toast-container"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'pointer-events-auto fixed z-(--z-toast) w-max max-w-[min(92vw,28rem)] shadow-lg',
        POSITION_CLASSES[position],
      )}
    >
      {hasAutoDismiss && <style>{COUNTDOWN_KEYFRAMES_CSS}</style>}
      <div className="relative overflow-hidden rounded-lg">
        <Alert
          {...alert}
          dense
          ariaLive={ariaLive ?? (sticky ? 'assertive' : 'polite')}
          className={cn(onDismiss && 'pr-10', hasAutoDismiss && 'pb-4')}
        />
        {onDismiss && (
          <IconButton
            aria-label="Dismiss notification"
            onClick={onDismiss}
            className="absolute top-2 right-2 h-7 w-7 min-h-0 min-w-0 rounded-md p-1"
          >
            <CloseIcon className="h-4 w-4" />
          </IconButton>
        )}
        {hasAutoDismiss && (
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 h-[3px] w-full',
              COUNTDOWN_TRACK_CLASSES[variant],
            )}
          >
            <div
              key={`${autoDismissMs}-${countdownCycle}`}
              data-testid="toast-countdown-bar"
              className={cn(
                'agy-toast-bar h-full w-full origin-left motion-reduce:[animation:none]',
                COUNTDOWN_BAR_CLASSES[variant],
              )}
              style={
                {
                  '--toast-duration': `${autoDismissMs}ms`,
                  animationPlayState: isHovered ? 'paused' : 'running',
                } as CSSProperties
              }
            />
          </div>
        )}
      </div>
    </div>
  );
});

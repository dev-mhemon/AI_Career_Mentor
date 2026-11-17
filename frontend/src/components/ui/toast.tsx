'use client';

import { memo, useEffect } from 'react';
import { Alert, type AlertProps } from './alert';
import { IconButton } from './icon-button';
import { CloseIcon } from './icons';

export type ToastPosition = 'bottom-right' | 'top-right' | 'top-center';

const POSITION_CLASSES: Record<ToastPosition, string> = {
  'bottom-right': 'bottom-4 right-4 left-4 mx-auto sm:left-auto sm:mx-0',
  'top-right': 'top-4 right-4 left-4 mx-auto sm:left-auto sm:mx-0',
  'top-center': 'top-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)]',
};

export interface ToastProps extends Omit<AlertProps, 'className'> {
  onDismiss?: () => void;
  /** Auto-dismiss ms. Ignored for error_retryable (needs user action). */
  autoDismissMs?: number;
  position?: ToastPosition;
}

export const Toast = memo(function Toast({
  onDismiss,
  autoDismissMs = 6000,
  position = 'top-center',
  ariaLive,
  ...alert
}: ToastProps) {
  const sticky = alert.variant === 'error_retryable';
  useEffect(() => {
    if (sticky || !onDismiss || !autoDismissMs) return;
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(t);
  }, [sticky, onDismiss, autoDismissMs]);

  return (
    <div
      className={`pointer-events-auto fixed z-(--z-toast) max-w-md shadow-lg ${POSITION_CLASSES[position]}`}
    >
      <div className="relative">
        <Alert
          {...alert}
          ariaLive={ariaLive ?? (sticky ? 'assertive' : 'polite')}
          className={onDismiss ? 'pr-12' : undefined}
        />
        {onDismiss && (
          <IconButton aria-label="Dismiss notification" onClick={onDismiss} className="absolute right-1 top-1">
            <CloseIcon />
          </IconButton>
        )}
      </div>
    </div>
  );
});

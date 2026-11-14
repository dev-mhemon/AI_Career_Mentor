'use client';

import { useEffect } from 'react';
import { Alert, type AlertProps } from './alert';
import { IconButton } from './icon-button';
import { CloseIcon } from './icons';

export interface ToastProps extends Omit<AlertProps, 'className'> {
  onDismiss?: () => void;
  /** Auto-dismiss ms. Ignored for error_retryable (needs user action). */
  autoDismissMs?: number;
}

export function Toast({ onDismiss, autoDismissMs = 6000, ...alert }: ToastProps) {
  const sticky = alert.variant === 'error_retryable';
  useEffect(() => {
    if (sticky || !onDismiss || !autoDismissMs) return;
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(t);
  }, [sticky, onDismiss, autoDismissMs]);

  return (
    <div className="pointer-events-auto fixed bottom-4 right-4 left-4 z-(--z-toast) mx-auto max-w-md shadow-lg sm:left-auto sm:mx-0">
      <div className="relative">
        <Alert {...alert} />
        {onDismiss && (
          <IconButton aria-label="Dismiss notification" onClick={onDismiss} className="absolute right-1 top-1">
            <CloseIcon />
          </IconButton>
        )}
      </div>
    </div>
  );
}

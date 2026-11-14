'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from './cn';
import { Button } from './button';
import { AlertCircleIcon, CheckCircleIcon, InfoIcon, WarningIcon } from './icons';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error_retryable';

export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  /** Live second-by-second countdown (423/429). Retry is disabled until it reaches 0. */
  retryAfterSeconds?: number | null;
  onRetry?: () => void;
  retryLabel?: string;
  action?: { label: string; onClick?: () => void; href?: string };
  role?: 'alert' | 'status';
  className?: string;
}

const tone: Record<AlertVariant, string> = {
  info: 'border-feedback-info-border bg-feedback-info-background text-feedback-info-text',
  success: 'border-feedback-success-border bg-feedback-success-background text-feedback-success-text',
  warning: 'border-feedback-warning-border bg-feedback-warning-background text-feedback-warning-text',
  error_retryable: 'border-feedback-danger-border bg-feedback-danger-background text-feedback-danger-text',
};

const icons = {
  info: <InfoIcon className="text-feedback-info-icon" />,
  success: <CheckCircleIcon className="text-feedback-success-icon" />,
  warning: <WarningIcon className="text-feedback-warning-icon" />,
  error_retryable: <AlertCircleIcon className="text-feedback-danger-icon" />,
};

export function formatCountdown(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function Countdown({ seconds, onElapsed }: { seconds: number; onElapsed: () => void }) {
  const [left, setLeft] = useState(Math.max(0, Math.ceil(seconds)));
  const onElapsedRef = useRef(onElapsed);

  useEffect(() => {
    onElapsedRef.current = onElapsed;
  });

  useEffect(() => {
    if (left <= 0) {
      onElapsedRef.current();
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  return (
    <span className="font-mono text-code tabular-nums" data-testid="retry-countdown">
      {formatCountdown(left)}
    </span>
  );
}

export function Alert({
  variant = 'info',
  title,
  children,
  retryAfterSeconds = null,
  onRetry,
  retryLabel = 'Retry',
  action,
  role,
  className,
}: AlertProps) {
  const [elapsed, setElapsed] = useState(false);
  const [prevRetryAfter, setPrevRetryAfter] = useState(retryAfterSeconds);
  if (prevRetryAfter !== retryAfterSeconds) {
    setPrevRetryAfter(retryAfterSeconds);
    setElapsed(false);
  }
  const counting = retryAfterSeconds !== null && retryAfterSeconds > 0 && !elapsed;
  const live = variant === 'error_retryable';

  return (
    <div
      role={role ?? (live ? 'alert' : 'status')}
      className={cn('flex gap-3 rounded-lg border p-4', tone[variant], className)}
    >
      <span className="mt-0.5 shrink-0">{icons[variant]}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {title && <p className="text-label-lg">{title}</p>}
        <div className="text-body-sm" dir="auto">{children}</div>
        {counting && (
          <p className="text-body-sm">
            Try again in{' '}
            <Countdown
              key={retryAfterSeconds}
              seconds={retryAfterSeconds}
              onElapsed={() => setElapsed(true)}
            />
          </p>
        )}
        {(onRetry || action) && (
          <div className="flex gap-2">
            {onRetry && (
              <Button size="sm" variant="secondary" onClick={onRetry} disabled={counting}>
                {retryLabel}
              </Button>
            )}
            {action &&
              (action.href ? (
                <Link href={action.href} className="inline-flex min-h-11 items-center px-2 text-label underline underline-offset-2">
                  {action.label}
                </Link>
              ) : (
                <Button size="sm" variant="ghost" onClick={action.onClick}>
                  {action.label}
                </Button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

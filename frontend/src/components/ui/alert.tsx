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
  /** Optional caller key to restart countdown even when retryAfterSeconds repeats with the same value. */
  resetKey?: unknown;
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

function Countdown({
  seconds,
  resetKey,
  onElapsed,
}: {
  seconds: number;
  resetKey?: unknown;
  onElapsed: () => void;
}) {
  const initialSeconds = Math.max(0, Math.ceil(seconds));
  const [left, setLeft] = useState(initialSeconds);
  const [prevProps, setPrevProps] = useState<{ seconds: number; resetKey: unknown }>({
    seconds,
    resetKey,
  });
  if (prevProps.seconds !== seconds || !Object.is(prevProps.resetKey, resetKey)) {
    setPrevProps({ seconds, resetKey });
    setLeft(initialSeconds);
  }
  const onElapsedRef = useRef(onElapsed);

  useEffect(() => {
    onElapsedRef.current = onElapsed;
  });

  useEffect(() => {
    const startSeconds = Math.max(0, Math.ceil(seconds));
    if (startSeconds <= 0) {
      onElapsedRef.current?.();
      return;
    }
    const durationMs = startSeconds * 1000;
    const monoDeadline = performance.now() + durationMs;
    const wallDeadline = Date.now() + durationMs;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    const tick = () => {
      if (done) return;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      const remainingMs = Math.min(
        monoDeadline - performance.now(),
        wallDeadline - Date.now(),
      );
      if (remainingMs <= 0) {
        done = true;
        setLeft(0);
        onElapsedRef.current?.();
        return;
      }
      const next = Math.max(0, Math.ceil(remainingMs / 1000));
      setLeft((prev) => (prev === next ? prev : next));
      timerId = setTimeout(tick, Math.min(250, Math.max(16, remainingMs)));
    };

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        tick();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    timerId = setTimeout(tick, Math.min(250, durationMs));

    return () => {
      done = true;
      if (timerId !== null) clearTimeout(timerId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }, [seconds, resetKey]);

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
  resetKey,
  onRetry,
  retryLabel = 'Retry',
  action,
  role,
  className,
}: AlertProps) {
  const [elapsed, setElapsed] = useState(false);
  const [runId, setRunId] = useState(0);
  const [prevTrigger, setPrevTrigger] = useState<{
    retryAfterSeconds: number | null;
    resetKey: unknown;
  }>({ retryAfterSeconds, resetKey });

  if (
    prevTrigger.retryAfterSeconds !== retryAfterSeconds ||
    !Object.is(prevTrigger.resetKey, resetKey)
  ) {
    setPrevTrigger({ retryAfterSeconds, resetKey });
    setElapsed(false);
    setRunId((n) => n + 1);
  }
  const hasRetryWait = retryAfterSeconds !== null && retryAfterSeconds > 0;
  const counting = hasRetryWait && !elapsed;
  const live = variant === 'error_retryable';

  return (
    <div
      className={cn('flex gap-3 rounded-lg border p-4', tone[variant], className)}
    >
      <span className="mt-0.5 shrink-0">{icons[variant]}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div role={role ?? (live ? 'alert' : 'status')} className="flex flex-col gap-2">
          {title && <p className="text-label-lg">{title}</p>}
          <div className="text-body-sm" dir="auto">{children}</div>
        </div>
        {counting && (
          <p className="text-body-sm" aria-live="off">
            Try again in{' '}
            <Countdown
              key={`${runId}-${retryAfterSeconds}`}
              seconds={retryAfterSeconds}
              resetKey={resetKey}
              onElapsed={() => setElapsed(true)}
            />
          </p>
        )}
        {hasRetryWait && elapsed && (
          <span className="sr-only" role="status">
            Cooldown complete. You can try again now.
          </span>
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

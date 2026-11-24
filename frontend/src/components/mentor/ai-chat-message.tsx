'use client';

import type { MentorLanguage, MentorMessageRole } from '@/lib/api/client';
import { cn } from '@/components/ui/cn';
import {
  AlertCircleIcon,
  InfoIcon,
  RefreshCwIcon,
  SparklesIcon,
  SpinnerIcon,
  UserIcon,
  WarningIcon,
} from '@/components/ui/icons';

export type ChatMessageDeliveryState =
  | 'sending'
  | 'sent'
  | 'failed_retryable'
  | 'failed_permanent';

export type ChatMessageItem = {
  id: string;
  role: MentorMessageRole;
  content: string;
  language: MentorLanguage;
  created_at: string;
  clientMessageId?: string;
  sentWithToken?: string;
  deliveryState?: ChatMessageDeliveryState;
  errorMessage?: string;
  retryCooldownSeconds?: number;
  safetyMode?: boolean;
  learningClaimRecorded?: boolean;
};

export type AIChatMessageProps = {
  message: ChatMessageItem;
  onRetrySend?: (clientMessageId: string) => void;
  retryDisabled?: boolean;
};

function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Component 27 (`C09` §2.7 / Screen 20): `AIChatMessage`.
 *
 * Renders `user`, `assistant`, and `safety_redirection` bubbles with `dir="auto"` for
 * Bangla/English/Mixed typography, optimistic `sending`/`failed_retryable` states preserving
 * exact `client_message_id` on retry, and calm `learning_claim_recorded` context callouts.
 * Strictly omits rating/thumbs/report buttons per `R34`.
 */
export function AIChatMessage({
  message,
  onRetrySend,
  retryDisabled = false,
}: AIChatMessageProps) {
  const isUser = message.role === 'user';
  const isSafetyMode = !isUser && Boolean(message.safetyMode);
  const isLearningClaim = !isUser && Boolean(message.learningClaimRecorded);
  const deliveryState: ChatMessageDeliveryState =
    message.deliveryState ?? 'sent';
  const formattedTime = formatMessageTime(message.created_at);

  if (isUser) {
    const canRetry =
      deliveryState === 'failed_retryable' &&
      typeof message.clientMessageId === 'string' &&
      message.clientMessageId.length > 0 &&
      typeof onRetrySend === 'function';
    const cooldownSeconds =
      typeof message.retryCooldownSeconds === 'number' &&
      message.retryCooldownSeconds > 0
        ? message.retryCooldownSeconds
        : 0;

    return (
      <article
        aria-label="Your message"
        data-testid={`chat-message-user-${message.clientMessageId ?? message.id}`}
        className="flex flex-col items-end gap-1.5"
      >
        <div className="flex max-w-[85%] items-start gap-2.5 sm:max-w-[75%]">
          <div
            className={cn(
              'rounded-2xl rounded-tr-sm px-4 py-3 text-body-sm leading-relaxed shadow-2xs',
              deliveryState === 'failed_retryable' ||
                deliveryState === 'failed_permanent'
                ? 'border border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100'
                : 'bg-teal-600 text-white dark:bg-teal-600',
            )}
          >
            <p className="select-text whitespace-pre-wrap break-words" dir="auto">
              {message.content}
            </p>
          </div>
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-300"
          >
            <UserIcon className="block h-4 w-4 shrink-0" />
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pr-10 text-2xs text-slate-500 dark:text-slate-400">
          {deliveryState === 'sending' && (
            <span
              role="status"
              className="inline-flex items-center justify-center gap-1.5 leading-tight text-teal-700 dark:text-teal-300"
            >
              <SpinnerIcon className="block h-3.5 w-3.5 shrink-0 -translate-y-[0.5px]" />
              <span className="translate-y-[0.5px] leading-tight">
                Sending...
              </span>
            </span>
          )}

          {deliveryState === 'sent' && formattedTime && (
            <time dateTime={message.created_at}>{formattedTime}</time>
          )}

          {deliveryState === 'failed_retryable' && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-end gap-2"
            >
              <span className="inline-flex items-center justify-center gap-1.5 leading-tight text-rose-700 dark:text-rose-300">
                <AlertCircleIcon className="block h-3.5 w-3.5 shrink-0 -translate-y-[0.5px]" />
                <span className="translate-y-[0.5px] leading-tight">
                  {message.errorMessage ||
                    'Message could not be delivered. Your message is saved.'}
                </span>
              </span>
              {canRetry && (
                <button
                  type="button"
                  disabled={retryDisabled || cooldownSeconds > 0}
                  onClick={() => onRetrySend(message.clientMessageId!)}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold leading-tight text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
                >
                  <RefreshCwIcon className="block h-3.5 w-3.5 shrink-0 -translate-y-[0.5px]" />
                  <span className="translate-y-[0.5px] leading-tight">
                    {cooldownSeconds > 0
                      ? `Retry in ${cooldownSeconds}s`
                      : 'Retry'}
                  </span>
                </button>
              )}
            </div>
          )}
          {deliveryState === 'failed_permanent' && (
            <div
              role="alert"
              data-testid="chat-message-permanent-error"
              className="flex flex-wrap items-center justify-end gap-2"
            >
              <span className="inline-flex items-center justify-center gap-1.5 leading-tight text-rose-700 dark:text-rose-300">
                <AlertCircleIcon className="block h-3.5 w-3.5 shrink-0 -translate-y-[0.5px]" />
                <span className="translate-y-[0.5px] leading-tight">
                  {message.errorMessage ||
                    'Message could not be sent. Edit and send as a new message.'}
                </span>
              </span>
            </div>
          )}
        </div>
      </article>
    );
  }

  return (
    <article
      aria-label={
        isSafetyMode
          ? 'AI Mentor safety support message'
          : 'AI Mentor response'
      }
      data-testid={`chat-message-assistant-${message.id}`}
      data-variant={isSafetyMode ? 'safety_redirection' : 'assistant'}
      className="flex flex-col items-start gap-2"
    >
      <div className="flex max-w-[90%] items-start gap-2.5 sm:max-w-[80%]">
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
            isSafetyMode
              ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
              : 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
          )}
        >
          {isSafetyMode ? (
            <WarningIcon className="block h-4 w-4 shrink-0" />
          ) : (
            <SparklesIcon className="block h-4 w-4 shrink-0" />
          )}
        </span>

        <div className="flex min-w-0 flex-col gap-2">
          <div
            className={cn(
              'rounded-2xl rounded-tl-sm border px-4 py-3 text-body-sm leading-relaxed shadow-2xs',
              isSafetyMode
                ? 'border-amber-300/90 bg-amber-50/80 text-slate-900 dark:border-amber-800/80 dark:bg-amber-950/35 dark:text-slate-100'
                : 'border-slate-200/90 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100',
            )}
          >
            {isSafetyMode && (
              <div
                role="region"
                aria-label="Support and care redirection"
                className="mb-2 flex items-center gap-1.5 border-b border-amber-200/80 pb-2 text-xs font-semibold leading-tight text-amber-900 dark:border-amber-800/60 dark:text-amber-200"
              >
                <WarningIcon className="block h-3.5 w-3.5 shrink-0 -translate-y-[0.5px]" />
                <span className="translate-y-[0.5px] leading-tight">
                  Support &amp; Care Resources (Non-Clinical Guidance)
                </span>
              </div>
            )}

            <p className="whitespace-pre-wrap break-words" dir="auto">
              {message.content}
            </p>
          </div>

          {isLearningClaim && (
            <div
              role="note"
              className="inline-flex items-start gap-2 rounded-xl border border-sky-200/80 bg-sky-50/75 px-3 py-2 text-xs leading-relaxed text-sky-900 dark:border-sky-800/70 dark:bg-sky-950/40 dark:text-sky-200"
            >
              <InfoIcon className="mt-0.5 block h-3.5 w-3.5 shrink-0 text-sky-700 dark:text-sky-300" />
              <span>
                Recorded as conversation context only — complete a practice quiz
                to verify topic progress.
              </span>
            </div>
          )}

          {formattedTime && (
            <div className="flex items-center gap-2 pl-1 text-2xs text-slate-500 dark:text-slate-400">
              <time dateTime={message.created_at}>{formattedTime}</time>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

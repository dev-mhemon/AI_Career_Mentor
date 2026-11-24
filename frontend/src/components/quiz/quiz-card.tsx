'use client';

import { useId } from 'react';
import type {
  QuestionDifficulty,
  QuizQuestionDTO,
  QuizResultMcqQuestionDTO,
} from '@/lib/api/client';
import { AIFeedbackComponent } from '@/components/feedback/ai-feedback-component';
import { cn } from '@/components/ui/cn';
import {
  CheckCircleIcon,
  CheckIcon,
  CloseIcon,
  InfoIcon,
} from '@/components/ui/icons';

export interface QuizDraftAnswer {
  selected_option_id: string | null;
  text: string | null;
  i_dont_know: boolean;
}

export interface QuizCardProps {
  id?: string;
  question: QuizQuestionDTO;
  questionNumber: number;
  totalQuestions: number;
  draftAnswer?: QuizDraftAnswer;
  onSelectOption?: (optionId: string) => void;
  onChangeText?: (text: string) => void;
  onToggleIDontKnow?: (checked: boolean) => void;
  disabled?: boolean;
  /** When provided, renders the question in post-submission graded review mode. */
  gradedMcqResult?: QuizResultMcqQuestionDTO;
  /** Read-only free-response text for post-submission review. */
  submittedFreeResponseText?: string | null;
  submittedIDontKnow?: boolean;
  /** Optional auth token to enable R34 post-submission quiz_question reporting (report-only). */
  accessToken?: string;
  /** Explicit reportability flag for post-submission review mode (`!already_reported`). */
  questionReportable?: boolean;
  className?: string;
}

const DIFFICULTY_META: Record<
  QuestionDifficulty,
  { label: string; className: string }
> = {
  basic: {
    label: 'Foundational',
    className:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  application: {
    label: 'Application',
    className:
      'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/60 dark:text-sky-200',
  },
  analysis: {
    label: 'Deep Analysis',
    className:
      'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800/70 dark:bg-indigo-950/60 dark:text-indigo-200',
  },
};

const HINT_LABELS: Record<string, string> = {
  sql: 'SQL Query / Explanation',
  code: 'Code / Implementation',
  config: 'Configuration Snippet',
  test_case: 'Test Case Design',
  debug: 'Debugging Analysis',
  command: 'CLI Command',
  design: 'System Design Reasoning',
  text: 'Technical Explanation',
};

/**
 * SPEC #21 `QuizCard`:
 * Pure, accessible question card supporting interactive MCQ radio cards,
 * monospace free-response textarea (with character counter and zero code execution sandbox),
 * mutually-exclusive `"I don't know"` toggle, and post-submission graded review mode.
 */
export function QuizCard({
  id,
  question,
  questionNumber,
  totalQuestions,
  draftAnswer,
  onSelectOption,
  onChangeText,
  onToggleIDontKnow,
  disabled = false,
  gradedMcqResult,
  submittedFreeResponseText,
  submittedIDontKnow = false,
  accessToken,
  questionReportable,
  className,
}: QuizCardProps) {
  const groupId = useId();
  const textareaId = `${groupId}-fr-input`;
  const isMcqReviewMode = Boolean(gradedMcqResult);
  const isFreeResponseReviewMode =
    question.type === 'free_response' &&
    submittedFreeResponseText !== undefined;
  const isReviewMode = isMcqReviewMode || isFreeResponseReviewMode;
  const diffMeta =
    DIFFICULTY_META[question.difficulty] ?? DIFFICULTY_META.application;

  const currentSelected = isMcqReviewMode
    ? (gradedMcqResult?.your_answer ?? null)
    : (draftAnswer?.selected_option_id ?? null);
  const currentText = isFreeResponseReviewMode
    ? (submittedFreeResponseText ?? '')
    : (draftAnswer?.text ?? '');
  const currentIDontKnow = isMcqReviewMode
    ? gradedMcqResult?.your_answer === null
    : isFreeResponseReviewMode
      ? Boolean(submittedIDontKnow || submittedFreeResponseText === null)
      : Boolean(draftAnswer?.i_dont_know || submittedIDontKnow);

  const maxChars =
    typeof question.max_length === 'number' && question.max_length > 0
      ? Math.min(8_000, question.max_length)
      : 4_000;
  const charCount = currentText.length;

  return (
    <article
      id={id}
      tabIndex={-1}
      aria-labelledby={`${groupId}-prompt`}
      data-question-id={question.question_id}
      data-question-type={question.type}
      className={cn(
        'flex scroll-mt-40 flex-col gap-5 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 sm:p-6 lg:scroll-mt-44 dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      {/* Question Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center justify-center rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 font-mono text-xs font-semibold leading-none tabular-nums text-teal-800 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-200">
            Question {questionNumber} of {totalQuestions}
          </span>
          <span
            className={cn(
              'inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-xs font-medium leading-none',
              diffMeta.className,
            )}
          >
            {diffMeta.label}
          </span>
          <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium leading-none text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {question.type === 'mcq'
              ? 'Multiple Choice'
              : (HINT_LABELS[question.response_hint ?? 'text'] ??
                'Free Response')}
          </span>
        </div>

        {isReviewMode && gradedMcqResult && (
          <span
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none',
              gradedMcqResult.is_correct
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-200'
                : gradedMcqResult.your_answer === null
                  ? 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/70 dark:bg-rose-950/60 dark:text-rose-200',
            )}
          >
            {gradedMcqResult.is_correct ? (
              <CheckCircleIcon className="block h-3.5 w-3.5 shrink-0" />
            ) : gradedMcqResult.your_answer === null ? null : (
              <CloseIcon className="block h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              {gradedMcqResult.is_correct
                ? 'Correct'
                : gradedMcqResult.your_answer === null
                  ? 'Skipped'
                  : 'Incorrect'}
            </span>
          </span>
        )}
      </div>

      {/* Prompt */}
      <h3
        id={`${groupId}-prompt`}
        dir="auto"
        className="text-body-lg font-semibold leading-relaxed text-slate-900 dark:text-slate-100"
      >
        {question.prompt}
      </h3>

      {/* MCQ Options */}
      {question.type === 'mcq' && question.options && (
        <div
          role="radiogroup"
          aria-labelledby={`${groupId}-prompt`}
          className="flex flex-col gap-2.5"
        >
          {question.options.map((opt) => {
            const isSelected =
              !currentIDontKnow && currentSelected === opt.option_id;
            const isCorrectOption =
              isReviewMode &&
              gradedMcqResult?.correct_answer === opt.option_id;
            const isWrongSelection =
              isReviewMode &&
              gradedMcqResult?.your_answer === opt.option_id &&
              !gradedMcqResult.is_correct;

            return (
              <label
                key={opt.option_id}
                className={cn(
                  'group relative flex min-h-12 cursor-pointer items-start gap-3.5 rounded-xl border p-3.5 transition-colors focus-within:ring-2 focus-within:ring-teal-500 focus-within:ring-offset-1 sm:p-4',
                  disabled || isReviewMode ? 'cursor-default' : '',
                  isReviewMode
                    ? isCorrectOption
                      ? 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-600 dark:bg-emerald-950/40'
                      : isWrongSelection
                        ? 'border-rose-300 bg-rose-50/70 dark:border-rose-600 dark:bg-rose-950/40'
                        : 'border-slate-200 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-900/40'
                    : isSelected
                      ? 'border-teal-600 bg-teal-50/70 ring-1 ring-teal-600/20 dark:border-teal-400 dark:bg-teal-950/40 dark:ring-teal-400/20'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800/70',
                )}
              >
                <input
                  type="radio"
                  name={`${groupId}-mcq`}
                  value={opt.option_id}
                  checked={isSelected}
                  disabled={disabled || isReviewMode}
                  onChange={() => onSelectOption?.(opt.option_id)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-semibold leading-none transition-colors',
                    isReviewMode
                      ? isCorrectOption
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : isWrongSelection
                          ? 'border-rose-600 bg-rose-600 text-white'
                          : 'border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      : isSelected
                        ? 'border-teal-600 bg-teal-600 text-white dark:border-teal-400 dark:bg-teal-400 dark:text-slate-950'
                        : 'border-slate-300 bg-white text-slate-600 group-hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
                  )}
                >
                  {isReviewMode ? (
                    isCorrectOption ? (
                      <CheckIcon className="block h-3 w-3 shrink-0" />
                    ) : isWrongSelection ? (
                      <CloseIcon className="block h-3 w-3 shrink-0" />
                    ) : (
                      opt.option_id.toUpperCase()
                    )
                  ) : isSelected ? (
                    <CheckIcon className="block h-3 w-3 shrink-0" />
                  ) : (
                    opt.option_id.toUpperCase()
                  )}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    dir="auto"
                    className="text-body-sm font-medium leading-snug text-slate-900 dark:text-slate-100"
                  >
                    {opt.text}
                  </span>
                  {isReviewMode && isCorrectOption && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold leading-none text-emerald-700 dark:text-emerald-300">
                      <span>Correct answer</span>
                    </span>
                  )}
                  {isReviewMode && isWrongSelection && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold leading-none text-rose-700 dark:text-rose-300">
                      <span>Your selection (Incorrect)</span>
                    </span>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}

      {/* Free Response Textarea */}
      {question.type === 'free_response' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              id={`${textareaId}-label`}
              htmlFor={textareaId}
              className="text-xs font-medium text-slate-600 dark:text-slate-300"
            >
              {HINT_LABELS[question.response_hint ?? 'text'] ??
                'Your technical response'}
            </label>
            <span
              className={cn(
                'font-mono text-xs tabular-nums',
                charCount > maxChars
                  ? 'font-semibold text-rose-600 dark:text-rose-400'
                  : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {charCount} / {maxChars} chars
            </span>
          </div>
          <textarea
            id={textareaId}
            aria-labelledby={`${groupId}-prompt ${textareaId}-label`}
            rows={6}
            dir="auto"
            maxLength={maxChars}
            readOnly={isReviewMode}
            disabled={disabled || isReviewMode || currentIDontKnow}
            value={currentIDontKnow ? '' : currentText}
            onChange={(e) => {
              if (disabled || isReviewMode) {
                return;
              }
              onChangeText?.(e.target.value);
            }}
            placeholder={
              currentIDontKnow
                ? 'Marked as "I don’t know" — uncheck below to enter a response.'
                : 'Write your explanation, query, or reasoning here...'
            }
            className={cn(
              'w-full rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 font-mono text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100 dark:focus:border-teal-400 dark:focus:bg-slate-900',
            )}
          />
        </div>
      )}

      {/* "I don't know" Toggle (Interactive Mode) */}
      {!isReviewMode && question.allow_i_dont_know && (
        <div className="flex items-center justify-between border-t border-slate-100 pt-3.5 dark:border-slate-800">
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-600 select-none hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100">
            <input
              type="checkbox"
              checked={currentIDontKnow}
              disabled={disabled || isReviewMode}
              onChange={(e) => {
                if (disabled || isReviewMode) {
                  return;
                }
                onToggleIDontKnow?.(e.target.checked);
              }}
              className="h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 accent-teal-600 text-teal-600 outline-none ring-0 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 dark:border-slate-600 dark:bg-slate-800 dark:accent-teal-500"
            />
            <span>I don&apos;t know this yet (skip without guessing)</span>
          </label>
        </div>
      )}

      {/* Post-Submit Graded Explanation (MCQ Review Mode — always visible for Correct, Incorrect, and Skipped) */}
      {isReviewMode &&
        typeof gradedMcqResult?.explanation === 'string' &&
        gradedMcqResult.explanation.trim().length > 0 && (
          <div
            className={cn(
              'flex items-start gap-2.5 rounded-xl border p-3.5 text-body-sm',
              gradedMcqResult.is_correct
                ? 'border-emerald-200/80 bg-emerald-50/40 text-slate-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-slate-200'
                : 'border-slate-200/80 bg-slate-50/80 text-slate-700 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300',
            )}
          >
            {gradedMcqResult.is_correct ? (
              <CheckCircleIcon className="mt-0.5 block h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <InfoIcon className="mt-0.5 block h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
            )}
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-xs font-semibold uppercase tracking-wider',
                  gradedMcqResult.is_correct
                    ? 'text-emerald-800 dark:text-emerald-300'
                    : 'text-slate-500 dark:text-slate-400',
                )}
              >
                Explanation
              </p>
              <p dir="auto" className="mt-1 leading-relaxed">
                {gradedMcqResult.explanation.trim()}
              </p>
            </div>
          </div>
        )}

      {/* R34 Screen 18: Graded question cards (MCQ & FR) support quiz_question report ONLY (no rating) */}
      {isReviewMode && accessToken && (
        <div className="border-t border-slate-100 dark:border-slate-800">
          <AIFeedbackComponent
            accessToken={accessToken}
            reportTarget={{ type: 'quiz_question', id: question.question_id }}
            alreadyReported={
              questionReportable !== undefined
                ? !questionReportable
                : gradedMcqResult
                  ? !gradedMcqResult.reportable
                  : false
            }
            compact
          />
        </div>
      )}
    </article>
  );
}

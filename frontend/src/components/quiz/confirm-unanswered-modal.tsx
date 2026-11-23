'use client';

import { Button } from '@/components/ui/button';
import {
  Modal,
  ModalBody,
  ModalClose,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';

export interface ConfirmUnansweredModalProps {
  open: boolean;
  unansweredCount: number;
  totalCount: number;
  submitting?: boolean;
  onClose: () => void;
  onConfirmSubmit: () => void;
}

/**
 * Confirmation dialog shown when the learner submits a quiz with unanswered questions
 * (`422 UNANSWERED_CONFIRMATION_REQUIRED`, `PRD` §31 / `C05` §14.7 `EP-Q05`).
 */
export function ConfirmUnansweredModal({
  open,
  unansweredCount,
  totalCount,
  submitting = false,
  onClose,
  onConfirmSubmit,
}: ConfirmUnansweredModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      disableClose={submitting}
      size="sm"
    >
      <ModalHeader>
        <div className="space-y-1">
          <ModalTitle>Submit with unanswered questions?</ModalTitle>
          <ModalDescription>
            You have {unansweredCount} of {totalCount}{' '}
            {unansweredCount === 1 ? 'question' : 'questions'} without a
            response.
          </ModalDescription>
        </div>
        <ModalClose />
      </ModalHeader>

      <ModalBody>
        <p className="text-body-sm text-slate-600 dark:text-slate-300">
          Unanswered questions will be graded as skipped. You can also return to
          the quiz and mark any unfamiliar question with{' '}
          <span className="font-medium text-slate-900 dark:text-slate-100">
            &ldquo;I don&apos;t know&rdquo;
          </span>{' '}
          to record an honest skip without guessing.
        </p>
      </ModalBody>

      <ModalFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          disabled={submitting}
          onClick={onClose}
          className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
        >
          <span>Go Back to Quiz</span>
        </Button>
        <Button
          type="button"
          variant="primary"
          loading={submitting}
          loadingText="Submitting Quiz..."
          disabled={submitting}
          onClick={onConfirmSubmit}
          className="w-full shrink-0 justify-center whitespace-nowrap sm:w-auto"
        >
          <span>Submit Anyway</span>
        </Button>
      </ModalFooter>
    </Modal>
  );
}

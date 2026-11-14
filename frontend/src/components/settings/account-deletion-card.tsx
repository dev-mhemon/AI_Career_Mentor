'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AccountDeletionActionResult,
  pollAccountDeletionStatusAction,
  requestAccountDeletionAction,
} from '@/lib/auth/actions';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Props for `AccountDeletionCard` component on Screen 22 (`/settings`).
 */
export interface AccountDeletionCardProps {
  /** Whether the authenticated user is eligible to delete their account. */
  canDeleteAccount?: boolean;
  /** Whether the user account is currently suspended (AZ-SUSP). */
  isSuspended?: boolean;
  /** Whether the user has password-backed authentication credentials. */
  hasPasswordAuth?: boolean;
  /** List of linked third-party providers (e.g. `'google'`, `'facebook'`). */
  linkedProviders?: string[];
}

const INITIAL_ACTION_STATE: AccountDeletionActionResult = {};

/**
 * Safely clears browser storage items during account deletion without throwing errors.
 */
function safeClearBrowserStorage(): void {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage?.clear();
      window.localStorage?.removeItem('supabase.auth.token');
    }
  } catch {
    // Ignore storage access errors in restricted or sandboxed environments
  }
}

/**
 * Screen 22 Danger Zone Account Deletion card & re-authentication confirmation modal.
 *
 * Implements literal confirmation ('DELETE'), live credential re-authentication,
 * DeletionReceipt status polling (EP-X01 / EP-X02), and AZ-SUSP suspended-user deletion access.
 */
export function AccountDeletionCard({
  canDeleteAccount = true,
  isSuspended = false,
  hasPasswordAuth = true,
  linkedProviders = [],
}: AccountDeletionCardProps) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [pollError, setPollError] = useState<string | null>(null);

  const [state, formAction, isPending] = useActionState(
    requestAccountDeletionAction,
    INITIAL_ACTION_STATE,
  );

  const hasNavigatedRef = useRef(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inFlightRef = useRef(false);

  const isPendingStatus = state.status === 'in_progress' || state.status === 'scheduled';
  const isPolling = isPendingStatus && Boolean(state.deletionReceipt) && !pollError;

  // Handle immediate completion or initiate polling for in_progress / scheduled status
  useEffect(() => {
    if (state.status === 'completed') {
      safeClearBrowserStorage();
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        router.push('/login?deleted=true');
      }
      return;
    }

    if (isPendingStatus && state.deletionReceipt && !pollError) {
      const receipt = state.deletionReceipt;
      let isSubscribed = true;

      const schedulePoll = () => {
        if (!isSubscribed) return;
        pollTimerRef.current = setTimeout(async () => {
          if (!isSubscribed) return;
          if (inFlightRef.current) {
            schedulePoll();
            return;
          }
          inFlightRef.current = true;
          try {
            const res = await pollAccountDeletionStatusAction(receipt);
            if (!isSubscribed) return;
            if (res.status === 'completed') {
              safeClearBrowserStorage();
              if (!hasNavigatedRef.current) {
                hasNavigatedRef.current = true;
                router.push('/login?deleted=true');
              }
              return;
            }
            if (res.error) {
              setPollError(res.error);
              return;
            }
            schedulePoll();
          } catch (err) {
            if (!isSubscribed) return;
            setPollError(
              err instanceof Error ? err.message : 'Unable to verify account deletion status.',
            );
          } finally {
            inFlightRef.current = false;
          }
        }, 2000);
      };

      schedulePoll();

      return () => {
        isSubscribed = false;
        if (pollTimerRef.current) {
          clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      };
    }
  }, [state.status, state.deletionReceipt, isPendingStatus, pollError, router]);

  const handleOpenModal = () => {
    setConfirmationInput('');
    setPasswordInput('');
    setPollError(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (!isPending && !isPolling) {
      setIsModalOpen(false);
    }
  };

  const isDeleteConfirmed = confirmationInput.trim() === 'DELETE';
  const isSubmitDisabled =
    isPending || isPolling || !isDeleteConfirmed || (hasPasswordAuth && !passwordInput.trim());

  return (
    <section
      aria-labelledby="danger-zone-heading"
      className="rounded-xl border border-feedback-danger-border bg-surface-raised p-6 text-text-primary shadow-xs"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-md border border-feedback-danger-border bg-feedback-danger-background px-2.5 py-0.5 text-caption font-semibold text-feedback-danger-text"
            role="status"
          >
            Danger Zone
          </span>
          <h2
            id="danger-zone-heading"
            className="text-heading-sm text-text-danger"
          >
            অ্যাকাউন্ট মুছে ফেলা (Account Deletion)
          </h2>
        </div>

        <p className="text-body-sm text-text-secondary">
          আপনার অ্যাকাউন্ট মুছে ফেললে প্রোফাইল, লার্নিং রোডম্যাপ, অনুশীলনের অগ্রগতি এবং সংরক্ষিত
          ডেটা স্থায়ীভাবে মুছে যাবে। কাঁচা টেক্সট ও বার্তার ক্ষেত্রে ৯০-দিনের ধারণসীমা এবং এআই
          অপারেশনাল লগ ৩০ দিনের মধ্যে স্বয়ংক্রিয়ভাবে মুছে ফেলা হবে (PRD §52)।
        </p>

        {isSuspended && (
          <p className="text-caption font-medium text-text-warning">
            স্থগিত অ্যাকাউন্টের ক্ষেত্রেও অ্যাকাউন্ট মুছে ফেলার পূর্ণ অধিকার প্রযোজ্য (AZ-SUSP)।
          </p>
        )}

        <div className="pt-1">
          <Button
            type="button"
            variant="destructive"
            size="md"
            onClick={handleOpenModal}
            disabled={!canDeleteAccount}
          >
            অ্যাকাউন্ট মুছে ফেলুন (Delete Account)
          </Button>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-(--z-modal) flex items-end justify-center bg-surface-overlay sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-modal-title"
            aria-describedby="delete-account-modal-desc"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                handleCloseModal();
              }
            }}
            className="flex max-h-[90vh] w-full flex-col gap-4 overflow-y-auto rounded-t-xl border border-border-default bg-surface-raised p-6 text-text-primary shadow-xl sm:max-w-md sm:rounded-xl"
          >
            <h3
              id="delete-account-modal-title"
              className="text-heading-md text-text-danger"
            >
              আপনি কি নিশ্চিত? (Are you absolutely sure?)
            </h3>

            <p id="delete-account-modal-desc" className="text-body-sm text-text-secondary">
              এই প্রক্রিয়াটি অপরিবর্তনীয়। নিশ্চিত করার জন্য নিচের বক্সে হুবহু{' '}
              <strong className="font-semibold text-text-primary">DELETE</strong> লিখুন
              {hasPasswordAuth ? ' এবং আপনার অ্যাকাউন্টের পাসওয়ার্ড দিন।' : '।'}
            </p>

            {(state.error || pollError) && (
              <Alert variant="error_retryable" role="alert">
                {state.error || pollError}
              </Alert>
            )}

            {isPolling && (
              <Alert variant="info" role="status">
                অ্যাকাউন্ট ডিলিট প্রক্রিয়া সম্পন্ন হচ্ছে, অনুগ্রহ করে অপেক্ষা করুন... (Processing deletion...)
              </Alert>
            )}

            <form action={formAction} className="flex flex-col gap-4">
              <Input
                id="confirmation-input"
                name="confirmation"
                variant="text"
                label="কনফার্মেশন কোড (Type DELETE to confirm)"
                required
                value={confirmationInput}
                onChange={(e) => setConfirmationInput(e.target.value)}
                placeholder="DELETE"
                readOnly={isPending}
                disabled={isPolling}
              />

              {hasPasswordAuth ? (
                <Input
                  id="password-input"
                  name="password"
                  variant="password"
                  label="পাসওয়ার্ড (Account Password)"
                  required
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  readOnly={isPending}
                  disabled={isPolling}
                />
              ) : (
                <div className="rounded-lg border border-border-subtle bg-surface-subtle p-3 text-caption text-text-secondary">
                  সংযুক্ত প্রোভাইডার ({linkedProviders.join(', ')}) দ্বারা আপনার পরিচয় যাচাই করা
                  হবে।
                </div>
              )}

              <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={handleCloseModal}
                  disabled={isPending || isPolling}
                >
                  বাতিল (Cancel)
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  size="md"
                  isLoading={isPending || isPolling}
                  loadingText="মুছে ফেলা হচ্ছে..."
                  disabled={isSubmitDisabled}
                >
                  স্থায়ীভাবে মুছে ফেলুন (Permanently Delete)
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

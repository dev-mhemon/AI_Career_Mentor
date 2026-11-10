'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AccountDeletionActionResult,
  pollAccountDeletionStatusAction,
  requestAccountDeletionAction,
} from '@/lib/auth/actions';

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
      className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-5 text-foreground"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span
            className="rounded bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-300"
            role="status"
          >
            Danger Zone
          </span>
          <h2
            id="danger-zone-heading"
            className="text-base font-semibold text-rose-800 dark:text-rose-200"
          >
            অ্যাকাউন্ট মুছে ফেলা (Account Deletion)
          </h2>
        </div>

        <p className="text-sm text-foreground/80">
          আপনার অ্যাকাউন্ট মুছে ফেললে প্রোফাইল, লার্নিং রোডম্যাপ, অনুশীলনের অগ্রগতি এবং সংরক্ষিত
          ডেটা স্থায়ীভাবে মুছে যাবে। কাঁচা টেক্সট ও বার্তার ক্ষেত্রে ৯০-দিনের ধারণসীমা এবং এআই
          অপারেশনাল লগ ৩০ দিনের মধ্যে স্বয়ংক্রিয়ভাবে মুছে ফেলা হবে (PRD §52)।
        </p>

        {isSuspended && (
          <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
            স্থগিত অ্যাকাউন্টের ক্ষেত্রেও অ্যাকাউন্ট মুছে ফেলার পূর্ণ অধিকার প্রযোজ্য (AZ-SUSP)।
          </p>
        )}

        <div className="mt-3">
          <button
            type="button"
            onClick={handleOpenModal}
            disabled={!canDeleteAccount}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-rose-600 bg-rose-600 px-4 text-sm font-medium text-white transition-colors hover:bg-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:opacity-50"
          >
            অ্যাকাউন্ট মুছে ফেলুন (Delete Account)
          </button>
        </div>
      </div>

      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-modal-title"
          aria-describedby="delete-account-modal-desc"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-xl border border-foreground/20 bg-background p-6 shadow-xl">
            <h3
              id="delete-account-modal-title"
              className="text-lg font-bold text-rose-700 dark:text-rose-300"
            >
              আপনি কি নিশ্চিত? (Are you absolutely sure?)
            </h3>

            <p id="delete-account-modal-desc" className="mt-2 text-sm text-foreground/80">
              এই প্রক্রিয়াটি অপরিবর্তনীয়। নিশ্চিত করার জন্য নিচের বক্সে হুবহু{' '}
              <strong className="font-semibold text-foreground">DELETE</strong> লিখুন
              {hasPasswordAuth ? ' এবং আপনার অ্যাকাউন্টের পাসওয়ার্ড দিন।' : '।'}
            </p>

            {(state.error || pollError) && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-800 dark:text-rose-200"
              >
                {state.error || pollError}
              </div>
            )}

            {isPolling && (
              <div
                role="status"
                className="mt-4 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-800 dark:text-sky-200"
              >
                অ্যাকাউন্ট ডিলিট প্রক্রিয়া সম্পন্ন হচ্ছে, অনুগ্রহ করে অপেক্ষা করুন... (Processing
                deletion...)
              </div>
            )}

            <form action={formAction} className="mt-4 flex flex-col gap-4">
              <div>
                <label
                  htmlFor="confirmation-input"
                  className="block text-xs font-medium text-foreground/80"
                >
                  কনফার্মেশন কোড (Type DELETE to confirm)
                </label>
                <input
                  id="confirmation-input"
                  name="confirmation"
                  type="text"
                  required
                  value={confirmationInput}
                  onChange={(e) => setConfirmationInput(e.target.value)}
                  placeholder="DELETE"
                  disabled={isPending || isPolling}
                  className="mt-1 block w-full rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm text-foreground placeholder-foreground/40 focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>

              {hasPasswordAuth ? (
                <div>
                  <label
                    htmlFor="password-input"
                    className="block text-xs font-medium text-foreground/80"
                  >
                    পাসওয়ার্ড (Account Password)
                  </label>
                  <input
                    id="password-input"
                    name="password"
                    type="password"
                    required
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="••••••••"
                    disabled={isPending || isPolling}
                    className="mt-1 block w-full rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm text-foreground placeholder-foreground/40 focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-foreground/15 bg-foreground/5 p-3 text-xs text-foreground/70">
                  সংযুক্ত প্রোভাইডার ({linkedProviders.join(', ')}) দ্বারা আপনার পরিচয় যাচাই করা
                  হবে।
                </div>
              )}

              <div className="mt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={isPending || isPolling}
                  className="rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium text-foreground hover:bg-foreground/5 disabled:opacity-50"
                >
                  বাতিল (Cancel)
                </button>
                <button
                  type="submit"
                  disabled={isSubmitDisabled}
                  className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
                >
                  {isPending || isPolling
                    ? 'মুছে ফেলা হচ্ছে...'
                    : 'স্থায়ীভাবে মুছে ফেলুন (Permanently Delete)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

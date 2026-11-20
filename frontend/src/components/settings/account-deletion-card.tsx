'use client';

import {
  memo,
  type ChangeEvent,
  type KeyboardEvent,
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  AccountDeletionActionResult,
  pollAccountDeletionStatusAction,
  requestAccountDeletionAction,
} from '@/lib/auth/actions';
import {
  clearOAuthLoginHint,
  clearRememberedLogin,
} from '@/lib/auth/remember-login';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBackdropDismiss } from '@/components/ui/modal';

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

const INVALID_PASSWORD_ERROR_PATTERN =
  /invalid password|incorrect password|re-?authentication|reauth_required|invalid credentials|সঠিক পাসওয়ার্ড/i;

/**
 * Normalizes backend/action error copy into crisp single-line English messages for the deletion modal.
 */
function formatAccountDeletionError(rawError: string): string {
  const trimmed = rawError.trim();
  if (!trimmed) {
    return 'Something went wrong. Please try again.';
  }
  if (INVALID_PASSWORD_ERROR_PATTERN.test(trimmed)) {
    return 'Incorrect password.';
  }
  return trimmed;
}

const DangerZoneOverview = memo(function DangerZoneOverview({
  isSuspended,
  canDeleteAccount,
  onOpenModal,
}: {
  isSuspended: boolean;
  canDeleteAccount: boolean;
  onOpenModal: () => void;
}) {
  return (
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
          Account Deletion
        </h2>
      </div>

      <p className="text-body-sm text-text-secondary">
        Permanently delete your account, profile, learning roadmaps, and practice history. Raw
        text and messages are retained for up to 90 days for safety compliance, and AI operational
        logs are automatically purged within 30 days. This action cannot be undone.
      </p>

      {isSuspended && (
        <p className="text-caption font-medium text-text-warning">
          Account deletion remains available while your account is suspended.
        </p>
      )}

      <div className="pt-1">
        <Button
          type="button"
          variant="destructive"
          size="md"
          onClick={onOpenModal}
          disabled={!canDeleteAccount}
        >
          Delete Account
        </Button>
      </div>
    </div>
  );
});

/**
 * Safely clears browser storage items during account deletion without throwing errors.
 */
function safeClearBrowserStorage(): void {
  try {
    clearRememberedLogin();
  } catch {
    // Ignore storage access errors in restricted or sandboxed environments
  }
  try {
    clearOAuthLoginHint();
  } catch {
    // Ignore storage access errors in restricted or sandboxed environments
  }
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage?.clear();
    } catch {
      // Ignore sessionStorage errors in restricted or sandboxed environments
    }
    try {
      window.localStorage?.removeItem('supabase.auth.token');
    } catch {
      // Ignore localStorage errors in restricted or sandboxed environments
    }
  }
}

/**
 * Screen 22 Danger Zone Account Deletion card & re-authentication confirmation modal.
 *
 * Implements live credential re-authentication, automatic backend confirmation,
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
  const [passwordInput, setPasswordInput] = useState('');
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollingStopped, setPollingStopped] = useState(false);
  const [dismissedErrorState, setDismissedErrorState] =
    useState<AccountDeletionActionResult | null>(null);

  const [state, formAction, isPending] = useActionState(
    async (prevState: AccountDeletionActionResult, formData: FormData) => {
      setPollError(null);
      setPollingStopped(false);
      try {
        clearRememberedLogin();
      } catch {
        // Ignore storage errors so deletion request proceeds
      }
      try {
        clearOAuthLoginHint();
      } catch {
        // Ignore storage errors so deletion request proceeds
      }
      const result = await requestAccountDeletionAction(prevState, formData);
      if (result.status === 'completed' || result.success) {
        safeClearBrowserStorage();
      }
      return result;
    },
    INITIAL_ACTION_STATE,
  );

  const hasNavigatedRef = useRef(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inFlightRef = useRef(false);

  const isPendingStatus = state.status === 'in_progress' || state.status === 'scheduled';
  const isPolling = isPendingStatus && Boolean(state.deletionReceipt) && !pollingStopped;

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

    if (isPendingStatus && state.deletionReceipt && !pollingStopped) {
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
              setPollingStopped(true);
              return;
            }
            schedulePoll();
          } catch (err) {
            if (!isSubscribed) return;
            setPollError(
              err instanceof Error ? err.message : 'Unable to verify account deletion status.',
            );
            setPollingStopped(true);
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
  }, [state.status, state.deletionReceipt, isPendingStatus, pollingStopped, router]);

  const handleOpenModal = useCallback(() => {
    setPasswordInput('');
    setPollError(null);
    setDismissedErrorState(state);
    setIsModalOpen(true);
  }, [state]);

  const isBusy = isPending || isPolling;

  const handleCloseModal = useCallback(() => {
    if (!isBusy) {
      setPasswordInput('');
      setPollError(null);
      setDismissedErrorState(state);
      setIsModalOpen(false);
    }
  }, [isBusy, state]);

  const handlePasswordChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setPasswordInput(e.target.value);
      setDismissedErrorState(state);
      setPollError(null);
    },
    [state],
  );

  const handleModalKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleCloseModal();
      }
    },
    [handleCloseModal],
  );

  const backdropDismiss = useBackdropDismiss(handleCloseModal, isBusy);

  const isSubmitDisabled =
    isBusy || (hasPasswordAuth && !passwordInput.trim());

  const activeErrorRaw =
    (state !== dismissedErrorState ? state.error : undefined) || pollError;
  const visibleError = activeErrorRaw
    ? formatAccountDeletionError(activeErrorRaw)
    : null;

  return (
    <section
      aria-labelledby="danger-zone-heading"
      className="rounded-xl border border-feedback-danger-border bg-surface-raised p-6 text-text-primary shadow-xs"
    >
      <DangerZoneOverview
        isSuspended={isSuspended}
        canDeleteAccount={canDeleteAccount}
        onOpenModal={handleOpenModal}
      />

      {isModalOpen && (
        <div
          {...backdropDismiss}
          className="fixed inset-0 z-(--z-modal) flex items-end justify-center bg-surface-overlay sm:items-center sm:p-4"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-modal-title"
            aria-describedby="delete-account-modal-desc"
            onKeyDown={handleModalKeyDown}
            className="flex max-h-[90vh] w-full flex-col gap-4 overflow-y-auto rounded-t-xl border border-border-default bg-surface-raised p-6 text-text-primary shadow-xl outline-none focus:outline-none focus-visible:outline-none sm:max-w-md sm:rounded-xl"
          >
            <h3
              id="delete-account-modal-title"
              className="text-heading-md text-text-danger"
            >
              Are you sure?
            </h3>

            <p id="delete-account-modal-desc" className="text-body-sm text-text-secondary">
              {hasPasswordAuth
                ? 'This action cannot be undone. Enter your account password below to confirm deletion.'
                : 'This action cannot be undone. Confirm below to permanently delete your account.'}
            </p>

            {visibleError && (
              <Alert variant="error_retryable" role="alert">
                {visibleError}
              </Alert>
            )}

            {isPolling && (
              <Alert variant="info" role="status">
                Processing account deletion, please wait...
              </Alert>
            )}

            <form action={formAction} className="flex flex-col gap-4">
              {hasPasswordAuth ? (
                <Input
                  id="password-input"
                  name="password"
                  variant="password"
                  label="Account Password"
                  required
                  value={passwordInput}
                  onChange={handlePasswordChange}
                  placeholder="Password"
                  autoComplete="current-password"
                  readOnly={isPending}
                  disabled={isPolling}
                />
              ) : (
                <div className="rounded-lg border border-border-subtle bg-surface-subtle p-3 text-caption text-text-secondary">
                  Your identity will be verified through your active sign-in session
                  {linkedProviders.length > 0 ? ` (${linkedProviders.join(', ')})` : ''}.
                </div>
              )}

              <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={handleCloseModal}
                  disabled={isBusy}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  size="md"
                  isLoading={isBusy}
                  loadingText="Deleting..."
                  disabled={isSubmitDisabled}
                >
                  Confirm Deletion
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

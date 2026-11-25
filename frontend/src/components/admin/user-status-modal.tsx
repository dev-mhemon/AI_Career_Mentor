'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  updateAdminUserStatus,
  type AdminUserDetailDTO,
  type AdminUserStatus,
} from '@/lib/api/client';
import { mapApiError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { formatAdminUserContact } from './admin-feature-labels';

const REASON_MIN_CODE_POINTS = 3;
const REASON_MAX_CODE_POINTS = 300;

export type UserStatusModalProps = {
  open: boolean;
  accessToken: string;
  user: AdminUserDetailDTO | null;
  onClose: () => void;
  onSuccess: (updatedUser: AdminUserDetailDTO) => void;
};

function countCodePoints(value: string): number {
  return Array.from(value).length;
}

function hasNulOrUnpairedSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * Compound `<Modal>` for `EP-AD03` (`PATCH /api/v1/admin/users/{id}`).
 * Enforces mandatory `3..300` Unicode code-point reason, prevents double submission,
 * preserves entered reason on failure (`R16`), and never logs reasons to telemetry.
 */
export function UserStatusModal({
  open,
  accessToken,
  user,
  onClose,
  onSuccess,
}: UserStatusModalProps) {
  if (!open || !user) return null;

  return (
    <UserStatusModalInner
      key={`${user.id}:${user.status}`}
      accessToken={accessToken}
      user={user}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}

type UserStatusModalInnerProps = {
  accessToken: string;
  user: AdminUserDetailDTO;
  onClose: () => void;
  onSuccess: (updatedUser: AdminUserDetailDTO) => void;
};

function UserStatusModalInner({
  accessToken,
  user,
  onClose,
  onSuccess,
}: UserStatusModalInnerProps) {
  const nextStatus: AdminUserStatus =
    user.status === 'active' ? 'suspended' : 'active';
  const isSuspending = nextStatus === 'suspended';

  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const activeTokenRef = useRef(accessToken);

  useEffect(() => {
    activeTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const trimmedLength = countCodePoints(reason.trim());

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlightRef.current) return;

    const trimmed = reason.trim();
    const len = countCodePoints(trimmed);
    if (hasNulOrUnpairedSurrogate(trimmed)) {
      setValidationError('Reason contains unsupported control characters.');
      return;
    }
    if (len < REASON_MIN_CODE_POINTS || len > REASON_MAX_CODE_POINTS) {
      setValidationError(
        `Reason must be between ${REASON_MIN_CODE_POINTS} and ${REASON_MAX_CODE_POINTS} characters.`,
      );
      return;
    }

    setValidationError(null);
    setSubmitError(null);
    inFlightRef.current = true;
    setSubmitting(true);

    const requestToken = activeTokenRef.current;
    try {
      const updated = await updateAdminUserStatus(requestToken, user.id, {
        status: nextStatus,
        reason: trimmed,
      });
      if (!mountedRef.current || activeTokenRef.current !== requestToken) {
        return;
      }
      onSuccess(updated);
    } catch (err) {
      if (!mountedRef.current || activeTokenRef.current !== requestToken) {
        return;
      }
      const mapped = mapApiError(err);
      setSubmitError(mapped.message);
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) {
        setSubmitting(false);
      }
    }
  };

  return (
    <Modal open onClose={onClose} disableClose={submitting} size="md">
      <Modal.Header>
        <div className="min-w-0">
          <Modal.Title>
            {isSuspending ? 'Suspend User Account' : 'Reactivate User Account'}
          </Modal.Title>
          <Modal.Description>
            Target account: {formatAdminUserContact(user)} ({user.id.slice(0, 8)}…)
          </Modal.Description>
        </div>
        <Modal.Close disabled={submitting} />
      </Modal.Header>

      <form onSubmit={handleSubmit} noValidate>
        <Modal.Body className="flex flex-col gap-4">
          <Alert variant={isSuspending ? 'warning' : 'info'}>
            {isSuspending
              ? 'Suspension blocks all normal learning and AI features regardless of feature overrides. Existing learner data remains preserved and the user retains access to account deletion.'
              : 'Reactivating restores access to all preserved roadmaps, Daily Plans, and learning progress subject to current global and per-user feature controls.'}
          </Alert>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="admin-status-reason"
                className="text-label-md font-medium text-text-primary"
              >
                Mandatory Audit Reason
              </label>
              <span
                aria-live="polite"
                className={`text-caption tabular-nums ${
                  trimmedLength > REASON_MAX_CODE_POINTS
                    ? 'font-semibold text-feedback-danger-text'
                    : 'text-text-secondary'
                }`}
              >
                {trimmedLength} / {REASON_MAX_CODE_POINTS}
              </span>
            </div>
            <textarea
              id="admin-status-reason"
              name="reason"
              rows={4}
              value={reason}
              disabled={submitting}
              onChange={(e) => {
                setReason(e.target.value);
                if (validationError) setValidationError(null);
              }}
              aria-invalid={Boolean(validationError)}
              aria-describedby="admin-status-reason-hint"
              placeholder={
                isSuspending
                  ? 'Describe the policy reason for suspending this account (3–300 characters)…'
                  : 'Describe the reason for reactivating this account (3–300 characters)…'
              }
              className="w-full rounded-lg border border-border-default bg-surface-raised p-3 text-body-sm text-text-primary placeholder:text-text-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p
              id="admin-status-reason-hint"
              className="text-caption text-text-secondary"
            >
              Recorded in the immutable admin audit log (3–300 characters
              required).
            </p>
            {validationError && (
              <p
                role="alert"
                className="text-caption font-medium text-feedback-danger-text"
              >
                {validationError}
              </p>
            )}
          </div>

          {submitError && (
            <Alert variant="error_retryable" role="alert">
              {submitError}
            </Alert>
          )}
        </Modal.Body>

        <Modal.Footer>
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant={isSuspending ? 'destructive' : 'primary'}
            size="md"
            loading={submitting}
            disabled={submitting}
          >
            {isSuspending ? 'Confirm Suspend' : 'Confirm Reactivate'}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getAdminUser, type AdminUserDetailDTO } from '@/lib/api/client';
import { mapApiError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  CheckCircleIcon,
  CloseIcon,
  LockIcon,
  RefreshCwIcon,
  SlidersIcon,
} from '@/components/ui/icons';
import {
  ADMIN_FEATURE_META_BY_KEY,
  formatAdminUserContact,
  formatAdminUtcTimestamp,
} from './admin-feature-labels';

export type AdminUserDetailDrawerProps = {
  userId: string | null;
  accessToken: string;
  externalDetail: AdminUserDetailDTO | null;
  disableEscape?: boolean;
  onClose: () => void;
  onRequestStatusChange: (detail: AdminUserDetailDTO) => void;
};

/**
 * Accessible slide-over drawer for `EP-AD02` (`GET /api/v1/admin/users/{id}`).
 * Renders summary, aggregate counts only (`PRD §51` — zero private content), and the
 * 7-row effective feature access matrix. Closes on `Escape` and restores opener focus.
 */
export function AdminUserDetailDrawer({
  userId,
  accessToken,
  externalDetail,
  disableEscape = false,
  onClose,
  onRequestStatusChange,
}: AdminUserDetailDrawerProps) {
  if (!userId) return null;

  return (
    <AdminUserDetailDrawerInner
      key={userId}
      userId={userId}
      accessToken={accessToken}
      externalDetail={
        externalDetail && externalDetail.id === userId ? externalDetail : null
      }
      disableEscape={disableEscape}
      onClose={onClose}
      onRequestStatusChange={onRequestStatusChange}
    />
  );
}

type DrawerInnerProps = {
  userId: string;
  accessToken: string;
  externalDetail: AdminUserDetailDTO | null;
  disableEscape: boolean;
  onClose: () => void;
  onRequestStatusChange: (detail: AdminUserDetailDTO) => void;
};

function AdminUserDetailDrawerInner({
  userId,
  accessToken,
  externalDetail,
  disableEscape,
  onClose,
  onRequestStatusChange,
}: DrawerInnerProps) {
  const [fetchedDetail, setFetchedDetail] = useState<AdminUserDetailDTO | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null)
      : null,
  );
  const openerRef = useRef(opener);
  const onCloseRef = useRef(onClose);
  const disableEscapeRef = useRef(disableEscape);

  useEffect(() => {
    onCloseRef.current = onClose;
    disableEscapeRef.current = disableEscape;
  }, [onClose, disableEscape]);

  // Focus drawer on mount, close on Escape, and restore opener focus on unmount.
  useEffect(() => {
    const panelNode = panelRef.current;
    const openerNode = openerRef.current;
    panelNode?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !disableEscapeRef.current) {
        if (event.defaultPrevented) return;
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (!panelNode || !panelNode.isConnected) {
        if (
          openerNode &&
          openerNode.isConnected &&
          !openerNode.hasAttribute('disabled')
        ) {
          openerNode.focus();
        }
      }
    };
  }, []);

  // Load EP-AD02 detail — zero synchronous setState inside effect body.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void getAdminUser(accessToken, userId, { signal: controller.signal })
      .then((res) => {
        if (active && !controller.signal.aborted) {
          setFetchedDetail(res);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (active && !controller.signal.aborted) {
          setError(mapApiError(err).message);
          setLoading(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [accessToken, userId, retryNonce]);

  const detail = externalDetail ?? fetchedDetail;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/40 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget && !disableEscape) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-user-drawer-title"
        tabIndex={-1}
        className="flex h-dvh w-full max-w-xl flex-col border-l border-border-default bg-surface-raised text-text-primary shadow-xl outline-none"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-default px-6 py-4">
          <div className="min-w-0">
            <h2
              id="admin-user-drawer-title"
              className="text-heading-md font-semibold text-text-primary"
            >
              User Account Detail
            </h2>
            <p className="mt-0.5 truncate font-mono text-caption text-text-secondary">
              {userId}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close user detail drawer"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
          {loading && !detail ? (
            <div
              data-testid="user-drawer-skeleton"
              aria-busy="true"
              className="flex flex-col gap-4"
            >
              <div className="h-20 animate-pulse rounded-xl bg-surface-subtle motion-reduce:animate-none" />
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="h-16 animate-pulse rounded-xl bg-surface-subtle motion-reduce:animate-none"
                  />
                ))}
              </div>
              <div className="h-48 animate-pulse rounded-xl bg-surface-subtle motion-reduce:animate-none" />
            </div>
          ) : error && !detail ? (
            <Alert variant="error_retryable" role="alert">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    setLoading(true);
                    setError(null);
                    setRetryNonce((n) => n + 1);
                  }}
                >
                  <RefreshCwIcon className="h-4 w-4" />
                  <span>Retry</span>
                </Button>
              </div>
            </Alert>
          ) : detail ? (
            <>
              {/* Account Summary */}
              <section className="flex flex-col gap-3 rounded-xl border border-border-default bg-surface-subtle/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-text-primary">
                    {formatAdminUserContact(detail)}
                  </span>
                  <UserStatusBadge status={detail.status} />
                </div>
                <dl className="grid grid-cols-1 gap-2 text-caption sm:grid-cols-2">
                  <div>
                    <dt className="text-text-tertiary">Email</dt>
                    <dd className="break-all font-medium text-text-primary">
                      {detail.email?.trim() || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-tertiary">Phone</dt>
                    <dd className="font-mono text-text-primary">
                      {detail.phone?.trim() || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-tertiary">Created</dt>
                    <dd className="font-mono text-text-secondary">
                      {formatAdminUtcTimestamp(detail.created_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-tertiary">Last Active</dt>
                    <dd className="font-mono text-text-secondary">
                      {formatAdminUtcTimestamp(detail.last_active_at)}
                    </dd>
                  </div>
                </dl>
              </section>

              {/* Aggregate Counts Only (PRD §51) */}
              <section aria-labelledby="drawer-counts-heading">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3
                    id="drawer-counts-heading"
                    className="text-heading-sm font-semibold text-text-primary"
                  >
                    Aggregate Activity Counts
                  </h3>
                  <span className="text-caption text-text-tertiary">
                    Counts only — private content excluded
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <CountTile label="Roadmaps" value={detail.counts.roadmaps} />
                  <CountTile
                    label="Quizzes Submitted"
                    value={detail.counts.quizzes_submitted}
                  />
                  <CountTile
                    label="Mentor Messages (Count)"
                    value={detail.counts.mentor_messages}
                  />
                  <CountTile
                    label="AI Requests"
                    value={detail.counts.ai_requests}
                  />
                </div>
              </section>

              {/* 7-Row Effective Feature Access Matrix */}
              <section aria-labelledby="drawer-features-heading">
                <h3
                  id="drawer-features-heading"
                  className="mb-2 text-heading-sm font-semibold text-text-primary"
                >
                  Effective Feature Access
                </h3>
                <div
                  role="region"
                  aria-label="User effective feature access table"
                  tabIndex={0}
                  className="overflow-x-auto rounded-xl border border-border-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                >
                  <table className="w-full min-w-[460px] border-collapse text-left text-caption">
                    <thead>
                      <tr className="border-b border-border-default bg-surface-subtle text-text-secondary">
                        <th
                          scope="col"
                          className="px-3 py-2.5 text-left font-semibold"
                        >
                          Feature
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2.5 text-center font-semibold"
                        >
                          Global
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2.5 text-center font-semibold"
                        >
                          User Override
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2.5 text-right font-semibold"
                        >
                          Effective
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {detail.feature_access.map((entry) => {
                        const meta =
                          ADMIN_FEATURE_META_BY_KEY[entry.feature_key];
                        return (
                          <tr key={entry.feature_key}>
                            <td className="px-3 py-2.5 text-left align-middle">
                              <div className="font-medium text-text-primary">
                                {meta?.label ?? entry.feature_key}
                              </div>
                              <div className="font-mono text-[11px] text-text-tertiary">
                                {entry.feature_key}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-center align-middle text-text-secondary">
                              {entry.global_enabled ? 'ON' : 'OFF'}
                            </td>
                            <td className="px-3 py-2.5 text-center align-middle text-text-secondary">
                              {entry.user_override === null
                                ? 'Inherit'
                                : entry.user_override
                                  ? 'Enabled'
                                  : 'Disabled'}
                            </td>
                            <td className="px-3 py-2.5 text-right align-middle">
                              <span
                                className={
                                  entry.effective
                                    ? 'inline-flex items-center gap-1 rounded-full border border-feedback-success-border bg-feedback-success-background px-2 py-0.5 font-medium text-feedback-success-text'
                                    : 'inline-flex items-center gap-1 rounded-full border border-border-default bg-surface-subtle px-2 py-0.5 font-medium text-text-secondary'
                                }
                              >
                                {entry.effective ? (
                                  <>
                                    <CheckCircleIcon className="h-3 w-3" />
                                    <span>Enabled</span>
                                  </>
                                ) : (
                                  <>
                                    <LockIcon className="h-3 w-3" />
                                    <span>Disabled</span>
                                  </>
                                )}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}
        </div>

        {detail && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-default bg-surface-subtle px-6 py-4">
            <Link
              href={`/admin/features?userId=${encodeURIComponent(detail.id)}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border-default bg-surface-raised px-4 text-body-sm font-medium text-text-primary transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              <SlidersIcon className="h-4 w-4 text-text-secondary" />
              <span>Manage Feature Overrides</span>
            </Link>

            <Button
              type="button"
              variant={detail.status === 'active' ? 'destructive' : 'primary'}
              size="md"
              onClick={() => onRequestStatusChange(detail)}
            >
              {detail.status === 'active' ? 'Suspend User' : 'Reactivate User'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function UserStatusBadge({ status }: { status: 'active' | 'suspended' }) {
  if (status === 'suspended') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-feedback-danger-border bg-feedback-danger-background px-2.5 py-0.5 text-caption font-medium text-feedback-danger-text">
        <LockIcon className="h-3.5 w-3.5" />
        <span>Suspended</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-feedback-success-border bg-feedback-success-background px-2.5 py-0.5 text-caption font-medium text-feedback-success-text">
      <CheckCircleIcon className="h-3.5 w-3.5" />
      <span>Active</span>
    </span>
  );
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border-default bg-surface-raised p-3">
      <span className="text-caption text-text-secondary">{label}</span>
      <span className="text-heading-md font-semibold tabular-nums text-text-primary">
        {value.toLocaleString('en-US')}
      </span>
    </div>
  );
}

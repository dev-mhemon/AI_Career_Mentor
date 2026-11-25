'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listAdminFeatures,
  updateGlobalFeature,
  type AdminFeatureKey,
  type FeatureControlDTO,
} from '@/lib/api/client';
import { mapApiError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { InfoIcon, RefreshCwIcon } from '@/components/ui/icons';
import { Toast } from '@/components/ui/toast';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import {
  ADMIN_FEATURE_META_BY_KEY,
  formatAdminUtcTimestamp,
} from './admin-feature-labels';
import { UserFeatureOverridePanel } from './user-feature-override-panel';

export type AdminFeaturesViewProps = {
  accessToken: string;
  initialUserId?: string | null;
};

/**
 * Screen 25 (`/admin/features`): Admin Feature Controls (`C09` §3.5, `R10`, `R16`, `PRD §7, §51`).
 * Implements pessimistic global feature toggles (`EP-AD04`, `EP-AD05`) and per-user
 * 3-state overrides (`EP-AD06`: Enabled / Disabled / Inherit).
 */
export function AdminFeaturesView({
  accessToken,
  initialUserId = null,
}: AdminFeaturesViewProps) {
  const [features, setFeatures] = useState<FeatureControlDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [savingFeatureKey, setSavingFeatureKey] =
    useState<AdminFeatureKey | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [globalRefreshNonce, setGlobalRefreshNonce] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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

  // Load EP-AD04 global features on mount / retry without synchronous setState.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void listAdminFeatures(accessToken, { signal: controller.signal })
      .then((rows) => {
        if (active && !controller.signal.aborted) {
          setFeatures(rows);
          setLoadError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (active && !controller.signal.aborted) {
          setLoadError(mapApiError(err).message);
          setLoading(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [accessToken, retryNonce]);

  const handleToggleGlobal = useCallback(
    async (featureKey: AdminFeatureKey, nextEnabled: boolean) => {
      if (savingFeatureKey !== null) return;
      setSavingFeatureKey(featureKey);
      setMutationError(null);

      const requestToken = activeTokenRef.current;
      try {
        const updated = await updateGlobalFeature(requestToken, {
          feature_key: featureKey,
          enabled: nextEnabled,
        });
        if (!mountedRef.current) {
          return;
        }
        if (activeTokenRef.current !== requestToken) {
          // Do not apply old-token payload directly; reconcile both global and selected-user views with the current token.
          setRetryNonce((n) => n + 1);
          setGlobalRefreshNonce((n) => n + 1);
          return;
        }
        setFeatures((prev) =>
          prev.map((row) =>
            row.feature_key === updated.feature_key ? updated : row,
          ),
        );
        setGlobalRefreshNonce((n) => n + 1);
        const label = ADMIN_FEATURE_META_BY_KEY[featureKey]?.label ?? featureKey;
        setToastMessage(
          `${label} is now globally ${updated.enabled ? 'enabled' : 'disabled'}.`,
        );
      } catch (err) {
        if (!mountedRef.current || activeTokenRef.current !== requestToken) {
          return;
        }
        // Pessimistic: keep exact server state and surface curated inline error.
        setMutationError(mapApiError(err).message);
      } finally {
        if (mountedRef.current) {
          setSavingFeatureKey(null);
        }
      }
    },
    [savingFeatureKey],
  );

  return (
    <main
      aria-labelledby="admin-features-heading"
      className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8"
    >
      {toastMessage && (
        <Toast variant="success" onDismiss={() => setToastMessage(null)}>
          {toastMessage}
        </Toast>
      )}

      <header className="flex flex-col gap-1.5 border-b border-border-default pb-6">
        <h1
          id="admin-features-heading"
          className="text-heading-lg font-semibold text-text-primary"
        >
          Feature Access Controls
        </h1>
        <p className="max-w-2xl text-body-sm text-text-secondary">
          Manage global feature availability and per-user feature overrides. All
          changes are verified server-side and recorded in the immutable audit
          log.
        </p>
      </header>

      {/* Effective Access Formula Visualizer (PRD §7, R10) */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-xl border border-feedback-info-border bg-feedback-info-background p-4 text-body-sm text-feedback-info-text"
      >
        <InfoIcon className="mt-0.5 h-4 w-4 text-feedback-info-icon" />
        <div className="flex flex-col gap-1">
          <p className="font-mono text-caption font-semibold sm:text-body-sm">
            Account Active &and; Global Enabled &and; (User Override ?? Default)
            = Effective Access
          </p>
          <p className="text-caption sm:text-body-sm">
            <strong>Daily Technology Updates</strong> (
            <code>technology_update</code>) defaults to <strong>OFF</strong> per
            user until enabled. Disabling any feature blocks new generation only
            and never deletes existing learner roadmaps, plans, or progress.
          </p>
        </div>
      </div>

      {/* Global Feature Matrix (EP-AD04 & EP-AD05) */}
      <section
        aria-labelledby="global-features-heading"
        className="flex flex-col gap-4 rounded-xl border border-border-default bg-surface-raised p-5"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="global-features-heading"
            className="text-heading-md font-semibold text-text-primary"
          >
            Global Feature Matrix
          </h2>
          <p className="text-body-sm text-text-secondary">
            Global switches apply immediately to all users. A globally disabled
            feature cannot be overridden by a per-user enable.
          </p>
        </div>

        {mutationError && (
          <Alert variant="error_retryable" role="alert">
            {mutationError}
          </Alert>
        )}

        {loading && features.length === 0 ? (
          <div
            data-testid="global-features-skeleton"
            aria-busy="true"
            className="grid grid-cols-1 gap-3 md:grid-cols-2"
          >
            {Array.from({ length: 7 }).map((_, idx) => (
              <div
                key={idx}
                className="h-20 animate-pulse rounded-lg bg-surface-subtle motion-reduce:animate-none"
              />
            ))}
          </div>
        ) : loadError && features.length === 0 ? (
          <Alert variant="error_retryable" role="alert">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{loadError}</span>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => {
                  setLoading(true);
                  setLoadError(null);
                  setRetryNonce((n) => n + 1);
                }}
              >
                <RefreshCwIcon className="h-4 w-4" />
                <span>Retry features</span>
              </Button>
            </div>
          </Alert>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {features.map((row) => {
              const meta = ADMIN_FEATURE_META_BY_KEY[row.feature_key];
              const isSaving = savingFeatureKey === row.feature_key;
              return (
                <div
                  key={row.feature_key}
                  className="flex flex-col gap-2 rounded-xl border border-border-default bg-surface-subtle/30 p-3"
                >
                  <ToggleSwitch
                    id={`global-feature-${row.feature_key}`}
                    checked={row.enabled}
                    saving={isSaving}
                    disabled={savingFeatureKey !== null && !isSaving}
                    label={meta?.label ?? row.feature_key}
                    description={`${row.feature_key} · ${meta?.description ?? ''}`}
                    onCheckedChange={(next) =>
                      void handleToggleGlobal(row.feature_key, next)
                    }
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-caption text-text-tertiary">
                    <span
                      className={
                        row.enabled
                          ? 'inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-caption font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300'
                          : 'inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-caption font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300'
                      }
                    >
                      {row.enabled ? 'Global ON' : 'Global OFF'}
                    </span>
                    <span className="font-mono">
                      Updated {formatAdminUtcTimestamp(row.updated_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Per-User Feature Overrides Panel (EP-AD01, EP-AD02, EP-AD06) */}
      <UserFeatureOverridePanel
        accessToken={accessToken}
        initialUserId={initialUserId}
        globalRefreshNonce={globalRefreshNonce}
        onOverrideSaved={(msg) => setToastMessage(msg)}
      />
    </main>
  );
}

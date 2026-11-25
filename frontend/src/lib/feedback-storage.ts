'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { RatingTarget, ReportReason, ReportTarget } from '@/lib/api/client';

export type StoredRatingFeedback = {
  score: number;
  comment?: string;
};

export type StoredReportFeedback = {
  reported: true;
  reason?: ReportReason;
  comment?: string;
};

export type StoredFeedbackEntry = {
  rating?: StoredRatingFeedback;
  report?: StoredReportFeedback;
};

export type FeedbackStorageTarget = {
  type: RatingTarget | ReportTarget;
  id: string;
};

export type FeedbackStorageKind = 'rating' | 'report' | 'report_marker';

const STORAGE_PREFIX = 'acm:feedback:v1';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canonicalizeFeedbackTargetId(targetId: string): string {
  const cleanId = targetId.trim();
  return UUID_PATTERN.test(cleanId) ? cleanId.toLowerCase() : cleanId;
}

const VALID_REPORT_REASONS = new Set<ReportReason>([
  'incorrect',
  'unclear',
  'unfair_scoring',
  'outdated',
  'inappropriate',
  'other',
]);

type CachedSnapshot = {
  raw: string | null;
  value: StoredFeedbackEntry | null;
};

export type SaveStoredRatingResult = {
  status: 'saved' | 'superseded';
};

type OverlayEntry = {
  value: StoredFeedbackEntry;
  baselineRaw: string | null;
};

const snapshotCache = new Map<string, CachedSnapshot>();
const memoryOverlay = new Map<string, OverlayEntry>();
const keyListeners = new Map<string, Set<() => void>>();
const ratingSubmissionChains = new Map<string, Promise<void>>();
let overlayStorageListenerAttached = false;
let nextRatingWriteSeq = 0;
const latestAcceptedRatingWriteSeq = new Map<string, number>();

function fnv1a32(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function hashScope(input: string): string {
  return `${fnv1a32(input, 0x811c9dc5)}${fnv1a32(input, 0x01000193)}`;
}

function decodeBase64UrlUtf8(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  if (typeof atob === 'function') {
    const binary = atob(base64 + pad);
    if (typeof TextDecoder === 'function') {
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    }
    return binary;
  }
  return Buffer.from(base64 + pad, 'base64').toString('utf8');
}

function extractJwtSub(accessToken: string): string | null {
  const parts = accessToken.split('.');
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }
  try {
    const decoded = decodeBase64UrlUtf8(parts[1]);
    const parsed: unknown = JSON.parse(decoded);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'sub' in parsed &&
      typeof (parsed as { sub?: unknown }).sub === 'string'
    ) {
      const sub = (parsed as { sub: string }).sub.trim();
      return sub.length > 0 ? sub : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Derives a non-sensitive per-user storage scope from JWT `sub` (hashed) or a
 * double-FNV1a hash of the token string. Raw JWTs are never stored.
 */
export function deriveFeedbackUserScope(accessToken: string): string | null {
  const trimmed = accessToken.trim();
  if (!trimmed) {
    return null;
  }
  const sub = extractJwtSub(trimmed);
  if (sub) {
    return `u_${hashScope(sub)}`;
  }
  return `t_${hashScope(trimmed)}`;
}

export function buildFeedbackStorageKey(
  accessToken: string,
  targetType: RatingTarget | ReportTarget,
  targetId: string,
  kind: FeedbackStorageKind = 'rating',
): string | null {
  const userScope = deriveFeedbackUserScope(accessToken);
  const cleanId = canonicalizeFeedbackTargetId(targetId);
  if (!userScope || !cleanId) {
    return null;
  }
  return `${STORAGE_PREFIX}:${kind}:${userScope}:${targetType}:${cleanId}`;
}

function parseStoredEntry(raw: string | null): StoredFeedbackEntry | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const entry: StoredFeedbackEntry = {};

    if (obj.rating && typeof obj.rating === 'object') {
      const ratingObj = obj.rating as Record<string, unknown>;
      if (
        typeof ratingObj.score === 'number' &&
        Number.isInteger(ratingObj.score) &&
        ratingObj.score >= 1 &&
        ratingObj.score <= 5
      ) {
        entry.rating = {
          score: ratingObj.score,
          ...(typeof ratingObj.comment === 'string' &&
          ratingObj.comment.trim().length > 0
            ? { comment: ratingObj.comment.trim() }
            : {}),
        };
      }
    }

    if (obj.report && typeof obj.report === 'object') {
      const reportObj = obj.report as Record<string, unknown>;
      if (reportObj.reported === true) {
        const reason =
          typeof reportObj.reason === 'string' &&
          VALID_REPORT_REASONS.has(reportObj.reason as ReportReason)
            ? (reportObj.reason as ReportReason)
            : undefined;
        const comment =
          typeof reportObj.comment === 'string' &&
          reportObj.comment.trim().length > 0
            ? reportObj.comment.trim()
            : undefined;
        entry.report = {
          reported: true,
          ...(reason ? { reason } : {}),
          ...(comment ? { comment } : {}),
        };
      }
    }

    if (!entry.rating && !entry.report) {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function safeReadRaw(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWriteRaw(key: string, raw: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    window.localStorage.setItem(key, raw);
    return true;
  } catch {
    // Storage quota or restricted-mode error; caller retains an in-memory overlay.
    return false;
  }
}

function isLocalStorageEvent(event: StorageEvent): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return event.storageArea === window.localStorage;
  } catch {
    return false;
  }
}

function handleGlobalOverlayStorageEvent(event: StorageEvent): void {
  if (!isLocalStorageEvent(event)) {
    return;
  }
  if (memoryOverlay.size === 0) {
    detachOverlayStorageListenerIfIdle();
    return;
  }
  if (event.key === null) {
    const affectedKeys = Array.from(memoryOverlay.keys());
    memoryOverlay.clear();
    for (const k of affectedKeys) {
      snapshotCache.delete(k);
      notifyKeyListeners(k);
    }
    detachOverlayStorageListenerIfIdle();
    return;
  }
  const overlay = memoryOverlay.get(event.key);
  if (!overlay) {
    return;
  }
  const nextRaw = event.newValue ?? safeReadRaw(event.key);
  if (nextRaw !== overlay.baselineRaw) {
    memoryOverlay.delete(event.key);
    snapshotCache.delete(event.key);
    notifyKeyListeners(event.key);
    detachOverlayStorageListenerIfIdle();
  }
}

function attachOverlayStorageListener(): void {
  if (overlayStorageListenerAttached || typeof window === 'undefined') {
    return;
  }
  window.addEventListener('storage', handleGlobalOverlayStorageEvent);
  overlayStorageListenerAttached = true;
}

function detachOverlayStorageListenerIfIdle(): void {
  if (
    !overlayStorageListenerAttached ||
    memoryOverlay.size > 0 ||
    typeof window === 'undefined'
  ) {
    return;
  }
  window.removeEventListener('storage', handleGlobalOverlayStorageEvent);
  overlayStorageListenerAttached = false;
}

function setMemoryOverlay(key: string, value: StoredFeedbackEntry): void {
  memoryOverlay.set(key, { value, baselineRaw: safeReadRaw(key) });
  attachOverlayStorageListener();
}

function deleteMemoryOverlay(key: string): void {
  memoryOverlay.delete(key);
  detachOverlayStorageListenerIfIdle();
}

function readFeedbackSnapshot(key: string | null): StoredFeedbackEntry | null {
  if (!key || typeof window === 'undefined') {
    return null;
  }
  const overlaid = memoryOverlay.get(key);
  if (overlaid !== undefined) {
    const currentRaw = safeReadRaw(key);
    if (currentRaw === overlaid.baselineRaw) {
      return overlaid.value;
    }
    // Durable storage changed since the failed write; reconcile with durable state.
    deleteMemoryOverlay(key);
  }
  const raw = safeReadRaw(key);
  const cached = snapshotCache.get(key);
  if (cached && cached.raw === raw) {
    return cached.value;
  }
  const value = parseStoredEntry(raw);
  snapshotCache.set(key, { raw, value });
  return value;
}

function getServerSnapshot(): StoredFeedbackEntry | null {
  return null;
}

function notifyKeyListeners(key: string): void {
  const listeners = keyListeners.get(key);
  if (!listeners) {
    return;
  }
  listeners.forEach((listener) => listener());
}

function subscribeKey(key: string | null, listener: () => void): () => void {
  if (!key || typeof window === 'undefined') {
    return () => {};
  }

  let listeners = keyListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    keyListeners.set(key, listeners);
  }
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (!isLocalStorageEvent(event)) {
      return;
    }
    if (event.key === null) {
      deleteMemoryOverlay(key);
      snapshotCache.delete(key);
      listener();
      return;
    }
    if (event.key === key) {
      const overlay = memoryOverlay.get(key);
      if (overlay) {
        const nextRaw = event.newValue ?? safeReadRaw(key);
        if (nextRaw !== overlay.baselineRaw) {
          deleteMemoryOverlay(key);
        }
      }
      snapshotCache.delete(key);
      listener();
    }
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners?.delete(listener);
    if (listeners && listeners.size === 0) {
      keyListeners.delete(key);
    }
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Allocates a monotonic write sequence number when a rating submission starts.
 * Does NOT advance the accepted-write watermark until `saveStoredRating` succeeds,
 * so a later failed submission never blocks an earlier accepted submission.
 */
export function beginRatingWrite(): number {
  nextRatingWriteSeq += 1;
  return nextRatingWriteSeq;
}

/**
 * Serializes overlapping `EP-F01` rating requests targeting the same
 * `(userScope, targetType, targetId)` in client submission order so a newer
 * request waits for the prior in-flight POST to settle before sending, ensuring
 * server state and local persisted feedback always converge on the final submission.
 */
export function enqueueSerializedRatingWrite<T>(
  accessToken: string,
  targetType: RatingTarget,
  targetId: string,
  task: () => Promise<T>,
): Promise<T> {
  const key = buildFeedbackStorageKey(
    accessToken,
    targetType,
    targetId,
    'rating',
  );
  if (!key) {
    return task();
  }
  const previous = ratingSubmissionChains.get(key);
  const resultPromise = previous ? previous.then(() => task()) : task();
  const tail = resultPromise.then(
    () => undefined,
    () => undefined,
  );
  ratingSubmissionChains.set(key, tail);
  tail.finally(() => {
    if (ratingSubmissionChains.get(key) === tail) {
      ratingSubmissionChains.delete(key);
    }
  });
  return resultPromise;
}

export function saveStoredRating(
  accessToken: string,
  targetType: RatingTarget,
  targetId: string,
  rating: StoredRatingFeedback,
  writeSeq?: number,
): SaveStoredRatingResult {
  const key = buildFeedbackStorageKey(
    accessToken,
    targetType,
    targetId,
    'rating',
  );
  if (!key) {
    return { status: 'saved' };
  }
  if (writeSeq !== undefined) {
    const latestSeq = latestAcceptedRatingWriteSeq.get(key) ?? 0;
    if (writeSeq < latestSeq) {
      return { status: 'superseded' };
    }
    latestAcceptedRatingWriteSeq.set(key, writeSeq);
  }
  const trimmedComment = rating.comment?.trim();
  const nextEntry: StoredFeedbackEntry = {
    rating: {
      score: rating.score,
      ...(trimmedComment ? { comment: trimmedComment } : {}),
    },
  };
  const raw = JSON.stringify(nextEntry);
  if (safeWriteRaw(key, raw)) {
    deleteMemoryOverlay(key);
    snapshotCache.set(key, { raw, value: nextEntry });
  } else {
    setMemoryOverlay(key, nextEntry);
    snapshotCache.delete(key);
  }
  notifyKeyListeners(key);
  return { status: 'saved' };
}

export function saveStoredReport(
  accessToken: string,
  targetType: ReportTarget,
  targetId: string,
  report: { reason?: ReportReason; comment?: string },
): void {
  const trimmedComment = report.comment?.trim();
  const hasDetails =
    report.reason !== undefined ||
    (trimmedComment !== undefined && trimmedComment.length > 0);

  // Store duplicate-only reconciliation markers under a separate key so a 409
  // reconciliation in one tab can NEVER overwrite accepted reason/comment details
  // written concurrently by another tab.
  if (!hasDetails) {
    const markerKey = buildFeedbackStorageKey(
      accessToken,
      targetType,
      targetId,
      'report_marker',
    );
    if (!markerKey) {
      return;
    }
    const markerEntry: StoredFeedbackEntry = {
      report: { reported: true },
    };
    const rawMarker = JSON.stringify(markerEntry);
    if (safeWriteRaw(markerKey, rawMarker)) {
      deleteMemoryOverlay(markerKey);
      snapshotCache.set(markerKey, { raw: rawMarker, value: markerEntry });
    } else {
      setMemoryOverlay(markerKey, markerEntry);
      snapshotCache.delete(markerKey);
    }
    notifyKeyListeners(markerKey);
    return;
  }

  const key = buildFeedbackStorageKey(
    accessToken,
    targetType,
    targetId,
    'report',
  );
  if (!key) {
    return;
  }
  const existing = readFeedbackSnapshot(key);
  const existingReport = existing?.report;
  const resolvedReason = report.reason ?? existingReport?.reason;
  const resolvedComment =
    report.comment !== undefined
      ? trimmedComment || undefined
      : existingReport?.comment;

  const nextEntry: StoredFeedbackEntry = {
    report: {
      reported: true,
      ...(resolvedReason ? { reason: resolvedReason } : {}),
      ...(resolvedComment ? { comment: resolvedComment } : {}),
    },
  };
  const raw = JSON.stringify(nextEntry);
  if (safeWriteRaw(key, raw)) {
    deleteMemoryOverlay(key);
    snapshotCache.set(key, { raw, value: nextEntry });
  } else {
    setMemoryOverlay(key, nextEntry);
    snapshotCache.delete(key);
  }
  notifyKeyListeners(key);
}

/**
 * SSR-safe React 19 `useSyncExternalStore` hook returning persisted client-side
 * feedback state for `(kind, userScope, target.type, target.id)`. Ratings, accepted
 * report details, and duplicate-report markers live under separate storage keys so
 * concurrent cross-tab writes cannot overwrite one another.
 */
export function useStoredFeedback(
  accessToken: string,
  target: FeedbackStorageTarget | undefined,
  kind: FeedbackStorageKind = 'rating',
): StoredFeedbackEntry | null {
  const key =
    target && target.id.trim().length > 0
      ? buildFeedbackStorageKey(accessToken, target.type, target.id, kind)
      : null;
  const reportMarkerKey =
    kind === 'report' && target && target.id.trim().length > 0
      ? buildFeedbackStorageKey(
          accessToken,
          target.type,
          target.id,
          'report_marker',
        )
      : null;

  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubPrimary = subscribeKey(key, listener);
      if (!reportMarkerKey) {
        return unsubPrimary;
      }
      const unsubMarker = subscribeKey(reportMarkerKey, listener);
      return () => {
        unsubPrimary();
        unsubMarker();
      };
    },
    [key, reportMarkerKey],
  );
  const getSnapshot = useCallback(() => {
    const primary = readFeedbackSnapshot(key);
    if (primary || !reportMarkerKey) {
      return primary;
    }
    return readFeedbackSnapshot(reportMarkerKey);
  }, [key, reportMarkerKey]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

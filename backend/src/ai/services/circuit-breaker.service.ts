import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** Injection token for overriding clock in unit tests. */
export const CIRCUIT_BREAKER_CLOCK = Symbol('CIRCUIT_BREAKER_CLOCK');

/** Result returned when requesting admission for a provider invocation attempt. */
export interface CircuitAttemptAdmission {
  allowed: boolean;
  /** Non-null reservation token only when admitted as the single `HALF_OPEN` canary probe. */
  canaryToken: string | null;
}

interface BreakerEntry {
  state: CircuitState;
  failureTimestamps: number[];
  openedAtMs: number | null;
  canaryInFlight: boolean;
  canaryToken: string | null;
}

/**
 * Per-model circuit breaker (`AI-System-Design.md` §14.2):
 * - `CLOSED`: 5 consecutive 5xx/timeout failures within 60s -> `OPEN`
 * - `OPEN`: 60s quarantine -> routes traffic to next `fallback_rank`
 * - `HALF_OPEN`: allows 1 canary probe -> success closes, failure re-opens for 60s
 */
@Injectable()
export class CircuitBreakerService {
  static readonly FAILURE_THRESHOLD = 5;
  static readonly FAILURE_WINDOW_MS = 60_000;
  static readonly QUARANTINE_MS = 60_000;

  private readonly entries = new Map<string, BreakerEntry>();
  private readonly nowFn: () => number;

  constructor(@Optional() @Inject(CIRCUIT_BREAKER_CLOCK) nowFn?: () => number) {
    this.nowFn = nowFn ?? (() => Date.now());
  }

  private getOrCreate(modelId: string): BreakerEntry {
    let entry = this.entries.get(modelId);
    if (!entry) {
      entry = {
        state: 'CLOSED',
        failureTimestamps: [],
        openedAtMs: null,
        canaryInFlight: false,
        canaryToken: null,
      };
      this.entries.set(modelId, entry);
    }
    return entry;
  }

  private syncState(entry: BreakerEntry, now: number): void {
    if (
      entry.state === 'OPEN' &&
      entry.openedAtMs !== null &&
      now - entry.openedAtMs >= CircuitBreakerService.QUARANTINE_MS
    ) {
      entry.state = 'HALF_OPEN';
      entry.canaryInFlight = false;
      entry.canaryToken = null;
    }
  }

  /** Returns the current state for `modelId` after evaluating quarantine expiry. */
  getState(modelId: string): CircuitState {
    const entry = this.getOrCreate(modelId);
    this.syncState(entry, this.nowFn());
    return entry.state;
  }

  /**
   * Read-only availability check for candidate routing without consuming a `HALF_OPEN` canary slot.
   */
  isAvailable(modelId: string): boolean {
    const entry = this.getOrCreate(modelId);
    this.syncState(entry, this.nowFn());
    if (entry.state === 'CLOSED') {
      return true;
    }
    if (entry.state === 'OPEN') {
      return false;
    }
    return !entry.canaryInFlight;
  }

  /**
   * Requests admission for one attempt against `modelId`.
   * Returns a unique `canaryToken` when admitted as the single `HALF_OPEN` canary probe,
   * or `canaryToken: null` when admitted in `CLOSED` state.
   */
  acquireAttempt(modelId: string): CircuitAttemptAdmission {
    const entry = this.getOrCreate(modelId);
    const now = this.nowFn();
    this.syncState(entry, now);

    if (entry.state === 'CLOSED') {
      return { allowed: true, canaryToken: null };
    }
    if (entry.state === 'OPEN') {
      return { allowed: false, canaryToken: null };
    }
    if (entry.canaryInFlight) {
      return { allowed: false, canaryToken: null };
    }
    const token = randomUUID();
    entry.canaryInFlight = true;
    entry.canaryToken = token;
    return { allowed: true, canaryToken: token };
  }

  /**
   * Compatibility wrapper returning whether `modelId` may be attempted right now.
   * Prefer `acquireAttempt()` when releasing a `HALF_OPEN` canary slot on abort/rate-limit.
   */
  canAttempt(modelId: string): boolean {
    return this.acquireAttempt(modelId).allowed;
  }

  /**
   * Releases a reserved `HALF_OPEN` canary slot ONLY when `canaryToken` matches
   * the active reservation token (`canaryToken !== null && entry.canaryToken === canaryToken`).
   */
  releaseCanary(modelId: string, canaryToken: string | null): void {
    if (canaryToken === null) {
      return;
    }
    const entry = this.entries.get(modelId);
    if (
      entry &&
      entry.state === 'HALF_OPEN' &&
      entry.canaryInFlight &&
      entry.canaryToken === canaryToken
    ) {
      entry.canaryInFlight = false;
      entry.canaryToken = null;
    }
  }

  /**
   * Resets the circuit to `CLOSED` after a healthy invocation or matching `HALF_OPEN` canary probe.
   * When `canaryToken` is explicitly supplied by a caller admitted while `CLOSED` (`null`) or holding
   * a stale token, it never overrides an active `HALF_OPEN` probe owned by another caller.
   */
  recordSuccess(modelId: string, canaryToken?: string | null): void {
    const entry = this.getOrCreate(modelId);
    this.syncState(entry, this.nowFn());

    if (entry.state === 'OPEN' && canaryToken !== undefined) {
      return;
    }

    if (
      entry.state === 'HALF_OPEN' &&
      canaryToken !== undefined &&
      (canaryToken === null || entry.canaryToken !== canaryToken)
    ) {
      return;
    }

    entry.state = 'CLOSED';
    entry.failureTimestamps = [];
    entry.openedAtMs = null;
    entry.canaryInFlight = false;
    entry.canaryToken = null;
  }

  /**
   * Records a 5xx/timeout failure and transitions `CLOSED -> OPEN` or `HALF_OPEN -> OPEN`.
   * A late failure from a non-owning request (`canaryToken !== entry.canaryToken`) does not
   * clobber an active `HALF_OPEN` canary reservation.
   */
  recordFailure(modelId: string, canaryToken?: string | null): CircuitState {
    const entry = this.getOrCreate(modelId);
    const now = this.nowFn();
    this.syncState(entry, now);

    if (entry.state === 'HALF_OPEN') {
      if (
        canaryToken !== undefined &&
        (canaryToken === null || entry.canaryToken !== canaryToken)
      ) {
        return entry.state;
      }
      entry.state = 'OPEN';
      entry.openedAtMs = now;
      entry.failureTimestamps = [];
      entry.canaryInFlight = false;
      entry.canaryToken = null;
      return entry.state;
    }

    if (entry.state === 'OPEN') {
      entry.openedAtMs = now;
      entry.canaryInFlight = false;
      entry.canaryToken = null;
      return entry.state;
    }

    const cutoff = now - CircuitBreakerService.FAILURE_WINDOW_MS;
    entry.failureTimestamps = entry.failureTimestamps.filter(
      (ts) => ts >= cutoff,
    );
    entry.failureTimestamps.push(now);

    if (
      entry.failureTimestamps.length >= CircuitBreakerService.FAILURE_THRESHOLD
    ) {
      entry.state = 'OPEN';
      entry.openedAtMs = now;
      entry.failureTimestamps = [];
      entry.canaryInFlight = false;
      entry.canaryToken = null;
    }
    return entry.state;
  }

  reset(modelId?: string): void {
    if (modelId) {
      this.entries.delete(modelId);
      return;
    }
    this.entries.clear();
  }
}

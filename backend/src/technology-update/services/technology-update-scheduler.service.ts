import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type QueryRunner } from 'typeorm';
import type { TechnologyUpdateOutput, UiLanguage } from '../../ai/ai.types.js';
import { AiGatewayService } from '../../ai/services/ai-gateway.service.js';
import {
  readAiGatewayConfiguration,
  readTechnologyUpdateConfiguration,
  type AiExecutionModeConfig,
} from '../../config.js';
import type {
  ActionTiming,
  ReleaseStatus,
  RelevanceLevel,
  UpdateState,
} from '../dto/technology-update.dto.js';
import {
  computeTechnologyUpdateContentHash,
  TechnologySourceFetchError,
  TechnologyUpdateSourceService,
  type ActiveTechnologySourceRecord,
  type ExternalUpdateCandidate,
  type TechnologyUpdateLearnerContext,
} from './technology-update-source.service.js';

const TECH_UPDATE_SCHEMA_ID = 'technology_update.v1';
const TECH_UPDATE_MAX_INPUT_UNITS = 6_000;
const TECH_UPDATE_MAX_OUTPUT_UNITS = 1_500;
const DEFAULT_HOURLY_CHECK_INTERVAL_MS = 3_600_000;

export interface EligibleCandidateRow {
  user_id: string;
  timezone: string;
  user_local_date: string;
}

export type CandidateProcessStatus =
  | 'committed_available'
  | 'committed_no_important_changes'
  | 'committed_temporarily_unavailable'
  | 'skipped_locked'
  | 'skipped_recheck'
  | 'discarded_drift_or_session_loss';

export interface CandidateProcessResult {
  userId: string;
  localDate: string;
  status: CandidateProcessStatus;
  updateState?: UpdateState;
  updateId?: string | null;
}

export interface TechnologyUpdateSweepSummary {
  candidatesFound: number;
  processed: number;
  committedAvailable: number;
  committedNoImportantChanges: number;
  committedTemporarilyUnavailable: number;
  skippedLocked: number;
  skippedRecheck: number;
  discardedDriftOrSessionLoss: number;
  maxObservedPinnedConnections: number;
  results: CandidateProcessResult[];
}

interface AdvisoryLockRow {
  locked: boolean;
}

interface CandidateRecheckRow {
  status: string;
  active_within_window: boolean;
  has_access: boolean;
  current_timezone: string;
  current_local_date: string;
  outcome_exists: boolean;
  lock_still_held?: boolean;
}

interface FocusRoadmapContextRow {
  id: string;
  target_level: string;
  role_name: string;
}

interface RoadmapTopicRow {
  title: string;
}

interface UserSkillRow {
  canonical_name: string;
}

interface UserPreferenceRow {
  preferred_ui_language: UiLanguage | null;
}

interface DeliveredHashRow {
  update_id: string;
  content_hash: string | null;
}

interface UpsertedUpdateRow {
  id: string;
}

type DesiredDeliveryOutcome =
  | {
      kind: 'temporarily_unavailable';
    }
  | {
      kind: 'no_important_changes';
    }
  | {
      kind: 'available';
      sourceId: string | null;
      technologyId: string | null;
      title: string;
      whatChanged: string;
      whyItMatters: string;
      publisher: string;
      sourceUrl: string;
      fetchedAt: string;
      publishedAt: string | null;
      releaseStatus: ReleaseStatus;
      relevance: RelevanceLevel;
      actionTiming: ActionTiming;
      roadmapRelation: string | null;
      focusRoadmapId: string | null;
      contentHash: string;
      aiGenerationId: string | null;
    };

/**
 * Unwraps TypeORM PostgreSQL `INSERT/UPDATE ... RETURNING` tuple `[rows, rowCount]` into a plain row array.
 */
function extractReturningRows<T>(raw: unknown): T[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  if (
    raw.length === 2 &&
    Array.isArray(raw[0]) &&
    (typeof raw[1] === 'number' || raw[1] === null || raw[1] === undefined)
  ) {
    return raw[0] as T[];
  }
  return raw as T[];
}

async function queryRunnerRows<T>(
  qr: QueryRunner,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const raw = await qr.query(sql, params as any[]);
  return Array.isArray(raw) ? (raw as T[]) : [];
}

/**
 * Hourly timezone-aware background scheduler and worker implementing `C05` / `C06` / `C08` §7.5
 * and the Accepted `R25` implementation contract:
 *
 * - Dedicated direct/session `QueryRunner` per worker slot (never transaction-pooled).
 * - Defaults: `60s` external deadline, concurrency `2`, max `2` pinned scheduler connections per instance.
 * - Acquires session advisory lock `pg_try_advisory_lock(hashtext(userId), hashtext(capturedLocalDate))`.
 * - Rechecks account status, feature access, 7-day meaningful activity, profile timezone, and existing
 *   delivery outcome after acquiring the lock.
 * - Keeps the connection pinned and lock held through external source fetch + AI synthesis
 *   (with zero open DB transaction during external/LLM calls).
 * - Never inserts placeholder `no_important_changes` or `temporarily_unavailable` rows to reserve work.
 * - Rechecks session liveness, advisory lock ownership, account/feature/activity eligibility, and
 *   captured `timezone`/`local_date` before committing; discards result on session loss or date/timezone drift.
 * - Releases advisory lock and `QueryRunner` in `finally`.
 */
@Injectable()
export class TechnologyUpdateSchedulerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TechnologyUpdateSchedulerService.name);
  readonly schedulerEnabled: boolean;
  readonly concurrency: number;
  readonly externalTimeoutMs: number;
  readonly executionMode: AiExecutionModeConfig;

  private timer: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown = false;
  private activeSweepPromise: Promise<TechnologyUpdateSweepSummary> | null =
    null;
  private activePinnedConnections = 0;
  private maxObservedPinnedConnections = 0;

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(AiGatewayService) private readonly aiGateway: AiGatewayService,
    @Inject(TechnologyUpdateSourceService)
    private readonly sourceService: TechnologyUpdateSourceService,
    @Optional()
    @Inject(ConfigService)
    configService?: ConfigService,
  ) {
    const techCfg = readTechnologyUpdateConfiguration(configService ?? {});
    const aiCfg = readAiGatewayConfiguration(configService ?? {});
    this.schedulerEnabled = techCfg.schedulerEnabled;
    this.concurrency = techCfg.concurrency;
    this.externalTimeoutMs = techCfg.externalTimeoutMs;
    this.executionMode = aiCfg.executionMode;
  }

  onApplicationBootstrap(): void {
    if (!this.schedulerEnabled) {
      return;
    }
    this.startTimer();
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    this.stopTimer();
    if (this.activeSweepPromise) {
      try {
        await this.activeSweepPromise;
      } catch {
        // Ignore sweep error during shutdown.
      }
    }
  }

  getActivePinnedConnections(): number {
    return this.activePinnedConnections;
  }

  getMaxObservedPinnedConnections(): number {
    return this.maxObservedPinnedConnections;
  }

  private startTimer(): void {
    if (this.timer || this.isShuttingDown) {
      return;
    }
    this.timer = setInterval(() => {
      if (this.isShuttingDown || this.activeSweepPromise) {
        return;
      }
      void this.runSweep().catch((err) => {
        this.logger.warn(
          `Hourly technology update sweep failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, DEFAULT_HOURLY_CHECK_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Queries eligible users per `C08` §7.5 & `PRD` §39:
   * - `u.status = 'active'`
   * - `u.last_active_at >= clock_timestamp() - make_interval(days => active_window_days)`
   * - `private.effective_feature_access(u.id, 'technology_update')`
   * - Local hour `>= 6` in `COALESCE(up.timezone, 'Asia/Dhaka')`
   * - No `update_delivery_history` row for `(u.id, user_local_date)`
   */
  async findEligibleCandidates(): Promise<EligibleCandidateRow[]> {
    return this.dataSource.query<EligibleCandidateRow[]>(
      `SELECT
         u.id AS user_id,
         COALESCE(up.timezone, 'Asia/Dhaka') AS timezone,
         to_char((clock_timestamp() AT TIME ZONE COALESCE(up.timezone, 'Asia/Dhaka'))::date, 'YYYY-MM-DD') AS user_local_date
       FROM public.users u
       LEFT JOIN public.user_profiles up ON up.user_id = u.id
       WHERE u.status = 'active'::public.user_status
         AND u.last_active_at >= clock_timestamp() - make_interval(days => GREATEST(1, COALESCE(
           (SELECT (config_value #>> '{}')::int
              FROM public.system_configurations
             WHERE config_key = 'technology_update.active_window_days'),
           7
         )))
         AND private.effective_feature_access(u.id, 'technology_update'::public.feature_key)
         AND EXTRACT(HOUR FROM (clock_timestamp() AT TIME ZONE COALESCE(up.timezone, 'Asia/Dhaka'))) >= 6
         AND NOT EXISTS (
           SELECT 1
             FROM public.update_delivery_history d
            WHERE d.user_id = u.id
              AND d.local_date = (clock_timestamp() AT TIME ZONE COALESCE(up.timezone, 'Asia/Dhaka'))::date
         )
       ORDER BY u.last_active_at DESC, u.id ASC`,
    );
  }

  /**
   * Runs one bounded hourly scheduler sweep across eligible users with concurrency `<= 2`
   * and max `2` pinned DB session connections (`R25`).
   */
  async runSweep(): Promise<TechnologyUpdateSweepSummary> {
    if (this.activeSweepPromise) {
      return this.activeSweepPromise;
    }
    const sweepPromise = this.executeSweepInternal();
    this.activeSweepPromise = sweepPromise;
    try {
      return await sweepPromise;
    } finally {
      if (this.activeSweepPromise === sweepPromise) {
        this.activeSweepPromise = null;
      }
    }
  }

  private async executeSweepInternal(): Promise<TechnologyUpdateSweepSummary> {
    const candidates = await this.findEligibleCandidates();
    const results: CandidateProcessResult[] = new Array(candidates.length);
    const workerCount = Math.min(this.concurrency, candidates.length);
    let nextIdx = 0;

    const workers = Array.from({ length: workerCount }, async () => {
      while (!this.isShuttingDown) {
        const idx = nextIdx;
        nextIdx += 1;
        if (idx >= candidates.length) {
          break;
        }
        results[idx] = await this.processCandidate(candidates[idx]);
      }
    });

    await Promise.all(workers);

    const finalizedResults = results.filter(
      (r): r is CandidateProcessResult => r !== undefined,
    );

    const summary: TechnologyUpdateSweepSummary = {
      candidatesFound: candidates.length,
      processed: finalizedResults.length,
      committedAvailable: 0,
      committedNoImportantChanges: 0,
      committedTemporarilyUnavailable: 0,
      skippedLocked: 0,
      skippedRecheck: 0,
      discardedDriftOrSessionLoss: 0,
      maxObservedPinnedConnections: this.maxObservedPinnedConnections,
      results: finalizedResults,
    };

    for (const res of finalizedResults) {
      switch (res.status) {
        case 'committed_available':
          summary.committedAvailable += 1;
          break;
        case 'committed_no_important_changes':
          summary.committedNoImportantChanges += 1;
          break;
        case 'committed_temporarily_unavailable':
          summary.committedTemporarilyUnavailable += 1;
          break;
        case 'skipped_locked':
          summary.skippedLocked += 1;
          break;
        case 'skipped_recheck':
          summary.skippedRecheck += 1;
          break;
        case 'discarded_drift_or_session_loss':
          summary.discardedDriftOrSessionLoss += 1;
          break;
      }
    }

    return summary;
  }

  /**
   * Executes the `R25` pinned-session advisory lock lifecycle for a single `(user_id, user_local_date)` candidate.
   */
  async processCandidate(
    candidate: EligibleCandidateRow,
  ): Promise<CandidateProcessResult> {
    const userId = candidate.user_id.trim().toLowerCase();
    const capturedTimezone = candidate.timezone.trim() || 'Asia/Dhaka';
    const capturedLocalDate = candidate.user_local_date.trim();

    const qr = this.dataSource.createQueryRunner();
    let connected = false;
    let lockAcquired = false;
    let sessionLost = false;

    try {
      await qr.connect();
      connected = true;
      this.activePinnedConnections += 1;
      if (this.activePinnedConnections > this.maxObservedPinnedConnections) {
        this.maxObservedPinnedConnections = this.activePinnedConnections;
      }

      // Step 1: Acquire session-level advisory lock keyed by (userId, capturedLocalDate) on pinned connection
      const [lockRow] = await queryRunnerRows<AdvisoryLockRow>(
        qr,
        `SELECT pg_try_advisory_lock(hashtext($1::text), hashtext($2::text)) AS locked`,
        [userId, capturedLocalDate],
      );
      if (!lockRow?.locked) {
        return {
          userId,
          localDate: capturedLocalDate,
          status: 'skipped_locked',
        };
      }
      lockAcquired = true;

      // Step 2: Post-lock recheck of account, feature, 7-day activity, timezone, local_date, and existing outcome
      const postLockEligible = await this.verifySessionEligibilityAndDrift(
        qr,
        userId,
        capturedTimezone,
        capturedLocalDate,
        false,
      );
      if (!postLockEligible) {
        return {
          userId,
          localDate: capturedLocalDate,
          status: 'skipped_recheck',
        };
      }

      // Step 3: Load learner context on the pinned session (NO open transaction during external work)
      const learnerContext = await this.loadLearnerContextOnPinnedSession(
        qr,
        userId,
        capturedTimezone,
        capturedLocalDate,
      );

      // Step 4: Bounded external source fetch + AI synthesis while keeping connection pinned (zero open DB tx)
      const desiredOutcome =
        await this.computeDeliveryOutcomeOutsideTx(learnerContext);

      // Step 5: Pre-commit session ownership & timezone/local_date drift recheck on the same still-owned session
      let preCommitValid = false;
      try {
        preCommitValid = await this.verifySessionEligibilityAndDrift(
          qr,
          userId,
          capturedTimezone,
          capturedLocalDate,
          true,
        );
      } catch {
        sessionLost = true;
        preCommitValid = false;
      }

      if (!preCommitValid || sessionLost) {
        return {
          userId,
          localDate: capturedLocalDate,
          status: 'discarded_drift_or_session_loss',
        };
      }

      // Step 6: Atomic commit on the pinned session
      return await this.commitOutcomeOnPinnedSession(
        qr,
        userId,
        capturedTimezone,
        capturedLocalDate,
        desiredOutcome,
        learnerContext.deliveredContentHashes,
      );
    } catch (error) {
      this.logger.warn(
        `Candidate technology update attempt aborted for user ${userId} on ${capturedLocalDate}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        userId,
        localDate: capturedLocalDate,
        status: 'discarded_drift_or_session_loss',
      };
    } finally {
      if (lockAcquired) {
        try {
          await qr.query(
            `SELECT pg_advisory_unlock(hashtext($1::text), hashtext($2::text))`,
            [userId, capturedLocalDate],
          );
        } catch {
          // Session dropped before unlock; PostgreSQL releases session locks automatically on disconnect.
        }
      }
      if (connected) {
        this.activePinnedConnections = Math.max(
          0,
          this.activePinnedConnections - 1,
        );
      }
      try {
        await qr.release();
      } catch {
        // Ignore release errors on broken socket.
      }
    }
  }

  private async verifySessionEligibilityAndDrift(
    qr: QueryRunner,
    userId: string,
    capturedTimezone: string,
    capturedLocalDate: string,
    requireLockOwnershipCheck: boolean,
  ): Promise<boolean> {
    const [row] = await queryRunnerRows<CandidateRecheckRow>(
      qr,
      `SELECT
         u.status,
         (u.last_active_at >= clock_timestamp() - make_interval(days => GREATEST(1, COALESCE(
           (SELECT (config_value #>> '{}')::int
              FROM public.system_configurations
             WHERE config_key = 'technology_update.active_window_days'),
           7
         )))) AS active_within_window,
         private.effective_feature_access(u.id, 'technology_update'::public.feature_key) AS has_access,
         COALESCE(up.timezone, 'Asia/Dhaka') AS current_timezone,
         to_char((clock_timestamp() AT TIME ZONE COALESCE(up.timezone, 'Asia/Dhaka'))::date, 'YYYY-MM-DD') AS current_local_date,
         EXISTS (
           SELECT 1
             FROM public.update_delivery_history d
            WHERE d.user_id = u.id
              AND d.local_date = $2::date
         ) AS outcome_exists,
         EXISTS (
           SELECT 1
             FROM pg_locks
            WHERE locktype = 'advisory'
              AND pid = pg_backend_pid()
              AND classid = hashtext($1::text)
              AND objid = hashtext($2::text)
              AND granted = true
         ) AS lock_still_held
       FROM public.users u
       LEFT JOIN public.user_profiles up ON up.user_id = u.id
       WHERE u.id = $1::uuid`,
      [userId, capturedLocalDate],
    );

    if (!row) {
      return false;
    }
    if (
      row.status !== 'active' ||
      !row.active_within_window ||
      !row.has_access ||
      row.outcome_exists
    ) {
      return false;
    }
    if (
      row.current_timezone !== capturedTimezone ||
      row.current_local_date !== capturedLocalDate
    ) {
      return false;
    }
    if (requireLockOwnershipCheck && row.lock_still_held === false) {
      return false;
    }
    return true;
  }

  private async loadLearnerContextOnPinnedSession(
    qr: QueryRunner,
    userId: string,
    capturedTimezone: string,
    capturedLocalDate: string,
  ): Promise<TechnologyUpdateLearnerContext> {
    const [focusRows, skillRows, prefRows, sourceRows, deliveredRows] =
      await Promise.all([
        queryRunnerRows<FocusRoadmapContextRow>(
          qr,
          `SELECT
             r.id,
             r.target_level,
             cr.name AS role_name
           FROM public.roadmaps r
           INNER JOIN public.career_roles cr ON cr.id = r.canonical_role_id
          WHERE r.user_id = $1::uuid
            AND r.status = 'locked'::public.roadmap_status
            AND r.is_focus = true
          LIMIT 1`,
          [userId],
        ),
        queryRunnerRows<UserSkillRow>(
          qr,
          `SELECT s.canonical_name
             FROM public.skill_progress sp
             INNER JOIN public.skills s ON s.id = sp.skill_id
            WHERE sp.user_id = $1::uuid
            ORDER BY sp.updated_at DESC
            LIMIT 25`,
          [userId],
        ),
        queryRunnerRows<UserPreferenceRow>(
          qr,
          `SELECT preferred_ui_language
             FROM public.user_preferences
            WHERE user_id = $1::uuid
            LIMIT 1`,
          [userId],
        ),
        queryRunnerRows<ActiveTechnologySourceRecord>(
          qr,
          `SELECT
             id,
             name,
             publisher,
             base_url,
             source_type,
             trust_tier
           FROM public.technology_sources
          WHERE is_active = true
          ORDER BY trust_tier ASC, name ASC
          LIMIT 20`,
        ),
        queryRunnerRows<DeliveredHashRow>(
          qr,
          `SELECT
             d.update_id,
             tu.content_hash
           FROM public.update_delivery_history d
           INNER JOIN public.technology_updates tu ON tu.id = d.update_id
          WHERE d.user_id = $1::uuid
            AND d.update_id IS NOT NULL`,
          [userId],
        ),
      ]);

    const focusRow = focusRows[0] ?? null;
    let activeTopics: string[] = [];
    if (focusRow) {
      const topicRows = await queryRunnerRows<RoadmapTopicRow>(
        qr,
        `SELECT t.title
           FROM public.roadmaps r
           INNER JOIN public.roadmap_versions rv
             ON rv.roadmap_id = r.id
            AND rv.version_no = r.current_version_no
           INNER JOIN public.roadmap_items ri
             ON ri.roadmap_version_id = rv.id
            AND ri.is_retired = false
           INNER JOIN public.topics t ON t.id = ri.topic_id
          WHERE r.id = $1::uuid
            AND r.user_id = $2::uuid
          ORDER BY ri.phase_no ASC, ri.display_order ASC
          LIMIT 15`,
        [focusRow.id, userId],
      );
      activeTopics = topicRows.map((t) => t.title);
    }

    const deliveredContentHashes = new Set<string>();
    for (const row of deliveredRows) {
      if (typeof row.content_hash === 'string' && row.content_hash.trim()) {
        deliveredContentHashes.add(row.content_hash.trim());
      }
    }

    const prefLanguage = prefRows[0]?.preferred_ui_language;
    const language: UiLanguage =
      prefLanguage === 'bn' || prefLanguage === 'en' || prefLanguage === 'mixed'
        ? prefLanguage
        : 'en';

    return {
      userId,
      localDate: capturedLocalDate,
      timezone: capturedTimezone,
      language,
      focusRoadmap: focusRow
        ? {
            id: focusRow.id,
            roleName: focusRow.role_name,
            targetLevel: focusRow.target_level,
            activeTopics,
          }
        : null,
      skills: skillRows.map((s) => s.canonical_name),
      sources: sourceRows,
      deliveredContentHashes,
    };
  }

  private async computeDeliveryOutcomeOutsideTx(
    context: TechnologyUpdateLearnerContext,
  ): Promise<DesiredDeliveryOutcome> {
    const deadlineMs = Date.now() + this.externalTimeoutMs;
    const deadlineController = new AbortController();
    let onDeadlineAbort: (() => void) | null = null;
    const deadlineAbortPromise = new Promise<never>((_resolve, reject) => {
      onDeadlineAbort = () => {
        reject(new Error('TECH_UPDATE_EXTERNAL_DEADLINE_EXCEEDED'));
      };
      if (deadlineController.signal.aborted) {
        onDeadlineAbort();
        return;
      }
      deadlineController.signal.addEventListener('abort', onDeadlineAbort, {
        once: true,
      });
    });
    const deadlineTimer = setTimeout(() => {
      deadlineController.abort();
    }, this.externalTimeoutMs);

    try {
      let candidates: ExternalUpdateCandidate[];
      try {
        const fetchBudgetMs = deadlineMs - Date.now();
        if (fetchBudgetMs <= 0) {
          return { kind: 'temporarily_unavailable' };
        }
        candidates = await Promise.race([
          this.sourceService.fetchFreshCandidates(context, {
            timeoutMs: fetchBudgetMs,
            signal: deadlineController.signal,
          }),
          deadlineAbortPromise,
        ]);
      } catch (error) {
        if (error instanceof TechnologySourceFetchError) {
          return { kind: 'temporarily_unavailable' };
        }
        return { kind: 'temporarily_unavailable' };
      }

      // PRD §45: Filter out any candidate whose content_hash was already delivered to this user
      const undeliveredCandidates = candidates.filter(
        (c) => !context.deliveredContentHashes.has(c.contentHash),
      );

      if (undeliveredCandidates.length === 0) {
        return { kind: 'no_important_changes' };
      }

      for (let i = 0; i < undeliveredCandidates.length; i += 1) {
        const candidate = undeliveredCandidates[i];
        const remainingTimeoutMs = deadlineMs - Date.now();
        if (remainingTimeoutMs <= 0 || deadlineController.signal.aborted) {
          return { kind: 'temporarily_unavailable' };
        }

        try {
          const aiResponse = await Promise.race([
            this.aiGateway.execute<TechnologyUpdateOutput>(
              {
                task: 'technology_update',
                user_id: context.userId,
                language: context.language,
                context: {
                  local_date: context.localDate,
                  focus_roadmap: context.focusRoadmap
                    ? {
                        role_name: context.focusRoadmap.roleName,
                        target_level: context.focusRoadmap.targetLevel,
                        active_topics: context.focusRoadmap.activeTopics,
                      }
                    : null,
                  skills: context.skills,
                  candidate_source: {
                    publisher: candidate.publisher,
                    source_url: candidate.sourceUrl,
                    fetched_at: candidate.fetchedAt,
                    release_status: candidate.releaseStatus,
                  },
                },
                untrusted_inputs: [
                  `SOURCE_TITLE: ${candidate.title}\nSOURCE_SUMMARY: ${candidate.summary}\nSOURCE_PUBLISHER: ${candidate.publisher}\nSOURCE_URL: ${candidate.sourceUrl}`,
                ],
                output_schema: TECH_UPDATE_SCHEMA_ID,
                budget: {
                  max_input_units: TECH_UPDATE_MAX_INPUT_UNITS,
                  max_output_units: TECH_UPDATE_MAX_OUTPUT_UNITS,
                  timeout_ms: Math.min(remainingTimeoutMs, 60_000),
                },
                idempotency_key: `tech-update:${context.userId}:${context.localDate}:${candidate.contentHash}`,
                mode: this.executionMode,
              },
              {
                persistTelemetry: true,
                signal: deadlineController.signal,
              },
            ),
            deadlineAbortPromise,
          ]);

          if (Date.now() > deadlineMs || deadlineController.signal.aborted) {
            return { kind: 'temporarily_unavailable' };
          }

          const output = aiResponse.output;
          if (!output || !output.has_meaningful_update) {
            continue;
          }

          // PRD §41: Keep citation metadata (sourceUrl, publisher, contentHash) strictly tied to the fetched candidate
          const finalSourceUrl = candidate.sourceUrl;
          const finalPublisher = candidate.publisher;
          const finalTitle = output.title ?? candidate.title;
          const finalWhatChanged = output.what_changed ?? candidate.summary;
          const finalContentHash =
            candidate.contentHash ||
            computeTechnologyUpdateContentHash({
              sourceUrl: finalSourceUrl,
              title: finalTitle,
              summary: finalWhatChanged,
            });

          if (context.deliveredContentHashes.has(finalContentHash)) {
            continue;
          }

          return {
            kind: 'available',
            sourceId: candidate.sourceId,
            technologyId: candidate.technologyId,
            title: finalTitle,
            whatChanged: finalWhatChanged,
            whyItMatters: output.why_it_matters!,
            publisher: finalPublisher,
            sourceUrl: finalSourceUrl,
            fetchedAt: candidate.fetchedAt,
            publishedAt: candidate.publishedAt,
            releaseStatus: output.release_status ?? candidate.releaseStatus,
            relevance: output.relevance!,
            actionTiming: output.action_timing!,
            roadmapRelation: output.roadmap_relation ?? null,
            focusRoadmapId: context.focusRoadmap?.id ?? null,
            contentHash: finalContentHash,
            aiGenerationId: aiResponse.generation_id ?? null,
          };
        } catch {
          // PRD §46: AI failure preserves existing user data and records temporarily_unavailable without fabricating stale content
          return { kind: 'temporarily_unavailable' };
        }
      }

      return { kind: 'no_important_changes' };
    } finally {
      clearTimeout(deadlineTimer);
      if (onDeadlineAbort) {
        deadlineController.signal.removeEventListener('abort', onDeadlineAbort);
      }
    }
  }

  private async insertConditionalDeliveryHistory(
    qr: QueryRunner,
    userId: string,
    updateId: string | null,
    capturedTimezone: string,
    capturedLocalDate: string,
    state: UpdateState,
  ): Promise<boolean> {
    const rawInsert = await qr.query(
      `INSERT INTO public.update_delivery_history (
         user_id,
         update_id,
         local_date,
         state
       )
       SELECT
         u.id,
         $2::uuid,
         $3::date,
         $4::public.update_state
       FROM public.users u
       LEFT JOIN public.user_profiles up ON up.user_id = u.id
       WHERE u.id = $1::uuid
         AND u.status = 'active'::public.user_status
         AND u.last_active_at >= clock_timestamp() - make_interval(days => GREATEST(1, COALESCE(
           (SELECT (config_value #>> '{}')::int
              FROM public.system_configurations
             WHERE config_key = 'technology_update.active_window_days'),
           7
         )))
         AND private.effective_feature_access(u.id, 'technology_update'::public.feature_key)
         AND COALESCE(up.timezone, 'Asia/Dhaka') = $5::text
         AND to_char((clock_timestamp() AT TIME ZONE COALESCE(up.timezone, 'Asia/Dhaka'))::date, 'YYYY-MM-DD') = $3::text
       ON CONFLICT (user_id, local_date) DO NOTHING
       RETURNING id`,
      [userId, updateId, capturedLocalDate, state, capturedTimezone],
    );
    const insertedRows = extractReturningRows<{ id: string }>(rawInsert);
    return insertedRows.length > 0;
  }

  private async commitOutcomeOnPinnedSession(
    qr: QueryRunner,
    userId: string,
    capturedTimezone: string,
    capturedLocalDate: string,
    outcome: DesiredDeliveryOutcome,
    deliveredContentHashes: ReadonlySet<string>,
  ): Promise<CandidateProcessResult> {
    let txStarted = false;
    try {
      await qr.startTransaction('READ COMMITTED');
      txStarted = true;
      await qr.query('SET LOCAL ROLE service_role');

      if (outcome.kind === 'temporarily_unavailable') {
        const inserted = await this.insertConditionalDeliveryHistory(
          qr,
          userId,
          null,
          capturedTimezone,
          capturedLocalDate,
          'temporarily_unavailable',
        );
        if (!inserted) {
          await qr.rollbackTransaction();
          txStarted = false;
          return {
            userId,
            localDate: capturedLocalDate,
            status: 'discarded_drift_or_session_loss',
          };
        }
        await qr.commitTransaction();
        return {
          userId,
          localDate: capturedLocalDate,
          status: 'committed_temporarily_unavailable',
          updateState: 'temporarily_unavailable',
          updateId: null,
        };
      }

      if (
        outcome.kind === 'no_important_changes' ||
        deliveredContentHashes.has(outcome.contentHash)
      ) {
        const inserted = await this.insertConditionalDeliveryHistory(
          qr,
          userId,
          null,
          capturedTimezone,
          capturedLocalDate,
          'no_important_changes',
        );
        if (!inserted) {
          await qr.rollbackTransaction();
          txStarted = false;
          return {
            userId,
            localDate: capturedLocalDate,
            status: 'discarded_drift_or_session_loss',
          };
        }
        await qr.commitTransaction();
        return {
          userId,
          localDate: capturedLocalDate,
          status: 'committed_no_important_changes',
          updateState: 'no_important_changes',
          updateId: null,
        };
      }

      // outcome.kind === 'available'
      const rawUpsert = await qr.query(
        `INSERT INTO public.technology_updates (
           technology_id,
           source_id,
           title,
           what_changed,
           publisher,
           source_url,
           fetched_at,
           published_at,
           release_status,
           content_hash,
           ai_generation_id
         ) VALUES (
           $1::uuid,
           $2::uuid,
           $3,
           $4,
           $5,
           $6,
           $7::timestamptz,
           $8::timestamptz,
           $9::public.release_status,
           $10,
           $11::uuid
         )
         ON CONFLICT (content_hash) DO UPDATE
           SET fetched_at = GREATEST(public.technology_updates.fetched_at, EXCLUDED.fetched_at)
         RETURNING id`,
        [
          outcome.technologyId,
          outcome.sourceId,
          outcome.title,
          outcome.whatChanged,
          outcome.publisher,
          outcome.sourceUrl,
          outcome.fetchedAt,
          outcome.publishedAt,
          outcome.releaseStatus,
          outcome.contentHash,
          outcome.aiGenerationId,
        ],
      );
      const upsertedRows = extractReturningRows<UpsertedUpdateRow>(rawUpsert);
      const updateId = upsertedRows[0]?.id;
      if (!updateId) {
        throw new Error('Failed to upsert technology_updates row');
      }

      // Check uq_update_delivery_user_update in case the resolved updateId was already delivered on an earlier date
      const [alreadyDelivered] = await queryRunnerRows<{ exists: boolean }>(
        qr,
        `SELECT EXISTS (
           SELECT 1
             FROM public.update_delivery_history
            WHERE user_id = $1::uuid
              AND update_id = $2::uuid
         ) AS exists`,
        [userId, updateId],
      );

      if (alreadyDelivered?.exists) {
        const inserted = await this.insertConditionalDeliveryHistory(
          qr,
          userId,
          null,
          capturedTimezone,
          capturedLocalDate,
          'no_important_changes',
        );
        if (!inserted) {
          await qr.rollbackTransaction();
          txStarted = false;
          return {
            userId,
            localDate: capturedLocalDate,
            status: 'discarded_drift_or_session_loss',
          };
        }
        await qr.commitTransaction();
        return {
          userId,
          localDate: capturedLocalDate,
          status: 'committed_no_important_changes',
          updateState: 'no_important_changes',
          updateId: null,
        };
      }

      await qr.query(
        `INSERT INTO public.user_update_relevance (
           user_id,
           update_id,
           relevance,
           action_timing,
           why_it_matters,
           roadmap_relation,
           focus_roadmap_id
         ) VALUES (
           $1::uuid,
           $2::uuid,
           $3::public.relevance_level,
           $4::public.action_timing,
           $5,
           $6,
           $7::uuid
         )
         ON CONFLICT (user_id, update_id) DO UPDATE
           SET relevance = EXCLUDED.relevance,
               action_timing = EXCLUDED.action_timing,
               why_it_matters = EXCLUDED.why_it_matters,
               roadmap_relation = EXCLUDED.roadmap_relation,
               focus_roadmap_id = EXCLUDED.focus_roadmap_id,
               computed_at = clock_timestamp()`,
        [
          userId,
          updateId,
          outcome.relevance,
          outcome.actionTiming,
          outcome.whyItMatters,
          outcome.roadmapRelation,
          outcome.focusRoadmapId,
        ],
      );

      const inserted = await this.insertConditionalDeliveryHistory(
        qr,
        userId,
        updateId,
        capturedTimezone,
        capturedLocalDate,
        'available',
      );
      if (!inserted) {
        await qr.rollbackTransaction();
        txStarted = false;
        return {
          userId,
          localDate: capturedLocalDate,
          status: 'discarded_drift_or_session_loss',
        };
      }

      await qr.commitTransaction();
      return {
        userId,
        localDate: capturedLocalDate,
        status: 'committed_available',
        updateState: 'available',
        updateId,
      };
    } catch (error) {
      if (txStarted) {
        try {
          await qr.rollbackTransaction();
        } catch {
          // Ignore rollback failure on broken connection.
        }
      }
      throw error;
    }
  }
}

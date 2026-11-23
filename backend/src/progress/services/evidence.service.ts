import { Injectable } from '@nestjs/common';
import { fail } from '../../common/http.js';
import type { LearningState } from '../../learning/dto/learning.dto.js';
import type { CareerLevel } from '../../profile/profile.dto.js';
import type { TransactionalQueryExecutor } from '../../profile/profile.service.js';
import {
  CAREER_LEVEL_VALUES,
  EVIDENCE_SOURCE_VALUES,
  PERFORMANCE_LEVEL_VALUES,
  QUESTION_DIFFICULTY_VALUES,
  type EvidenceDTO,
  type EvidenceRecordResult,
  type EvidenceSource,
  type PerformanceLevel,
  type QuestionDifficulty,
} from '../dto/progress.dto.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const JOB_READY_FORBIDDEN_PATTERN =
  /\b(job[\s-]?ready|guarantee[ds]?\s+(a\s+)?job|100%\s+placement|you\s+will\s+get\s+a\s+job)\b/i;

interface StoredEvidenceRow {
  id: string;
  source_type: EvidenceSource;
  source_id: string;
  topic_id?: string | null;
  difficulty: QuestionDifficulty;
  score_summary: Record<string, unknown> | null;
  performance_level: PerformanceLevel | null;
  attempt_no: number | string;
  occurred_at: Date | string;
}

interface SkillProgressRow {
  id: string;
  learning_state: LearningState;
  state_reason: string | null;
  last_evidence_at: Date | string | null;
  evidence_count: number | string;
}

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Evaluates whether a single stored evidence record demonstrates strong competency.
 * Note (`PRD` §35): 75% is an internal heuristic only; a single strong score NEVER alone
 * grants `'proficient'`.
 */
export function isStrongEvidenceRecord(row: {
  source_type: EvidenceSource;
  score_summary: Record<string, unknown> | null;
  performance_level: PerformanceLevel | null;
}): boolean {
  const summary = row.score_summary ?? {};
  if (row.source_type === 'quiz_attempt') {
    const correct = Number(summary.mcq_correct);
    const total = Number(summary.mcq_total);
    if (Number.isFinite(correct) && Number.isFinite(total) && total > 0) {
      const ratio = correct / total;
      return ratio >= 0.75;
    }
  }
  if (row.performance_level === 'good') {
    return true;
  }
  if (row.performance_level === 'needs_work') {
    return false;
  }
  return false;
}

function stateRank(state: LearningState): number {
  switch (state) {
    case 'proficient':
      return 3;
    case 'practicing':
      return 2;
    case 'learning':
      return 1;
    case 'not_started':
    default:
      return 0;
  }
}

/**
 * Computes the next `learning_state` and an explainable, distinct `state_reason`
 * from chronological target-level evidence (`PRD` §18, §34–§36, `C05` §14.9).
 *
 * Invariants:
 * - Single quiz/review (even 90%–100%) NEVER transitions directly to `'proficient'`.
 * - `'proficient'` requires repeated (`>= 2`) and recent strong evidence at the target `career_level`.
 * - Retry (`attempt_no = 2`) improvement can lift state.
 * - Never emits `"Job Ready"` or employment guarantees.
 */
export function computeLevelScopedSkillState(
  previousState: LearningState,
  previousReason: string | null,
  evidenceRowsDesc: readonly StoredEvidenceRow[],
  latestSourceType: EvidenceSource,
  latestAttemptNo: number,
): { nextState: LearningState; reason: string } {
  const count = evidenceRowsDesc.length;
  if (count === 0) {
    return {
      nextState: previousState,
      reason: previousReason ?? 'No practice evidence recorded yet.',
    };
  }

  const latest = evidenceRowsDesc[0]!;
  const latestStrong = isStrongEvidenceRecord(latest);
  const latestRowAttemptNo = Number(latest.attempt_no ?? latestAttemptNo);
  const latestRowSourceType = latest.source_type ?? latestSourceType;
  const strongRows = evidenceRowsDesc.filter((r) => isStrongEvidenceRecord(r));
  const strongCount = strongRows.length;
  const recentWindow = evidenceRowsDesc.slice(0, 3);
  const recentStrongCount = recentWindow.filter((r) =>
    isStrongEvidenceRecord(r),
  ).length;
  const recentWeakCount = recentWindow
    .slice(0, 2)
    .filter((r) => !isStrongEvidenceRecord(r)).length;
  const hasRetryImprovement =
    latestRowAttemptNo === 2 &&
    latestStrong &&
    evidenceRowsDesc.some(
      (r) =>
        r.id !== latest.id &&
        Number(r.attempt_no) === 1 &&
        (!latest.topic_id || !r.topic_id || r.topic_id === latest.topic_id) &&
        !isStrongEvidenceRecord(r),
    );

  let targetState: LearningState;
  let baseReason: string;

  if (count === 1) {
    // PRD §35 / C05 §17.5: A single score (even >= 90%) NEVER alone flips a skill to Proficient.
    if (latestStrong) {
      targetState =
        stateRank(previousState) >= stateRank('practicing')
          ? previousState
          : 'practicing';
      baseReason =
        'Strong initial practice performance recorded; repeated practice is required to reach proficient mastery.';
    } else {
      targetState =
        stateRank(previousState) >= stateRank('learning')
          ? previousState
          : 'learning';
      baseReason =
        'Initial practice attempt completed; continuing foundational study and practice.';
    }
  } else if (
    count >= 2 &&
    strongCount >= 2 &&
    latestStrong &&
    recentStrongCount >= 2
  ) {
    targetState = 'proficient';
    baseReason = hasRetryImprovement
      ? `Consistent strong understanding demonstrated across ${count} practice records including retry improvement.`
      : `Consistent strong understanding demonstrated across ${strongCount} of ${count} practice records at this career level.`;
  } else if (previousState === 'proficient' && recentWeakCount >= 2) {
    targetState = 'practicing';
    baseReason = `Two recent practice records (${count} total) indicated concepts needing reinforcement.`;
  } else if (previousState === 'proficient') {
    targetState = 'proficient';
    baseReason = `Maintained strong understanding across ${count} practice records at this career level.`;
  } else {
    targetState = 'practicing';
    if (hasRetryImprovement) {
      baseReason = `Retry practice improved understanding across ${count} recorded evidence items.`;
    } else if (latestStrong) {
      baseReason = `Active practice progressing well (${strongCount} strong of ${count} total records); additional consistent evidence needed for proficient state.`;
    } else {
      baseReason = `Active practice recorded (${count} evidence items); reviewing feedback to strengthen weak areas.`;
    }
  }

  const sourceLabel =
    latestRowSourceType === 'quiz_attempt'
      ? `quiz attempt #${latestRowAttemptNo}`
      : 'AI Practice Review';
  let candidateReason = `${baseReason} (Updated from ${sourceLabel}, evidence #${count}).`;

  if (JOB_READY_FORBIDDEN_PATTERN.test(candidateReason)) {
    candidateReason =
      'Consistent understanding demonstrated across recent practice records.';
  }

  // Satisfy trg_skill_progress_guard: whenever learning_state changes, state_reason MUST be distinct from OLD.state_reason
  if (
    targetState !== previousState &&
    previousReason !== null &&
    candidateReason.trim() === previousReason.trim()
  ) {
    candidateReason = `${candidateReason} [transition ${previousState} -> ${targetState} #${count}]`;
  }

  return {
    nextState: targetState,
    reason: candidateReason,
  };
}

/**
 * Internal-only service implementing `EP-G04` (`C05` §14.9 / §15.9).
 *
 * Strictly internal: no HTTP controller route exposes this service (`POST /progress/evidence` does not exist).
 * Invoked exclusively by `QuizService` and `PracticeReviewJobHandler` inside their domain transactions.
 */
@Injectable()
export class EvidenceService {
  private assertUuid(value: unknown, field: string): string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
      fail(422, 'VALIDATION_FAILED', `${field} must be a valid UUID`, [
        {
          field,
          code: 'INVALID_FORMAT',
          message: `${field} must be a valid UUID`,
        },
      ]);
    }
    return value.trim().toLowerCase();
  }

  private validateInput(dto: EvidenceDTO): {
    userId: string;
    skillId: string;
    careerLevel: CareerLevel;
    roadmapId: string | null;
    topicId: string;
    sourceType: EvidenceSource;
    sourceId: string;
    difficulty: QuestionDifficulty;
    scoreSummary: Record<string, unknown>;
    performanceLevel: PerformanceLevel | null;
    attemptNo: number;
    occurredAt: string;
  } {
    if (!dto || typeof dto !== 'object') {
      fail(422, 'VALIDATION_FAILED', 'EvidenceDTO payload is required');
    }
    if (
      dto.evidence_eligible === false ||
      dto.score_summary?.review_status === 'not_evidence' ||
      dto.score_summary?.evidence_eligible === false ||
      dto.score_summary?.is_junk === true
    ) {
      fail(
        422,
        'VALIDATION_FAILED',
        'Junk or non-attempt responses cannot be recorded as learning evidence',
      );
    }

    const userId = this.assertUuid(dto.user_id, 'user_id');
    const skillId = this.assertUuid(dto.skill_id, 'skill_id');
    const topicId = this.assertUuid(dto.topic_id, 'topic_id');
    const sourceId = this.assertUuid(dto.source_id, 'source_id');
    const roadmapId =
      dto.roadmap_id !== undefined && dto.roadmap_id !== null
        ? this.assertUuid(dto.roadmap_id, 'roadmap_id')
        : null;

    if (
      typeof dto.career_level !== 'string' ||
      !(CAREER_LEVEL_VALUES as readonly string[]).includes(dto.career_level)
    ) {
      fail(422, 'INVALID_ENUM_VALUE', 'Invalid career_level for evidence');
    }
    if (
      typeof dto.source_type !== 'string' ||
      !(EVIDENCE_SOURCE_VALUES as readonly string[]).includes(dto.source_type)
    ) {
      fail(422, 'INVALID_ENUM_VALUE', 'Invalid evidence source_type');
    }
    if (
      typeof dto.difficulty !== 'string' ||
      !(QUESTION_DIFFICULTY_VALUES as readonly string[]).includes(
        dto.difficulty,
      )
    ) {
      fail(422, 'INVALID_ENUM_VALUE', 'Invalid evidence difficulty');
    }

    let performanceLevel: PerformanceLevel | null = null;
    if (dto.performance_level !== undefined && dto.performance_level !== null) {
      if (
        typeof dto.performance_level !== 'string' ||
        !(PERFORMANCE_LEVEL_VALUES as readonly string[]).includes(
          dto.performance_level,
        )
      ) {
        fail(422, 'INVALID_ENUM_VALUE', 'Invalid evidence performance_level');
      }
      performanceLevel = dto.performance_level;
    }

    if (
      typeof dto.attempt_no !== 'number' ||
      !Number.isInteger(dto.attempt_no) ||
      dto.attempt_no < 1 ||
      dto.attempt_no > 2
    ) {
      fail(422, 'VALIDATION_FAILED', 'attempt_no must be 1 or 2');
    }

    if (!isPlainObject(dto.score_summary)) {
      fail(422, 'VALIDATION_FAILED', 'score_summary must be a JSON object');
    }
    if ('answer_text' in dto.score_summary || 'raw_text' in dto.score_summary) {
      fail(
        422,
        'VALIDATION_FAILED',
        'score_summary must not contain raw answer text',
      );
    }

    const sanitizedScoreSummary = this.sanitizeScoreSummary(
      dto.source_type,
      dto.score_summary,
    );

    const occurredDate = new Date(dto.occurred_at);
    if (
      typeof dto.occurred_at !== 'string' ||
      Number.isNaN(occurredDate.getTime())
    ) {
      fail(
        422,
        'VALIDATION_FAILED',
        'occurred_at must be a valid ISO-8601 timestamp',
      );
    }

    return {
      userId,
      skillId,
      careerLevel: dto.career_level,
      roadmapId,
      topicId,
      sourceType: dto.source_type,
      sourceId,
      difficulty: dto.difficulty,
      scoreSummary: sanitizedScoreSummary,
      performanceLevel,
      attemptNo: dto.attempt_no,
      occurredAt: occurredDate.toISOString(),
    };
  }

  private sanitizeScoreSummary(
    sourceType: EvidenceSource,
    raw: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const validPerformance = (value: unknown): value is PerformanceLevel =>
      typeof value === 'string' &&
      (PERFORMANCE_LEVEL_VALUES as readonly string[]).includes(value);

    if (sourceType === 'quiz_attempt') {
      const hasCorrect = raw.mcq_correct !== undefined;
      const hasTotal = raw.mcq_total !== undefined;
      if (hasCorrect || hasTotal) {
        const correct = Number(raw.mcq_correct);
        const total = Number(raw.mcq_total);
        if (
          !Number.isInteger(correct) ||
          !Number.isInteger(total) ||
          correct < 0 ||
          total < 0 ||
          correct > total
        ) {
          fail(
            422,
            'VALIDATION_FAILED',
            'quiz_attempt score_summary requires valid mcq_correct and mcq_total integers',
          );
        }
        out.mcq_correct = correct;
        out.mcq_total = total;
      }
      if (raw.ratio !== undefined) {
        const ratio = Number(raw.ratio);
        if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
          fail(
            422,
            'VALIDATION_FAILED',
            'quiz_attempt score_summary ratio must be between 0 and 1',
          );
        }
        out.ratio = ratio;
      }
      if (raw.performance_level !== undefined) {
        if (!validPerformance(raw.performance_level)) {
          fail(
            422,
            'INVALID_ENUM_VALUE',
            'Invalid performance_level in score_summary',
          );
        }
        out.performance_level = raw.performance_level;
      }
      return out;
    }

    const validDimScore = (v: unknown): v is 'good' | 'partial' | 'weak' =>
      v === 'good' || v === 'partial' || v === 'weak';
    if (raw.dimensions !== undefined) {
      if (!isPlainObject(raw.dimensions)) {
        fail(
          422,
          'VALIDATION_FAILED',
          'practice_review score_summary.dimensions must be an object',
        );
      }
      const dims: Record<string, 'good' | 'partial' | 'weak'> = {};
      for (const key of [
        'correctness',
        'understanding',
        'reasoning',
      ] as const) {
        const val = raw.dimensions[key];
        if (val !== undefined) {
          if (!validDimScore(val)) {
            fail(
              422,
              'INVALID_ENUM_VALUE',
              `Invalid ${key} dimension score in score_summary`,
            );
          }
          dims[key] = val;
        }
      }
      if (Object.keys(dims).length > 0) {
        out.dimensions = dims;
      }
    }
    if (raw.performance_level !== undefined) {
      if (!validPerformance(raw.performance_level)) {
        fail(
          422,
          'INVALID_ENUM_VALUE',
          'Invalid performance_level in score_summary',
        );
      }
      out.performance_level = raw.performance_level;
    }
    return out;
  }

  /**
   * `EP-G04` (`EvidenceService.record`):
   * Appends derived learning evidence, recomputes level-scoped `public.skill_progress`,
   * and appends explainable events to `public.achievement_history` inside `tx`.
   */
  async record(
    tx: TransactionalQueryExecutor,
    dto: EvidenceDTO,
  ): Promise<EvidenceRecordResult> {
    const valid = this.validateInput(dto);

    // 1. Lock existing skill_progress row (if any) for (user_id, skill_id, career_level)
    const existingRows = await tx.query<SkillProgressRow[]>(
      `SELECT id,
              learning_state::text AS learning_state,
              state_reason,
              last_evidence_at,
              evidence_count
         FROM public.skill_progress
        WHERE user_id = $1
          AND skill_id = $2
          AND career_level = $3::public.career_level
        FOR UPDATE`,
      [valid.userId, valid.skillId, valid.careerLevel],
    );
    const existingProgress = Array.isArray(existingRows)
      ? existingRows[0]
      : undefined;
    const previousState: LearningState =
      existingProgress?.learning_state ?? 'not_started';
    const previousReason: string | null =
      existingProgress?.state_reason ?? null;

    // 2. Append to public.learning_evidence (append-only; ON CONFLICT DO NOTHING for idempotency)
    const insertedRaw = await tx.query<unknown>(
      `INSERT INTO public.learning_evidence (
         user_id,
         skill_id,
         career_level,
         roadmap_id,
         topic_id,
         source_type,
         source_id,
         difficulty,
         score_summary,
         performance_level,
         attempt_no,
         occurred_at
       )
       VALUES (
         $1,
         $2,
         $3::public.career_level,
         $4,
         $5,
         $6::public.evidence_source,
         $7,
         $8::public.question_difficulty,
         $9::jsonb,
         $10::public.performance_level,
         $11,
         $12::timestamptz
       )
       ON CONFLICT (source_type, source_id, skill_id) DO NOTHING
       RETURNING id`,
      [
        valid.userId,
        valid.skillId,
        valid.careerLevel,
        valid.roadmapId,
        valid.topicId,
        valid.sourceType,
        valid.sourceId,
        valid.difficulty,
        JSON.stringify(valid.scoreSummary),
        valid.performanceLevel,
        valid.attemptNo,
        valid.occurredAt,
      ],
    );
    const insertedRow = extractReturningRows<{ id: string }>(insertedRaw)[0];

    if (!insertedRow?.id) {
      // Duplicate evidence replay: return current state without re-appending achievement_history
      return {
        evidence_id: null,
        inserted: false,
        skill_id: valid.skillId,
        career_level: valid.careerLevel,
        previous_state: previousState,
        current_state: previousState,
        state_changed: false,
        state_reason:
          previousReason ?? 'Existing evidence already recorded for this item.',
        progress_change: null,
      };
    }

    // 3. Load all level-scoped learning_evidence for (user_id, skill_id, career_level) ordered newest-first
    const allEvidenceRows = await tx.query<StoredEvidenceRow[]>(
      `SELECT id,
              source_type::text AS source_type,
              source_id,
              topic_id,
              difficulty::text AS difficulty,
              score_summary,
              performance_level::text AS performance_level,
              attempt_no,
              occurred_at
         FROM public.learning_evidence
        WHERE user_id = $1
          AND skill_id = $2
          AND career_level = $3::public.career_level
        ORDER BY occurred_at DESC, created_at DESC, id DESC`,
      [valid.userId, valid.skillId, valid.careerLevel],
    );
    const evidenceList: StoredEvidenceRow[] =
      Array.isArray(allEvidenceRows) && allEvidenceRows.length > 0
        ? allEvidenceRows
        : [
            {
              id: insertedRow.id,
              source_type: valid.sourceType,
              source_id: valid.sourceId,
              topic_id: valid.topicId,
              difficulty: valid.difficulty,
              score_summary: valid.scoreSummary,
              performance_level: valid.performanceLevel,
              attempt_no: valid.attemptNo,
              occurred_at: valid.occurredAt,
            },
          ];

    const { nextState, reason } = computeLevelScopedSkillState(
      previousState,
      previousReason,
      evidenceList,
      valid.sourceType,
      valid.attemptNo,
    );
    const stateChanged = nextState !== previousState;
    const totalEvidenceCount = evidenceList.length;

    // 4. Upsert public.skill_progress respecting trg_skill_progress_guard
    if (!existingProgress) {
      await tx.query(
        `INSERT INTO public.skill_progress (
           user_id,
           skill_id,
           career_level,
           learning_state,
           state_reason,
           last_evidence_at,
           evidence_count,
           state_changed_at
         )
         VALUES (
           $1,
           $2,
           $3::public.career_level,
           $4::public.learning_state,
           $5,
           $6::timestamptz,
           $7,
           clock_timestamp()
         )`,
        [
          valid.userId,
          valid.skillId,
          valid.careerLevel,
          nextState,
          reason,
          valid.occurredAt,
          totalEvidenceCount,
        ],
      );
    } else {
      await tx.query(
        `UPDATE public.skill_progress
            SET learning_state = $2::public.learning_state,
                state_reason = $3,
                last_evidence_at = GREATEST(COALESCE(last_evidence_at, $4::timestamptz), $4::timestamptz),
                evidence_count = $5
          WHERE id = $1`,
        [
          existingProgress.id,
          nextState,
          reason,
          valid.occurredAt,
          totalEvidenceCount,
        ],
      );
    }

    // 5. Append single explainable history event to public.achievement_history (append-only):
    // 'state_change' when learning_state transitions; 'evidence_added' when state remains unchanged.
    const historyEventType: 'state_change' | 'evidence_added' = stateChanged
      ? 'state_change'
      : 'evidence_added';
    await tx.query(
      `INSERT INTO public.achievement_history (
         user_id,
         skill_id,
         career_level,
         event_type,
         from_state,
         to_state,
         reason,
         source_type,
         source_id,
         occurred_at
       )
       VALUES (
         $1,
         $2,
         $3::public.career_level,
         $4::public.progress_event_type,
         $5::public.learning_state,
         $6::public.learning_state,
         $7,
         $8::public.evidence_source,
         $9,
         $10::timestamptz
       )`,
      [
        valid.userId,
        valid.skillId,
        valid.careerLevel,
        historyEventType,
        stateChanged ? previousState : null,
        nextState,
        reason,
        valid.sourceType,
        valid.sourceId,
        valid.occurredAt,
      ],
    );

    return {
      evidence_id: String(insertedRow.id),
      inserted: true,
      skill_id: valid.skillId,
      career_level: valid.careerLevel,
      previous_state: previousState,
      current_state: nextState,
      state_changed: stateChanged,
      state_reason: reason,
      progress_change: stateChanged
        ? {
            skill_id: valid.skillId,
            career_level: valid.careerLevel,
            from: previousState,
            to: nextState,
            reason,
          }
        : null,
    };
  }
}

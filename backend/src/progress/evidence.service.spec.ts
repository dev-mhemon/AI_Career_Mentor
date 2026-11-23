import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { TransactionalQueryExecutor } from '../profile/profile.service.js';
import {
  computeLevelScopedSkillState,
  EvidenceService,
  isStrongEvidenceRecord,
} from './services/evidence.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SKILL_ID = '22222222-2222-4222-8222-222222222222';
const ROADMAP_ID = '33333333-3333-4333-8333-333333333333';
const TOPIC_ID = '44444444-4444-4444-8444-444444444444';
const SOURCE_1 = '55555555-5555-4555-8555-555555555551';
const SOURCE_2 = '55555555-5555-4555-8555-555555555552';
const EVIDENCE_1 = '66666666-6666-4666-8666-666666666661';
const EVIDENCE_2 = '66666666-6666-4666-8666-666666666662';

describe('EvidenceService (EP-G04 internal-only, level-scoped mastery & append-only evidence)', () => {
  const service = new EvidenceService();

  it('rejects non-eligible or raw-text-leaking evidence without writing to DB', async () => {
    const queryMock = vi.fn();
    const tx = { query: queryMock } as unknown as TransactionalQueryExecutor;
    await expect(
      service.record(tx, {
        user_id: USER_ID,
        skill_id: SKILL_ID,
        career_level: 'mid',
        roadmap_id: ROADMAP_ID,
        topic_id: TOPIC_ID,
        source_type: 'practice_review',
        source_id: SOURCE_1,
        difficulty: 'application',
        score_summary: { dimensions: {} },
        performance_level: null,
        attempt_no: 1,
        occurred_at: '2026-11-22T10:00:00.000Z',
        evidence_eligible: false,
      }),
    ).rejects.toThrow(HttpException);
    expect(queryMock).not.toHaveBeenCalled();

    await expect(
      service.record(tx, {
        user_id: USER_ID,
        skill_id: SKILL_ID,
        career_level: 'mid',
        topic_id: TOPIC_ID,
        source_type: 'practice_review',
        source_id: SOURCE_1,
        difficulty: 'application',
        score_summary: { answer_text: 'RAW_PRIVATE_TEXT' },
        performance_level: 'good',
        attempt_no: 1,
        occurred_at: '2026-11-22T10:00:00.000Z',
        evidence_eligible: true,
      }),
    ).rejects.toThrow(HttpException);
  });

  it('never grants proficient from a single quiz score (even 100%) and requires >=2 strong level-scoped evidence records', () => {
    // 1st attempt with 100% (20/20) -> at most practicing, NEVER proficient
    const firstAttempt100 = computeLevelScopedSkillState(
      'not_started',
      null,
      [
        {
          id: EVIDENCE_1,
          source_type: 'quiz_attempt',
          source_id: SOURCE_1,
          difficulty: 'application',
          score_summary: { mcq_correct: 20, mcq_total: 20 },
          performance_level: 'good',
          attempt_no: 1,
          occurred_at: '2026-11-22T10:00:00.000Z',
        },
      ],
      'quiz_attempt',
      1,
    );
    expect(firstAttempt100.nextState).toBe('practicing');
    expect(firstAttempt100.nextState).not.toBe('proficient');
    expect(firstAttempt100.reason.toLowerCase()).not.toContain('job ready');

    // 1st attempt weak score -> learning
    const firstAttemptWeak = computeLevelScopedSkillState(
      'not_started',
      null,
      [
        {
          id: EVIDENCE_1,
          source_type: 'quiz_attempt',
          source_id: SOURCE_1,
          difficulty: 'basic',
          score_summary: { mcq_correct: 8, mcq_total: 20 },
          performance_level: 'needs_work',
          attempt_no: 1,
          occurred_at: '2026-11-22T10:00:00.000Z',
        },
      ],
      'quiz_attempt',
      1,
    );
    expect(firstAttemptWeak.nextState).toBe('learning');

    // 2nd strong evidence at same (skill_id, career_level) -> proficient with distinct state_reason
    const secondStrong = computeLevelScopedSkillState(
      'practicing',
      firstAttempt100.reason,
      [
        {
          id: EVIDENCE_2,
          source_type: 'practice_review',
          source_id: SOURCE_2,
          difficulty: 'analysis',
          score_summary: {
            dimensions: {
              correctness: 'good',
              understanding: 'good',
              reasoning: 'good',
            },
          },
          performance_level: 'good',
          attempt_no: 1,
          occurred_at: '2026-11-22T10:05:00.000Z',
        },
        {
          id: EVIDENCE_1,
          source_type: 'quiz_attempt',
          source_id: SOURCE_1,
          difficulty: 'application',
          score_summary: { mcq_correct: 20, mcq_total: 20 },
          performance_level: 'good',
          attempt_no: 1,
          occurred_at: '2026-11-22T10:00:00.000Z',
        },
      ],
      'practice_review',
      1,
    );
    expect(secondStrong.nextState).toBe('proficient');
    expect(secondStrong.reason).not.toBe(firstAttempt100.reason);
    expect(secondStrong.reason.toLowerCase()).not.toContain('job ready');
  });

  it('appends learning_evidence, updates level-scoped skill_progress, and logs a single achievement_history event per write', async () => {
    const executedSql: Array<{ sql: string; params?: unknown[] }> = [];
    const queryMock = vi.fn(async (sql: string, params?: unknown[]) => {
      executedSql.push({ sql, params });
      if (sql.includes('INSERT INTO public.learning_evidence')) {
        return [
          [{ id: EVIDENCE_1, occurred_at: '2026-11-22T10:00:00.000Z' }],
          1,
        ];
      }
      if (sql.includes('FROM public.skill_progress')) {
        return [];
      }
      if (sql.includes('FROM public.learning_evidence')) {
        return [
          {
            id: EVIDENCE_1,
            source_type: 'quiz_attempt',
            source_id: SOURCE_1,
            difficulty: 'application',
            score_summary: { mcq_correct: 16, mcq_total: 20 },
            performance_level: 'good',
            attempt_no: 1,
            occurred_at: '2026-11-22T10:00:00.000Z',
          },
        ];
      }
      return [];
    });

    const tx = { query: queryMock } as unknown as TransactionalQueryExecutor;
    const outcome = await service.record(tx, {
      user_id: USER_ID,
      skill_id: SKILL_ID,
      career_level: 'mid',
      roadmap_id: ROADMAP_ID,
      topic_id: TOPIC_ID,
      source_type: 'quiz_attempt',
      source_id: SOURCE_1,
      difficulty: 'application',
      score_summary: {
        mcq_correct: 16,
        mcq_total: 20,
        arbitrary_extra_field: 'must-not-persist',
      },
      performance_level: 'good',
      attempt_no: 1,
      occurred_at: '2026-11-22T10:00:00.000Z',
      evidence_eligible: true,
    });

    const evidenceInsert = executedSql.find((e) =>
      e.sql.includes('INSERT INTO public.learning_evidence'),
    );
    expect(JSON.parse(String(evidenceInsert?.params?.[8]))).toEqual({
      mcq_correct: 16,
      mcq_total: 20,
    });

    expect(outcome.inserted).toBe(true);
    expect(outcome.previous_state).toBe('not_started');
    expect(outcome.current_state).toBe('practicing');
    expect(outcome.state_changed).toBe(true);
    expect(outcome.progress_change).toEqual({
      skill_id: SKILL_ID,
      career_level: 'mid',
      from: 'not_started',
      to: 'practicing',
      reason: expect.any(String),
    });
    const historyInserts = executedSql.filter((e) =>
      e.sql.includes('INSERT INTO public.achievement_history'),
    );
    expect(historyInserts).toHaveLength(1);
    expect(historyInserts[0]?.params?.[3]).toBe('state_change');
    expect(historyInserts[0]?.params?.[4]).toBe('not_started');
    expect(historyInserts[0]?.params?.[5]).toBe('practicing');
    expect(
      isStrongEvidenceRecord({
        source_type: 'quiz_attempt',
        score_summary: { mcq_correct: 16, mcq_total: 20 },
        performance_level: 'good',
      }),
    ).toBe(true);
  });

  it('maintains proficient with a fresh reason (no stacked suffixes) and scopes retry improvement to the same topic_id and row', () => {
    const maintained = computeLevelScopedSkillState(
      'proficient',
      'Consistent strong understanding demonstrated across 2 of 2 practice records at this career level. (Updated from quiz attempt #1, evidence #2).',
      [
        {
          id: EVIDENCE_2,
          source_type: 'quiz_attempt',
          source_id: SOURCE_2,
          topic_id: TOPIC_ID,
          difficulty: 'application',
          score_summary: { mcq_correct: 10, mcq_total: 20 },
          performance_level: 'needs_work',
          attempt_no: 1,
          occurred_at: '2026-11-23T10:00:00.000Z',
        },
        {
          id: EVIDENCE_1,
          source_type: 'quiz_attempt',
          source_id: SOURCE_1,
          topic_id: TOPIC_ID,
          difficulty: 'application',
          score_summary: { mcq_correct: 18, mcq_total: 20 },
          performance_level: 'good',
          attempt_no: 1,
          occurred_at: '2026-11-22T10:00:00.000Z',
        },
      ],
      'quiz_attempt',
      1,
    );
    expect(maintained.nextState).toBe('proficient');
    expect(maintained.reason.match(/Updated from/g)).toHaveLength(1);

    // Retry attempt on TOPIC_ID does NOT falsely match a weak attempt_no=1 from an unrelated topic
    const otherTopicId = '99999999-9999-4999-8999-999999999999';
    const unrelatedRetry = computeLevelScopedSkillState(
      'practicing',
      null,
      [
        {
          id: EVIDENCE_2,
          source_type: 'quiz_attempt',
          source_id: SOURCE_2,
          topic_id: TOPIC_ID,
          difficulty: 'application',
          score_summary: { mcq_correct: 18, mcq_total: 20 },
          performance_level: 'good',
          attempt_no: 2,
          occurred_at: '2026-11-23T10:00:00.000Z',
        },
        {
          id: EVIDENCE_1,
          source_type: 'quiz_attempt',
          source_id: SOURCE_1,
          topic_id: otherTopicId,
          difficulty: 'application',
          score_summary: { mcq_correct: 6, mcq_total: 20 },
          performance_level: 'needs_work',
          attempt_no: 1,
          occurred_at: '2026-11-22T10:00:00.000Z',
        },
      ],
      'quiz_attempt',
      1,
    );
    expect(unrelatedRetry.nextState).toBe('practicing');
    expect(unrelatedRetry.reason).not.toContain('Retry practice improved');
    expect(unrelatedRetry.reason).toContain('quiz attempt #2');
  });
});

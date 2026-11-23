import { describe, expect, it, vi } from 'vitest';
import type { PrivacyRetentionService } from '../account/services/privacy-retention.service.js';
import type { AiGatewayService } from '../ai/services/ai-gateway.service.js';
import type { DatabaseService } from '../auth/services/database.service.js';
import type { ClaimedJobRow } from '../jobs/services/postgres-job-queue.consumer.js';
import type { EvidenceService } from '../progress/services/evidence.service.js';
import { PracticeReviewJobHandler } from './services/practice-review-job.handler.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const REVIEW_ID = '33333333-3333-4333-8333-333333333333';
const QUESTION_ID = '44444444-4444-4444-8444-444444444444';
const TOPIC_ID = '55555555-5555-4555-8555-555555555555';
const SKILL_ID = '66666666-6666-4666-8666-666666666666';
const ROADMAP_ID = '77777777-7777-4777-8777-777777777777';
const JOB_ID = '88888888-8888-4888-8888-888888888888';
const AI_GEN_ID = '99999999-9999-4999-8999-999999999999';

function makePracticeReviewJob(): ClaimedJobRow {
  return {
    id: JOB_ID,
    user_id: USER_ID,
    task: 'practice_review',
    feature_key: 'ai_practice_review',
    job_kind: 'practice_review',
    status: 'preparing',
    attempt_count: 1,
    locked_by: 'worker-1',
    locked_at: new Date(),
    created_at: new Date(),
    language: 'en',
    subject_type: 'practice_review',
    subject_id: REVIEW_ID,
    idempotency_key: null,
    input_payload: {
      v: 1,
      args: {
        review_id: REVIEW_ID,
        attempt_id: ATTEMPT_ID,
      },
      expected_refs: {
        submitted_at: '2026-11-22T10:00:00.000Z',
        answer_saved_at: '2026-11-22T09:59:00.000Z',
      },
    },
  };
}

describe('PracticeReviewJobHandler (persistArtifact, EvidenceService recording, attempt finalization & onTerminalFailure)', () => {
  it('updates practice_reviews, records evidence when evidence_eligible=true, and finalizes quiz_attempts to feedback_available when no pending/failed reviews remain', async () => {
    let attemptFinalized = false;
    const txQuery = vi.fn(async (sql: string) => {
      if (
        sql.includes('FROM public.quiz_attempts qa') &&
        sql.includes('FOR UPDATE OF qa')
      ) {
        return [
          {
            id: ATTEMPT_ID,
            status: 'submitted',
            attempt_no: 1,
            performance_level: 'good',
            improvement_recommendations: ['Keep practicing SQL joins.'],
            topic_id: TOPIC_ID,
            roadmap_id: ROADMAP_ID,
            career_level: 'mid',
            skill_id: SKILL_ID,
          },
        ];
      }
      if (
        sql.includes('FROM public.practice_reviews pr') &&
        sql.includes('FOR UPDATE OF pr')
      ) {
        return [
          {
            id: REVIEW_ID,
            question_id: QUESTION_ID,
            review_status: 'pending',
            difficulty: 'analysis',
            answer_text:
              'SELECT * FROM users u LEFT JOIN orders o ON u.id = o.user_id;',
            raw_text_expires_at: '2027-02-20T10:00:00.000Z',
            raw_text_purged_at: null,
            answer_saved_at: '2026-11-22T09:59:00.000Z',
            answer_created_at: '2026-11-22T09:59:00.000Z',
          },
        ];
      }
      if (sql.includes('UPDATE public.practice_reviews')) {
        return [];
      }
      if (
        sql.includes('FROM public.practice_reviews pr') &&
        sql.includes('WHERE pr.attempt_id = $1')
      ) {
        expect(sql).toContain(
          'ORDER BY qq.sort_order ASC NULLS LAST, pr.id ASC',
        );
        return [
          {
            review_status: 'reviewed',
            performance_level: 'good',
            improvement_recommendations: ['Add NULL handling examples.'],
          },
        ];
      }
      if (
        sql.includes('UPDATE public.quiz_attempts') &&
        sql.includes("status = 'feedback_available'")
      ) {
        attemptFinalized = true;
        return [];
      }
      return [];
    });

    const evidenceRecordMock = vi.fn().mockResolvedValue({ inserted: true });
    const handler = new PracticeReviewJobHandler(
      { query: txQuery } as unknown as DatabaseService,
      {} as unknown as AiGatewayService,
      {
        isRawTextExpired: vi.fn().mockReturnValue(false),
      } as unknown as PrivacyRetentionService,
      { record: evidenceRecordMock } as unknown as EvidenceService,
    );

    const txExecutor = {
      query: txQuery,
    } as unknown as import('../jobs/services/job-producer.service.js').JobQueryExecutor;
    const outcome = await handler.persistArtifact(
      txExecutor,
      makePracticeReviewJob(),
      {
        resultType: 'practice_review',
        resultId: REVIEW_ID,
        providerKey: 'synthetic',
        modelId: 'm1',
        promptVersionId: 'p1',
        outputSchemaId: 'practice_review.v1',
        fallbackUsed: false,
        language: 'en',
        inputUnits: 50,
        outputUnits: 120,
        latencyMs: 20,
        output: {
          review_status: 'reviewed',
          performance_level: 'good',
          dimensions: {
            correctness: 'good',
            understanding: 'good',
            reasoning: 'good',
          },
          strengths: ['Accurate LEFT JOIN query'],
          mistakes: [],
          weaknesses: [],
          improvement_recommendations: ['Add NULL handling examples.'],
          evidence_eligible: true,
        },
      },
      { aiGenerationId: AI_GEN_ID },
    );

    expect(outcome).toEqual({
      resultType: 'practice_review',
      resultId: REVIEW_ID,
    });
    expect(evidenceRecordMock).toHaveBeenCalledTimes(1);
    expect(attemptFinalized).toBe(true);
  });

  it('marks practice_reviews.review_status = failed on onTerminalFailure', async () => {
    const txQuery = vi.fn().mockResolvedValue([]);
    const handler = new PracticeReviewJobHandler(
      { query: txQuery } as unknown as DatabaseService,
      {} as unknown as AiGatewayService,
      {
        isRawTextExpired: vi.fn().mockReturnValue(false),
      } as unknown as PrivacyRetentionService,
      { record: vi.fn() } as unknown as EvidenceService,
    );

    const txExecutor = {
      query: txQuery,
    } as unknown as import('../jobs/services/job-producer.service.js').JobQueryExecutor;
    await handler.onTerminalFailure(
      txExecutor,
      makePracticeReviewJob(),
      'AI_PROVIDER_TIMEOUT',
    );

    const failedUpdate = txQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE public.practice_reviews'),
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.[1]).toEqual([
      REVIEW_ID,
      USER_ID,
      'AI_PROVIDER_TIMEOUT',
    ]);
  });

  it('rejects persistArtifact when live quiz_answers raw text was purged/expired after acquiring locks', async () => {
    const txQuery = vi.fn(async (sql: string) => {
      if (
        sql.includes('FROM public.quiz_attempts qa') &&
        sql.includes('FOR UPDATE OF qa')
      ) {
        return [
          {
            id: ATTEMPT_ID,
            status: 'submitted',
            attempt_no: 1,
            performance_level: 'good',
            improvement_recommendations: [],
            topic_id: TOPIC_ID,
            roadmap_id: ROADMAP_ID,
            career_level: 'mid',
            skill_id: SKILL_ID,
          },
        ];
      }
      if (
        sql.includes('FROM public.practice_reviews pr') &&
        sql.includes('FOR UPDATE OF pr')
      ) {
        return [
          {
            id: REVIEW_ID,
            question_id: QUESTION_ID,
            review_status: 'pending',
            difficulty: 'analysis',
            answer_text: null,
            raw_text_expires_at: '2026-01-01T00:00:00.000Z',
            raw_text_purged_at: '2026-11-22T10:01:00.000Z',
            answer_saved_at: '2026-11-22T09:59:00.000Z',
            answer_created_at: '2026-11-22T09:59:00.000Z',
          },
        ];
      }
      return [];
    });

    const evidenceRecordMock = vi.fn();
    const handler = new PracticeReviewJobHandler(
      { query: txQuery } as unknown as DatabaseService,
      {} as unknown as AiGatewayService,
      {
        isRawTextExpired: vi.fn().mockReturnValue(true),
      } as unknown as PrivacyRetentionService,
      { record: evidenceRecordMock } as unknown as EvidenceService,
    );

    const txExecutor = {
      query: txQuery,
    } as unknown as import('../jobs/services/job-producer.service.js').JobQueryExecutor;
    await expect(
      handler.persistArtifact(txExecutor, makePracticeReviewJob(), {
        resultType: 'practice_review',
        resultId: REVIEW_ID,
        providerKey: 'synthetic',
        modelId: 'm1',
        promptVersionId: 'p1',
        outputSchemaId: 'practice_review.v1',
        fallbackUsed: false,
        language: 'en',
        inputUnits: 50,
        outputUnits: 120,
        latencyMs: 20,
        output: {
          review_status: 'reviewed',
          performance_level: 'good',
          dimensions: {
            correctness: 'good',
            understanding: 'good',
            reasoning: 'good',
          },
          strengths: ['Good'],
          mistakes: [],
          weaknesses: [],
          improvement_recommendations: ['Keep going'],
          evidence_eligible: true,
        },
      }),
    ).rejects.toThrow(/expired or been purged/i);
    expect(evidenceRecordMock).not.toHaveBeenCalled();
  });
});

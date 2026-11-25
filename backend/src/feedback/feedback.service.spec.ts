import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import { FeedbackService } from './services/feedback.service.js';
import {
  DEFAULT_REPORT_AUTO_HIDE_THRESHOLD,
  SharedContentQualityService,
} from './services/shared-content-quality.service.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const TARGET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROADMAP_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REPORT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

interface TxCapture {
  userId: string | null;
  active: boolean;
  foreground: boolean;
  useServiceRole: boolean;
}

function createMockDb(
  queryHandler: (sql: string, params?: unknown[]) => Promise<unknown> | unknown,
) {
  const txCalls: TxCapture[] = [];
  const executedStatements: Array<{ sql: string; params?: unknown[] }> = [];

  const txExecutor = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      executedStatements.push({ sql, params });
      return queryHandler(sql, params);
    }),
  };

  const database: Pick<DatabaseService, 'query' | 'transaction'> = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      executedStatements.push({ sql, params });
      return queryHandler(sql, params);
    }) as unknown as DatabaseService['query'],
    transaction: vi.fn(
      async <T>(
        userId: string | null,
        operation: (db: never) => Promise<T>,
        active = true,
        foreground = false,
        useServiceRole = true,
      ): Promise<T> => {
        txCalls.push({ userId, active, foreground, useServiceRole });
        return operation(txExecutor as never);
      },
    ) as unknown as DatabaseService['transaction'],
  };

  return {
    database: database as DatabaseService,
    txCalls,
    executedStatements,
    txExecutor,
  };
}

async function expectContractError(
  promise: Promise<unknown>,
  expectedStatus: number,
  expectedCode: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    status: expectedStatus,
    response: expect.objectContaining({
      code: expectedCode,
    }),
  });
}

describe('FeedbackService & SharedContentQualityService (M12-A)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('EP-F01 submitRating — R34 visibility/exposure, upsert & R24 foreground activity', () => {
    it.each([
      [
        'roadmap_draft',
        'FROM public.roadmap_versions rv',
        ['r.user_id = $1', 'rv.user_id = $1'],
      ],
      [
        'roadmap_merge',
        'FROM public.roadmap_merges rm',
        ['r.user_id = $1', 'rm.user_id = $1'],
      ],
      [
        'topic_content',
        'FROM public.topics t',
        ["t.status = 'approved'::public.content_status", 'ri.user_id = $1'],
      ],
      [
        'technology_update',
        'FROM public.technology_updates tu',
        [
          'udh.user_id = $1',
          "udh.state = 'available'::public.update_state",
          "private.effective_feature_access($1, 'technology_update'::public.feature_key) = true",
        ],
      ],
    ] as const)(
      'accepts exposed/owned %s target, runs with foreground=true, normalizes whitespace comment to null, and returns 200 DTO',
      async (targetType, expectedSqlFragment, requiredPredicates) => {
        const { database, txCalls, executedStatements } = createMockDb(
          (sql, params) => {
            if (sql.includes(expectedSqlFragment)) {
              const hasAllPredicates = requiredPredicates.every((pred) =>
                sql.includes(pred),
              );
              if (
                hasAllPredicates &&
                params?.[0] === USER_A &&
                params?.[1] === TARGET_ID
              ) {
                return [{ id: TARGET_ID }];
              }
              return [];
            }
            if (sql.includes('INSERT INTO public.user_ratings')) {
              return [
                {
                  target_type: targetType,
                  target_id: TARGET_ID,
                  score: 5,
                },
              ];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
          },
        );

        const quality = new SharedContentQualityService(database);
        const service = new FeedbackService(database, quality);

        const result = await service.submitRating(USER_A, {
          target_type: targetType,
          target_id: TARGET_ID,
          score: 5,
          comment: '   ',
        });

        expect(result).toEqual({
          target_type: targetType,
          target_id: TARGET_ID,
          score: 5,
        });
        expect(txCalls).toEqual([
          {
            userId: USER_A,
            active: true,
            foreground: true,
            useServiceRole: true,
          },
        ]);

        const visibilityCall = executedStatements.find((s) =>
          s.sql.includes(expectedSqlFragment),
        );
        expect(visibilityCall?.params).toEqual([USER_A, TARGET_ID]);
        for (const pred of requiredPredicates) {
          expect(visibilityCall?.sql).toContain(pred);
        }

        const insertCall = executedStatements.find((s) =>
          s.sql.includes('INSERT INTO public.user_ratings'),
        );
        expect(insertCall?.params).toEqual([
          USER_A,
          targetType,
          TARGET_ID,
          5,
          null,
        ]);
      },
    );

    it.each([
      [
        'roadmap_draft',
        'FROM public.roadmap_versions rv',
        ['r.user_id = $1', 'rv.user_id = $1'],
      ],
      [
        'roadmap_merge',
        'FROM public.roadmap_merges rm',
        ['r.user_id = $1', 'rm.user_id = $1'],
      ],
      [
        'topic_content',
        'FROM public.topics t',
        ["t.status = 'approved'::public.content_status", 'ri.user_id = $1'],
      ],
      [
        'technology_update',
        'FROM public.technology_updates tu',
        [
          'udh.user_id = $1',
          "udh.state = 'available'::public.update_state",
          "private.effective_feature_access($1, 'technology_update'::public.feature_key) = true",
        ],
      ],
    ] as const)(
      'rejects foreign, undelivered, feature-disabled, or unapproved %s target with 404 TARGET_NOT_FOUND',
      async (targetType, expectedSqlFragment, requiredPredicates) => {
        // Target belongs exclusively to USER_A; calling as foreign tenant USER_B must fail 404
        // when the ownership/exposure predicates are present and bound to USER_B.
        const { database, executedStatements } = createMockDb((sql, params) => {
          if (sql.includes(expectedSqlFragment)) {
            const enforcesTenantAndVisibility = requiredPredicates.every(
              (pred) => sql.includes(pred),
            );
            if (!enforcesTenantAndVisibility) {
              return [{ id: TARGET_ID }];
            }
            return params?.[0] === USER_A && params?.[1] === TARGET_ID
              ? [{ id: TARGET_ID }]
              : [];
          }
          return [];
        });
        const quality = new SharedContentQualityService(database);
        const service = new FeedbackService(database, quality);

        await expectContractError(
          service.submitRating(USER_B, {
            target_type: targetType,
            target_id: TARGET_ID,
            score: 4,
          }),
          404,
          'TARGET_NOT_FOUND',
        );

        const visibilityCall = executedStatements.find((s) =>
          s.sql.includes(expectedSqlFragment),
        );
        expect(visibilityCall?.params).toEqual([USER_B, TARGET_ID]);
        for (const pred of requiredPredicates) {
          expect(visibilityCall?.sql).toContain(pred);
        }
        expect(
          executedStatements.some((s) =>
            s.sql.includes('INSERT INTO public.user_ratings'),
          ),
        ).toBe(false);
      },
    );

    it('enforces approved status, FOR SHARE row lock on public.topics, AND canonical (skill_id, slug, career_level) lineage exposure on topic_content ratings (v2+ regenerated topics)', async () => {
      const topicV2Id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      const { database, executedStatements } = createMockDb((sql) => {
        if (sql.includes('FROM public.topics t')) {
          expect(sql).toContain("t.status = 'approved'::public.content_status");
          expect(sql).toContain('FOR SHARE OF t');
          expect(sql).toContain('t_ri.skill_id = t.skill_id');
          expect(sql).toContain('t_ri.slug = t.slug');
          expect(sql).toContain('t_ri.career_level = t.career_level');
          expect(sql).toContain('t_dpi.skill_id = t.skill_id');
          // Simulate canonical v2 topic matching user's v1 roadmap_item lineage
          return [{ id: topicV2Id }];
        }
        if (sql.includes('INSERT INTO public.user_ratings')) {
          return [
            [{ target_type: 'topic_content', target_id: topicV2Id, score: 4 }],
            1,
          ];
        }
        return [];
      });

      const quality = new SharedContentQualityService(database);
      const service = new FeedbackService(database, quality);

      const res = await service.submitRating(USER_A, {
        target_type: 'topic_content',
        target_id: topicV2Id,
        score: 4,
        comment: 'Clear regenerated explanation',
      });

      expect(res).toEqual({
        target_type: 'topic_content',
        target_id: topicV2Id,
        score: 4,
      });
      expect(executedStatements).toHaveLength(2);
    });

    it('enforces effective_feature_access(user, technology_update) = true and state = available on technology_update ratings', async () => {
      const { database } = createMockDb((sql) => {
        if (sql.includes('FROM public.technology_updates tu')) {
          expect(sql).toContain("udh.state = 'available'::public.update_state");
          expect(sql).toContain(
            "private.effective_feature_access($1, 'technology_update'::public.feature_key) = true",
          );
          return [];
        }
        return [];
      });

      const quality = new SharedContentQualityService(database);
      const service = new FeedbackService(database, quality);

      await expectContractError(
        service.submitRating(USER_A, {
          target_type: 'technology_update',
          target_id: TARGET_ID,
          score: 3,
        }),
        404,
        'TARGET_NOT_FOUND',
      );
    });

    it('upserts user_ratings preserving a single row per (user_id, target_type, target_id)', async () => {
      const ratingsStore = new Map<
        string,
        { score: number; comment: string | null }
      >();

      const { database } = createMockDb((sql, params) => {
        if (sql.includes('FROM public.roadmap_versions rv')) {
          return [{ id: VERSION_ID }];
        }
        if (sql.includes('INSERT INTO public.user_ratings')) {
          expect(sql).toContain(
            'ON CONFLICT (user_id, target_type, target_id)',
          );
          expect(sql).toContain('DO UPDATE SET');
          expect(sql).toContain('score = EXCLUDED.score');
          expect(sql).toContain('comment = EXCLUDED.comment');
          expect(sql).not.toContain('DO NOTHING');
          const [uId, tType, tId, score, comment] = params as [
            string,
            string,
            string,
            number,
            string | null,
          ];
          ratingsStore.set(`${uId}:${tType}:${tId}`, { score, comment });
          return [{ target_type: tType, target_id: tId, score }];
        }
        return [];
      });

      const quality = new SharedContentQualityService(database);
      const service = new FeedbackService(database, quality);

      const first = await service.submitRating(USER_A, {
        target_type: 'roadmap_draft',
        target_id: VERSION_ID,
        score: 3,
        comment: 'Initial draft',
      });
      expect(first.score).toBe(3);

      const second = await service.submitRating(USER_A, {
        target_type: 'roadmap_draft',
        target_id: VERSION_ID,
        score: 5,
        comment: 'Much better after revision',
      });
      expect(second.score).toBe(5);
      expect(ratingsStore.size).toBe(1);
      expect(ratingsStore.get(`${USER_A}:roadmap_draft:${VERSION_ID}`)).toEqual(
        {
          score: 5,
          comment: 'Much better after revision',
        },
      );
    });

    it('rejects locked merge-result roadmap_versions (created_by = merge) as roadmap_draft while preserving draft/draft-origin versions and separate roadmap_merge ratings', async () => {
      const mergeVersionId = '12121212-1212-4121-8121-121212121212';
      const draftOriginLockedId = '34343434-3434-4343-8343-343434343434';
      const mergeId = '56565656-5656-4565-8565-565656565656';

      const versionsTable = new Map<
        string,
        { user_id: string; state: string; created_by: string }
      >([
        [
          mergeVersionId,
          { user_id: USER_A, state: 'locked', created_by: 'merge' },
        ],
        [
          draftOriginLockedId,
          { user_id: USER_A, state: 'locked', created_by: 'ai' },
        ],
        [
          VERSION_ID,
          { user_id: USER_A, state: 'draft', created_by: 'user_request' },
        ],
      ]);

      const { database } = createMockDb((sql, params) => {
        if (sql.includes('FROM public.roadmap_versions rv')) {
          expect(sql).toContain(
            "rv.state = 'draft'::public.roadmap_version_state",
          );
          expect(sql).toContain(
            "rv.created_by <> 'merge'::public.roadmap_version_origin",
          );
          const [uId, vId] = params as [string, string];
          const row = versionsTable.get(vId);
          if (
            row &&
            row.user_id === uId &&
            (row.state === 'draft' || row.created_by !== 'merge')
          ) {
            return [{ id: vId }];
          }
          return [];
        }
        if (sql.includes('FROM public.roadmap_merges rm')) {
          const [uId, mId] = params as [string, string];
          return uId === USER_A && mId === mergeId ? [{ id: mId }] : [];
        }
        if (sql.includes('INSERT INTO public.user_ratings')) {
          const [, tType, tId, score] = params as [
            string,
            string,
            string,
            number,
          ];
          return [{ target_type: tType, target_id: tId, score }];
        }
        return [];
      });

      const quality = new SharedContentQualityService(database);
      const service = new FeedbackService(database, quality);

      // Locked merge-result version MUST NOT qualify as roadmap_draft
      await expectContractError(
        service.submitRating(USER_A, {
          target_type: 'roadmap_draft',
          target_id: mergeVersionId,
          score: 4,
        }),
        404,
        'TARGET_NOT_FOUND',
      );

      // Owned draft and draft-origin versions remain ratable as roadmap_draft
      await expect(
        service.submitRating(USER_A, {
          target_type: 'roadmap_draft',
          target_id: VERSION_ID,
          score: 4,
        }),
      ).resolves.toMatchObject({
        target_type: 'roadmap_draft',
        target_id: VERSION_ID,
        score: 4,
      });
      await expect(
        service.submitRating(USER_A, {
          target_type: 'roadmap_draft',
          target_id: draftOriginLockedId,
          score: 5,
        }),
      ).resolves.toMatchObject({
        target_type: 'roadmap_draft',
        target_id: draftOriginLockedId,
        score: 5,
      });

      // Separate roadmap_merge rating remains intact
      await expect(
        service.submitRating(USER_A, {
          target_type: 'roadmap_merge',
          target_id: mergeId,
          score: 5,
        }),
      ).resolves.toMatchObject({
        target_type: 'roadmap_merge',
        target_id: mergeId,
        score: 5,
      });
    });

    it.each([
      'quiz_question',
      'practice_review',
      'roadmap_content',
      'mentor',
      'mentor_message',
      'conversation',
    ])(
      'rejects non-ratable domain target %s at service boundary with 422 TARGET_NOT_RATABLE',
      async (badTarget) => {
        const { database, txCalls } = createMockDb(() => []);
        const quality = new SharedContentQualityService(database);
        const service = new FeedbackService(database, quality);

        await expectContractError(
          service.submitRating(USER_A, {
            target_type: badTarget,
            target_id: TARGET_ID,
            score: 4,
          }),
          422,
          'TARGET_NOT_RATABLE',
        );
        expect(txCalls).toHaveLength(0);
      },
    );
  });

  describe('EP-F02 submitReport — R34 prior-exposure (including hidden items), R27 advisory lock & 409 duplicate', () => {
    it.each([
      ['roadmap_content', 'FROM public.roadmaps r'],
      ['topic_content', 'FROM public.topics t'],
      ['quiz_question', 'FROM public.quiz_questions qq'],
      ['practice_review', 'FROM public.practice_reviews pr'],
    ] as const)(
      'accepts exposed/owned %s report with foreground=true and returns 201 { report_id, status: "received" }',
      async (targetType, expectedSqlFragment) => {
        const { database, txCalls } = createMockDb((sql) => {
          if (sql.includes(expectedSqlFragment)) {
            return [{ id: TARGET_ID }];
          }
          if (sql.includes('pg_advisory_xact_lock(hashtextextended')) {
            return [{ pg_advisory_xact_lock: '' }];
          }
          if (sql.includes('UPDATE public.system_configurations')) {
            return [];
          }
          if (sql.includes('INSERT INTO public.content_reports')) {
            return [{ id: REPORT_ID }];
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        });

        const quality = new SharedContentQualityService(database);
        const service = new FeedbackService(database, quality);

        const res = await service.submitReport(USER_A, {
          target_type: targetType,
          target_id: TARGET_ID,
          reason: 'incorrect',
          comment: 'Needs correction',
        });

        expect(res).toEqual({
          report_id: REPORT_ID,
          status: 'received',
        });
        expect(txCalls).toEqual([
          {
            userId: USER_A,
            active: true,
            foreground: true,
            useServiceRole: true,
          },
        ]);
      },
    );

    it('rejects roadmap_versions.id when submitted to roadmap_content (requires roadmaps.id per R34)', async () => {
      const roadmapsTable = new Map([[ROADMAP_ID, { user_id: USER_A }]]);

      const { database } = createMockDb((sql, params) => {
        if (sql.includes('FROM public.roadmaps r')) {
          const [uId, rId] = params as [string, string];
          const row = roadmapsTable.get(rId);
          return row && row.user_id === uId ? [{ id: rId }] : [];
        }
        if (sql.includes('pg_advisory_xact_lock')) return [{}];
        if (sql.includes('INSERT INTO public.content_reports')) {
          return [{ id: REPORT_ID }];
        }
        return [];
      });

      const quality = new SharedContentQualityService(database);
      const service = new FeedbackService(database, quality);

      // Passing VERSION_ID to roadmap_content -> 404 TARGET_NOT_FOUND
      await expectContractError(
        service.submitReport(USER_A, {
          target_type: 'roadmap_content',
          target_id: VERSION_ID,
          reason: 'unclear',
        }),
        404,
        'TARGET_NOT_FOUND',
      );

      // Passing ROADMAP_ID to roadmap_content -> 201 received
      const ok = await service.submitReport(USER_A, {
        target_type: 'roadmap_content',
        target_id: ROADMAP_ID,
        reason: 'unclear',
      });
      expect(ok.status).toBe('received');
    });

    it('allows reporting hidden topic_content and hidden quiz_question when caller has prior exposure, while rejecting unexposed callers (R34)', async () => {
      const hiddenTopicId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      const hiddenQuestionId = '99999999-9999-4999-8999-999999999999';

      // Simulate DB rows where both shared items are already hidden, exposed to USER_A only
      const exposedTopicsByUser = new Map<string, Set<string>>([
        [USER_A, new Set([hiddenTopicId])],
      ]);
      const exposedQuestionsByUser = new Map<string, Set<string>>([
        [USER_A, new Set([hiddenQuestionId])],
      ]);

      const { database } = createMockDb((sql, params) => {
        if (sql.includes('FROM public.topics t')) {
          // Must NOT require t.status = 'approved' on EP-F02!
          expect(sql).not.toContain(
            "t.status = 'approved'::public.content_status",
          );
          expect(sql).toContain("t.status <> 'draft'::public.content_status");
          // Verify caller-ownership bindings across roadmap_items, daily_plan_items, and quiz_attempts
          const bindsCallerExposure =
            sql.includes('ri.user_id = $1') &&
            sql.includes('dpi.user_id = $1') &&
            sql.includes('qa.user_id = $1');
          expect(bindsCallerExposure).toBe(true);
          if (!bindsCallerExposure) {
            return [];
          }
          const [uId, tId] = params as [string, string];
          return exposedTopicsByUser.get(uId)?.has(tId) ? [{ id: tId }] : [];
        }
        if (sql.includes('FROM public.quiz_questions qq')) {
          // Must NOT filter out hidden_at IS NOT NULL on EP-F02!
          expect(sql).not.toContain('hidden_at IS NULL');
          expect(sql).toContain('qq.id = ANY(qa.question_ids)');
          const bindsCallerAttempt = sql.includes('qa.user_id = $1');
          expect(bindsCallerAttempt).toBe(true);
          if (!bindsCallerAttempt) {
            return [];
          }
          const [uId, qId] = params as [string, string];
          return exposedQuestionsByUser.get(uId)?.has(qId) ? [{ id: qId }] : [];
        }
        if (sql.includes('pg_advisory_xact_lock')) return [{}];
        if (sql.includes('INSERT INTO public.content_reports')) {
          return [{ id: REPORT_ID }];
        }
        return [];
      });

      const quality = new SharedContentQualityService(database);
      const service = new FeedbackService(database, quality);

      // Prior-exposed USER_A succeeds on both hidden topic_content and hidden quiz_question
      await expect(
        service.submitReport(USER_A, {
          target_type: 'topic_content',
          target_id: hiddenTopicId,
          reason: 'outdated',
        }),
      ).resolves.toEqual({ report_id: REPORT_ID, status: 'received' });

      await expect(
        service.submitReport(USER_A, {
          target_type: 'quiz_question',
          target_id: hiddenQuestionId,
          reason: 'incorrect',
        }),
      ).resolves.toEqual({ report_id: REPORT_ID, status: 'received' });

      // Unexposed USER_B gets 404 TARGET_NOT_FOUND on both hidden items
      await expectContractError(
        service.submitReport(USER_B, {
          target_type: 'topic_content',
          target_id: hiddenTopicId,
          reason: 'outdated',
        }),
        404,
        'TARGET_NOT_FOUND',
      );

      await expectContractError(
        service.submitReport(USER_B, {
          target_type: 'quiz_question',
          target_id: hiddenQuestionId,
          reason: 'incorrect',
        }),
        404,
        'TARGET_NOT_FOUND',
      );
    });

    it('maps PostgreSQL 23505 unique violation on uq_content_reports_user_target to 409 REPORT_ALREADY_SUBMITTED', async () => {
      const { database } = createMockDb((sql) => {
        if (sql.includes('FROM public.practice_reviews pr')) {
          return [{ id: TARGET_ID }];
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return [{}];
        }
        if (sql.includes('INSERT INTO public.content_reports')) {
          const pgErr = Object.assign(
            new Error(
              'duplicate key value violates unique constraint "uq_content_reports_user_target"',
            ),
            { driverError: { code: '23505' } },
          );
          throw pgErr;
        }
        return [];
      });

      const quality = new SharedContentQualityService(database);
      const service = new FeedbackService(database, quality);

      await expectContractError(
        service.submitReport(USER_A, {
          target_type: 'practice_review',
          target_id: TARGET_ID,
          reason: 'unfair_scoring',
        }),
        409,
        'REPORT_ALREADY_SUBMITTED',
      );
    });
  });

  describe('R27 READ COMMITTED lock-before-insert protocol & threshold race simulations', () => {
    it("executes SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0)) as a separate preceding statement BEFORE INSERT INTO public.content_reports", async () => {
      const { database, executedStatements } = createMockDb((sql) => {
        if (sql.includes('FROM public.quiz_questions qq')) {
          return [{ id: TARGET_ID }];
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return [{}];
        }
        if (sql.includes('INSERT INTO public.content_reports')) {
          return [{ id: REPORT_ID }];
        }
        return [];
      });

      const quality = new SharedContentQualityService(database);
      const service = new FeedbackService(database, quality);

      await service.submitReport(USER_A, {
        target_type: 'quiz_question',
        target_id: TARGET_ID,
        reason: 'incorrect',
      });

      const lockIndex = executedStatements.findIndex((s) =>
        s.sql.includes(
          "SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))",
        ),
      );
      const insertIndex = executedStatements.findIndex((s) =>
        s.sql.includes('INSERT INTO public.content_reports'),
      );

      expect(lockIndex).toBeGreaterThanOrEqual(0);
      expect(insertIndex).toBeGreaterThan(lockIndex);
      expect(executedStatements[lockIndex]?.params).toEqual([
        'quiz_question',
        TARGET_ID,
      ]);
    });

    it.each([
      ['canonical integer 2', '2', 'topic_content', 'FROM public.topics t'],
      [
        'non-canonical whole-number 2.0 on shared topic_content',
        '2.0',
        'topic_content',
        'FROM public.topics t',
      ],
      [
        'non-canonical whole-number 2.0 on private practice_review',
        '2.0',
        'practice_review',
        'FROM public.practice_reviews pr',
      ],
    ] as const)(
      'normalizes %s threshold JSONB before INSERT so frozen trigger ::integer cast never fails',
      async (_label, initialRawJsonText, targetType, exposureSqlFragment) => {
        let storedConfigText: string = initialRawJsonText;
        let normalizedRowsUpdated = 0;

        const { database, executedStatements } = createMockDb((sql) => {
          if (sql.includes(exposureSqlFragment)) {
            return [{ id: TARGET_ID }];
          }
          if (sql.includes('pg_advisory_xact_lock')) {
            return [{}];
          }
          if (sql.includes('UPDATE public.system_configurations')) {
            expect(sql).toContain(
              "config_key = 'quality.report_auto_hide_threshold'",
            );
            expect(sql).toContain(
              "to_jsonb((config_value #>> '{}')::numeric::integer)",
            );
            if (
              /^[0-9]+\.[0-9]+$/.test(storedConfigText) &&
              Number(storedConfigText) === Math.trunc(Number(storedConfigText))
            ) {
              storedConfigText = String(Math.trunc(Number(storedConfigText)));
              normalizedRowsUpdated += 1;
            }
            return [];
          }
          if (sql.includes('INSERT INTO public.content_reports')) {
            // Simulate frozen trigger 020_gaps_and_alignment.sql strict (config_value #>> '{}')::integer cast
            if (!/^[0-9]+$/.test(storedConfigText)) {
              throw new Error(
                `invalid input syntax for type integer: "${storedConfigText}"`,
              );
            }
            return [{ id: REPORT_ID }];
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        });

        const service = new FeedbackService(
          database,
          new SharedContentQualityService(database),
        );

        const res = await service.submitReport(USER_A, {
          target_type: targetType,
          target_id: TARGET_ID,
          reason: 'incorrect',
        });

        expect(res).toEqual({ report_id: REPORT_ID, status: 'received' });
        expect(storedConfigText).toBe('2');
        expect(normalizedRowsUpdated).toBe(
          initialRawJsonText.includes('.') ? 1 : 0,
        );

        const normalizeIndex = executedStatements.findIndex((s) =>
          s.sql.includes('UPDATE public.system_configurations'),
        );
        const insertIndex = executedStatements.findIndex((s) =>
          s.sql.includes('INSERT INTO public.content_reports'),
        );
        expect(normalizeIndex).toBeGreaterThanOrEqual(0);
        expect(insertIndex).toBeGreaterThan(normalizeIndex);
      },
    );

    it('serializes two concurrent sessions at non-default threshold=2, blocks duplicate-user double-counting, and ignores rolled-back inserts', async () => {
      // Simulated PostgreSQL state with advisory xact lock mutex + READ COMMITTED snapshot + trigger
      let configuredThreshold = 2;
      let sharedTopicHidden = false;
      const committedReports: Array<{
        userId: string;
        targetType: string;
        targetId: string;
      }> = [];

      let lockChain = Promise.resolve();
      let failUserCommit: string | null = null;

      const createSessionDb = (): DatabaseService => {
        const db: Pick<DatabaseService, 'query' | 'transaction'> = {
          query: vi.fn(async () => []) as unknown as DatabaseService['query'],
          transaction: vi.fn(
            async <T>(
              userId: string | null,
              operation: (tx: never) => Promise<T>,
            ): Promise<T> => {
              let releaseTargetLock: (() => void) | null = null;
              const stagedReports: Array<{
                userId: string;
                targetType: string;
                targetId: string;
              }> = [];
              let stagedHidden = sharedTopicHidden;

              const tx = {
                query: async (sql: string, params?: unknown[]) => {
                  if (sql.includes('FROM public.system_configurations')) {
                    return [{ config_value: configuredThreshold }];
                  }
                  if (sql.includes('FROM public.topics t')) {
                    return [{ id: TARGET_ID }];
                  }
                  if (
                    sql.includes(
                      "SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))",
                    )
                  ) {
                    const prev = lockChain;
                    let unlock!: () => void;
                    lockChain = new Promise<void>((resolve) => {
                      unlock = resolve;
                    });
                    await prev;
                    releaseTargetLock = unlock;
                    return [{}];
                  }
                  if (sql.includes('INSERT INTO public.content_reports')) {
                    // Enforce R27 invariant: target lock MUST already be held by this transaction!
                    expect(releaseTargetLock).not.toBeNull();
                    const [uId, tType, tId] = params as [
                      string,
                      string,
                      string,
                    ];
                    const alreadyExists = [
                      ...committedReports,
                      ...stagedReports,
                    ].some(
                      (r) =>
                        r.userId === uId &&
                        r.targetType === tType &&
                        r.targetId === tId,
                    );
                    if (alreadyExists) {
                      throw Object.assign(new Error('duplicate report'), {
                        code: '23505',
                      });
                    }
                    stagedReports.push({
                      userId: uId,
                      targetType: tType,
                      targetId: tId,
                    });

                    // Simulate trg_content_reports_threshold AFTER INSERT under post-lock READ COMMITTED snapshot
                    const distinctUsers = new Set(
                      [...committedReports, ...stagedReports]
                        .filter(
                          (r) => r.targetType === tType && r.targetId === tId,
                        )
                        .map((r) => r.userId),
                    );
                    if (distinctUsers.size >= configuredThreshold) {
                      stagedHidden = true;
                    }

                    if (failUserCommit === uId) {
                      throw new Error('Simulated mid-transaction failure');
                    }
                    return [
                      { id: `${REPORT_ID.slice(0, -1)}${distinctUsers.size}` },
                    ];
                  }
                  return [];
                },
              };

              try {
                const out = await operation(tx as never);
                committedReports.push(...stagedReports);
                sharedTopicHidden = stagedHidden;
                return out;
              } finally {
                if (releaseTargetLock) {
                  (releaseTargetLock as () => void)();
                }
              }
            },
          ) as unknown as DatabaseService['transaction'],
        };
        return db as DatabaseService;
      };

      const dbSession1 = createSessionDb();
      const dbSession2 = createSessionDb();
      const service1 = new FeedbackService(
        dbSession1,
        new SharedContentQualityService(dbSession1),
      );
      const service2 = new FeedbackService(
        dbSession2,
        new SharedContentQualityService(dbSession2),
      );

      // 1. User A submits report #1 (threshold = 2 -> not hidden yet)
      await service1.submitReport(USER_A, {
        target_type: 'topic_content',
        target_id: TARGET_ID,
        reason: 'incorrect',
      });
      expect(sharedTopicHidden).toBe(false);

      // 2. Same User A tries again -> 409 REPORT_ALREADY_SUBMITTED, single user never hides shared content
      await expectContractError(
        service1.submitReport(USER_A, {
          target_type: 'topic_content',
          target_id: TARGET_ID,
          reason: 'outdated',
        }),
        409,
        'REPORT_ALREADY_SUBMITTED',
      );
      expect(sharedTopicHidden).toBe(false);

      // 3. User B submits report #2, but transaction rolls back -> topic MUST NOT stay hidden!
      failUserCommit = USER_B;
      await expect(
        service2.submitReport(USER_B, {
          target_type: 'topic_content',
          target_id: TARGET_ID,
          reason: 'incorrect',
        }),
      ).rejects.toThrow('Simulated mid-transaction failure');
      expect(sharedTopicHidden).toBe(false);
      expect(committedReports).toHaveLength(1);

      // 4. Reset state and run User A + User B concurrently across two sessions at threshold = 2
      committedReports.length = 0;
      configuredThreshold = 2;
      failUserCommit = null;

      const [resA, resB] = await Promise.all([
        service1.submitReport(USER_A, {
          target_type: 'topic_content',
          target_id: TARGET_ID,
          reason: 'incorrect',
        }),
        service2.submitReport(USER_B, {
          target_type: 'topic_content',
          target_id: TARGET_ID,
          reason: 'unclear',
        }),
      ]);

      expect(resA.status).toBe('received');
      expect(resB.status).toBe('received');
      // Client response never leaks hidden status or threshold
      expect(resB).not.toHaveProperty('hidden');
      expect(resB).not.toHaveProperty('threshold');
      expect(sharedTopicHidden).toBe(true);
    });
  });

  describe('SharedContentQualityService — R26 bounds (2..1000), <=5s TTL cache & R11 privacy', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-24T12:00:00.000Z'));
    });

    it('accepts valid integer bounds 2..1000 and caches for <= 5_000ms before refreshing', async () => {
      let currentDbValue: unknown = 2;
      let queryCount = 0;
      const { database } = createMockDb((sql) => {
        if (sql.includes('FROM public.system_configurations')) {
          queryCount += 1;
          return [{ config_value: currentDbValue }];
        }
        return [];
      });

      // Even if caller passes >5000ms, constructor clamps TTL to 5_000ms (R26)
      const service = new SharedContentQualityService(database, 10_000);
      expect(service.cacheTtlMs).toBe(5_000);

      expect(await service.getReportAutoHideThreshold()).toBe(2);
      expect(queryCount).toBe(1);

      currentDbValue = 1_000;
      // Within 5s TTL -> returns cached 2 without querying DB
      vi.advanceTimersByTime(4_999);
      expect(await service.getReportAutoHideThreshold()).toBe(2);
      expect(queryCount).toBe(1);

      // Past 5s TTL -> refreshes from DB and reads 1000
      vi.advanceTimersByTime(2);
      expect(await service.getReportAutoHideThreshold()).toBe(1_000);
      expect(queryCount).toBe(2);

      // Explicit invalidateCache() forces immediate reload
      currentDbValue = 7;
      service.invalidateCache();
      expect(await service.getReportAutoHideThreshold()).toBe(7);
      expect(queryCount).toBe(3);
      expect(await service.hasReachedAutoHideThreshold(6)).toBe(false);
      expect(await service.hasReachedAutoHideThreshold(7)).toBe(true);
    });

    it('measures cache expiry using monotonic elapsed time so backward wall-clock jumps cannot extend R26 5s TTL', async () => {
      let currentDbValue = 2;
      let queryCount = 0;
      let monotonicMs = 1_000;
      let wallClockMs = Date.parse('2026-11-24T12:00:00.000Z');

      vi.spyOn(performance, 'now').mockImplementation(() => monotonicMs);
      vi.spyOn(Date, 'now').mockImplementation(() => wallClockMs);

      const { database } = createMockDb((sql) => {
        if (sql.includes('FROM public.system_configurations')) {
          queryCount += 1;
          return [{ config_value: currentDbValue }];
        }
        return [];
      });

      const service = new SharedContentQualityService(database);
      expect(await service.getReportAutoHideThreshold()).toBe(2);
      expect(queryCount).toBe(1);

      // Wall-clock jumps backwards by 10 seconds while 6 seconds of monotonic time elapse
      currentDbValue = 8;
      wallClockMs -= 10_000;
      monotonicMs += 6_000;

      // Monotonic clock detects expiry immediately despite backward Date.now() jump
      expect(await service.getReportAutoHideThreshold()).toBe(8);
      expect(queryCount).toBe(2);
    });

    it('bypasses shared cache lookup and write when caller passes a transactional executor', async () => {
      let committedValue = 5;
      const { database } = createMockDb(() => [
        { config_value: committedValue },
      ]);
      const service = new SharedContentQualityService(database);

      // Warm standalone cache with committed value 5
      expect(await service.getReportAutoHideThreshold()).toBe(5);

      // Transaction observes uncommitted value 2 without reading warm cache or polluting it
      const txQuerySpy = vi.fn(async () => [{ config_value: 2 }]);
      const txExecutor = {
        query: async <T = unknown>(): Promise<T> =>
          (await txQuerySpy()) as unknown as T,
      };
      expect(await service.getReportAutoHideThreshold(txExecutor)).toBe(2);
      expect(txQuerySpy).toHaveBeenCalledTimes(1);

      // Standalone read still sees committed cached 5
      expect(await service.getReportAutoHideThreshold()).toBe(5);

      // On cold cache, transactional read of 3 MUST NOT populate shared cache
      service.invalidateCache();
      committedValue = 9;
      const txExecutor2 = {
        query: async <T = unknown>(): Promise<T> =>
          [{ config_value: 3 }] as unknown as T,
      };
      expect(await service.getReportAutoHideThreshold(txExecutor2)).toBe(3);
      expect(await service.getReportAutoHideThreshold()).toBe(9);
    });

    it('prevents an older in-flight refresh from overwriting cache after invalidateCache()', async () => {
      let resolveStaleRead!: (rows: Array<{ config_value: unknown }>) => void;
      let callNo = 0;
      const database = {
        transaction: vi.fn(
          async (
            _userId: string | null,
            operation: (db: {
              query: () => Promise<Array<{ config_value: unknown }>>;
            }) => Promise<unknown>,
          ) => {
            callNo += 1;
            const currentCall = callNo;
            return operation({
              query: async () => {
                if (currentCall === 1) {
                  return new Promise((resolve) => {
                    resolveStaleRead = resolve;
                  });
                }
                return [{ config_value: 7 }];
              },
            });
          },
        ),
      } as unknown as DatabaseService;

      const service = new SharedContentQualityService(database);

      // Start read #1 (will observe stale value 2)
      const stalePromise = service.getReportAutoHideThreshold();
      // Invalidate cache while read #1 is still pending, then complete fresh read #2 (= 7)
      service.invalidateCache();
      expect(await service.getReportAutoHideThreshold()).toBe(7);

      // Stale read #1 resolves with 2 -> returns 2 to its own caller, but MUST NOT overwrite cached 7
      resolveStaleRead([{ config_value: 2 }]);
      expect(await stalePromise).toBe(2);
      expect(await service.getReportAutoHideThreshold()).toBe(7);
    });

    it('deduplicates concurrent standalone misses per generation and propagates SQL errors on caller-owned transactions', async () => {
      let queryCalls = 0;
      let resolveConcurrent!: (rows: Array<{ config_value: unknown }>) => void;
      const database = {
        transaction: vi.fn(
          async (
            _userId: string | null,
            operation: (db: {
              query: () => Promise<Array<{ config_value: unknown }>>;
            }) => Promise<unknown>,
          ) => {
            queryCalls += 1;
            return operation({
              query: async () =>
                new Promise((resolve) => {
                  resolveConcurrent = resolve;
                }),
            });
          },
        ),
      } as unknown as DatabaseService;

      const service = new SharedContentQualityService(database);
      const p1 = service.getReportAutoHideThreshold();
      const p2 = service.getReportAutoHideThreshold();
      expect(queryCalls).toBe(1);
      resolveConcurrent([{ config_value: 6 }]);
      expect(await Promise.all([p1, p2])).toEqual([6, 6]);

      // Caller-owned transaction SQL failure MUST propagate rather than returning fallback 5
      const failingTx = {
        query: async <T = unknown>(): Promise<T> => {
          throw new Error('PG_TX_ABORTED');
        },
      };
      await expect(
        service.getReportAutoHideThreshold(failingTx),
      ).rejects.toThrow('PG_TX_ABORTED');
    });

    it('maps ON CONFLICT DO NOTHING empty RETURNING on duplicate report to 409 REPORT_ALREADY_SUBMITTED without throwing a DB error', async () => {
      const { database } = createMockDb((sql) => {
        if (sql.includes('FROM public.topics t')) return [{ id: TARGET_ID }];
        if (sql.includes('pg_advisory_xact_lock')) return [{}];
        if (sql.includes('INSERT INTO public.content_reports')) {
          expect(sql).toContain(
            'ON CONFLICT (user_id, target_type, target_id) DO NOTHING',
          );
          return [];
        }
        return [];
      });
      const service = new FeedbackService(
        database,
        new SharedContentQualityService(database),
      );
      await expectContractError(
        service.submitReport(USER_A, {
          target_type: 'topic_content',
          target_id: TARGET_ID,
          reason: 'incorrect',
          comment: 'PRIVATE_DUP_COMMENT',
        }),
        409,
        'REPORT_ALREADY_SUBMITTED',
      );
    });

    it.each([1, 0, -5, 1_001, 4.5, '5', null, true, {}, undefined])(
      'falls back to safe default 5 when system_configurations value is invalid (%p)',
      async (invalidValue) => {
        const { database } = createMockDb(() =>
          invalidValue === undefined ? [] : [{ config_value: invalidValue }],
        );
        const service = new SharedContentQualityService(database);
        expect(await service.getReportAutoHideThreshold()).toBe(
          DEFAULT_REPORT_AUTO_HIDE_THRESHOLD,
        );
      },
    );

    it('never logs raw comment text or threshold values in operational logs (R11)', async () => {
      const logSpy = vi
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      const { database } = createMockDb((sql) => {
        if (sql.includes('FROM public.topics t')) return [{ id: TARGET_ID }];
        if (sql.includes('INSERT INTO public.user_ratings')) {
          return [
            { target_type: 'topic_content', target_id: TARGET_ID, score: 4 },
          ];
        }
        if (sql.includes('pg_advisory_xact_lock')) return [{}];
        if (sql.includes('INSERT INTO public.content_reports')) {
          return [{ id: REPORT_ID }];
        }
        return [];
      });

      const quality = new SharedContentQualityService(database);
      const service = new FeedbackService(database, quality);

      const secretRatingComment = 'PRIVATE_LEARNER_RATING_NOTE_XYZ';
      const secretReportComment = 'PRIVATE_LEARNER_ANSWER_SNIPPET_ABC';

      await service.submitRating(USER_A, {
        target_type: 'topic_content',
        target_id: TARGET_ID,
        score: 4,
        comment: secretRatingComment,
      });

      await service.submitReport(USER_A, {
        target_type: 'topic_content',
        target_id: TARGET_ID,
        reason: 'unclear',
        comment: secretReportComment,
      });

      expect(logSpy).toHaveBeenCalledTimes(2);
      const serializedLogs = logSpy.mock.calls
        .map((c) => String(c[0]))
        .join('\n');
      expect(serializedLogs).not.toContain(secretRatingComment);
      expect(serializedLogs).not.toContain(secretReportComment);
      expect(serializedLogs).not.toContain('threshold');
    });
  });
});

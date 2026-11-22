import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import type { JobProducerService } from '../jobs/services/job-producer.service.js';
import { TodayService } from './services/today.service.js';
import { TopicContentService } from './services/topic-content.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROADMAP_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const ITEM_ID = '55555555-5555-4555-8555-555555555555';
const LINEAGE_ID = '66666666-6666-4666-8666-666666666666';
const TOPIC_ID = '77777777-7777-4777-8777-777777777777';
const APPROVED_TOPIC_ID = '77777777-7777-4777-8777-777777777778';
const SKILL_ID = '88888888-8888-4888-8888-888888888888';
const JOB_ID = '99999999-9999-4999-8999-999999999999';

function expectContractError(
  error: unknown,
  status: number,
  code: string,
): void {
  expect(error).toBeInstanceOf(HttpException);
  const httpErr = error as HttpException;
  expect(httpErr.getStatus()).toBe(status);
  const body = httpErr.getResponse() as { code?: string };
  expect(body.code).toBe(code);
}

describe('TodayService (EP-L04 — all 5 today_status states, feature gate & R24)', () => {
  let queryMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;
  let databaseMock: DatabaseService;
  let topicContentService: TopicContentService;
  let jobProducerMock: { enqueue: ReturnType<typeof vi.fn> };
  let service: TodayService;

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock = vi.fn();
    transactionMock = vi.fn(
      async (
        _userId: string,
        op: (db: { query: typeof queryMock }) => Promise<unknown>,
      ) => op({ query: queryMock }),
    );
    databaseMock = {
      query: queryMock,
      transaction: transactionMock,
    } as unknown as DatabaseService;
    topicContentService = new TopicContentService(databaseMock);
    jobProducerMock = {
      enqueue: vi.fn().mockResolvedValue({
        job_id: JOB_ID,
        kind: 'topic_content',
        status: 'queued',
        poll_url: `/api/v1/jobs/${JOB_ID}`,
        retry_after_seconds: 3,
      }),
    };
    service = new TodayService(
      databaseMock,
      topicContentService,
      jobProducerMock as unknown as JobProducerService,
    );
  });

  it('returns status=no_focus_roadmap with foreground=false when user has no Focus Roadmap', async () => {
    queryMock.mockResolvedValueOnce([]);
    const res = await service.getToday(USER_ID);
    expect(transactionMock).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Function),
      true,
      false,
    );
    expect(res.status).toBe('no_focus_roadmap');
    expect(res.roadmap_id).toBeNull();
    expect(res.plan_id).toBeNull();
    expect(res.topic).toBeNull();
  });

  it('returns status=no_daily_plan with preferred_daily_hours hint and requires_learning_hours flag', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.roadmaps')) {
        return [{ id: ROADMAP_ID, current_version_id: VERSION_ID }];
      }
      if (sql.includes('FROM public.daily_plans')) {
        return [];
      }
      if (sql.includes('FROM public.user_profiles')) {
        return [{ preferred_daily_hours: '2.5' }];
      }
      return [];
    });

    const withHours = await service.getToday(USER_ID);
    expect(withHours.status).toBe('no_daily_plan');
    expect(withHours.roadmap_id).toBe(ROADMAP_ID);
    expect(withHours.requires_learning_hours).toBe(false);
    expect(withHours.preferred_daily_hours).toBe(2.5);

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.roadmaps')) {
        return [{ id: ROADMAP_ID, current_version_id: VERSION_ID }];
      }
      if (sql.includes('FROM public.daily_plans')) {
        return [];
      }
      if (sql.includes('FROM public.user_profiles')) {
        return [{ preferred_daily_hours: null }];
      }
      return [];
    });

    const missingHours = await service.getToday(USER_ID);
    expect(missingHours.status).toBe('no_daily_plan');
    expect(missingHours.requires_learning_hours).toBe(true);
    expect(missingHours.preferred_daily_hours).toBeNull();
  });

  it('returns status=plan_completed when all daily_plan_items are completed', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.roadmaps')) {
        return [{ id: ROADMAP_ID, current_version_id: VERSION_ID }];
      }
      if (sql.includes('FROM public.daily_plans')) {
        return [
          {
            id: PLAN_ID,
            hours_per_day: '2.0',
            roadmap_version_id: VERSION_ID,
          },
        ];
      }
      if (sql.includes('COUNT(DISTINCT day_no)')) {
        return [{ total_days: 10 }];
      }
      if (sql.includes('FROM public.daily_plan_items dpi')) {
        return [];
      }
      return [];
    });

    const res = await service.getToday(USER_ID);
    expect(res.status).toBe('plan_completed');
    expect(res.plan_id).toBe(PLAN_ID);
    expect(res.topic).toBeNull();
  });

  it('returns status=ready from canonical approved topic even when daily_plan feature is OFF and never leaks provider_key/model_id', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.roadmaps')) {
        return [{ id: ROADMAP_ID, current_version_id: VERSION_ID }];
      }
      if (sql.includes('FROM public.daily_plans')) {
        return [
          {
            id: PLAN_ID,
            hours_per_day: '2.0',
            roadmap_version_id: VERSION_ID,
          },
        ];
      }
      if (sql.includes('COUNT(DISTINCT day_no)')) {
        return [{ total_days: 12 }];
      }
      if (sql.includes('FROM public.daily_plan_items dpi')) {
        // Sequential next incomplete day (Day 4, never skipped even if calendar days passed)
        expect(sql).toContain('ORDER BY dpi.day_no ASC, dpi.sort_order ASC');
        return [
          {
            id: ITEM_ID,
            day_no: 4,
            sort_order: 1,
            lineage_id: LINEAGE_ID,
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            topic_status: 'hidden',
            required_depth: 'application',
            learning_state: 'learning',
          },
        ];
      }
      if (sql.includes('FROM public.quiz_attempts')) {
        return [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            attempt_no: 1,
            status: 'started',
          },
        ];
      }
      if (
        sql.includes('FROM public.topics') &&
        sql.includes("status = 'approved'")
      ) {
        return [
          {
            id: APPROVED_TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 2,
            status: 'approved',
            explanation_markdown: '# SQL Joins\n\nInner vs Left join.',
            important_questions: [
              {
                question: 'Why LEFT JOIN?',
                answer_markdown: 'Preserves unmatched rows.',
              },
            ],
            language: 'mixed',
            approved_at: '2026-11-21T00:00:00.000Z',
          },
        ];
      }
      if (sql.includes('FROM public.learning_resources')) {
        return [
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            title: 'PostgreSQL Joins',
            publisher: 'PostgreSQL Docs',
            url: 'https://www.postgresql.org/docs/current/tutorial-join.html',
            resource_type: 'official_docs',
            retrieved_at: '2026-11-21T00:00:00.000Z',
          },
        ];
      }
      if (sql.includes('FROM public.content_reports')) {
        return [];
      }
      return [];
    });

    const res = await service.getToday(USER_ID);
    expect(res.status).toBe('ready');
    expect(res.plan_day).toEqual({ day_no: 4, total_days: 12 });
    expect(res.topic?.topic_id).toBe(APPROVED_TOPIC_ID);
    expect(res.topic?.content_version).toBe(2);
    expect(res.topic?.sources).toHaveLength(1);
    expect(res.topic?.rating_allowed).toBe(true);
    expect(res.topic?.report_allowed).toBe(true);
    expect(res.quiz).toEqual({
      attempt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'started',
      can_retry: false,
    });
    expect(jobProducerMock.enqueue).not.toHaveBeenCalled();
    // Never checked feature gate because existing approved content was served!
    expect(
      queryMock.mock.calls.some(([sql]) =>
        String(sql).includes('effective_feature_access'),
      ),
    ).toBe(false);
    // Zero internal provenance leaked
    expect(JSON.stringify(res)).not.toContain('provider_key');
    expect(JSON.stringify(res)).not.toContain('model_id');
  });

  it('reuses existing user-owned active topic_content job, enqueues when daily_plan ON, and throws 403 FEATURE_DISABLED when daily_plan OFF', async () => {
    const baseNextItem = {
      id: ITEM_ID,
      day_no: 1,
      sort_order: 1,
      lineage_id: LINEAGE_ID,
      topic_id: TOPIC_ID,
      skill_id: SKILL_ID,
      slug: 'sql-joins',
      title: 'SQL Joins',
      career_level: 'mid',
      content_version: 1,
      topic_status: 'draft',
      required_depth: 'application',
      learning_state: 'not_started',
    };

    // Case A: tenant-owned active job already queued -> acquires advisory lock before lookup and reuses without enqueue
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM public.roadmaps'))
        return [{ id: ROADMAP_ID, current_version_id: VERSION_ID }];
      if (sql.includes('FROM public.daily_plans'))
        return [
          { id: PLAN_ID, hours_per_day: '2.0', roadmap_version_id: VERSION_ID },
        ];
      if (sql.includes('COUNT(DISTINCT day_no)')) return [{ total_days: 5 }];
      if (sql.includes('FROM public.daily_plan_items dpi'))
        return [baseNextItem];
      if (sql.includes('FROM public.quiz_attempts')) return [];
      if (sql.includes('FROM public.topics')) return [];
      if (sql.includes('pg_advisory_xact_lock')) {
        expect(params).toEqual([`today-topic:${USER_ID}:${TOPIC_ID}`]);
        return [];
      }
      if (sql.includes('FROM public.ai_requests')) {
        expect(sql).toContain('WHERE user_id = $1');
        return [{ id: JOB_ID, status: 'preparing' }];
      }
      return [];
    });

    const reused = await service.getToday(USER_ID);
    const lockIdxA = queryMock.mock.calls.findIndex(([sql]) =>
      String(sql).includes('pg_advisory_xact_lock'),
    );
    const aiReqIdxA = queryMock.mock.calls.findIndex(([sql]) =>
      String(sql).includes('FROM public.ai_requests'),
    );
    expect(lockIdxA).toBeGreaterThan(-1);
    expect(aiReqIdxA).toBeGreaterThan(lockIdxA);
    expect(reused.status).toBe('preparing');
    expect(reused.job?.job_id).toBe(JOB_ID);
    expect(reused.job?.status).toBe('preparing');
    expect(jobProducerMock.enqueue).not.toHaveBeenCalled();

    // Case B: missing content + daily_plan OFF -> 403 FEATURE_DISABLED (never enqueue)
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.roadmaps'))
        return [{ id: ROADMAP_ID, current_version_id: VERSION_ID }];
      if (sql.includes('FROM public.daily_plans'))
        return [
          { id: PLAN_ID, hours_per_day: '2.0', roadmap_version_id: VERSION_ID },
        ];
      if (sql.includes('COUNT(DISTINCT day_no)')) return [{ total_days: 5 }];
      if (sql.includes('FROM public.daily_plan_items dpi'))
        return [baseNextItem];
      if (sql.includes('FROM public.quiz_attempts')) return [];
      if (sql.includes('FROM public.topics')) return [];
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('FROM public.ai_requests')) return [];
      if (sql.includes('effective_feature_access')) return [{ allowed: false }];
      return [];
    });

    await expect(service.getToday(USER_ID)).rejects.toSatisfy((err) => {
      expectContractError(err, 403, 'FEATURE_DISABLED');
      return true;
    });
    expect(jobProducerMock.enqueue).not.toHaveBeenCalled();

    // Case C: missing content + daily_plan ON -> acquires advisory lock and enqueues topic_content job with canonical content_version expected_refs only
    queryMock.mockClear();
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.roadmaps'))
        return [{ id: ROADMAP_ID, current_version_id: VERSION_ID }];
      if (sql.includes('FROM public.daily_plans'))
        return [
          { id: PLAN_ID, hours_per_day: '2.0', roadmap_version_id: VERSION_ID },
        ];
      if (sql.includes('COUNT(DISTINCT day_no)')) return [{ total_days: 5 }];
      if (sql.includes('FROM public.daily_plan_items dpi'))
        return [baseNextItem];
      if (sql.includes('FROM public.quiz_attempts')) return [];
      if (sql.includes('FROM public.topics')) return [];
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('FROM public.ai_requests')) return [];
      if (sql.includes('effective_feature_access')) return [{ allowed: true }];
      throw new Error(`Unexpected SQL in TodayService Case C: ${sql}`);
    });

    const enqueued = await service.getToday(USER_ID, {
      acceptLanguage: 'bn,en;q=0.8',
    });
    expect(enqueued.status).toBe('preparing');
    expect(enqueued.job?.job_id).toBe(JOB_ID);
    expect(jobProducerMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        kind: 'topic_content',
        subjectType: 'topic',
        subjectId: TOPIC_ID,
        language: 'mixed',
        envelope: {
          v: 1,
          args: {
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            career_level: 'mid',
            content_version: 1,
          },
          expected_refs: {
            content_version: 1,
          },
        },
      }),
      expect.anything(),
    );

    // Case D: approved canonical topic commits right after lock/active-job lookup -> returns ready without feature gate or enqueue
    queryMock.mockClear();
    jobProducerMock.enqueue.mockClear();
    let approvedLookupCount = 0;
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.roadmaps'))
        return [{ id: ROADMAP_ID, current_version_id: VERSION_ID }];
      if (sql.includes('FROM public.daily_plans'))
        return [
          { id: PLAN_ID, hours_per_day: '2.0', roadmap_version_id: VERSION_ID },
        ];
      if (sql.includes('COUNT(DISTINCT day_no)')) return [{ total_days: 5 }];
      if (sql.includes('FROM public.daily_plan_items dpi'))
        return [baseNextItem];
      if (sql.includes('FROM public.quiz_attempts')) return [];
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('FROM public.ai_requests')) return [];
      if (
        sql.includes('FROM public.topics') &&
        sql.includes("status = 'approved'")
      ) {
        approvedLookupCount += 1;
        if (approvedLookupCount === 1) {
          return [];
        }
        return [
          {
            id: APPROVED_TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            status: 'approved',
            explanation_markdown: '# Ready on recheck',
            important_questions: [],
            language: 'mixed',
            approved_at: '2026-11-21T00:00:00.000Z',
          },
        ];
      }
      if (sql.includes('FROM public.learning_resources')) return [];
      if (sql.includes('FROM public.content_reports')) return [];
      throw new Error(`Unexpected SQL in TodayService Case D: ${sql}`);
    });

    const readyAfterRecheck = await service.getToday(USER_ID);
    expect(readyAfterRecheck.status).toBe('ready');
    expect(readyAfterRecheck.topic?.topic_id).toBe(APPROVED_TOPIC_ID);
    expect(jobProducerMock.enqueue).not.toHaveBeenCalled();
    expect(
      queryMock.mock.calls.some(([sql]) =>
        String(sql).includes('effective_feature_access'),
      ),
    ).toBe(false);
  });
});

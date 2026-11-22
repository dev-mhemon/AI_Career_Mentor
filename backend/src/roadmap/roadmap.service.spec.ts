import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import type {
  EnqueuedJobAcceptedDto,
  JobProducerService,
} from '../jobs/services/job-producer.service.js';
import { RoadmapService } from './services/roadmap.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const GOAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROADMAP_ID = '22222222-2222-4222-8222-222222222222';
const ROADMAP_2_ID = '33333333-3333-4333-8333-333333333333';
const ROADMAP_3_ID = '44444444-4444-4444-8444-444444444444';
const ROLE_ID = '55555555-5555-4555-8555-555555555555';
const VERSION_1_ID = '66666666-6666-4666-8666-666666666666';
const VERSION_2_ID = '77777777-7777-4777-8777-777777777777';
const TOPIC_ID = '88888888-8888-4888-8888-888888888888';
const SKILL_ID = '99999999-9999-4999-8999-999999999999';
const LINEAGE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const JOB_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const IDEM_KEY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function expectContractError(
  error: unknown,
  expectedStatus: number,
  expectedCode: string,
) {
  expect(error).toBeInstanceOf(HttpException);
  const httpErr = error as HttpException;
  expect(httpErr.getStatus()).toBe(expectedStatus);
  const body = httpErr.getResponse() as { code?: string };
  expect(body.code).toBe(expectedCode);
}

describe('RoadmapService (EP-R01–EP-R07, EP-R14, EP-R15)', () => {
  let activeTxDepth: number;
  let txOptionsLog: Array<{
    userId: string | null;
    active?: boolean;
    foreground?: boolean;
  }>;
  let queryMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;
  let enqueueMock: ReturnType<typeof vi.fn>;
  let databaseMock: DatabaseService;
  let jobProducerMock: JobProducerService;
  let service: RoadmapService;

  beforeEach(() => {
    vi.clearAllMocks();
    activeTxDepth = 0;
    txOptionsLog = [];
    queryMock = vi.fn();
    transactionMock = vi.fn(
      async (
        userId: string | null,
        operation: (db: { query: typeof queryMock }) => Promise<unknown>,
        active = true,
        foreground = false,
      ) => {
        txOptionsLog.push({ userId, active, foreground });
        activeTxDepth += 1;
        try {
          return await operation({ query: queryMock });
        } finally {
          activeTxDepth -= 1;
        }
      },
    );
    databaseMock = {
      query: queryMock,
      transaction: transactionMock,
    } as unknown as DatabaseService;

    enqueueMock = vi.fn(async (): Promise<EnqueuedJobAcceptedDto> => ({
      job_id: JOB_ID,
      kind: 'roadmap_generate',
      status: 'queued',
      poll_url: `/api/v1/jobs/${JOB_ID}`,
      retry_after_seconds: 3,
    }));
    jobProducerMock = {
      enqueue: enqueueMock,
    } as unknown as JobProducerService;

    service = new RoadmapService(databaseMock, jobProducerMock);
  });

  afterEach(() => {
    expect(activeTxDepth).toBe(0);
    vi.useRealTimers();
  });

  describe('EP-R01 generateRoadmap', () => {
    it('enqueues roadmap_generate atomically inside foreground tx with expected_refs and quota/cap checks', async () => {
      const goalUpdatedExact = '2026-10-10T08:00:00.123456Z';
      const profileUpdatedExact = '2026-10-10T07:59:00.654321Z';

      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('private.effective_feature_access')) {
          expect(params).toEqual([USER_ID]);
          return [{ enabled: true }];
        }
        if (
          sql.includes('FROM public.career_goals') &&
          sql.includes('FOR UPDATE')
        ) {
          expect(params).toEqual([USER_ID, GOAL_ID]);
          return [
            {
              id: GOAL_ID,
              user_id: USER_ID,
              status: 'confirmed',
              confirmed_role_id: ROLE_ID,
              target_level: 'mid',
              updated_at_exact: goalUpdatedExact,
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles')) {
          expect(params).toEqual([USER_ID]);
          return [
            {
              current_role_title: 'Junior Engineer',
              experience_level: 'junior',
              learning_preference: 'hands_on',
              preferred_daily_hours: 2,
              timezone: 'Asia/Dhaka',
              existing_skills_none: false,
              self_reported_skill_ids: [SKILL_ID],
              updated_at_exact: profileUpdatedExact,
            },
          ];
        }
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('career_goal_id = $2')
        ) {
          expect(params).toEqual([USER_ID, GOAL_ID]);
          return [];
        }
        if (
          sql.includes('count(*)::int AS active_count') &&
          sql.includes('FROM public.roadmaps')
        ) {
          expect(params).toEqual([USER_ID]);
          return [{ active_count: 2 }];
        }
        if (sql.includes('FROM public.system_configurations')) {
          expect(params).toEqual(['ai_quota.roadmap_drafts_per_24h']);
          return [{ config_value: 5 }];
        }
        if (sql.includes('FROM public.ai_requests')) {
          expect(params).toEqual([USER_ID]);
          return [{ used_count: 4 }];
        }
        return [];
      });

      const accepted = await service.generateRoadmap(
        USER_ID,
        {
          career_goal_id: GOAL_ID,
          target_level: 'mid',
          level_confirmed: true,
        },
        { idempotencyKey: IDEM_KEY, acceptLanguage: 'bn' },
      );

      expect(accepted.job_id).toBe(JOB_ID);
      expect(txOptionsLog).toEqual([
        { userId: USER_ID, active: true, foreground: true },
      ]);
      expect(enqueueMock).toHaveBeenCalledWith(
        {
          userId: USER_ID,
          kind: 'roadmap_generate',
          envelope: {
            v: 1,
            args: { career_goal_id: GOAL_ID },
            expected_refs: {
              goal_updated_at: goalUpdatedExact,
              profile_updated_at: profileUpdatedExact,
            },
          },
          idempotencyKey: IDEM_KEY,
          subjectType: 'career_goal',
          subjectId: GOAL_ID,
          httpRequestId: undefined,
          language: 'bn',
        },
        expect.objectContaining({ query: queryMock }),
      );
    });

    it('rejects missing/foreign goal (404), unconfirmed goal (409), missing target_level/level_confirmed (422), incomplete profile (422), existing roadmap (409), 3-cap (409), and 24h quota (429)', async () => {
      const validGenerateDto = {
        career_goal_id: GOAL_ID,
        target_level: 'mid' as const,
        level_confirmed: true,
      };

      // Missing target_level -> 422 INVALID_ENUM_VALUE before tx
      await expect(
        service.generateRoadmap(USER_ID, {
          career_goal_id: GOAL_ID,
          level_confirmed: true,
        } as never),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'INVALID_ENUM_VALUE');
        return true;
      });
      // Missing level_confirmed -> 422 LEVEL_NOT_CONFIRMED before tx
      await expect(
        service.generateRoadmap(USER_ID, {
          career_goal_id: GOAL_ID,
          target_level: 'mid',
        } as never),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'LEVEL_NOT_CONFIRMED');
        return true;
      });
      expect(transactionMock).not.toHaveBeenCalled();

      // Missing / foreign goal
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (sql.includes('FROM public.career_goals')) return [];
        return [];
      });
      await expect(
        service.generateRoadmap(USER_ID, validGenerateDto),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 404, 'RESOURCE_NOT_FOUND');
        return true;
      });

      // Unconfirmed goal
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (sql.includes('FROM public.career_goals')) {
          return [
            {
              id: GOAL_ID,
              status: 'awaiting_confirmation',
              confirmed_role_id: null,
              target_level: null,
            },
          ];
        }
        return [];
      });
      await expect(
        service.generateRoadmap(USER_ID, validGenerateDto),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'INVALID_STATE_TRANSITION');
        return true;
      });

      // level_confirmed = false
      await expect(
        service.generateRoadmap(USER_ID, {
          career_goal_id: GOAL_ID,
          target_level: 'mid',
          level_confirmed: false,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'LEVEL_NOT_CONFIRMED');
        return true;
      });

      // Incomplete profile
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (sql.includes('FROM public.career_goals')) {
          return [
            {
              id: GOAL_ID,
              status: 'confirmed',
              confirmed_role_id: ROLE_ID,
              target_level: 'mid',
              updated_at_exact: '2026-10-10T08:00:00.000000Z',
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles')) {
          return [
            {
              current_role_title: 'Dev',
              experience_level: 'junior',
              learning_preference: null,
              preferred_daily_hours: null,
              timezone: 'Asia/Dhaka',
              existing_skills_none: false,
              self_reported_skill_ids: [],
            },
          ];
        }
        return [];
      });
      await expect(
        service.generateRoadmap(USER_ID, validGenerateDto),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'PROFILE_INCOMPLETE');
        return true;
      });

      // Existing roadmap for goal
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (sql.includes('FROM public.career_goals')) {
          return [
            {
              id: GOAL_ID,
              status: 'confirmed',
              confirmed_role_id: ROLE_ID,
              target_level: 'mid',
              updated_at_exact: '2026-10-10T08:00:00.000000Z',
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles')) {
          return [
            {
              current_role_title: 'Dev',
              experience_level: 'junior',
              learning_preference: 'visual',
              preferred_daily_hours: 2,
              timezone: 'Asia/Dhaka',
              existing_skills_none: true,
              self_reported_skill_ids: [],
              updated_at_exact: '2026-10-10T07:59:00.000000Z',
            },
          ];
        }
        if (sql.includes('career_goal_id = $2')) return [{ id: ROADMAP_ID }];
        return [];
      });
      await expect(
        service.generateRoadmap(USER_ID, validGenerateDto),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'RESOURCE_CONFLICT');
        return true;
      });

      // Active roadmap cap >= 3
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (sql.includes('FROM public.career_goals')) {
          return [
            {
              id: GOAL_ID,
              status: 'confirmed',
              confirmed_role_id: ROLE_ID,
              target_level: 'mid',
              updated_at_exact: '2026-10-10T08:00:00.000000Z',
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles')) {
          return [
            {
              current_role_title: 'Dev',
              experience_level: 'junior',
              learning_preference: 'visual',
              preferred_daily_hours: 2,
              timezone: 'Asia/Dhaka',
              existing_skills_none: true,
              self_reported_skill_ids: [],
              updated_at_exact: '2026-10-10T07:59:00.000000Z',
            },
          ];
        }
        if (sql.includes('career_goal_id = $2')) return [];
        if (sql.includes('active_count')) return [{ active_count: 3 }];
        return [];
      });
      await expect(
        service.generateRoadmap(USER_ID, validGenerateDto),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'ROADMAP_LIMIT_REACHED');
        return true;
      });

      // 24h draft quota exhausted -> 429
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (sql.includes('FROM public.career_goals')) {
          return [
            {
              id: GOAL_ID,
              status: 'confirmed',
              confirmed_role_id: ROLE_ID,
              target_level: 'mid',
              updated_at_exact: '2026-10-10T08:00:00.000000Z',
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles')) {
          return [
            {
              current_role_title: 'Dev',
              experience_level: 'junior',
              learning_preference: 'visual',
              preferred_daily_hours: 2,
              timezone: 'Asia/Dhaka',
              existing_skills_none: true,
              self_reported_skill_ids: [],
              updated_at_exact: '2026-10-10T07:59:00.000000Z',
            },
          ];
        }
        if (sql.includes('career_goal_id = $2')) return [];
        if (sql.includes('active_count')) return [{ active_count: 1 }];
        if (sql.includes('system_configurations')) return [{ config_value: 5 }];
        if (sql.includes('FROM public.ai_requests')) return [{ used_count: 5 }];
        return [];
      });
      await expect(
        service.generateRoadmap(USER_ID, validGenerateDto),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 429, 'RATE_LIMITED');
        return true;
      });
    });
  });

  describe('EP-R02, EP-R03, EP-R06, EP-R07 reads & pagination', () => {
    it('EP-R02 lists owner roadmaps with status filter, has_open_merge, and microsecond-safe cursor pagination (R24 foreground = false)', async () => {
      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM public.roadmaps r')) {
          expect(sql).toContain('r.user_id = $1');
          expect(params?.[0]).toBe(USER_ID);
          expect(params?.[1]).toBe('locked');
          expect(params?.[2]).toBe(2); // limit + 1
          return [
            {
              id: ROADMAP_ID,
              career_goal_id: GOAL_ID,
              canonical_role_id: ROLE_ID,
              role_name: 'Backend Development',
              target_level: 'mid',
              status: 'locked',
              is_focus: true,
              current_version_id: VERSION_1_ID,
              current_version_no: 2,
              draft_version_no: null,
              has_open_draft: false,
              has_open_merge: true,
              has_daily_plan: true,
              current_stale: false,
              draft_stale: false,
              locked_at: '2026-10-10T08:30:00.000Z',
              archived_at: null,
              created_at: '2026-10-10T08:00:00.123456Z',
              created_at_cursor: '2026-10-10T08:00:00.123456Z',
              updated_at: '2026-10-10T08:30:00.000Z',
            },
            {
              id: ROADMAP_2_ID,
              career_goal_id: GOAL_ID,
              canonical_role_id: ROLE_ID,
              role_name: 'DevOps',
              target_level: 'junior',
              status: 'locked',
              is_focus: false,
              current_version_id: VERSION_2_ID,
              current_version_no: 1,
              draft_version_no: null,
              has_open_draft: false,
              has_open_merge: false,
              has_daily_plan: false,
              current_stale: false,
              draft_stale: false,
              locked_at: '2026-10-09T08:30:00.000Z',
              archived_at: null,
              created_at: '2026-10-09T08:00:00.000000Z',
              created_at_cursor: '2026-10-09T08:00:00.000000Z',
              updated_at: '2026-10-09T08:30:00.000Z',
            },
          ];
        }
        return [];
      });

      const page1 = await service.listRoadmaps(USER_ID, {
        status: 'locked',
        limit: 1,
      });
      expect(txOptionsLog).toEqual([
        { userId: USER_ID, active: true, foreground: false },
      ]);
      expect(page1.items).toHaveLength(1);
      expect(page1.items[0]?.has_open_merge).toBe(true);
      expect(page1.meta.next_cursor).toEqual(expect.any(String));

      // Verify decoded microsecond cursor feeds back into SQL
      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM public.roadmaps r')) {
          expect(params).toEqual([
            USER_ID,
            '2026-10-10T08:00:00.123456Z',
            ROADMAP_ID,
            2,
          ]);
          return [];
        }
        return [];
      });
      const page2 = await service.listRoadmaps(USER_ID, {
        limit: 1,
        cursor: page1.meta.next_cursor!,
      });
      expect(page2.items).toEqual([]);
      expect(page2.meta.next_cursor).toBeNull();

      await expect(
        service.listRoadmaps(USER_ID, {
          status: 'invalid_status' as never,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'INVALID_ENUM_VALUE');
        return true;
      });
      await expect(
        service.listRoadmaps(USER_ID, { cursor: 'bad-cursor' }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 400, 'INVALID_FORMAT');
        return true;
      });
    });

    it('EP-R03 & EP-R06/EP-R07 enforce owner scoping, ?version=current|draft|<int>, and version snapshot pagination', async () => {
      // Missing / foreign roadmap -> 404
      queryMock.mockResolvedValueOnce([]);
      await expect(service.getRoadmap(USER_ID, ROADMAP_ID)).rejects.toSatisfy(
        (err) => {
          expectContractError(err, 404, 'RESOURCE_NOT_FOUND');
          return true;
        },
      );

      // Invalid version param -> 400
      await expect(
        service.getRoadmap(USER_ID, ROADMAP_ID, { version: 'abc' }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 400, 'INVALID_FORMAT');
        return true;
      });

      // Happy getRoadmap with ?version=draft + items + size_guardrail
      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM public.roadmaps r')) {
          expect(params).toEqual([USER_ID, ROADMAP_ID]);
          return [
            {
              id: ROADMAP_ID,
              career_goal_id: GOAL_ID,
              canonical_role_id: ROLE_ID,
              role_name: 'Backend Development',
              target_level: 'mid',
              status: 'draft',
              is_focus: false,
              current_version_id: null,
              locked_at: null,
              created_at: '2026-10-10T08:00:00.000Z',
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          expect(sql).toContain("state = 'draft'");
          expect(params).toEqual([USER_ID, ROADMAP_ID]);
          return [
            {
              id: VERSION_1_ID,
              roadmap_id: ROADMAP_ID,
              version_no: 2,
              state: 'draft',
              created_by: 'user_request',
              target_level: 'mid',
              base_version_id: VERSION_2_ID,
              merge_id: null,
              summary: {
                current_situation: 'Junior Dev',
                target_interpretation: 'Mid Backend',
                expected_career_impact: 'API fluency',
                next_steps: ['Study PostgreSQL'],
              },
              phases: [
                {
                  phase_no: 1,
                  title: 'Core Storage',
                  milestones: [{ id: 'm1', title: 'ACID basics' }],
                },
              ],
              level_outline: [
                { career_level: 'senior', outline: ['Sharding'] },
              ],
              warnings: [],
              stale: false,
              stale_reason: null,
              locked_at: null,
              superseded_at: null,
              created_at: '2026-10-10T08:05:00.000Z',
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_items')) {
          expect(params).toEqual([USER_ID, VERSION_1_ID]);
          return [
            {
              id: 'item-row-1',
              version_id: VERSION_1_ID,
              lineage_id: LINEAGE_ID,
              topic_id: TOPIC_ID,
              skill_id: SKILL_ID,
              phase_no: 1,
              phase_title: 'Core Storage',
              title: 'PostgreSQL Transactions',
              priority: 'core',
              gap_type: 'missing',
              required_depth: 'production',
              estimated_effort_hours: '8.5',
              sequence_no: 1,
              depends_on_lineage_ids: [],
              reason: 'Essential for concurrency',
              retired: false,
              sources: [
                {
                  publisher: 'PostgreSQL',
                  url: 'https://www.postgresql.org/docs/',
                },
              ],
            },
          ];
        }
        if (sql.includes('FROM public.system_configurations')) {
          return [{ config_value: 45 }];
        }
        return [];
      });

      const detail = await service.getRoadmap(USER_ID, ROADMAP_ID, {
        version: 'draft',
      });
      expect(detail.version_no).toBe(2);
      expect(detail.phases).toHaveLength(1);
      expect(detail.phases[0]?.items[0]?.estimated_effort_hours).toBe(8.5);
      expect(detail.items[0]?.item_id).toBe(LINEAGE_ID);
      expect(detail.size_guardrail).toEqual({
        active_topic_count: 1,
        soft_max_topics: 45,
        materially_large: false,
        warning: null,
      });

      // EP-R06 version list pagination + EP-R07 specific version 404
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.roadmaps') && !sql.includes('JOIN')) {
          return [{ id: ROADMAP_ID }];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [
            {
              id: VERSION_1_ID,
              version_no: 2,
              state: 'draft',
              created_by: 'user_request',
              target_level: 'mid',
              base_version_id: VERSION_2_ID,
              merge_id: null,
              stale: false,
              locked_at: null,
              superseded_at: null,
              created_at: '2026-10-10T08:05:00.000Z',
            },
            {
              id: VERSION_2_ID,
              version_no: 1,
              state: 'superseded',
              created_by: 'ai',
              target_level: 'mid',
              base_version_id: null,
              merge_id: null,
              stale: false,
              locked_at: null,
              superseded_at: '2026-10-10T08:05:00.000Z',
              created_at: '2026-10-10T08:00:00.000Z',
            },
          ];
        }
        return [];
      });
      const versions = await service.listVersions(USER_ID, ROADMAP_ID, {
        limit: 1,
      });
      expect(versions.items).toHaveLength(1);
      expect(versions.meta.next_cursor).toEqual(expect.any(String));

      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.roadmaps r')) {
          return [
            {
              id: ROADMAP_ID,
              career_goal_id: GOAL_ID,
              canonical_role_id: ROLE_ID,
              role_name: 'Backend Development',
              target_level: 'mid',
              status: 'draft',
              is_focus: false,
              current_version_id: null,
              locked_at: null,
              created_at: '2026-10-10T08:00:00.000Z',
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) return [];
        return [];
      });
      await expect(
        service.getVersion(USER_ID, ROADMAP_ID, 99),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 404, 'VERSION_NOT_FOUND');
        return true;
      });
    });
  });

  describe('EP-R04 requestRevision', () => {
    it('validates Unicode code points, rejects NUL/surrogates/empty payload, enforces draft state & 24h quota, and enqueues roadmap_revision', async () => {
      // Surrogate / NUL / > 2000 code points / missing both fields -> 422 VALIDATION_FAILED
      await expect(
        service.requestRevision(USER_ID, ROADMAP_ID, {
          instruction: 'bad\u0000text',
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'VALIDATION_FAILED');
        return true;
      });
      await expect(
        service.requestRevision(USER_ID, ROADMAP_ID, {
          instruction: 'bad\ud800surrogate',
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'VALIDATION_FAILED');
        return true;
      });
      await expect(
        service.requestRevision(USER_ID, ROADMAP_ID, {
          instruction: 'a'.repeat(2_001),
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'VALIDATION_FAILED');
        return true;
      });
      await expect(
        service.requestRevision(USER_ID, ROADMAP_ID, {
          refresh_stale: false,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'VALIDATION_FAILED');
        return true;
      });

      // Exactly 2000 multi-byte code points (2 UTF-16 units each -> 4000 length, 2000 code points) succeeds validation
      const exact2000CodePoints = '😀'.repeat(2_000);
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (sql.includes('FROM public.roadmaps')) {
          return [{ id: ROADMAP_ID, status: 'draft' }];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ id: VERSION_1_ID, version_no: 2, stale: true }];
        }
        if (sql.includes('system_configurations')) return [{ config_value: 5 }];
        if (sql.includes('FROM public.ai_requests')) return [{ used_count: 1 }];
        return [];
      });
      enqueueMock.mockResolvedValueOnce({
        job_id: JOB_ID,
        kind: 'roadmap_revision',
        status: 'queued',
        poll_url: `/api/v1/jobs/${JOB_ID}`,
        retry_after_seconds: 3,
      });

      const accepted = await service.requestRevision(
        USER_ID,
        ROADMAP_ID,
        { instruction: exact2000CodePoints, refresh_stale: false },
        { idempotencyKey: IDEM_KEY },
      );
      expect(accepted.kind).toBe('roadmap_revision');
      expect(enqueueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          kind: 'roadmap_revision',
          envelope: {
            v: 1,
            args: {
              roadmap_id: ROADMAP_ID,
              base_version_no: 2,
              instruction: exact2000CodePoints,
              refresh_stale: false,
            },
            expected_refs: { roadmap_version: 2 },
          },
        }),
        expect.objectContaining({ query: queryMock }),
      );

      // refresh_stale: true without instruction succeeds
      await expect(
        service.requestRevision(
          USER_ID,
          ROADMAP_ID,
          { refresh_stale: true, expected_version_no: 2 },
          { idempotencyKey: IDEM_KEY },
        ),
      ).resolves.toMatchObject({ job_id: JOB_ID });

      // Stale version drift -> 409 STALE_VERSION
      await expect(
        service.requestRevision(USER_ID, ROADMAP_ID, {
          refresh_stale: true,
          expected_version_no: 1,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'STALE_VERSION');
        return true;
      });

      // Mismatched If-Match header rejects even when body expected_version_no matches open draft
      await expect(
        service.requestRevision(
          USER_ID,
          ROADMAP_ID,
          { refresh_stale: true, expected_version_no: 2 },
          { idempotencyKey: IDEM_KEY, ifMatch: 1 },
        ),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'STALE_VERSION');
        return true;
      });

      // Both body expected_version_no and If-Match matching open draft succeeds
      await expect(
        service.requestRevision(
          USER_ID,
          ROADMAP_ID,
          { refresh_stale: true, expected_version_no: 2 },
          { idempotencyKey: IDEM_KEY, ifMatch: 2 },
        ),
      ).resolves.toMatchObject({ job_id: JOB_ID });

      // Locked roadmap -> 409 INVALID_STATE_TRANSITION
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (sql.includes('FROM public.roadmaps')) {
          return [{ id: ROADMAP_ID, status: 'locked' }];
        }
        return [];
      });
      await expect(
        service.requestRevision(USER_ID, ROADMAP_ID, { refresh_stale: true }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'INVALID_STATE_TRANSITION');
        return true;
      });
    });
  });

  describe('EP-R05 lockRoadmap', () => {
    it('enforces DRAFT_STALE, STALE_VERSION, LARGE_ROADMAP_CONFIRMATION_REQUIRED (> 45), auto-focus only when none exists, and never creates daily_plans', async () => {
      const sqlStatements: string[] = [];

      // Missing all version preconditions (expected_version_no, version_no, If-Match) -> 422 before any DB query
      transactionMock.mockClear();
      await expect(
        service.lockRoadmap(USER_ID, ROADMAP_ID, {}),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'VALIDATION_FAILED');
        return true;
      });
      expect(transactionMock).not.toHaveBeenCalled();

      // Stale draft without acknowledge_stale -> 409 DRAFT_STALE
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (sql.includes('FROM public.roadmaps')) {
          return [{ id: ROADMAP_ID, status: 'draft', is_focus: false }];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [
            { id: VERSION_1_ID, version_no: 2, stale: true, state: 'draft' },
          ];
        }
        return [];
      });
      await expect(
        service.lockRoadmap(USER_ID, ROADMAP_ID, { expected_version_no: 2 }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'DRAFT_STALE');
        return true;
      });

      // Version drift -> 409 STALE_VERSION
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (sql.includes('FROM public.roadmaps')) {
          return [{ id: ROADMAP_ID, status: 'draft', is_focus: false }];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [
            { id: VERSION_1_ID, version_no: 2, stale: false, state: 'draft' },
          ];
        }
        return [];
      });
      await expect(
        service.lockRoadmap(USER_ID, ROADMAP_ID, { expected_version_no: 1 }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'STALE_VERSION');
        return true;
      });

      // Mismatched If-Match rejects with 409 STALE_VERSION even when body expected_version_no matches open draft
      await expect(
        service.lockRoadmap(
          USER_ID,
          ROADMAP_ID,
          { expected_version_no: 2 },
          { ifMatch: 1 },
        ),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'STALE_VERSION');
        return true;
      });

      // > 45 active topics without confirm_large_roadmap -> 422 LARGE_ROADMAP_CONFIRMATION_REQUIRED
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (sql.includes('FROM public.roadmaps')) {
          return [{ id: ROADMAP_ID, status: 'draft', is_focus: false }];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [
            { id: VERSION_1_ID, version_no: 2, stale: false, state: 'draft' },
          ];
        }
        if (sql.includes('FROM public.roadmap_items')) {
          return [{ active_topic_count: 46 }];
        }
        if (sql.includes('system_configurations'))
          return [{ config_value: 45 }];
        return [];
      });
      await expect(
        service.lockRoadmap(USER_ID, ROADMAP_ID, { expected_version_no: 2 }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'LARGE_ROADMAP_CONFIRMATION_REQUIRED');
        return true;
      });

      // Happy lock with confirm_large_roadmap: true and NO existing focus -> sets is_focus = true, no daily_plans created
      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        sqlStatements.push(sql);
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('FOR UPDATE')
        ) {
          return [{ id: ROADMAP_ID, status: 'draft', is_focus: false }];
        }
        if (
          sql.includes('FROM public.roadmap_versions') &&
          sql.includes('FOR UPDATE')
        ) {
          return [
            { id: VERSION_1_ID, version_no: 2, stale: false, state: 'draft' },
          ];
        }
        if (sql.includes('FROM public.roadmap_items')) {
          return [{ active_topic_count: 46 }];
        }
        if (sql.includes('system_configurations'))
          return [{ config_value: 45 }];
        if (sql.includes('UPDATE public.roadmap_versions')) {
          expect(params).toEqual([USER_ID, VERSION_1_ID]);
          return [
            {
              id: VERSION_1_ID,
              version_no: 2,
              locked_at: '2026-10-10T08:30:00.000Z',
            },
          ];
        }
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('is_focus = true')
        ) {
          return [];
        }
        if (sql.includes('UPDATE public.roadmaps')) {
          expect(params).toEqual([USER_ID, ROADMAP_ID, VERSION_1_ID, true]);
          return [
            {
              id: ROADMAP_ID,
              is_focus: true,
              current_version_id: VERSION_1_ID,
              locked_at: '2026-10-10T08:30:00.000Z',
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles')) {
          return [{ preferred_daily_hours: '2.0' }];
        }
        return [];
      });

      const lockedFirst = await service.lockRoadmap(USER_ID, ROADMAP_ID, {
        expected_version_no: 2,
        confirm_large_roadmap: true,
      });
      expect(lockedFirst.is_focus).toBe(true);
      expect(lockedFirst.next_step).toBe('confirm_learning_hours');
      expect(lockedFirst.preferred_daily_hours).toBe(2);
      expect(lockedFirst.size_guardrail.materially_large).toBe(true);
      expect(sqlStatements.some((s) => s.includes('daily_plans'))).toBe(false);

      // Second roadmap lock when user already has a focus roadmap -> keeps is_focus = false
      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('FOR UPDATE')
        ) {
          return [{ id: ROADMAP_2_ID, status: 'draft', is_focus: false }];
        }
        if (
          sql.includes('FROM public.roadmap_versions') &&
          sql.includes('FOR UPDATE')
        ) {
          return [
            { id: VERSION_2_ID, version_no: 1, stale: false, state: 'draft' },
          ];
        }
        if (sql.includes('FROM public.roadmap_items')) {
          return [{ active_topic_count: 10 }];
        }
        if (sql.includes('system_configurations'))
          return [{ config_value: 45 }];
        if (sql.includes('UPDATE public.roadmap_versions')) {
          return [
            {
              id: VERSION_2_ID,
              version_no: 1,
              locked_at: '2026-10-10T09:00:00.000Z',
            },
          ];
        }
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('is_focus = true')
        ) {
          return [{ id: ROADMAP_ID }];
        }
        if (sql.includes('UPDATE public.roadmaps')) {
          expect(params).toEqual([USER_ID, ROADMAP_2_ID, VERSION_2_ID, false]);
          return [
            {
              id: ROADMAP_2_ID,
              is_focus: false,
              current_version_id: VERSION_2_ID,
              locked_at: '2026-10-10T09:00:00.000Z',
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles')) {
          return [{ preferred_daily_hours: null }];
        }
        return [];
      });

      const lockedSecond = await service.lockRoadmap(USER_ID, ROADMAP_2_ID, {
        version_no: 1,
      });
      expect(lockedSecond.is_focus).toBe(false);
      expect(lockedSecond.preferred_daily_hours).toBeNull();
    });

    it('unwraps TypeORM PostgreSQL [rows, rowCount] tuples on UPDATE ... RETURNING and fails 409 on [[], 0]', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('FOR UPDATE')
        ) {
          return [{ id: ROADMAP_ID, status: 'draft', is_focus: false }];
        }
        if (
          sql.includes('FROM public.roadmap_versions') &&
          sql.includes('FOR UPDATE')
        ) {
          return [
            { id: VERSION_1_ID, version_no: 3, stale: false, state: 'draft' },
          ];
        }
        if (sql.includes('FROM public.roadmap_items')) {
          return [{ active_topic_count: 12 }];
        }
        if (sql.includes('system_configurations'))
          return [{ config_value: 45 }];
        if (sql.includes('UPDATE public.roadmap_versions')) {
          return [
            [
              {
                id: VERSION_1_ID,
                version_no: 3,
                locked_at: new Date('2026-10-10T10:00:00.000Z'),
              },
            ],
            1,
          ];
        }
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('is_focus = true')
        ) {
          return [];
        }
        if (sql.includes('UPDATE public.roadmaps')) {
          return [
            [
              {
                id: ROADMAP_ID,
                is_focus: true,
                current_version_id: VERSION_1_ID,
                locked_at: new Date('2026-10-10T10:00:00.000Z'),
              },
            ],
            1,
          ];
        }
        if (sql.includes('FROM public.user_profiles')) {
          return [{ preferred_daily_hours: '1.5' }];
        }
        return [];
      });

      const locked = await service.lockRoadmap(USER_ID, ROADMAP_ID, {
        expected_version_no: 3,
      });
      expect(locked).toMatchObject({
        roadmap_id: ROADMAP_ID,
        status: 'locked',
        version_no: 3,
        current_version_id: VERSION_1_ID,
        is_focus: true,
        locked_at: '2026-10-10T10:00:00.000Z',
        preferred_daily_hours: 1.5,
      });

      // Empty TypeORM tuple [[], 0] MUST trigger 409 INVALID_STATE_TRANSITION (never treat [] as truthy row)
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('FOR UPDATE')
        ) {
          return [{ id: ROADMAP_ID, status: 'draft', is_focus: false }];
        }
        if (
          sql.includes('FROM public.roadmap_versions') &&
          sql.includes('FOR UPDATE')
        ) {
          return [
            { id: VERSION_1_ID, version_no: 3, stale: false, state: 'draft' },
          ];
        }
        if (sql.includes('FROM public.roadmap_items')) {
          return [{ active_topic_count: 12 }];
        }
        if (sql.includes('system_configurations'))
          return [{ config_value: 45 }];
        if (sql.includes('UPDATE public.roadmap_versions')) {
          return [[], 0];
        }
        return [];
      });

      await expect(
        service.lockRoadmap(USER_ID, ROADMAP_ID, { expected_version_no: 3 }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'INVALID_STATE_TRANSITION');
        return true;
      });
    });
  });

  describe('EP-R14 setFocus & EP-R15 archiveRoadmap', () => {
    it('EP-R14 clears is_focus = false before setting is_focus = true and reports daily_plan state & requires_learning_hours', async () => {
      const updateOrder: string[] = [];

      // Non-locked roadmap rejected with 409 INVALID_STATE_TRANSITION
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM public.roadmaps')) {
          return [{ id: ROADMAP_ID, status: 'draft', is_focus: false }];
        }
        return [];
      });
      await expect(service.setFocus(USER_ID, ROADMAP_ID)).rejects.toSatisfy(
        (err) => {
          expectContractError(err, 409, 'INVALID_STATE_TRANSITION');
          return true;
        },
      );

      // Existing daily plan on target
      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('FOR UPDATE')
        ) {
          return [
            { id: ROADMAP_ID, status: 'locked', is_focus: true },
            { id: ROADMAP_2_ID, status: 'locked', is_focus: false },
          ];
        }
        if (sql.includes('SET is_focus = false')) {
          updateOrder.push('clear_old_focus');
          expect(params).toEqual([USER_ID, ROADMAP_2_ID]);
          return [];
        }
        if (sql.includes('SET is_focus = true')) {
          updateOrder.push('set_new_focus');
          expect(params).toEqual([USER_ID, ROADMAP_2_ID]);
          return [];
        }
        if (sql.includes('FROM public.daily_plans')) {
          expect(params).toEqual([USER_ID, ROADMAP_2_ID]);
          return [{ id: PLAN_ID }];
        }
        return [];
      });

      const switchedExisting = await service.setFocus(USER_ID, ROADMAP_2_ID);
      expect(updateOrder).toEqual(['clear_old_focus', 'set_new_focus']);
      expect(switchedExisting).toEqual({
        focus_roadmap_id: ROADMAP_2_ID,
        daily_plan: {
          state: 'existing',
          plan_id: PLAN_ID,
          requires_learning_hours: false,
        },
      });

      // Missing plan + missing preferred_daily_hours -> requires_learning_hours = true
      queryMock.mockImplementation(async (sql: string) => {
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('FOR UPDATE')
        ) {
          return [{ id: ROADMAP_2_ID, status: 'locked', is_focus: true }];
        }
        if (sql.includes('FROM public.daily_plans')) return [];
        if (sql.includes('FROM public.user_profiles')) {
          return [{ preferred_daily_hours: null }];
        }
        return [];
      });
      const switchedMissingNoHours = await service.setFocus(
        USER_ID,
        ROADMAP_2_ID,
      );
      expect(switchedMissingNoHours.daily_plan).toEqual({
        state: 'missing',
        plan_id: null,
        requires_learning_hours: true,
      });

      // Missing plan + existing preferred_daily_hours -> requires_learning_hours = false
      queryMock.mockImplementation(async (sql: string) => {
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('FOR UPDATE')
        ) {
          return [{ id: ROADMAP_2_ID, status: 'locked', is_focus: true }];
        }
        if (sql.includes('FROM public.daily_plans')) return [];
        if (sql.includes('FROM public.user_profiles')) {
          return [{ preferred_daily_hours: '1.5' }];
        }
        return [];
      });
      const switchedMissingWithHours = await service.setFocus(
        USER_ID,
        ROADMAP_2_ID,
      );
      expect(switchedMissingWithHours.daily_plan).toEqual({
        state: 'missing',
        plan_id: null,
        requires_learning_hours: false,
      });
    });

    it('EP-R15 archives target (is_focus = false first) before deterministic promotion and preserves history', async () => {
      const mutationOrder: string[] = [];

      // Already archived -> 409 INVALID_STATE_TRANSITION
      queryMock.mockImplementation(async (sql: string) => {
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('FOR UPDATE')
        ) {
          return [
            {
              id: ROADMAP_ID,
              career_goal_id: GOAL_ID,
              status: 'archived',
              is_focus: false,
            },
          ];
        }
        return [];
      });
      await expect(
        service.archiveRoadmap(USER_ID, ROADMAP_ID),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'INVALID_STATE_TRANSITION');
        return true;
      });

      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('id = $2') &&
          sql.includes('FOR UPDATE')
        ) {
          return [
            {
              id: ROADMAP_ID,
              career_goal_id: GOAL_ID,
              status: 'locked',
              is_focus: true,
            },
          ];
        }
        if (
          sql.includes('UPDATE public.roadmaps') &&
          sql.includes("status = 'archived'")
        ) {
          mutationOrder.push('archive_and_clear_focus');
          expect(params).toEqual([USER_ID, ROADMAP_ID, 'Switched tracks']);
          return [];
        }
        if (sql.includes('UPDATE public.career_goals')) {
          mutationOrder.push('discontinue_goal');
          expect(params).toEqual([USER_ID, GOAL_ID]);
          return [];
        }
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('ORDER BY locked_at DESC NULLS LAST')
        ) {
          mutationOrder.push('select_replacement');
          expect(params).toEqual([USER_ID, ROADMAP_ID]);
          return [{ id: ROADMAP_3_ID }];
        }
        if (
          sql.includes('UPDATE public.roadmaps') &&
          sql.includes('SET is_focus = true')
        ) {
          mutationOrder.push('promote_replacement');
          expect(params).toEqual([USER_ID, ROADMAP_3_ID]);
          return [];
        }
        if (sql.includes('DELETE FROM')) {
          throw new Error('Archive must never delete historical records');
        }
        return [];
      });

      const archived = await service.archiveRoadmap(USER_ID, ROADMAP_ID, {
        reason: 'Switched tracks',
      });
      expect(mutationOrder).toEqual([
        'archive_and_clear_focus',
        'discontinue_goal',
        'select_replacement',
        'promote_replacement',
      ]);
      expect(archived).toEqual({
        archived_roadmap_id: ROADMAP_ID,
        status: 'archived',
        new_focus_roadmap_id: ROADMAP_3_ID,
      });
    });
  });
});

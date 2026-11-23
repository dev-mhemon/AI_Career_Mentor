import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import type {
  EnqueuedJobAcceptedDto,
  JobProducerService,
} from '../jobs/services/job-producer.service.js';
import type { CreateMergeProposalDTO } from './dto/roadmap-merge.dto.js';
import { RoadmapMergeService } from './services/roadmap-merge.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROADMAP_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID = '55555555-5555-4555-8555-555555555555';
const MERGE_ID_1 = '66666666-6666-4666-8666-666666666666';
const MERGE_ID_2 = '77777777-7777-4777-8777-777777777777';
const SKILL_ID = '88888888-8888-4888-8888-888888888888';
const TOPIC_ID = '99999999-9999-4999-8999-999999999999';
const LINEAGE_ID = 'aaaa1111-1111-4111-8111-111111111111';
const PLAN_ID = 'cccc1111-1111-4111-8111-111111111111';

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

const ACCEPTED_JOB: EnqueuedJobAcceptedDto = {
  job_id: JOB_ID,
  kind: 'merge_proposal',
  status: 'queued',
  poll_url: `/api/v1/jobs/${JOB_ID}`,
  retry_after_seconds: 3,
};

describe('RoadmapMergeService (EP-R08, EP-R09, EP-R10, EP-R12)', () => {
  describe('EP-R08 createProposal', () => {
    it('enqueues merge_proposal job (202) for locked roadmap with user_request and expected_refs', async () => {
      const dbQuery = vi.fn(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              target_level: 'mid',
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ id: VERSION_ID, version_no: 3 }];
        }
        if (sql.includes('FROM public.roadmap_merges')) return [];
        if (sql.includes('FROM public.ai_requests')) return [];
        return [];
      });

      const database = {
        transaction: vi.fn(async (_u, fn) => fn({ query: dbQuery })),
      } as unknown as DatabaseService;
      const jobProducer = {
        enqueue: vi.fn().mockResolvedValue(ACCEPTED_JOB),
      } as unknown as JobProducerService;

      const service = new RoadmapMergeService(database, jobProducer);
      const res = await service.createProposal(
        USER_ID,
        ROADMAP_ID,
        {
          origin: 'user_request',
          instruction:
            'Add Kubernetes basics and retire legacy deployment topic',
          base_version_no: 3,
        },
        {
          idempotencyKey: 'idem-1',
          ifMatch: 3,
          acceptLanguage: 'bn',
        },
      );

      expect(res).toEqual(ACCEPTED_JOB);
      expect(jobProducer.enqueue).toHaveBeenCalledTimes(1);
      const enqueueInput = vi.mocked(jobProducer.enqueue).mock.calls[0][0];
      expect(enqueueInput.kind).toBe('merge_proposal');
      expect(enqueueInput.envelope).toEqual({
        v: 1,
        args: {
          roadmap_id: ROADMAP_ID,
          base_version_no: 3,
          origin: 'user_request',
          instruction:
            'Add Kubernetes basics and retire legacy deployment topic',
        },
        expected_refs: {
          base_version_no: 3,
        },
      });
      expect(enqueueInput.language).toBe('bn');
    });

    it('rejects ai_proposal origin (422), draft/archived roadmaps (409), LEVEL_UNCHANGED (422), STALE_VERSION (409), and MERGE_ALREADY_PROPOSED (409)', async () => {
      const makeService = (
        roadmapRow: {
          id: string;
          status: string;
          target_level: string;
          current_version_id: string | null;
        },
        options: {
          versionNo?: number;
          openMerge?: boolean;
          featureEnabled?: boolean;
        } = {},
      ) => {
        const dbQuery = vi.fn(async (sql: string) => {
          if (sql.includes('effective_feature_access')) {
            return [{ enabled: options.featureEnabled ?? true }];
          }
          if (sql.includes('FROM public.roadmaps')) return [roadmapRow];
          if (sql.includes('FROM public.roadmap_versions')) {
            return [{ id: VERSION_ID, version_no: options.versionNo ?? 2 }];
          }
          if (sql.includes('FROM public.roadmap_merges')) {
            return options.openMerge ? [{ id: MERGE_ID_1 }] : [];
          }
          if (sql.includes('FROM public.ai_requests')) return [];
          return [];
        });
        return new RoadmapMergeService(
          {
            transaction: vi.fn(async (_u, fn) => fn({ query: dbQuery })),
          } as unknown as DatabaseService,
          { enqueue: vi.fn() } as unknown as JobProducerService,
        );
      };

      const lockedSvc = makeService({
        id: ROADMAP_ID,
        status: 'locked',
        target_level: 'mid',
        current_version_id: VERSION_ID,
      });

      // ai_proposal origin rejected
      await expect(
        lockedSvc.createProposal(USER_ID, ROADMAP_ID, {
          origin: 'ai_proposal' as unknown as CreateMergeProposalDTO['origin'],
          instruction: 'System only',
        }),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 422, 'INVALID_ENUM_VALUE');
        return true;
      });

      // level_change with same level -> 422 LEVEL_UNCHANGED
      await expect(
        lockedSvc.createProposal(USER_ID, ROADMAP_ID, {
          origin: 'level_change',
          target_level: 'mid',
        }),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 422, 'LEVEL_UNCHANGED');
        return true;
      });

      // Stale If-Match / base_version_no -> 409 STALE_VERSION
      await expect(
        lockedSvc.createProposal(
          USER_ID,
          ROADMAP_ID,
          { origin: 'level_change', target_level: 'senior' },
          { ifMatch: 1 },
        ),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'STALE_VERSION');
        return true;
      });

      // Draft roadmap -> 409 ROADMAP_NOT_LOCKED
      const draftSvc = makeService({
        id: ROADMAP_ID,
        status: 'draft',
        target_level: 'mid',
        current_version_id: null,
      });
      await expect(
        draftSvc.createProposal(USER_ID, ROADMAP_ID, {
          origin: 'user_request',
          instruction: 'Add testing',
        }),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'ROADMAP_NOT_LOCKED');
        return true;
      });

      // Archived roadmap -> 409 ROADMAP_ARCHIVED
      const archivedSvc = makeService({
        id: ROADMAP_ID,
        status: 'archived',
        target_level: 'mid',
        current_version_id: VERSION_ID,
      });
      await expect(
        archivedSvc.createProposal(USER_ID, ROADMAP_ID, {
          origin: 'user_request',
          instruction: 'Add testing',
        }),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'ROADMAP_ARCHIVED');
        return true;
      });

      // Open merge proposal -> 409 MERGE_ALREADY_PROPOSED
      const openMergeSvc = makeService(
        {
          id: ROADMAP_ID,
          status: 'locked',
          target_level: 'mid',
          current_version_id: VERSION_ID,
        },
        { openMerge: true },
      );
      await expect(
        openMergeSvc.createProposal(USER_ID, ROADMAP_ID, {
          origin: 'level_change',
          target_level: 'senior',
        }),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'MERGE_ALREADY_PROPOSED');
        return true;
      });

      // Feature disabled -> 403 FEATURE_DISABLED
      const disabledSvc = makeService(
        {
          id: ROADMAP_ID,
          status: 'locked',
          target_level: 'mid',
          current_version_id: VERSION_ID,
        },
        { featureEnabled: false },
      );
      await expect(
        disabledSvc.createProposal(USER_ID, ROADMAP_ID, {
          origin: 'level_change',
          target_level: 'senior',
        }),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 403, 'FEATURE_DISABLED');
        return true;
      });
    });

    it('reuses active merge_proposal job only when resolved language matches and rejects language mismatch (409)', async () => {
      const activeJobRow = {
        id: JOB_ID,
        status: 'queued',
        language: 'bn',
        input_payload: {
          v: 1,
          args: {
            roadmap_id: ROADMAP_ID,
            base_version_no: 3,
            origin: 'level_change',
            target_level: 'senior',
          },
        },
      };
      const dbQuery = vi.fn(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              target_level: 'mid',
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ id: VERSION_ID, version_no: 3 }];
        }
        if (sql.includes('FROM public.roadmap_merges')) return [];
        if (sql.includes('FROM public.ai_requests')) return [activeJobRow];
        return [];
      });
      const enqueue = vi.fn();
      const service = new RoadmapMergeService(
        {
          transaction: vi.fn(async (_u, fn) => fn({ query: dbQuery })),
        } as unknown as DatabaseService,
        { enqueue } as unknown as JobProducerService,
      );

      // Matching resolved language ('bn') reuses the in-flight job without enqueueing
      await expect(
        service.createProposal(
          USER_ID,
          ROADMAP_ID,
          {
            origin: 'level_change',
            target_level: 'senior',
            base_version_no: 3,
          },
          { acceptLanguage: 'bn-BD' },
        ),
      ).resolves.toEqual(ACCEPTED_JOB);
      expect(enqueue).not.toHaveBeenCalled();

      // Mismatched resolved language ('en' vs active 'bn') rejects with 409 MERGE_ALREADY_PROPOSED
      await expect(
        service.createProposal(
          USER_ID,
          ROADMAP_ID,
          {
            origin: 'level_change',
            target_level: 'senior',
            base_version_no: 3,
          },
          { acceptLanguage: 'en-US' },
        ),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'MERGE_ALREADY_PROPOSED');
        return true;
      });
    });
  });

  describe('EP-R09 listProposals', () => {
    it('lists ai_proposal, level_change, and user_request rows with cursor pagination and undo_available', async () => {
      const dbQuery = vi.fn(async (sql: string) => {
        if (sql.includes('FROM public.roadmaps')) {
          return [{ id: ROADMAP_ID, status: 'locked' }];
        }
        if (sql.includes('FROM public.roadmap_merges rm')) {
          // limit=2 -> returns 3 rows to trigger next_cursor
          return [
            {
              id: MERGE_ID_1,
              roadmap_id: ROADMAP_ID,
              origin: 'ai_proposal',
              status: 'proposed',
              base_version_no: 3,
              target_level: null,
              reason: 'New Node.js LTS update',
              materially_large: false,
              undo_window_closed_at: null,
              created_at: '2026-11-23T10:00:00.000Z',
              created_at_cursor: '2026-11-23T10:00:00.000000Z',
              accepted_at: null,
              rejected_at: null,
              undone_at: null,
            },
            {
              id: MERGE_ID_2,
              roadmap_id: ROADMAP_ID,
              origin: 'level_change',
              status: 'accepted',
              base_version_no: 2,
              target_level: 'senior',
              reason: 'Level upgrade',
              materially_large: true,
              undo_window_closed_at: null,
              created_at: '2026-11-22T10:00:00.000Z',
              created_at_cursor: '2026-11-22T10:00:00.000000Z',
              accepted_at: '2026-11-22T10:05:00.000Z',
              rejected_at: null,
              undone_at: null,
            },
            {
              id: '88888888-1111-4111-8111-111111111111',
              roadmap_id: ROADMAP_ID,
              origin: 'user_request',
              status: 'rejected',
              base_version_no: 1,
              target_level: null,
              reason: 'Old rejected merge',
              materially_large: false,
              undo_window_closed_at: null,
              created_at: '2026-11-21T10:00:00.000Z',
              created_at_cursor: '2026-11-21T10:00:00.000000Z',
              accepted_at: null,
              rejected_at: '2026-11-21T10:10:00.000Z',
              undone_at: null,
            },
          ];
        }
        return [];
      });

      const service = new RoadmapMergeService(
        {
          transaction: vi.fn(async (_u, fn) => fn({ query: dbQuery })),
        } as unknown as DatabaseService,
        {} as JobProducerService,
      );

      const page = await service.listProposals(USER_ID, ROADMAP_ID, {
        limit: 2,
      });

      expect(page.items).toHaveLength(2);
      expect(page.items[0]).toMatchObject({
        id: MERGE_ID_1,
        origin: 'ai_proposal',
        status: 'proposed',
        undo_available: false,
      });
      expect(page.items[1]).toMatchObject({
        id: MERGE_ID_2,
        origin: 'level_change',
        status: 'accepted',
        undo_available: true,
      });
      expect(page.meta.limit).toBe(2);
      expect(page.meta.next_cursor).toBeTruthy();
    });

    it('reports undo_available=false on EP-R09 when plan_revision moved past reconciled_plan_revision or a plan was created post-merge', async () => {
      const RESULT_VER = 'dddd1111-1111-4111-8111-111111111111';
      const makeListService = (
        undoSnapshot: unknown,
        planRow: { id: string; plan_revision: number } | null,
      ) => {
        const dbQuery = vi.fn(async (sql: string) => {
          if (sql.includes('FROM public.roadmaps')) {
            return [
              {
                id: ROADMAP_ID,
                status: 'locked',
                current_version_id: RESULT_VER,
              },
            ];
          }
          if (sql.includes('FROM public.roadmap_merges rm')) {
            return [
              {
                id: MERGE_ID_2,
                roadmap_id: ROADMAP_ID,
                origin: 'user_request',
                status: 'accepted',
                base_version_no: 2,
                result_version_id: RESULT_VER,
                target_level: null,
                reason: 'Added observability',
                materially_large: false,
                undo_snapshot: undoSnapshot,
                undo_window_closed_at: null,
                created_at: '2026-11-22T10:00:00.000Z',
                accepted_at: '2026-11-22T10:05:00.000Z',
                rejected_at: null,
                undone_at: null,
              },
            ];
          }
          if (sql.includes('FROM public.daily_plans')) {
            return planRow ? [planRow] : [];
          }
          return [];
        });
        return new RoadmapMergeService(
          {
            transaction: vi.fn(async (_u, fn) => fn({ query: dbQuery })),
          } as unknown as DatabaseService,
          {} as JobProducerService,
        );
      };

      // Rebuilt plan: plan_revision (3) !== reconciled_plan_revision (2) -> undo_available: false
      const rebuilt = await makeListService(
        {
          daily_plan: {
            plan_id: PLAN_ID,
            plan_revision: 1,
            reconciled_plan_revision: 2,
          },
        },
        { id: PLAN_ID, plan_revision: 3 },
      ).listProposals(USER_ID, ROADMAP_ID, {});
      expect(rebuilt.items[0]?.undo_available).toBe(false);

      // Plan created post-merge (daily_plan snapshot was null) -> undo_available: false
      const createdAfter = await makeListService(
        { daily_plan: null },
        { id: PLAN_ID, plan_revision: 1 },
      ).listProposals(USER_ID, ROADMAP_ID, {});
      expect(createdAfter.items[0]?.undo_available).toBe(false);

      // Unchanged reconciled revision (2 === 2) -> undo_available: true
      const matching = await makeListService(
        {
          daily_plan: {
            plan_id: PLAN_ID,
            plan_revision: 1,
            reconciled_plan_revision: 2,
          },
        },
        { id: PLAN_ID, plan_revision: 2 },
      ).listProposals(USER_ID, ROADMAP_ID, {});
      expect(matching.items[0]?.undo_available).toBe(true);
    });

    it('preserves microsecond precision across keyset cursor pagination on EP-R09 without skipping rows', async () => {
      const microTs1 = '2026-11-23T10:00:00.123456Z';
      const microTs2 = '2026-11-23T10:00:00.123111Z';
      const capturedParams: unknown[][] = [];

      const dbQuery = vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM public.roadmaps')) {
          return [{ id: ROADMAP_ID, status: 'locked' }];
        }
        if (sql.includes('FROM public.roadmap_merges rm')) {
          capturedParams.push(params ?? []);
          if (capturedParams.length === 1) {
            return [
              {
                id: MERGE_ID_1,
                roadmap_id: ROADMAP_ID,
                origin: 'user_request',
                status: 'rejected',
                base_version_no: 2,
                target_level: null,
                reason: 'Row 1',
                materially_large: false,
                undo_window_closed_at: null,
                created_at: new Date('2026-11-23T10:00:00.123Z'),
                created_at_cursor: microTs1,
                accepted_at: null,
                rejected_at: microTs1,
                undone_at: null,
              },
              {
                id: MERGE_ID_2,
                roadmap_id: ROADMAP_ID,
                origin: 'user_request',
                status: 'rejected',
                base_version_no: 1,
                target_level: null,
                reason: 'Row 2',
                materially_large: false,
                undo_window_closed_at: null,
                created_at: new Date('2026-11-23T10:00:00.123Z'),
                created_at_cursor: microTs2,
                accepted_at: null,
                rejected_at: microTs2,
                undone_at: null,
              },
            ];
          }
          return [
            {
              id: MERGE_ID_2,
              roadmap_id: ROADMAP_ID,
              origin: 'user_request',
              status: 'rejected',
              base_version_no: 1,
              target_level: null,
              reason: 'Row 2',
              materially_large: false,
              undo_window_closed_at: null,
              created_at: new Date('2026-11-23T10:00:00.123Z'),
              created_at_cursor: microTs2,
              accepted_at: null,
              rejected_at: microTs2,
              undone_at: null,
            },
          ];
        }
        return [];
      });

      const service = new RoadmapMergeService(
        {
          transaction: vi.fn(async (_u, fn) => fn({ query: dbQuery })),
        } as unknown as DatabaseService,
        {} as JobProducerService,
      );

      const page1 = await service.listProposals(USER_ID, ROADMAP_ID, {
        limit: 1,
      });
      expect(page1.items.map((i) => i.id)).toEqual([MERGE_ID_1]);
      expect(page1.meta.next_cursor).toBeTruthy();

      const page2 = await service.listProposals(USER_ID, ROADMAP_ID, {
        limit: 1,
        cursor: page1.meta.next_cursor as string,
      });
      expect(page2.items.map((i) => i.id)).toEqual([MERGE_ID_2]);
      expect(capturedParams[1]).toContain(microTs1);
      expect(capturedParams[1]).toContain(MERGE_ID_1);
    });
  });

  describe('EP-R10 getProposal', () => {
    it('returns full MergeProposalDTO with live daily_plan_impact for proposed merges and persisted impact for accepted merges', async () => {
      const dbQuery = vi.fn(async (sql: string) => {
        if (sql.includes('FROM public.roadmap_merges rm')) {
          return [
            {
              id: MERGE_ID_1,
              roadmap_id: ROADMAP_ID,
              roadmap_status: 'locked',
              origin: 'user_request',
              status: 'proposed',
              base_version_id: VERSION_ID,
              base_version_no: 2,
              result_version_id: null,
              target_level: null,
              instruction: 'Add tracing',
              reason: 'Improves observability',
              size_before: 44,
              size_after: 46,
              materially_large: true,
              daily_plan_impact: {
                has_active_plan: true,
                completed_days_unchanged: 1,
                future_days_affected: 1,
              },
              accepted_at: null,
              rejected_at: null,
              undone_at: null,
              undo_window_closed_at: null,
              created_at: '2026-11-23T10:00:00.000Z',
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_merge_items')) {
          return [
            {
              id: 'op-1',
              sort_order: 1,
              op: 'add_topic',
              lineage_id: null,
              topic_id: TOPIC_ID,
              skill_id: SKILL_ID,
              title: 'OpenTelemetry',
              topic_title: 'OpenTelemetry',
              base_title: null,
              priority: 'supporting',
              reason: 'Observability gap',
              payload: { estimated_effort_hours: 4 },
            },
            {
              id: 'op-2',
              sort_order: 2,
              op: 'retire_topic',
              lineage_id: LINEAGE_ID,
              topic_id: TOPIC_ID,
              skill_id: SKILL_ID,
              title: null,
              topic_title: null,
              base_title: 'Legacy XML RPC',
              priority: null,
              reason: 'No longer recommended',
              payload: {},
            },
          ];
        }
        if (sql.includes('FROM public.system_configurations')) {
          return [{ config_value: 45 }];
        }
        if (sql.includes('FROM public.daily_plans')) {
          return [{ id: PLAN_ID, hours_per_day: '2.0', status: 'active' }];
        }
        if (sql.includes('FROM public.daily_plan_items')) {
          return [
            {
              id: 'dpi-1',
              day_no: 1,
              lineage_id: LINEAGE_ID,
              status: 'completed',
            },
            {
              id: 'dpi-2',
              day_no: 2,
              lineage_id: 'aaaa2222-2222-4222-8222-222222222222',
              status: 'completed',
            },
            {
              id: 'dpi-3',
              day_no: 3,
              lineage_id: 'aaaa3333-3333-4333-8333-333333333333',
              status: 'pending',
            },
          ];
        }
        if (sql.includes('FROM public.quiz_attempts')) return [];
        if (sql.includes('FROM public.ai_requests')) return [];
        return [];
      });

      const service = new RoadmapMergeService(
        {
          transaction: vi.fn(async (_u, fn) => fn({ query: dbQuery })),
        } as unknown as DatabaseService,
        {} as JobProducerService,
      );

      const detail = await service.getProposal(USER_ID, ROADMAP_ID, MERGE_ID_1);
      expect(detail.operations).toHaveLength(2);
      expect(detail.operations[0]).toMatchObject({
        op: 'add_topic',
        item_id: null,
        topic_id: TOPIC_ID,
        skill_id: SKILL_ID,
        title: 'OpenTelemetry',
      });
      expect(detail.operations[1]).toMatchObject({
        op: 'retire_topic',
        item_id: LINEAGE_ID,
        title: 'Legacy XML RPC',
      });
      expect(detail.size_impact).toMatchObject({
        active_topics_before: 44,
        active_topics_after: 46,
        before: 44,
        after: 46,
        delta: 2,
        soft_limit: 45,
        materially_large: true,
      });
      // Live preview reflects 2 completed days (not stale persisted 1)
      expect(detail.daily_plan_impact).toEqual({
        has_active_plan: true,
        completed_days_unchanged: 2,
        future_days_affected: 2,
      });
      expect(detail.undo_available).toBe(false);
    });

    it('reports undo_available=false on EP-R10 when plan_revision moved past reconciled_plan_revision and propagates DB config errors', async () => {
      const RESULT_VER = 'dddd1111-1111-4111-8111-111111111111';
      const dbQuery = vi.fn(async (sql: string) => {
        if (sql.includes('FROM public.roadmap_merges rm')) {
          return [
            {
              id: MERGE_ID_1,
              roadmap_id: ROADMAP_ID,
              roadmap_status: 'locked',
              roadmap_current_version_id: RESULT_VER,
              origin: 'user_request',
              status: 'accepted',
              base_version_id: VERSION_ID,
              base_version_no: 2,
              result_version_id: RESULT_VER,
              target_level: null,
              instruction: 'Add tracing',
              reason: 'Improves observability',
              size_before: 10,
              size_after: 11,
              materially_large: false,
              daily_plan_impact: {
                has_active_plan: true,
                completed_days_unchanged: 1,
                future_days_affected: 1,
              },
              undo_snapshot: {
                daily_plan: {
                  plan_id: PLAN_ID,
                  plan_revision: 1,
                  reconciled_plan_revision: 2,
                },
              },
              accepted_at: '2026-11-23T10:05:00.000Z',
              rejected_at: null,
              undone_at: null,
              undo_window_closed_at: null,
              created_at: '2026-11-23T10:00:00.000Z',
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_merge_items')) return [];
        if (sql.includes('FROM public.system_configurations')) {
          return [{ config_value: 45 }];
        }
        if (sql.includes('FROM public.daily_plans')) {
          return [{ id: PLAN_ID, plan_revision: 3 }];
        }
        return [];
      });

      const service = new RoadmapMergeService(
        {
          transaction: vi.fn(async (_u, fn) => fn({ query: dbQuery })),
        } as unknown as DatabaseService,
        {} as JobProducerService,
      );

      const detail = await service.getProposal(USER_ID, ROADMAP_ID, MERGE_ID_1);
      expect(detail.undo_available).toBe(false);

      // DB statement errors in readBoundedConfigInteger must propagate rather than be swallowed inside a tx
      const errDbQuery = vi.fn(async (sql: string) => {
        if (sql.includes('FROM public.roadmap_merges rm')) {
          return [
            {
              id: MERGE_ID_1,
              roadmap_id: ROADMAP_ID,
              roadmap_status: 'locked',
              roadmap_current_version_id: RESULT_VER,
              origin: 'user_request',
              status: 'accepted',
              base_version_id: VERSION_ID,
              base_version_no: 2,
              result_version_id: RESULT_VER,
              target_level: null,
              instruction: null,
              reason: null,
              size_before: 10,
              size_after: 11,
              materially_large: false,
              daily_plan_impact: {},
              undo_snapshot: null,
              accepted_at: '2026-11-23T10:05:00.000Z',
              rejected_at: null,
              undone_at: null,
              undo_window_closed_at: null,
              created_at: '2026-11-23T10:00:00.000Z',
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_merge_items')) return [];
        if (sql.includes('FROM public.system_configurations')) {
          throw new Error('statement timeout');
        }
        return [];
      });
      const errService = new RoadmapMergeService(
        {
          transaction: vi.fn(async (_u, fn) => fn({ query: errDbQuery })),
        } as unknown as DatabaseService,
        {} as JobProducerService,
      );
      await expect(
        errService.getProposal(USER_ID, ROADMAP_ID, MERGE_ID_1),
      ).rejects.toThrow('statement timeout');
    });
  });

  describe('EP-R12 rejectProposal', () => {
    it('transitions proposed -> rejected with rejected_at without mutating roadmap versions or daily plans', async () => {
      const queriesExecuted: string[] = [];
      const dbQuery = vi.fn(async (sql: string) => {
        queriesExecuted.push(sql);
        if (sql.includes('FROM public.roadmaps')) {
          return [{ id: ROADMAP_ID, status: 'locked' }];
        }
        if (sql.includes('FROM public.roadmap_merges')) {
          return [{ id: MERGE_ID_1, status: 'proposed' }];
        }
        if (sql.includes('UPDATE public.roadmap_merges')) {
          return [
            [{ id: MERGE_ID_1, rejected_at: '2026-11-23T12:00:00.000Z' }],
            1,
          ];
        }
        return [];
      });

      const service = new RoadmapMergeService(
        {
          transaction: vi.fn(async (_u, fn) => fn({ query: dbQuery })),
        } as unknown as DatabaseService,
        {} as JobProducerService,
      );

      const res = await service.rejectProposal(USER_ID, ROADMAP_ID, MERGE_ID_1);
      expect(res).toEqual({
        merge_id: MERGE_ID_1,
        status: 'rejected',
        rejected_at: '2026-11-23T12:00:00.000Z',
      });
      expect(
        queriesExecuted.some(
          (q) =>
            q.includes('roadmap_versions') ||
            q.includes('daily_plans') ||
            q.includes('daily_plan_items'),
        ),
      ).toBe(false);
    });

    it('returns 409 MERGE_NOT_PENDING when rejecting a non-proposed merge', async () => {
      const dbQuery = vi.fn(async (sql: string) => {
        if (sql.includes('FROM public.roadmaps')) {
          return [{ id: ROADMAP_ID, status: 'locked' }];
        }
        if (sql.includes('FROM public.roadmap_merges')) {
          return [{ id: MERGE_ID_1, status: 'accepted' }];
        }
        return [];
      });

      const service = new RoadmapMergeService(
        {
          transaction: vi.fn(async (_u, fn) => fn({ query: dbQuery })),
        } as unknown as DatabaseService,
        {} as JobProducerService,
      );

      await expect(
        service.rejectProposal(USER_ID, ROADMAP_ID, MERGE_ID_1),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'MERGE_NOT_PENDING');
        return true;
      });
    });
  });

  describe('EP-R11 acceptProposal & EP-R13 undoLastMerge', () => {
    const BASE_VERSION_ID = VERSION_ID;
    const RESULT_VERSION_ID = 'dddd1111-1111-4111-8111-111111111111';
    const GOAL_ID = 'eeee1111-1111-4111-8111-111111111111';
    const LINEAGE_2 = 'aaaa2222-2222-4222-8222-222222222222';
    const NEW_LINEAGE = 'aaaa9999-9999-4999-8999-999999999999';
    const NEW_TOPIC = 'bbbb9999-9999-4999-8999-999999999999';
    const TOPIC_2 = 'bbbb2222-2222-4222-8222-222222222222';

    function setup(
      opts: {
        origin?: 'user_request' | 'level_change';
        materiallyLarge?: boolean;
        sizeAfter?: number | null;
        softSizeMaxTopics?: number;
        currentVersionNo?: number;
        hasPlan?: boolean;
        planRevision?: number;
        roadmapStatus?: string;
        undoMerge?: Record<string, unknown> | null;
        startedAttempt?: boolean;
      } = {},
    ) {
      const log: Array<{ sql: string; params?: unknown[] }> = [];
      const reconciler = {
        reconcileForMergeInTx: vi.fn().mockResolvedValue({
          undoSnapshot: {
            plan_id: PLAN_ID,
            roadmap_version_id: BASE_VERSION_ID,
            status: 'active',
            plan_revision: 1,
            reconciled_plan_revision: 2,
            items: [],
          },
          dailyPlanImpact: {
            has_active_plan: true,
            completed_days_unchanged: 2,
            future_days_affected: 1,
          },
        }),
        restoreFromUndoSnapshotInTx: vi.fn().mockResolvedValue(undefined),
      };
      const hasPlan = opts.hasPlan ?? true;
      const dbQuery = vi.fn(async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        if (sql.includes('FROM public.daily_plans')) {
          return hasPlan
            ? [
                {
                  id: PLAN_ID,
                  ...(opts.planRevision !== undefined
                    ? { plan_revision: opts.planRevision }
                    : {}),
                },
              ]
            : [];
        }
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: opts.roadmapStatus ?? 'locked',
              target_level: 'mid',
              career_goal_id: GOAL_ID,
              current_version_id:
                opts.undoMerge !== undefined
                  ? RESULT_VERSION_ID
                  : BASE_VERSION_ID,
            },
          ];
        }
        if (
          sql.includes("status = 'accepted'::public.merge_status") &&
          sql.includes('SELECT id')
        ) {
          return opts.undoMerge ? [opts.undoMerge] : [];
        }
        if (sql.includes('FROM public.quiz_attempts qa')) {
          return opts.startedAttempt ? [{ id: 'qa-1' }] : [];
        }
        if (sql.includes('FROM public.roadmap_merge_items')) {
          return [
            {
              sort_order: 1,
              op: 'reprioritize',
              lineage_id: LINEAGE_2,
              topic_id: null,
              title: null,
              priority: 'core',
              reason: 'Raise',
              payload: {},
            },
            {
              sort_order: 2,
              op: 'add_topic',
              lineage_id: null,
              topic_id: NEW_TOPIC,
              title: 'Tracing',
              priority: 'supporting',
              reason: 'Gap',
              payload: {
                provisional_lineage_id: NEW_LINEAGE,
                skill_id: SKILL_ID,
                estimated_effort_hours: 2,
              },
            },
          ];
        }
        if (sql.includes('FROM public.system_configurations')) {
          return opts.softSizeMaxTopics !== undefined
            ? [{ config_value: opts.softSizeMaxTopics }]
            : [];
        }
        if (sql.includes('FROM public.roadmap_merges')) {
          return [
            {
              id: MERGE_ID_1,
              status: 'proposed',
              origin: opts.origin ?? 'user_request',
              base_version_id: BASE_VERSION_ID,
              target_level: opts.origin === 'level_change' ? 'senior' : null,
              size_after: opts.sizeAfter ?? 3,
              materially_large: opts.materiallyLarge ?? false,
            },
          ];
        }
        if (sql.includes('INSERT INTO public.roadmap_versions')) {
          return [[{ id: RESULT_VERSION_ID }], 1];
        }
        if (sql.includes('SELECT COALESCE(MAX(version_no)')) {
          return [{ next_no: 4 }];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [
            { id: BASE_VERSION_ID, version_no: opts.currentVersionNo ?? 3 },
          ];
        }
        if (sql.includes('FROM public.roadmap_items')) {
          return [
            {
              lineage_id: LINEAGE_ID,
              topic_id: TOPIC_ID,
              skill_id: SKILL_ID,
              phase_no: 1,
              phase_title: 'P1',
              title: 'SQL',
              priority: 'core',
              gap_type: 'missing',
              required_depth: null,
              estimated_effort_hours: '2.0',
              sequence_no: 1,
              depends_on_lineage_ids: [],
              reason: null,
              retired: false,
              retired_at: null,
              sources: [],
            },
            {
              lineage_id: LINEAGE_2,
              topic_id: TOPIC_2,
              skill_id: SKILL_ID,
              phase_no: 1,
              phase_title: 'P1',
              title: 'Tuning',
              priority: 'optional',
              gap_type: 'missing',
              required_depth: null,
              estimated_effort_hours: '2.0',
              sequence_no: 2,
              depends_on_lineage_ids: [LINEAGE_ID],
              reason: null,
              retired: false,
              retired_at: null,
              sources: [],
            },
          ];
        }
        if (sql.includes("SET state = 'restored'")) {
          return [[{ id: BASE_VERSION_ID, version_no: 3 }], 1];
        }
        if (
          sql.includes("SET state = 'superseded'") &&
          sql.includes('RETURNING')
        ) {
          return [[{ id: RESULT_VERSION_ID }], 1];
        }
        return [];
      });
      const service = new RoadmapMergeService(
        {
          transaction: vi.fn(async (_u, fn) => fn({ query: dbQuery })),
        } as unknown as DatabaseService,
        {} as JobProducerService,
        reconciler as never,
      );
      return { service, log, reconciler };
    }

    const idx = (log: Array<{ sql: string }>, needle: string) =>
      log.findIndex((c) => c.sql.includes(needle));

    it('EP-R11 accepts atomically: strict lock order, closes prior undo window first, new locked version, reconciles plan', async () => {
      const { service, log, reconciler } = setup();
      const res = await service.acceptProposal(
        USER_ID,
        ROADMAP_ID,
        MERGE_ID_1,
        { base_version_no: 3 },
        { ifMatch: 3 },
      );
      expect(res).toEqual({
        roadmap_id: ROADMAP_ID,
        merge_id: MERGE_ID_1,
        new_version_no: 4,
        undo_available: true,
        daily_plan_reconciled: true,
      });

      const plans = idx(log, 'FROM public.daily_plans');
      const roadmaps = idx(log, 'FROM public.roadmaps');
      const merges = idx(log, 'FROM public.roadmap_merges');
      expect(plans).toBeGreaterThan(-1);
      expect(plans).toBeLessThan(roadmaps);
      expect(roadmaps).toBeLessThan(merges);
      expect(log[plans].sql).toContain('FOR UPDATE');
      expect(log[roadmaps].sql).toContain('FOR UPDATE');
      expect(log[merges].sql).toContain('FOR UPDATE');

      const closePrior = idx(log, 'SET undo_window_closed_at');
      const insertVersion = idx(log, 'INSERT INTO public.roadmap_versions');
      const finalUpdate = idx(log, "SET status = 'accepted'");
      expect(closePrior).toBeGreaterThan(merges);
      expect(closePrior).toBeLessThan(insertVersion);
      expect(finalUpdate).toBeGreaterThan(insertVersion);
      const itemInserts = log.filter((c) =>
        c.sql.includes('INSERT INTO public.roadmap_items'),
      );
      expect(itemInserts).toHaveLength(1);
      expect(itemInserts[0].params).toHaveLength(3 * 18);
      expect(log[insertVersion].sql).toContain(
        "'merge'::public.roadmap_version_origin",
      );
      expect(reconciler.reconcileForMergeInTx).toHaveBeenCalledTimes(1);
      const call = reconciler.reconcileForMergeInTx.mock.calls[0][1];
      expect(call.resultVersionId).toBe(RESULT_VERSION_ID);
      expect(call.activeItems).toHaveLength(3);
      // career_goals / skill_progress untouched for user_request
      expect(
        log.some((c) => c.sql.includes('UPDATE public.career_goals')),
      ).toBe(false);
    });

    it('EP-R11 rejects stale versions (409 STALE_VERSION) and missing preconditions (422)', async () => {
      const { service } = setup({ currentVersionNo: 4 });
      await expect(
        service.acceptProposal(USER_ID, ROADMAP_ID, MERGE_ID_1, {
          base_version_no: 3,
        }),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'STALE_VERSION');
        return true;
      });
      await expect(
        service.acceptProposal(USER_ID, ROADMAP_ID, MERGE_ID_1, {}),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 422, 'VALIDATION_FAILED');
        return true;
      });
    });

    it('EP-R11 requires acknowledge_large_expansion when materially_large (409 MERGE_EXPANSION_ACK_REQUIRED)', async () => {
      const { service, log } = setup({ materiallyLarge: true });
      await expect(
        service.acceptProposal(USER_ID, ROADMAP_ID, MERGE_ID_1, {
          base_version_no: 3,
        }),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'MERGE_EXPANSION_ACK_REQUIRED');
        return true;
      });
      expect(
        log.some((c) => c.sql.includes('INSERT INTO public.roadmap_versions')),
      ).toBe(false);

      const ok = setup({ materiallyLarge: true });
      await expect(
        ok.service.acceptProposal(USER_ID, ROADMAP_ID, MERGE_ID_1, {
          base_version_no: 3,
          acknowledge_large_expansion: true,
        }),
      ).resolves.toMatchObject({ new_version_no: 4 });

      // Dynamic drop in roadmap.soft_size_max_topics triggers MERGE_EXPANSION_ACK_REQUIRED even if stored materially_large=false
      const loweredLimit = setup({
        materiallyLarge: false,
        sizeAfter: 3,
        softSizeMaxTopics: 2,
      });
      await expect(
        loweredLimit.service.acceptProposal(USER_ID, ROADMAP_ID, MERGE_ID_1, {
          base_version_no: 3,
        }),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'MERGE_EXPANSION_ACK_REQUIRED');
        return true;
      });
      expect(
        loweredLimit.log.some((c) =>
          c.sql.includes('INSERT INTO public.roadmap_versions'),
        ),
      ).toBe(false);

      const loweredLimitAck = setup({
        materiallyLarge: false,
        sizeAfter: 3,
        softSizeMaxTopics: 2,
      });
      await expect(
        loweredLimitAck.service.acceptProposal(
          USER_ID,
          ROADMAP_ID,
          MERGE_ID_1,
          { base_version_no: 3, acknowledge_large_expansion: true },
        ),
      ).resolves.toMatchObject({ new_version_no: 4 });
    });

    it('EP-R11 level_change moves roadmap + goal level only; never touches skill_progress/learning_evidence or archives', async () => {
      const { service, log } = setup({ origin: 'level_change' });
      await service.acceptProposal(USER_ID, ROADMAP_ID, MERGE_ID_1, {
        base_version_no: 3,
      });
      const goalUpdate = log.find((c) =>
        c.sql.includes('UPDATE public.career_goals'),
      );
      expect(goalUpdate?.params).toEqual([USER_ID, GOAL_ID, 'senior']);
      const roadmapUpdate = log.find((c) =>
        c.sql.includes('UPDATE public.roadmaps'),
      );
      expect(roadmapUpdate?.params?.[3]).toBe('senior');
      expect(roadmapUpdate?.sql).not.toContain("'archived'");
      expect(
        log.some(
          (c) =>
            c.sql.includes('skill_progress') ||
            c.sql.includes('learning_evidence') ||
            c.sql.includes('DELETE FROM'),
        ),
      ).toBe(false);
    });

    it('EP-R13 undoes: locks in order, supersedes result and displaced pending proposals, restores base, restores plan, marks undone', async () => {
      const { service, log, reconciler } = setup({
        planRevision: 2,
        currentVersionNo: 4,
        undoMerge: {
          id: MERGE_ID_1,
          origin: 'level_change',
          base_version_id: BASE_VERSION_ID,
          result_version_id: RESULT_VERSION_ID,
          undo_snapshot: {
            previous_target_level: 'mid',
            daily_plan: {
              plan_id: PLAN_ID,
              roadmap_version_id: BASE_VERSION_ID,
              status: 'active',
              plan_revision: 1,
              reconciled_plan_revision: 2,
              items: [],
            },
          },
        },
      });
      const res = await service.undoLastMerge(USER_ID, ROADMAP_ID, {
        ifMatch: 4,
      });
      expect(res).toEqual({
        restored_version_no: 3,
        merge_id: MERGE_ID_1,
        status: 'undone',
      });
      const plans = idx(log, 'FROM public.daily_plans');
      const roadmaps = idx(log, 'FROM public.roadmaps');
      const merges = idx(log, "status = 'accepted'::public.merge_status");
      expect(plans).toBeLessThan(roadmaps);
      expect(roadmaps).toBeLessThan(merges);
      expect(reconciler.restoreFromUndoSnapshotInTx).toHaveBeenCalledTimes(1);
      const supersedePending = log.find(
        (c) =>
          c.sql.includes('UPDATE public.roadmap_merges') &&
          c.sql.includes("SET status = 'superseded'::public.merge_status"),
      );
      expect(supersedePending?.sql).toContain('base_version_id = $3');
      expect(supersedePending?.params).toEqual([
        USER_ID,
        ROADMAP_ID,
        RESULT_VERSION_ID,
      ]);
      expect(
        log.find((c) => c.sql.includes('UPDATE public.career_goals'))?.params,
      ).toEqual([USER_ID, GOAL_ID, 'mid']);
      const final = log.find((c) => c.sql.includes("SET status = 'undone'"));
      expect(final?.sql).toContain('undone_at = clock_timestamp()');
      expect(final?.sql).toContain('undo_window_closed_at = clock_timestamp()');
    });

    it('EP-R13 honors optional If-Match (409 STALE_VERSION on mismatch) and blocks Undo on post-merge plan changes or started quiz', async () => {
      const matchingUndoMerge = {
        id: MERGE_ID_1,
        origin: 'user_request',
        base_version_id: BASE_VERSION_ID,
        result_version_id: RESULT_VERSION_ID,
        undo_snapshot: {
          daily_plan: {
            plan_id: PLAN_ID,
            roadmap_version_id: BASE_VERSION_ID,
            status: 'active',
            plan_revision: 1,
            reconciled_plan_revision: 2,
            items: [],
          },
        },
      };

      // Stale If-Match -> 409 STALE_VERSION
      const stale = setup({
        currentVersionNo: 5,
        planRevision: 2,
        undoMerge: matchingUndoMerge,
      });
      await expect(
        stale.service.undoLastMerge(USER_ID, ROADMAP_ID, { ifMatch: 4 }),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'STALE_VERSION');
        return true;
      });
      expect(
        stale.reconciler.restoreFromUndoSnapshotInTx,
      ).not.toHaveBeenCalled();

      // No undoable merge -> 409 UNDO_NOT_AVAILABLE
      const none = setup({ undoMerge: null });
      await expect(
        none.service.undoLastMerge(USER_ID, ROADMAP_ID),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'UNDO_NOT_AVAILABLE');
        return true;
      });

      // Started quiz with matching undo_snapshot -> 409 UNDO_NOT_AVAILABLE
      const started = setup({
        startedAttempt: true,
        planRevision: 2,
        undoMerge: matchingUndoMerge,
      });
      await expect(
        started.service.undoLastMerge(USER_ID, ROADMAP_ID),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'UNDO_NOT_AVAILABLE');
        return true;
      });
      expect(
        started.reconciler.restoreFromUndoSnapshotInTx,
      ).not.toHaveBeenCalled();

      // Control case: identical matching undo_snapshot WITHOUT started quiz reaches restoration
      const control = setup({
        startedAttempt: false,
        planRevision: 2,
        undoMerge: matchingUndoMerge,
      });
      await expect(
        control.service.undoLastMerge(USER_ID, ROADMAP_ID),
      ).resolves.toMatchObject({ status: 'undone', restored_version_no: 3 });
      expect(
        control.reconciler.restoreFromUndoSnapshotInTx,
      ).toHaveBeenCalledTimes(1);

      // Post-merge plan rebuild (plan_revision moved past reconciled_plan_revision) -> 409 UNDO_NOT_AVAILABLE
      const rebuiltPlan = setup({
        planRevision: 3,
        undoMerge: matchingUndoMerge,
      });
      await expect(
        rebuiltPlan.service.undoLastMerge(USER_ID, ROADMAP_ID),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'UNDO_NOT_AVAILABLE');
        return true;
      });
      expect(
        rebuiltPlan.reconciler.restoreFromUndoSnapshotInTx,
      ).not.toHaveBeenCalled();

      // Plan created post-merge (daily_plan snapshot was null) -> 409 UNDO_NOT_AVAILABLE
      const postMergePlan = setup({
        planRevision: 1,
        undoMerge: {
          ...matchingUndoMerge,
          undo_snapshot: { daily_plan: null },
        },
      });
      await expect(
        postMergePlan.service.undoLastMerge(USER_ID, ROADMAP_ID),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'UNDO_NOT_AVAILABLE');
        return true;
      });
      expect(
        postMergePlan.reconciler.restoreFromUndoSnapshotInTx,
      ).not.toHaveBeenCalled();
    });
  });
});

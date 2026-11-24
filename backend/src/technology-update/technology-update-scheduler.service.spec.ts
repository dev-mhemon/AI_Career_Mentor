import { ConfigService } from '@nestjs/config';
import type { DataSource, QueryRunner } from 'typeorm';
import type { AiGatewayService } from '../ai/services/ai-gateway.service.js';
import {
  projectLearnerNeutralSharedField,
  TechnologyUpdateSchedulerService,
} from './services/technology-update-scheduler.service.js';
import {
  computeLanguageScopedTechnologyUpdateHash,
  computeTechnologyUpdateContentHash,
  decodeXmlEntitiesOutsideCdata,
  extractXmlElementText,
  MAX_LIVE_FEED_BYTES,
  TechnologySourceFetchError,
  TechnologyUpdateSourceService,
  type ExternalUpdateCandidate,
} from './services/technology-update-source.service.js';

const USER_1 = '11111111-1111-4111-8111-111111111111';
const USER_2 = '22222222-2222-4222-8222-222222222222';
const USER_3 = '33333333-3333-4333-8333-333333333333';
const USER_4 = '44444444-4444-4444-8444-444444444444';
const ROADMAP_1 = '55555555-5555-4555-8555-555555555555';
const SOURCE_1 = '66666666-6666-4666-8666-666666666666';
const UPDATE_1 = '77777777-7777-4777-8777-777777777777';
const GEN_1 = '88888888-8888-4888-8888-888888888888';

interface MockRunnerOptions {
  locked?: boolean;
  postLockRecheck?: {
    status: string;
    active_within_window: boolean;
    has_access: boolean;
    current_timezone: string;
    current_local_date: string;
    outcome_exists: boolean;
  } | null;
  preCommitRecheck?:
    | {
        status: string;
        active_within_window: boolean;
        has_access: boolean;
        current_timezone: string;
        current_local_date: string;
        outcome_exists: boolean;
        lock_still_held: boolean;
      }
    | 'throw_session_lost'
    | null;
  deliveredContentHashes?: string[];
  alreadyDeliveredOnCommitCheck?: boolean;
  deliveryHistoryInserted?: boolean;
}

function createMockQueryRunner(opts: MockRunnerOptions = {}) {
  let recheckCallCount = 0;
  const executedSql: string[] = [];

  const qr = {
    connect: vi.fn(async () => undefined),
    startTransaction: vi.fn(async () => undefined),
    commitTransaction: vi.fn(async () => undefined),
    rollbackTransaction: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string) => {
      executedSql.push(sql);

      if (sql.includes('pg_try_advisory_lock')) {
        return [{ locked: opts.locked ?? true }];
      }
      if (sql.includes('pg_advisory_unlock')) {
        return [{ pg_advisory_unlock: true }];
      }
      if (sql.includes('AS lock_still_held')) {
        recheckCallCount += 1;
        if (recheckCallCount === 1) {
          const post =
            opts.postLockRecheck !== undefined
              ? opts.postLockRecheck
              : {
                  status: 'active',
                  active_within_window: true,
                  has_access: true,
                  current_timezone: 'Asia/Dhaka',
                  current_local_date: '2026-11-24',
                  outcome_exists: false,
                  lock_still_held: true,
                };
          return post ? [post] : [];
        }
        if (opts.preCommitRecheck === 'throw_session_lost') {
          throw new Error('Connection terminated unexpectedly');
        }
        const pre =
          opts.preCommitRecheck !== undefined
            ? opts.preCommitRecheck
            : {
                status: 'active',
                active_within_window: true,
                has_access: true,
                current_timezone: 'Asia/Dhaka',
                current_local_date: '2026-11-24',
                outcome_exists: false,
                lock_still_held: true,
              };
        return pre ? [pre] : [];
      }
      if (
        sql.includes('FROM public.roadmaps r') &&
        sql.includes('is_focus = true')
      ) {
        return [
          {
            id: ROADMAP_1,
            target_level: 'mid',
            role_name: 'Backend Development',
          },
        ];
      }
      if (sql.includes('FROM public.skill_progress sp')) {
        return [
          { canonical_name: 'PostgreSQL' },
          { canonical_name: 'Node.js' },
        ];
      }
      if (
        sql.includes('FROM public.messages m') &&
        sql.includes('FROM public.ai_requests ar')
      ) {
        return [{ language: 'en' }];
      }
      if (sql.includes('FROM public.technology_sources')) {
        return [
          {
            id: SOURCE_1,
            name: 'PostgreSQL Release Notes',
            publisher: 'PostgreSQL Global Development Group',
            base_url: 'https://www.postgresql.org/docs/release/',
            source_type: 'official_release_notes',
            trust_tier: 1,
          },
        ];
      }
      if (
        sql.includes('FROM public.update_delivery_history d') &&
        sql.includes('tu.content_hash')
      ) {
        return (opts.deliveredContentHashes ?? []).map((hash, i) => ({
          update_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          content_hash: hash,
          source_url: null,
        }));
      }
      if (sql.includes('INNER JOIN public.roadmap_items ri')) {
        return [{ title: 'Database Indexing & Vacuum' }];
      }
      if (sql.includes('INSERT INTO public.technology_updates')) {
        return [[{ id: UPDATE_1 }], 1];
      }
      if (sql.includes('INSERT INTO public.update_delivery_history')) {
        return opts.deliveryHistoryInserted === false
          ? [[], 0]
          : [[{ id: '99999999-9999-4999-8999-999999999999' }], 1];
      }
      if (
        sql.includes('SELECT EXISTS') &&
        sql.includes('FROM public.update_delivery_history')
      ) {
        return [{ exists: opts.alreadyDeliveredOnCommitCheck ?? false }];
      }
      return [];
    }),
    executedSql,
  };

  return qr;
}

describe('TechnologyUpdateSchedulerService (R25 Pinned-Session Advisory Lock Protocol)', () => {
  const sampleCandidate: ExternalUpdateCandidate = {
    sourceId: SOURCE_1,
    technologyId: null,
    title: 'PostgreSQL 17.2 Vacuum Improvements',
    summary: 'TidStore reduces vacuum memory overhead.',
    publisher: 'PostgreSQL Global Development Group',
    sourceUrl: 'https://www.postgresql.org/docs/release/17.2/',
    fetchedAt: '2026-11-24T06:00:00.000Z',
    publishedAt: '2026-11-24T00:00:00.000Z',
    releaseStatus: 'released',
    contentHash: computeTechnologyUpdateContentHash({
      sourceUrl: 'https://www.postgresql.org/docs/release/17.2/',
      title: 'PostgreSQL 17.2 Vacuum Improvements',
      summary: 'TidStore reduces vacuum memory overhead.',
    }),
  };

  it('skips candidate cleanly when pg_try_advisory_lock returns false and always releases QueryRunner in finally', async () => {
    const qr = createMockQueryRunner({ locked: false });
    const dataSource = {
      createQueryRunner: vi.fn(() => qr as unknown as QueryRunner),
    } as unknown as DataSource;
    const aiGateway = { execute: vi.fn() } as unknown as AiGatewayService;
    const sourceService = {
      fetchFreshCandidates: vi.fn(),
    } as unknown as TechnologyUpdateSourceService;

    const scheduler = new TechnologyUpdateSchedulerService(
      dataSource,
      aiGateway,
      sourceService,
    );

    const res = await scheduler.processCandidate({
      user_id: USER_1,
      timezone: 'Asia/Dhaka',
      user_local_date: '2026-11-24',
    });

    expect(res).toEqual({
      userId: USER_1,
      localDate: '2026-11-24',
      status: 'skipped_locked',
    });
    expect(sourceService.fetchFreshCandidates).not.toHaveBeenCalled();
    expect(aiGateway.execute).not.toHaveBeenCalled();
    expect(qr.startTransaction).not.toHaveBeenCalled();
    expect(qr.release).toHaveBeenCalledTimes(1);
  });

  it('aborts after acquiring lock when post-lock recheck finds feature disabled, outcome already committed, or inactive user, unlocking in finally', async () => {
    const qr = createMockQueryRunner({
      locked: true,
      postLockRecheck: {
        status: 'active',
        active_within_window: true,
        has_access: false,
        current_timezone: 'Asia/Dhaka',
        current_local_date: '2026-11-24',
        outcome_exists: false,
      },
    });
    const dataSource = {
      createQueryRunner: vi.fn(() => qr as unknown as QueryRunner),
    } as unknown as DataSource;
    const aiGateway = { execute: vi.fn() } as unknown as AiGatewayService;
    const sourceService = {
      fetchFreshCandidates: vi.fn(),
    } as unknown as TechnologyUpdateSourceService;

    const scheduler = new TechnologyUpdateSchedulerService(
      dataSource,
      aiGateway,
      sourceService,
    );

    const res = await scheduler.processCandidate({
      user_id: USER_1,
      timezone: 'Asia/Dhaka',
      user_local_date: '2026-11-24',
    });

    expect(res.status).toBe('skipped_recheck');
    expect(sourceService.fetchFreshCandidates).not.toHaveBeenCalled();
    expect(aiGateway.execute).not.toHaveBeenCalled();
    expect(qr.executedSql.some((s) => s.includes('pg_advisory_unlock'))).toBe(
      true,
    );
    expect(qr.release).toHaveBeenCalledTimes(1);
  });

  it('discards result without inserting any row when timezone/local_date drifts or pinned session is lost during external call (R25)', async () => {
    const qrDrift = createMockQueryRunner({
      locked: true,
      preCommitRecheck: {
        status: 'active',
        active_within_window: true,
        has_access: true,
        current_timezone: 'UTC', // drifted from Asia/Dhaka during external call
        current_local_date: '2026-11-23',
        outcome_exists: false,
        lock_still_held: true,
      },
    });
    const dataSourceDrift = {
      createQueryRunner: vi.fn(() => qrDrift as unknown as QueryRunner),
    } as unknown as DataSource;
    const aiGateway = {
      execute: vi.fn(async () => ({
        generation_id: GEN_1,
        output: {
          has_meaningful_update: true,
          propose_roadmap_merge: false,
          title: sampleCandidate.title,
          what_changed: sampleCandidate.summary,
          why_it_matters: 'Matters for PostgreSQL vacuum.',
          publisher: sampleCandidate.publisher,
          source_url: sampleCandidate.sourceUrl,
          release_status: 'released',
          relevance: 'high',
          action_timing: 'learn_later',
          roadmap_relation: 'Database Operations',
        },
      })),
    } as unknown as AiGatewayService;
    const sourceService = {
      fetchFreshCandidates: vi.fn(async () => [sampleCandidate]),
    } as unknown as TechnologyUpdateSourceService;

    const schedulerDrift = new TechnologyUpdateSchedulerService(
      dataSourceDrift,
      aiGateway,
      sourceService,
    );

    const driftRes = await schedulerDrift.processCandidate({
      user_id: USER_1,
      timezone: 'Asia/Dhaka',
      user_local_date: '2026-11-24',
    });

    expect(driftRes.status).toBe('discarded_drift_or_session_loss');
    expect(qrDrift.startTransaction).not.toHaveBeenCalled();
    expect(
      qrDrift.executedSql.some((s) =>
        s.includes('INSERT INTO public.update_delivery_history'),
      ),
    ).toBe(false);
    expect(
      qrDrift.executedSql.some((s) => s.includes('pg_advisory_unlock')),
    ).toBe(true);
    expect(qrDrift.release).toHaveBeenCalledTimes(1);

    // Also test lost DB session during pre-commit check
    const qrLost = createMockQueryRunner({
      locked: true,
      preCommitRecheck: 'throw_session_lost',
    });
    const dataSourceLost = {
      createQueryRunner: vi.fn(() => qrLost as unknown as QueryRunner),
    } as unknown as DataSource;
    const schedulerLost = new TechnologyUpdateSchedulerService(
      dataSourceLost,
      aiGateway,
      sourceService,
    );

    const lostRes = await schedulerLost.processCandidate({
      user_id: USER_1,
      timezone: 'Asia/Dhaka',
      user_local_date: '2026-11-24',
    });
    expect(lostRes.status).toBe('discarded_drift_or_session_loss');
    expect(qrLost.startTransaction).not.toHaveBeenCalled();
    expect(qrLost.release).toHaveBeenCalledTimes(1);
  });

  it('commits state = temporarily_unavailable (update_id = NULL) when fresh source fetch fails without calling LLM to fabricate stale updates (PRD §40, §46)', async () => {
    const qr = createMockQueryRunner();
    const dataSource = {
      createQueryRunner: vi.fn(() => qr as unknown as QueryRunner),
    } as unknown as DataSource;
    const aiGateway = { execute: vi.fn() } as unknown as AiGatewayService;
    const sourceService = {
      fetchFreshCandidates: vi.fn(async () => {
        throw new TechnologySourceFetchError(
          'SOURCE_TIMEOUT',
          'External feed timed out after 60000ms',
        );
      }),
    } as unknown as TechnologyUpdateSourceService;

    const scheduler = new TechnologyUpdateSchedulerService(
      dataSource,
      aiGateway,
      sourceService,
    );

    const res = await scheduler.processCandidate({
      user_id: USER_1,
      timezone: 'Asia/Dhaka',
      user_local_date: '2026-11-24',
    });

    expect(res).toEqual({
      userId: USER_1,
      localDate: '2026-11-24',
      status: 'committed_temporarily_unavailable',
      updateState: 'temporarily_unavailable',
      updateId: null,
    });
    // CRITICAL PRD §40: Never calls LLM when fresh external sources fail
    expect(aiGateway.execute).not.toHaveBeenCalled();
    expect(qr.startTransaction).toHaveBeenCalledWith('READ COMMITTED');
    expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
    expect(qr.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.update_delivery_history'),
      [USER_1, null, '2026-11-24', 'temporarily_unavailable', 'Asia/Dhaka'],
    );
    expect(qr.executedSql.some((s) => s.includes('pg_advisory_unlock'))).toBe(
      true,
    );
    expect(qr.release).toHaveBeenCalledTimes(1);
  });

  it('commits state = no_important_changes when all candidates match already-delivered content_hash or AI returns has_meaningful_update: false (PRD §39, §45)', async () => {
    // Case A: Candidate content_hash already delivered to this user -> zero LLM call -> no_important_changes
    const qrDedup = createMockQueryRunner({
      deliveredContentHashes: [sampleCandidate.contentHash],
    });
    const dataSourceDedup = {
      createQueryRunner: vi.fn(() => qrDedup as unknown as QueryRunner),
    } as unknown as DataSource;
    const aiGatewayDedup = { execute: vi.fn() } as unknown as AiGatewayService;
    const sourceService = {
      fetchFreshCandidates: vi.fn(async () => [sampleCandidate]),
    } as unknown as TechnologyUpdateSourceService;

    const schedulerDedup = new TechnologyUpdateSchedulerService(
      dataSourceDedup,
      aiGatewayDedup,
      sourceService,
    );

    const dedupRes = await schedulerDedup.processCandidate({
      user_id: USER_1,
      timezone: 'Asia/Dhaka',
      user_local_date: '2026-11-24',
    });

    expect(dedupRes).toEqual({
      userId: USER_1,
      localDate: '2026-11-24',
      status: 'committed_no_important_changes',
      updateState: 'no_important_changes',
      updateId: null,
    });
    expect(aiGatewayDedup.execute).not.toHaveBeenCalled();

    // Case B: AI returns has_meaningful_update: false -> no_important_changes
    const qrNoMeaningful = createMockQueryRunner();
    const dataSourceNoMeaningful = {
      createQueryRunner: vi.fn(() => qrNoMeaningful as unknown as QueryRunner),
    } as unknown as DataSource;
    const aiGatewayNoMeaningful = {
      execute: vi.fn(async () => ({
        generation_id: GEN_1,
        output: {
          has_meaningful_update: false,
          propose_roadmap_merge: false,
          title: null,
          what_changed: null,
          why_it_matters: null,
          publisher: null,
          source_url: null,
          release_status: null,
          relevance: null,
          action_timing: null,
          roadmap_relation: null,
        },
      })),
    } as unknown as AiGatewayService;

    const schedulerNoMeaningful = new TechnologyUpdateSchedulerService(
      dataSourceNoMeaningful,
      aiGatewayNoMeaningful,
      sourceService,
    );

    const noMeaningfulRes = await schedulerNoMeaningful.processCandidate({
      user_id: USER_1,
      timezone: 'Asia/Dhaka',
      user_local_date: '2026-11-24',
    });

    expect(noMeaningfulRes).toEqual({
      userId: USER_1,
      localDate: '2026-11-24',
      status: 'committed_no_important_changes',
      updateState: 'no_important_changes',
      updateId: null,
    });
    expect(qrNoMeaningful.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.update_delivery_history'),
      [USER_1, null, '2026-11-24', 'no_important_changes', 'Asia/Dhaka'],
    );
  });

  it('atomically commits technology_updates, user_update_relevance, and update_delivery_history (state = available) with zero transaction held during AI execution and enforces max 2 pinned connections across runSweep (R25)', async () => {
    let txActiveDuringAiCall = false;
    const runners: ReturnType<typeof createMockQueryRunner>[] = [];

    const dataSource = {
      query: vi.fn(async () => [
        {
          user_id: USER_1,
          timezone: 'Asia/Dhaka',
          user_local_date: '2026-11-24',
        },
        {
          user_id: USER_2,
          timezone: 'Asia/Dhaka',
          user_local_date: '2026-11-24',
        },
        {
          user_id: USER_3,
          timezone: 'Asia/Dhaka',
          user_local_date: '2026-11-24',
        },
        {
          user_id: USER_4,
          timezone: 'Asia/Dhaka',
          user_local_date: '2026-11-24',
        },
      ]),
      createQueryRunner: vi.fn(() => {
        const qr = createMockQueryRunner();
        runners.push(qr);
        return qr as unknown as QueryRunner;
      }),
    } as unknown as DataSource;

    const aiGateway = {
      execute: vi.fn(async () => {
        // Verify NO runner has started a DB transaction while external LLM call is in flight
        if (
          runners.some(
            (r) =>
              r.startTransaction.mock.calls.length >
              r.commitTransaction.mock.calls.length,
          )
        ) {
          txActiveDuringAiCall = true;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          generation_id: GEN_1,
          output: {
            has_meaningful_update: true,
            propose_roadmap_merge: false,
            title: sampleCandidate.title,
            what_changed: sampleCandidate.summary,
            why_it_matters: 'Improves Backend SQL vacuum performance.',
            publisher: sampleCandidate.publisher,
            source_url: sampleCandidate.sourceUrl,
            release_status: 'released',
            relevance: 'high',
            action_timing: 'learn_later',
            roadmap_relation: 'Relates to Database Indexing & Vacuum.',
          },
        };
      }),
    } as unknown as AiGatewayService;

    const sourceService = {
      fetchFreshCandidates: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [sampleCandidate];
      }),
    } as unknown as TechnologyUpdateSourceService;

    const configService = new ConfigService({
      TECH_UPDATE_SCHEDULER_ENABLED: 'false',
      TECH_UPDATE_CONCURRENCY: '2',
      TECH_UPDATE_EXTERNAL_TIMEOUT_MS: '60000',
    });

    const scheduler = new TechnologyUpdateSchedulerService(
      dataSource,
      aiGateway,
      sourceService,
      configService,
    );

    const summary = await scheduler.runSweep();

    expect(txActiveDuringAiCall).toBe(false);
    expect(summary.candidatesFound).toBe(4);
    expect(summary.processed).toBe(4);
    expect(summary.committedAvailable).toBe(4);
    // R25: Max 2 pinned scheduler connections per instance
    expect(summary.maxObservedPinnedConnections).toBeLessThanOrEqual(2);
    expect(scheduler.getActivePinnedConnections()).toBe(0);

    for (const qr of runners) {
      expect(
        qr.executedSql.some((s) =>
          s.includes('INSERT INTO public.technology_updates'),
        ),
      ).toBe(true);
      expect(
        qr.executedSql.some((s) =>
          s.includes('INSERT INTO public.user_update_relevance'),
        ),
      ).toBe(true);
      expect(
        qr.executedSql.some((s) =>
          s.includes('INSERT INTO public.update_delivery_history'),
        ),
      ).toBe(true);
      expect(qr.executedSql.some((s) => s.includes('pg_advisory_unlock'))).toBe(
        true,
      );
      expect(qr.release).toHaveBeenCalledTimes(1);
    }
  });

  it('evaluates subsequent undelivered candidate when the first candidate returns has_meaningful_update: false, keeps citation tied to fetched source, and rolls back if final delivery write inserts 0 rows', async () => {
    const secondCandidate: ExternalUpdateCandidate = {
      ...sampleCandidate,
      title: 'Node.js 24 LTS Security Release',
      summary: 'Critical HTTP/2 and TLS security fixes.',
      publisher: 'Node.js Foundation',
      sourceUrl: 'https://nodejs.org/en/blog/release/v24.0.0',
      contentHash: computeTechnologyUpdateContentHash({
        sourceUrl: 'https://nodejs.org/en/blog/release/v24.0.0',
        title: 'Node.js 24 LTS Security Release',
        summary: 'Critical HTTP/2 and TLS security fixes.',
      }),
    };

    const qr = createMockQueryRunner();
    const dataSource = {
      createQueryRunner: vi.fn(() => qr as unknown as QueryRunner),
    } as unknown as DataSource;

    const aiGateway = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({
          generation_id: GEN_1,
          output: {
            has_meaningful_update: false,
            propose_roadmap_merge: false,
            title: null,
            what_changed: null,
            why_it_matters: null,
            publisher: null,
            source_url: null,
            release_status: null,
            relevance: null,
            action_timing: null,
            roadmap_relation: null,
          },
        })
        .mockResolvedValueOnce({
          generation_id: GEN_1,
          output: {
            has_meaningful_update: true,
            propose_roadmap_merge: false,
            title: secondCandidate.title,
            what_changed: secondCandidate.summary,
            why_it_matters: 'Important for Node.js backend services.',
            publisher: 'Hallucinated Publisher',
            source_url: 'https://evil.example.com/spoofed',
            release_status: 'released',
            relevance: 'high',
            action_timing: 'act_now',
            roadmap_relation: 'Node.js Runtime Security',
          },
        }),
    } as unknown as AiGatewayService;

    const sourceService = {
      fetchFreshCandidates: vi.fn(async () => [
        sampleCandidate,
        secondCandidate,
      ]),
    } as unknown as TechnologyUpdateSourceService;

    const scheduler = new TechnologyUpdateSchedulerService(
      dataSource,
      aiGateway,
      sourceService,
    );

    const res = await scheduler.processCandidate({
      user_id: USER_1,
      timezone: 'Asia/Dhaka',
      user_local_date: '2026-11-24',
    });

    expect(res.status).toBe('committed_available');
    expect(aiGateway.execute).toHaveBeenCalledTimes(2);
    // Verify candidate-scoped idempotency_key uses candidate.contentHash (never positional index 0, 1)
    expect(aiGateway.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        idempotency_key: `tech-update:${USER_1}:2026-11-24:${sampleCandidate.contentHash}`,
      }),
      expect.any(Object),
    );
    expect(aiGateway.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        idempotency_key: `tech-update:${USER_1}:2026-11-24:${secondCandidate.contentHash}`,
      }),
      expect.any(Object),
    );
    // Verify citation persisted from fetched secondCandidate, NOT AI-spoofed URL/publisher
    expect(qr.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.technology_updates'),
      expect.arrayContaining([
        secondCandidate.publisher,
        secondCandidate.sourceUrl,
      ]),
    );

    // If conditional delivery history insert returns 0 rows (date drifted at commit time), transaction rolls back
    const qrRollBack = createMockQueryRunner({
      deliveryHistoryInserted: false,
    });
    const dataSourceRollBack = {
      createQueryRunner: vi.fn(() => qrRollBack as unknown as QueryRunner),
    } as unknown as DataSource;
    const aiGatewaySingle = {
      execute: vi.fn().mockResolvedValueOnce({
        generation_id: GEN_1,
        output: {
          has_meaningful_update: true,
          propose_roadmap_merge: false,
          title: sampleCandidate.title,
          what_changed: sampleCandidate.summary,
          why_it_matters: 'Matters for SQL.',
          publisher: sampleCandidate.publisher,
          source_url: sampleCandidate.sourceUrl,
          release_status: 'released',
          relevance: 'high',
          action_timing: 'learn_later',
          roadmap_relation: null,
        },
      }),
    } as unknown as AiGatewayService;

    const schedulerRollBack = new TechnologyUpdateSchedulerService(
      dataSourceRollBack,
      aiGatewaySingle,
      {
        fetchFreshCandidates: vi.fn(async () => [sampleCandidate]),
      } as unknown as TechnologyUpdateSourceService,
    );

    const rbRes = await schedulerRollBack.processCandidate({
      user_id: USER_1,
      timezone: 'Asia/Dhaka',
      user_local_date: '2026-11-24',
    });
    expect(rbRes.status).toBe('discarded_drift_or_session_loss');
    expect(qrRollBack.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(qrRollBack.commitTransaction).not.toHaveBeenCalled();
  });

  it('TechnologyUpdateSourceService preserves case-sensitive URL path components in contentHash, settles hanging fetchers on timeout, and throws SOURCE_INVALID when a non-empty feed has no valid items', async () => {
    const hashUpper = computeTechnologyUpdateContentHash({
      sourceUrl: 'https://Example.COM/releases/RC?tag=V1',
      title: 'Release Candidate',
      summary: 'Notes',
    });
    const hashLowerHostSamePath = computeTechnologyUpdateContentHash({
      sourceUrl: 'https://example.com/releases/RC?tag=V1',
      title: 'Release Candidate',
      summary: 'Notes',
    });
    const hashLowerPath = computeTechnologyUpdateContentHash({
      sourceUrl: 'https://example.com/releases/rc?tag=v1',
      title: 'Release Candidate',
      summary: 'Notes',
    });
    expect(hashUpper).toBe(hashLowerHostSamePath);
    expect(hashUpper).not.toBe(hashLowerPath);

    // Non-settling custom fetcher rejects promptly when timeoutMs expires
    const hangingService = new TechnologyUpdateSourceService(
      undefined,
      () => new Promise(() => undefined),
    );
    await expect(
      hangingService.fetchFreshCandidates(
        {
          userId: USER_1,
          localDate: '2026-11-24',
          timezone: 'Asia/Dhaka',
          language: 'en',
          focusRoadmap: null,
          skills: [],
          sources: [],
          deliveredContentHashes: new Set(),
        },
        { timeoutMs: 25 },
      ),
    ).rejects.toMatchObject({
      name: 'TechnologySourceFetchError',
      code: 'SOURCE_TIMEOUT',
    });

    // Non-empty feed with invalid timestamps / hostless URLs throws SOURCE_INVALID
    const invalidFeedService = new TechnologyUpdateSourceService(
      undefined,
      async () => [
        {
          title: 'Bad Timestamp Item',
          summary: 'Summary',
          publisher: 'Publisher',
          sourceUrl: 'https://example.com/release',
          fetchedAt: 'not-a-timestamp',
        },
        {
          title: 'Hostless URL Item',
          summary: 'Summary',
          publisher: 'Publisher',
          sourceUrl: 'https://#',
        },
      ],
    );
    await expect(
      invalidFeedService.fetchFreshCandidates({
        userId: USER_1,
        localDate: '2026-11-24',
        timezone: 'Asia/Dhaka',
        language: 'en',
        focusRoadmap: null,
        skills: [],
        sources: [],
        deliveredContentHashes: new Set(),
      }),
    ).rejects.toMatchObject({
      name: 'TechnologySourceFetchError',
      code: 'SOURCE_INVALID',
    });
  });

  it('bounds a never-settling AiGatewayService.execute call within TECH_UPDATE_EXTERNAL_TIMEOUT_MS and releases the R25 pinned session advisory lock & QueryRunner', async () => {
    const qr = createMockQueryRunner();
    const dataSource = {
      createQueryRunner: vi.fn(() => qr as unknown as QueryRunner),
    } as unknown as DataSource;

    const hangingAiGateway = {
      execute: vi.fn(() => new Promise(() => undefined)),
    } as unknown as AiGatewayService;

    const sourceService = {
      fetchFreshCandidates: vi.fn(async () => [sampleCandidate]),
    } as unknown as TechnologyUpdateSourceService;

    const configService = new ConfigService({
      TECH_UPDATE_SCHEDULER_ENABLED: 'false',
      TECH_UPDATE_CONCURRENCY: '2',
      TECH_UPDATE_EXTERNAL_TIMEOUT_MS: '1000',
    });

    const scheduler = new TechnologyUpdateSchedulerService(
      dataSource,
      hangingAiGateway,
      sourceService,
      configService,
    );

    const res = await scheduler.processCandidate({
      user_id: USER_1,
      timezone: 'Asia/Dhaka',
      user_local_date: '2026-11-24',
    });

    expect(res).toEqual({
      userId: USER_1,
      localDate: '2026-11-24',
      status: 'committed_temporarily_unavailable',
      updateState: 'temporarily_unavailable',
      updateId: null,
    });
    expect(qr.executedSql.some((s) => s.includes('pg_advisory_unlock'))).toBe(
      true,
    );
    expect(qr.release).toHaveBeenCalledTimes(1);
    expect(scheduler.getActivePinnedConnections()).toBe(0);
  });

  it('live source ingestion cancels discarded non-2xx bodies, falls back across malformed sources, throws when all sources fail/malform, and decodes XML entities in RSS/Atom <link> elements outside CDATA', async () => {
    const cancelSpy = vi.fn(async () => undefined);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      // Source 1: 503 with unread body -> must cancel body
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        body: { cancel: cancelSpy },
      } as unknown as Response)
      // Source 2: 200 OK but malformed JSON -> must NOT mark anySourceSucceeded = true
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{corrupt_json',
      } as unknown as Response)
      // Source 3: 200 OK valid RSS with XML entity &amp; in <link> and literal CDATA in <link>
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => `<?xml version="1.0" encoding="UTF-8"?>
          <rss version="2.0">
            <channel>
              <item>
                <title>PostgreSQL 17 &amp; TidStore</title>
                <description><![CDATA[Improved vacuum memory &amp; literal CDATA kept]]></description>
                <link>https://example.test/release?v=1&amp;lang=en</link>
                <pubDate>Tue, 24 Nov 2026 06:00:00 GMT</pubDate>
              </item>
            </channel>
          </rss>`,
      } as unknown as Response);

    const liveConfig = new ConfigService({
      TECH_UPDATE_SOURCE_MODE: 'live',
      TECH_UPDATE_EXTERNAL_TIMEOUT_MS: '5000',
    });
    const liveService = new TechnologyUpdateSourceService(liveConfig);

    const threeSources = [
      {
        id: SOURCE_1,
        name: 'Source 1',
        publisher: 'Pub 1',
        base_url: 'https://s1.example.test/feed',
        source_type: 'official_release_notes' as const,
        trust_tier: 1,
      },
      {
        id: SOURCE_1,
        name: 'Source 2',
        publisher: 'Pub 2',
        base_url: 'https://s2.example.test/feed.json',
        source_type: 'official_release_notes' as const,
        trust_tier: 1,
      },
      {
        id: SOURCE_1,
        name: 'Source 3',
        publisher: 'Pub 3',
        base_url: 'https://s3.example.test/rss.xml',
        source_type: 'official_release_notes' as const,
        trust_tier: 1,
      },
    ];

    const candidates = await liveService.fetchFreshCandidates({
      userId: USER_1,
      localDate: '2026-11-24',
      timezone: 'Asia/Dhaka',
      language: 'en',
      focusRoadmap: null,
      skills: [],
      sources: threeSources,
      deliveredContentHashes: new Set(),
    });

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.title).toBe('PostgreSQL 17 & TidStore');
    expect(candidates[0]?.summary).toBe(
      'Improved vacuum memory &amp; literal CDATA kept',
    );
    expect(candidates[0]?.sourceUrl).toBe(
      'https://example.test/release?v=1&lang=en',
    );

    //When all sources fail or return malformed payloads, liveService throws SOURCE_UNAVAILABLE
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '<html>Not an RSS or JSON feed</html>',
    } as unknown as Response);

    await expect(
      liveService.fetchFreshCandidates({
        userId: USER_1,
        localDate: '2026-11-24',
        timezone: 'Asia/Dhaka',
        language: 'en',
        focusRoadmap: null,
        skills: [],
        sources: [threeSources[0]],
        deliveredContentHashes: new Set(),
      }),
    ).rejects.toMatchObject({
      name: 'TechnologySourceFetchError',
      code: 'SOURCE_UNAVAILABLE',
    });

    fetchSpy.mockRestore();
  });

  it('enforces schema-contract SQL for Focus Roadmap items and language, objsubid = 2 advisory lock ownership, language-scoped content_hash, streaming byte cap, single-pass XML entity decoding, and CDATA tag preservation', async () => {
    // 1. Single-pass XML entity decoding (`&#38;amp;` -> literal `&amp;`, never double-decoded to `&`) & CDATA `<Widget>` tag preservation
    expect(decodeXmlEntitiesOutsideCdata('v=1&#38;amp;lang=en')).toBe(
      'v=1&amp;lang=en',
    );
    expect(
      extractXmlElementText(
        '<b>Release:</b> <![CDATA[Supports <Widget> &amp; fast UI]]> <i>today</i>',
        ' ',
      ),
    ).toBe('Release: Supports <Widget> &amp; fast UI today');

    // 2. Language-scoped content_hash prevents Bangla vs English collision on shared technology_updates rows
    const baseHash = sampleCandidate.contentHash;
    const enHash = computeLanguageScopedTechnologyUpdateHash('en', baseHash);
    const bnHash = computeLanguageScopedTechnologyUpdateHash('bn', baseHash);
    expect(enHash).not.toBe(bnHash);
    expect(
      computeTechnologyUpdateContentHash({
        sourceUrl: sampleCandidate.sourceUrl,
        title: sampleCandidate.title,
        summary: sampleCandidate.summary,
        language: 'bn',
      }),
    ).toBe(bnHash);

    // 2b. projectLearnerNeutralSharedField strips learner-specific roadmap/role leakage from shared title/what_changed
    expect(
      projectLearnerNeutralSharedField(
        'PostgreSQL 17 vacuum changes tailored for your Focus Roadmap',
        sampleCandidate.summary,
        {
          focusRoadmap: {
            id: ROADMAP_1,
            roleName: 'Backend Development',
            targetLevel: 'mid',
            activeTopics: ['Database Indexing & Vacuum'],
          },
        },
      ),
    ).toBe(sampleCandidate.summary);
    expect(
      projectLearnerNeutralSharedField(
        'PostgreSQL 17.2 रिलीज নোটস ও ভ্যাকুয়াম মেমরি উন্নয়ন',
        sampleCandidate.title,
        {
          focusRoadmap: {
            id: ROADMAP_1,
            roleName: 'Backend Development',
            targetLevel: 'mid',
            activeTopics: ['Database Indexing & Vacuum'],
          },
        },
      ),
    ).toBe('PostgreSQL 17.2 रिलीज নোটস ও ভ্যাকুয়াম মেমরি উন্নয়ন');

    // 3. Schema-contract SQL check on executed queries:
    // - Focus Roadmap items query uses r.current_version_id, ri.version_id, ri.retired = false, ORDER BY ri.phase_no ASC, ri.sequence_no ASC
    // - Language query uses public.messages / public.ai_requests (NEVER user_preferences.preferred_ui_language)
    // - Both pg_locks queries enforce objsubid = 2
    const qr = createMockQueryRunner();
    const dataSource = {
      createQueryRunner: vi.fn(() => qr as unknown as QueryRunner),
    } as unknown as DataSource;
    const aiGateway = {
      execute: vi.fn(async () => ({
        generation_id: GEN_1,
        output: {
          has_meaningful_update: true,
          propose_roadmap_merge: false,
          title: sampleCandidate.title,
          what_changed: sampleCandidate.summary,
          why_it_matters: 'Matters for PostgreSQL.',
          publisher: sampleCandidate.publisher,
          source_url: sampleCandidate.sourceUrl,
          release_status: 'released',
          relevance: 'high',
          action_timing: 'learn_later',
          roadmap_relation: 'Database Indexing',
        },
      })),
    } as unknown as AiGatewayService;
    const sourceService = {
      fetchFreshCandidates: vi.fn(async () => [sampleCandidate]),
    } as unknown as TechnologyUpdateSourceService;

    const scheduler = new TechnologyUpdateSchedulerService(
      dataSource,
      aiGateway,
      sourceService,
    );

    const res = await scheduler.processCandidate({
      user_id: USER_1,
      timezone: 'Asia/Dhaka',
      user_local_date: '2026-11-24',
    });
    expect(res.status).toBe('committed_available');

    const roadmapSql = qr.executedSql.find((s) =>
      s.includes('INNER JOIN public.roadmap_items ri'),
    );
    expect(roadmapSql).toBeDefined();
    expect(roadmapSql).toContain('ri.version_id = r.current_version_id');
    expect(roadmapSql).toContain('ri.retired = false');
    expect(roadmapSql).toContain(
      'ORDER BY ri.phase_no ASC, ri.sequence_no ASC',
    );
    expect(roadmapSql).not.toContain('current_version_no');
    expect(roadmapSql).not.toContain('roadmap_version_id');
    expect(roadmapSql).not.toContain('is_retired');
    expect(roadmapSql).not.toContain('display_order');

    expect(
      qr.executedSql.some((s) => s.includes('preferred_ui_language')),
    ).toBe(false);
    expect(
      qr.executedSql.some(
        (s) =>
          s.includes('FROM public.messages m') &&
          s.includes('FROM public.ai_requests ar'),
      ),
    ).toBe(true);

    const pgLocksQueries = qr.executedSql.filter((s) =>
      s.includes('FROM pg_locks'),
    );
    expect(pgLocksQueries.length).toBeGreaterThanOrEqual(2);
    for (const lockQuery of pgLocksQueries) {
      expect(lockQuery).toContain('objsubid = 2');
    }

    // Verify language-scoped contentHash was persisted into public.technology_updates
    expect(qr.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.technology_updates'),
      expect.arrayContaining([enHash]),
    );

    // 3b. Bangla ('bn') learner evaluating the same source candidate persists a distinct language-scoped
    //     content_hash in technology_updates, keeps shared title/what_changed learner-neutral even if the LLM
    //     leaks "for your Focus Roadmap", and stores personalized why_it_matters/roadmap_relation in user_update_relevance
    const qrBn = createMockQueryRunner();
    const origQueryBn = qrBn.query;
    qrBn.query = vi.fn(async (sql: string) => {
      if (
        sql.includes('FROM public.messages m') &&
        sql.includes('FROM public.ai_requests ar')
      ) {
        return [{ language: 'bn' }];
      }
      return origQueryBn(sql);
    });
    const dataSourceBn = {
      createQueryRunner: vi.fn(() => qrBn as unknown as QueryRunner),
    } as unknown as DataSource;
    const aiGatewayBn = {
      execute: vi.fn(async () => ({
        generation_id: GEN_1,
        output: {
          has_meaningful_update: true,
          propose_roadmap_merge: false,
          title: 'PostgreSQL 17.2 ভ্যাকুয়াম মেমরি উন্নয়ন',
          what_changed:
            'TidStore ভ্যাকুয়াম মেমরি ওভারহেড কমায় আপনার ফোকাস রোডম্যাপ এর জন্য।',
          why_it_matters:
            'আপনার ব্যাকএন্ড ডাটাবেস ইনডেক্সিংয়ের জন্য গুরুত্বপূর্ণ।',
          publisher: sampleCandidate.publisher,
          source_url: sampleCandidate.sourceUrl,
          release_status: 'released',
          relevance: 'high',
          action_timing: 'learn_later',
          roadmap_relation: 'Database Indexing & Vacuum টপিকের সাথে সম্পর্কিত।',
        },
      })),
    } as unknown as AiGatewayService;

    const schedulerBn = new TechnologyUpdateSchedulerService(
      dataSourceBn,
      aiGatewayBn,
      sourceService,
    );

    const resBn = await schedulerBn.processCandidate({
      user_id: USER_2,
      timezone: 'Asia/Dhaka',
      user_local_date: '2026-11-24',
    });
    expect(resBn.status).toBe('committed_available');
    expect(qrBn.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.technology_updates'),
      expect.arrayContaining([
        'PostgreSQL 17.2 ভ্যাকুয়াম মেমরি উন্নয়ন',
        sampleCandidate.summary, // projected to neutral source summary when AI leaked "আপনার ফোকাস রোডম্যাপ"
        bnHash,
      ]),
    );
    expect(qrBn.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.user_update_relevance'),
      expect.arrayContaining([
        USER_2,
        UPDATE_1,
        'high',
        'learn_later',
        'আপনার ব্যাকএন্ড ডাটাবেস ইনডেক্সিংয়ের জন্য গুরুত্বপূর্ণ।',
        'Database Indexing & Vacuum টপিকের সাথে সম্পর্কিত।',
      ]),
    );

    // 4. Streaming byte cap (MAX_LIVE_FEED_BYTES) cancels oversized stream and falls back;
    //    non-empty JSON items array with 0 usable entries ([null]) falls back to next source
    const oversizedChunk = new Uint8Array(MAX_LIVE_FEED_BYTES + 1024);
    const readerCancelSpy = vi.fn(async () => undefined);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      // Source 1: Oversized streaming body -> cancelled via reader.cancel()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: vi
              .fn()
              .mockResolvedValueOnce({ done: false, value: oversizedChunk }),
            cancel: readerCancelSpy,
          }),
        },
      } as unknown as Response)
      // Source 2: Non-empty JSON items with 0 usable entries -> treated as SOURCE_INVALID and skipped
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: [null, {}] }),
      } as unknown as Response)
      // Source 3: Valid empty JSON feed {"items":[]} -> succeeds with 0 items
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: [] }),
      } as unknown as Response);

    const liveService = new TechnologyUpdateSourceService(
      new ConfigService({
        TECH_UPDATE_SOURCE_MODE: 'live',
        TECH_UPDATE_EXTERNAL_TIMEOUT_MS: '5000',
      }),
    );

    const emptyCandidates = await liveService.fetchFreshCandidates({
      userId: USER_1,
      localDate: '2026-11-24',
      timezone: 'Asia/Dhaka',
      language: 'en',
      focusRoadmap: null,
      skills: [],
      sources: [
        {
          id: SOURCE_1,
          name: 'Oversized Source',
          publisher: 'Pub 1',
          base_url: 'https://s1.example.test/huge.xml',
          source_type: 'official_release_notes',
          trust_tier: 1,
        },
        {
          id: SOURCE_1,
          name: 'Unusable JSON Items Source',
          publisher: 'Pub 2',
          base_url: 'https://s2.example.test/nulls.json',
          source_type: 'official_release_notes',
          trust_tier: 1,
        },
        {
          id: SOURCE_1,
          name: 'Empty Valid JSON Source',
          publisher: 'Pub 3',
          base_url: 'https://s3.example.test/empty.json',
          source_type: 'official_release_notes',
          trust_tier: 1,
        },
      ],
      deliveredContentHashes: new Set(),
    });

    expect(readerCancelSpy).toHaveBeenCalledTimes(1);
    expect(emptyCandidates).toEqual([]);
    fetchSpy.mockRestore();
  });
});

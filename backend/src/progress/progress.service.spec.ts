import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import { ProgressService } from './services/progress.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROADMAP_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const SKILL_ID = '44444444-4444-4444-8444-444444444444';
const TOPIC_ID = '55555555-5555-4555-8555-555555555555';
const ATTEMPT_ID = '66666666-6666-4666-8666-666666666666';
const EVIDENCE_ID = '77777777-7777-4777-8777-777777777777';
const HISTORY_ID = '88888888-8888-4888-8888-888888888888';

describe('ProgressService (EP-G01, EP-G02, EP-G03 — level-scoped reads, weak_areas, R29 & R24 foreground=false)', () => {
  let queryMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;
  let databaseMock: DatabaseService;
  let service: ProgressService;

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
    service = new ProgressService(databaseMock);
  });

  it('EP-G01 getProgress returns roadmap_progress, level-scoped skills,shared_across_roadmap_ids, weak_areas, and foreground=false', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('AS items_total')) {
        return [{ items_total: 1, items_completed: 0 }];
      }
      if (sql.includes('SELECT DISTINCT ri.skill_id')) {
        return [
          {
            skill_id: SKILL_ID,
            roadmap_id: '99999999-9999-4999-8999-999999999999',
            required_depth: 'application',
          },
        ];
      }
      if (sql.includes('FROM public.skills s')) {
        return [
          {
            skill_id: SKILL_ID,
            name: 'PostgreSQL Indexing',
            career_level: 'mid',
            learning_state: 'learning',
            state_reason: 'Initial attempt recorded for mid level.',
            last_evidence_at: '2026-11-22T10:00:00.000Z',
            evidence_count: 1,
          },
        ];
      }
      if (sql.includes('FROM public.roadmaps')) {
        return [
          {
            id: ROADMAP_ID,
            target_level: 'mid',
            current_version_id: VERSION_ID,
            status: 'locked',
          },
        ];
      }
      if (sql.includes('FROM public.learning_evidence')) {
        return [
          {
            id: EVIDENCE_ID,
            skill_id: SKILL_ID,
            career_level: 'mid',
            topic_id: TOPIC_ID,
            source_type: 'quiz_attempt',
            source_id: ATTEMPT_ID,
            score_summary: { mcq_correct: 8, mcq_total: 20 },
            performance_level: 'needs_work',
            attempt_no: 1,
            occurred_at: '2026-11-22T10:00:00.000Z',
          },
        ];
      }
      return [];
    });

    const res = await service.getProgress(USER_ID, { limit: 10 });
    expect(transactionMock).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Function),
      true,
      false,
    );
    expect(res.progress.roadmap_id).toBe(ROADMAP_ID);
    expect(res.progress.career_level).toBe('mid');
    expect(res.progress.roadmap_progress.items_total).toBe(1);
    expect(res.progress.skills).toHaveLength(1);
    expect(res.progress.skills[0]?.shared_with_roadmap_ids).toEqual([
      '99999999-9999-4999-8999-999999999999',
    ]);
    expect(res.progress.weak_areas).toHaveLength(1);
    expect(res.progress.weak_areas[0]?.skill_id).toBe(SKILL_ID);
    expect(res.meta.next_cursor).toBeNull();
  });

  it('EP-G02 getSkillProgressDetail returns levels[], evidence_summary, and roadmap_requirements without raw answer text', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.skills')) {
        return [{ id: SKILL_ID, canonical_name: 'PostgreSQL Indexing' }];
      }
      if (sql.includes('FROM public.skill_progress')) {
        return [
          {
            career_level: 'mid',
            learning_state: 'practicing',
            state_reason: 'Recorded mid-level evidence.',
            last_evidence_at: '2026-11-22T10:00:00.000Z',
            evidence_count: 1,
          },
        ];
      }
      if (sql.includes('FROM public.learning_evidence')) {
        return [
          {
            id: EVIDENCE_ID,
            skill_id: SKILL_ID,
            career_level: 'mid',
            topic_id: TOPIC_ID,
            source_type: 'quiz_attempt',
            source_id: ATTEMPT_ID,
            score_summary: { mcq_correct: 16, mcq_total: 20 },
            performance_level: 'good',
            attempt_no: 1,
            occurred_at: '2026-11-22T10:00:00.000Z',
          },
        ];
      }
      if (sql.includes('FROM public.roadmaps r')) {
        return [
          {
            skill_id: SKILL_ID,
            roadmap_id: ROADMAP_ID,
            career_level: 'mid',
            required_depth: 'application',
          },
        ];
      }
      return [];
    });

    const detail = await service.getSkillProgressDetail(USER_ID, SKILL_ID, {
      career_level: 'mid',
    });
    expect(detail.skill_id).toBe(SKILL_ID);
    expect(detail.levels).toHaveLength(1);
    expect(detail.levels[0]?.career_level).toBe('mid');
    expect(detail.levels[0]?.learning_state).toBe('practicing');
    expect(detail.levels[0]?.evidence_summary.count).toBe(1);
    expect(detail.levels[0]?.roadmap_requirements).toEqual([
      { roadmap_id: ROADMAP_ID, required_depth: 'application' },
    ]);
    expect(JSON.stringify(detail)).not.toContain('answer_text');
  });

  it('EP-G03 getProgressHistory derives source_attempt_id per R29 and runs with foreground=false', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)::int AS total')) {
        return [{ total: 1 }];
      }
      if (sql.includes('FROM public.achievement_history ah')) {
        expect(sql).toContain('AS source_attempt_id');
        return [
          {
            id: HISTORY_ID,
            occurred_at: '2026-11-22T10:00:00.000Z',
            skill_id: SKILL_ID,
            career_level: 'mid',
            event: 'state_change',
            from_state: 'not_started',
            to_state: 'practicing',
            reason: 'Completed first quiz attempt.',
            source: 'practice_review',
            source_id: EVIDENCE_ID,
            source_attempt_id: ATTEMPT_ID,
          },
        ];
      }
      return [];
    });

    const history = await service.getProgressHistory(USER_ID, {
      skill_id: SKILL_ID,
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-30T00:00:00.000Z',
    });
    expect(history.items).toHaveLength(1);
    expect(history.items[0]?.source_attempt_id).toBe(ATTEMPT_ID);
  });

  it('EP-G01 scopes skills strictly to ri.id IS NOT NULL when a roadmap is active and falls back to sp.id IS NOT NULL when no roadmap exists', async () => {
    const capturedSkillsQueries: string[] = [];

    // 1. Active roadmap present -> query enforces WHERE ri.id IS NOT NULL (no OR sp.id IS NOT NULL)
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.roadmaps')) {
        return [
          {
            id: ROADMAP_ID,
            target_level: 'mid',
            current_version_id: VERSION_ID,
            status: 'locked',
          },
        ];
      }
      if (sql.includes('AS items_total')) {
        return [{ items_total: 1, items_completed: 1 }];
      }
      if (sql.includes('FROM public.skills s')) {
        capturedSkillsQueries.push(sql);
        return [
          {
            skill_id: SKILL_ID,
            name: 'Python',
            career_level: 'mid',
            learning_state: 'practicing',
            state_reason: 'Updated from quiz attempt #1.',
            last_evidence_at: '2026-11-23T10:00:00.000Z',
            evidence_count: 1,
          },
        ];
      }
      return [];
    });

    const withRoadmap = await service.getProgress(USER_ID, {
      roadmap_id: ROADMAP_ID,
    });
    expect(withRoadmap.progress.roadmap_id).toBe(ROADMAP_ID);
    expect(withRoadmap.progress.skills).toHaveLength(1);
    expect(withRoadmap.progress.skills[0]?.name).toBe('Python');
    expect(capturedSkillsQueries[0]).toContain('WHERE ri.id IS NOT NULL');
    expect(capturedSkillsQueries[0]).not.toContain('OR sp.id IS NOT NULL');
    expect(capturedSkillsQueries[0]).toContain(
      'ORDER BY COALESCE(MIN(dpi.day_no), 2147483647) ASC, COALESCE(MIN(ri.sequence_no), 2147483647) ASC'.replace(
        ', COALESCE',
        ',\n                         COALESCE',
      ),
    );

    // 2. No active/focus roadmap -> falls back to FROM public.skill_progress sp
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.roadmaps')) {
        return [];
      }
      if (sql.includes('FROM public.skill_progress sp')) {
        capturedSkillsQueries.push(sql);
        return [
          {
            skill_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            name: 'Next.js',
            career_level: 'mid',
            learning_state: 'learning',
            state_reason: 'Self-reported skill; confirmed goal level',
            last_evidence_at: null,
            evidence_count: 0,
          },
        ];
      }
      return [];
    });

    const withoutRoadmap = await service.getProgress(USER_ID);
    expect(withoutRoadmap.progress.roadmap_id).toBeNull();
    expect(withoutRoadmap.progress.skills).toHaveLength(1);
    expect(withoutRoadmap.progress.skills[0]?.name).toBe('Next.js');
    expect(capturedSkillsQueries[1]).toContain('FROM public.skill_progress sp');
  });

  it('EP-G01 weak_areas does not claim needs_work when performance_level is good but below strong-evidence threshold', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.roadmaps')) {
        return [
          {
            id: ROADMAP_ID,
            target_level: 'mid',
            current_version_id: VERSION_ID,
            status: 'locked',
          },
        ];
      }
      if (sql.includes('AS items_total')) {
        return [{ items_total: 1, items_completed: 1 }];
      }
      if (sql.includes('FROM public.skills s')) {
        return [
          {
            skill_id: SKILL_ID,
            name: 'SQL',
            career_level: 'mid',
            learning_state: 'learning',
            state_reason: 'Initial attempt recorded.',
            last_evidence_at: '2026-11-23T10:00:00.000Z',
            evidence_count: 1,
          },
        ];
      }
      if (sql.includes('FROM public.learning_evidence')) {
        return [
          {
            id: EVIDENCE_ID,
            skill_id: SKILL_ID,
            career_level: 'mid',
            topic_id: TOPIC_ID,
            source_type: 'quiz_attempt',
            source_id: ATTEMPT_ID,
            score_summary: { mcq_correct: 14, mcq_total: 20 },
            performance_level: 'good',
            attempt_no: 1,
            occurred_at: '2026-11-23T10:00:00.000Z',
          },
        ];
      }
      return [];
    });

    const res = await service.getProgress(USER_ID);
    expect(res.progress.weak_areas).toHaveLength(1);
    expect(res.progress.weak_areas[0]?.reason).not.toContain('needs_work');
    expect(res.progress.weak_areas[0]?.reason).toContain(
      'below the strong-evidence benchmark',
    );
  });

  it('EP-G02 returns retry_improved=null when only attempt_no=2 exists without an attempt_no=1 baseline', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.skills')) {
        return [{ id: SKILL_ID, canonical_name: 'SQL' }];
      }
      if (sql.includes('FROM public.skill_progress')) {
        return [
          {
            career_level: 'mid',
            learning_state: 'practicing',
            state_reason: 'Recorded attempt 2.',
            last_evidence_at: '2026-11-23T10:00:00.000Z',
          },
        ];
      }
      if (sql.includes('FROM public.learning_evidence')) {
        return [
          {
            id: EVIDENCE_ID,
            skill_id: SKILL_ID,
            career_level: 'mid',
            topic_id: TOPIC_ID,
            source_type: 'quiz_attempt',
            source_id: ATTEMPT_ID,
            score_summary: { mcq_correct: 20, mcq_total: 20 },
            performance_level: 'good',
            attempt_no: 2,
            occurred_at: '2026-11-23T10:00:00.000Z',
          },
        ];
      }
      return [];
    });

    const detail = await service.getSkillProgressDetail(USER_ID, SKILL_ID, {
      career_level: 'mid',
    });
    expect(detail.levels[0]?.evidence_summary.retry_improved).toBeNull();
  });
});

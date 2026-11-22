import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import { TopicContentService } from './services/topic-content.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROADMAP_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const TOPIC_ID = '44444444-4444-4444-8444-444444444444';
const APPROVED_TOPIC_ID = '44444444-4444-4444-8444-444444444445';
const SKILL_ID = '55555555-5555-4555-8555-555555555555';
const ITEM_ID_1 = '66666666-6666-4666-8666-666666666661';
const ITEM_ID_2 = '66666666-6666-4666-8666-666666666662';
const RES_ID_1 = '77777777-7777-4777-8777-777777777771';

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

describe('TopicContentService (EP-L05, EP-L06, EP-L07)', () => {
  let queryMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;
  let databaseMock: DatabaseService;
  let service: TopicContentService;

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
    service = new TopicContentService(databaseMock);
  });

  it('EP-L05 filters by priority & learning_state, paginates with int4 cursor, and rejects invalid enums', async () => {
    await expect(
      service.listTopics(USER_ID, { priority: 'invalid_priority' }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'INVALID_ENUM_VALUE');
      return true;
    });

    await expect(
      service.listTopics(USER_ID, { learning_state: 'mastered' }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'INVALID_ENUM_VALUE');
      return true;
    });

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.roadmaps')) {
        return [
          {
            id: ROADMAP_ID,
            current_version_id: VERSION_ID,
            target_level: 'mid',
          },
        ];
      }
      if (sql.includes('FROM public.roadmap_items ri')) {
        expect(sql).toContain('ri.priority =');
        expect(sql).toContain('learning_state');
        expect(sql).toContain(
          '(t.deleted_at IS NULL OR t_approved.id IS NOT NULL)',
        );
        expect(
          sql.indexOf('(t.deleted_at IS NULL OR t_approved.id IS NOT NULL)'),
        ).toBeLessThan(sql.indexOf('LIMIT'));
        return [
          {
            item_id: ITEM_ID_1,
            sequence_no: 1,
            topic_id: APPROVED_TOPIC_ID,
            title: 'SQL Joins',
            skill_id: SKILL_ID,
            priority: 'core',
            career_level: 'mid',
            learning_state: 'learning',
            plan_day_no: 2,
          },
          {
            item_id: ITEM_ID_2,
            sequence_no: 2,
            topic_id: TOPIC_ID,
            title: 'Indexes',
            skill_id: SKILL_ID,
            priority: 'core',
            career_level: 'mid',
            learning_state: 'learning',
            plan_day_no: 3,
          },
        ];
      }
      return [];
    });

    const page = await service.listTopics(USER_ID, {
      priority: 'core',
      learning_state: 'learning',
      limit: 1,
    });
    expect(transactionMock).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Function),
      true,
      false,
    );
    expect(page.items).toEqual([
      {
        topic_id: APPROVED_TOPIC_ID,
        title: 'SQL Joins',
        skill_id: SKILL_ID,
        priority: 'core',
        career_level: 'mid',
        learning_state: 'learning',
        plan_day_no: 2,
      },
    ]);
    expect(page.meta.next_cursor).toBeTruthy();
  });

  it('EP-L06 returns 404 for foreign topics and resolves canonical approved content for owned topics', async () => {
    queryMock.mockResolvedValueOnce([]);
    await expect(service.getTopic(USER_ID, TOPIC_ID)).rejects.toSatisfy(
      (err) => {
        expectContractError(err, 404, 'RESOURCE_NOT_FOUND');
        return true;
      },
    );

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.topics t_req')) {
        return [
          {
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            status: 'hidden',
            explanation_markdown: null,
            important_questions: [],
            required_depth: 'application',
            learning_state: 'practicing',
          },
        ];
      }
      if (
        sql.includes("status = 'approved'") &&
        sql.includes('FROM public.topics')
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
            explanation_markdown: '# SQL Joins v2',
            important_questions: [],
            language: 'mixed',
            approved_at: '2026-11-21T00:00:00.000Z',
          },
        ];
      }
      if (sql.includes('FROM public.learning_resources')) {
        return [
          {
            id: RES_ID_1,
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

    const detail = await service.getTopic(USER_ID, TOPIC_ID);
    expect(detail.topic_id).toBe(APPROVED_TOPIC_ID);
    expect(detail.content_version).toBe(2);
    expect(detail.learning_state).toBe('practicing');
    expect(detail.required_depth).toBe('application');
    expect(detail.sources).toHaveLength(1);
    expect(detail.rating_allowed).toBe(true);
    expect(detail.report_allowed).toBe(true);
  });

  it('EP-L07 returns 404 for foreign topics and returns paginated attribution links for owned topics', async () => {
    queryMock.mockResolvedValueOnce([]);
    await expect(
      service.listResources(USER_ID, { topic_id: TOPIC_ID }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 404, 'RESOURCE_NOT_FOUND');
      return true;
    });

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.topics t_req')) {
        return [
          {
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            status: 'approved',
            explanation_markdown: '# SQL Joins',
            important_questions: [],
            required_depth: 'application',
            learning_state: 'learning',
          },
        ];
      }
      if (
        sql.includes("status = 'approved'") &&
        sql.includes('FROM public.topics')
      ) {
        return [
          {
            id: APPROVED_TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            status: 'approved',
            explanation_markdown: '# SQL Joins',
            important_questions: [],
            language: 'mixed',
            approved_at: '2026-11-21T00:00:00.000Z',
          },
        ];
      }
      if (sql.includes('FROM public.learning_resources')) {
        return [
          {
            id: RES_ID_1,
            title: 'PostgreSQL Joins',
            publisher: 'PostgreSQL Docs',
            url: 'https://www.postgresql.org/docs/current/tutorial-join.html',
            resource_type: 'official_docs',
            retrieved_at: '2026-11-21T00:00:00.000Z',
          },
        ];
      }
      return [];
    });

    const resources = await service.listResources(USER_ID, {
      topic_id: TOPIC_ID,
      limit: 10,
    });
    expect(resources.items).toEqual([
      {
        id: RES_ID_1,
        title: 'PostgreSQL Joins',
        publisher: 'PostgreSQL Docs',
        url: 'https://www.postgresql.org/docs/current/tutorial-join.html',
        resource_type: 'official_docs',
        retrieved_at: '2026-11-21T00:00:00.000Z',
      },
    ]);
    expect(resources.meta).toEqual({ limit: 10, next_cursor: null });
  });

  it('EP-L06 redacts hidden topic content to metadata-only and EP-L07 returns empty items when no approved replacement exists', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.topics t_req')) {
        return [
          {
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            status: 'hidden',
            explanation_markdown: '# Hidden sensitive/reported draft',
            important_questions: [
              { question: 'Hidden Q', answer_markdown: 'Hidden A' },
            ],
            required_depth: 'application',
            learning_state: 'learning',
          },
        ];
      }
      if (
        sql.includes("status = 'approved'") &&
        sql.includes('FROM public.topics')
      ) {
        return [];
      }
      throw new Error(
        `Unexpected SQL for hidden topic without replacement: ${sql}`,
      );
    });

    const detail = await service.getTopic(USER_ID, TOPIC_ID);
    expect(detail).toEqual({
      topic_id: TOPIC_ID,
      title: 'SQL Joins',
      career_level: 'mid',
      content_version: 1,
      explanation_markdown: null,
      important_questions: [],
      sources: [],
      learning_state: 'learning',
      required_depth: 'application',
      rating_allowed: false,
      report_allowed: false,
    });

    const hiddenResources = await service.listResources(USER_ID, {
      topic_id: TOPIC_ID,
      limit: 10,
    });
    expect(hiddenResources).toEqual({
      items: [],
      meta: { limit: 10, next_cursor: null },
    });
  });
});

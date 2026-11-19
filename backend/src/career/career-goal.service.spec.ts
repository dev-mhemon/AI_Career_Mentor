import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AIRequestDTO,
  AIResponseDTO,
  GoalInterpretationOutput,
} from '../ai/ai.types.js';
import type { AiGatewayService } from '../ai/services/ai-gateway.service.js';
import type { DatabaseService } from '../auth/services/database.service.js';
import { ProfileService } from '../profile/profile.service.js';
import {
  CareerGoalService,
  detectUiLanguage,
} from './services/career-goal.service.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const GOAL_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROLE_BACKEND = '33333333-3333-4333-8333-333333333333';
const ROLE_FULLSTACK = '44444444-4444-4444-8444-444444444444';
const ROLE_DEVOPS = '55555555-5555-4555-8555-555555555555';
const ROADMAP_1 = '77777777-7777-4777-8777-777777777777';
const ROADMAP_2 = '88888888-8888-4888-8888-888888888888';

const APPROVED_ROLES = [
  {
    id: ROLE_BACKEND,
    slug: 'backend-development',
    name: 'Backend Development',
    aliases: ['Backend Engineer', 'Node.js Backend'],
  },
  {
    id: ROLE_FULLSTACK,
    slug: 'full-stack-development',
    name: 'Full-Stack Development',
    aliases: ['Fullstack Developer'],
  },
  {
    id: ROLE_DEVOPS,
    slug: 'devops',
    name: 'DevOps',
    aliases: ['DevOps Engineer'],
  },
];

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

function buildAiResponse(
  output: GoalInterpretationOutput,
): AIResponseDTO<GoalInterpretationOutput> {
  return {
    request_id: '99999999-9999-4999-8999-999999999999',
    generation_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    status: 'ok',
    output,
    provider_id: 'synthetic',
    model_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    fallback_used: false,
    prompt_version_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    usage_units: { input: 120, output: 80 },
    cost: 0,
    latency_ms: 25,
    validation_status: 'passed',
    sources: [],
  };
}

describe('CareerGoalService (EP-C01–EP-C07, R07, R24, R29)', () => {
  let activeTransactionDepth = 0;
  let rootQueryMock: ReturnType<typeof vi.fn>;
  let queryMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;
  let aiExecuteMock: ReturnType<typeof vi.fn>;
  let databaseMock: DatabaseService;
  let aiGatewayMock: AiGatewayService;
  let profileService: ProfileService;
  let service: CareerGoalService;

  beforeEach(() => {
    vi.clearAllMocks();
    activeTransactionDepth = 0;
    rootQueryMock = vi.fn();
    queryMock = vi.fn();
    transactionMock = vi.fn(
      async (
        _userId: string | null,
        operation: (db: { query: typeof queryMock }) => Promise<unknown>,
      ) => {
        activeTransactionDepth += 1;
        try {
          return await operation({ query: queryMock });
        } finally {
          activeTransactionDepth -= 1;
        }
      },
    );
    databaseMock = {
      query: rootQueryMock,
      transaction: transactionMock,
    } as unknown as DatabaseService;

    aiExecuteMock = vi.fn(async () => {
      // Strictly assert AI Gateway is NEVER called inside an open DB transaction
      expect(activeTransactionDepth).toBe(0);
      return buildAiResponse({
        isTechnologyGoal: true,
        clarificationNeeded: false,
        clarificationRound: 0,
        clarificationQuestion: null,
        proposedRole: {
          canonicalRoleId: ROLE_BACKEND,
          name: 'Backend Development',
        },
        alternativeRoles: [
          {
            canonicalRoleId: ROLE_FULLSTACK,
            name: 'Full-Stack Development',
            matchReason: 'Overlapping web and API skills.',
          },
        ],
        suggestedLevel: 'junior',
      });
    });

    aiGatewayMock = {
      execute: aiExecuteMock,
    } as unknown as AiGatewayService;

    profileService = new ProfileService(databaseMock);
    service = new CareerGoalService(
      databaseMock,
      aiGatewayMock,
      profileService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Language detection helper', () => {
    it('detects Bangla, English, and Mixed input accurately', () => {
      expect(detectUiLanguage('আমি ব্যাকএন্ড ডেভেলপার হতে চাই')).toBe('bn');
      expect(detectUiLanguage('I want to become a Backend Developer')).toBe(
        'en',
      );
      expect(detectUiLanguage('আমি Node.js Backend শিখতে চাই')).toBe('mixed');
    });
  });

  describe('EP-C01 createGoal', () => {
    it('executes AI call strictly outside DB transactions with timeout <= 10s, resolves approved roles, and persists goal with R24 foreground=true', async () => {
      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('private.effective_feature_access')) {
          expect(params).toEqual([USER_A]);
          return [{ enabled: true }];
        }
        if (sql.includes('AS active_count')) {
          expect(params).toEqual([USER_A]);
          return [{ active_count: 1 }];
        }
        if (
          sql.includes('FROM public.career_roles') &&
          sql.includes("status = 'approved'") &&
          !sql.includes('ANY(')
        ) {
          return APPROVED_ROLES;
        }
        if (sql.includes('INSERT INTO public.career_goals')) {
          expect(params?.[0]).toBe(USER_A);
          expect(params?.[1]).toBe('Backend developer, mainly Node.js');
          expect(params?.[2]).toBe('awaiting_confirmation');
          expect(params?.[3]).toBe(0);
          expect(params?.[4]).toBeNull();
          expect(params?.[6]).toBe(ROLE_BACKEND);
          expect(params?.[7]).toEqual([ROLE_FULLSTACK]);
          expect(params?.[8]).toBe('junior');
          return [
            {
              id: GOAL_1,
              user_id: USER_A,
              goal_text: 'Backend developer, mainly Node.js',
              status: 'awaiting_confirmation',
              clarification_round: 0,
              clarification_question: null,
              clarifications: JSON.parse(String(params?.[5] ?? '[]')),
              proposed_role_id: ROLE_BACKEND,
              alternative_role_ids: [ROLE_FULLSTACK],
              suggested_level: 'junior',
              target_level: null,
              created_at: '2026-10-10T08:00:00.000Z',
            },
          ];
        }
        if (
          sql.includes('FROM public.career_roles') &&
          sql.includes('id = ANY($1::uuid[])')
        ) {
          return [
            {
              canonical_role_id: ROLE_FULLSTACK,
              name: 'Full-Stack Development',
            },
          ];
        }
        return [];
      });

      const response = JSON.parse(
        JSON.stringify(
          await service.createGoal(USER_A, {
            goal_text: '  Backend developer, mainly Node.js  ',
          }),
        ),
      );

      expect(aiExecuteMock).toHaveBeenCalledTimes(1);
      const aiReq = aiExecuteMock.mock.calls[0][0] as AIRequestDTO;
      expect(aiReq.task).toBe('goal_interpretation');
      expect(aiReq.budget.timeout_ms).toBeLessThanOrEqual(10_000);
      expect(aiReq.untrusted_inputs).toEqual([
        'Backend developer, mainly Node.js',
      ]);

      expect(response).toEqual({
        id: GOAL_1,
        goal_text: 'Backend developer, mainly Node.js',
        status: 'awaiting_confirmation',
        clarification_round: 0,
        clarification_question: null,
        proposed_role: {
          canonical_role_id: ROLE_BACKEND,
          name: 'Backend Development',
        },
        alternative_roles: [
          {
            canonical_role_id: ROLE_FULLSTACK,
            name: 'Full-Stack Development',
            rationale: 'Overlapping web and API skills.',
          },
        ],
        suggested_level: 'junior',
        target_level: null,
        roadmap_id: null,
        created_at: '2026-10-10T08:00:00.000Z',
      });

      // Second transaction (commit write boundary) must pass foreground = true (R24)
      const writeTxCall = transactionMock.mock.calls.find(
        (call) => call[3] === true,
      );
      expect(writeTxCall).toBeDefined();
    });

    it('rejects non-technology goals with 422 OUT_OF_SCOPE_GOAL and does not insert into career_goals', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('AS active_count')) {
          return [{ active_count: 0 }];
        }
        if (sql.includes('FROM public.career_roles')) {
          return APPROVED_ROLES;
        }
        return [];
      });

      aiExecuteMock.mockResolvedValueOnce(
        buildAiResponse({
          isTechnologyGoal: false,
          clarificationNeeded: false,
          clarificationRound: 0,
          clarificationQuestion: null,
          proposedRole: null,
          alternativeRoles: [],
          suggestedLevel: null,
        }),
      );

      await expect(
        service.createGoal(USER_A, {
          goal_text: 'Become a professional chef in Dhaka',
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'OUT_OF_SCOPE_GOAL');
        return true;
      });

      expect(
        queryMock.mock.calls.some(([sql]) =>
          String(sql).includes('INSERT INTO public.career_goals'),
        ),
      ).toBe(false);
    });

    it('rejects when active goal/roadmap count >= 3 with 409 ROADMAP_LIMIT_REACHED before calling AI', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('AS active_count')) {
          return [{ active_count: 3 }];
        }
        return [];
      });

      await expect(
        service.createGoal(USER_A, {
          goal_text: 'Backend developer with PostgreSQL',
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'ROADMAP_LIMIT_REACHED');
        return true;
      });

      expect(aiExecuteMock).not.toHaveBeenCalled();
    });

    it('filters out unapproved or unknown roles returned by AI against approved public.career_roles', async () => {
      const unapprovedRoleId = '66666666-6666-4666-8666-666666666666';
      aiExecuteMock.mockResolvedValueOnce(
        buildAiResponse({
          isTechnologyGoal: true,
          clarificationNeeded: false,
          clarificationRound: 0,
          clarificationQuestion: null,
          proposedRole: {
            canonicalRoleId: ROLE_BACKEND,
            name: 'Backend Development',
          },
          alternativeRoles: [
            {
              canonicalRoleId: unapprovedRoleId,
              name: 'Unapproved Quantum Role',
              matchReason: 'Should be filtered out',
            },
            {
              canonicalRoleId: ROLE_DEVOPS,
              name: 'DevOps',
              matchReason: 'Approved alternative',
            },
          ],
          suggestedLevel: 'mid',
        }),
      );

      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('AS active_count')) {
          return [{ active_count: 0 }];
        }
        if (sql.includes('FROM public.career_roles') && !sql.includes('ANY(')) {
          return APPROVED_ROLES;
        }
        if (sql.includes('INSERT INTO public.career_goals')) {
          expect(params?.[7]).toEqual([ROLE_DEVOPS]);
          return [
            {
              id: GOAL_1,
              user_id: USER_A,
              goal_text: 'Backend and infrastructure',
              status: 'awaiting_confirmation',
              clarification_round: 0,
              clarification_question: null,
              clarifications: JSON.parse(String(params?.[5] ?? '[]')),
              proposed_role_id: ROLE_BACKEND,
              alternative_role_ids: [ROLE_DEVOPS],
              suggested_level: 'mid',
              target_level: null,
              created_at: '2026-10-10T08:00:00.000Z',
            },
          ];
        }
        if (
          sql.includes('FROM public.career_roles') &&
          sql.includes('id = ANY($1::uuid[])')
        ) {
          return [{ canonical_role_id: ROLE_DEVOPS, name: 'DevOps' }];
        }
        return [];
      });

      const res = await service.createGoal(USER_A, {
        goal_text: 'Backend and infrastructure',
      });
      expect(res.alternative_roles).toEqual([
        {
          canonical_role_id: ROLE_DEVOPS,
          name: 'DevOps',
          rationale: 'Approved alternative',
        },
      ]);
    });

    it('clears proposed_role to null when EP-C01 returns status=clarifying, and rejects with 502 AI_VALIDATION_FAILED if commit-time catalog is empty', async () => {
      aiExecuteMock.mockResolvedValueOnce(
        buildAiResponse({
          isTechnologyGoal: true,
          clarificationNeeded: true,
          clarificationRound: 1,
          clarificationQuestion: 'Do you prefer Backend or DevOps?',
          proposedRole: {
            canonicalRoleId: ROLE_BACKEND,
            name: 'Backend Development',
          },
          alternativeRoles: [
            {
              canonicalRoleId: ROLE_DEVOPS,
              name: 'DevOps',
              matchReason: 'Cloud overlap',
            },
          ],
          suggestedLevel: 'junior',
        }),
      );

      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('AS active_count')) {
          return [{ active_count: 0 }];
        }
        if (sql.includes('FROM public.career_roles') && !sql.includes('ANY(')) {
          return APPROVED_ROLES;
        }
        if (sql.includes('INSERT INTO public.career_goals')) {
          expect(params?.[2]).toBe('clarifying');
          expect(params?.[6]).toBeNull();
          expect(params?.[7]).toEqual([]);
          return [
            {
              id: GOAL_1,
              user_id: USER_A,
              goal_text: 'Ambiguous server goal',
              status: 'clarifying',
              clarification_round: 1,
              clarification_question: 'Do you prefer Backend or DevOps?',
              clarifications: [],
              proposed_role_id: null,
              alternative_role_ids: [],
              suggested_level: null,
              target_level: null,
              created_at: '2026-10-10T08:00:00.000Z',
            },
          ];
        }
        return [];
      });

      const clarifyingRes = await service.createGoal(USER_A, {
        goal_text: 'Ambiguous server goal',
      });
      expect(clarifyingRes.status).toBe('clarifying');
      expect(clarifyingRes.proposed_role).toBeNull();
      expect(clarifyingRes.alternative_roles).toEqual([]);

      // If commit-time catalog is empty (all roles retired while AI ran), fail closed with 502 AI_VALIDATION_FAILED
      let roleLoadCallCount = 0;
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('AS active_count')) {
          return [{ active_count: 0 }];
        }
        if (sql.includes('FROM public.career_roles') && !sql.includes('ANY(')) {
          roleLoadCallCount += 1;
          return roleLoadCallCount === 1 ? APPROVED_ROLES : [];
        }
        return [];
      });

      await expect(
        service.createGoal(USER_A, {
          goal_text: 'Backend developer in Node.js',
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 502, 'AI_VALIDATION_FAILED');
        return true;
      });
    });

    it('accepts 300 Unicode code points (including supplementary characters) and rejects 301 code points in goal_text', async () => {
      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('AS active_count')) {
          return [{ active_count: 0 }];
        }
        if (sql.includes('FROM public.career_roles') && !sql.includes('ANY(')) {
          return APPROVED_ROLES;
        }
        if (sql.includes('INSERT INTO public.career_goals')) {
          return [
            {
              id: GOAL_1,
              user_id: USER_A,
              goal_text: String(params?.[1]),
              status: 'awaiting_confirmation',
              clarification_round: 0,
              clarification_question: null,
              clarifications: [],
              proposed_role_id: ROLE_BACKEND,
              alternative_role_ids: [],
              suggested_level: 'junior',
              target_level: null,
              created_at: '2026-10-10T08:00:00.000Z',
            },
          ];
        }
        return [];
      });

      const valid300WithSupplementary = `${'a'.repeat(299)}🚀`;
      const okRes = await service.createGoal(USER_A, {
        goal_text: valid300WithSupplementary,
      });
      expect(okRes.goal_text).toBe(valid300WithSupplementary);

      queryMock.mockClear();
      const invalid301VariationSelector = `${'a'.repeat(299)}\u2764\uFE0F`;
      await expect(
        service.createGoal(USER_A, {
          goal_text: invalid301VariationSelector,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'VALIDATION_FAILED');
        return true;
      });
      expect(queryMock).not.toHaveBeenCalled();

      const invalid301WithSupplementary = `${'a'.repeat(300)}🚀`;
      await expect(
        service.createGoal(USER_A, {
          goal_text: invalid301WithSupplementary,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'VALIDATION_FAILED');
        return true;
      });
    });
  });

  describe('EP-C02 listGoals & EP-C03 getGoal', () => {
    it('supports status filter, deterministic cursor pagination, and R24 foreground=false', async () => {
      const goalRow1 = {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        user_id: USER_A,
        goal_text: 'Goal 1',
        status: 'confirmed' as const,
        clarification_round: 0,
        clarification_question: null,
        proposed_role_id: ROLE_BACKEND,
        confirmed_role_id: ROLE_BACKEND,
        role_name: 'Backend Development',
        alternative_role_ids: [],
        suggested_level: 'junior' as const,
        target_level: 'mid' as const,
        roadmap_id: ROADMAP_1,
        created_at: '2026-10-10T09:00:00.000Z',
      };
      const goalRow2 = {
        ...goalRow1,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        goal_text: 'Goal 2',
        created_at: '2026-10-10T08:00:00.000Z',
      };

      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM public.career_goals g')) {
          expect(params?.[0]).toBe(USER_A);
          expect(params?.[1]).toBe('confirmed');
          expect(params?.[2]).toBe(2); // limit + 1
          return [goalRow1, goalRow2];
        }
        return [];
      });

      const page1 = await service.listGoals(USER_A, {
        status: 'confirmed',
        limit: 1,
      });
      expect(page1.items).toHaveLength(1);
      expect(page1.items[0].id).toBe(goalRow1.id);
      expect(page1.meta.limit).toBe(1);
      expect(page1.meta.next_cursor).toBeTruthy();

      // Verify foreground = false on read
      expect(transactionMock).toHaveBeenCalledWith(
        USER_A,
        expect.any(Function),
        true,
        false,
      );

      // Now pass next_cursor and verify cursor decoding
      queryMock.mockImplementationOnce(
        async (sql: string, params?: unknown[]) => {
          expect(sql).toContain('g.created_at <');
          expect(params?.[0]).toBe(USER_A);
          expect(params?.[1]).toBe('2026-10-10T09:00:00.000Z');
          expect(params?.[2]).toBe(goalRow1.id);
          return [goalRow2];
        },
      );
      const page2 = await service.listGoals(USER_A, {
        limit: 1,
        cursor: page1.meta.next_cursor!,
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0].id).toBe(goalRow2.id);
      expect(page2.meta.next_cursor).toBeNull();
    });

    it('preserves microsecond database timestamp precision in next_cursor and batches alternative-role lookup into a single query across multiple retained goals per page', async () => {
      const microRow1 = {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        user_id: USER_A,
        goal_text: 'Microsecond Goal 1',
        status: 'awaiting_confirmation' as const,
        clarification_round: 0,
        clarification_question: null,
        proposed_role_id: ROLE_BACKEND,
        role_name: 'Backend Development',
        alternative_role_ids: [ROLE_FULLSTACK, ROLE_DEVOPS],
        suggested_level: 'junior' as const,
        target_level: null,
        roadmap_id: null,
        created_at: new Date('2026-10-10T09:00:00.123Z'),
        created_at_cursor: '2026-10-10 09:00:00.123456+00',
      };
      const microRow2 = {
        ...microRow1,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        goal_text: 'Microsecond Goal 2',
        proposed_role_id: ROLE_FULLSTACK,
        role_name: 'Full-Stack Development',
        alternative_role_ids: [ROLE_DEVOPS, ROLE_BACKEND],
        created_at: new Date('2026-10-10T09:00:00.123Z'),
        created_at_cursor: '2026-10-10 09:00:00.123455+00',
      };
      const microRow3 = {
        ...microRow1,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        goal_text: 'Microsecond Goal 3 (extra row for hasMore)',
        alternative_role_ids: [ROLE_FULLSTACK],
        created_at: new Date('2026-10-10T09:00:00.123Z'),
        created_at_cursor: '2026-10-10 09:00:00.123454+00',
      };

      let roleBatchQueries = 0;
      let batchedRoleIdsParam: unknown[] = [];
      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM public.career_goals g')) {
          expect(params).toEqual([USER_A, 3]); // limit (2) + 1
          return [microRow1, microRow2, microRow3];
        }
        if (
          sql.includes('FROM public.career_roles') &&
          sql.includes('id = ANY($1::uuid[])')
        ) {
          roleBatchQueries += 1;
          batchedRoleIdsParam = Array.isArray(params?.[0]) ? params[0] : [];
          return [
            {
              canonical_role_id: ROLE_BACKEND,
              name: 'Backend Development',
            },
            {
              canonical_role_id: ROLE_FULLSTACK,
              name: 'Full-Stack Development',
            },
            {
              canonical_role_id: ROLE_DEVOPS,
              name: 'DevOps',
            },
          ];
        }
        return [];
      });

      const page1 = await service.listGoals(USER_A, { limit: 2 });
      expect(roleBatchQueries).toBe(1);
      expect(batchedRoleIdsParam).toEqual([
        ROLE_FULLSTACK,
        ROLE_DEVOPS,
        ROLE_BACKEND,
      ]);
      expect(page1.items).toHaveLength(2);
      expect(page1.items[0].alternative_roles).toEqual([
        {
          canonical_role_id: ROLE_FULLSTACK,
          name: 'Full-Stack Development',
          rationale: null,
        },
        {
          canonical_role_id: ROLE_DEVOPS,
          name: 'DevOps',
          rationale: null,
        },
      ]);
      expect(page1.items[1].alternative_roles).toEqual([
        {
          canonical_role_id: ROLE_DEVOPS,
          name: 'DevOps',
          rationale: null,
        },
        {
          canonical_role_id: ROLE_BACKEND,
          name: 'Backend Development',
          rationale: null,
        },
      ]);
      expect(page1.meta.limit).toBe(2);
      expect(page1.meta.next_cursor).toBeTruthy();

      const decoded = JSON.parse(
        Buffer.from(page1.meta.next_cursor!, 'base64url').toString('utf8'),
      ) as { created_at: string; id: string };
      expect(decoded.created_at).toBe('2026-10-10 09:00:00.123455+00');
      expect(decoded.id).toBe(microRow2.id);
    });

    it('rejects malformed cursor or malformed goal UUID with 400 INVALID_FORMAT and returns 404 RESOURCE_NOT_FOUND for foreign user', async () => {
      await expect(
        service.listGoals(USER_A, { cursor: 'not-a-valid-cursor' }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 400, 'INVALID_FORMAT');
        return true;
      });

      await expect(service.getGoal(USER_A, 'invalid-uuid')).rejects.toSatisfy(
        (err) => {
          expectContractError(err, 400, 'INVALID_FORMAT');
          return true;
        },
      );

      queryMock.mockResolvedValueOnce([]);
      await expect(service.getGoal(USER_B, GOAL_1)).rejects.toSatisfy((err) => {
        expectContractError(err, 404, 'RESOURCE_NOT_FOUND');
        return true;
      });
    });
  });

  describe('EP-C04 answerClarification', () => {
    it('coerces status to awaiting_confirmation when round reaches 2 even if AI requests clarificationNeeded=true', async () => {
      const clarifyingRound1Goal = {
        id: GOAL_1,
        user_id: USER_A,
        goal_text: 'I want to work with servers and cloud',
        status: 'clarifying' as const,
        clarification_round: 1,
        clarification_question: 'Do you prefer Backend APIs or DevOps?',
        clarifications: [
          {
            round: 1,
            question: 'Which area?',
            answer: 'Servers and APIs',
          },
        ],
        proposed_role_id: null,
        alternative_role_ids: [],
        suggested_level: null,
        target_level: null,
        created_at: '2026-10-10T08:00:00.000Z',
      };

      // AI still says clarificationNeeded: true on round 2
      aiExecuteMock.mockResolvedValueOnce(
        buildAiResponse({
          isTechnologyGoal: true,
          clarificationNeeded: true,
          clarificationRound: 2,
          clarificationQuestion: 'Still unsure, pick one?',
          proposedRole: {
            canonicalRoleId: ROLE_BACKEND,
            name: 'Backend Development',
          },
          alternativeRoles: [
            {
              canonicalRoleId: ROLE_DEVOPS,
              name: 'DevOps',
              matchReason: 'Cloud and deployment overlap.',
            },
          ],
          suggestedLevel: 'junior',
        }),
      );

      let updatedStatus: string | undefined;
      let updatedRound: number | undefined;
      let updatedQuestion: string | null | undefined;

      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (
          sql.includes('FROM public.career_goals') &&
          sql.includes('FOR UPDATE')
        ) {
          return [clarifyingRound1Goal];
        }
        if (sql.includes('FROM public.career_roles') && !sql.includes('ANY(')) {
          return APPROVED_ROLES;
        }
        if (sql.includes('UPDATE public.career_goals')) {
          updatedStatus = String(params?.[2]);
          updatedRound = Number(params?.[3]);
          updatedQuestion = (params?.[4] as string | null) ?? null;
          return [];
        }
        if (sql.includes('FROM public.career_goals g')) {
          if (updatedStatus) {
            return [
              {
                ...clarifyingRound1Goal,
                status: updatedStatus,
                clarification_round: updatedRound,
                clarification_question: updatedQuestion,
                proposed_role_id: ROLE_BACKEND,
                role_name: 'Backend Development',
                alternative_role_ids: [ROLE_DEVOPS],
                suggested_level: 'junior',
              },
            ];
          }
          return [clarifyingRound1Goal];
        }
        if (
          sql.includes('FROM public.career_roles') &&
          sql.includes('id = ANY($1::uuid[])')
        ) {
          return [{ canonical_role_id: ROLE_DEVOPS, name: 'DevOps' }];
        }
        return [];
      });

      const res = await service.answerClarification(USER_A, GOAL_1, {
        answer: 'Mostly building REST APIs in Node.js',
      });

      expect(updatedStatus).toBe('awaiting_confirmation');
      expect(updatedRound).toBe(2);
      expect(updatedQuestion).toBeNull();
      expect(res.status).toBe('awaiting_confirmation');
      expect(res.clarification_round).toBe(2);
      expect(res.clarification_question).toBeNull();
      expect(res.proposed_role).toEqual({
        canonical_role_id: ROLE_BACKEND,
        name: 'Backend Development',
      });
    });

    it('rejects 3rd clarification round with 409 CLARIFICATION_LIMIT_REACHED and non-clarifying state with 409 INVALID_STATE_TRANSITION', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('FROM public.career_goals g')) {
          return [
            {
              id: GOAL_1,
              user_id: USER_A,
              goal_text: 'Backend developer',
              status: 'clarifying',
              clarification_round: 2,
            },
          ];
        }
        return [];
      });

      await expect(
        service.answerClarification(USER_A, GOAL_1, {
          answer: 'Another round attempt',
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'CLARIFICATION_LIMIT_REACHED');
        return true;
      });
      expect(aiExecuteMock).not.toHaveBeenCalled();

      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('FROM public.career_goals g')) {
          return [
            {
              id: GOAL_1,
              user_id: USER_A,
              goal_text: 'Backend developer',
              status: 'confirmed',
              clarification_round: 1,
            },
          ];
        }
        return [];
      });

      await expect(
        service.answerClarification(USER_A, GOAL_1, {
          answer: 'Try clarifying confirmed goal',
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'INVALID_STATE_TRANSITION');
        return true;
      });
    });

    it('rejects clarification commit with 409 INVALID_STATE_TRANSITION if the goal was edited concurrently during AI execution, and rejects round-2 without any approved role match with 502 AI_VALIDATION_FAILED', async () => {
      const preflightGoal = {
        id: GOAL_1,
        user_id: USER_A,
        goal_text: 'Original backend goal',
        status: 'clarifying' as const,
        clarification_round: 1,
        clarification_question: 'Original question?',
        updated_at: '2026-10-10T08:00:00.000Z',
      };
      const mutatedLockedGoal = {
        ...preflightGoal,
        goal_text: 'Edited cloud goal while AI was running',
        clarification_question: 'New cloud question?',
        updated_at: '2026-10-10T08:00:05.000Z',
      };

      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('FROM public.career_goals g')) {
          return [preflightGoal];
        }
        if (sql.includes('FROM public.career_roles')) {
          return APPROVED_ROLES;
        }
        if (
          sql.includes('FROM public.career_goals') &&
          sql.includes('FOR UPDATE')
        ) {
          return [mutatedLockedGoal];
        }
        return [];
      });

      await expect(
        service.answerClarification(USER_A, GOAL_1, {
          answer: 'Answer to original question',
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'INVALID_STATE_TRANSITION');
        return true;
      });
      expect(
        queryMock.mock.calls.some(([sql]) =>
          String(sql).includes('UPDATE public.career_goals'),
        ),
      ).toBe(false);

      // Round 2 with zero matched catalog roles -> 502 AI_VALIDATION_FAILED (never picks approvedRoles[0] arbitrarily)
      aiExecuteMock.mockResolvedValueOnce(
        buildAiResponse({
          isTechnologyGoal: true,
          clarificationNeeded: true,
          clarificationRound: 2,
          clarificationQuestion: 'Still ambiguous',
          proposedRole: null,
          alternativeRoles: [],
          suggestedLevel: null,
        }),
      );

      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('FROM public.career_goals')) {
          return [preflightGoal];
        }
        if (sql.includes('FROM public.career_roles')) {
          return APPROVED_ROLES;
        }
        return [];
      });

      await expect(
        service.answerClarification(USER_A, GOAL_1, {
          answer: `${'a'.repeat(299)}\u{10400}`,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 502, 'AI_VALIDATION_FAILED');
        return true;
      });

      await expect(
        service.answerClarification(USER_A, GOAL_1, {
          answer: `${'a'.repeat(300)}\u{10400}`,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'VALIDATION_FAILED');
        return true;
      });
    });
  });

  describe('EP-C05 confirmGoal & R07 atomic skill_progress initialization', () => {
    it('confirms goal and atomically invokes ProfileService.initializeProgress inside the SAME DB transaction', async () => {
      const awaitingGoal = {
        id: GOAL_1,
        user_id: USER_A,
        goal_text: 'Backend developer',
        status: 'awaiting_confirmation' as const,
        clarification_round: 1,
        clarification_question: null,
        proposed_role_id: ROLE_BACKEND,
        alternative_role_ids: [ROLE_FULLSTACK],
        suggested_level: 'junior' as const,
        target_level: null,
        created_at: '2026-10-10T08:00:00.000Z',
      };

      const sqlSequence: string[] = [];
      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        sqlSequence.push(sql);
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (
          sql.includes('FROM public.career_goals') &&
          sql.includes('FOR UPDATE')
        ) {
          expect(params).toEqual([USER_A, GOAL_1]);
          return [awaitingGoal];
        }
        if (
          sql.includes('FROM public.career_roles') &&
          sql.includes('WHERE id = $1')
        ) {
          expect(params).toEqual([ROLE_FULLSTACK]);
          return [{ id: ROLE_FULLSTACK, name: 'Full-Stack Development' }];
        }
        if (sql.includes('AS active_count')) {
          expect(params).toEqual([USER_A, GOAL_1]);
          return [{ active_count: 1 }];
        }
        if (sql.includes('UPDATE public.career_goals')) {
          expect(params).toEqual([USER_A, GOAL_1, ROLE_FULLSTACK, 'mid']);
          return [];
        }
        if (sql.includes('SELECT DISTINCT target_level')) {
          return [{ target_level: 'mid' }];
        }
        if (sql.includes('INSERT INTO public.skill_progress')) {
          expect(params).toEqual([USER_A, 'mid']);
          return [{ id: 'sp-1' }];
        }
        if (sql.includes('FROM public.career_goals g')) {
          return [
            {
              ...awaitingGoal,
              status: 'confirmed',
              confirmed_role_id: ROLE_FULLSTACK,
              proposed_role_id: ROLE_FULLSTACK,
              role_name: 'Full-Stack Development',
              target_level: 'mid',
            },
          ];
        }
        if (
          sql.includes('FROM public.career_roles') &&
          sql.includes('id = ANY($1::uuid[])')
        ) {
          return [
            {
              canonical_role_id: ROLE_FULLSTACK,
              name: 'Full-Stack Development',
            },
          ];
        }
        return [];
      });

      const res = await service.confirmGoal(USER_A, GOAL_1, {
        canonical_role_id: ROLE_FULLSTACK,
        target_level: 'mid',
      });

      expect(res.status).toBe('confirmed');
      expect(res.target_level).toBe('mid');
      expect(res.proposed_role).toEqual({
        canonical_role_id: ROLE_FULLSTACK,
        name: 'Full-Stack Development',
      });
      // Must execute in ONE single transaction (no nested transactions) using the transaction spy, never the root executor
      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(rootQueryMock).not.toHaveBeenCalled();
      expect(
        sqlSequence.some((sql) => sql.includes('UPDATE public.career_goals')),
      ).toBe(true);
      expect(
        sqlSequence.some((sql) =>
          sql.includes('INSERT INTO public.skill_progress'),
        ),
      ).toBe(true);
    });

    it('rejects unproposed role with 422 ROLE_MISMATCH, already-confirmed goal with 409 GOAL_ALREADY_CONFIRMED, and 4th active goal with 409 ROADMAP_LIMIT_REACHED', async () => {
      const baseGoal = {
        id: GOAL_1,
        user_id: USER_A,
        goal_text: 'Backend developer',
        status: 'awaiting_confirmation',
        proposed_role_id: ROLE_BACKEND,
        alternative_role_ids: [ROLE_FULLSTACK],
      };

      // 1. 422 ROLE_MISMATCH
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('FOR UPDATE')) {
          return [baseGoal];
        }
        return [];
      });

      await expect(
        service.confirmGoal(USER_A, GOAL_1, {
          canonical_role_id: ROLE_DEVOPS,
          target_level: 'junior',
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'ROLE_MISMATCH');
        return true;
      });

      // 2. 409 GOAL_ALREADY_CONFIRMED
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('FOR UPDATE')) {
          return [{ ...baseGoal, status: 'confirmed' }];
        }
        return [];
      });

      await expect(
        service.confirmGoal(USER_A, GOAL_1, {
          canonical_role_id: ROLE_BACKEND,
          target_level: 'junior',
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'GOAL_ALREADY_CONFIRMED');
        return true;
      });

      // 3. 409 ROADMAP_LIMIT_REACHED
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('FOR UPDATE')) {
          return [baseGoal];
        }
        if (sql.includes('FROM public.career_roles')) {
          return [{ id: ROLE_BACKEND, name: 'Backend Development' }];
        }
        if (sql.includes('AS active_count')) {
          return [{ active_count: 3 }];
        }
        return [];
      });

      await expect(
        service.confirmGoal(USER_A, GOAL_1, {
          canonical_role_id: ROLE_BACKEND,
          target_level: 'junior',
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'ROADMAP_LIMIT_REACHED');
        return true;
      });
    });
  });

  describe('EP-C06 updateGoal', () => {
    it('resets clarification rounds and re-interprets an unconfirmed goal outside DB tx', async () => {
      const clarifyingGoal = {
        id: GOAL_1,
        user_id: USER_A,
        goal_text: 'Old ambiguous text',
        status: 'clarifying' as const,
        clarification_round: 2,
        clarification_question: 'Old question?',
        clarifications: [{ round: 1, question: 'Q1', answer: 'A1' }],
        proposed_role_id: null,
        alternative_role_ids: [],
        suggested_level: null,
        target_level: null,
        created_at: '2026-10-10T08:00:00.000Z',
      };

      let updatedRound: number | undefined;
      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('FOR UPDATE')) {
          return [clarifyingGoal];
        }
        if (sql.includes('FROM public.career_roles') && !sql.includes('ANY(')) {
          return APPROVED_ROLES;
        }
        if (sql.includes('UPDATE public.career_goals')) {
          updatedRound = Number(params?.[4]);
          return [];
        }
        if (sql.includes('FROM public.career_goals g')) {
          if (updatedRound !== undefined) {
            return [
              {
                ...clarifyingGoal,
                goal_text: 'DevOps engineer with Kubernetes',
                status: 'awaiting_confirmation',
                clarification_round: updatedRound,
                clarification_question: null,
                proposed_role_id: ROLE_BACKEND,
                role_name: 'Backend Development',
                alternative_role_ids: [],
                suggested_level: 'junior',
              },
            ];
          }
          return [clarifyingGoal];
        }
        return [];
      });

      const res = await service.updateGoal(USER_A, GOAL_1, {
        goal_text: 'DevOps engineer with Kubernetes',
      });

      expect(updatedRound).toBe(0);
      expect(res.clarification_round).toBe(0);
      expect(res.status).toBe('awaiting_confirmation');
    });

    it('rejects confirmed goal with 409 GOAL_ALREADY_CONFIRMED and discontinued goal with 409 INVALID_STATE_TRANSITION', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('FROM public.career_goals g')) {
          return [
            {
              id: GOAL_1,
              user_id: USER_A,
              goal_text: 'Confirmed goal',
              status: 'confirmed',
            },
          ];
        }
        return [];
      });

      await expect(
        service.updateGoal(USER_A, GOAL_1, {
          goal_text: 'Attempt to edit confirmed goal',
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'GOAL_ALREADY_CONFIRMED');
        return true;
      });
      expect(aiExecuteMock).not.toHaveBeenCalled();

      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('private.effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('FROM public.career_goals g')) {
          return [
            {
              id: GOAL_1,
              user_id: USER_A,
              goal_text: 'Discontinued goal',
              status: 'discontinued',
            },
          ];
        }
        return [];
      });

      await expect(
        service.updateGoal(USER_A, GOAL_1, {
          goal_text: 'Attempt to edit discontinued goal',
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'INVALID_STATE_TRANSITION');
        return true;
      });
    });
  });

  describe('EP-C07 discontinueGoal & uq_roadmaps_one_focus safety', () => {
    it('discontinues goal, clears is_focus=false on archived focus roadmap BEFORE promoting another active locked roadmap, and preserves evidence/progress', async () => {
      const executedStatements: Array<{ sql: string; params?: unknown[] }> = [];

      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        executedStatements.push({ sql, params });
        if (
          sql.includes('FROM public.career_goals') &&
          sql.includes('FOR UPDATE')
        ) {
          expect(params).toEqual([USER_A, GOAL_1]);
          return [{ id: GOAL_1, user_id: USER_A, status: 'confirmed' }];
        }
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('career_goal_id = $2') &&
          sql.includes('FOR UPDATE')
        ) {
          expect(params).toEqual([USER_A, GOAL_1]);
          return [{ id: ROADMAP_1, status: 'locked', is_focus: true }];
        }
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes("status = 'locked'") &&
          sql.includes('id <> $2')
        ) {
          expect(params).toEqual([USER_A, ROADMAP_1]);
          return [{ id: ROADMAP_2 }];
        }
        return [];
      });

      const res = await service.discontinueGoal(USER_A, GOAL_1);

      expect(res).toEqual({
        id: GOAL_1,
        status: 'discontinued',
        archived_roadmap_id: ROADMAP_1,
        new_focus_roadmap_id: ROADMAP_2,
      });

      const archiveIndex = executedStatements.findIndex(
        (s) =>
          s.sql.includes('UPDATE public.roadmaps') &&
          s.sql.includes("status = 'archived'") &&
          s.sql.includes('is_focus = false'),
      );
      const promoteIndex = executedStatements.findIndex(
        (s) =>
          s.sql.includes('UPDATE public.roadmaps') &&
          s.sql.includes('SET is_focus = true'),
      );

      expect(archiveIndex).toBeGreaterThan(-1);
      expect(promoteIndex).toBeGreaterThan(archiveIndex);
      expect(executedStatements[archiveIndex].params).toEqual([
        USER_A,
        ROADMAP_1,
      ]);
      expect(executedStatements[promoteIndex].params).toEqual([
        USER_A,
        ROADMAP_2,
      ]);

      // Verify zero DELETE or destructive statements on evidence, progress, history, or daily plans
      expect(
        executedStatements.some(
          (s) =>
            s.sql.includes('learning_evidence') ||
            s.sql.includes('skill_progress') ||
            s.sql.includes('achievement_history') ||
            s.sql.includes('DELETE FROM'),
        ),
      ).toBe(false);
    });

    it('returns new_focus_roadmap_id: null when archived focus roadmap has no replacement locked roadmap, and rejects already-discontinued goal with 409', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        if (
          sql.includes('FROM public.career_goals') &&
          sql.includes('FOR UPDATE')
        ) {
          return [{ id: GOAL_1, user_id: USER_A, status: 'confirmed' }];
        }
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('career_goal_id = $2')
        ) {
          return [{ id: ROADMAP_1, status: 'locked', is_focus: true }];
        }
        if (sql.includes('FROM public.roadmaps') && sql.includes('id <> $2')) {
          return [];
        }
        return [];
      });

      const res = await service.discontinueGoal(USER_A, GOAL_1);
      expect(res).toEqual({
        id: GOAL_1,
        status: 'discontinued',
        archived_roadmap_id: ROADMAP_1,
        new_focus_roadmap_id: null,
      });

      queryMock.mockImplementation(async (sql: string) => {
        if (
          sql.includes('FROM public.career_goals') &&
          sql.includes('FOR UPDATE')
        ) {
          return [{ id: GOAL_1, user_id: USER_A, status: 'discontinued' }];
        }
        return [];
      });

      await expect(service.discontinueGoal(USER_A, GOAL_1)).rejects.toSatisfy(
        (err) => {
          expectContractError(err, 409, 'INVALID_STATE_TRANSITION');
          return true;
        },
      );
    });
  });
});

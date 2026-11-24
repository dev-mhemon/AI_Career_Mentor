import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrivacyRetentionService } from '../account/services/privacy-retention.service.js';
import type { AIResponseDTO, MentorChatOutput } from '../ai/ai.types.js';
import type { AiGatewayService } from '../ai/services/ai-gateway.service.js';
import type { DatabaseService } from '../auth/services/database.service.js';
import { fail } from '../common/http.js';
import type { EpisodicSummaryService } from './services/episodic-summary.service.js';
import { MentorContextAssemblerService } from './services/mentor-context-assembler.service.js';
import { MentorService } from './services/mentor.service.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '99999999-9999-4999-8999-999999999999';
const CONV_ID = '22222222-2222-4222-8222-222222222222';
const ROADMAP_ID = '33333333-3333-4333-8333-333333333333';
const TOPIC_ID = '44444444-4444-4444-8444-444444444444';
const CLIENT_MSG_1 = '55555555-5555-4555-8555-555555555555';
const USER_MSG_1 = '66666666-6666-4666-8666-666666666666';
const ASSISTANT_MSG_1 = '77777777-7777-4777-8777-777777777777';
const AI_GEN_1 = '88888888-8888-4888-8888-888888888888';

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

function createRetentionStub(days = 90): PrivacyRetentionService {
  return {
    getMentorMessageRetentionDays: vi.fn().mockReturnValue(days),
    getMentorMessageCutoffDate: vi.fn(
      (now: Date = new Date()) =>
        new Date(now.getTime() - days * 24 * 60 * 60 * 1_000),
    ),
  } as unknown as PrivacyRetentionService;
}

describe('MentorService & MentorContextAssemblerService (EP-M01..EP-M04)', () => {
  describe('EP-M01 createConversation', () => {
    it('creates a focus_roadmap conversation when locked Focus Roadmap exists and throws 409 NO_FOCUS_ROADMAP when absent', async () => {
      const queries: Array<{ sql: string; params?: unknown[] }> = [];
      let hasFocus = false;

      const db = {
        transaction: vi.fn(
          async (_uid: string | null, fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              query: vi.fn(async (sql: string, params?: unknown[]) => {
                queries.push({ sql, params });
                if (sql.includes('FROM public.roadmaps r')) {
                  return hasFocus
                    ? [
                        {
                          id: ROADMAP_ID,
                          target_level: 'mid',
                          role_name: 'Backend Development',
                        },
                      ]
                    : [];
                }
                if (sql.includes('INSERT INTO public.conversations')) {
                  return [
                    {
                      id: CONV_ID,
                      context_type: 'focus_roadmap',
                      roadmap_id: ROADMAP_ID,
                      topic_id: null,
                      title: 'Backend Development (Mid)',
                      created_at: '2026-11-24T10:00:00.000Z',
                    },
                  ];
                }
                return [];
              }),
            }),
        ),
      } as unknown as DatabaseService;

      const service = new MentorService(
        db,
        {} as AiGatewayService,
        createRetentionStub(),
        {} as MentorContextAssemblerService,
        { maybeCompact: vi.fn() } as unknown as EpisodicSummaryService,
      );

      await expect(
        service.createConversation(USER_A, { context_type: 'focus_roadmap' }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'NO_FOCUS_ROADMAP');
        return true;
      });

      hasFocus = true;
      const created = await service.createConversation(USER_A, {
        context_type: 'focus_roadmap',
      });
      expect(created).toEqual({
        id: CONV_ID,
        context_type: 'focus_roadmap',
        roadmap_id: ROADMAP_ID,
        topic_id: null,
        title: 'Backend Development (Mid)',
        created_at: '2026-11-24T10:00:00.000Z',
      });
      expect(
        queries.some((q) =>
          q.sql.includes('INSERT INTO public.ai_context_records'),
        ),
      ).toBe(true);
    });

    it('enforces topic ownership on context_type=topic (404 on foreign/unowned topic) and validates enum/topic_id bounds', async () => {
      let topicOwned = false;
      const db = {
        transaction: vi.fn(
          async (_uid: string | null, fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              query: vi.fn(async (sql: string) => {
                if (sql.includes('JOIN public.roadmap_items ri')) {
                  return topicOwned
                    ? [
                        {
                          roadmap_id: ROADMAP_ID,
                          topic_id: TOPIC_ID,
                          topic_title: 'PostgreSQL Indexing & Locking',
                        },
                      ]
                    : [];
                }
                if (sql.includes('INSERT INTO public.conversations')) {
                  return [
                    {
                      id: CONV_ID,
                      context_type: 'topic',
                      roadmap_id: ROADMAP_ID,
                      topic_id: TOPIC_ID,
                      title: 'PostgreSQL Indexing & Locking',
                      created_at: '2026-11-24T10:05:00.000Z',
                    },
                  ];
                }
                return [];
              }),
            }),
        ),
      } as unknown as DatabaseService;

      const service = new MentorService(
        db,
        {} as AiGatewayService,
        createRetentionStub(),
        {} as MentorContextAssemblerService,
        { maybeCompact: vi.fn() } as unknown as EpisodicSummaryService,
      );

      await expect(
        service.createConversation(USER_A, {
          context_type: 'unknown' as 'general',
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'INVALID_ENUM_VALUE');
        return true;
      });

      await expect(
        service.createConversation(USER_A, { context_type: 'topic' }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'VALIDATION_FAILED');
        return true;
      });

      await expect(
        service.createConversation(USER_A, {
          context_type: 'general',
          topic_id: TOPIC_ID,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'VALIDATION_FAILED');
        return true;
      });

      // Foreign/unowned topic -> 404 RESOURCE_NOT_FOUND
      await expect(
        service.createConversation(USER_A, {
          context_type: 'topic',
          topic_id: TOPIC_ID,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 404, 'RESOURCE_NOT_FOUND');
        return true;
      });

      topicOwned = true;
      const created = await service.createConversation(USER_A, {
        context_type: 'topic',
        topic_id: TOPIC_ID,
      });
      expect(created.topic_id).toBe(TOPIC_ID);
      expect(created.roadmap_id).toBe(ROADMAP_ID);
    });
  });

  describe('EP-M02 listConversations', () => {
    it('paginates caller conversations over (last_message_at DESC NULLS LAST, created_at DESC, id DESC) and rejects bad cursor', async () => {
      const conv1 = {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        context_type: 'focus_roadmap' as const,
        roadmap_id: ROADMAP_ID,
        topic_id: null,
        title: 'Active thread',
        last_message_at: '2026-11-24T11:00:00.000000Z',
        last_message_at_cursor: '2026-11-24T11:00:00.000000Z',
        created_at: '2026-11-24T10:00:00.000000Z',
        created_at_cursor: '2026-11-24T10:00:00.000000Z',
      };
      const conv2 = {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        context_type: 'general' as const,
        roadmap_id: null,
        topic_id: null,
        title: 'General Career Guidance',
        last_message_at: null,
        last_message_at_cursor: null,
        created_at: '2026-11-24T09:00:00.000000Z',
        created_at_cursor: '2026-11-24T09:00:00.000000Z',
      };

      const executedSql: string[] = [];
      const db = {
        transaction: vi.fn(
          async (_uid: string | null, fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              query: vi.fn(async (sql: string) => {
                executedSql.push(sql);
                if (executedSql.length === 1) {
                  return [conv1, conv2];
                }
                return [conv2];
              }),
            }),
        ),
      } as unknown as DatabaseService;

      const service = new MentorService(
        db,
        {} as AiGatewayService,
        createRetentionStub(),
        {} as MentorContextAssemblerService,
        { maybeCompact: vi.fn() } as unknown as EpisodicSummaryService,
      );

      const page1 = await service.listConversations(USER_A, { limit: 1 });
      expect(page1.items).toHaveLength(1);
      expect(page1.items[0]?.id).toBe(conv1.id);
      expect(page1.meta.next_cursor).toBeTruthy();

      const page2 = await service.listConversations(USER_A, {
        limit: 1,
        cursor: page1.meta.next_cursor ?? undefined,
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0]?.id).toBe(conv2.id);
      expect(page2.meta.next_cursor).toBeNull();
      expect(executedSql[1]).toContain('last_message_at IS NULL');

      await expect(
        service.listConversations(USER_A, { cursor: 'not-valid-base64-json' }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 400, 'INVALID_FORMAT');
        return true;
      });

      const impossibleDateConvCursor = Buffer.from(
        JSON.stringify({
          last_message_at: '2026-02-31T12:00:00.000000Z',
          created_at: '2026-02-28T12:00:00.000000Z',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        }),
        'utf8',
      ).toString('base64url');
      await expect(
        service.listConversations(USER_A, { cursor: impossibleDateConvCursor }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'INVALID_FORMAT');
        return true;
      });
    });
  });

  describe('EP-M03 sendMessage invariants', () => {
    it('holds zero DB transactions during LLM execution, replays duplicate client_message_id with zero 2nd LLM call, and recovers failed turns', async () => {
      let activeTxDepth = 0;
      let txDepthObservedInsideGateway = -1;
      const executedSql: string[] = [];

      const storedMessages: Array<{
        id: string;
        conversation_id: string;
        user_id: string;
        role: 'user' | 'assistant';
        content: string;
        language: 'bn' | 'en' | 'mixed';
        client_message_id: string | null;
        reply_to_message_id: string | null;
        safety_mode: boolean;
        learning_claim_recorded: boolean;
        created_at: string;
      }> = [];

      const db = {
        transaction: vi.fn(
          async (
            userId: string | null,
            fn: (tx: { query: typeof queryFn }) => Promise<unknown>,
          ) => {
            activeTxDepth += 1;
            try {
              return await fn({ query: queryFn });
            } finally {
              activeTxDepth -= 1;
              void userId;
            }
          },
        ),
      } as unknown as DatabaseService;

      const queryFn = vi.fn(async (sql: string, params: unknown[] = []) => {
        executedSql.push(sql);
        if (sql.includes('FROM public.conversations')) {
          const [convId, ownerId] = params as [string, string];
          if (convId === CONV_ID && ownerId === USER_A) {
            return [
              {
                id: CONV_ID,
                context_type: 'focus_roadmap',
                roadmap_id: ROADMAP_ID,
                topic_id: null,
                title: 'Backend Development (Mid)',
                created_at: '2026-11-24T10:00:00.000Z',
              },
            ];
          }
          return [];
        }

        if (
          sql.includes('FROM public.messages') &&
          sql.includes('client_message_id = $3')
        ) {
          const [convId, ownerId, clientId] = params as [
            string,
            string,
            string,
          ];
          return storedMessages
            .filter(
              (m) =>
                m.conversation_id === convId &&
                m.user_id === ownerId &&
                m.client_message_id === clientId,
            )
            .map((m) => ({ ...m, within_retention: true }));
        }

        if (
          sql.includes('FROM public.messages') &&
          sql.includes("role = 'user'::public.message_role") &&
          sql.includes('WHERE id = $1')
        ) {
          const [msgId, convId, ownerId] = params as [string, string, string];
          return storedMessages.filter(
            (m) =>
              m.id === msgId &&
              m.conversation_id === convId &&
              m.user_id === ownerId &&
              m.role === 'user',
          );
        }

        if (
          sql.includes('FROM public.messages') &&
          sql.includes('reply_to_message_id = $3')
        ) {
          const [convId, ownerId, userMsgId] = params as [
            string,
            string,
            string,
          ];
          return storedMessages.filter(
            (m) =>
              m.conversation_id === convId &&
              m.user_id === ownerId &&
              m.role === 'assistant' &&
              m.reply_to_message_id === userMsgId,
          );
        }

        if (
          sql.includes('INSERT INTO public.messages') &&
          sql.includes("'user'::public.message_role")
        ) {
          const [convId, ownerId, content, lang, clientId] = params as [
            string,
            string,
            string,
            'bn' | 'en' | 'mixed',
            string,
          ];
          const row = {
            id: USER_MSG_1,
            conversation_id: convId,
            user_id: ownerId,
            role: 'user' as const,
            content,
            language: lang,
            client_message_id: clientId,
            reply_to_message_id: null,
            safety_mode: false,
            learning_claim_recorded: false,
            created_at: '2026-11-24T10:01:00.000Z',
          };
          storedMessages.push(row);
          return [row];
        }

        if (
          sql.includes('INSERT INTO public.messages') &&
          sql.includes("'assistant'::public.message_role")
        ) {
          const [
            convId,
            ownerId,
            content,
            lang,
            replyTo,
            safetyMode,
            claimRecorded,
          ] = params as [
            string,
            string,
            string,
            'bn' | 'en' | 'mixed',
            string,
            boolean,
            boolean,
          ];
          const row = {
            id: ASSISTANT_MSG_1,
            conversation_id: convId,
            user_id: ownerId,
            role: 'assistant' as const,
            content,
            language: lang,
            client_message_id: null,
            reply_to_message_id: replyTo,
            safety_mode: safetyMode,
            learning_claim_recorded: claimRecorded,
            created_at: '2026-11-24T10:01:02.000Z',
          };
          storedMessages.push(row);
          return [row];
        }

        return [];
      });

      let shouldTimeoutFirstAttempt = true;
      const aiGateway = {
        execute: vi.fn(async (): Promise<AIResponseDTO<MentorChatOutput>> => {
          txDepthObservedInsideGateway = activeTxDepth;
          if (shouldTimeoutFirstAttempt) {
            shouldTimeoutFirstAttempt = false;
            fail(
              504,
              'AI_TIMEOUT',
              'AI generation timed out. Please try again.',
              undefined,
              true,
            );
          }
          return {
            request_id: 'aaaaaaaa-1111-4111-8111-111111111111',
            generation_id: AI_GEN_1,
            status: 'ok',
            output: {
              content:
                'আপনার অধ্যয়নের কথা চ্যাট কনটেক্সটে সংরক্ষিত হয়েছে; ভেরিফাইড প্রোগ্রেসের জন্য কুইজ অনুশীলন সম্পন্ন করুন।',
              language: 'bn',
              safety_mode: false,
              learning_claim_recorded: true,
            },
            provider_id: 'synthetic',
            model_id: 'synthetic-offline-v1',
            fallback_used: false,
            prompt_version_id: 'bbbbbbbb-1111-4111-8111-111111111111',
            usage_units: { input: 120, output: 45 },
            cost: 0,
            latency_ms: 20,
            validation_status: 'passed',
            sources: [],
          };
        }),
      } as unknown as AiGatewayService;

      const contextAssembler = {
        assembleContext: vi.fn().mockResolvedValue({
          context: { conversation_scope: { context_type: 'focus_roadmap' } },
        }),
      } as unknown as MentorContextAssemblerService;

      const episodicSummary = {
        maybeCompact: vi
          .fn()
          .mockRejectedValueOnce(new Error('Simulated summarizer DB fault'))
          // Pending promise proves sendMessage does not block waiting on compaction
          .mockImplementationOnce(() => new Promise(() => undefined)),
      } as unknown as EpisodicSummaryService;

      const service = new MentorService(
        db,
        aiGateway,
        createRetentionStub(),
        contextAssembler,
        episodicSummary,
      );

      // 1. Foreign user isolation -> 404 CONVERSATION_NOT_FOUND
      await expect(
        service.sendMessage(USER_B, {
          conversation_id: CONV_ID,
          content: 'Foreign probe',
          client_message_id: CLIENT_MSG_1,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 404, 'CONVERSATION_NOT_FOUND');
        return true;
      });

      // 2. First attempt times out (504 AI_TIMEOUT), user message stays persisted in DB, zero tx held during LLM!
      await expect(
        service.sendMessage(USER_A, {
          conversation_id: CONV_ID,
          content: 'আমি এই টপিকটি পড়েছি (I studied this)',
          client_message_id: CLIENT_MSG_1,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 504, 'AI_TIMEOUT');
        return true;
      });
      expect(txDepthObservedInsideGateway).toBe(0);
      expect(storedMessages).toHaveLength(1);
      expect(storedMessages[0]?.id).toBe(USER_MSG_1);

      // 3. Same client_message_id with different body -> 409 IDEMPOTENCY_KEY_REUSED
      await expect(
        service.sendMessage(USER_A, {
          conversation_id: CONV_ID,
          content: 'Different mutated text',
          client_message_id: CLIENT_MSG_1,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'IDEMPOTENCY_KEY_REUSED');
        return true;
      });

      // 4. Retry with SAME client_message_id reuses USER_MSG_1, commits assistant reply, survives summarizer fault,
      //    and writes ZERO rows to learning_evidence / skill_progress / roadmap_items / daily_plan_items!
      const recovered = await service.sendMessage(USER_A, {
        conversation_id: CONV_ID,
        content: 'আমি এই টপিকটি পড়েছি (I studied this)',
        client_message_id: CLIENT_MSG_1,
      });

      expect(txDepthObservedInsideGateway).toBe(0);
      expect(recovered.user_message_id).toBe(USER_MSG_1);
      expect(recovered.assistant_message.id).toBe(ASSISTANT_MSG_1);
      expect(recovered.learning_claim_recorded).toBe(true);
      expect(storedMessages).toHaveLength(2);
      expect(aiGateway.execute).toHaveBeenCalledTimes(2);

      for (const sql of executedSql) {
        expect(sql).not.toMatch(
          /\b(learning_evidence|skill_progress|achievement_history|roadmap_items|daily_plan_items)\b/i,
        );
      }

      // 5. Third call with same client_message_id replays committed reply with ZERO additional LLM / context calls!
      const replayed = await service.sendMessage(USER_A, {
        conversation_id: CONV_ID,
        content: 'আমি এই টপিকটি পড়েছি (I studied this)',
        client_message_id: CLIENT_MSG_1,
      });
      expect(replayed).toEqual(recovered);
      expect(aiGateway.execute).toHaveBeenCalledTimes(2);
      expect(contextAssembler.assembleContext).toHaveBeenCalledTimes(2);
    });

    it('rejects expired unpurged dedup rows with 409 IDEMPOTENCY_KEY_REUSED without reading expired content, and rechecks post-lock source retention when clock advances past expiry mid-generation', async () => {
      vi.useFakeTimers();
      try {
        const initialNow = new Date('2026-11-24T10:00:00.000Z');
        vi.setSystemTime(initialNow);

        const retention = createRetentionStub(90);
        const queries: Array<{ sql: string; params: unknown[] }> = [];

        // Eligible retryable source message created 89 days + 23h ago (1 hour left before 90-day expiry)
        const sourceCreatedAt = new Date(
          initialNow.getTime() - (90 * 24 - 1) * 60 * 60 * 1_000,
        );
        const sourceExpiresAt = new Date(
          sourceCreatedAt.getTime() + 90 * 24 * 60 * 60 * 1_000,
        );
        const freshClientId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const tx2AdvancedNow = new Date(sourceExpiresAt.getTime() + 60 * 1_000);

        let tx1CheckedNow: Date | null = null;
        let tx1CheckedCutoff: Date | null = null;
        let tx2CheckedNow: Date | null = null;
        let tx2CheckedCutoff: Date | null = null;

        const db = {
          transaction: vi.fn(
            async (
              _uid: string | null,
              fn: (tx: unknown) => Promise<unknown>,
            ) =>
              fn({
                query: vi.fn(async (sql: string, params: unknown[] = []) => {
                  queries.push({ sql, params });
                  if (sql.includes('FROM public.conversations')) {
                    return [
                      {
                        id: CONV_ID,
                        context_type: 'general',
                        roadmap_id: null,
                        topic_id: null,
                        title: 'General',
                        created_at: '2026-01-01T00:00:00.000Z',
                      },
                    ];
                  }
                  if (
                    sql.includes('FROM public.messages') &&
                    sql.includes('client_message_id = $3')
                  ) {
                    const nowParam = params[3] as Date;
                    const cutoffParam = params[4] as Date;
                    // Case A: expired row reserves CLIENT_MSG_1 -> SQL masks content to NULL and returns within_retention=false
                    if (params[2] === CLIENT_MSG_1) {
                      return [
                        {
                          id: USER_MSG_1,
                          content: null,
                          language: 'en',
                          created_at: '2026-01-01T00:00:00.000Z',
                          within_retention: false,
                        },
                      ];
                    }
                    // Case B: freshClientId starts eligible at Tx 1 post-lock time
                    if (params[2] === freshClientId) {
                      tx1CheckedNow = nowParam;
                      tx1CheckedCutoff = cutoffParam;
                      const withinRetention =
                        sourceExpiresAt > nowParam &&
                        sourceCreatedAt > cutoffParam;
                      return [
                        {
                          id: USER_MSG_1,
                          content: withinRetention ? 'Fresh question' : null,
                          language: 'en',
                          created_at: sourceCreatedAt.toISOString(),
                          within_retention: withinRetention,
                        },
                      ];
                    }
                    return [];
                  }
                  if (
                    sql.includes('FROM public.messages') &&
                    sql.includes("role = 'user'::public.message_role") &&
                    sql.includes('WHERE id = $1')
                  ) {
                    const nowParam = params[3] as Date;
                    const cutoffParam = params[4] as Date;
                    tx2CheckedNow = nowParam;
                    tx2CheckedCutoff = cutoffParam;
                    const stillActive =
                      sourceExpiresAt > nowParam &&
                      sourceCreatedAt > cutoffParam;
                    return stillActive ? [{ id: USER_MSG_1 }] : [];
                  }
                  return [];
                }),
              }),
          ),
        } as unknown as DatabaseService;

        const aiGateway = {
          execute: vi.fn(async (): Promise<AIResponseDTO<MentorChatOutput>> => {
            // Advance clock past source retention expiry while LLM is executing
            vi.setSystemTime(tx2AdvancedNow);
            return {
              request_id: 'aaaaaaaa-1111-4111-8111-111111111111',
              generation_id: AI_GEN_1,
              status: 'ok',
              output: {
                content: 'Reply that must not commit if source expired',
                language: 'en',
                safety_mode: false,
                learning_claim_recorded: false,
              },
              provider_id: 'synthetic',
              model_id: 'synthetic-offline-v1',
              fallback_used: false,
              prompt_version_id: 'bbbbbbbb-1111-4111-8111-111111111111',
              usage_units: { input: 10, output: 10 },
              cost: 0,
              latency_ms: 5,
              validation_status: 'passed',
              sources: [],
            };
          }),
        } as unknown as AiGatewayService;

        const contextAssembler = {
          assembleContext: vi.fn().mockResolvedValue({ context: {} }),
        } as unknown as MentorContextAssemblerService;

        const service = new MentorService(
          db,
          aiGateway,
          retention,
          contextAssembler,
          { maybeCompact: vi.fn() } as unknown as EpisodicSummaryService,
        );

        // 1. Expired dedup row -> 409 IDEMPOTENCY_KEY_REUSED with zero LLM call and SQL masking content
        await expect(
          service.sendMessage(USER_A, {
            conversation_id: CONV_ID,
            content: 'Retrying expired client_message_id',
            client_message_id: CLIENT_MSG_1,
          }),
        ).rejects.toSatisfy((err) => {
          expectContractError(err, 409, 'IDEMPOTENCY_KEY_REUSED');
          return true;
        });
        expect(aiGateway.execute).not.toHaveBeenCalled();
        const dedupSql = queries.find((q) =>
          q.sql.includes('client_message_id = $3'),
        )?.sql;
        expect(dedupSql).toContain(
          'WHEN expires_at > $4 AND created_at > $5 THEN content',
        );

        // 2. Source starts eligible in Tx 1, clock advances past retention inside gateway -> Tx 2 rejects with 409 and inserts NO assistant row
        await expect(
          service.sendMessage(USER_A, {
            conversation_id: CONV_ID,
            content: 'Fresh question',
            client_message_id: freshClientId,
          }),
        ).rejects.toSatisfy((err) => {
          expectContractError(err, 409, 'IDEMPOTENCY_KEY_REUSED');
          return true;
        });
        expect(aiGateway.execute).toHaveBeenCalledTimes(1);
        expect(tx1CheckedNow).toEqual(initialNow);
        expect(tx1CheckedCutoff).toEqual(
          retention.getMentorMessageCutoffDate(initialNow),
        );
        expect(tx2CheckedNow).toEqual(tx2AdvancedNow);
        expect(tx2CheckedCutoff).toEqual(
          retention.getMentorMessageCutoffDate(tx2AdvancedNow),
        );
        expect(
          queries.some(
            (q) =>
              q.sql.includes('INSERT INTO public.messages') &&
              q.sql.includes("'assistant'::public.message_role"),
          ),
        ).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('EP-M04 getHistory & MentorContextAssemblerService R08 / PII isolation', () => {
    it('enforces dual-predicate R08 cutoff (expires_at > now AND created_at > cutoff) and foreign 404 isolation', async () => {
      const referenceNow = new Date('2026-11-24T12:00:00.000Z');
      const retention = createRetentionStub(90);
      const expectedCutoff = retention.getMentorMessageCutoffDate(referenceNow);

      const capturedCalls: Array<{ sql: string; params: unknown[] }> = [];
      const db = {
        transaction: vi.fn(
          async (_uid: string | null, fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              query: vi.fn(async (sql: string, params: unknown[] = []) => {
                capturedCalls.push({ sql, params });
                if (sql.includes('FROM public.conversations')) {
                  return params[1] === USER_A ? [{ id: CONV_ID }] : [];
                }
                return [
                  {
                    id: ASSISTANT_MSG_1,
                    role: 'assistant',
                    content: 'Kept message inside 90d window',
                    language: 'en',
                    created_at: '2026-11-24T11:55:00.000000Z',
                    created_at_cursor: '2026-11-24T11:55:00.000000Z',
                  },
                ];
              }),
            }),
        ),
      } as unknown as DatabaseService;

      const service = new MentorService(
        db,
        {} as AiGatewayService,
        retention,
        {} as MentorContextAssemblerService,
        { maybeCompact: vi.fn() } as unknown as EpisodicSummaryService,
      );

      await expect(
        service.getHistory(USER_B, { conversation_id: CONV_ID }, referenceNow),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 404, 'CONVERSATION_NOT_FOUND');
        return true;
      });

      const history = await service.getHistory(
        USER_A,
        { conversation_id: CONV_ID, limit: 10 },
        referenceNow,
      );
      expect(history.items).toHaveLength(1);
      const msgQuery = capturedCalls.find((c) =>
        c.sql.includes('FROM public.messages'),
      );
      expect(msgQuery?.sql).toContain('expires_at > $3');
      expect(msgQuery?.sql).toContain('created_at > $4');
      expect(msgQuery?.params[2]).toEqual(referenceNow);
      expect(msgQuery?.params[3]).toEqual(expectedCutoff);

      const impossibleHistoryCursor = Buffer.from(
        JSON.stringify({
          created_at: '2026-02-31T12:00:00.000000Z',
          id: ASSISTANT_MSG_1,
        }),
        'utf8',
      ).toString('base64url');
      await expect(
        service.getHistory(
          USER_A,
          { conversation_id: CONV_ID, cursor: impossibleHistoryCursor },
          referenceNow,
        ),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 422, 'INVALID_FORMAT');
        return true;
      });
    });

    it('assembles owner-scoped context with user_id predicates, PII redaction, and bounded 8-turn history', async () => {
      const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];
      const db = {
        transaction: vi.fn(
          async (_uid: string | null, fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              query: vi.fn(async (sql: string, params: unknown[] = []) => {
                capturedQueries.push({ sql, params });
                if (sql.includes('FROM public.user_profiles')) {
                  return [
                    {
                      current_role_title:
                        'Junior Dev contact rahim@example.com +8801712345678',
                      education: 'BSc CSE',
                      experience_level: 'junior',
                      self_reported_skill_ids: [],
                      existing_skills_none: true,
                      preferred_daily_hours: '2.0',
                      learning_preference: 'hands_on',
                    },
                  ];
                }
                if (sql.includes('FROM public.roadmaps r')) {
                  return [
                    {
                      id: ROADMAP_ID,
                      target_level: 'junior',
                      status: 'locked',
                      is_focus: true,
                      role_name: 'Backend Development',
                      version_no: 2,
                    },
                  ];
                }
                if (sql.includes('FROM public.roadmap_items ri')) {
                  return [
                    {
                      phase_no: 1,
                      phase_title:
                        'Phase 1 owner phase@example.com +8801799999999',
                      sequence_no: 1,
                      topic_id: TOPIC_ID,
                      title: 'SQL Locking',
                      priority: 'core',
                      gap_type: 'missing',
                      required_depth: 'application',
                    },
                  ];
                }
                if (sql.includes('FROM public.messages')) {
                  return Array.from({ length: 8 }, (_, idx) => ({
                    id: `00000000-0000-4000-8000-00000000000${idx + 1}`,
                    role: idx % 2 === 0 ? 'assistant' : 'user',
                    content: `Turn ${8 - idx} email leak@test.org`,
                    language: 'en',
                    safety_mode: false,
                    learning_claim_recorded: false,
                    created_at: `2026-11-24T10:0${8 - idx}:00.000Z`,
                  }));
                }
                return [];
              }),
            }),
        ),
      } as unknown as DatabaseService;

      const assembler = new MentorContextAssemblerService(
        db,
        createRetentionStub(90),
      );
      const result = await assembler.assembleContext({
        userId: USER_A,
        conversation: {
          id: CONV_ID,
          context_type: 'topic',
          roadmap_id: ROADMAP_ID,
          topic_id: TOPIC_ID,
          title: 'SQL Locking',
        },
        currentUserMessageId: USER_MSG_1,
      });

      const serialized = JSON.stringify(result.context);
      expect(serialized).not.toContain('rahim@example.com');
      expect(serialized).not.toContain('+8801712345678');
      expect(serialized).not.toContain('phase@example.com');
      expect(serialized).not.toContain('+8801799999999');
      expect(serialized).not.toContain('leak@test.org');
      expect(serialized).toContain('[REDACTED_EMAIL]');
      expect(serialized).toContain('[REDACTED_PHONE]');

      const roadmapQuery = capturedQueries.find((q) =>
        q.sql.includes('FROM public.roadmaps r'),
      );
      expect(roadmapQuery?.sql).not.toContain('rv.summary');

      const recentTurns = result.context.recent_turns as Array<{
        content: string;
      }>;
      expect(recentTurns).toHaveLength(8);
      // Reversed from DESC query into chronological order (Turn 1 -> Turn 8)
      expect(recentTurns[0]?.content).toContain('Turn 1');
      expect(recentTurns[7]?.content).toContain('Turn 8');

      for (const call of capturedQueries) {
        expect(call.sql).not.toMatch(/FROM\s+public\.users\b/i);
        expect(call.params).toContain(USER_A);
      }
    });

    it('uses canonical_name (never non-existent name) on every public.skills query matching 004_career_intelligence.sql', async () => {
      const capturedSql: string[] = [];
      const skillId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const db = {
        transaction: vi.fn(
          async (_uid: string | null, fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              query: vi.fn(async (sql: string) => {
                capturedSql.push(sql);
                if (sql.includes('FROM public.user_profiles')) {
                  return [
                    {
                      current_role_title: 'Student',
                      education: null,
                      experience_level: 'beginner',
                      self_reported_skill_ids: [skillId],
                      existing_skills_none: false,
                      preferred_daily_hours: '1.5',
                      learning_preference: 'mixed',
                    },
                  ];
                }
                if (sql.includes('FROM public.skills')) {
                  return [{ name: 'PostgreSQL' }];
                }
                if (sql.includes('FROM public.topics t')) {
                  return [
                    {
                      topic_id: TOPIC_ID,
                      title: 'Indexing',
                      career_level: 'junior',
                      skill_name: 'PostgreSQL',
                      explanation_excerpt: 'B-tree basics',
                    },
                  ];
                }
                if (sql.includes('FROM public.skill_progress sp')) {
                  return [
                    {
                      skill_name: 'PostgreSQL',
                      career_level: 'junior',
                      learning_state: 'learning',
                      evidence_count: 1,
                      state_reason: 'Completed first quiz',
                    },
                  ];
                }
                return [];
              }),
            }),
        ),
      } as unknown as DatabaseService;

      const assembler = new MentorContextAssemblerService(
        db,
        createRetentionStub(90),
      );
      const result = await assembler.assembleContext({
        userId: USER_A,
        conversation: {
          id: CONV_ID,
          context_type: 'topic',
          roadmap_id: ROADMAP_ID,
          topic_id: TOPIC_ID,
          title: 'Indexing',
        },
        currentUserMessageId: USER_MSG_1,
      });

      const skillQueries = capturedSql.filter((sql) =>
        sql.includes('public.skills'),
      );
      expect(skillQueries).toHaveLength(3);
      for (const sql of skillQueries) {
        expect(sql).toContain('canonical_name');
        expect(sql).not.toMatch(/\bs\.name\b/);
        expect(sql).not.toMatch(/SELECT\s+name\b/);
        expect(sql).not.toMatch(/ORDER\s+BY\s+name\b/);
      }

      const learnerProfile = result.context.learner_profile as {
        self_reported_skills: string[];
      };
      expect(learnerProfile.self_reported_skills).toEqual(['PostgreSQL']);
      expect(result.context.selected_topic).toMatchObject({
        skill_name: 'PostgreSQL',
      });
      expect(result.context.skill_progress_summary).toEqual([
        expect.objectContaining({ skill_name: 'PostgreSQL' }),
      ]);
    });

    it('strictly enforces <= 20000 UTF-8 byte ceiling even with oversized multi-byte Bangla context payloads', async () => {
      const db = {
        transaction: vi.fn(
          async (_uid: string | null, fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              query: vi.fn(async (sql: string) => {
                if (sql.includes('FROM public.roadmaps r')) {
                  return [
                    {
                      id: ROADMAP_ID,
                      target_level: 'senior',
                      status: 'locked',
                      is_focus: true,
                      role_name: 'Backend Development',
                      version_no: 3,
                    },
                  ];
                }
                if (sql.includes('FROM public.roadmap_items ri')) {
                  return Array.from({ length: 12 }, (_, idx) => ({
                    phase_no: 1,
                    phase_title: 'ধাপ ১ ডেটাবেজ আর্কিটেকচার',
                    sequence_no: idx + 1,
                    topic_id: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
                    title: 'বাংলা ডেটাবেজ ইনডেক্সিং ও ট্রানজ্যাকশন '.repeat(10),
                    priority: 'core',
                    gap_type: 'missing',
                    required_depth: 'গভীর বাস্তব অভিজ্ঞতা '.repeat(10),
                  }));
                }
                if (sql.includes('FROM public.topics t')) {
                  return [
                    {
                      topic_id: TOPIC_ID,
                      title: 'বাংলা টপিক শিরোনাম '.repeat(20),
                      career_level: 'senior',
                      skill_name: 'PostgreSQL',
                      explanation_excerpt: 'বাংলা ব্যাখ্যা '.repeat(400),
                    },
                  ];
                }
                if (sql.includes('FROM public.skill_progress sp')) {
                  return Array.from({ length: 10 }, (_, idx) => ({
                    skill_name: `দক্ষতা-${idx + 1}`,
                    career_level: 'senior',
                    learning_state: 'practicing',
                    evidence_count: 3,
                    state_reason: 'অগ্রগতির বিস্তারিত ব্যাখ্যা '.repeat(15),
                  }));
                }
                if (sql.includes('FROM public.conversation_summaries')) {
                  return [
                    {
                      version_no: 5,
                      summary_text: 'বাংলা সারাংশ '.repeat(500),
                      covers_until: '2026-11-24T10:00:00.000Z',
                    },
                  ];
                }
                if (sql.includes('FROM public.ai_context_records')) {
                  return Array.from({ length: 5 }, (_, idx) => ({
                    context_type: 'conversation',
                    scope_key: `${CONV_ID}-${idx}`,
                    summary_text: 'বাংলা মেমোরি রেকর্ড '.repeat(200),
                  }));
                }
                if (sql.includes('FROM public.messages')) {
                  return Array.from({ length: 8 }, (_, idx) => ({
                    id: `00000000-0000-4000-8000-00000000010${idx}`,
                    role: idx % 2 === 0 ? 'assistant' : 'user',
                    content: 'বাংলা কথোপকথন বার্তা '.repeat(150),
                    language: 'bn',
                    safety_mode: false,
                    learning_claim_recorded: false,
                    created_at: `2026-11-24T10:0${idx}:00.000Z`,
                  }));
                }
                return [];
              }),
            }),
        ),
      } as unknown as DatabaseService;

      const assembler = new MentorContextAssemblerService(
        db,
        createRetentionStub(90),
      );
      const result = await assembler.assembleContext({
        userId: USER_A,
        conversation: {
          id: CONV_ID,
          context_type: 'topic',
          roadmap_id: ROADMAP_ID,
          topic_id: TOPIC_ID,
          title: 'বাংলা টপিক',
        },
        currentUserMessageId: USER_MSG_1,
      });

      const bytes = Buffer.byteLength(JSON.stringify(result.context), 'utf8');
      expect(bytes).toBeLessThanOrEqual(20_000);
    });
  });
});

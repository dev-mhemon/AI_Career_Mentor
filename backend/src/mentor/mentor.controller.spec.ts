import {
  CanActivate,
  ExecutionContext,
  Global,
  type INestApplication,
  Injectable,
  Module,
  RequestMethod,
} from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { AccessGuard } from '../auth/guards/access.guard.js';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard.js';
import type { AccessPolicy } from '../auth/policy.js';
import { configureHttp, fail } from '../common/http.js';
import { AiGatewayService } from '../ai/services/ai-gateway.service.js';
import { PrivacyRetentionService } from '../account/services/privacy-retention.service.js';
import { MentorModule } from './mentor.module.js';
import {
  chunkCommittedReplyText,
  formatMentorSseFrame,
  MentorController,
  wantsEventStream,
} from './controllers/mentor.controller.js';
import type { ConversationDTO, MessageResponseDTO } from './dto/mentor.dto.js';
import { MentorService } from './services/mentor.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONV_ID = '22222222-2222-4222-8222-222222222222';
const ROADMAP_ID = '33333333-3333-4333-8333-333333333333';
const USER_MSG_ID = '44444444-4444-4444-8444-444444444444';
const ASSISTANT_MSG_ID = '55555555-5555-4555-8555-555555555555';
const CLIENT_MSG_ID = '66666666-6666-4666-8666-666666666666';

const SAMPLE_CONVERSATION: ConversationDTO = {
  id: CONV_ID,
  context_type: 'focus_roadmap',
  roadmap_id: ROADMAP_ID,
  topic_id: null,
  title: 'Backend Development (Mid)',
  created_at: '2026-11-24T10:00:00.000Z',
};

const SAMPLE_REPLY: MessageResponseDTO = {
  user_message_id: USER_MSG_ID,
  assistant_message: {
    id: ASSISTANT_MSG_ID,
    role: 'assistant',
    content:
      'শুরুতে PostgreSQL দিয়ে SQL শেখাটা ভালো কারণ ইনডেক্সিং, ট্রানজ্যাকশন এবং রিলেশনাল মডেলিং পরিষ্কারভাবে বোঝা যায়।',
    language: 'bn',
    created_at: '2026-11-24T10:01:00.000Z',
  },
  safety_mode: false,
  learning_claim_recorded: false,
};

interface MockGateState {
  authenticated: boolean;
  status: 'active' | 'suspended';
  aiMentorEnabled: boolean;
}

@Injectable()
class StubSupabaseAuthGuard implements CanActivate {
  constructor(private readonly state: MockGateState) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.state.authenticated) {
      fail(401, 'AUTH_REQUIRED', 'No bearer token');
    }
    const req = context.switchToHttp().getRequest<{
      user?: { sub: string; status: string };
    }>();
    req.user = { sub: USER_ID, status: this.state.status };
    return true;
  }
}

@Injectable()
class StubAccessGuard implements CanActivate {
  private readonly reflector = new Reflector();

  constructor(private readonly state: MockGateState) {}

  canActivate(context: ExecutionContext): boolean {
    const policy =
      this.reflector.getAllAndOverride<AccessPolicy>('access-policy', [
        context.getHandler(),
        context.getClass(),
      ]) ?? {};

    if (!policy.allowSuspended && this.state.status !== 'active') {
      fail(403, 'ACCOUNT_SUSPENDED', 'Account suspended');
    }
    if (policy.feature === 'ai_mentor' && !this.state.aiMentorEnabled) {
      fail(403, 'FEATURE_DISABLED', 'AI Mentor is currently disabled');
    }
    return true;
  }
}

describe('MentorController (EP-M01..EP-M04 & R15 SSE)', () => {
  describe('route metadata and @Policy feature gating', () => {
    it('registers exact C05 §14.10 paths, HTTP methods, and write-only ai_mentor gates', () => {
      const reflector = new Reflector();
      expect(Reflect.getMetadata(PATH_METADATA, MentorController)).toBe(
        'mentor',
      );
      expect(
        reflector.get<AccessPolicy>('access-policy', MentorController),
      ).toEqual({});

      const proto = MentorController.prototype;

      // EP-M01 POST /api/v1/mentor/conversations -> Gate: write (ai_mentor)
      expect(Reflect.getMetadata(PATH_METADATA, proto.createConversation)).toBe(
        'conversations',
      );
      expect(
        Reflect.getMetadata(METHOD_METADATA, proto.createConversation),
      ).toBe(RequestMethod.POST);
      expect(
        reflector.get<AccessPolicy>('access-policy', proto.createConversation),
      ).toEqual({ feature: 'ai_mentor' });

      // EP-M02 GET /api/v1/mentor/conversations -> Gate: none
      expect(Reflect.getMetadata(PATH_METADATA, proto.listConversations)).toBe(
        'conversations',
      );
      expect(
        Reflect.getMetadata(METHOD_METADATA, proto.listConversations),
      ).toBe(RequestMethod.GET);
      expect(
        reflector.get<AccessPolicy>('access-policy', proto.listConversations),
      ).toEqual({});

      // EP-M03 POST /api/v1/mentor/messages -> Gate: write (ai_mentor)
      expect(Reflect.getMetadata(PATH_METADATA, proto.sendMessage)).toBe(
        'messages',
      );
      expect(Reflect.getMetadata(METHOD_METADATA, proto.sendMessage)).toBe(
        RequestMethod.POST,
      );
      expect(
        reflector.get<AccessPolicy>('access-policy', proto.sendMessage),
      ).toEqual({ feature: 'ai_mentor' });

      // EP-M04 GET /api/v1/mentor/history -> Gate: none
      expect(Reflect.getMetadata(PATH_METADATA, proto.getHistory)).toBe(
        'history',
      );
      expect(Reflect.getMetadata(METHOD_METADATA, proto.getHistory)).toBe(
        RequestMethod.GET,
      );
      expect(
        reflector.get<AccessPolicy>('access-policy', proto.getHistory),
      ).toEqual({});
    });
  });

  describe('R15 SSE framing & Unicode chunking helpers', () => {
    it('detects Accept: text/event-stream case-insensitively, honors q=0 exclusions, and ignores quoted parameter values', () => {
      expect(wantsEventStream(undefined)).toBe(false);
      expect(wantsEventStream({ headers: {} })).toBe(false);
      expect(
        wantsEventStream({ headers: { accept: 'application/json' } }),
      ).toBe(false);
      expect(wantsEventStream({ headers: { accept: '*/*' } })).toBe(false);
      expect(
        wantsEventStream({
          headers: { accept: 'application/json, text/event-stream;q=0' },
        }),
      ).toBe(false);
      expect(
        wantsEventStream({
          headers: { accept: 'text/event-stream;q=0.000' },
        }),
      ).toBe(false);
      expect(
        wantsEventStream({
          headers: { accept: 'text/event-stream;q=0x1' },
        }),
      ).toBe(false);
      expect(
        wantsEventStream({
          headers: { accept: 'text/event-stream;q=1.000' },
        }),
      ).toBe(true);
      expect(
        wantsEventStream({
          headers: {
            accept: 'application/json;profile="x,text/event-stream,y"',
          },
        }),
      ).toBe(false);
      expect(
        wantsEventStream({
          headers: {
            accept:
              'application/json;profile="x,text/event-stream,y", text/event-stream;q=0.5',
          },
        }),
      ).toBe(true);
      expect(
        wantsEventStream({
          headers: { Accept: 'text/event-stream; charset=utf-8' },
        }),
      ).toBe(true);
      expect(
        wantsEventStream({
          headers: {
            accept: 'application/json;q=0.8, TEXT/EVENT-STREAM;q=0.5',
          },
        }),
      ).toBe(true);
    });

    it('chunks Bangla conjuncts (ক্ষ), combining marks, emoji, and unbroken text strictly on grapheme boundaries', () => {
      const conjunct = '\u0995\u09CD\u09B7'; // ক্ষ (ক + ্ + ষ)
      const conjunctRun = conjunct.repeat(40);
      const mixedSample =
        `বাংলা ক্ষেত্রের জন্য PostgreSQL indexing 🚀 এবং ${conjunctRun} ` +
        'এতে কুইজ ও প্র্যাকটিস পারফরম্যান্স উন্নত হবে। ' +
        'A'.repeat(130);
      const chunks = chunkCommittedReplyText(mixedSample, 32);
      expect(chunks.length).toBeGreaterThan(2);
      expect(chunks.join('')).toBe(mixedSample);
      for (const chunk of chunks) {
        // No chunk may start with a standalone combining vowel/virama mark or split ক্ষ mid-conjunct.
        const firstPoint = Array.from(chunk)[0] ?? '';
        expect(/^\p{M}$/u.test(firstPoint)).toBe(false);
        expect(chunk.endsWith('\u0995\u09CD')).toBe(false);
        expect(chunk.startsWith('\u09B7')).toBe(false);
      }
    });

    it('formats SSE frames matching event:<name>\\ndata:<JSON>\\n\\n', () => {
      const frame = formatMentorSseFrame({
        event: 'message.delta',
        data: { message_id: ASSISTANT_MSG_ID, seq: 0, text: 'Hello ' },
      });
      expect(frame).toBe(
        `event: message.delta\ndata: {"message_id":"${ASSISTANT_MSG_ID}","seq":0,"text":"Hello "}\n\n`,
      );
    });
  });

  describe('HTTP wire contract, feature gate enforcement, and SSE streaming', () => {
    let app: INestApplication;
    let gateState: MockGateState;
    let mockMentorService: {
      createConversation: ReturnType<typeof vi.fn>;
      listConversations: ReturnType<typeof vi.fn>;
      sendMessage: ReturnType<typeof vi.fn>;
      getHistory: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      gateState = {
        authenticated: true,
        status: 'active',
        aiMentorEnabled: true,
      };

      mockMentorService = {
        createConversation: vi.fn().mockResolvedValue(SAMPLE_CONVERSATION),
        listConversations: vi.fn().mockResolvedValue({
          items: [SAMPLE_CONVERSATION],
          meta: { limit: 20, next_cursor: null },
        }),
        sendMessage: vi.fn().mockResolvedValue(SAMPLE_REPLY),
        getHistory: vi.fn().mockResolvedValue({
          items: [SAMPLE_REPLY.assistant_message],
          meta: { limit: 20, next_cursor: 'cursor-next' },
        }),
      };

      const authGuard = new StubSupabaseAuthGuard(gateState);
      const accessGuard = new StubAccessGuard(gateState);

      const moduleRef = await Test.createTestingModule({
        controllers: [MentorController],
        providers: [
          { provide: MentorService, useValue: mockMentorService },
          { provide: APP_GUARD, useValue: authGuard },
          { provide: APP_GUARD, useValue: accessGuard },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      configureHttp(app);
      await app.init();
    });

    afterEach(async () => {
      if (app) {
        await app.close();
      }
    });

    it('EP-M01 returns 201 ConversationDTO when ai_mentor is enabled and 403 FEATURE_DISABLED when disabled', async () => {
      const okRes = await request(app.getHttpServer())
        .post('/api/v1/mentor/conversations')
        .send({ context_type: 'focus_roadmap' })
        .expect(201);

      expect(okRes.headers['x-request-id']).toBeTruthy();
      expect(okRes.body).toEqual({
        success: true,
        data: SAMPLE_CONVERSATION,
      });

      gateState.aiMentorEnabled = false;
      const disabledRes = await request(app.getHttpServer())
        .post('/api/v1/mentor/conversations')
        .send({ context_type: 'focus_roadmap' })
        .expect(403);

      expect(disabledRes.body.success).toBe(false);
      expect(disabledRes.body.error.code).toBe('FEATURE_DISABLED');
    });

    it('EP-M02 and EP-M04 remain 200 readable with top-level meta and parsed limit when ai_mentor is disabled (PRD §7)', async () => {
      gateState.aiMentorEnabled = false;
      mockMentorService.listConversations.mockImplementationOnce(
        async (_uid: string, query?: { limit?: number }) => ({
          items: [SAMPLE_CONVERSATION],
          meta: { limit: query?.limit ?? 20, next_cursor: null },
        }),
      );
      mockMentorService.getHistory.mockImplementationOnce(
        async (_uid: string, query?: { limit?: number }) => ({
          items: [SAMPLE_REPLY.assistant_message],
          meta: { limit: query?.limit ?? 20, next_cursor: 'cursor-next' },
        }),
      );

      const listRes = await request(app.getHttpServer())
        .get('/api/v1/mentor/conversations?limit=10')
        .expect(200);

      expect(mockMentorService.listConversations).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ limit: 10 }),
      );
      expect(listRes.body).toEqual({
        success: true,
        data: [SAMPLE_CONVERSATION],
        meta: { limit: 10, next_cursor: null },
      });

      const historyRes = await request(app.getHttpServer())
        .get(`/api/v1/mentor/history?conversation_id=${CONV_ID}&limit=15`)
        .expect(200);

      expect(mockMentorService.getHistory).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ conversation_id: CONV_ID, limit: 15 }),
      );
      expect(historyRes.body).toEqual({
        success: true,
        data: [SAMPLE_REPLY.assistant_message],
        meta: { limit: 15, next_cursor: 'cursor-next' },
      });
    });

    it('EP-M03 returns 201 Created JSON single envelope by default with NO Accept header', async () => {
      const noAcceptRes = await request(app.getHttpServer())
        .post('/api/v1/mentor/messages')
        .send({
          conversation_id: CONV_ID,
          content: 'Backend এ কোন database আগে শেখা উচিত?',
          client_message_id: CLIENT_MSG_ID,
        })
        .expect(201);

      expect(noAcceptRes.headers['content-type']).toMatch(/application\/json/i);
      expect(noAcceptRes.body).toEqual({
        success: true,
        data: SAMPLE_REPLY,
      });
    });

    it('EP-M03 returns 201 Created JSON when Accept excludes SSE via q=0 or embeds text/event-stream inside quoted parameter', async () => {
      const qZeroRes = await request(app.getHttpServer())
        .post('/api/v1/mentor/messages')
        .set('Accept', 'application/json, text/event-stream;q=0')
        .send({
          conversation_id: CONV_ID,
          content: 'Backend এ কোন database আগে শেখা উচিত?',
          client_message_id: CLIENT_MSG_ID,
        })
        .expect(201);

      expect(qZeroRes.headers['content-type']).toMatch(/application\/json/i);
      expect(qZeroRes.body).toEqual({
        success: true,
        data: SAMPLE_REPLY,
      });

      const quotedParamRes = await request(app.getHttpServer())
        .post('/api/v1/mentor/messages')
        .set('Accept', 'application/json;profile="x,text/event-stream,y"')
        .send({
          conversation_id: CONV_ID,
          content: 'Backend এ কোন database আগে শেখা উচিত?',
          client_message_id: CLIENT_MSG_ID,
        })
        .expect(201);

      expect(quotedParamRes.headers['content-type']).toMatch(
        /application\/json/i,
      );
      expect(quotedParamRes.body).toEqual({
        success: true,
        data: SAMPLE_REPLY,
      });
    });

    it('EP-M03 streams 200 text/event-stream (Cache-Control: no-store) with seq 0..N deltas and authoritative message.completed', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/mentor/messages')
        .set('Accept', 'text/event-stream')
        .send({
          conversation_id: CONV_ID,
          content: 'Backend এ কোন database আগে শেখা উচিত?',
          client_message_id: CLIENT_MSG_ID,
        })
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/event-stream/i);
      expect(res.headers['cache-control']).toBe('no-store');

      const rawFrames = res.text
        .split('\n\n')
        .map((block) => block.trim())
        .filter(Boolean);

      expect(rawFrames.length).toBeGreaterThanOrEqual(3);

      const parsedEvents = rawFrames.map((frame) => {
        const [eventLine, dataLine] = frame.split('\n');
        return {
          event: eventLine.replace(/^event:\s*/, ''),
          data: JSON.parse(dataLine.replace(/^data:\s*/, '')) as Record<
            string,
            unknown
          >,
        };
      });

      const deltas = parsedEvents.slice(0, -1);
      const completed = parsedEvents[parsedEvents.length - 1];

      for (let idx = 0; idx < deltas.length; idx += 1) {
        expect(deltas[idx]?.event).toBe('message.delta');
        expect(deltas[idx]?.data.message_id).toBe(
          SAMPLE_REPLY.assistant_message.id,
        );
        expect(deltas[idx]?.data.seq).toBe(idx);
      }
      expect(deltas.map((d) => String(d.data.text)).join('')).toBe(
        SAMPLE_REPLY.assistant_message.content,
      );
      expect(completed).toEqual({
        event: 'message.completed',
        data: SAMPLE_REPLY,
      });
    });

    it('EP-M03 emits normal JSON HTTP status before SSE headers on pre-commit errors and message.error if post-header write fails', async () => {
      mockMentorService.sendMessage.mockRejectedValueOnce(
        (() => {
          try {
            fail(
              504,
              'AI_TIMEOUT',
              'AI generation timed out. Please try again.',
              undefined,
              true,
            );
          } catch (e) {
            return e;
          }
        })(),
      );

      const timeoutRes = await request(app.getHttpServer())
        .post('/api/v1/mentor/messages')
        .set('Accept', 'text/event-stream')
        .send({
          conversation_id: CONV_ID,
          content: 'Retryable question',
          client_message_id: CLIENT_MSG_ID,
        })
        .expect(504);

      expect(timeoutRes.body.success).toBe(false);
      expect(timeoutRes.body.error.code).toBe('AI_TIMEOUT');
      expect(timeoutRes.body.error.retryable).toBe(true);

      // Direct unit check of post-header write failure -> emits event: message.error and ends stream cleanly.
      const controller = app.get(MentorController);
      const writes: string[] = [];
      let callCount = 0;
      const fakeRes = {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        getHeader: vi.fn().mockReturnValue('req-id-999'),
        write: vi.fn((frame: string) => {
          callCount += 1;
          if (callCount === 1) {
            throw new Error('Transient transform failure');
          }
          writes.push(frame);
          return true;
        }),
        end: vi.fn(),
      } as unknown as Response;

      await controller.sendMessage(
        {
          user: { sub: USER_ID },
          headers: { accept: 'text/event-stream' },
        },
        {
          conversation_id: CONV_ID,
          content: 'Hello',
          client_message_id: CLIENT_MSG_ID,
        },
        fakeRes,
      );

      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain('event: message.error');
      expect(writes[0]).toContain('"request_id":"req-id-999"');
      expect(fakeRes.end).toHaveBeenCalledTimes(1);
    });

    it('accepts 4000 supplementary emoji code points and rejects >4000 code points, NUL bytes, unknown fields, and missing conversation_id with 422', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/mentor/messages')
        .send({
          conversation_id: CONV_ID,
          content: '🚀'.repeat(4000),
          client_message_id: CLIENT_MSG_ID,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/mentor/messages')
        .send({
          conversation_id: CONV_ID,
          content: '🚀'.repeat(4001),
          client_message_id: CLIENT_MSG_ID,
        })
        .expect(422);

      await request(app.getHttpServer())
        .post('/api/v1/mentor/messages')
        .send({
          conversation_id: CONV_ID,
          content: 'x'.repeat(4001),
          client_message_id: CLIENT_MSG_ID,
        })
        .expect(422);

      await request(app.getHttpServer())
        .post('/api/v1/mentor/messages')
        .send({
          conversation_id: CONV_ID,
          content: 'bad\u0000byte',
          client_message_id: CLIENT_MSG_ID,
        })
        .expect(422);

      await request(app.getHttpServer())
        .post('/api/v1/mentor/messages')
        .send({
          conversation_id: CONV_ID,
          content: 'Valid text',
          client_message_id: CLIENT_MSG_ID,
          system_prompt: 'injected',
        })
        .expect(422);

      await request(app.getHttpServer())
        .post('/api/v1/mentor/conversations')
        .send({ context_type: 'general', topic_id: null })
        .expect(422);

      await request(app.getHttpServer())
        .get('/api/v1/mentor/history')
        .expect(422);
    });
  });

  describe('Production DI graph resolution (MentorModule)', () => {
    it('resolves all MentorModule, AuthModule, AccountModule, and AiModule providers cleanly without guard/service overrides', async () => {
      @Global()
      @Module({
        providers: [
          {
            provide: DataSource,
            useValue: { query: vi.fn(), createQueryRunner: vi.fn() },
          },
        ],
        exports: [DataSource],
      })
      class StubGlobalTypeOrmModule {}

      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [
              () => ({
                SUPABASE_URL: 'https://example.supabase.co',
                SUPABASE_JWT_ISSUER: 'https://example.supabase.co/auth/v1',
                SUPABASE_JWT_AUDIENCE: 'authenticated',
                SUPABASE_JWKS_URL:
                  'https://example.supabase.co/auth/v1/.well-known/jwks.json',
                SUPABASE_SECRET_KEY: 'sb_secret_test_only',
                DELETION_RECEIPT_SECRET: '0123456789abcdef0123456789abcdef',
                AI_EXECUTION_MODE: 'synthetic',
              }),
            ],
          }),
          ThrottlerModule.forRoot({
            throttlers: [{ ttl: 60000, limit: 10 }],
          }),
          StubGlobalTypeOrmModule,
          MentorModule,
        ],
      }).compile();

      expect(moduleRef.get(MentorController)).toBeDefined();
      expect(moduleRef.get(MentorService)).toBeDefined();
      expect(moduleRef.get(AiGatewayService)).toBeDefined();
      expect(moduleRef.get(PrivacyRetentionService)).toBeDefined();
      expect(moduleRef.get(SupabaseAuthGuard)).toBeDefined();
      expect(moduleRef.get(AccessGuard)).toBeDefined();

      await moduleRef.close();
    });
  });
});

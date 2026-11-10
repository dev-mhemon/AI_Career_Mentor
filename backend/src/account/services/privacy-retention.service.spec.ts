import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../auth/services/database.service.js';
import {
  DEFAULT_AI_OPERATIONAL_DAYS,
  DEFAULT_MENTOR_MESSAGE_DAYS,
  DEFAULT_RAW_RESPONSE_DAYS,
  PrivacyRetentionService,
} from './privacy-retention.service.js';

describe('PrivacyRetentionService (R08, R09, PRD §52 Privacy Retention & Purge)', () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let database: DatabaseService;
  let configService: ConfigService;
  let service: PrivacyRetentionService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockQuery = vi.fn();
    database = {
      query: mockQuery,
      transaction: vi.fn(async (_u, op) => op({ query: mockQuery })),
    } as unknown as DatabaseService;

    configService = {
      get: vi.fn((key: string) => {
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      }),
    } as unknown as ConfigService;

    service = new PrivacyRetentionService(configService, database);
  });

  describe('Retention Ceiling Clamping (Canonical Windows)', () => {
    it('uses canonical default 90 days for raw response retention and clamps out-of-bound values', () => {
      expect(service.getRawResponseRetentionDays()).toBe(
        DEFAULT_RAW_RESPONSE_DAYS,
      );

      // Clamp above 90 -> 90
      vi.spyOn(configService, 'get').mockReturnValueOnce(120);
      expect(service.getRawResponseRetentionDays()).toBe(90);

      // Clamp below 1 -> 1
      vi.spyOn(configService, 'get').mockReturnValueOnce(-5);
      expect(service.getRawResponseRetentionDays()).toBe(1);

      // Valid value 60 -> 60
      vi.spyOn(configService, 'get').mockReturnValueOnce(60);
      expect(service.getRawResponseRetentionDays()).toBe(60);
    });

    it('uses canonical default 90 days for mentor messages and clamps out-of-bound values', () => {
      expect(service.getMentorMessageRetentionDays()).toBe(
        DEFAULT_MENTOR_MESSAGE_DAYS,
      );

      vi.spyOn(configService, 'get').mockReturnValueOnce(180);
      expect(service.getMentorMessageRetentionDays()).toBe(90);

      vi.spyOn(configService, 'get').mockReturnValueOnce(0);
      expect(service.getMentorMessageRetentionDays()).toBe(1);
    });

    it('uses canonical default 30 days for AI operational logs and clamps out-of-bound values', () => {
      expect(service.getAiOperationalRetentionDays()).toBe(
        DEFAULT_AI_OPERATIONAL_DAYS,
      );

      // Clamp above 30 -> 30
      vi.spyOn(configService, 'get').mockReturnValueOnce(45);
      expect(service.getAiOperationalRetentionDays()).toBe(30);

      // Clamp below 1 -> 1
      vi.spyOn(configService, 'get').mockReturnValueOnce(-10);
      expect(service.getAiOperationalRetentionDays()).toBe(1);
    });
  });

  describe('Cutoff Date Calculations & Read Filter Helpers', () => {
    it('calculates exact 90-day cutoff for raw responses and mentor messages', () => {
      const fixedNow = new Date('2026-11-10T12:00:00.000Z');
      const expected90d = new Date('2026-08-12T12:00:00.000Z'); // 90 days prior

      expect(service.getRawAnswerCutoffDate(fixedNow).toISOString()).toBe(
        expected90d.toISOString(),
      );
      expect(service.getMentorMessageCutoffDate(fixedNow).toISOString()).toBe(
        expected90d.toISOString(),
      );
    });

    it('calculates exact 30-day cutoff for AI operational request logs', () => {
      const fixedNow = new Date('2026-11-10T12:00:00.000Z');
      const expected30d = new Date('2026-10-11T12:00:00.000Z'); // 30 days prior

      expect(service.getAiRequestCutoffDate(fixedNow).toISOString()).toBe(
        expected30d.toISOString(),
      );
    });

    it('evaluates dual-predicate raw text expiry condition (R08 dual-check)', () => {
      const fixedNow = new Date('2026-11-10T12:00:00.000Z');

      // Case 1: Created 10 days ago, expires_at in past -> EXPIRED
      expect(
        service.isRawTextExpired(
          {
            created_at: '2026-10-31T12:00:00.000Z',
            expires_at: '2026-11-05T12:00:00.000Z',
          },
          fixedNow,
        ),
      ).toBe(true);

      // Case 2: Created 10 days ago, raw_text_expires_at in past -> EXPIRED
      expect(
        service.isRawTextExpired(
          {
            created_at: '2026-10-31T12:00:00.000Z',
            raw_text_expires_at: '2026-11-01T12:00:00.000Z',
          },
          fixedNow,
        ),
      ).toBe(true);

      // Case 3: Created 95 days ago, expires_at set in future -> EXPIRED (90d ceiling enforced)
      expect(
        service.isRawTextExpired(
          {
            created_at: '2026-07-01T12:00:00.000Z',
            expires_at: '2026-12-01T12:00:00.000Z',
          },
          fixedNow,
        ),
      ).toBe(true);

      // Case 4: Created 10 days ago, expires_at in future -> NOT EXPIRED
      expect(
        service.isRawTextExpired(
          {
            created_at: '2026-10-31T12:00:00.000Z',
            expires_at: '2026-12-01T12:00:00.000Z',
          },
          fixedNow,
        ),
      ).toBe(false);
    });
  });

  describe('Physical Purge Runner (purgeExpiredData)', () => {
    it('executes full physical purge sequence across tables and returns metrics', async () => {
      const fixedNow = new Date('2026-11-10T12:00:00.000Z');

      mockQuery
        .mockResolvedValueOnce([{ oldest: '2026-08-01T12:00:00.000Z' }]) // pre-purge oldest inspection
        .mockResolvedValueOnce([{ count: 15 }]) // quiz_answers redacted
        .mockResolvedValueOnce([{ count: 42 }]) // messages deleted
        .mockResolvedValueOnce([{ count: 120 }]) // ai_requests deleted
        .mockResolvedValueOnce([{ count: 8 }]) // ai_context_records deleted
        .mockResolvedValueOnce([{ count: 3 }]); // expired outbox scrubbed

      const result = await service.purgeExpiredData({ now: fixedNow });

      expect(result.rawAnswersPurged).toBe(15);
      expect(result.messagesDeleted).toBe(42);
      expect(result.aiRequestsDeleted).toBe(120);
      expect(result.aiContextRecordsDeleted).toBe(8);
      expect(result.outboxExpiredCount).toBe(3);
      expect(result.oldestRetainedTimestamp).toBe('2026-08-01T12:00:00.000Z');
      expect(result.purgeLagMs).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // Parameter inspections (ZERO-PARSER):
      const sqlCalls = mockQuery.mock.calls.map(([sql, params]) => ({
        sql: String(sql),
        params,
      }));

      // Step 1: quiz_answers redacted with answer_text = NULL
      const quizCall = sqlCalls.find(
        (c) =>
          c.sql.includes('UPDATE public.quiz_answers') &&
          c.sql.includes('SET answer_text = NULL'),
      );
      expect(quizCall).toBeDefined();
      expect(quizCall?.params?.[0]).toEqual(fixedNow);

      // Step 2: messages deleted
      const msgCall = sqlCalls.find((c) =>
        c.sql.includes('DELETE FROM public.messages'),
      );
      expect(msgCall).toBeDefined();

      // Step 3: ai_requests deleted with 30-day cutoff
      const aiCall = sqlCalls.find((c) =>
        c.sql.includes('DELETE FROM public.ai_requests'),
      );
      expect(aiCall).toBeDefined();

      // Step 4: ai_context_records deleted
      const ctxCall = sqlCalls.find((c) =>
        c.sql.includes('DELETE FROM public.ai_context_records'),
      );
      expect(ctxCall).toBeDefined();

      // Step 5: account_deletion_requests expired outbox scrubbed
      const outboxCall = sqlCalls.find(
        (c) =>
          c.sql.includes('UPDATE public.account_deletion_requests') &&
          c.sql.includes("SET provider_cleanup = '[]'::jsonb"),
      );
      expect(outboxCall).toBeDefined();
    });

    it('emits warning log when physical purge lag exceeds 24-hour alert threshold', async () => {
      const fixedNow = new Date('2026-11-10T12:00:00.000Z');
      // Record created 120 days ago (30 days of lag beyond 90-day ceiling)
      const severelyDelayedTimestamp = new Date(
        fixedNow.getTime() - 120 * 24 * 60 * 60 * 1000,
      );

      mockQuery
        .mockResolvedValueOnce([
          { oldest: severelyDelayedTimestamp.toISOString() },
        ])
        .mockResolvedValueOnce([{ count: 5 }])
        .mockResolvedValueOnce([{ count: 10 }])
        .mockResolvedValueOnce([{ count: 20 }])
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 0 }]);

      const warnSpy = vi.spyOn(service['logger'], 'warn');

      const result = await service.purgeExpiredData({ now: fixedNow });
      expect(result.purgeLagMs).toBeGreaterThan(24 * 60 * 60 * 1000);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('PURGE_LAG_ALERT'),
      );
    });

    it('repeats purge steps in bounded batches when affected rows equal batchSize until count < batchSize', async () => {
      const fixedNow = new Date('2026-11-10T12:00:00.000Z');

      mockQuery
        .mockResolvedValueOnce([{ oldest: null }]) // pre-purge lag inspection
        // quiz_answers: 2 batches (5 then 3 = 8 total)
        .mockResolvedValueOnce([{ count: 5 }])
        .mockResolvedValueOnce([{ count: 3 }])
        // messages: 1 batch (2 < 5)
        .mockResolvedValueOnce([{ count: 2 }])
        // ai_requests: 2 batches (5 then 0 = 5 total)
        .mockResolvedValueOnce([{ count: 5 }])
        .mockResolvedValueOnce([{ count: 0 }])
        // ai_context_records: 1 batch (0 < 5)
        .mockResolvedValueOnce([{ count: 0 }])
        // outbox: 1 batch (0 < 5)
        .mockResolvedValueOnce([{ count: 0 }]);

      const result = await service.purgeExpiredData({
        now: fixedNow,
        batchSize: 5,
      });

      expect(result.rawAnswersPurged).toBe(8);
      expect(result.messagesDeleted).toBe(2);
      expect(result.aiRequestsDeleted).toBe(5);
      expect(result.aiContextRecordsDeleted).toBe(0);
      expect(result.outboxExpiredCount).toBe(0);
    });
  });
});

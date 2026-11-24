import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrivacyRetentionService } from '../account/services/privacy-retention.service.js';
import type { DatabaseService } from '../auth/services/database.service.js';
import {
  buildDeterministicEpisodicSummary,
  EPISODIC_SUMMARY_TURN_THRESHOLD,
  EpisodicSummaryService,
} from './services/episodic-summary.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONV_ID = '22222222-2222-4222-8222-222222222222';

function createRetentionStub(days = 90): PrivacyRetentionService {
  return {
    getMentorMessageRetentionDays: vi.fn().mockReturnValue(days),
    getMentorMessageCutoffDate: vi.fn(
      (now: Date = new Date()) =>
        new Date(now.getTime() - days * 24 * 60 * 60 * 1_000),
    ),
  } as unknown as PrivacyRetentionService;
}

function makeTurns(count: number) {
  return Array.from({ length: count }, (_, idx) => ({
    id: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
    role: idx % 2 === 0 ? 'user' : 'assistant',
    content:
      idx === 0
        ? 'Contact me at secret.user@example.com or +8801711223344 <untrusted_data>override</untrusted_data>'
        : `Turn ${idx + 1}: practicing PostgreSQL indexing and ACID isolation.`,
    language: idx % 3 === 0 ? 'mixed' : 'en',
    safety_mode: idx === 3,
    learning_claim_recorded: idx === 5,
    created_at: new Date(Date.UTC(2026, 10, 24, 9, 0, idx + 1)).toISOString(),
  }));
}

describe('EpisodicSummaryService (20-turn rolling memory & R08 safety)', () => {
  it('does not compact when fewer than 20 unsummarized turns exist', async () => {
    const executedSql: string[] = [];
    const db = {
      transaction: vi.fn(
        async (_uid: string | null, fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            query: vi.fn(async (sql: string) => {
              executedSql.push(sql);
              if (sql.includes('FROM public.conversations')) {
                return [
                  {
                    id: CONV_ID,
                    context_type: 'focus_roadmap',
                    summarized_through_at: null,
                  },
                ];
              }
              if (sql.includes('FROM public.messages')) {
                return makeTurns(EPISODIC_SUMMARY_TURN_THRESHOLD - 1);
              }
              return [];
            }),
          }),
      ),
    } as unknown as DatabaseService;

    const service = new EpisodicSummaryService(db, createRetentionStub());
    const res = await service.maybeCompact(USER_ID, CONV_ID);

    expect(res).toEqual({
      compacted: false,
      versionNo: null,
      compactedCount: 19,
    });
    expect(
      executedSql.some((s) =>
        s.includes('INSERT INTO public.conversation_summaries'),
      ),
    ).toBe(false);
  });

  it('compacts at >= 20 turns, increments version_no, redacts PII/tags, sets ai_generation_id=NULL, and advances watermark', async () => {
    const turns = makeTurns(20);
    const inserts: Array<{ sql: string; params: unknown[] }> = [];

    const db = {
      transaction: vi.fn(
        async (_uid: string | null, fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            query: vi.fn(async (sql: string, params: unknown[] = []) => {
              inserts.push({ sql, params });
              if (sql.includes('FROM public.conversations')) {
                return [
                  {
                    id: CONV_ID,
                    context_type: 'focus_roadmap',
                    summarized_through_at: '2026-11-24T08:00:00.000Z',
                  },
                ];
              }
              if (sql.includes('FROM public.messages')) {
                return turns;
              }
              if (sql.includes('FROM public.conversation_summaries')) {
                return [
                  {
                    version_no: 2,
                    summary_text:
                      'Previous v2 summary with phone 01812345678 and SQL focus.',
                    covers_until: '2026-11-24T08:00:00.000Z',
                  },
                ];
              }
              return [];
            }),
          }),
      ),
    } as unknown as DatabaseService;

    const service = new EpisodicSummaryService(db, createRetentionStub());
    const res = await service.maybeCompact(
      USER_ID,
      CONV_ID,
      new Date('2026-11-24T12:00:00.000Z'),
    );

    expect(res).toEqual({
      compacted: true,
      versionNo: 3,
      compactedCount: 20,
    });

    const summaryInsert = inserts.find((c) =>
      c.sql.includes('INSERT INTO public.conversation_summaries'),
    );
    expect(summaryInsert).toBeDefined();
    expect(summaryInsert?.sql).toContain('VALUES ($1, $2, $3, $4, $5, NULL)');
    expect(summaryInsert?.params[2]).toBe(3);

    const summaryText = String(summaryInsert?.params[3] ?? '');
    expect(summaryText.length).toBeGreaterThan(0);
    expect(summaryText.length).toBeLessThanOrEqual(8_000);
    expect(summaryText).not.toContain('secret.user@example.com');
    expect(summaryText).not.toContain('+8801711223344');
    expect(summaryText).not.toContain('01812345678');
    expect(summaryText).not.toContain('<untrusted_data>');
    expect(summaryText).toContain('[REDACTED_EMAIL]');
    expect(summaryText).toContain('[REDACTED_PHONE]');

    const watermarkUpdate = inserts.find((c) =>
      c.sql.includes('UPDATE public.conversations'),
    );
    expect(watermarkUpdate?.params[2]).toBe(turns[19]?.created_at);

    const contextUpsert = inserts.find((c) =>
      c.sql.includes('INSERT INTO public.ai_context_records'),
    );
    expect(contextUpsert?.params[3]).toBe(3);
  });

  it('clamps oversized summary inputs strictly within 1..8000 chars, preserves newly compacted turns, and advances covers_until only through represented turns', () => {
    const hugeTurns = Array.from({ length: 60 }, (_, idx) => ({
      id: `id-${idx}`,
      role: 'assistant',
      content:
        `TurnMarker_${idx + 1} ` +
        'বাংলা ও English detailed technical guidance '.repeat(40),
      language: 'mixed',
      safety_mode: false,
      learning_claim_recorded: false,
      created_at: new Date(Date.UTC(2026, 10, 24, 9, 0, idx + 1)).toISOString(),
    }));
    const built = buildDeterministicEpisodicSummary({
      previousSummaryText: 'Prior context '.repeat(500),
      nextVersionNo: 5,
      messages: hugeTurns,
    });
    expect(built.summaryText.length).toBeGreaterThanOrEqual(1);
    expect(built.summaryText.length).toBeLessThanOrEqual(8_000);
    expect(built.representedCount).toBeGreaterThan(0);
    expect(built.representedCount).toBeLessThan(60);
    expect(built.lastRepresentedMessage).toEqual(
      hugeTurns[built.representedCount - 1],
    );
    expect(built.summaryText).toContain('TurnMarker_1');
    expect(built.summaryText).toContain(`TurnMarker_${built.representedCount}`);
    expect(built.summaryText).not.toContain(
      `TurnMarker_${built.representedCount + 1}`,
    );
  });

  it('drops expired prior summary text at exact retention cutoff (covers_until === cutoff) while incrementing version_no and setting watermark to last represented turn', async () => {
    const referenceNow = new Date('2026-11-24T12:00:00.000Z');
    const retention = createRetentionStub(90);
    const exactCutoffIso = retention
      .getMentorMessageCutoffDate(referenceNow)
      .toISOString();

    const hugeTurns = Array.from({ length: 60 }, (_, idx) => ({
      id: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
      role: idx % 2 === 0 ? 'user' : 'assistant',
      content:
        `NewBatchTurn_${idx + 1} ` +
        'Detailed PostgreSQL indexing notes for compaction testing. '.repeat(6),
      language: 'en',
      safety_mode: false,
      learning_claim_recorded: false,
      created_at: new Date(Date.UTC(2026, 10, 24, 9, 0, idx + 1)).toISOString(),
    }));

    const inserts: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      transaction: vi.fn(
        async (_uid: string | null, fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            query: vi.fn(async (sql: string, params: unknown[] = []) => {
              inserts.push({ sql, params });
              if (sql.includes('FROM public.conversations')) {
                return [
                  {
                    id: CONV_ID,
                    context_type: 'focus_roadmap',
                    summarized_through_at: exactCutoffIso,
                  },
                ];
              }
              if (sql.includes('FROM public.messages')) {
                return hugeTurns;
              }
              if (sql.includes('FROM public.conversation_summaries')) {
                return [
                  {
                    version_no: 4,
                    summary_text: 'EXPIRED_PRIOR_SUMMARY_SECRET_MARKER',
                    covers_until: exactCutoffIso,
                  },
                ];
              }
              return [];
            }),
          }),
      ),
    } as unknown as DatabaseService;

    const service = new EpisodicSummaryService(db, retention);
    const res = await service.maybeCompact(USER_ID, CONV_ID, referenceNow);

    expect(res.compacted).toBe(true);
    expect(res.versionNo).toBe(5);
    expect(res.compactedCount).toBeGreaterThan(0);
    expect(res.compactedCount).toBeLessThan(60);

    const summaryInsert = inserts.find((c) =>
      c.sql.includes('INSERT INTO public.conversation_summaries'),
    );
    const summaryText = String(summaryInsert?.params[3] ?? '');
    expect(summaryText).not.toContain('EXPIRED_PRIOR_SUMMARY_SECRET_MARKER');
    expect(summaryInsert?.params[4]).toBe(
      hugeTurns[res.compactedCount - 1]?.created_at,
    );

    const watermarkUpdate = inserts.find((c) =>
      c.sql.includes('UPDATE public.conversations'),
    );
    expect(watermarkUpdate?.params[2]).toBe(
      hugeTurns[res.compactedCount - 1]?.created_at,
    );
  });

  it('swallows DB failures safely without throwing or logging private message content in any logger.warn argument (R08 / R11)', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const sensitiveSecretMessage = 'PRIVATE_USER_CHAT_CONTENT_DO_NOT_LOG';
    const fault = new Error(`Query failed near ${sensitiveSecretMessage}`);

    const db = {
      transaction: vi.fn().mockRejectedValue(fault),
    } as unknown as DatabaseService;

    const service = new EpisodicSummaryService(db, createRetentionStub());
    const result = await service.maybeCompact(USER_ID, CONV_ID);

    expect(result).toEqual({
      compacted: false,
      versionNo: null,
      compactedCount: 0,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const callArgs = warnSpy.mock.calls[0] ?? [];
    expect(String(callArgs[0] ?? '')).toContain(CONV_ID);
    for (const arg of callArgs) {
      if (arg instanceof Error) {
        expect(arg.message).not.toContain(sensitiveSecretMessage);
        expect(arg.stack ?? '').not.toContain(sensitiveSecretMessage);
      } else {
        expect(String(arg)).not.toContain(sensitiveSecretMessage);
        if (arg && typeof arg === 'object') {
          expect(JSON.stringify(arg)).not.toContain(sensitiveSecretMessage);
        }
      }
    }

    warnSpy.mockRestore();
  });
});

import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrivacyRetentionService } from '../../account/services/privacy-retention.service.js';
import { redactPiiText } from '../../ai/services/context-builder.service.js';
import { DatabaseService } from '../../auth/services/database.service.js';

/** Rolling compaction threshold (`C08` §10.1 / `C05` §18.3: every 20 conversation turns). */
export const EPISODIC_SUMMARY_TURN_THRESHOLD = 20;

const MAX_SUMMARY_CHARS = 8_000;
const TARGET_SUMMARY_CODE_POINTS = 7_600;
const PRIOR_SUMMARY_CARRY_CODE_POINTS = 2_800;
const PER_TURN_EXCERPT_CODE_POINTS = 160;
const MAX_BATCH_MESSAGES = 60;

export interface EpisodicCompactionResult {
  compacted: boolean;
  versionNo: number | null;
  compactedCount: number;
}

export interface UnsummarizedMessageRow {
  id: string;
  role: string;
  content: string;
  language: string;
  safety_mode: boolean;
  learning_claim_recorded: boolean;
  created_at: Date | string;
}

export interface BuiltEpisodicSummary {
  summaryText: string;
  representedCount: number;
  lastRepresentedMessage: UnsummarizedMessageRow | null;
}

interface QueryExecutor {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
}

interface LockedConversationRow {
  id: string;
  context_type: string;
  summarized_through_at: Date | string | null;
}

interface ExistingSummaryRow {
  version_no: number;
  summary_text: string;
  covers_until?: Date | string | null;
}

function sanitizeSummarySnippet(raw: string, maxCodePoints: number): string {
  const cleaned = redactPiiText(raw)
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const points = Array.from(cleaned);
  let bounded =
    points.length <= maxCodePoints
      ? cleaned
      : `${points.slice(0, Math.max(1, maxCodePoints - 1)).join('')}…`;

  // Keep UTF-16 length bounded as well for supplementary characters.
  if (bounded.length > maxCodePoints) {
    const safePoints = Array.from(bounded);
    while (
      safePoints.length > 1 &&
      safePoints.join('').length > maxCodePoints
    ) {
      safePoints.pop();
    }
    bounded = `${safePoints.slice(0, Math.max(1, safePoints.length - 1)).join('')}…`;
  }
  return bounded;
}

function fitsSummaryBounds(text: string): boolean {
  return (
    text.length >= 1 &&
    text.length <= MAX_SUMMARY_CHARS &&
    Array.from(text).length <= TARGET_SUMMARY_CODE_POINTS
  );
}

function renderSummaryText(
  nextVersionNo: number,
  priorExcerpt: string | null,
  representedMessages: ReadonlyArray<UnsummarizedMessageRow>,
  turnLines: ReadonlyArray<string>,
): string {
  const languages = Array.from(
    new Set(representedMessages.map((m) => m.language).filter(Boolean)),
  );
  const safetyCount = representedMessages.filter((m) => m.safety_mode).length;
  const claimCount = representedMessages.filter(
    (m) => m.learning_claim_recorded,
  ).length;

  const lines: string[] = [
    `Episodic Summary v${nextVersionNo} (${representedMessages.length} turns; languages=${languages.join(',') || 'mixed'}; safety_redirects=${safetyCount}; unverified_study_claims=${claimCount})`,
  ];
  if (priorExcerpt) {
    lines.push(`Prior context: ${priorExcerpt}`);
  }
  lines.push('Recent compacted turns:');
  lines.push(...turnLines);
  return lines.join('\n').trim();
}

/**
 * Builds a deterministic, PII-redacted episodic summary (`1..8000` chars) with separate
 * budgets for prior summary carry-over (`<= 2800` chars) and newly compacted turns (`>= 4500` chars).
 *
 * Returns the exact `lastRepresentedMessage` included in `summaryText` so callers advance
 * `covers_until` / `summarized_through_at` ONLY through turns actually represented.
 */
export function buildDeterministicEpisodicSummary(params: {
  previousSummaryText: string | null;
  nextVersionNo: number;
  messages: ReadonlyArray<UnsummarizedMessageRow>;
}): BuiltEpisodicSummary {
  const { previousSummaryText, nextVersionNo, messages } = params;
  if (messages.length === 0) {
    return {
      summaryText: `Episodic Summary v${nextVersionNo}`,
      representedCount: 0,
      lastRepresentedMessage: null,
    };
  }

  const priorExcerpt =
    previousSummaryText && previousSummaryText.trim().length > 0
      ? sanitizeSummarySnippet(
          previousSummaryText,
          PRIOR_SUMMARY_CARRY_CODE_POINTS,
        ) || null
      : null;

  const representedMessages: UnsummarizedMessageRow[] = [];
  const turnLines: string[] = [];

  for (const msg of messages) {
    const snippet =
      sanitizeSummarySnippet(msg.content, PER_TURN_EXCERPT_CODE_POINTS) ||
      '(message)';
    const flags: string[] = [];
    if (msg.safety_mode) {
      flags.push('safety_mode');
    }
    if (msg.learning_claim_recorded) {
      flags.push('claim_context_only');
    }
    const flagSuffix = flags.length > 0 ? ` [${flags.join(',')}]` : '';
    const line = `- [${msg.role}${flagSuffix}] ${snippet}`;

    const candidateMessages = [...representedMessages, msg];
    const candidateLines = [...turnLines, line];
    const candidateText = renderSummaryText(
      nextVersionNo,
      priorExcerpt,
      candidateMessages,
      candidateLines,
    );

    if (!fitsSummaryBounds(candidateText)) {
      break;
    }

    representedMessages.push(msg);
    turnLines.push(line);
  }

  // Always represent at least the oldest unsummarized message (dropping prior excerpt if needed).
  if (representedMessages.length === 0) {
    const first = messages[0];
    const snippet =
      sanitizeSummarySnippet(first.content, PER_TURN_EXCERPT_CODE_POINTS) ||
      '(message)';
    const firstLine = `- [${first.role}] ${snippet}`;
    representedMessages.push(first);
    turnLines.push(firstLine);
    const fallbackText = renderSummaryText(
      nextVersionNo,
      null,
      representedMessages,
      turnLines,
    );
    return {
      summaryText: fallbackText.slice(0, MAX_SUMMARY_CHARS),
      representedCount: 1,
      lastRepresentedMessage: first,
    };
  }

  const summaryText = renderSummaryText(
    nextVersionNo,
    priorExcerpt,
    representedMessages,
    turnLines,
  );
  return {
    summaryText,
    representedCount: representedMessages.length,
    lastRepresentedMessage:
      representedMessages[representedMessages.length - 1] ?? null,
  };
}

/**
 * Rolling 20-turn episodic conversation summarizer (`C08` §10.1, `C05` §18.3, `R08`).
 *
 * Invariants:
 * - Only compacts when `>= 20` non-expired unsummarized messages accumulate past
 *   `conversations.summarized_through_at`.
 * - Persists `ai_generation_id = NULL` (no unapproved 10th `ai_task` enum), increments
 *   `version_no`, advances `conversations.summarized_through_at` ONLY through represented turns,
 *   never carries forward expired prior summaries (`covers_until <= cutoff`), and refreshes
 *   `ai_context_records`.
 * - Never throws out of `maybeCompact`: any failure logs only a content-free warning and
 *   never blocks `EP-M03` or delays 90-day raw message retention (`R08`).
 */
@Injectable()
export class EpisodicSummaryService {
  private readonly logger = new Logger(EpisodicSummaryService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PrivacyRetentionService)
    private readonly privacyRetention: PrivacyRetentionService,
  ) {}

  private async runTx<T>(
    userId: string,
    operation: (tx: QueryExecutor) => Promise<T>,
  ): Promise<T> {
    if (typeof this.database.transaction === 'function') {
      return this.database.transaction(
        userId,
        (tx) => operation(tx),
        true,
        false,
        true,
      );
    }
    return operation(this.database);
  }

  /**
   * Checks whether `>= 20` unsummarized non-expired turns exist on `conversationId`
   * and compacts them into a new `public.conversation_summaries` version if so.
   * Swallows errors safely per `R08` without logging private message content.
   */
  async maybeCompact(
    userId: string,
    conversationId: string,
    explicitNow?: Date,
  ): Promise<EpisodicCompactionResult> {
    try {
      return await this.runTx(userId, async (tx) => {
        const convRows = await tx.query<LockedConversationRow[]>(
          `SELECT id,
                  context_type::text AS context_type,
                  summarized_through_at
             FROM public.conversations
            WHERE id = $1
              AND user_id = $2
            FOR UPDATE`,
          [conversationId, userId],
        );
        const conversation = Array.isArray(convRows) ? convRows[0] : undefined;
        if (!conversation) {
          return { compacted: false, versionNo: null, compactedCount: 0 };
        }

        const now = explicitNow ?? new Date();
        const messageCutoff =
          this.privacyRetention.getMentorMessageCutoffDate(now);

        const unsummarizedRows = await tx.query<UnsummarizedMessageRow[]>(
          `SELECT id,
                  role::text AS role,
                  content,
                  language::text AS language,
                  safety_mode,
                  learning_claim_recorded,
                  created_at
             FROM public.messages
            WHERE conversation_id = $1
              AND user_id = $2
              AND expires_at > $3
              AND created_at > $4
              AND ($5::timestamptz IS NULL OR created_at > $5::timestamptz)
            ORDER BY created_at ASC, id ASC
            LIMIT $6`,
          [
            conversationId,
            userId,
            now,
            messageCutoff,
            conversation.summarized_through_at ?? null,
            MAX_BATCH_MESSAGES,
          ],
        );

        const messages = Array.isArray(unsummarizedRows)
          ? unsummarizedRows
          : [];
        if (messages.length < EPISODIC_SUMMARY_TURN_THRESHOLD) {
          return {
            compacted: false,
            versionNo: null,
            compactedCount: messages.length,
          };
        }

        const prevRows = await tx.query<ExistingSummaryRow[]>(
          `SELECT version_no,
                  summary_text,
                  covers_until
             FROM public.conversation_summaries
            WHERE conversation_id = $1
              AND user_id = $2
            ORDER BY version_no DESC
            LIMIT 1`,
          [conversationId, userId],
        );
        const prev = Array.isArray(prevRows) ? prevRows[0] : undefined;
        const nextVersionNo =
          prev && typeof prev.version_no === 'number' && prev.version_no >= 1
            ? prev.version_no + 1
            : 1;

        // R08: Only carry prior summary text forward when its covers_until is within retention cutoff.
        const prevCoversUntilMs = prev?.covers_until
          ? new Date(prev.covers_until).getTime()
          : NaN;
        const previousSummaryText =
          prev &&
          Number.isFinite(prevCoversUntilMs) &&
          prevCoversUntilMs > messageCutoff.getTime()
            ? prev.summary_text
            : null;

        const built = buildDeterministicEpisodicSummary({
          previousSummaryText,
          nextVersionNo,
          messages,
        });
        if (!built.lastRepresentedMessage) {
          return { compacted: false, versionNo: null, compactedCount: 0 };
        }
        const coversUntil = built.lastRepresentedMessage.created_at;

        await tx.query(
          `INSERT INTO public.conversation_summaries (
             conversation_id,
             user_id,
             version_no,
             summary_text,
             covers_until,
             ai_generation_id
           )
           VALUES ($1, $2, $3, $4, $5, NULL)`,
          [
            conversationId,
            userId,
            nextVersionNo,
            built.summaryText,
            coversUntil,
          ],
        );

        await tx.query(
          `UPDATE public.conversations
              SET summarized_through_at = GREATEST(
                    COALESCE(summarized_through_at, '-infinity'::timestamptz),
                    $3::timestamptz
                  )
            WHERE id = $1
              AND user_id = $2`,
          [conversationId, userId, coversUntil],
        );

        await tx.query(
          `INSERT INTO public.ai_context_records (
             user_id,
             context_type,
             scope_key,
             summary_text,
             source_ref,
             version,
             valid_until
           )
           VALUES (
             $1,
             'conversation'::public.ai_context_type,
             $2,
             $3,
             jsonb_build_object('conversation_id', $2::text, 'summary_version', $4::int),
             $4,
             clock_timestamp() + interval '30 days'
           )
           ON CONFLICT (user_id, context_type, scope_key) DO UPDATE SET
             summary_text = EXCLUDED.summary_text,
             source_ref = EXCLUDED.source_ref,
             version = EXCLUDED.version,
             valid_until = EXCLUDED.valid_until,
             updated_at = clock_timestamp()`,
          [userId, conversationId, built.summaryText, nextVersionNo],
        );

        return {
          compacted: true,
          versionNo: nextVersionNo,
          compactedCount: built.representedCount,
        };
      });
    } catch (error) {
      const errorType = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Episodic summary compaction failed for conversation=${conversationId} errorType=${errorType}`,
      );
      return { compacted: false, versionNo: null, compactedCount: 0 };
    }
  }
}

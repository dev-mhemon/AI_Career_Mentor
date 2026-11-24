import { Inject, Injectable } from '@nestjs/common';
import { PrivacyRetentionService } from '../../account/services/privacy-retention.service.js';
import { redactPiiText } from '../../ai/services/context-builder.service.js';
import { DatabaseService } from '../../auth/services/database.service.js';
import type { ConversationContextType } from '../dto/mentor.dto.js';

const MAX_RECENT_TURNS = 8;
const MAX_TURN_EXCERPT_CHARS = 1_000;
const MAX_SUMMARY_CHARS = 3_500;
const MAX_CONTEXT_RECORD_CHARS = 1_200;
const MAX_ROADMAP_ITEMS = 12;
const MAX_SKILL_PROGRESS_ITEMS = 10;
const MAX_CONTEXT_JSON_BYTES = 20_000;

export interface MentorConversationScope {
  id: string;
  context_type: ConversationContextType;
  roadmap_id: string | null;
  topic_id: string | null;
  title: string | null;
}

export interface AssembleMentorContextInput {
  userId: string;
  conversation: MentorConversationScope;
  currentUserMessageId: string;
  now?: Date;
}

export interface AssembledMentorContext {
  context: Record<string, unknown>;
}

interface QueryExecutor {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
}

interface ProfileRow {
  current_role_title: string | null;
  education: string | null;
  experience_level: string | null;
  self_reported_skill_ids: string[] | null;
  existing_skills_none: boolean | null;
  preferred_daily_hours: string | number | null;
  learning_preference: string | null;
}

interface SkillNameRow {
  name: string;
}

interface RoadmapContextRow {
  id: string;
  target_level: string;
  status: string;
  is_focus: boolean;
  role_name: string;
  version_no: number | null;
}

interface RoadmapItemContextRow {
  phase_no: number;
  phase_title: string | null;
  sequence_no: number;
  topic_id: string;
  title: string;
  priority: string;
  gap_type: string;
  required_depth: string | null;
}

interface TopicContextRow {
  topic_id: string;
  title: string;
  career_level: string;
  skill_name: string;
  explanation_excerpt: string | null;
}

interface SkillProgressContextRow {
  skill_name: string;
  career_level: string;
  learning_state: string;
  evidence_count: number;
  state_reason: string | null;
}

interface SummaryContextRow {
  version_no: number;
  summary_text: string;
  covers_until: Date | string;
}

interface AiContextRecordRow {
  context_type: string;
  scope_key: string;
  summary_text: string;
}

interface RecentMessageRow {
  id: string;
  role: string;
  content: string;
  language: string;
  safety_mode: boolean;
  learning_claim_recorded: boolean;
  created_at: Date | string;
}

function truncateSafe(raw: string, maxCodePoints: number): string {
  const sanitized = redactPiiText(raw).trim();
  const points = Array.from(sanitized);
  if (points.length <= maxCodePoints) {
    return sanitized;
  }
  return `${points.slice(0, Math.max(1, maxCodePoints - 1)).join('')}…`;
}

/**
 * Owner-scoped bounded context assembler for `EP-M03` (`C05` §14.10 / §18.3, `C08` §8.2 / §10).
 *
 * Invariants:
 * - Every query strictly filters by `user_id = $1` (never cross-tenant).
 * - Never queries raw `users.email` or `users.phone` PII columns.
 * - Enforces dual-predicate 90-day `R08` retention cutoff (`expires_at > now AND created_at > cutoff`)
 *   and bounds recent history to the last 8 turns plus compressed episodic summaries.
 * - Executes outside LLM-awaiting transactions so zero row locks are held during AI calls.
 */
@Injectable()
export class MentorContextAssemblerService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PrivacyRetentionService)
    private readonly privacyRetention: PrivacyRetentionService,
  ) {}

  private async runRead<T>(
    operation: (db: QueryExecutor) => Promise<T>,
  ): Promise<T> {
    if (typeof this.database.transaction === 'function') {
      return this.database.transaction(
        null,
        (db) => operation(db),
        false,
        false,
        true,
      );
    }
    return operation(this.database);
  }

  /**
   * Assembles bounded, PII-minimized, owner-only context for `mentor_chat` (`prompts/mentor-chat.v1`).
   */
  async assembleContext(
    input: AssembleMentorContextInput,
  ): Promise<AssembledMentorContext> {
    const now = input.now ?? new Date();
    const messageCutoff = this.privacyRetention.getMentorMessageCutoffDate(now);
    const { userId, conversation, currentUserMessageId } = input;

    return this.runRead(async (db) => {
      const profileRows = await db.query<ProfileRow[]>(
        `SELECT up.current_role_title,
                up.education,
                up.experience_level::text AS experience_level,
                up.self_reported_skill_ids,
                up.existing_skills_none,
                up.preferred_daily_hours,
                pref.learning_preference
           FROM public.user_profiles up
           LEFT JOIN public.user_preferences pref
             ON pref.user_id = up.user_id
          WHERE up.user_id = $1
          LIMIT 1`,
        [userId],
      );
      const profile = Array.isArray(profileRows) ? profileRows[0] : undefined;

      let selfReportedSkills: string[] = [];
      if (
        profile &&
        !profile.existing_skills_none &&
        Array.isArray(profile.self_reported_skill_ids) &&
        profile.self_reported_skill_ids.length > 0
      ) {
        const skillRows = await db.query<SkillNameRow[]>(
          `SELECT canonical_name AS name
             FROM public.skills
            WHERE id = ANY($1::uuid[])
              AND status = 'approved'
              AND deleted_at IS NULL
            ORDER BY canonical_name ASC
            LIMIT 25`,
          [profile.self_reported_skill_ids.slice(0, 25)],
        );
        if (Array.isArray(skillRows)) {
          selfReportedSkills = skillRows.map((s) => s.name);
        }
      }

      const roadmapRows = await db.query<RoadmapContextRow[]>(
        `SELECT r.id,
                r.target_level::text AS target_level,
                r.status::text AS status,
                r.is_focus,
                cr.name AS role_name,
                rv.version_no
           FROM public.roadmaps r
           JOIN public.career_roles cr ON cr.id = r.canonical_role_id
           LEFT JOIN public.roadmap_versions rv
             ON rv.id = r.current_version_id
            AND rv.user_id = r.user_id
          WHERE r.user_id = $1
            AND r.status <> 'archived'
            AND (
              ($2::uuid IS NOT NULL AND r.id = $2::uuid)
              OR (r.status = 'locked' AND r.is_focus = true)
            )
          ORDER BY (r.id = $2::uuid) DESC NULLS LAST, r.is_focus DESC
          LIMIT 1`,
        [userId, conversation.roadmap_id],
      );
      const activeRoadmap = Array.isArray(roadmapRows)
        ? roadmapRows[0]
        : undefined;

      let roadmapTopics: Array<Record<string, unknown>> = [];
      if (activeRoadmap) {
        const itemRows = await db.query<RoadmapItemContextRow[]>(
          `SELECT ri.phase_no,
                  ri.phase_title,
                  ri.sequence_no,
                  ri.topic_id,
                  ri.title,
                  ri.priority::text AS priority,
                  ri.gap_type::text AS gap_type,
                  ri.required_depth
             FROM public.roadmap_items ri
             JOIN public.roadmaps r
               ON r.current_version_id = ri.version_id
              AND r.user_id = ri.user_id
            WHERE ri.user_id = $1
              AND r.id = $2
              AND ri.retired = false
            ORDER BY ri.phase_no ASC, ri.sequence_no ASC
            LIMIT $3`,
          [userId, activeRoadmap.id, MAX_ROADMAP_ITEMS],
        );
        if (Array.isArray(itemRows)) {
          roadmapTopics = itemRows.map((item) => ({
            phase_no: item.phase_no,
            phase_title: item.phase_title
              ? truncateSafe(item.phase_title, 160)
              : null,
            sequence_no: item.sequence_no,
            topic_id: item.topic_id,
            title: truncateSafe(item.title, 160),
            priority: item.priority,
            gap_type: item.gap_type,
            required_depth: item.required_depth
              ? truncateSafe(item.required_depth, 120)
              : null,
          }));
        }
      }

      let selectedTopic: Record<string, unknown> | null = null;
      if (conversation.topic_id) {
        const topicRows = await db.query<TopicContextRow[]>(
          `SELECT t.id AS topic_id,
                  t.title,
                  t.career_level::text AS career_level,
                  s.canonical_name AS skill_name,
                  LEFT(COALESCE(t.explanation_markdown, ''), 1200) AS explanation_excerpt
             FROM public.topics t
             JOIN public.skills s ON s.id = t.skill_id
            WHERE t.id = $2
              AND t.deleted_at IS NULL
              AND EXISTS (
                SELECT 1
                  FROM public.roadmap_items ri
                 WHERE ri.user_id = $1
                   AND ri.topic_id = t.id
              )
            LIMIT 1`,
          [userId, conversation.topic_id],
        );
        const topic = Array.isArray(topicRows) ? topicRows[0] : undefined;
        if (topic) {
          selectedTopic = {
            topic_id: topic.topic_id,
            title: truncateSafe(topic.title, 200),
            career_level: topic.career_level,
            skill_name: topic.skill_name,
            explanation_excerpt: topic.explanation_excerpt
              ? truncateSafe(topic.explanation_excerpt, 800)
              : null,
          };
        }
      }

      const progressRows = await db.query<SkillProgressContextRow[]>(
        `SELECT s.canonical_name AS skill_name,
                sp.career_level::text AS career_level,
                sp.learning_state::text AS learning_state,
                sp.evidence_count,
                sp.state_reason
           FROM public.skill_progress sp
           JOIN public.skills s ON s.id = sp.skill_id
          WHERE sp.user_id = $1
            AND sp.learning_state IN ('learning', 'practicing', 'proficient')
          ORDER BY
            CASE sp.learning_state
              WHEN 'practicing' THEN 1
              WHEN 'learning' THEN 2
              ELSE 3
            END,
            sp.updated_at DESC
          LIMIT $2`,
        [userId, MAX_SKILL_PROGRESS_ITEMS],
      );
      const skillProgress = Array.isArray(progressRows)
        ? progressRows.map((row) => ({
            skill_name: row.skill_name,
            career_level: row.career_level,
            learning_state: row.learning_state,
            evidence_count: Number(row.evidence_count ?? 0),
            state_reason: row.state_reason
              ? truncateSafe(row.state_reason, 160)
              : null,
          }))
        : [];

      const summaryRows = await db.query<SummaryContextRow[]>(
        `SELECT version_no,
                summary_text,
                covers_until
           FROM public.conversation_summaries
          WHERE conversation_id = $1
            AND user_id = $2
          ORDER BY version_no DESC
          LIMIT 1`,
        [conversation.id, userId],
      );
      const latestSummary = Array.isArray(summaryRows)
        ? summaryRows[0]
        : undefined;

      const contextRecordRows = await db.query<AiContextRecordRow[]>(
        `SELECT context_type::text AS context_type,
                scope_key,
                summary_text
           FROM public.ai_context_records
          WHERE user_id = $1
            AND valid_until > $2
            AND (
              context_type <> 'conversation'::public.ai_context_type
              OR scope_key = ''
              OR scope_key = $3
            )
          ORDER BY updated_at DESC
          LIMIT 5`,
        [userId, now, conversation.id],
      );
      const contextRecords = Array.isArray(contextRecordRows)
        ? contextRecordRows.map((rec) => ({
            context_type: rec.context_type,
            scope_key: rec.scope_key,
            summary_text: truncateSafe(
              rec.summary_text,
              MAX_CONTEXT_RECORD_CHARS,
            ),
          }))
        : [];

      const recentMessageRows = await db.query<RecentMessageRow[]>(
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
            AND id <> $3
            AND expires_at > $4
            AND created_at > $5
          ORDER BY created_at DESC, id DESC
          LIMIT $6`,
        [
          conversation.id,
          userId,
          currentUserMessageId,
          now,
          messageCutoff,
          MAX_RECENT_TURNS,
        ],
      );
      const orderedTurns = Array.isArray(recentMessageRows)
        ? [...recentMessageRows].reverse().map((msg) => ({
            role: msg.role,
            language: msg.language,
            content: truncateSafe(msg.content, MAX_TURN_EXCERPT_CHARS),
            safety_mode: Boolean(msg.safety_mode),
            learning_claim_recorded: Boolean(msg.learning_claim_recorded),
          }))
        : [];

      const preferredDailyHours =
        profile?.preferred_daily_hours !== null &&
        profile?.preferred_daily_hours !== undefined
          ? Number(profile.preferred_daily_hours)
          : null;

      const context: Record<string, unknown> = {
        conversation_scope: {
          context_type: conversation.context_type,
          title: conversation.title
            ? truncateSafe(conversation.title, 200)
            : null,
        },
        learner_profile: profile
          ? {
              current_role: profile.current_role_title
                ? truncateSafe(profile.current_role_title, 120)
                : null,
              education: profile.education
                ? truncateSafe(profile.education, 200)
                : null,
              experience_level: profile.experience_level ?? null,
              existing_skills_none: Boolean(profile.existing_skills_none),
              self_reported_skills: selfReportedSkills,
              preferred_daily_hours:
                preferredDailyHours !== null &&
                Number.isFinite(preferredDailyHours)
                  ? preferredDailyHours
                  : null,
              preferred_weekly_hours:
                preferredDailyHours !== null &&
                Number.isFinite(preferredDailyHours)
                  ? Number((preferredDailyHours * 7).toFixed(1))
                  : null,
              learning_preference: profile.learning_preference ?? null,
            }
          : null,
        focus_roadmap: activeRoadmap
          ? {
              roadmap_id: activeRoadmap.id,
              role_name: activeRoadmap.role_name,
              target_level: activeRoadmap.target_level,
              is_focus: Boolean(activeRoadmap.is_focus),
              version_no: activeRoadmap.version_no,
              active_topics: roadmapTopics,
            }
          : null,
        selected_topic: selectedTopic,
        skill_progress_summary: skillProgress,
        episodic_summary: latestSummary
          ? {
              version_no: latestSummary.version_no,
              summary_text: truncateSafe(
                latestSummary.summary_text,
                MAX_SUMMARY_CHARS,
              ),
            }
          : null,
        context_records: contextRecords,
        recent_turns: orderedTurns,
      };

      // Enforce strict <= 20,000-byte UTF-8 ceiling so ContextBuilderService (max_input_units = 8_000) never overflows.
      const byteLen = (obj: Record<string, unknown>): number =>
        Buffer.byteLength(JSON.stringify(obj), 'utf8');

      if (byteLen(context) > MAX_CONTEXT_JSON_BYTES) {
        context.context_records = [];
      }
      while (
        Array.isArray(context.recent_turns) &&
        context.recent_turns.length > 2 &&
        byteLen(context) > MAX_CONTEXT_JSON_BYTES
      ) {
        context.recent_turns = (context.recent_turns as unknown[]).slice(1);
      }
      while (
        Array.isArray(context.skill_progress_summary) &&
        context.skill_progress_summary.length > 0 &&
        byteLen(context) > MAX_CONTEXT_JSON_BYTES
      ) {
        context.skill_progress_summary = (
          context.skill_progress_summary as unknown[]
        ).slice(0, -1);
      }
      if (
        context.focus_roadmap &&
        typeof context.focus_roadmap === 'object' &&
        Array.isArray(
          (context.focus_roadmap as { active_topics?: unknown[] })
            .active_topics,
        )
      ) {
        const roadmapObj = context.focus_roadmap as {
          active_topics: unknown[];
        };
        while (
          roadmapObj.active_topics.length > 0 &&
          byteLen(context) > MAX_CONTEXT_JSON_BYTES
        ) {
          roadmapObj.active_topics = roadmapObj.active_topics.slice(0, -1);
        }
      }
      if (
        byteLen(context) > MAX_CONTEXT_JSON_BYTES &&
        context.selected_topic &&
        typeof context.selected_topic === 'object'
      ) {
        (
          context.selected_topic as { explanation_excerpt?: string | null }
        ).explanation_excerpt = null;
      }
      if (
        byteLen(context) > MAX_CONTEXT_JSON_BYTES &&
        context.episodic_summary &&
        typeof context.episodic_summary === 'object'
      ) {
        const summaryObj = context.episodic_summary as {
          summary_text?: string;
        };
        let current = summaryObj.summary_text ?? '';
        while (
          current.length > 128 &&
          byteLen(context) > MAX_CONTEXT_JSON_BYTES
        ) {
          current = truncateSafe(
            current,
            Math.max(64, Math.floor(Array.from(current).length / 2)),
          );
          summaryObj.summary_text = current;
        }
        if (byteLen(context) > MAX_CONTEXT_JSON_BYTES) {
          context.episodic_summary = null;
        }
      }
      while (
        Array.isArray(context.recent_turns) &&
        context.recent_turns.length > 0 &&
        byteLen(context) > MAX_CONTEXT_JSON_BYTES
      ) {
        context.recent_turns = (context.recent_turns as unknown[]).slice(1);
      }
      if (byteLen(context) > MAX_CONTEXT_JSON_BYTES) {
        context.selected_topic = null;
        context.focus_roadmap = null;
        context.learner_profile = null;
      }

      return { context };
    });
  }
}

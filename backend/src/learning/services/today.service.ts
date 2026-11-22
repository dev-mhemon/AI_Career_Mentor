import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import { JobProducerService } from '../../jobs/services/job-producer.service.js';
import type { CareerLevel } from '../../profile/profile.dto.js';
import { resolvePreferredLanguage } from '../../roadmap/services/roadmap.service.js';
import type {
  AttemptStatus,
  LearningState,
  TodayQuizSummaryDTO,
  TodayResponseDTO,
} from '../dto/learning.dto.js';
import { TopicContentService } from './topic-content.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_POLL_RETRY_SECONDS = 3;

interface FocusRoadmapRow {
  id: string;
  current_version_id: string | null;
}

interface DailyPlanRow {
  id: string;
  hours_per_day: number | string;
  roadmap_version_id: string | null;
}

interface NextIncompleteItemRow {
  id: string;
  day_no: number | string;
  sort_order: number | string;
  lineage_id: string;
  topic_id: string;
  skill_id: string;
  slug: string;
  title: string;
  career_level: CareerLevel;
  content_version: number | string;
  topic_status: 'draft' | 'approved' | 'hidden' | 'retired';
  required_depth: string | null;
  learning_state: LearningState | null;
}

interface QuizAttemptRow {
  id: string;
  attempt_no: number | string;
  status: AttemptStatus;
}

interface ActiveTopicJobRow {
  id: string;
  status: 'queued' | 'preparing';
}

export interface TodayRequestOptions {
  httpRequestId?: string;
  acceptLanguage?: string;
}

const EMPTY_QUIZ_SUMMARY: TodayQuizSummaryDTO = {
  attempt_id: null,
  status: null,
  can_retry: false,
};

function computeQuizSummary(attempt?: QuizAttemptRow): TodayQuizSummaryDTO {
  if (!attempt?.id) {
    return { ...EMPTY_QUIZ_SUMMARY };
  }
  const attemptNo = Number(attempt.attempt_no);
  const canRetry =
    attemptNo === 1 &&
    (attempt.status === 'submitted' ||
      attempt.status === 'ai_reviewed' ||
      attempt.status === 'feedback_available');
  return {
    attempt_id: String(attempt.id),
    status: attempt.status,
    can_retry: canRetry,
  };
}

/**
 * Service implementing `EP-L04` (`GET /api/v1/learning/today`, `C05` §14.6 / `PRD` §28).
 *
 * Guarantees:
 * - Always runs with `foreground = false` (`R24` read requests never bump `last_active_at`).
 * - Handles all 5 `today_status` states: `no_focus_roadmap`, `no_daily_plan`, `plan_completed`, `ready`, `preparing`.
 * - Resolves first incomplete sequential item (`ORDER BY day_no ASC, sort_order ASC`) — missed calendar days skip nothing.
 * - Serves existing approved canonical topic content even when `daily_plan` feature flag is OFF (`Gate: none`).
 * - Checks `effective_feature_access(userId, 'daily_plan')` before enqueuing missing/hidden `topic_content` generation
 *   (`403 FEATURE_DISABLED` when OFF).
 * - Tenant-safe job reuse: reuses only an active (`queued`/`preparing`) `topic_content` job owned by the same `user_id`
 *   so `EP-J01` polling never violates tenant isolation.
 */
@Injectable()
export class TodayService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(TopicContentService)
    private readonly topicContentService: TopicContentService,
    @Inject(JobProducerService)
    private readonly jobProducer: JobProducerService,
  ) {}

  async getToday(
    userId: string,
    options?: TodayRequestOptions,
  ): Promise<TodayResponseDTO> {
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId.trim())) {
      fail(401, 'AUTH_REQUIRED', 'Application account required');
    }
    const normalizedUserId = userId.trim().toLowerCase();

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const focusRows = await db.query<FocusRoadmapRow[]>(
          `SELECT id, current_version_id
             FROM public.roadmaps
            WHERE user_id = $1
              AND status = 'locked'::public.roadmap_status
              AND is_focus = true
            LIMIT 1`,
          [normalizedUserId],
        );
        const focus = Array.isArray(focusRows) ? focusRows[0] : undefined;
        if (!focus) {
          return {
            status: 'no_focus_roadmap',
            roadmap_id: null,
            plan_id: null,
            plan_day: null,
            topic: null,
            quiz: { ...EMPTY_QUIZ_SUMMARY },
            job: null,
            requires_learning_hours: false,
            preferred_daily_hours: null,
          };
        }

        const planRows = await db.query<DailyPlanRow[]>(
          `SELECT id, hours_per_day, roadmap_version_id
             FROM public.daily_plans
            WHERE user_id = $1
              AND roadmap_id = $2
            LIMIT 1`,
          [normalizedUserId, focus.id],
        );
        const plan = Array.isArray(planRows) ? planRows[0] : undefined;
        if (!plan) {
          const profileRows = await db.query<
            Array<{ preferred_daily_hours: number | string | null }>
          >(
            `SELECT preferred_daily_hours
               FROM public.user_profiles
              WHERE user_id = $1
              LIMIT 1`,
            [normalizedUserId],
          );
          const rawHours = Array.isArray(profileRows)
            ? profileRows[0]?.preferred_daily_hours
            : null;
          const parsedHours =
            rawHours === null || rawHours === undefined
              ? null
              : Number(rawHours);
          const hasHours =
            parsedHours !== null &&
            Number.isFinite(parsedHours) &&
            parsedHours > 0;

          return {
            status: 'no_daily_plan',
            roadmap_id: String(focus.id),
            plan_id: null,
            plan_day: null,
            topic: null,
            quiz: { ...EMPTY_QUIZ_SUMMARY },
            job: null,
            requires_learning_hours: !hasHours,
            preferred_daily_hours: hasHours ? parsedHours : null,
          };
        }

        const totalDaysRows = await db.query<
          Array<{ total_days: number | string }>
        >(
          `SELECT COUNT(DISTINCT day_no)::int AS total_days
             FROM public.daily_plan_items
            WHERE plan_id = $1
              AND user_id = $2`,
          [plan.id, normalizedUserId],
        );
        const totalDays = Array.isArray(totalDaysRows)
          ? Math.max(0, Number(totalDaysRows[0]?.total_days ?? 0))
          : 0;

        const versionId = plan.roadmap_version_id ?? focus.current_version_id;
        const nextItemRows = await db.query<NextIncompleteItemRow[]>(
          `SELECT dpi.id,
                  dpi.day_no,
                  dpi.sort_order,
                  dpi.lineage_id,
                  dpi.topic_id,
                  t.skill_id,
                  t.slug,
                  t.title,
                  t.career_level::text AS career_level,
                  t.content_version,
                  t.status::text AS topic_status,
                  ri.required_depth,
                  sp.learning_state::text AS learning_state
             FROM public.daily_plan_items dpi
             JOIN public.topics t ON t.id = dpi.topic_id
             LEFT JOIN public.roadmap_items ri
               ON ri.user_id = $1
              AND ri.version_id = $3
              AND ri.lineage_id = dpi.lineage_id
             LEFT JOIN public.skill_progress sp
               ON sp.user_id = $1
              AND sp.skill_id = t.skill_id
              AND sp.career_level = t.career_level
            WHERE dpi.plan_id = $2
              AND dpi.user_id = $1
              AND dpi.status <> 'completed'::public.plan_item_status
            ORDER BY dpi.day_no ASC, dpi.sort_order ASC
            LIMIT 1`,
          [normalizedUserId, plan.id, versionId],
        );
        const nextItem = Array.isArray(nextItemRows)
          ? nextItemRows[0]
          : undefined;
        if (!nextItem) {
          return {
            status: 'plan_completed',
            roadmap_id: String(focus.id),
            plan_id: String(plan.id),
            plan_day: null,
            topic: null,
            quiz: { ...EMPTY_QUIZ_SUMMARY },
            job: null,
            requires_learning_hours: false,
            preferred_daily_hours: Number(plan.hours_per_day),
          };
        }

        const attemptRows = await db.query<QuizAttemptRow[]>(
          `SELECT id, attempt_no, status::text AS status
             FROM public.quiz_attempts
            WHERE user_id = $1
              AND daily_plan_item_id = $2
            ORDER BY attempt_no DESC
            LIMIT 1`,
          [normalizedUserId, nextItem.id],
        );
        const quizSummary = computeQuizSummary(
          Array.isArray(attemptRows) ? attemptRows[0] : undefined,
        );

        const planDay = {
          day_no: Number(nextItem.day_no),
          total_days: totalDays,
        };

        const approvedTopic =
          await this.topicContentService.findApprovedCanonicalTopicInTx(
            db,
            nextItem.skill_id,
            nextItem.slug,
            nextItem.career_level,
          );

        if (approvedTopic) {
          const topicDetail =
            await this.topicContentService.buildTopicDetailInTx(
              db,
              normalizedUserId,
              approvedTopic,
              nextItem.learning_state ?? 'not_started',
              String(nextItem.required_depth ?? ''),
            );

          return {
            status: 'ready',
            roadmap_id: String(focus.id),
            plan_id: String(plan.id),
            plan_day: planDay,
            topic: topicDetail,
            quiz: quizSummary,
            job: null,
            requires_learning_hours: false,
          };
        }

        // Serialize concurrent GET /learning/today enqueues for the same (user, topic)
        await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `today-topic:${normalizedUserId}:${String(nextItem.topic_id)}`,
        ]);

        // Approved canonical content missing or auto-hidden: check tenant-owned active job first
        const activeJobRows = await db.query<ActiveTopicJobRow[]>(
          `SELECT id, status::text AS status
             FROM public.ai_requests
            WHERE user_id = $1
              AND is_async = true
              AND job_kind = 'topic_content'::public.job_kind
              AND subject_type = 'topic'
              AND subject_id = $2
              AND status IN ('queued'::public.job_status, 'preparing'::public.job_status)
            ORDER BY created_at DESC
            LIMIT 1`,
          [normalizedUserId, nextItem.topic_id],
        );

        // Recheck canonical approved topic after active-job lookup in case worker just committed
        const recheckedApprovedTopic =
          await this.topicContentService.findApprovedCanonicalTopicInTx(
            db,
            nextItem.skill_id,
            nextItem.slug,
            nextItem.career_level,
          );
        if (recheckedApprovedTopic) {
          const topicDetail =
            await this.topicContentService.buildTopicDetailInTx(
              db,
              normalizedUserId,
              recheckedApprovedTopic,
              nextItem.learning_state ?? 'not_started',
              String(nextItem.required_depth ?? ''),
            );

          return {
            status: 'ready',
            roadmap_id: String(focus.id),
            plan_id: String(plan.id),
            plan_day: planDay,
            topic: topicDetail,
            quiz: quizSummary,
            job: null,
            requires_learning_hours: false,
          };
        }

        const existingJob = Array.isArray(activeJobRows)
          ? activeJobRows[0]
          : undefined;
        if (existingJob?.id) {
          return {
            status: 'preparing',
            roadmap_id: String(focus.id),
            plan_id: String(plan.id),
            plan_day: planDay,
            topic: null,
            quiz: quizSummary,
            job: {
              job_id: String(existingJob.id),
              kind: 'topic_content',
              status: existingJob.status,
              poll_url: `/api/v1/jobs/${existingJob.id}`,
              retry_after_seconds: DEFAULT_POLL_RETRY_SECONDS,
            },
            requires_learning_hours: false,
          };
        }

        // Gate: generating missing shared content requires `daily_plan` ON (`C05` §14.6 EP-L04)
        const accessRows = await db.query<Array<{ allowed: boolean }>>(
          `SELECT private.effective_feature_access($1, 'daily_plan'::public.feature_key) AS allowed`,
          [normalizedUserId],
        );
        const featureAllowed = Array.isArray(accessRows)
          ? accessRows[0]?.allowed
          : false;
        if (featureAllowed !== true) {
          fail(
            403,
            'FEATURE_DISABLED',
            'Topic content generation is currently unavailable. Existing plans and topics remain accessible.',
          );
        }

        const contentVersion = Math.max(1, Number(nextItem.content_version));
        const language = resolvePreferredLanguage(options?.acceptLanguage);
        const acceptedJob = await this.jobProducer.enqueue(
          {
            userId: normalizedUserId,
            kind: 'topic_content',
            envelope: {
              v: 1,
              args: {
                topic_id: String(nextItem.topic_id),
                skill_id: String(nextItem.skill_id),
                career_level: nextItem.career_level,
                content_version: contentVersion,
              },
              expected_refs: {
                content_version: contentVersion,
              },
            },
            subjectType: 'topic',
            subjectId: String(nextItem.topic_id),
            httpRequestId: options?.httpRequestId,
            language,
          },
          db,
        );

        return {
          status: 'preparing',
          roadmap_id: String(focus.id),
          plan_id: String(plan.id),
          plan_day: planDay,
          topic: null,
          quiz: quizSummary,
          job: acceptedJob,
          requires_learning_hours: false,
        };
      },
      true,
      false,
    );
  }
}

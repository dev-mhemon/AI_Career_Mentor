BEGIN;
DROP TYPE IF EXISTS public.admin_role, public.feature_key, public.update_state, public.technology_source_type,
  public.relevance_level, public.action_timing, public.release_status, public.ai_validation_status,
  public.job_kind, public.job_status, public.ai_task, public.ai_context_type, public.conversation_context,
  public.ui_language, public.message_role, public.progress_event_type, public.evidence_source,
  public.learning_state, public.review_status, public.performance_level, public.attempt_status,
  public.question_difficulty, public.question_type, public.plan_item_status, public.plan_status,
  public.resource_type, public.merge_op, public.merge_origin, public.merge_status, public.skill_gap_type,
  public.item_priority, public.roadmap_version_origin, public.roadmap_version_state, public.roadmap_status,
  public.goal_status, public.alias_status, public.content_status, public.career_level,
  public.experience_level, public.auth_provider, public.user_status;
COMMIT;

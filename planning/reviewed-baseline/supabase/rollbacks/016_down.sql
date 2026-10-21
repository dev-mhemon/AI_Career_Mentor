BEGIN;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','user_auth_providers','user_profiles','user_preferences','career_roles','skill_categories','skills',
    'skill_aliases','career_goals','roadmaps','roadmap_versions','roadmap_merges','topics','learning_resources',
    'daily_plans','daily_plan_items','quizzes','quiz_questions','quiz_attempts','quiz_answers','practice_reviews',
    'skill_progress','conversations','ai_context_records','ai_models','ai_requests','technology_categories',
    'technologies','technology_sources','system_configurations','feature_controls','user_access_overrides']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_updated_at', t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_roadmaps_owner_check ON public.roadmaps;
DROP TRIGGER IF EXISTS trg_roadmap_versions_owner_check ON public.roadmap_versions;
DROP TRIGGER IF EXISTS trg_roadmap_items_owner_check ON public.roadmap_items;
DROP TRIGGER IF EXISTS trg_roadmap_merges_owner_check ON public.roadmap_merges;
DROP TRIGGER IF EXISTS trg_roadmap_merge_items_owner_check ON public.roadmap_merge_items;
DROP TRIGGER IF EXISTS trg_daily_plans_owner_check ON public.daily_plans;
DROP TRIGGER IF EXISTS trg_daily_plan_items_owner_check ON public.daily_plan_items;
DROP TRIGGER IF EXISTS trg_quiz_attempts_owner_check ON public.quiz_attempts;
DROP TRIGGER IF EXISTS trg_quiz_answers_owner_check ON public.quiz_answers;
DROP TRIGGER IF EXISTS trg_practice_reviews_owner_check ON public.practice_reviews;
DROP TRIGGER IF EXISTS trg_messages_owner_check ON public.messages;
DROP TRIGGER IF EXISTS trg_conversation_summaries_owner_check ON public.conversation_summaries;
DROP TRIGGER IF EXISTS trg_learning_evidence_owner_check ON public.learning_evidence;
DROP TRIGGER IF EXISTS trg_roadmaps_limit ON public.roadmaps;
DROP TRIGGER IF EXISTS trg_roadmaps_transition ON public.roadmaps;
DROP TRIGGER IF EXISTS trg_roadmap_versions_guard ON public.roadmap_versions;
DROP TRIGGER IF EXISTS trg_ai_requests_status ON public.ai_requests;
DROP TRIGGER IF EXISTS trg_skill_progress_guard ON public.skill_progress;
DROP TRIGGER IF EXISTS trg_user_profiles_validate_timezone ON public.user_profiles;
DROP TRIGGER IF EXISTS trg_quiz_attempts_close_undo ON public.quiz_attempts;
DROP TRIGGER IF EXISTS trg_messages_touch_conversation ON public.messages;
DROP TRIGGER IF EXISTS trg_roadmap_items_append_only ON public.roadmap_items;
DROP TRIGGER IF EXISTS trg_roadmap_merge_items_append_only ON public.roadmap_merge_items;
DROP TRIGGER IF EXISTS trg_learning_evidence_append_only ON public.learning_evidence;
DROP TRIGGER IF EXISTS trg_achievement_history_append_only ON public.achievement_history;
DROP TRIGGER IF EXISTS trg_admin_audit_logs_append_only ON public.admin_audit_logs;
DROP TRIGGER IF EXISTS trg_ai_requests_a_total ON public.ai_requests;
DROP TRIGGER IF EXISTS trg_ai_requests_b_cost ON public.ai_requests;
DROP TRIGGER IF EXISTS trg_ai_generations_a_total ON public.ai_generations;
DROP TRIGGER IF EXISTS trg_ai_generations_b_cost ON public.ai_generations;
COMMIT;

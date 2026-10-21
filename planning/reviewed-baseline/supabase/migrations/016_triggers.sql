BEGIN;
-- 016_triggers.sql

-- Family 1: updated_at (32 base tables)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','user_auth_providers','user_profiles','user_preferences','career_roles','skill_categories','skills',
    'skill_aliases','career_goals','roadmaps','roadmap_versions','roadmap_merges','topics','learning_resources',
    'daily_plans','daily_plan_items','quizzes','quiz_questions','quiz_attempts','quiz_answers','practice_reviews',
    'skill_progress','conversations','ai_context_records','ai_models','ai_requests','technology_categories',
    'technologies','technology_sources','system_configurations','feature_controls','user_access_overrides']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.update_updated_at_column()',
      'trg_' || t || '_updated_at', t);
  END LOOP;
END $$;

-- Family 2: ownership validation (13)
CREATE TRIGGER trg_roadmaps_owner_check BEFORE INSERT OR UPDATE OF user_id, career_goal_id ON public.roadmaps
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('career_goals', 'career_goal_id');
CREATE TRIGGER trg_roadmap_versions_owner_check BEFORE INSERT OR UPDATE OF user_id, roadmap_id ON public.roadmap_versions
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('roadmaps', 'roadmap_id');
CREATE TRIGGER trg_roadmap_items_owner_check BEFORE INSERT OR UPDATE OF user_id, version_id ON public.roadmap_items
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('roadmap_versions', 'version_id');
CREATE TRIGGER trg_roadmap_merges_owner_check BEFORE INSERT OR UPDATE OF user_id, roadmap_id ON public.roadmap_merges
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('roadmaps', 'roadmap_id');
CREATE TRIGGER trg_roadmap_merge_items_owner_check BEFORE INSERT OR UPDATE OF user_id, merge_id ON public.roadmap_merge_items
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('roadmap_merges', 'merge_id');
CREATE TRIGGER trg_daily_plans_owner_check BEFORE INSERT OR UPDATE OF user_id, roadmap_id ON public.daily_plans
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('roadmaps', 'roadmap_id');
CREATE TRIGGER trg_daily_plan_items_owner_check BEFORE INSERT OR UPDATE OF user_id, plan_id ON public.daily_plan_items
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('daily_plans', 'plan_id');
CREATE TRIGGER trg_quiz_attempts_owner_check BEFORE INSERT OR UPDATE OF user_id, daily_plan_item_id ON public.quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('daily_plan_items', 'daily_plan_item_id');
CREATE TRIGGER trg_quiz_answers_owner_check BEFORE INSERT OR UPDATE OF user_id, attempt_id ON public.quiz_answers
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('quiz_attempts', 'attempt_id');
CREATE TRIGGER trg_practice_reviews_owner_check BEFORE INSERT OR UPDATE OF user_id, attempt_id ON public.practice_reviews
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('quiz_attempts', 'attempt_id');
CREATE TRIGGER trg_messages_owner_check BEFORE INSERT OR UPDATE OF user_id, conversation_id ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('conversations', 'conversation_id');
CREATE TRIGGER trg_conversation_summaries_owner_check BEFORE INSERT OR UPDATE OF user_id, conversation_id ON public.conversation_summaries
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('conversations', 'conversation_id');
CREATE TRIGGER trg_learning_evidence_owner_check BEFORE INSERT OR UPDATE OF user_id, roadmap_id ON public.learning_evidence
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('roadmaps', 'roadmap_id');

-- Family 3: lifecycle protection (8)
CREATE TRIGGER trg_roadmaps_limit BEFORE INSERT ON public.roadmaps
  FOR EACH ROW EXECUTE FUNCTION private.enforce_active_roadmap_limit();
CREATE TRIGGER trg_roadmaps_transition BEFORE UPDATE OF status ON public.roadmaps
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.validate_roadmap_transition();
CREATE TRIGGER trg_roadmap_versions_guard BEFORE UPDATE ON public.roadmap_versions
  FOR EACH ROW EXECUTE FUNCTION private.guard_roadmap_version_immutability();
CREATE TRIGGER trg_ai_requests_status BEFORE UPDATE OF status ON public.ai_requests
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.validate_ai_request_status();
CREATE TRIGGER trg_skill_progress_guard BEFORE UPDATE OF learning_state ON public.skill_progress
  FOR EACH ROW EXECUTE FUNCTION private.validate_skill_progress_change();
CREATE TRIGGER trg_user_profiles_validate_timezone BEFORE INSERT OR UPDATE OF timezone ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION private.validate_profile_timezone();
CREATE TRIGGER trg_quiz_attempts_close_undo AFTER INSERT OR UPDATE OF status ON public.quiz_attempts
  FOR EACH ROW WHEN (NEW.status = 'started')
  EXECUTE FUNCTION private.close_merge_undo_window();
CREATE TRIGGER trg_messages_touch_conversation AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.touch_conversation();

-- Family 4: audit and append-only protection (5)
CREATE TRIGGER trg_roadmap_items_append_only BEFORE UPDATE OR DELETE ON public.roadmap_items
  FOR EACH ROW EXECUTE FUNCTION private.prevent_row_modification();
CREATE TRIGGER trg_roadmap_merge_items_append_only BEFORE UPDATE OR DELETE ON public.roadmap_merge_items
  FOR EACH ROW EXECUTE FUNCTION private.prevent_row_modification();
CREATE TRIGGER trg_learning_evidence_append_only BEFORE UPDATE OR DELETE ON public.learning_evidence
  FOR EACH ROW EXECUTE FUNCTION private.prevent_row_modification();
CREATE TRIGGER trg_achievement_history_append_only BEFORE UPDATE OR DELETE ON public.achievement_history
  FOR EACH ROW EXECUTE FUNCTION private.prevent_achievement_modification();
CREATE TRIGGER trg_admin_audit_logs_append_only BEFORE UPDATE OR DELETE ON public.admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION private.prevent_audit_log_changes();

-- Family 5: AI calculations (4)
CREATE TRIGGER trg_ai_requests_a_total BEFORE INSERT OR UPDATE OF input_units, output_units ON public.ai_requests
  FOR EACH ROW EXECUTE FUNCTION private.calculate_total_tokens();
CREATE TRIGGER trg_ai_requests_b_cost BEFORE INSERT OR UPDATE OF input_units, output_units, model_id ON public.ai_requests
  FOR EACH ROW EXECUTE FUNCTION private.calculate_ai_cost();
CREATE TRIGGER trg_ai_generations_a_total BEFORE INSERT OR UPDATE OF input_units, output_units ON public.ai_generations
  FOR EACH ROW EXECUTE FUNCTION private.calculate_total_tokens();
CREATE TRIGGER trg_ai_generations_b_cost BEFORE INSERT OR UPDATE OF input_units, output_units, model_id ON public.ai_generations
  FOR EACH ROW EXECUTE FUNCTION private.calculate_ai_cost();
COMMIT;

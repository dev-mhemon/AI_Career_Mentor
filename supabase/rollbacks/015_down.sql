BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cleanup-expired-ai-context');
    PERFORM cron.unschedule('cleanup-expired-retention');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DROP FUNCTION IF EXISTS private.admin_usage_summary(date, date);
DROP FUNCTION IF EXISTS private.effective_feature_access(uuid, public.feature_key);
DROP FUNCTION IF EXISTS private.is_admin();
DROP FUNCTION IF EXISTS private.touch_conversation();
DROP FUNCTION IF EXISTS private.close_merge_undo_window();
DROP FUNCTION IF EXISTS private.validate_profile_timezone();
DROP FUNCTION IF EXISTS private.validate_skill_progress_change();
DROP FUNCTION IF EXISTS private.prevent_audit_log_changes();
DROP FUNCTION IF EXISTS private.prevent_achievement_modification();
DROP FUNCTION IF EXISTS private.prevent_row_modification();
DROP FUNCTION IF EXISTS private.cleanup_expired_retention();
DROP FUNCTION IF EXISTS private.cleanup_expired_ai_context();
DROP FUNCTION IF EXISTS private.calculate_ai_cost();
DROP FUNCTION IF EXISTS private.calculate_total_tokens();
DROP FUNCTION IF EXISTS private.validate_ai_request_status();
DROP FUNCTION IF EXISTS private.guard_roadmap_version_immutability();
DROP FUNCTION IF EXISTS private.enforce_active_roadmap_limit();
DROP FUNCTION IF EXISTS private.validate_roadmap_transition();
DROP FUNCTION IF EXISTS private.validate_user_ownership();
DROP FUNCTION IF EXISTS private.update_updated_at_column();
COMMIT;

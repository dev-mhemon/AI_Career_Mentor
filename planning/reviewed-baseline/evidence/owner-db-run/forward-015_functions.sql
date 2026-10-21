BEGIN;
-- 015_functions.sql

-- 1. updated_at maintenance
CREATE OR REPLACE FUNCTION private.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- 2. ownership consistency
CREATE OR REPLACE FUNCTION private.validate_user_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_parent_table text := TG_ARGV[0];
  v_fk_column    text := TG_ARGV[1];
  v_fk_value     uuid;
  v_parent_owner uuid;
BEGIN
  v_fk_value := (to_jsonb(NEW) ->> v_fk_column)::uuid;
  IF v_fk_value IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT user_id FROM public.%I WHERE id = $1', v_parent_table)
    INTO v_parent_owner USING v_fk_value;
  IF v_parent_owner IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'OWNERSHIP_MISMATCH: %.% references a row owned by another user', TG_TABLE_NAME, v_fk_column
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- 3. roadmap lifecycle
CREATE OR REPLACE FUNCTION private.validate_roadmap_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status = 'draft'  AND NEW.status IN ('locked','archived'))
       OR (OLD.status = 'locked' AND NEW.status = 'archived')) THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: roadmap % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'locked' THEN
    NEW.locked_at := COALESCE(NEW.locked_at, now());
  ELSE
    NEW.archived_at := COALESCE(NEW.archived_at, now());
    NEW.is_focus := false;
  END IF;
  RETURN NEW;
END $$;

-- 4. active roadmap limit (<= 3)
CREATE OR REPLACE FUNCTION private.enforce_active_roadmap_limit()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_limit integer;
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));
  v_limit := 3; -- Frozen PRD §16; configuration cannot raise the ceiling.
  SELECT count(*) INTO v_count
  FROM public.roadmaps WHERE user_id = NEW.user_id AND status <> 'archived';
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'ROADMAP_LIMIT_REACHED: user already has % active roadmaps', v_count
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- 5. roadmap version immutability
CREATE OR REPLACE FUNCTION private.guard_roadmap_version_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_mutable text[] := ARRAY['state','locked_at','superseded_at','stale','stale_reason','updated_at'];
BEGIN
  IF (to_jsonb(NEW) - v_mutable) IS DISTINCT FROM (to_jsonb(OLD) - v_mutable) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW: roadmap_versions content cannot change (version %)', OLD.version_no
      USING ERRCODE = '55000';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'draft'      AND NEW.state IN ('locked','superseded'))
    OR (OLD.state = 'locked'     AND NEW.state = 'superseded')
    OR (OLD.state = 'restored'   AND NEW.state = 'superseded')
    OR (OLD.state = 'superseded' AND NEW.state = 'restored')) THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: roadmap version % -> %', OLD.state, NEW.state
      USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'locked' AND OLD.state = 'draft' THEN
    NEW.locked_at := COALESCE(NEW.locked_at, now());
  ELSIF NEW.state = 'superseded' AND OLD.state <> 'superseded' THEN
    NEW.superseded_at := COALESCE(NEW.superseded_at, now());
  END IF;
  RETURN NEW;
END $$;

-- 6. AI job state machine
CREATE OR REPLACE FUNCTION private.validate_ai_request_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status = 'queued'    AND NEW.status IN ('preparing','failed'))
       OR (OLD.status = 'preparing' AND NEW.status IN ('succeeded','failed'))
       OR (OLD.status = 'failed'    AND NEW.status = 'queued' AND OLD.retryable)) THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: ai_request % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'preparing' THEN
    NEW.started_at    := COALESCE(NEW.started_at, now());
    NEW.locked_at     := COALESCE(NEW.locked_at, now());
    NEW.attempt_count := OLD.attempt_count + 1;
  ELSIF NEW.status IN ('succeeded','failed') THEN
    NEW.finished_at := COALESCE(NEW.finished_at, now());
    NEW.locked_at   := NULL;
    NEW.locked_by   := NULL;
  ELSE
    NEW.finished_at   := NULL;
    NEW.error_code    := NULL;
    NEW.error_message := NULL;
    NEW.locked_at     := NULL;
    NEW.locked_by     := NULL;
    NEW.available_at  := GREATEST(NEW.available_at, now());
  END IF;
  RETURN NEW;
END $$;

-- 7. total usage units
CREATE OR REPLACE FUNCTION private.calculate_total_tokens()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.total_units := COALESCE(NEW.input_units, 0) + COALESCE(NEW.output_units, 0);
  RETURN NEW;
END $$;

-- 8. AI cost calculation
CREATE OR REPLACE FUNCTION private.calculate_ai_cost()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_cost numeric;
BEGIN
  IF NEW.model_id IS NOT NULL THEN
    SELECT round((COALESCE(NEW.input_units,0)  * m.input_price_per_m_units
                + COALESCE(NEW.output_units,0) * m.output_price_per_m_units) / 1000000.0, 8)
      INTO v_cost
    FROM public.ai_models m WHERE m.id = NEW.model_id;
    IF FOUND THEN
      NEW.cost_usd := v_cost;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 9. expired AI memory cleanup
CREATE OR REPLACE FUNCTION private.cleanup_expired_ai_context()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH d AS (DELETE FROM public.ai_context_records WHERE valid_until < now() RETURNING 1)
  SELECT count(*) INTO v_deleted FROM d;
  RETURN v_deleted;
END $$;

-- 10. PRD §52 retention cleanup
CREATE OR REPLACE FUNCTION private.cleanup_expired_retention()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ai_days   integer := LEAST(30, GREATEST(1, COALESCE((SELECT (config_value #>> '{}')::integer
    FROM public.system_configurations WHERE config_key = 'retention.ai_operational_log_days'), 30)));
  v_raw_days integer := LEAST(90, GREATEST(1, COALESCE((SELECT (config_value #>> '{}')::integer
    FROM public.system_configurations WHERE config_key='retention.raw_response_days'),90)));
  v_message_days integer := LEAST(90, GREATEST(1, COALESCE((SELECT (config_value #>> '{}')::integer
    FROM public.system_configurations WHERE config_key='retention.mentor_message_days'),90)));
  v_answers   integer;
  v_messages  integer;
  v_requests  integer;
BEGIN
  WITH u AS (
    UPDATE public.quiz_answers
       SET answer_text = NULL, raw_text_purged_at = now()
     WHERE answer_text IS NOT NULL AND (raw_text_expires_at <= now()
       OR created_at <= now() - make_interval(days => v_raw_days))
    RETURNING 1)
  SELECT count(*) INTO v_answers FROM u;

  WITH d AS (
    DELETE FROM public.messages
     WHERE expires_at <= now() OR created_at <= now() - make_interval(days => v_message_days)
    RETURNING 1)
  SELECT count(*) INTO v_messages FROM d;

  WITH d AS (
    DELETE FROM public.ai_requests
     WHERE created_at <= now() - make_interval(days => v_ai_days)
    RETURNING 1)
  SELECT count(*) INTO v_requests FROM d;

  -- 015 precedes table020; dynamic SQL resolves this table at execution.
  IF to_regclass('public.account_deletion_requests') IS NOT NULL THEN
    EXECUTE 'UPDATE public.account_deletion_requests
      SET provider_cleanup = ''[]''::jsonb, provider_cleanup_expires_at = NULL
      WHERE provider_cleanup_expires_at <= now()';
  END IF;

  RETURN jsonb_build_object('raw_answers_purged', v_answers,
                            'messages_deleted',   v_messages,
                            'ai_requests_deleted', v_requests);
END $$;

-- 11. generic append-only guard
CREATE OR REPLACE FUNCTION private.prevent_row_modification()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW: % is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_ROW: % rows cannot be deleted directly', TG_TABLE_NAME USING ERRCODE = '55000';
END $$;

-- 12. progress history immutability
CREATE OR REPLACE FUNCTION private.prevent_achievement_modification()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW: achievement_history is append-only' USING ERRCODE = '55000';
  END IF;
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_ROW: achievement_history rows cannot be deleted directly' USING ERRCODE = '55000';
END $$;

-- 13. audit log immutability
CREATE OR REPLACE FUNCTION private.prevent_audit_log_changes()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND pg_trigger_depth() > 1
     AND (to_jsonb(NEW) - 'actor_id' - 'target_user_id') = (to_jsonb(OLD) - 'actor_id' - 'target_user_id')
     AND (NEW.actor_id IS NULL OR NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id)
     AND (NEW.target_user_id IS NULL OR NEW.target_user_id IS NOT DISTINCT FROM OLD.target_user_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_ROW: admin_audit_logs is append-only' USING ERRCODE = '55000';
END $$;

-- 14. learning state change reason check
CREATE OR REPLACE FUNCTION private.validate_skill_progress_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.learning_state IS DISTINCT FROM OLD.learning_state THEN
    IF NEW.state_reason IS NULL OR length(btrim(NEW.state_reason)) = 0
       OR NEW.state_reason IS NOT DISTINCT FROM OLD.state_reason THEN
      RAISE EXCEPTION 'STATE_REASON_REQUIRED: a learning state change needs a new reason'
        USING ERRCODE = '23514';
    END IF;
    NEW.state_changed_at := now();
  END IF;
  RETURN NEW;
END $$;

-- 15. IANA timezone validation
CREATE OR REPLACE FUNCTION private.validate_profile_timezone()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.timezone IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'INVALID_TIMEZONE: %', NEW.timezone USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

-- 16. merge undo window auto-close
CREATE OR REPLACE FUNCTION private.close_merge_undo_window()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.roadmap_merges rm
     SET undo_window_closed_at = now()
    FROM public.daily_plan_items dpi
   WHERE dpi.id = NEW.daily_plan_item_id
     AND dpi.reconciled_by_merge_id IS NOT NULL
     AND rm.id = dpi.reconciled_by_merge_id
     AND rm.undo_window_closed_at IS NULL;
  RETURN NEW;
END $$;

-- 17. conversation timestamp update
CREATE OR REPLACE FUNCTION private.touch_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END $$;

-- 18. server-side admin check
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users au
    JOIN public.users u ON u.id = au.user_id
    WHERE au.user_id = (SELECT auth.uid()) AND u.status = 'active');
$$;

-- 19. effective feature access
CREATE OR REPLACE FUNCTION private.effective_feature_access(p_user_id uuid, p_feature public.feature_key)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((
    SELECT u.status = 'active'
       AND fc.enabled
       AND COALESCE(uao.enabled, fc.default_user_enabled)
    FROM public.users u
    JOIN public.feature_controls fc ON fc.feature_key = p_feature
    LEFT JOIN public.user_access_overrides uao ON uao.user_id = u.id AND uao.feature_key = p_feature
    WHERE u.id = p_user_id), false);
$$;

-- 20. aggregate usage counts for admin
CREATE OR REPLACE FUNCTION private.admin_usage_summary(p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'users', jsonb_build_object(
      'total', (SELECT count(*) FROM public.users),
      'active_last_7_days', (SELECT count(*) FROM public.users WHERE last_active_at >= now() - interval '7 days')),
    'counts', jsonb_build_object(
      'roadmaps_locked', (SELECT count(*) FROM public.roadmaps
                           WHERE locked_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND locked_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'quizzes_submitted', (SELECT count(*) FROM public.quiz_attempts
                             WHERE submitted_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND submitted_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'mentor_messages', (SELECT count(*) FROM public.messages
                           WHERE created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'technology_updates_generated', (SELECT count(*) FROM public.technology_updates
                                        WHERE created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC'))),
    'ai', jsonb_build_object(
      'requests',       (SELECT count(*) FROM public.ai_requests WHERE created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'failures',       (SELECT count(*) FROM public.ai_requests WHERE status = 'failed'
                           AND created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'fallbacks_used', (SELECT count(*) FROM public.ai_requests WHERE fallback_used
                           AND created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'usage_units', (SELECT jsonb_build_object('input', COALESCE(sum(input_units),0), 'output', COALESCE(sum(output_units),0))
                        FROM public.ai_requests WHERE created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'estimated_cost_usd', (SELECT COALESCE(sum(cost_usd),0) FROM public.ai_requests
                               WHERE created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'by_day', (SELECT COALESCE(jsonb_agg(x ORDER BY x.day),'[]'::jsonb) FROM (
 SELECT d.day::date AS day, count(r.id) AS requests,
        count(r.id) FILTER (WHERE r.status='failed') AS failures,
        count(r.id) FILTER (WHERE r.fallback_used) AS fallbacks_used,
        COALESCE(sum(r.input_units),0) AS input_units,
        COALESCE(sum(r.output_units),0) AS output_units,
        COALESCE(sum(r.cost_usd),0) AS estimated_cost_usd
 FROM generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d(day)
 LEFT JOIN public.ai_requests r
   ON r.created_at >= (d.day AT TIME ZONE 'UTC')
  AND r.created_at < ((d.day + interval '1 day') AT TIME ZONE 'UTC')
 GROUP BY d.day) x),
      'by_feature', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
                       SELECT feature_key, count(*) AS requests, COALESCE(sum(cost_usd),0) AS estimated_cost_usd
                         FROM public.ai_requests
                        WHERE feature_key IS NOT NULL AND created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')
                        GROUP BY feature_key) x),
      'by_provider', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
                       SELECT provider_key AS provider_id, count(*) AS requests, COALESCE(sum(cost_usd),0) AS estimated_cost_usd
                         FROM public.ai_requests
                        WHERE provider_key IS NOT NULL AND created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')
                        GROUP BY provider_key) x)));
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.effective_feature_access(uuid, public.feature_key) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('cleanup-expired-ai-context', '17 * * * *',  'SELECT private.cleanup_expired_ai_context()');
    PERFORM cron.schedule('cleanup-expired-retention',  '37 2 * * *', 'SELECT private.cleanup_expired_retention()');
  END IF;
END $$;

COMMIT;

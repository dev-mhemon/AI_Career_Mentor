-- scripts/db/perf/explain_checks.sql
CREATE SCHEMA IF NOT EXISTS perf;
CREATE OR REPLACE FUNCTION perf.assert_plan(p_name text, p_sql text, p_max_ms numeric, p_index_like text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_plan jsonb;
  v_ms   numeric;
BEGIN
  EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON) ' || p_sql INTO v_plan;
  v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
  RAISE NOTICE 'PERF_PLAN_JSON %', jsonb_build_object('name',p_name,'plan',v_plan);
  IF v_ms > p_max_ms THEN
    RAISE EXCEPTION 'PERF FAIL %: % ms > % ms', p_name, v_ms, p_max_ms;
  END IF;
  IF p_index_like IS NOT NULL AND position(p_index_like IN v_plan::text) = 0 THEN
    RAISE EXCEPTION 'PERF FAIL %: plan does not use index %', p_name, p_index_like;
  END IF;
  RAISE NOTICE 'PERF OK %: % ms', p_name, v_ms;
END $$;

DO $$
DECLARE
  v_user uuid := (SELECT id FROM public.users WHERE email = 'perf1@test.local');
  v_plan uuid := (SELECT id FROM public.daily_plans WHERE user_id = v_user LIMIT 1);
  v_conv uuid := (SELECT id FROM public.conversations WHERE user_id = v_user LIMIT 1);
  v_ver  uuid := (SELECT current_version_id FROM public.roadmaps WHERE user_id = v_user AND is_focus);
BEGIN
  -- roadmap queries
  PERFORM perf.assert_plan('active roadmaps',
    format('SELECT * FROM public.roadmaps WHERE user_id = %L AND status <> %L', v_user, 'archived'), 5, 'idx_roadmaps_user_status');
  PERFORM perf.assert_plan('roadmap items of current version',
    format('SELECT * FROM public.roadmap_items WHERE version_id = %L ORDER BY sequence_no', v_ver), 5, 'uq_roadmap_items_');
  -- learning workflow: Today = next incomplete plan item
  PERFORM perf.assert_plan('today next incomplete day',
    format('SELECT * FROM public.daily_plan_items WHERE plan_id = %L AND status <> %L ORDER BY day_no, sort_order LIMIT 5', v_plan, 'completed'),
    5, 'idx_daily_plan_items_open');
  -- progress tracking
  PERFORM perf.assert_plan('progress by state',
    format('SELECT * FROM public.skill_progress WHERE user_id = %L AND learning_state = %L', v_user, 'practicing'), 10, 'idx_skill_progress_user_state');
  -- message retrieval (keyset page of 20)
  PERFORM perf.assert_plan('message history page',
    format('SELECT * FROM public.messages WHERE conversation_id = %L ORDER BY created_at DESC, id DESC LIMIT 20', v_conv),
    10, 'idx_messages_conversation_created');
  -- AI operations
  PERFORM perf.assert_plan('job polling',
    format('SELECT * FROM public.ai_requests WHERE user_id = %L AND is_async AND status = %L', v_user, 'queued'), 5, 'idx_ai_requests_');
  PERFORM perf.assert_plan('worker queue claim',
    'SELECT id FROM public.ai_requests WHERE is_async AND status = ''queued'' AND available_at <= now() ORDER BY available_at, id LIMIT 10 FOR UPDATE SKIP LOCKED',
    5, 'idx_ai_requests_queue');
  -- AI analytics / admin reporting
  PERFORM perf.assert_plan('usage by feature (30 days)',
    'SELECT feature_key, count(*), sum(cost_usd) FROM public.ai_requests WHERE created_at >= now() - interval ''30 days'' GROUP BY feature_key',
    300, NULL);
  PERFORM perf.assert_plan('admin usage summary',
    'SELECT private.admin_usage_summary(current_date - 30, current_date)', 1000, NULL);
END $$;

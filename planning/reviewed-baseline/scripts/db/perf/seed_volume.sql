-- scripts/db/perf/seed_volume.sql
-- DISPOSABLE PERFORMANCE DATABASE ONLY. Synthetic volume, not functional fixtures.
-- No application workers may dispatch these synthetic queued rows.
BEGIN;
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE perf_users AS
  SELECT g AS n, gen_random_uuid() AS id FROM generate_series(1, 100) g;
INSERT INTO auth.users (id, email) SELECT id, 'perf' || n || '@test.local' FROM perf_users;
INSERT INTO public.users (id, email, last_active_at) SELECT id, 'perf' || n || '@test.local', now() FROM perf_users;

INSERT INTO public.skills (id, slug, canonical_name)
  SELECT gen_random_uuid(), 'perf-skill-' || g, 'Perf Skill ' || g FROM generate_series(1, 50) g;
INSERT INTO public.topics (id, skill_id, slug, title, career_level, status, explanation_markdown, approved_at)
  SELECT gen_random_uuid(), s.id, 'perf-topic-' || row_number() OVER (), 'Topic', 'mid', 'approved', 'x', now()
  FROM public.skills s WHERE s.slug LIKE 'perf-skill-%';

CREATE TEMP TABLE perf_rm AS
  SELECT u.id AS user_id, gen_random_uuid() AS goal_id, gen_random_uuid() AS roadmap_id, gen_random_uuid() AS version_id, k
  FROM perf_users u CROSS JOIN generate_series(1, 3) k;
INSERT INTO public.career_goals (id, user_id, goal_text, status, confirmed_role_id, target_level, confirmed_at)
  SELECT goal_id, user_id, 'Perf goal ' || k, 'confirmed', (SELECT id FROM public.career_roles LIMIT 1), 'mid', now() FROM perf_rm;
INSERT INTO public.roadmaps (id, user_id, career_goal_id, canonical_role_id, target_level, status, is_focus, current_version_id, locked_at)
  SELECT roadmap_id, user_id, goal_id, (SELECT id FROM public.career_roles LIMIT 1), 'mid', 'locked', (k = 1), version_id, now() FROM perf_rm;
INSERT INTO public.roadmap_versions (id, roadmap_id, user_id, version_no, state, created_by, target_level, locked_at)
  SELECT version_id, roadmap_id, user_id, 1, 'locked', 'ai', 'mid', now() FROM perf_rm;
INSERT INTO public.roadmap_items (version_id, user_id, topic_id, skill_id, title, priority, gap_type, sequence_no)
  SELECT r.version_id, r.user_id, t.id, t.skill_id, 'Item', 'core', 'missing', t.rn
  FROM perf_rm r CROSS JOIN LATERAL (SELECT id, skill_id, row_number() OVER () AS rn FROM public.topics WHERE slug LIKE 'perf-topic-%' LIMIT 40) t;

INSERT INTO public.daily_plans (id, user_id, roadmap_id, hours_per_day, roadmap_version_id)
  SELECT gen_random_uuid(), user_id, roadmap_id, 2, version_id FROM perf_rm;
INSERT INTO public.daily_plan_items (plan_id, user_id, day_no, sort_order, lineage_id, topic_id, status, completed_at)
  SELECT p.id, p.user_id, d, 1, gen_random_uuid(), (SELECT id FROM public.topics WHERE slug LIKE 'perf-topic-%' LIMIT 1),
         CASE WHEN d <= 100 THEN 'completed'::public.plan_item_status ELSE 'pending' END,
         CASE WHEN d <= 100 THEN now() END
  FROM public.daily_plans p CROSS JOIN generate_series(1, 200) d;

INSERT INTO public.conversations (id, user_id) SELECT gen_random_uuid(), id FROM perf_users;
INSERT INTO public.messages (conversation_id, user_id, role, content, created_at)
  SELECT c.id, c.user_id, CASE WHEN g % 2 = 0 THEN 'user'::public.message_role ELSE 'assistant' END,
         'perf message ' || g, now() - (g || ' minutes')::interval
  FROM public.conversations c CROSS JOIN generate_series(1, 2100) g;

INSERT INTO public.ai_requests
  (user_id,task,feature_key,is_async,job_kind,status,finished_at,provider_key,
   input_units,output_units,total_units,cost_usd,created_at)
  SELECT u.id,
    CASE WHEN g<=10 THEN 'roadmap_generate'::public.ai_task ELSE 'mentor_chat'::public.ai_task END,
    CASE WHEN g<=10 THEN 'roadmap_generator'::public.feature_key ELSE 'ai_mentor'::public.feature_key END,
    g<=10,
    CASE WHEN g<=10 THEN 'roadmap_generate'::public.job_kind ELSE NULL END,
    CASE WHEN g<=10 THEN 'queued'::public.job_status ELSE 'succeeded'::public.job_status END,
    CASE WHEN g<=10 THEN NULL ELSE now() END,
    'dev-provider',1000,500,1500,0.001,now()-(g || ' minutes')::interval
  FROM perf_users u CROSS JOIN generate_series(1,1000) g;

INSERT INTO public.skill_progress (user_id, skill_id, career_level, learning_state, state_reason)
  SELECT u.id, s.id, 'mid', 'practicing', 'perf' FROM perf_users u CROSS JOIN public.skills s WHERE s.slug LIKE 'perf-skill-%';

COMMIT;
-- Fixture postconditions execute before accepting a performance run.
DO $$ BEGIN
 IF (SELECT count(*) FROM public.users WHERE email LIKE 'perf%@test.local')<>100
 OR (SELECT count(*) FROM public.roadmaps WHERE user_id IN (SELECT id FROM perf_users))<>300
 OR (SELECT count(*) FROM public.roadmap_items WHERE user_id IN (SELECT id FROM perf_users))<>12000
 OR (SELECT count(*) FROM public.daily_plan_items WHERE user_id IN (SELECT id FROM perf_users))<>60000
 OR (SELECT count(*) FROM public.messages WHERE user_id IN (SELECT id FROM perf_users))<>210000
 OR (SELECT count(*) FROM public.ai_requests WHERE user_id IN (SELECT id FROM perf_users))<>100000
 OR (SELECT count(*) FROM public.skill_progress WHERE user_id IN (SELECT id FROM perf_users))<>5000
 OR NOT EXISTS(SELECT 1 FROM public.ai_requests WHERE is_async AND status='queued')
 THEN RAISE EXCEPTION 'Performance fixture volume postcondition failed'; END IF;
END $$;
ANALYZE;

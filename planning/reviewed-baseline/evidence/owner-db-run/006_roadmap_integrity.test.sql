-- supabase/tests/database/006_roadmap_integrity.test.sql
BEGIN;
SELECT plan(6);

CREATE FUNCTION pg_temp.mk_user(p uuid, e text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (p, e);
  INSERT INTO public.users (id, email) VALUES (p, e);
$$;
SELECT pg_temp.mk_user('ffffffff-0000-0000-0000-000000000001', 'roadmap_tester@test.local');

CREATE FUNCTION pg_temp.create_roadmap(p_goal uuid, p_rm uuid, p_title text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.career_goals (id, user_id, goal_text, status, confirmed_role_id, target_level, confirmed_at)
    VALUES (p_goal, 'ffffffff-0000-0000-0000-000000000001', p_title, 'confirmed', (SELECT id FROM public.career_roles LIMIT 1), 'mid', now());
  INSERT INTO public.roadmaps (id, user_id, career_goal_id, canonical_role_id, target_level, status)
    VALUES (p_rm, 'ffffffff-0000-0000-0000-000000000001', p_goal, (SELECT id FROM public.career_roles LIMIT 1), 'mid', 'draft');
$$;

SELECT pg_temp.create_roadmap(gen_random_uuid(), gen_random_uuid(), 'Goal 1');
SELECT pg_temp.create_roadmap(gen_random_uuid(), gen_random_uuid(), 'Goal 2');
SELECT pg_temp.create_roadmap(gen_random_uuid(), gen_random_uuid(), 'Goal 3');

SELECT throws_ok(
  $$SELECT pg_temp.create_roadmap(gen_random_uuid(), gen_random_uuid(), 'Goal 4')$$,
  '23514', NULL, '4th active roadmap is rejected by enforce_active_roadmap_limit trigger');

UPDATE public.roadmaps SET status = 'archived' WHERE id = (SELECT id FROM public.roadmaps LIMIT 1);
SELECT lives_ok(
  $$SELECT pg_temp.create_roadmap(gen_random_uuid(), gen_random_uuid(), 'Goal 4 after archive')$$,
  'Creating a 3rd active roadmap after archiving one succeeds');

CREATE TEMP TABLE active_rms AS
  SELECT id FROM public.roadmaps WHERE status = 'draft' LIMIT 2;

SET CONSTRAINTS fk_roadmaps_current_version DEFERRED;
UPDATE public.roadmaps SET status = 'locked', current_version_id = gen_random_uuid() WHERE id IN (SELECT id FROM active_rms);
INSERT INTO public.roadmap_versions (id, roadmap_id, user_id, version_no, state, created_by, target_level, locked_at)
SELECT current_version_id, id, 'ffffffff-0000-0000-0000-000000000001', 1, 'locked', 'ai', 'mid', now()
FROM public.roadmaps WHERE id IN (SELECT id FROM active_rms);

UPDATE public.roadmaps SET is_focus = true WHERE id = (SELECT id FROM active_rms LIMIT 1);

SELECT throws_ok(
  $$UPDATE public.roadmaps SET is_focus = true WHERE id = (SELECT id FROM active_rms OFFSET 1 LIMIT 1)$$,
  '23505', NULL, 'Setting second focus roadmap violates unique partial index uq_roadmaps_one_focus');

CREATE TEMP TABLE test_focus_rm AS SELECT id FROM active_rms LIMIT 1;
INSERT INTO public.roadmap_merges (id, roadmap_id, user_id, origin, status, base_version_id)
  VALUES ('ffffffff-0000-0000-0000-0000000000a1', (SELECT id FROM test_focus_rm),
          'ffffffff-0000-0000-0000-000000000001', 'user_request', 'proposed',
          (SELECT current_version_id FROM public.roadmaps WHERE id = (SELECT id FROM test_focus_rm)));

SELECT throws_ok(
  $$INSERT INTO public.roadmap_merges (roadmap_id, user_id, origin, status, base_version_id)
    VALUES ((SELECT id FROM test_focus_rm), 'ffffffff-0000-0000-0000-000000000001', 'user_request', 'proposed',
            (SELECT current_version_id FROM public.roadmaps WHERE id = (SELECT id FROM test_focus_rm)))$$,
  '23505', NULL, 'At most one open proposed merge per roadmap (uq_roadmap_merges_one_open)');

UPDATE public.roadmap_merges SET status = 'accepted', accepted_at = now() WHERE id = 'ffffffff-0000-0000-0000-0000000000a1';

INSERT INTO public.daily_plans (id, user_id, roadmap_id, hours_per_day)
  VALUES ('ffffffff-0000-0000-0000-0000000000b1', 'ffffffff-0000-0000-0000-000000000001', (SELECT id FROM test_focus_rm), 2);

INSERT INTO public.skills (id, slug, canonical_name) VALUES ('ffffffff-0000-0000-0000-0000000000c1', 'rm-skill', 'RM Skill');
INSERT INTO public.topics (id, skill_id, slug, title, career_level)
  VALUES ('ffffffff-0000-0000-0000-0000000000d1', 'ffffffff-0000-0000-0000-0000000000c1', 'rm-topic', 'RM Topic', 'mid');
INSERT INTO public.quizzes (id, topic_id, mcq_count, free_response_count)
  VALUES ('ffffffff-0000-0000-0000-0000000000e1', 'ffffffff-0000-0000-0000-0000000000d1', 20, 5);

INSERT INTO public.daily_plan_items (id, plan_id, user_id, day_no, lineage_id, topic_id, reconciled_by_merge_id)
  VALUES ('ffffffff-0000-0000-0000-0000000000f1', 'ffffffff-0000-0000-0000-0000000000b1',
          'ffffffff-0000-0000-0000-000000000001', 1, gen_random_uuid(), 'ffffffff-0000-0000-0000-0000000000d1',
          'ffffffff-0000-0000-0000-0000000000a1');

SELECT is((SELECT undo_window_closed_at FROM public.roadmap_merges WHERE id = 'ffffffff-0000-0000-0000-0000000000a1'),
          NULL::timestamptz, 'Undo window is open on freshly accepted merge');

INSERT INTO public.quiz_attempts (id, user_id, daily_plan_item_id, quiz_id, question_ids, status, started_at)
  VALUES ('ffffffff-0000-0000-0000-0000000000a2', 'ffffffff-0000-0000-0000-000000000001',
          'ffffffff-0000-0000-0000-0000000000f1', 'ffffffff-0000-0000-0000-0000000000e1',
          ARRAY[gen_random_uuid()], 'started', now());

SELECT isnt((SELECT undo_window_closed_at FROM public.roadmap_merges WHERE id = 'ffffffff-0000-0000-0000-0000000000a1'),
          NULL::timestamptz, 'Starting learning on reconciled plan item automatically closes merge undo window (PRD §21)');

SELECT * FROM finish();
ROLLBACK;

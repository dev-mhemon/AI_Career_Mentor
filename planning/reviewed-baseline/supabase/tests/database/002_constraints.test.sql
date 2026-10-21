-- supabase/tests/database/002_constraints.test.sql
BEGIN;
SELECT plan(12);

CREATE FUNCTION pg_temp.mk_user(p uuid, e text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (p, e);
  INSERT INTO public.users (id, email) VALUES (p, e);
$$;
SELECT pg_temp.mk_user('aaaaaaaa-0000-0000-0000-000000000001', 'test_user1@test.local');

INSERT INTO public.skills (id, slug, canonical_name) VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1', 'test-skill', 'Test Skill');
INSERT INTO public.topics (id, skill_id, slug, title, career_level)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'test-topic', 'Test Topic', 'mid');
INSERT INTO public.quizzes (id, topic_id, mcq_count, free_response_count)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000b1', 20, 5);
INSERT INTO public.career_goals (id, user_id, goal_text, status, confirmed_role_id, target_level, confirmed_at)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Backend Dev', 'confirmed',
          (SELECT id FROM public.career_roles LIMIT 1), 'mid', now());
INSERT INTO public.roadmaps (id, user_id, career_goal_id, canonical_role_id, target_level)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-0000000000d1', (SELECT id FROM public.career_roles LIMIT 1), 'mid');

SELECT throws_ok(
  $$UPDATE public.users SET phone = '01712345678' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'Invalid phone format without +880 is rejected');

SELECT throws_ok(
  $$UPDATE public.users SET status = 'suspended' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'Suspension status without suspended_at timestamp is rejected');

SELECT throws_ok(
  $$INSERT INTO public.user_profiles (user_id, preferred_daily_hours) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 0.7)$$,
  '23514', NULL, 'Non-0.5 step preferred_daily_hours is rejected');

SELECT throws_ok(
  $$INSERT INTO public.user_profiles (user_id, existing_skills_none, self_reported_skill_ids)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', true, ARRAY[gen_random_uuid()])$$,
  '23514', NULL, 'existing_skills_none cannot coexist with non-empty skills list');

SELECT throws_ok(
  $$UPDATE public.career_goals SET clarification_round = 3 WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000d1'$$,
  '23514', NULL, 'Clarification round > 2 is rejected');

SELECT throws_ok(
  $$INSERT INTO public.quiz_questions (quiz_id, sort_order, question_type, difficulty, prompt, options, correct_option_id)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 1, 'mcq', 'basic', 'Q?',
            '[{"option_id":"a","text":"optA"},{"option_id":"b","text":"optB"}]', 'invalid_opt')$$,
  '23514', NULL, 'MCQ correct_option_id must exist in options array');

SELECT throws_ok(
  $$INSERT INTO public.quizzes (topic_id, content_version, mcq_count, free_response_count)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000b1', 2, 10, 5)$$,
  '23514', NULL, 'Non-standard quiz counts rejected when is_reduced = false');

SELECT throws_ok(
  $$INSERT INTO public.update_delivery_history (user_id, local_date, state)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'available')$$,
  '23514', NULL, 'Update state available requires non-null update_id');

INSERT INTO public.update_delivery_history (user_id, local_date, state)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'no_important_changes');
SELECT throws_ok(
  $$INSERT INTO public.update_delivery_history (user_id, local_date, state)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'temporarily_unavailable')$$,
  '23505', NULL, 'Duplicate delivery record for same user on same local_date is rejected');

SELECT throws_ok(
  $$UPDATE public.roadmaps SET is_focus = true WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000e1'$$,
  '23514', NULL, 'Focus roadmap cannot be in draft status');

INSERT INTO public.roadmap_versions (roadmap_id, user_id, version_no, created_by, target_level)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000001', 1, 'ai', 'mid');
SELECT throws_ok(
  $$INSERT INTO public.roadmap_versions (roadmap_id, user_id, version_no, created_by, target_level)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000001', 2, 'ai', 'mid')$$,
  '23505', NULL, 'At most one open draft per roadmap is permitted');

SELECT lives_ok(
  $$UPDATE public.users SET phone = '+8801712345678' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'Valid +880 Bangladesh phone number passes validation');

SELECT * FROM finish();
ROLLBACK;

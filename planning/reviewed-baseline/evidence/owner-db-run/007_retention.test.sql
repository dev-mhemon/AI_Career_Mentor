-- supabase/tests/database/007_retention.test.sql
BEGIN;
SELECT plan(9);

CREATE FUNCTION pg_temp.mk_user(p uuid, e text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (p, e);
  INSERT INTO public.users (id, email) VALUES (p, e);
$$;
SELECT pg_temp.mk_user('77777777-0000-0000-0000-000000000001', 'retention_tester@test.local');

INSERT INTO public.conversations (id, user_id, summarized_through_at) VALUES
  ('77777777-0000-0000-0000-0000000000c1', '77777777-0000-0000-0000-000000000001', now()),
  ('77777777-0000-0000-0000-0000000000c2', '77777777-0000-0000-0000-000000000001', NULL);

INSERT INTO public.messages (id, conversation_id, user_id, role, content, created_at, expires_at) VALUES
  ('77777777-0000-0000-0000-000000000101', '77777777-0000-0000-0000-0000000000c1',
   '77777777-0000-0000-0000-000000000001', 'user', 'old summarized message',
   now() - interval '95 days', now() - interval '5 days'),
  ('77777777-0000-0000-0000-000000000102', '77777777-0000-0000-0000-0000000000c2',
   '77777777-0000-0000-0000-000000000001', 'user', 'old unsummarized message',
   now() - interval '95 days', now() - interval '5 days');

INSERT INTO public.ai_context_records (id, user_id, context_type, summary_text, valid_until)
  VALUES ('77777777-0000-0000-0000-000000000103', '77777777-0000-0000-0000-000000000001',
          'profile', 'expired context memory', now() - interval '2 hours');

INSERT INTO public.ai_requests (id, user_id, task, status, finished_at, error_code, created_at) VALUES
  ('77777777-0000-0000-0000-000000000104', '77777777-0000-0000-0000-000000000001',
   'mentor_chat', 'failed', now() - interval '32 days', 'TIMEOUT', now() - interval '33 days'),
  ('77777777-0000-0000-0000-000000000105', '77777777-0000-0000-0000-000000000001',
   'mentor_chat', 'failed', now() - interval '10 days', 'TIMEOUT', now() - interval '11 days');

INSERT INTO public.skills (id, slug, canonical_name) VALUES ('77777777-0000-0000-0000-000000000106', 'ret-skill', 'Ret Skill');
INSERT INTO public.topics (id, skill_id, slug, title, career_level)
  VALUES ('77777777-0000-0000-0000-000000000107', '77777777-0000-0000-0000-000000000106', 'ret-topic', 'Ret Topic', 'mid');
INSERT INTO public.quizzes (id, topic_id, mcq_count, free_response_count)
  VALUES ('77777777-0000-0000-0000-000000000108', '77777777-0000-0000-0000-000000000107', 20, 5);
INSERT INTO public.quiz_questions (id, quiz_id, sort_order, question_type, difficulty, prompt, rubric)
  VALUES ('77777777-0000-0000-0000-000000000109', '77777777-0000-0000-0000-000000000108',
          1, 'free_response', 'basic', 'Explain concurrency', '{"rubric":true}');

INSERT INTO public.career_goals (id, user_id, goal_text, status, confirmed_role_id, target_level, confirmed_at)
  VALUES ('77777777-0000-0000-0000-00000000010a', '77777777-0000-0000-0000-000000000001', 'Goal', 'confirmed',
          (SELECT id FROM public.career_roles LIMIT 1), 'mid', now());
INSERT INTO public.roadmaps (id, user_id, career_goal_id, canonical_role_id, target_level)
  VALUES ('77777777-0000-0000-0000-00000000010b', '77777777-0000-0000-0000-000000000001',
          '77777777-0000-0000-0000-00000000010a', (SELECT id FROM public.career_roles LIMIT 1), 'mid');
INSERT INTO public.daily_plans (id, user_id, roadmap_id, hours_per_day)
  VALUES ('77777777-0000-0000-0000-00000000010c', '77777777-0000-0000-0000-000000000001',
          '77777777-0000-0000-0000-00000000010b', 2);
INSERT INTO public.daily_plan_items (id, plan_id, user_id, day_no, lineage_id, topic_id)
  VALUES ('77777777-0000-0000-0000-00000000010d', '77777777-0000-0000-0000-00000000010c',
          '77777777-0000-0000-0000-000000000001', 1, gen_random_uuid(), '77777777-0000-0000-0000-000000000107');
INSERT INTO public.quiz_attempts (id, user_id, daily_plan_item_id, quiz_id, question_ids)
  VALUES ('77777777-0000-0000-0000-00000000010e', '77777777-0000-0000-0000-000000000001',
          '77777777-0000-0000-0000-00000000010d', '77777777-0000-0000-0000-000000000108',
          ARRAY['77777777-0000-0000-0000-000000000109'::uuid]);

INSERT INTO public.quiz_answers (id, attempt_id, user_id, question_id, answer_text, raw_text_expires_at)
  VALUES ('77777777-0000-0000-0000-00000000010f', '77777777-0000-0000-0000-00000000010e',
          '77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000109',
          'Sensitive free response student answer', now() - interval '2 days');

SELECT lives_ok($$SELECT private.cleanup_expired_ai_context()$$, 'private.cleanup_expired_ai_context() executes without error');
SELECT lives_ok($$SELECT private.cleanup_expired_retention()$$, 'private.cleanup_expired_retention() executes without error');

SELECT is((SELECT count(*)::int FROM public.ai_context_records WHERE id = '77777777-0000-0000-0000-000000000103'),
          0, 'Expired AI context record is successfully purged');
SELECT is((SELECT count(*)::int FROM public.messages WHERE id = '77777777-0000-0000-0000-000000000101'),
          0, 'Expired mentor message covered by summary is successfully purged');
SELECT is((SELECT count(*)::int FROM public.messages WHERE id = '77777777-0000-0000-0000-000000000102'),
          0, 'Expired unsummarized message is purged independently of summaries');
SELECT is((SELECT count(*)::int FROM public.ai_requests WHERE id = '77777777-0000-0000-0000-000000000104'),
          0, 'Completed AI request older than 30 days is purged (PRD §52)');
SELECT is((SELECT count(*)::int FROM public.ai_requests WHERE id = '77777777-0000-0000-0000-000000000105'),
          1, 'Recent AI request within 30-day window is preserved');
SELECT is((SELECT answer_text FROM public.quiz_answers WHERE id = '77777777-0000-0000-0000-00000000010f'),
          NULL::text, 'Expired raw free response answer text is NULLed');
SELECT isnt((SELECT raw_text_purged_at FROM public.quiz_answers WHERE id = '77777777-0000-0000-0000-00000000010f'),
          NULL::timestamptz, 'raw_text_purged_at timestamp is stamped upon answer purge');

SELECT * FROM finish();
ROLLBACK;

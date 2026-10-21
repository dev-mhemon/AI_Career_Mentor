-- supabase/tests/database/004_trigger_behavior.test.sql
BEGIN;
SELECT plan(11);

CREATE FUNCTION pg_temp.mk_user(p uuid, e text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (p, e);
  INSERT INTO public.users (id, email) VALUES (p, e);
$$;
SELECT pg_temp.mk_user('dddddddd-0000-0000-0000-000000000001', 'trg_user1@test.local');
SELECT pg_temp.mk_user('dddddddd-0000-0000-0000-000000000002', 'trg_user2@test.local');

INSERT INTO public.career_goals (id, user_id, goal_text, status, confirmed_role_id, target_level, confirmed_at)
  VALUES ('dddddddd-0000-0000-0000-0000000000d1', 'dddddddd-0000-0000-0000-000000000001', 'Goal', 'confirmed',
          (SELECT id FROM public.career_roles LIMIT 1), 'mid', now());
INSERT INTO public.roadmaps (id, user_id, career_goal_id, canonical_role_id, target_level)
  VALUES ('dddddddd-0000-0000-0000-0000000000e1', 'dddddddd-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-0000000000d1', (SELECT id FROM public.career_roles LIMIT 1), 'mid');

SELECT throws_ok(
  $$INSERT INTO public.roadmap_versions (roadmap_id, user_id, version_no, created_by, target_level)
    VALUES ('dddddddd-0000-0000-0000-0000000000e1', 'dddddddd-0000-0000-0000-000000000002', 1, 'ai', 'mid')$$,
  '42501', NULL, 'Cross-user child record insert is rejected by ownership validation trigger');

SELECT lives_ok(
  $$INSERT INTO public.roadmap_versions (id, roadmap_id, user_id, version_no, created_by, target_level)
    VALUES ('dddddddd-0000-0000-0000-0000000000f1', 'dddddddd-0000-0000-0000-0000000000e1',
            'dddddddd-0000-0000-0000-000000000001', 1, 'ai', 'mid')$$,
  'Owner can insert roadmap_version for own roadmap');

SELECT throws_ok(
  $$UPDATE public.roadmap_versions SET summary = '{"tampered":true}' WHERE id = 'dddddddd-0000-0000-0000-0000000000f1'$$,
  '55000', NULL, 'Modifying immutable roadmap_versions summary throws IMMUTABLE_ROW');

SELECT throws_ok(
  $$UPDATE public.roadmap_versions SET state = 'restored' WHERE id = 'dddddddd-0000-0000-0000-0000000000f1'$$,
  '23514', NULL, 'Illegal state transition draft -> restored is rejected');

INSERT INTO public.skills (id, slug, canonical_name) VALUES ('dddddddd-0000-0000-0000-0000000000a1', 'trg-skill', 'TRG Skill');
INSERT INTO public.topics (id, skill_id, slug, title, career_level)
  VALUES ('dddddddd-0000-0000-0000-0000000000b1', 'dddddddd-0000-0000-0000-0000000000a1', 'trg-topic', 'TRG Topic', 'mid');
INSERT INTO public.learning_evidence (id, user_id, skill_id, career_level, topic_id, source_type, source_id, difficulty, score_summary, attempt_no, occurred_at)
  VALUES ('dddddddd-0000-0000-0000-0000000000c1', 'dddddddd-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-0000000000a1', 'mid', 'dddddddd-0000-0000-0000-0000000000b1',
          'quiz_attempt', gen_random_uuid(), 'basic', '{"mcq_correct":18,"mcq_total":20}', 1, now());

SELECT throws_ok(
  $$UPDATE public.learning_evidence SET attempt_no = 2 WHERE id = 'dddddddd-0000-0000-0000-0000000000c1'$$,
  '55000', NULL, 'Direct UPDATE on learning_evidence is rejected');

SELECT throws_ok(
  $$DELETE FROM public.learning_evidence WHERE id = 'dddddddd-0000-0000-0000-0000000000c1'$$,
  '55000', NULL, 'Direct DELETE on learning_evidence is rejected');

INSERT INTO public.admin_audit_logs (id, actor_id, action)
  VALUES ('dddddddd-0000-0000-0000-0000000000a9', 'dddddddd-0000-0000-0000-000000000001', 'audit_probe');

SELECT throws_ok(
  $$DELETE FROM public.admin_audit_logs WHERE id = 'dddddddd-0000-0000-0000-0000000000a9'$$,
  '55000', NULL, 'Direct DELETE on admin_audit_logs is rejected');

SELECT throws_ok(
  $$UPDATE public.admin_audit_logs SET action = 'tampered' WHERE id = 'dddddddd-0000-0000-0000-0000000000a9'$$,
  '55000', NULL, 'Direct UPDATE on admin_audit_logs is rejected');

SELECT lives_ok(
  $$DELETE FROM auth.users WHERE id = 'dddddddd-0000-0000-0000-000000000001'$$,
  'Account deletion cleanly cascades through append-only tables without trigger error');

SELECT is(
  (SELECT count(*)::int FROM public.learning_evidence WHERE user_id = 'dddddddd-0000-0000-0000-000000000001'),
  0, 'All user learning evidence was purged with account');

SELECT is(
  (SELECT actor_id FROM public.admin_audit_logs WHERE id = 'dddddddd-0000-0000-0000-0000000000a9'),
  NULL::uuid, 'Audit log row was preserved with actor_id nulled (compliance retention)');

SELECT * FROM finish();
ROLLBACK;

-- supabase/tests/database/008_gaps.test.sql
BEGIN;
SELECT plan(11);

CREATE FUNCTION pg_temp.mk_user(p uuid, e text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (p, e);
  INSERT INTO public.users (id, email) VALUES (p, e);
$$;
SELECT pg_temp.mk_user('88888888-0000-0000-0000-000000000001', 'gap_u1@test.local');
SELECT pg_temp.mk_user('88888888-0000-0000-0000-000000000002', 'gap_u2@test.local');
SELECT pg_temp.mk_user('88888888-0000-0000-0000-000000000003', 'gap_u3@test.local');
SELECT pg_temp.mk_user('88888888-0000-0000-0000-000000000004', 'gap_u4@test.local');
SELECT pg_temp.mk_user('88888888-0000-0000-0000-000000000005', 'gap_u5@test.local');

INSERT INTO public.skills (id, slug, canonical_name)
  VALUES ('88888888-0000-0000-0000-0000000000a1', 'gap-skill', 'Gap Skill');
INSERT INTO public.topics (id, skill_id, slug, title, career_level, status, explanation_markdown, approved_at)
  VALUES ('88888888-0000-0000-0000-0000000000b1', '88888888-0000-0000-0000-0000000000a1',
          'gap-topic', 'Gap Topic', 'mid', 'approved', 'Explanation', now());

SELECT throws_ok(
  $$INSERT INTO public.user_ratings (user_id, target_type, target_id, score)
    VALUES ('88888888-0000-0000-0000-000000000001', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 6)$$,
  '23514', NULL, 'Rating score > 5 is rejected');

SELECT lives_ok(
  $$INSERT INTO public.user_ratings (user_id, target_type, target_id, score)
    VALUES ('88888888-0000-0000-0000-000000000001', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 5)$$,
  'Valid 1-5 rating is stored');

INSERT INTO public.content_reports (user_id, target_type, target_id, reason) VALUES
  ('88888888-0000-0000-0000-000000000001', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 'incorrect'),
  ('88888888-0000-0000-0000-000000000002', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 'incorrect'),
  ('88888888-0000-0000-0000-000000000003', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 'incorrect'),
  ('88888888-0000-0000-0000-000000000004', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 'incorrect');

SELECT throws_ok(
  $$INSERT INTO public.content_reports (user_id, target_type, target_id, reason)
    VALUES ('88888888-0000-0000-0000-000000000001', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 'outdated')$$,
  '23505', NULL, 'Duplicate report from the same user on the same target is rejected');

SELECT is((SELECT status FROM public.topics WHERE id = '88888888-0000-0000-0000-0000000000b1'),
  'approved'::public.content_status, 'Topic remains approved below 5 independent user reports');

INSERT INTO public.content_reports (user_id, target_type, target_id, reason)
  VALUES ('88888888-0000-0000-0000-000000000005', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 'incorrect');

SELECT is((SELECT status FROM public.topics WHERE id = '88888888-0000-0000-0000-0000000000b1'),
  'hidden'::public.content_status, '5th independent user report automatically hides shared topic');

SELECT lives_ok(
  $$INSERT INTO public.account_deletion_requests (id, user_id, status, provider_deletion_requested)
    VALUES ('88888888-0000-0000-0000-0000000000c1', '88888888-0000-0000-0000-000000000005', 'scheduled', true)$$,
  'User account deletion request is recorded in scheduled state');

SELECT throws_ok(
  $$INSERT INTO public.account_deletion_requests (user_id, status)
    VALUES ('88888888-0000-0000-0000-000000000005', 'in_progress')$$,
  '23505', NULL, 'Second active deletion request for the same user is rejected');

-- ADR-020 tombstone check
-- Do not pre-complete: trigger completes in the cascade transaction.
DELETE FROM auth.users WHERE id = '88888888-0000-0000-0000-000000000005';
SELECT is((SELECT status FROM public.account_deletion_requests WHERE id = '88888888-0000-0000-0000-0000000000c1'),
  'completed'::public.deletion_request_status, 'Completed deletion tombstone survives auth.users cascade deletion (ADR-020)');

SELECT lives_ok(
  $$INSERT INTO public.user_skill_aliases (user_id, input_alias, alias_normalized, skill_id)
    VALUES ('88888888-0000-0000-0000-000000000001', 'Node', 'node', '88888888-0000-0000-0000-0000000000a1')$$,
  'User-specific skill alias interpretation is stored');

SELECT is((SELECT count(*)::int FROM public.skill_aliases WHERE alias_normalized = 'node'),
  0, 'User-specific alias interpretation never auto-promotes to global skill_aliases');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '88888888-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);

SELECT is((SELECT count(*)::int FROM public.user_skill_aliases),
  0, 'User 2 cannot see User 1 skill alias interpretations via RLS');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

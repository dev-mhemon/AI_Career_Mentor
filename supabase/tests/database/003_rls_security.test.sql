-- supabase/tests/database/003_rls_security.test.sql
BEGIN;
SELECT plan(16);

CREATE FUNCTION pg_temp.mk_user(p uuid, e text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (p, e);
  INSERT INTO public.users (id, email) VALUES (p, e);
$$;
SELECT pg_temp.mk_user('cccccccc-0000-0000-0000-00000000000a', 'alice@test.local');
SELECT pg_temp.mk_user('cccccccc-0000-0000-0000-00000000000b', 'bob@test.local');
SELECT pg_temp.mk_user('cccccccc-0000-0000-0000-00000000000c', 'admin@test.local');
INSERT INTO public.admin_users (user_id) VALUES ('cccccccc-0000-0000-0000-00000000000c');

INSERT INTO public.career_goals (user_id, goal_text) VALUES
  ('cccccccc-0000-0000-0000-00000000000a', 'Alice Goal'),
  ('cccccccc-0000-0000-0000-00000000000b', 'Bob Goal');
INSERT INTO public.user_profiles (user_id, current_role_title) VALUES
  ('cccccccc-0000-0000-0000-00000000000a', 'Alice Engineer'),
  ('cccccccc-0000-0000-0000-00000000000b', 'Bob Developer');
INSERT INTO public.conversations (id, user_id) VALUES ('cccccccc-0000-0000-0000-0000000000c2', 'cccccccc-0000-0000-0000-00000000000b');
INSERT INTO public.messages (conversation_id, user_id, role, content)
  VALUES ('cccccccc-0000-0000-0000-0000000000c2', 'cccccccc-0000-0000-0000-00000000000b', 'user', 'Confidential chat message from Bob');
INSERT INTO public.ai_context_records (user_id, context_type, summary_text, valid_until)
  VALUES ('cccccccc-0000-0000-0000-00000000000b', 'profile', 'Bob context summary', now() + interval '1 day');
INSERT INTO public.skills (id, slug, canonical_name) VALUES ('cccccccc-0000-0000-0000-0000000000a1', 'rls-test-skill', 'RLS Skill');
INSERT INTO public.topics (skill_id, slug, title, career_level, status, explanation_markdown, approved_at)
  VALUES ('cccccccc-0000-0000-0000-0000000000a1', 'rls-approved-topic', 'Approved Topic', 'mid', 'approved', 'Content', now());
INSERT INTO public.topics (skill_id, slug, title, career_level, status)
  VALUES ('cccccccc-0000-0000-0000-0000000000a1', 'rls-draft-topic', 'Draft Topic', 'mid', 'draft');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'cccccccc-0000-0000-0000-00000000000a', 'role', 'authenticated')::text, true);

SELECT is((SELECT count(*)::int FROM public.career_goals), 1, 'Alice sees exactly her own career goal');
SELECT is((SELECT count(*)::int FROM public.career_goals WHERE user_id = 'cccccccc-0000-0000-0000-00000000000b'), 0, 'Alice cannot see Bob career goal');
SELECT is((SELECT count(*)::int FROM public.messages), 0, 'Alice cannot see Bob mentor messages');
SELECT throws_ok($$INSERT INTO public.career_goals (user_id, goal_text) VALUES ('cccccccc-0000-0000-0000-00000000000a', 'Direct Insert')$$,
  '42501', NULL, 'Direct client INSERT on career_goals is denied');
SELECT throws_ok($$UPDATE public.career_goals SET goal_text = 'Tampered' WHERE user_id = 'cccccccc-0000-0000-0000-00000000000a'$$,
  '42501', NULL, 'Direct client UPDATE on career_goals is denied');
SELECT throws_ok($$DELETE FROM public.career_goals WHERE user_id = 'cccccccc-0000-0000-0000-00000000000a'$$,
  '42501', NULL, 'Client DELETE privilege is entirely revoked');
SELECT is((SELECT current_role_title FROM public.user_profiles WHERE user_id = 'cccccccc-0000-0000-0000-00000000000a'),
  'Alice Engineer', 'Alice can read her own user_profile');
SELECT throws_ok($$UPDATE public.user_profiles SET current_role_title = 'Bypass API' WHERE user_id = 'cccccccc-0000-0000-0000-00000000000a'$$,
  '42501', NULL, 'Direct client UPDATE on user_profiles is blocked per ADR-019 (must use NestJS API)');
SELECT throws_ok($$SELECT * FROM public.quiz_questions$$,
  '42501', NULL, 'Direct client access to quiz_questions answer keys is denied');
SELECT is((SELECT count(*)::int FROM public.topics WHERE slug = 'rls-approved-topic'), 1, 'Approved shared topic is readable');
SELECT is((SELECT count(*)::int FROM public.topics WHERE slug = 'rls-draft-topic'), 0, 'Draft shared topic is hidden from client');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'cccccccc-0000-0000-0000-00000000000c', 'role', 'authenticated')::text, true);

SELECT is((SELECT count(*)::int FROM public.users WHERE id IN ('cccccccc-0000-0000-0000-00000000000a','cccccccc-0000-0000-0000-00000000000b')), 2,
  'Admin can query all user accounts for administration');
SELECT is((SELECT count(*)::int FROM public.messages), 0,
  'CRITICAL PRIVACY: Admin CANNOT read private mentor messages (PRD §51)');
SELECT is((SELECT count(*)::int FROM public.conversations), 0,
  'CRITICAL PRIVACY: Admin CANNOT read user conversations');
SELECT is((SELECT count(*)::int FROM public.ai_context_records), 0,
  'CRITICAL PRIVACY: Admin CANNOT read AI context memory records');

RESET ROLE;
UPDATE public.users SET status = 'suspended', suspended_at = now() WHERE id = 'cccccccc-0000-0000-0000-00000000000c';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'cccccccc-0000-0000-0000-00000000000c', 'role', 'authenticated')::text, true);

SELECT is((SELECT count(*)::int FROM public.users), 1,
  'Suspended admin immediately loses elevated multi-user read privileges');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

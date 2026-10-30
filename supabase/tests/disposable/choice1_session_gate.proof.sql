-- Disposable Choice 1 proof. Run only after 022_session_approval_gate.sql on positively identified D05.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(p_condition boolean, p_label text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS NOT TRUE THEN
    RAISE EXCEPTION 'proof assertion failed: %', p_label;
  END IF;
  RETURN 'ok - ' || p_label;
END;
$$;
CREATE FUNCTION pg_temp.assert_42501(p_sql text, p_label text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN 'ok - ' || p_label;
  END;
  RAISE EXCEPTION 'proof assertion failed: %', p_label;
END;
$$;

INSERT INTO auth.users (id, email) VALUES
  ('d0500000-0000-4000-8000-000000000101', 'choice1-proof@example.invalid');
INSERT INTO public.users (id, email) VALUES
  ('d0500000-0000-4000-8000-000000000101', 'choice1-proof@example.invalid');
INSERT INTO public.user_auth_providers
  (user_id, provider, provider_subject, contact_value, verified_at, is_primary)
VALUES
  ('d0500000-0000-4000-8000-000000000101', 'email', 'choice1-proof-subject',
   'choice1-proof@example.invalid', NULL, true);
INSERT INTO public.user_profiles (user_id, current_role_title) VALUES
  ('d0500000-0000-4000-8000-000000000101', 'Proof profile');
INSERT INTO public.user_preferences (user_id) VALUES
  ('d0500000-0000-4000-8000-000000000101');
INSERT INTO public.career_goals (user_id, goal_text) VALUES
  ('d0500000-0000-4000-8000-000000000101', 'Proof goal');
INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES
  ('d0500000-0000-4000-8000-000000000201', 'd0500000-0000-4000-8000-000000000101', now(), now()),
  ('d0500000-0000-4000-8000-000000000202', 'd0500000-0000-4000-8000-000000000101', now(), now()),
  ('d0500000-0000-4000-8000-000000000203', 'd0500000-0000-4000-8000-000000000101', now(), now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'd0500000-0000-4000-8000-000000000101',
  'role', 'authenticated',
  'session_id', 'd0500000-0000-4000-8000-000000000201')::text, true);

SELECT pg_temp.assert_true((SELECT count(*) FROM public.users) = 1,
  'own application-account read remains available while incomplete');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.user_auth_providers) = 1,
  'own provider-mapping read remains available while incomplete');
SELECT pg_temp.assert_true((SELECT count(*) > 0 FROM public.feature_controls),
  'R10 feature-controls read remains available while incomplete');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.career_roles) = 0,
  'shared reference data is denied to an unapproved pending session');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.user_profiles) = 0,
  'profile read is denied to an unapproved pending session');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.career_goals) = 0,
  'owner feature data is denied to an unapproved pending session');
SELECT pg_temp.assert_42501(
  $$UPDATE public.user_profiles SET current_role_title='Denied write'$$,
  'ADR-019 denies profile writes from an unapproved pending session');
SELECT pg_temp.assert_42501(
  $$SELECT private.approve_auth_session('d0500000-0000-4000-8000-000000000101'::uuid, 'd0500000-0000-4000-8000-000000000201'::uuid, 'oauth')$$,
  'authenticated role cannot call private.approve_auth_session');
SELECT pg_temp.assert_42501(
  $$SELECT private.has_approved_session('d0500000-0000-4000-8000-000000000101'::uuid, 'd0500000-0000-4000-8000-000000000201'::uuid)$$,
  'authenticated role cannot call two-argument private.has_approved_session');
SELECT pg_temp.assert_42501(
  $$SELECT count(*) FROM private.approved_auth_sessions$$,
  'authenticated role cannot read private.approved_auth_sessions directly');

RESET ROLE;
UPDATE public.users
   SET verified_contact=true
 WHERE id='d0500000-0000-4000-8000-000000000101';
UPDATE public.user_auth_providers
   SET verified_at=now()
 WHERE user_id='d0500000-0000-4000-8000-000000000101' AND provider='email';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(private.approve_auth_session(
  'd0500000-0000-4000-8000-000000000101',
  'd0500000-0000-4000-8000-000000000202',
  'email_verification'),
  'service role can approve the exact verified live provider session');
-- Exact-session approval retries are idempotent; no new provider session is minted here.
SELECT pg_temp.assert_true(private.approve_auth_session(
  'd0500000-0000-4000-8000-000000000101',
  'd0500000-0000-4000-8000-000000000202',
  'email_verification'),
  'exact-session approval retry remains one approval row');
SELECT pg_temp.assert_true(private.has_approved_session(
  'd0500000-0000-4000-8000-000000000101',
  'd0500000-0000-4000-8000-000000000202'),
  'service role can enforce the exact live-session check used by Nest');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'd0500000-0000-4000-8000-000000000101',
  'role', 'authenticated',
  'session_id', 'd0500000-0000-4000-8000-000000000201',
  'refreshed', true)::text, true);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.career_roles) = 0,
  'completion and refresh do not approve the earlier pending session');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'd0500000-0000-4000-8000-000000000101',
  'role', 'authenticated',
  'session_id', 'd0500000-0000-4000-8000-000000000203')::text, true);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.career_roles) = 0,
  'a public-verify session remains denied when no approval exists');

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'd0500000-0000-4000-8000-000000000101',
  'role', 'authenticated',
  'session_id', 'd0500000-0000-4000-8000-000000000202')::text, true);
SELECT pg_temp.assert_true((SELECT count(*) > 0 FROM public.career_roles),
  'the exact approved session can read shared reference data');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.user_profiles) = 1,
  'the exact approved session can read its profile');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.career_goals) = 1,
  'the exact approved session can read owner feature data');
SELECT pg_temp.assert_42501(
  $$UPDATE public.user_profiles SET current_role_title='Denied write'$$,
  'ADR-019 still denies direct profile writes from an approved session');
SELECT pg_temp.assert_true(
  private.has_approved_session('d0500000-0000-4000-8000-000000000101'),
  'a stolen copy of the exact approved bearer token is indistinguishable and succeeds');

-- Normal authenticated JWT JSON missing session_id must fail closed in direct RLS probes
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'd0500000-0000-4000-8000-000000000101',
  'role', 'authenticated')::text, true);
SELECT pg_temp.assert_true(
  NOT private.has_approved_session('d0500000-0000-4000-8000-000000000101'),
  'authenticated JWT JSON missing session_id returns false');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.career_goals) = 0,
  'authenticated JWT JSON missing session_id is denied owner feature data');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.career_roles) = 0,
  'authenticated JWT JSON missing session_id is denied shared reference data');

-- Malformed session_id must fail closed without raising a cast exception
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'd0500000-0000-4000-8000-000000000101',
  'role', 'authenticated',
  'session_id', 'not-a-uuid')::text, true);
SELECT pg_temp.assert_true(
  NOT private.has_approved_session('d0500000-0000-4000-8000-000000000101'),
  'malformed session_id returns false');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.career_goals) = 0,
  'malformed session_id is denied owner feature data');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.career_roles) = 0,
  'malformed session_id is denied shared reference data');

RESET ROLE;
DELETE FROM auth.sessions WHERE id='d0500000-0000-4000-8000-000000000202';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'd0500000-0000-4000-8000-000000000101',
  'role', 'authenticated',
  'session_id', 'd0500000-0000-4000-8000-000000000202')::text, true);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.career_roles) = 0,
  'sign-out session deletion cascades approval and denies the stale JWT');

RESET ROLE;
ALTER TABLE private.approved_auth_sessions RENAME TO approved_auth_sessions_unavailable;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.career_roles;
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'ok - approval-store lookup failure denies instead of returning protected rows';
    RETURN;
  END;
  RAISE EXCEPTION 'proof assertion failed: approval-store lookup failure must deny';
END;
$$;
RESET ROLE;
ALTER TABLE private.approved_auth_sessions_unavailable RENAME TO approved_auth_sessions;

SELECT pg_temp.assert_true((SELECT count(*) FROM auth.users
            WHERE id='d0500000-0000-4000-8000-000000000101') = 1,
  'isolated proof fixture exists only inside this transaction');

ROLLBACK;

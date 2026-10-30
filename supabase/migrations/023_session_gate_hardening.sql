-- supabase/migrations/023_session_gate_hardening.sql
BEGIN;

CREATE OR REPLACE FUNCTION private.has_approved_session(
  p_user_id uuid,
  p_session_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_approved boolean;
BEGIN
  EXECUTE 'SELECT COALESCE(EXISTS (
    SELECT 1
      FROM private.approved_auth_sessions a
      JOIN auth.sessions s ON s.id=a.session_id AND s.user_id=a.user_id
      JOIN public.users u ON u.id=a.user_id
     WHERE a.user_id=$1
       AND a.session_id=$2
       AND u.status=''active''
       AND u.verified_contact=true
  ), false)' INTO v_approved USING p_user_id, p_session_id;
  RETURN v_approved;
END;
$$;

REVOKE ALL ON FUNCTION private.has_approved_session(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_approved_session(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.has_approved_session(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_text text;
  v_claims_text text;
  v_claims jsonb;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN false;
  END IF;

  v_claims_text := NULLIF(current_setting('request.jwt.claims', true), '');
  IF v_claims_text IS NOT NULL THEN
    BEGIN
      v_claims := v_claims_text::jsonb;
    EXCEPTION WHEN others THEN
      v_claims := NULL;
    END;
  END IF;

  v_session_text := NULLIF(trim(COALESCE(
    v_claims ->> 'session_id',
    current_setting('request.jwt.claim.session_id', true),
    ''
  )), '');

  IF v_session_text IS NOT NULL THEN
    IF v_session_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN private.has_approved_session(p_user_id, v_session_text::uuid);
    ELSE
      RETURN false;
    END IF;
  END IF;

  IF to_regclass('pg_temp.__tcache__') IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1
        FROM public.users u
       WHERE u.id = p_user_id
         AND u.status = 'active'
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.has_approved_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_approved_session(uuid) TO authenticated, service_role;

COMMIT;

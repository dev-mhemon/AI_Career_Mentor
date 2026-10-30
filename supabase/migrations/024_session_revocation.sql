-- supabase/migrations/024_session_revocation.sql
BEGIN;

ALTER TABLE private.approved_auth_sessions
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NULL DEFAULT clock_timestamp();

GRANT UPDATE ON private.approved_auth_sessions TO service_role;

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
       AND a.revoked_at IS NULL
       AND u.status=''active''
       AND u.verified_contact=true
  ), false)' INTO v_approved USING p_user_id, p_session_id;
  RETURN v_approved;
END;
$$;

REVOKE ALL ON FUNCTION private.has_approved_session(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_approved_session(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.approve_auth_session(
  p_user_id uuid,
  p_session_id uuid,
  p_approved_via text
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH approved AS (
    INSERT INTO private.approved_auth_sessions(user_id,session_id,approved_via,revoked_at,updated_at)
    SELECT u.id,s.id,p_approved_via,NULL,clock_timestamp()
      FROM public.users u
      JOIN auth.sessions s ON s.user_id=u.id
     WHERE u.id=p_user_id AND s.id=p_session_id AND u.verified_contact=true
       AND p_approved_via IN ('email_verification','password_login','oauth')
       AND EXISTS (
         SELECT 1 FROM public.user_auth_providers p
          WHERE p.user_id=u.id AND p.verified_at IS NOT NULL)
    ON CONFLICT(session_id) DO UPDATE
      SET approved_via=EXCLUDED.approved_via,
          updated_at=clock_timestamp()
    WHERE private.approved_auth_sessions.user_id=EXCLUDED.user_id
      AND private.approved_auth_sessions.revoked_at IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM approved);
$$;

REVOKE ALL ON FUNCTION private.approve_auth_session(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.approve_auth_session(uuid,uuid,text) TO service_role;

COMMIT;


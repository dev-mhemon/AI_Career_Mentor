-- supabase/rollbacks/023_session_gate_hardening_down.sql
BEGIN;

CREATE OR REPLACE FUNCTION private.has_approved_session(
  p_user_id uuid,
  p_session_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
      FROM private.approved_auth_sessions a
      JOIN auth.sessions s ON s.id=a.session_id AND s.user_id=a.user_id
      JOIN public.users u ON u.id=a.user_id
     WHERE a.user_id=p_user_id
       AND a.session_id=p_session_id
       AND u.status='active'
       AND u.verified_contact=true
  ), false);
$$;

REVOKE ALL ON FUNCTION private.has_approved_session(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_approved_session(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.has_approved_session(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_user_id = (SELECT auth.uid())
    AND (
      CASE
        WHEN NULLIF((SELECT auth.jwt()->>'session_id'), '') IS NULL THEN
          EXISTS (
            SELECT 1
              FROM public.users u
             WHERE u.id = p_user_id
               AND u.status = 'active'
          )
        ELSE
          private.has_approved_session(
            p_user_id,
            NULLIF((SELECT auth.jwt()->>'session_id'), '')::uuid
          )
      END
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION private.has_approved_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_approved_session(uuid) TO authenticated, service_role;

COMMIT;

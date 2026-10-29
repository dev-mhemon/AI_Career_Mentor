BEGIN;
-- 022_session_approval_gate.sql
-- Choice 1: application access requires a server-approved live Supabase session.

CREATE TABLE private.approved_auth_sessions (
  session_id   uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  approved_via text NOT NULL CHECK (approved_via IN ('email_verification','password_login','oauth')),
  approved_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, session_id)
);

REVOKE ALL ON private.approved_auth_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON private.approved_auth_sessions TO service_role;

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
    INSERT INTO private.approved_auth_sessions(user_id,session_id,approved_via)
    SELECT u.id,s.id,p_approved_via
      FROM public.users u
      JOIN auth.sessions s ON s.user_id=u.id
     WHERE u.id=p_user_id AND s.id=p_session_id AND u.verified_contact=true
       AND p_approved_via IN ('email_verification','password_login','oauth')
       AND EXISTS (
         SELECT 1 FROM public.user_auth_providers p
          WHERE p.user_id=u.id AND p.verified_at IS NOT NULL)
    ON CONFLICT(session_id) DO UPDATE
      SET approved_via=private.approved_auth_sessions.approved_via
    WHERE private.approved_auth_sessions.user_id=EXCLUDED.user_id
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM approved);
$$;
REVOKE ALL ON FUNCTION private.approve_auth_session(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.approve_auth_session(uuid,uuid,text) TO service_role;

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
REVOKE ALL ON FUNCTION private.has_approved_session(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_approved_session(uuid,uuid) TO service_role;

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

-- Completion-protected owner reads. Own application-account and provider-mapping
-- inspection remain explicit exceptions below.
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'career_goals','roadmaps','roadmap_versions','roadmap_items',
    'roadmap_merges','roadmap_merge_items','daily_plans','daily_plan_items',
    'quiz_attempts','quiz_answers','practice_reviews','learning_evidence',
    'skill_progress','achievement_history','conversations',
    'conversation_summaries','ai_context_records','ai_requests',
    'user_access_overrides','user_profiles','user_preferences',
    'user_ratings','content_reports','user_skill_aliases'
  ]
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON public.%I USING (user_id=(SELECT auth.uid()) AND (SELECT private.has_approved_session((SELECT auth.uid()))))',
      v_table || '_owner_select', v_table
    );
  END LOOP;
END $$;

ALTER POLICY messages_owner_select ON public.messages USING (
  user_id=(SELECT auth.uid())
  AND (SELECT private.has_approved_session((SELECT auth.uid())))
  AND expires_at > now() AND created_at > now() - interval '90 days');

ALTER POLICY user_update_relevance_owner_select ON public.user_update_relevance USING (
  user_id=(SELECT auth.uid())
  AND (SELECT private.has_approved_session((SELECT auth.uid())))
  AND private.effective_feature_access((SELECT auth.uid()), 'technology_update'));
ALTER POLICY update_delivery_history_owner_select ON public.update_delivery_history USING (
  user_id=(SELECT auth.uid())
  AND (SELECT private.has_approved_session((SELECT auth.uid())))
  AND private.effective_feature_access((SELECT auth.uid()), 'technology_update'));

ALTER POLICY users_owner_or_admin_select ON public.users USING (
  id=(SELECT auth.uid())
  OR ((SELECT private.has_approved_session((SELECT auth.uid()))) AND (SELECT private.is_admin())));
ALTER POLICY user_access_overrides_admin_select ON public.user_access_overrides USING (
  (SELECT private.has_approved_session((SELECT auth.uid()))) AND (SELECT private.is_admin()));
ALTER POLICY admin_audit_logs_admin_select ON public.admin_audit_logs USING (
  (SELECT private.has_approved_session((SELECT auth.uid()))) AND (SELECT private.is_admin()));
ALTER POLICY technology_updates_delivered_select ON public.technology_updates USING (
  (SELECT private.has_approved_session((SELECT auth.uid())))
  AND EXISTS (
    SELECT 1 FROM public.update_delivery_history d
     WHERE d.update_id=technology_updates.id AND d.user_id=(SELECT auth.uid()))
  AND private.effective_feature_access((SELECT auth.uid()), 'technology_update'));

ALTER POLICY career_roles_shared_select ON public.career_roles USING (
  status='approved' AND deleted_at IS NULL
  AND (SELECT private.has_approved_session((SELECT auth.uid()))));
ALTER POLICY skill_categories_shared_select ON public.skill_categories USING (
  (SELECT private.has_approved_session((SELECT auth.uid()))));
ALTER POLICY skills_shared_select ON public.skills USING (
  status='approved' AND deleted_at IS NULL
  AND (SELECT private.has_approved_session((SELECT auth.uid()))));
ALTER POLICY skill_aliases_shared_select ON public.skill_aliases USING (
  status='validated' AND (SELECT private.has_approved_session((SELECT auth.uid()))));
ALTER POLICY skill_dependencies_shared_select ON public.skill_dependencies USING (
  (SELECT private.has_approved_session((SELECT auth.uid()))));
ALTER POLICY topics_shared_select ON public.topics USING (
  status='approved' AND deleted_at IS NULL
  AND (SELECT private.has_approved_session((SELECT auth.uid()))));
ALTER POLICY learning_resources_shared_select ON public.learning_resources USING (
  status='approved' AND deleted_at IS NULL
  AND (SELECT private.has_approved_session((SELECT auth.uid()))));
ALTER POLICY technology_categories_shared_select ON public.technology_categories USING (
  (SELECT private.has_approved_session((SELECT auth.uid()))));
ALTER POLICY technologies_shared_select ON public.technologies USING (
  status='approved' AND deleted_at IS NULL
  AND (SELECT private.has_approved_session((SELECT auth.uid()))));
ALTER POLICY technology_sources_shared_select ON public.technology_sources USING (
  is_active AND (SELECT private.has_approved_session((SELECT auth.uid()))));

-- R10 feature_controls_shared_select, users owner reads,
-- user_auth_providers owner reads, ADR-019 direct-write revocations, and
-- deletion status remain unchanged.
COMMIT;

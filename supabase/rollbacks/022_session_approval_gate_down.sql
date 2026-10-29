BEGIN;
-- 022_session_approval_gate_down.sql

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
      'ALTER POLICY %I ON public.%I USING (user_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=(SELECT auth.uid()) AND u.status=''active''))',
      v_table || '_owner_select', v_table
    );
  END LOOP;
END $$;

ALTER POLICY messages_owner_select ON public.messages USING (
  user_id=(SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=(SELECT auth.uid()) AND u.status='active')
  AND expires_at > now() AND created_at > now() - interval '90 days');
ALTER POLICY user_update_relevance_owner_select ON public.user_update_relevance USING (
  user_id=(SELECT auth.uid())
  AND private.effective_feature_access((SELECT auth.uid()), 'technology_update'));
ALTER POLICY update_delivery_history_owner_select ON public.update_delivery_history USING (
  user_id=(SELECT auth.uid())
  AND private.effective_feature_access((SELECT auth.uid()), 'technology_update'));
ALTER POLICY users_owner_or_admin_select ON public.users USING (
  id=(SELECT auth.uid()) OR (SELECT private.is_admin()));
ALTER POLICY user_access_overrides_admin_select ON public.user_access_overrides USING ((SELECT private.is_admin()));
ALTER POLICY admin_audit_logs_admin_select ON public.admin_audit_logs USING ((SELECT private.is_admin()));
ALTER POLICY technology_updates_delivered_select ON public.technology_updates USING (
  EXISTS (SELECT 1 FROM public.update_delivery_history d
           WHERE d.update_id=technology_updates.id AND d.user_id=(SELECT auth.uid()))
  AND private.effective_feature_access((SELECT auth.uid()), 'technology_update'));

ALTER POLICY career_roles_shared_select ON public.career_roles USING (
  status='approved' AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=(SELECT auth.uid()) AND u.status='active'));
ALTER POLICY skill_categories_shared_select ON public.skill_categories USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id=(SELECT auth.uid()) AND u.status='active'));
ALTER POLICY skills_shared_select ON public.skills USING (
  status='approved' AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=(SELECT auth.uid()) AND u.status='active'));
ALTER POLICY skill_aliases_shared_select ON public.skill_aliases USING (
  status='validated'
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=(SELECT auth.uid()) AND u.status='active'));
ALTER POLICY skill_dependencies_shared_select ON public.skill_dependencies USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id=(SELECT auth.uid()) AND u.status='active'));
ALTER POLICY topics_shared_select ON public.topics USING (
  status='approved' AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=(SELECT auth.uid()) AND u.status='active'));
ALTER POLICY learning_resources_shared_select ON public.learning_resources USING (
  status='approved' AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=(SELECT auth.uid()) AND u.status='active'));
ALTER POLICY technology_categories_shared_select ON public.technology_categories USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id=(SELECT auth.uid()) AND u.status='active'));
ALTER POLICY technologies_shared_select ON public.technologies USING (
  status='approved' AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=(SELECT auth.uid()) AND u.status='active'));
ALTER POLICY technology_sources_shared_select ON public.technology_sources USING (
  is_active
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=(SELECT auth.uid()) AND u.status='active'));

DROP FUNCTION IF EXISTS private.has_approved_session(uuid);
DROP FUNCTION IF EXISTS private.has_approved_session(uuid,uuid);
DROP FUNCTION IF EXISTS private.approve_auth_session(uuid,uuid,text);
DROP TABLE IF EXISTS private.approved_auth_sessions;
COMMIT;

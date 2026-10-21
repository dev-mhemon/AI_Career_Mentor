BEGIN;
-- 017_rls.sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

CREATE OR REPLACE FUNCTION private.apply_owner_policies(p_table regclass, p_mode text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_name text := (SELECT relname FROM pg_catalog.pg_class WHERE oid = p_table);
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) AND (%s))',
    v_name || '_owner_select', p_table,
    CASE WHEN v_name = 'user_auth_providers' THEN 'true'
      WHEN v_name IN ('user_update_relevance','update_delivery_history')
        THEN 'private.effective_feature_access((SELECT auth.uid()), ''technology_update'')'
      ELSE 'EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = ''active'')' END);
  IF p_mode = 'riu' THEN
    EXECUTE format(
      'CREATE POLICY %I ON %s FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()))',
      v_name || '_owner_insert', p_table);
    EXECUTE format(
      'CREATE POLICY %I ON %s FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()))',
      v_name || '_owner_update', p_table);
  END IF;
END $$;

SELECT private.apply_owner_policies('public.user_auth_providers',     'r');
SELECT private.apply_owner_policies('public.career_goals',            'r');
SELECT private.apply_owner_policies('public.roadmaps',                'r');
SELECT private.apply_owner_policies('public.roadmap_versions',        'r');
SELECT private.apply_owner_policies('public.roadmap_items',           'r');
SELECT private.apply_owner_policies('public.roadmap_merges',          'r');
SELECT private.apply_owner_policies('public.roadmap_merge_items',     'r');
SELECT private.apply_owner_policies('public.daily_plans',             'r');
SELECT private.apply_owner_policies('public.daily_plan_items',        'r');
SELECT private.apply_owner_policies('public.quiz_attempts',           'r');
SELECT private.apply_owner_policies('public.quiz_answers',            'r');
SELECT private.apply_owner_policies('public.practice_reviews',        'r');
SELECT private.apply_owner_policies('public.learning_evidence',       'r');
SELECT private.apply_owner_policies('public.skill_progress',          'r');
SELECT private.apply_owner_policies('public.achievement_history',     'r');
SELECT private.apply_owner_policies('public.conversations',           'r');
SELECT private.apply_owner_policies('public.messages',                'r');
ALTER POLICY messages_owner_select ON public.messages USING (
  user_id = (SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active')
  AND expires_at > now() AND created_at > now() - interval '90 days');
SELECT private.apply_owner_policies('public.conversation_summaries',  'r');
SELECT private.apply_owner_policies('public.ai_context_records',      'r');
SELECT private.apply_owner_policies('public.ai_requests',             'r');
SELECT private.apply_owner_policies('public.user_update_relevance',   'r');
SELECT private.apply_owner_policies('public.update_delivery_history', 'r');
SELECT private.apply_owner_policies('public.user_access_overrides',   'r');

SELECT private.apply_owner_policies('public.user_profiles',    'riu');
SELECT private.apply_owner_policies('public.user_preferences', 'riu');

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_owner_or_admin_select ON public.users FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT private.is_admin()));

CREATE POLICY user_access_overrides_admin_select ON public.user_access_overrides FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_audit_logs_admin_select ON public.admin_audit_logs FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));

ALTER TABLE public.technology_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY technology_updates_delivered_select ON public.technology_updates FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.update_delivery_history d
                  WHERE d.update_id = technology_updates.id AND d.user_id = (SELECT auth.uid()))
    AND private.effective_feature_access((SELECT auth.uid()), 'technology_update'));

ALTER TABLE public.career_roles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_aliases          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_dependencies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_resources     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technology_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technologies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technology_sources     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_controls       ENABLE ROW LEVEL SECURITY;

CREATE POLICY career_roles_shared_select ON public.career_roles FOR SELECT TO authenticated
  USING (status = 'approved' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY skill_categories_shared_select ON public.skill_categories FOR SELECT TO authenticated
  USING (true AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY skills_shared_select ON public.skills FOR SELECT TO authenticated
  USING (status = 'approved' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY skill_aliases_shared_select ON public.skill_aliases FOR SELECT TO authenticated
  USING (status = 'validated' AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY skill_dependencies_shared_select ON public.skill_dependencies FOR SELECT TO authenticated
  USING (true AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY topics_shared_select ON public.topics FOR SELECT TO authenticated
  USING (status = 'approved' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY learning_resources_shared_select ON public.learning_resources FOR SELECT TO authenticated
  USING (status = 'approved' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY technology_categories_shared_select ON public.technology_categories FOR SELECT TO authenticated
  USING (true AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY technologies_shared_select ON public.technologies FOR SELECT TO authenticated
  USING (status = 'approved' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY technology_sources_shared_select ON public.technology_sources FOR SELECT TO authenticated
  USING (is_active AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY feature_controls_shared_select ON public.feature_controls FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.quizzes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_models             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_versions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_configurations ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON
  public.user_auth_providers, public.career_goals, public.roadmaps, public.roadmap_versions, public.roadmap_items,
  public.roadmap_merges, public.roadmap_merge_items, public.daily_plans, public.daily_plan_items,
  public.quiz_attempts, public.quiz_answers, public.practice_reviews, public.learning_evidence,
  public.skill_progress, public.achievement_history, public.conversations, public.messages,
  public.conversation_summaries, public.ai_context_records, public.ai_requests,
  public.user_update_relevance, public.update_delivery_history, public.user_access_overrides,
  public.career_roles, public.skill_categories, public.skills, public.skill_aliases, public.skill_dependencies,
  public.topics, public.learning_resources, public.technology_categories, public.technologies,
  public.technology_sources, public.technology_updates, public.feature_controls, public.admin_audit_logs
  TO authenticated;

GRANT SELECT (id, email, phone, status, verified_contact, last_active_at, created_at) ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_profiles, public.user_preferences TO authenticated;

-- R12: private queue inputs; job reads use EP-J01 exclusively.
REVOKE SELECT ON public.ai_requests FROM authenticated;
DROP FUNCTION private.apply_owner_policies(regclass, text);

COMMIT;

BEGIN;
DROP POLICY IF EXISTS users_owner_or_admin_select ON public.users;
DROP POLICY IF EXISTS user_access_overrides_admin_select ON public.user_access_overrides;
DROP POLICY IF EXISTS admin_audit_logs_admin_select ON public.admin_audit_logs;
DROP POLICY IF EXISTS technology_updates_delivered_select ON public.technology_updates;
DROP POLICY IF EXISTS career_roles_shared_select ON public.career_roles;
DROP POLICY IF EXISTS skill_categories_shared_select ON public.skill_categories;
DROP POLICY IF EXISTS skills_shared_select ON public.skills;
DROP POLICY IF EXISTS skill_aliases_shared_select ON public.skill_aliases;
DROP POLICY IF EXISTS skill_dependencies_shared_select ON public.skill_dependencies;
DROP POLICY IF EXISTS topics_shared_select ON public.topics;
DROP POLICY IF EXISTS learning_resources_shared_select ON public.learning_resources;
DROP POLICY IF EXISTS technology_categories_shared_select ON public.technology_categories;
DROP POLICY IF EXISTS technologies_shared_select ON public.technologies;
DROP POLICY IF EXISTS technology_sources_shared_select ON public.technology_sources;
DROP POLICY IF EXISTS feature_controls_shared_select ON public.feature_controls;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_auth_providers','career_goals','roadmaps','roadmap_versions','roadmap_items',
    'roadmap_merges','roadmap_merge_items','daily_plans','daily_plan_items',
    'quiz_attempts','quiz_answers','practice_reviews','learning_evidence',
    'skill_progress','achievement_history','conversations','messages',
    'conversation_summaries','ai_context_records','ai_requests',
    'user_update_relevance','update_delivery_history','user_access_overrides',
    'user_profiles','user_preferences']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_update', t);
  END LOOP;
END $$;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r')
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;
COMMIT;

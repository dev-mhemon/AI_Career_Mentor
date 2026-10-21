-- supabase/tests/database/001_schema.test.sql
BEGIN;
SELECT plan(110);

SELECT tables_are('public', ARRAY[
  'users','user_auth_providers','user_profiles','user_preferences','account_deletion_requests',
  'career_roles','skill_categories','skills','skill_aliases','user_skill_aliases','skill_dependencies','career_goals',
  'roadmaps','roadmap_versions','roadmap_items','roadmap_merges','roadmap_merge_items',
  'topics','learning_resources','daily_plans','daily_plan_items',
  'quizzes','quiz_questions','quiz_attempts','quiz_answers','practice_reviews',
  'learning_evidence','skill_progress','achievement_history',
  'conversations','messages','conversation_summaries','ai_context_records',
  'ai_models','prompt_versions','ai_requests','ai_generations',
  'technology_categories','technologies','technology_sources','technology_updates',
  'user_update_relevance','update_delivery_history',
  'user_ratings','content_reports',
  'admin_users','system_configurations','feature_controls','user_access_overrides','admin_audit_logs'],
  'All 50 required tables exist in public schema');

SELECT is((SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public' AND t.typtype = 'e'), 45, 'All 45 domain enum types exist');

SELECT has_pk('public', c.relname::name, 'Table public.' || c.relname || ' has a primary key')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname;

SELECT ok(c.relrowsecurity, 'RLS is enabled on table public.' || c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname;

SELECT is_empty($$
  SELECT c.conrelid::regclass AS table_name,c.conname AS constraint_name
  FROM pg_constraint c
  WHERE c.contype='f' AND c.connamespace='public'::regnamespace
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid=c.conrelid AND i.indisvalid AND i.indisready
        AND i.indnkeyatts >= cardinality(c.conkey)
        AND NOT EXISTS (SELECT 1 FROM generate_subscripts(c.conkey,1) s
                        WHERE i.indkey[s-1] <> c.conkey[s])
        AND (i.indpred IS NULL OR
          (cardinality(c.conkey)=1 AND pg_get_expr(i.indpred,i.indrelid) =
            '(' || quote_ident((SELECT attname FROM pg_attribute
                 WHERE attrelid=c.conrelid AND attnum=c.conkey[1])) || ' IS NOT NULL)')))
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
    ('public.users'::regclass,'fk_users_suspended_by'::name,ARRAY['suspended_by']::name[]),
    ('public.admin_users'::regclass,'admin_users_created_by_fkey'::name,ARRAY['created_by']::name[]),
    ('public.system_configurations'::regclass,'system_configurations_updated_by_fkey'::name,ARRAY['updated_by']::name[]),
    ('public.feature_controls'::regclass,'feature_controls_updated_by_fkey'::name,ARRAY['updated_by']::name[]),
    ('public.user_access_overrides'::regclass,'user_access_overrides_updated_by_fkey'::name,ARRAY['updated_by']::name[])) AS e(tbl,constraint_name,cols)
      WHERE c.conrelid=e.tbl AND c.conname=e.constraint_name
        AND e.cols=ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord))
$$, 'Every foreign key column has a leading index');

SELECT is((SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%'),
          103, 'All 103 secondary indexes exist');

SELECT col_type_is('public', 'user_profiles', 'preferred_daily_hours', 'numeric(3,1)', 'preferred_daily_hours is numeric(3,1)');
SELECT col_type_is('public', 'skill_progress', 'learning_state', 'learning_state', 'learning_state is enum learning_state');
SELECT col_not_null('public', 'ai_requests', 'status', 'ai_requests.status is NOT NULL');
SELECT col_default_is('public', 'feature_controls', 'default_user_enabled', 'true', 'default_user_enabled defaults to true');
SELECT fk_ok('public', 'roadmaps', 'career_goal_id', 'public', 'career_goals', 'id', 'roadmaps.career_goal_id points to career_goals.id');
SELECT hasnt_column('public', 'skill_progress', 'job_ready', 'No job_ready column exists in skill_progress (PRD §36)');

SELECT * FROM finish();
ROLLBACK;

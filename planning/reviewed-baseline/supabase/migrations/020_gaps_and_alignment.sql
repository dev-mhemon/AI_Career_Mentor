BEGIN;
-- 020_gaps_and_alignment.sql
-- Purpose: Close API Spec v1.5.1 Gaps G1 (Ratings/Reports), G2 (Account Deletion Requests with ON DELETE SET NULL tombstone per ADR-020),
--          G3 (User Skill Alias Interpretations), seed AI SD v1.1.1 configurable limits,
--          enforce backend-mediated profile writes (ADR-019), and assert the 50-table catalog.

CREATE TYPE public.rating_target           AS ENUM ('roadmap_draft','roadmap_merge','topic_content','technology_update');
CREATE TYPE public.report_target           AS ENUM ('quiz_question','practice_review','topic_content','roadmap_content');
CREATE TYPE public.report_reason           AS ENUM ('incorrect','unclear','unfair_scoring','inappropriate','outdated','other');
CREATE TYPE public.deletion_request_status AS ENUM ('scheduled','in_progress','completed');

CREATE TABLE public.user_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  target_type public.rating_target NOT NULL,
  target_id   uuid NOT NULL,
  score       smallint NOT NULL,
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_ratings_user_target UNIQUE (user_id, target_type, target_id),
  CONSTRAINT ck_user_ratings_score CHECK (score BETWEEN 1 AND 5),
  CONSTRAINT ck_user_ratings_comment CHECK (comment IS NULL OR length(comment) <= 500)
);

CREATE TABLE public.content_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  target_type public.report_target NOT NULL,
  target_id   uuid NOT NULL,
  reason      public.report_reason NOT NULL,
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_content_reports_user_target UNIQUE (user_id, target_type, target_id),
  CONSTRAINT ck_content_reports_comment CHECK (comment IS NULL OR length(comment) <= 1000)
);

-- ADR-020: user_id uses ON DELETE SET NULL so an locally completed, temporarily pseudonymous status='completed' tombstone survives user cascade deletion
CREATE TABLE public.account_deletion_requests (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid REFERENCES public.users (id) ON DELETE SET NULL,
  status                      public.deletion_request_status NOT NULL DEFAULT 'scheduled',
  provider_deletion_requested boolean NOT NULL DEFAULT false,
  requested_at                timestamptz NOT NULL DEFAULT now(),
  completed_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_account_deletion_completed CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CONSTRAINT ck_account_deletion_active_user CHECK (status = 'completed' OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX uq_account_deletion_one_active
  ON public.account_deletion_requests (user_id) WHERE status IN ('scheduled','in_progress');

ALTER TABLE public.account_deletion_requests
  ADD COLUMN provider_cleanup jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN provider_cleanup_expires_at timestamptz;
ALTER TABLE public.account_deletion_requests ADD CONSTRAINT ck_provider_cleanup
  CHECK (jsonb_typeof(provider_cleanup)='array' AND
    octet_length(provider_cleanup::text)<=16384 AND
    (provider_cleanup='[]'::jsonb OR provider_cleanup_expires_at IS NOT NULL));
ALTER TABLE public.account_deletion_requests ADD CONSTRAINT ck_provider_cleanup_expiry
  CHECK (provider_cleanup_expires_at IS NULL OR
    provider_cleanup_expires_at <= requested_at + interval '30 days');
REVOKE SELECT ON public.account_deletion_requests FROM authenticated;

CREATE OR REPLACE FUNCTION private.complete_deletion_on_user_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.account_deletion_requests
     SET status = 'completed', completed_at = clock_timestamp()
   WHERE user_id = OLD.id AND status IN ('scheduled','in_progress');
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION private.complete_deletion_on_user_delete()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.complete_deletion_on_user_delete() TO service_role;
CREATE TRIGGER trg_users_complete_deletion
BEFORE DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION private.complete_deletion_on_user_delete();

CREATE TABLE public.user_skill_aliases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  input_alias      text NOT NULL,
  alias_normalized text NOT NULL,
  skill_id         uuid NOT NULL REFERENCES public.skills (id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_skill_aliases_norm UNIQUE (user_id, alias_normalized),
  CONSTRAINT ck_user_skill_aliases_len CHECK (length(btrim(input_alias)) BETWEEN 1 AND 80)
);

CREATE INDEX idx_user_ratings_target      ON public.user_ratings (target_type, target_id);
CREATE INDEX idx_content_reports_target   ON public.content_reports (target_type, target_id);
CREATE INDEX idx_user_skill_aliases_skill ON public.user_skill_aliases (skill_id);
CREATE INDEX idx_account_deletion_requests_user ON public.account_deletion_requests (user_id) WHERE user_id IS NOT NULL;

-- R27: all trusted writers MUST acquire the target advisory lock in a
-- preceding READ COMMITTED statement before INSERT (service protocol below).
CREATE OR REPLACE FUNCTION private.evaluate_content_report_threshold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_threshold integer;
  v_count     integer;
BEGIN
  SELECT COALESCE((SELECT (config_value #>> '{}')::integer
                   FROM public.system_configurations
                   WHERE config_key = 'quality.report_auto_hide_threshold'), 5)
    INTO v_threshold;

  SELECT count(DISTINCT user_id) INTO v_count
  FROM public.content_reports
  WHERE target_type = NEW.target_type AND target_id = NEW.target_id;

  IF v_count >= v_threshold THEN
    IF NEW.target_type = 'topic_content' THEN
      UPDATE public.topics
         SET status = 'hidden', hidden_at = COALESCE(hidden_at, now()),
             hidden_reason = COALESCE(hidden_reason, 'Auto-hidden: report threshold reached')
       WHERE id = NEW.target_id AND status <> 'hidden';
    ELSIF NEW.target_type = 'quiz_question' THEN
      UPDATE public.quiz_questions
         SET hidden_at = COALESCE(hidden_at, now()),
             hidden_reason = COALESCE(hidden_reason, 'Auto-hidden: report threshold reached')
       WHERE id = NEW.target_id AND hidden_at IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.evaluate_content_report_threshold() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.evaluate_content_report_threshold() TO service_role;

CREATE TRIGGER trg_user_ratings_updated_at BEFORE UPDATE ON public.user_ratings
  FOR EACH ROW EXECUTE FUNCTION private.update_updated_at_column();
CREATE TRIGGER trg_account_deletion_requests_updated_at BEFORE UPDATE ON public.account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION private.update_updated_at_column();
CREATE TRIGGER trg_user_skill_aliases_updated_at BEFORE UPDATE ON public.user_skill_aliases
  FOR EACH ROW EXECUTE FUNCTION private.update_updated_at_column();
CREATE TRIGGER trg_content_reports_append_only BEFORE UPDATE OR DELETE ON public.content_reports
  FOR EACH ROW EXECUTE FUNCTION private.prevent_row_modification();
CREATE TRIGGER trg_content_reports_threshold AFTER INSERT ON public.content_reports
  FOR EACH ROW EXECUTE FUNCTION private.evaluate_content_report_threshold();

-- ADR-019: revoke direct client writes on user_profiles and user_preferences
REVOKE INSERT, UPDATE ON public.user_profiles, public.user_preferences FROM authenticated;
DROP POLICY IF EXISTS user_profiles_owner_insert    ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_owner_update    ON public.user_profiles;
DROP POLICY IF EXISTS user_preferences_owner_insert ON public.user_preferences;
DROP POLICY IF EXISTS user_preferences_owner_update ON public.user_preferences;

ALTER TABLE public.user_ratings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_reports           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_skill_aliases        ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_ratings_owner_select ON public.user_ratings FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY content_reports_owner_select ON public.content_reports FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY account_deletion_requests_owner_select ON public.account_deletion_requests FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY user_skill_aliases_owner_select ON public.user_skill_aliases FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));

GRANT SELECT ON public.user_ratings, public.content_reports,
                public.account_deletion_requests, public.user_skill_aliases TO authenticated;
GRANT ALL ON public.user_ratings, public.content_reports,
             public.account_deletion_requests, public.user_skill_aliases TO service_role;
-- R35: final privilege after the earlier shared GRANT list.
REVOKE SELECT ON public.account_deletion_requests FROM authenticated;

INSERT INTO public.system_configurations (config_key, config_value, description) VALUES
  ('quality.report_auto_hide_threshold', '5'::jsonb,  'PRD §24: independent user reports required to auto-hide shared content'),
  ('roadmap.soft_size_max_topics',       '45'::jsonb, 'PRD §20: soft topic count guardrail before materially_large warning'),
  ('ai_quota.roadmap_drafts_per_24h',    '5'::jsonb,  'AI SD §15.1: default max roadmap draft generations per user per 24h'),
  ('ai_quota.mentor_messages_per_24h',   '50'::jsonb, 'AI SD §15.1: default max mentor chat messages per user per 24h')
ON CONFLICT (config_key) DO NOTHING;

-- Final 50-table catalog assertion gate
DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_tables WHERE schemaname = 'public';
  IF v_n <> 50 THEN RAISE EXCEPTION 'DMS 020 check: expected 50 tables, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public' AND t.typtype = 'e';
  IF v_n <> 45 THEN RAISE EXCEPTION 'DMS 020 check: expected 45 enums, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx\_%';
  IF v_n <> 103 THEN RAISE EXCEPTION 'DMS 020 check: expected 103 secondary indexes, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal;
  IF v_n <> 68 THEN RAISE EXCEPTION 'DMS 020 check: expected 68 triggers, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public';
  IF v_n <> 44 THEN RAISE EXCEPTION 'DMS 020 check: expected 44 policies, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'private';
  IF v_n <> 22 THEN RAISE EXCEPTION 'DMS 020 check: expected 22 private functions, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated') AND privilege_type IN ('INSERT','UPDATE','DELETE');
  IF v_n <> 0 THEN RAISE EXCEPTION 'DMS 020 check: client roles hold write/delete grants on % tables (violates ADR-019)', v_n; END IF;
END $$;
COMMIT;

SELECT current_setting('server_version_num')::int >= 160000 AS supported;
DO $$ BEGIN
 IF current_setting('server_version_num')::int < 160000 THEN RAISE EXCEPTION 'PostgreSQL16+ required'; END IF;
 IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION 'Supabase Auth foundation required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public') THEN RAISE EXCEPTION 'Public schema is not empty; fresh disposable database required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e') THEN RAISE EXCEPTION 'Public enums already exist'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated')
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN RAISE EXCEPTION 'Supabase roles required'; END IF;
END $$;
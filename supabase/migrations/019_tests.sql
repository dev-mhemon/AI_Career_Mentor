BEGIN;
-- 019_tests.sql
DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_tables WHERE schemaname = 'public';
  IF v_n <> 46 THEN RAISE EXCEPTION 'DMS check: expected 46 tables, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public' AND t.typtype = 'e';
  IF v_n <> 41 THEN RAISE EXCEPTION 'DMS check: expected 41 enums, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx\_%';
  IF v_n <> 99 THEN RAISE EXCEPTION 'DMS check: expected 99 secondary indexes, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal;
  IF v_n <> 62 THEN RAISE EXCEPTION 'DMS check: expected 62 triggers, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public';
  IF v_n <> 44 THEN RAISE EXCEPTION 'DMS check: expected 44 policies, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'private';
  IF v_n <> 20 THEN RAISE EXCEPTION 'DMS check: expected 20 private functions, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF v_n <> 0 THEN RAISE EXCEPTION 'DMS check: % tables without RLS', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p');
  IF v_n <> 0 THEN RAISE EXCEPTION 'DMS check: % tables without primary key', v_n; END IF;

  SELECT count(*) INTO v_n
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
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord));
  IF v_n <> 0 THEN RAISE EXCEPTION 'DMS check: % foreign keys without a leading index', v_n; END IF;

  SELECT count(*) INTO v_n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated') AND privilege_type = 'DELETE';
  IF v_n <> 0 THEN RAISE EXCEPTION 'DMS check: client roles hold DELETE on % tables', v_n; END IF;

  SELECT count(*) INTO v_n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee = 'anon';
  IF v_n <> 0 THEN RAISE EXCEPTION 'DMS check: anon holds % table grants', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.feature_controls;
  IF v_n <> 7 THEN RAISE EXCEPTION 'DMS check: expected 7 feature controls, found %', v_n; END IF;
END $$;
COMMIT;

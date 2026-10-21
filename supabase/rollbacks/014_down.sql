BEGIN;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx\_%')
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.indexname);
  END LOOP;
END $$;
COMMIT;

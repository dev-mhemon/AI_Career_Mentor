DO $$ BEGIN
IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public') THEN RAISE EXCEPTION 'Application tables remain';END IF;
END $$;
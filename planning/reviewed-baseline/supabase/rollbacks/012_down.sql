BEGIN;
DROP TABLE IF EXISTS public.admin_audit_logs, public.user_access_overrides,
  public.feature_controls, public.system_configurations, public.admin_users;
COMMIT;

BEGIN;
-- 012_administration.sql
CREATE TABLE public.admin_users (
  user_id    uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  role       public.admin_role NOT NULL DEFAULT 'platform_admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL
);

CREATE TABLE public.system_configurations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key   text NOT NULL,
  config_value jsonb NOT NULL,
  description  text,
  updated_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_system_configurations_key UNIQUE (config_key),
  CONSTRAINT ck_system_configurations_key CHECK (config_key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$')
);

ALTER TABLE public.system_configurations ADD CONSTRAINT ck_product_config_bounds
CHECK (CASE
 WHEN config_key='roadmap.max_active'
   THEN config_value='3'::jsonb
 WHEN config_key='career_goal.max_clarification_rounds'
   THEN config_value='2'::jsonb
 WHEN config_key='quiz.retry_limit' THEN config_value='1'::jsonb
 WHEN config_key='quiz.standard_mcq_count' THEN config_value='20'::jsonb
 WHEN config_key='quiz.standard_free_response_min' THEN config_value='5'::jsonb
 WHEN config_key='quiz.standard_free_response_max' THEN config_value='10'::jsonb
 WHEN config_key='technology_update.active_window_days' THEN config_value='7'::jsonb
 WHEN config_key IN ('retention.raw_response_days','retention.mentor_message_days',
                     'retention.ai_operational_log_days','career_knowledge.review_days') THEN
   CASE WHEN jsonb_typeof(config_value)='number' THEN
     (config_value #>> '{}')::numeric=trunc((config_value #>> '{}')::numeric)
     AND (config_value #>> '{}')::numeric BETWEEN 1 AND
       CASE WHEN config_key='retention.ai_operational_log_days' THEN 30 ELSE 90 END
   ELSE false END
 WHEN config_key='quality.report_auto_hide_threshold' THEN
   CASE WHEN jsonb_typeof(config_value)='number' THEN
     (config_value #>> '{}')::numeric=trunc((config_value #>> '{}')::numeric)
     AND (config_value #>> '{}')::numeric BETWEEN 2 AND 1000
   ELSE false END
 WHEN config_key IN ('roadmap.soft_size_max_topics',
                     'ai_quota.roadmap_drafts_per_24h',
                     'ai_quota.mentor_messages_per_24h') THEN
   CASE WHEN jsonb_typeof(config_value)='number' THEN
     (config_value #>> '{}')::numeric=trunc((config_value #>> '{}')::numeric)
     AND (config_value #>> '{}')::numeric BETWEEN 1 AND 10000
   ELSE false END
 ELSE true END);

CREATE TABLE public.feature_controls (
  feature_key          public.feature_key PRIMARY KEY,
  enabled              boolean NOT NULL DEFAULT true,
  default_user_enabled boolean NOT NULL DEFAULT true,
  updated_by           uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_access_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  feature_key public.feature_key NOT NULL,
  enabled     boolean NOT NULL,
  updated_by  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_access_overrides_pair UNIQUE (user_id, feature_key)
);

CREATE TABLE public.admin_audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        uuid REFERENCES public.users (id) ON DELETE SET NULL,
  action          text NOT NULL,
  target_type     text,
  target_id       uuid,
  target_user_id  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  before_state    jsonb,
  after_state     jsonb,
  http_request_id uuid,
  ip_address      inet,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_admin_audit_logs_action CHECK (length(btrim(action)) BETWEEN 1 AND 120)
);

COMMIT;

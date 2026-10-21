BEGIN;
-- 010_ai_operations.sql
CREATE TABLE public.ai_models (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key             text NOT NULL,
  model_identifier         text NOT NULL,
  display_name             text NOT NULL,
  input_price_per_m_units  numeric(14,6) NOT NULL DEFAULT 0,
  output_price_per_m_units numeric(14,6) NOT NULL DEFAULT 0,
  approved_tasks           public.ai_task[] NOT NULL DEFAULT '{}',
  real_user_data_approved  boolean NOT NULL DEFAULT false,
  fallback_rank            smallint,
  is_active                boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_models_identifier UNIQUE (provider_key, model_identifier),
  CONSTRAINT ck_ai_models_prices CHECK (input_price_per_m_units >= 0 AND output_price_per_m_units >= 0),
  CONSTRAINT ck_ai_models_rank CHECK (fallback_rank IS NULL OR fallback_rank >= 1),
  CONSTRAINT ck_ai_models_provider CHECK (provider_key ~ '^[a-z0-9][a-z0-9_-]*$')
);

CREATE TABLE public.prompt_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task             public.ai_task NOT NULL,
  name             text NOT NULL,
  version          integer NOT NULL,
  template_ref     text NOT NULL,
  template_hash    text NOT NULL,
  output_schema_id text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_prompt_versions_task_name_version UNIQUE (task, name, version),
  CONSTRAINT ck_prompt_versions_version CHECK (version >= 1)
);

CREATE TABLE public.ai_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES public.users (id) ON DELETE CASCADE,
  task              public.ai_task NOT NULL,
  feature_key       public.feature_key,
  job_kind          public.job_kind,
  is_async          boolean NOT NULL DEFAULT false,
  status            public.job_status NOT NULL DEFAULT 'queued',
  idempotency_key   text,
  subject_type      text,
  subject_id        uuid,
  result_type       text,
  result_id         uuid,
  error_code        text,
  error_message     text,
  retryable         boolean NOT NULL DEFAULT false,
  attempt_count     smallint NOT NULL DEFAULT 0,
  available_at      timestamptz NOT NULL DEFAULT now(),
  locked_at         timestamptz,
  locked_by         text,
  started_at        timestamptz,
  finished_at       timestamptz,
  http_request_id   uuid,
  language          public.ui_language,
  provider_key      text,
  model_id          uuid REFERENCES public.ai_models (id),
  fallback_used     boolean NOT NULL DEFAULT false,
  prompt_version_id uuid REFERENCES public.prompt_versions (id),
  input_units       bigint NOT NULL DEFAULT 0,
  output_units      bigint NOT NULL DEFAULT 0,
  total_units       bigint NOT NULL DEFAULT 0,
  cost_usd          numeric(14,8) NOT NULL DEFAULT 0,
  latency_ms        integer,
  validation_status public.ai_validation_status,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ai_requests_units CHECK (input_units >= 0 AND output_units >= 0 AND total_units >= 0),
  CONSTRAINT ck_ai_requests_cost CHECK (cost_usd >= 0),
  CONSTRAINT ck_ai_requests_attempts CHECK (attempt_count >= 0),
  CONSTRAINT ck_ai_requests_latency CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CONSTRAINT ck_ai_requests_finished CHECK ((status IN ('succeeded','failed')) = (finished_at IS NOT NULL)),
  CONSTRAINT ck_ai_requests_failed CHECK (status <> 'failed' OR error_code IS NOT NULL)
);
CREATE UNIQUE INDEX uq_ai_requests_idempotency
  ON public.ai_requests (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.ai_requests ADD COLUMN input_payload jsonb;
ALTER TABLE public.ai_requests ADD CONSTRAINT ck_ai_requests_input_payload
CHECK (input_payload IS NULL OR (
  jsonb_typeof(input_payload)='object' AND
  octet_length(input_payload::text) <= 32768));

CREATE TABLE public.ai_generations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        uuid REFERENCES public.ai_requests (id) ON DELETE SET NULL,
  task              public.ai_task NOT NULL,
  provider_key      text NOT NULL,
  model_id          uuid REFERENCES public.ai_models (id),
  prompt_version_id uuid REFERENCES public.prompt_versions (id),
  output_schema_id  text,
  validation_status public.ai_validation_status NOT NULL,
  fallback_used     boolean NOT NULL DEFAULT false,
  language          public.ui_language,
  input_units       bigint NOT NULL DEFAULT 0,
  output_units      bigint NOT NULL DEFAULT 0,
  total_units       bigint NOT NULL DEFAULT 0,
  cost_usd          numeric(14,8) NOT NULL DEFAULT 0,
  latency_ms        integer,
  output_hash       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ai_generations_units CHECK (input_units >= 0 AND output_units >= 0 AND total_units >= 0),
  CONSTRAINT ck_ai_generations_cost CHECK (cost_usd >= 0),
  CONSTRAINT ck_ai_generations_latency CHECK (latency_ms IS NULL OR latency_ms >= 0)
);
COMMIT;

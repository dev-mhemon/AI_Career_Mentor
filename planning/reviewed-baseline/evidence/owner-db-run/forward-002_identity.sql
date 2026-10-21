BEGIN;
-- 002_identity.sql
CREATE TABLE public.users (
  id               uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email            extensions.citext,
  phone            text,
  status           public.user_status NOT NULL DEFAULT 'active',
  status_reason    text,
  suspended_at     timestamptz,
  suspended_by     uuid,
  verified_contact boolean     NOT NULL DEFAULT false,
  last_active_at   timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_users_phone_format
    CHECK (phone IS NULL OR phone ~ '^\+8801[3-9][0-9]{8}$'),
  CONSTRAINT ck_users_email_length
    CHECK (email IS NULL OR length(email::text) <= 254),
  CONSTRAINT ck_users_suspension_consistent
    CHECK ((status = 'suspended') = (suspended_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_users_email ON public.users (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX uq_users_phone ON public.users (phone) WHERE phone IS NOT NULL;
COMMENT ON TABLE public.users IS 'Application account. Suspension preserves data; deletion cascades from here (PRD §13).';

CREATE TABLE public.user_auth_providers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  provider         public.auth_provider NOT NULL,
  provider_subject text NOT NULL,
  contact_value    text,
  verified_at      timestamptz,
  is_primary       boolean NOT NULL DEFAULT false,
  linked_at        timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_auth_providers_subject UNIQUE (provider, provider_subject),
  CONSTRAINT uq_user_auth_providers_user_provider UNIQUE (user_id, provider),
  CONSTRAINT ck_user_auth_providers_subject CHECK (length(btrim(provider_subject)) > 0)
);
CREATE UNIQUE INDEX uq_user_auth_providers_one_primary
  ON public.user_auth_providers (user_id) WHERE is_primary;

COMMIT;

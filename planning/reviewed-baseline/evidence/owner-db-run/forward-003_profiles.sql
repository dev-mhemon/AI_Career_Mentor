BEGIN;
-- 003_profiles.sql
CREATE TABLE public.user_profiles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  current_role_title      text,
  education               text,
  experience_level        public.experience_level,
  self_reported_skill_ids uuid[]  NOT NULL DEFAULT '{}',
  existing_skills_none    boolean NOT NULL DEFAULT false,
  preferred_daily_hours   numeric(3,1),
  timezone                text,
  timezone_detected       boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_profiles_user UNIQUE (user_id),
  CONSTRAINT ck_user_profiles_role_len CHECK (current_role_title IS NULL OR length(current_role_title) <= 120),
  CONSTRAINT ck_user_profiles_education_len CHECK (education IS NULL OR length(education) <= 200),
  CONSTRAINT ck_user_profiles_hours
    CHECK (preferred_daily_hours IS NULL OR
           (preferred_daily_hours BETWEEN 0.5 AND 12 AND preferred_daily_hours * 2 = trunc(preferred_daily_hours * 2))),
  CONSTRAINT ck_user_profiles_skills_none
    CHECK (NOT (existing_skills_none AND cardinality(self_reported_skill_ids) > 0)),
  CONSTRAINT ck_user_profiles_skills_cap CHECK (cardinality(self_reported_skill_ids) <= 100)
);

CREATE TABLE public.user_preferences (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  learning_preference text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_preferences_user UNIQUE (user_id),
  CONSTRAINT ck_user_preferences_learning
    CHECK (learning_preference IS NULL OR learning_preference IN ('reading','hands_on','visual','mixed'))
);

COMMIT;

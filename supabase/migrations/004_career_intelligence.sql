BEGIN;
-- 004_career_intelligence.sql
CREATE TABLE public.career_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL,
  name        text NOT NULL,
  description text,
  aliases     text[] NOT NULL DEFAULT '{}',
  status      public.content_status NOT NULL DEFAULT 'approved',
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_career_roles_slug UNIQUE (slug),
  CONSTRAINT ck_career_roles_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE public.skill_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL,
  name       text NOT NULL,
  parent_id  uuid REFERENCES public.skill_categories (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_skill_categories_slug UNIQUE (slug),
  CONSTRAINT ck_skill_categories_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT ck_skill_categories_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE TABLE public.skills (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL,
  canonical_name text NOT NULL,
  category_id    uuid REFERENCES public.skill_categories (id),
  description    text,
  status         public.content_status NOT NULL DEFAULT 'approved',
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_skills_slug UNIQUE (slug),
  CONSTRAINT ck_skills_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT ck_skills_name CHECK (length(btrim(canonical_name)) BETWEEN 1 AND 120)
);

CREATE TABLE public.skill_aliases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id         uuid NOT NULL REFERENCES public.skills (id) ON DELETE CASCADE,
  alias            text NOT NULL,
  alias_normalized text NOT NULL,
  status           public.alias_status NOT NULL DEFAULT 'candidate',
  source           text NOT NULL DEFAULT 'seed',
  validated_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_skill_aliases_source CHECK (source IN ('seed','ai_candidate','validated_review')),
  CONSTRAINT ck_skill_aliases_validated_ts CHECK ((status = 'validated') = (validated_at IS NOT NULL)),
  CONSTRAINT ck_skill_aliases_alias CHECK (length(btrim(alias)) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX uq_skill_aliases_validated ON public.skill_aliases (alias_normalized) WHERE status = 'validated';
CREATE UNIQUE INDEX uq_skill_aliases_skill_alias ON public.skill_aliases (skill_id, alias_normalized);

CREATE TABLE public.skill_dependencies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id            uuid NOT NULL REFERENCES public.skills (id) ON DELETE CASCADE,
  depends_on_skill_id uuid NOT NULL REFERENCES public.skills (id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_skill_dependencies_pair UNIQUE (skill_id, depends_on_skill_id),
  CONSTRAINT ck_skill_dependencies_no_self CHECK (skill_id <> depends_on_skill_id)
);

CREATE TABLE public.career_goals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  goal_text              text NOT NULL,
  status                 public.goal_status NOT NULL DEFAULT 'clarifying',
  clarification_round    smallint NOT NULL DEFAULT 0,
  clarification_question text,
  clarifications         jsonb NOT NULL DEFAULT '[]',
  proposed_role_id       uuid REFERENCES public.career_roles (id),
  alternative_role_ids   uuid[] NOT NULL DEFAULT '{}',
  suggested_level        public.career_level,
  target_level           public.career_level,
  confirmed_role_id      uuid REFERENCES public.career_roles (id),
  confirmed_at           timestamptz,
  discontinued_at        timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_career_goals_text_len CHECK (length(btrim(goal_text)) BETWEEN 3 AND 300),
  CONSTRAINT ck_career_goals_round CHECK (clarification_round BETWEEN 0 AND 2),
  CONSTRAINT ck_career_goals_clarifications CHECK (jsonb_typeof(clarifications) = 'array'),
  CONSTRAINT ck_career_goals_confirmed
    CHECK (status <> 'confirmed' OR (confirmed_role_id IS NOT NULL AND target_level IS NOT NULL AND confirmed_at IS NOT NULL)),
  CONSTRAINT ck_career_goals_discontinued CHECK ((status = 'discontinued') = (discontinued_at IS NOT NULL))
);
COMMIT;

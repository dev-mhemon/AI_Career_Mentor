BEGIN;
-- 006_learning.sql
CREATE TABLE public.topics (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id              uuid NOT NULL REFERENCES public.skills (id),
  slug                  text NOT NULL,
  title                 text NOT NULL,
  career_level          public.career_level NOT NULL,
  content_version       integer NOT NULL DEFAULT 1,
  status                public.content_status NOT NULL DEFAULT 'draft',
  explanation_markdown  text,
  important_questions   jsonb NOT NULL DEFAULT '[]',
  language              public.ui_language NOT NULL DEFAULT 'mixed',
  ai_generation_id      uuid,
  approved_at           timestamptz,
  hidden_at             timestamptz,
  hidden_reason         text,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_topics_version UNIQUE (skill_id, slug, career_level, content_version),
  CONSTRAINT ck_topics_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT ck_topics_version CHECK (content_version >= 1),
  CONSTRAINT ck_topics_questions CHECK (jsonb_typeof(important_questions) = 'array'),
  CONSTRAINT ck_topics_approved
    CHECK (status <> 'approved' OR (explanation_markdown IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT ck_topics_hidden CHECK ((status = 'hidden') = (hidden_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_topics_one_approved ON public.topics (skill_id, slug, career_level)
  WHERE status = 'approved' AND deleted_at IS NULL;

CREATE TABLE public.learning_resources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id      uuid NOT NULL REFERENCES public.topics (id) ON DELETE CASCADE,
  title         text NOT NULL,
  publisher     text NOT NULL,
  url           text NOT NULL,
  resource_type public.resource_type NOT NULL DEFAULT 'official_docs',
  retrieved_at  timestamptz,
  status        public.content_status NOT NULL DEFAULT 'approved',
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_learning_resources_url CHECK (url ~* '^https?://')
);

CREATE TABLE public.daily_plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  roadmap_id         uuid NOT NULL REFERENCES public.roadmaps (id) ON DELETE CASCADE,
  hours_per_day      numeric(3,1) NOT NULL,
  status             public.plan_status NOT NULL DEFAULT 'active',
  roadmap_version_id uuid,
  plan_revision      integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_daily_plans_roadmap UNIQUE (roadmap_id),
  CONSTRAINT ck_daily_plans_hours
    CHECK (hours_per_day BETWEEN 0.5 AND 12 AND hours_per_day * 2 = trunc(hours_per_day * 2)),
  CONSTRAINT ck_daily_plans_revision CHECK (plan_revision >= 1)
);

CREATE TABLE public.daily_plan_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                uuid NOT NULL REFERENCES public.daily_plans (id) ON DELETE CASCADE,
  user_id                uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  day_no                 integer NOT NULL,
  sort_order             smallint NOT NULL DEFAULT 1,
  lineage_id             uuid NOT NULL,
  topic_id               uuid NOT NULL REFERENCES public.topics (id),
  allocated_hours        numeric(4,1),
  status                 public.plan_item_status NOT NULL DEFAULT 'pending',
  started_at             timestamptz,
  completed_at           timestamptz,
  reconciled_by_merge_id uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_daily_plan_items_slot UNIQUE (plan_id, day_no, sort_order),
  CONSTRAINT uq_daily_plan_items_lineage UNIQUE (plan_id, lineage_id),
  CONSTRAINT ck_daily_plan_items_day CHECK (day_no >= 1),
  CONSTRAINT ck_daily_plan_items_sort CHECK (sort_order >= 1),
  CONSTRAINT ck_daily_plan_items_hours CHECK (allocated_hours IS NULL OR allocated_hours > 0),
  CONSTRAINT ck_daily_plan_items_completed CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

COMMIT;

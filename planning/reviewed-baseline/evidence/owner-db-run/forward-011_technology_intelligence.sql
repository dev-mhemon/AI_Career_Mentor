BEGIN;
-- 011_technology_intelligence.sql
CREATE TABLE public.technology_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_technology_categories_slug UNIQUE (slug),
  CONSTRAINT ck_technology_categories_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE public.technologies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid REFERENCES public.technology_categories (id),
  skill_id     uuid REFERENCES public.skills (id),
  slug         text NOT NULL,
  name         text NOT NULL,
  official_url text,
  status       public.content_status NOT NULL DEFAULT 'approved',
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_technologies_slug UNIQUE (slug),
  CONSTRAINT ck_technologies_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT ck_technologies_url CHECK (official_url IS NULL OR official_url ~* '^https?://')
);

CREATE TABLE public.technology_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  publisher   text NOT NULL,
  base_url    text NOT NULL,
  source_type public.technology_source_type NOT NULL,
  trust_tier  smallint NOT NULL DEFAULT 2,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_technology_sources_base_url UNIQUE (base_url),
  CONSTRAINT ck_technology_sources_tier CHECK (trust_tier BETWEEN 1 AND 3),
  CONSTRAINT ck_technology_sources_url CHECK (base_url ~* '^https?://')
);

CREATE TABLE public.technology_updates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technology_id    uuid REFERENCES public.technologies (id),
  source_id        uuid REFERENCES public.technology_sources (id),
  title            text NOT NULL,
  what_changed     text NOT NULL,
  publisher        text NOT NULL,
  source_url       text NOT NULL,
  fetched_at       timestamptz NOT NULL,
  published_at     timestamptz,
  release_status   public.release_status NOT NULL,
  content_hash     text NOT NULL,
  ai_generation_id uuid REFERENCES public.ai_generations (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_technology_updates_hash UNIQUE (content_hash),
  CONSTRAINT ck_technology_updates_url CHECK (source_url ~* '^https?://')
);

CREATE TABLE public.user_update_relevance (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  update_id        uuid NOT NULL REFERENCES public.technology_updates (id) ON DELETE CASCADE,
  relevance        public.relevance_level NOT NULL,
  action_timing    public.action_timing NOT NULL,
  why_it_matters   text NOT NULL,
  roadmap_relation text,
  focus_roadmap_id uuid REFERENCES public.roadmaps (id) ON DELETE SET NULL,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_update_relevance_pair UNIQUE (user_id, update_id)
);

CREATE TABLE public.update_delivery_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  update_id    uuid REFERENCES public.technology_updates (id),
  local_date   date NOT NULL,
  state        public.update_state NOT NULL DEFAULT 'available',
  delivered_at timestamptz NOT NULL DEFAULT now(),
  viewed_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_update_delivery_user_date UNIQUE (user_id, local_date),
  CONSTRAINT ck_update_delivery_state CHECK ((state = 'available') = (update_id IS NOT NULL)),
  CONSTRAINT ck_update_delivery_viewed CHECK (viewed_at IS NULL OR update_id IS NOT NULL)
);
CREATE UNIQUE INDEX uq_update_delivery_user_update
  ON public.update_delivery_history (user_id, update_id) WHERE update_id IS NOT NULL;

COMMIT;

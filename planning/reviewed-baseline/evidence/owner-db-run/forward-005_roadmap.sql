BEGIN;
-- 005_roadmap.sql
CREATE TABLE public.roadmaps (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  career_goal_id     uuid NOT NULL REFERENCES public.career_goals (id) ON DELETE CASCADE,
  canonical_role_id  uuid NOT NULL REFERENCES public.career_roles (id),
  target_level       public.career_level NOT NULL,
  status             public.roadmap_status NOT NULL DEFAULT 'draft',
  is_focus           boolean NOT NULL DEFAULT false,
  current_version_id uuid,
  locked_at          timestamptz,
  archived_at        timestamptz,
  archive_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_roadmaps_goal UNIQUE (career_goal_id),
  CONSTRAINT ck_roadmaps_focus_requires_locked CHECK (NOT is_focus OR status = 'locked'),
  CONSTRAINT ck_roadmaps_locked_has_version CHECK (status <> 'locked' OR current_version_id IS NOT NULL),
  CONSTRAINT ck_roadmaps_archived_ts CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_roadmaps_one_focus ON public.roadmaps (user_id) WHERE is_focus;

CREATE TABLE public.roadmap_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id       uuid NOT NULL REFERENCES public.roadmaps (id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  version_no       integer NOT NULL,
  state            public.roadmap_version_state NOT NULL DEFAULT 'draft',
  created_by       public.roadmap_version_origin NOT NULL,
  target_level     public.career_level NOT NULL,
  base_version_id  uuid,
  merge_id         uuid,
  summary          jsonb NOT NULL DEFAULT '{}',
  phases           jsonb NOT NULL DEFAULT '[]',
  level_outline    jsonb NOT NULL DEFAULT '[]',
  warnings         jsonb NOT NULL DEFAULT '[]',
  stale            boolean NOT NULL DEFAULT false,
  stale_reason     text,
  context_hash     text,
  ai_generation_id uuid,
  locked_at        timestamptz,
  superseded_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_roadmap_versions_no UNIQUE (roadmap_id, version_no),
  CONSTRAINT ck_roadmap_versions_no CHECK (version_no >= 1),
  CONSTRAINT ck_roadmap_versions_locked_ts CHECK (state NOT IN ('locked','restored') OR locked_at IS NOT NULL),
  CONSTRAINT ck_roadmap_versions_json
    CHECK (jsonb_typeof(summary) = 'object' AND jsonb_typeof(phases) = 'array'
           AND jsonb_typeof(level_outline) = 'array' AND jsonb_typeof(warnings) = 'array')
);
CREATE UNIQUE INDEX uq_roadmap_versions_one_draft ON public.roadmap_versions (roadmap_id) WHERE state = 'draft';

CREATE TABLE public.roadmap_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id              uuid NOT NULL REFERENCES public.roadmap_versions (id) ON DELETE CASCADE,
  user_id                 uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  lineage_id              uuid NOT NULL DEFAULT gen_random_uuid(),
  topic_id                uuid NOT NULL,
  skill_id                uuid NOT NULL REFERENCES public.skills (id),
  phase_no                smallint NOT NULL DEFAULT 1,
  phase_title             text,
  title                   text NOT NULL,
  priority                public.item_priority NOT NULL,
  gap_type                public.skill_gap_type NOT NULL,
  required_depth          text,
  estimated_effort_hours  numeric(5,1),
  sequence_no             integer NOT NULL,
  depends_on_lineage_ids  uuid[] NOT NULL DEFAULT '{}',
  reason                  text,
  retired                 boolean NOT NULL DEFAULT false,
  retired_at              timestamptz,
  sources                 jsonb NOT NULL DEFAULT '[]',
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_roadmap_items_lineage UNIQUE (version_id, lineage_id),
  CONSTRAINT uq_roadmap_items_topic UNIQUE (version_id, topic_id),
  CONSTRAINT uq_roadmap_items_sequence UNIQUE (version_id, sequence_no),
  CONSTRAINT ck_roadmap_items_effort CHECK (estimated_effort_hours IS NULL OR estimated_effort_hours >= 0),
  CONSTRAINT ck_roadmap_items_sequence CHECK (sequence_no >= 1),
  CONSTRAINT ck_roadmap_items_phase CHECK (phase_no >= 1),
  CONSTRAINT ck_roadmap_items_retired CHECK (retired = (retired_at IS NOT NULL)),
  CONSTRAINT ck_roadmap_items_sources CHECK (jsonb_typeof(sources) = 'array')
);

CREATE TABLE public.roadmap_merges (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id             uuid NOT NULL REFERENCES public.roadmaps (id) ON DELETE CASCADE,
  user_id                uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  origin                 public.merge_origin NOT NULL,
  status                 public.merge_status NOT NULL DEFAULT 'proposed',
  base_version_id        uuid NOT NULL,
  result_version_id      uuid,
  target_level           public.career_level,
  instruction            text,
  reason                 text,
  size_before            integer,
  size_after             integer,
  materially_large       boolean NOT NULL DEFAULT false,
  daily_plan_impact      jsonb NOT NULL DEFAULT '{}',
  undo_snapshot          jsonb,
  ai_generation_id       uuid,
  accepted_at            timestamptz,
  rejected_at            timestamptz,
  undone_at              timestamptz,
  undo_window_closed_at  timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_roadmap_merges_level_change CHECK (origin <> 'level_change' OR target_level IS NOT NULL),
  CONSTRAINT ck_roadmap_merges_instruction CHECK (instruction IS NULL OR length(instruction) <= 1000),
  CONSTRAINT ck_roadmap_merges_sizes
    CHECK ((size_before IS NULL OR size_before >= 0) AND (size_after IS NULL OR size_after >= 0)),
  CONSTRAINT ck_roadmap_merges_accepted_ts CHECK ((status IN ('accepted','undone')) = (accepted_at IS NOT NULL)),
  CONSTRAINT ck_roadmap_merges_rejected_ts CHECK ((status = 'rejected') = (rejected_at IS NOT NULL)),
  CONSTRAINT ck_roadmap_merges_undone_ts CHECK ((status = 'undone') = (undone_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_roadmap_merges_one_open ON public.roadmap_merges (roadmap_id) WHERE status = 'proposed';
CREATE UNIQUE INDEX uq_roadmap_merges_one_undoable ON public.roadmap_merges (roadmap_id)
  WHERE status = 'accepted' AND undo_window_closed_at IS NULL;

CREATE TABLE public.roadmap_merge_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merge_id    uuid NOT NULL REFERENCES public.roadmap_merges (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  sort_order  smallint NOT NULL,
  op          public.merge_op NOT NULL,
  lineage_id  uuid,
  topic_id    uuid,
  title       text,
  priority    public.item_priority,
  reason      text,
  payload     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_roadmap_merge_items_order UNIQUE (merge_id, sort_order),
  CONSTRAINT ck_roadmap_merge_items_order CHECK (sort_order >= 1),
  CONSTRAINT ck_roadmap_merge_items_add CHECK (op <> 'add_topic' OR topic_id IS NOT NULL),
  CONSTRAINT ck_roadmap_merge_items_target CHECK (op = 'add_topic' OR lineage_id IS NOT NULL)
);

COMMIT;

BEGIN;
-- 008_progress.sql
CREATE TABLE public.learning_evidence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  skill_id          uuid NOT NULL REFERENCES public.skills (id),
  career_level      public.career_level NOT NULL,
  roadmap_id        uuid REFERENCES public.roadmaps (id),
  topic_id          uuid NOT NULL REFERENCES public.topics (id),
  source_type       public.evidence_source NOT NULL,
  source_id         uuid NOT NULL,
  difficulty        public.question_difficulty NOT NULL,
  score_summary     jsonb NOT NULL,
  performance_level public.performance_level,
  attempt_no        smallint NOT NULL,
  occurred_at       timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_learning_evidence_source UNIQUE (source_type, source_id, skill_id),
  CONSTRAINT ck_learning_evidence_attempt CHECK (attempt_no BETWEEN 1 AND 2),
  CONSTRAINT ck_learning_evidence_score CHECK (jsonb_typeof(score_summary) = 'object')
);

CREATE TABLE public.skill_progress (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  skill_id         uuid NOT NULL REFERENCES public.skills (id),
  career_level     public.career_level NOT NULL,
  learning_state   public.learning_state NOT NULL DEFAULT 'not_started',
  state_reason     text,
  last_evidence_at timestamptz,
  evidence_count   integer NOT NULL DEFAULT 0,
  state_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_skill_progress_user_skill_level UNIQUE (user_id, skill_id, career_level),
  CONSTRAINT ck_skill_progress_count CHECK (evidence_count >= 0),
  CONSTRAINT ck_skill_progress_reason CHECK (learning_state = 'not_started' OR state_reason IS NOT NULL)
);

CREATE TABLE public.achievement_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  skill_id     uuid NOT NULL REFERENCES public.skills (id),
  career_level public.career_level NOT NULL,
  event_type   public.progress_event_type NOT NULL,
  from_state   public.learning_state,
  to_state     public.learning_state,
  reason       text,
  source_type  public.evidence_source,
  source_id    uuid,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_achievement_history_change
    CHECK (event_type <> 'state_change' OR (to_state IS NOT NULL AND from_state IS DISTINCT FROM to_state))
);
COMMIT;

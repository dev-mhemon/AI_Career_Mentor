BEGIN;
-- 007_assessment.sql
CREATE TABLE public.quizzes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id             uuid NOT NULL REFERENCES public.topics (id),
  content_version      integer NOT NULL DEFAULT 1,
  variant_no           smallint NOT NULL DEFAULT 1,
  status               public.content_status NOT NULL DEFAULT 'draft',
  mcq_count            smallint NOT NULL,
  free_response_count  smallint NOT NULL,
  is_reduced           boolean NOT NULL DEFAULT false,
  ai_generation_id     uuid,
  approved_at          timestamptz,
  hidden_at            timestamptz,
  hidden_reason        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_quizzes_version UNIQUE (topic_id, content_version, variant_no),
  CONSTRAINT ck_quizzes_variant CHECK (variant_no IN (1,2)),
  CONSTRAINT ck_quizzes_counts CHECK (mcq_count >= 0 AND free_response_count >= 0),
  CONSTRAINT ck_quizzes_standard_size
    CHECK (is_reduced OR variant_no = 2 OR (mcq_count = 20 AND free_response_count BETWEEN 5 AND 10)),
  CONSTRAINT ck_quizzes_hidden CHECK ((status = 'hidden') = (hidden_at IS NOT NULL))
);

CREATE TABLE public.quiz_questions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id           uuid NOT NULL REFERENCES public.quizzes (id) ON DELETE CASCADE,
  sort_order        smallint NOT NULL,
  question_type     public.question_type NOT NULL,
  difficulty        public.question_difficulty NOT NULL,
  prompt            text NOT NULL,
  options           jsonb,
  correct_option_id text,
  explanation       text,
  rubric            jsonb,
  response_hint     text,
  max_length        integer,
  allow_i_dont_know boolean NOT NULL DEFAULT true,
  hidden_at         timestamptz,
  hidden_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_quiz_questions_order UNIQUE (quiz_id, sort_order),
  CONSTRAINT ck_quiz_questions_order CHECK (sort_order >= 1),
  CONSTRAINT ck_quiz_questions_mcq
    CHECK (question_type <> 'mcq' OR
           (options IS NOT NULL AND jsonb_typeof(options) = 'array'
            AND jsonb_array_length(options) BETWEEN 2 AND 6
            AND correct_option_id IS NOT NULL
            AND jsonb_path_exists(options, '$[*] ? (@.option_id == $id)',
                                  jsonb_build_object('id', correct_option_id)))),
  CONSTRAINT ck_quiz_questions_free_response CHECK (question_type <> 'free_response' OR rubric IS NOT NULL),
  CONSTRAINT ck_quiz_questions_max_length CHECK (max_length IS NULL OR max_length BETWEEN 1 AND 8000),
  CONSTRAINT ck_quiz_questions_hidden CHECK ((hidden_at IS NULL) = (hidden_reason IS NULL))
);

CREATE TABLE public.quiz_attempts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  daily_plan_item_id          uuid NOT NULL REFERENCES public.daily_plan_items (id) ON DELETE CASCADE,
  quiz_id                     uuid NOT NULL REFERENCES public.quizzes (id),
  attempt_no                  smallint NOT NULL DEFAULT 1,
  retry_of_attempt_id         uuid REFERENCES public.quiz_attempts (id),
  status                      public.attempt_status NOT NULL DEFAULT 'generated',
  question_ids                uuid[] NOT NULL,
  started_at                  timestamptz,
  submitted_at                timestamptz,
  reviewed_at                 timestamptz,
  mcq_correct                 smallint,
  mcq_total                   smallint,
  performance_level           public.performance_level,
  improvement_recommendations jsonb NOT NULL DEFAULT '[]',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_quiz_attempts_item_no UNIQUE (daily_plan_item_id, attempt_no),
  CONSTRAINT ck_quiz_attempts_no CHECK (attempt_no BETWEEN 1 AND 2),
  CONSTRAINT ck_quiz_attempts_retry CHECK ((attempt_no = 1) = (retry_of_attempt_id IS NULL)),
  CONSTRAINT ck_quiz_attempts_questions CHECK (cardinality(question_ids) > 0),
  CONSTRAINT ck_quiz_attempts_score
    CHECK (mcq_correct IS NULL OR (mcq_total IS NOT NULL AND mcq_correct BETWEEN 0 AND mcq_total)),
  CONSTRAINT ck_quiz_attempts_started
    CHECK (status = 'generated' OR started_at IS NOT NULL),
  CONSTRAINT ck_quiz_attempts_submitted
    CHECK (status NOT IN ('submitted','ai_reviewed','feedback_available') OR submitted_at IS NOT NULL),
  CONSTRAINT ck_quiz_attempts_reviewed
    CHECK (status NOT IN ('ai_reviewed','feedback_available') OR reviewed_at IS NOT NULL),
  CONSTRAINT ck_quiz_attempts_recs CHECK (jsonb_typeof(improvement_recommendations) = 'array')
);

CREATE TABLE public.quiz_answers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id          uuid NOT NULL REFERENCES public.quiz_attempts (id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  question_id         uuid NOT NULL REFERENCES public.quiz_questions (id),
  selected_option_id  text,
  answer_text         text,
  i_dont_know         boolean NOT NULL DEFAULT false,
  is_correct          boolean,
  saved_at            timestamptz NOT NULL DEFAULT now(),
  raw_text_expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  raw_text_purged_at  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_quiz_answers_attempt_question UNIQUE (attempt_id, question_id),
  CONSTRAINT ck_quiz_answers_idk CHECK (NOT i_dont_know OR (selected_option_id IS NULL AND answer_text IS NULL)),
  CONSTRAINT ck_quiz_answers_exclusive CHECK (selected_option_id IS NULL OR answer_text IS NULL),
  CONSTRAINT ck_quiz_answers_text_len CHECK (answer_text IS NULL OR length(answer_text) <= 8000),
  CONSTRAINT ck_quiz_answers_purged CHECK (raw_text_purged_at IS NULL OR answer_text IS NULL)
);

CREATE TABLE public.practice_reviews (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  attempt_id                  uuid NOT NULL REFERENCES public.quiz_attempts (id) ON DELETE CASCADE,
  answer_id                   uuid NOT NULL REFERENCES public.quiz_answers (id) ON DELETE CASCADE,
  question_id                 uuid NOT NULL REFERENCES public.quiz_questions (id),
  review_status               public.review_status NOT NULL DEFAULT 'pending',
  performance_level           public.performance_level,
  dimensions                  jsonb,
  strengths                   jsonb NOT NULL DEFAULT '[]',
  mistakes                    jsonb NOT NULL DEFAULT '[]',
  weaknesses                  jsonb NOT NULL DEFAULT '[]',
  improvement_recommendations jsonb NOT NULL DEFAULT '[]',
  evidence_eligible           boolean NOT NULL DEFAULT false,
  ai_generation_id            uuid,
  failure_code                text,
  reviewed_at                 timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_practice_reviews_answer UNIQUE (answer_id),
  CONSTRAINT ck_practice_reviews_reviewed
    CHECK (review_status <> 'reviewed' OR (performance_level IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT ck_practice_reviews_evidence CHECK (NOT evidence_eligible OR review_status = 'reviewed'),
  CONSTRAINT ck_practice_reviews_dimensions CHECK (dimensions IS NULL OR jsonb_typeof(dimensions) = 'object')
);
COMMIT;

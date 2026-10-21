BEGIN;
-- 009_ai_mentor.sql
CREATE TABLE public.conversations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  context_type          public.conversation_context NOT NULL DEFAULT 'general',
  roadmap_id            uuid REFERENCES public.roadmaps (id) ON DELETE SET NULL,
  topic_id              uuid REFERENCES public.topics (id) ON DELETE SET NULL,
  title                 text,
  last_message_at       timestamptz,
  summarized_through_at timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_conversations_topic_context CHECK (context_type <> 'topic' OR topic_id IS NOT NULL),
  CONSTRAINT ck_conversations_title CHECK (title IS NULL OR length(title) <= 200)
);

CREATE TABLE public.messages (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id         uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  user_id                 uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  role                    public.message_role NOT NULL,
  content                 text NOT NULL,
  language                public.ui_language NOT NULL DEFAULT 'mixed',
  client_message_id       uuid,
  reply_to_message_id     uuid REFERENCES public.messages (id) ON DELETE SET NULL,
  safety_mode             boolean NOT NULL DEFAULT false,
  learning_claim_recorded boolean NOT NULL DEFAULT false,
  ai_generation_id        uuid,
  expires_at              timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_messages_length CHECK (length(content) BETWEEN 1 AND 16000 AND (role = 'assistant' OR length(content) <= 4000)),
  CONSTRAINT ck_messages_client_id CHECK (client_message_id IS NULL OR role = 'user')
);
CREATE UNIQUE INDEX uq_messages_client_message
  ON public.messages (conversation_id, client_message_id) WHERE client_message_id IS NOT NULL;

CREATE TABLE public.conversation_summaries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  version_no       integer NOT NULL,
  summary_text     text NOT NULL,
  covers_until     timestamptz NOT NULL,
  ai_generation_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_conversation_summaries_version UNIQUE (conversation_id, version_no),
  CONSTRAINT ck_conversation_summaries_version CHECK (version_no >= 1),
  CONSTRAINT ck_conversation_summaries_text CHECK (length(summary_text) BETWEEN 1 AND 8000)
);

CREATE TABLE public.ai_context_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  context_type public.ai_context_type NOT NULL,
  scope_key    text NOT NULL DEFAULT '',
  summary_text text NOT NULL,
  source_ref   jsonb NOT NULL DEFAULT '{}',
  version      integer NOT NULL DEFAULT 1,
  valid_until  timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_context_records_scope UNIQUE (user_id, context_type, scope_key),
  CONSTRAINT ck_ai_context_records_version CHECK (version >= 1),
  CONSTRAINT ck_ai_context_records_text CHECK (length(summary_text) BETWEEN 1 AND 8000),
  CONSTRAINT ck_ai_context_records_source CHECK (jsonb_typeof(source_ref) = 'object')
);
COMMIT;

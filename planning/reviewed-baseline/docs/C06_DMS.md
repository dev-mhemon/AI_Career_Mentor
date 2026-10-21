# AI Career Intelligence Mentor

# Database Migration SQL Package (DMS) v1.2.2

## Complete Enterprise Database Implementation & Operations Handoff Package Edition

| Item | Value |
|---|---|
| **Supersedes** | DMS v1.1, DMS v1.2, DMS v1.2.1 |
| **Baseline** | PRD v1.4.1 · SAD v1.1.1 (ADRs 001–020) · DDD v1.2.2 · DIS v1.1.1 · API Specification v1.5.1 |
| **Task type** | Complete executable SQL implementation, Gap G1–G3 closure, pgTAP repair, and operational runbooks. |
| **Preserved** | Base migrations `000`–`019` · `user_id = (SELECT auth.uid())` ownership model · Supabase architecture |
| **Status** | **Complete Executable Repository Handoff (50 Tables, 45 Enums, 21 Migrations `000`–`020`).** Production freeze unlocks upon passing the automated CI pipeline in §19 per `ADR-020`. |

---

# 1. Overview

## 1.1 What DMS v1.2.2 Delivers

| Area | Specification |
|---|---|
| **Migrations (`000`–`020`)** | 21 sequential transactional migration files creating **50 tables** across 11 domains and **45 custom enums** |
| **Constraints & Indexes** | Full constraint catalog (§7) + **103 secondary indexes** (§8) with leading FK coverage with the named E01 exceptions; installed-catalog execution pending |
| **Functions & Triggers** | **22 `private.*` functions** (`SET search_path = ''`) (§9) and **68 triggers** across 5 families (§10) |
| **Row Level Security** | Universal RLS enabled on all **50 tables**, **44 policies**, and backend-mediated writes per `ADR-019` (§11) |
| **Seeds** | Production reference taxonomy, 7 feature controls, and 15 configurable system parameters (§12) |
| **Automated Test Suite** | 19 in-migration assertions (`019`+`020`) + **185 pgTAP assertions** across `001`–`008` with valid hex UUIDs (§13) |
| **Rollbacks & Runbooks** | 21 reversible down-migrations (`020_down.sql`–`000_down.sql`) (§16) + Deployment, PITR, CI/CD, and Autovacuum Runbooks (§17–§20) |

## 1.2 Complete 50-Table Inventory

| # | Table | Domain | Ownership | Migration |
|---|---|---|---|---|
| 1 | `users` | Identity | user-owned (`id`) | 002 |
| 2 | `user_auth_providers` | Identity | user-owned | 002 |
| 3 | `user_profiles` | Identity | user-owned | 003 |
| 4 | `user_preferences` | Identity | user-owned | 003 |
| 5 | `career_roles` | Career | shared | 004 |
| 6 | `skill_categories` | Career | shared | 004 |
| 7 | `skills` | Career | shared | 004 |
| 8 | `skill_aliases` | Career | shared | 004 |
| 9 | `skill_dependencies` | Career | shared | 004 |
| 10 | `career_goals` | Career | user-owned | 004 |
| 11 | `roadmaps` | Roadmap | user-owned | 005 |
| 12 | `roadmap_versions` | Roadmap | user-owned | 005 |
| 13 | `roadmap_items` | Roadmap | user-owned, append-only | 005 |
| 14 | `roadmap_merges` | Roadmap | user-owned | 005 |
| 15 | `roadmap_merge_items` | Roadmap | user-owned, append-only | 005 |
| 16 | `topics` | Learning | shared | 006 |
| 17 | `learning_resources` | Learning | shared | 006 |
| 18 | `daily_plans` | Learning | user-owned | 006 |
| 19 | `daily_plan_items` | Learning | user-owned | 006 |
| 20 | `quizzes` | Assessment | shared (no direct client access) | 007 |
| 21 | `quiz_questions` | Assessment | shared (no direct client access) | 007 |
| 22 | `quiz_attempts` | Assessment | user-owned | 007 |
| 23 | `quiz_answers` | Assessment | user-owned | 007 |
| 24 | `practice_reviews` | Assessment | user-owned | 007 |
| 25 | `learning_evidence` | Progress | user-owned, append-only | 008 |
| 26 | `skill_progress` | Progress | user-owned, system-written | 008 |
| 27 | `achievement_history` | Progress | user-owned, append-only | 008 |
| 28 | `conversations` | AI Mentor | user-owned, private | 009 |
| 29 | `messages` | AI Mentor | user-owned, private | 009 |
| 30 | `conversation_summaries` | AI Mentor | user-owned, private | 009 |
| 31 | `ai_context_records` | AI Mentor | user-owned, private | 009 |
| 32 | `ai_models` | AI Operations | platform | 010 |
| 33 | `prompt_versions` | AI Operations | platform | 010 |
| 34 | `ai_requests` | AI Operations | user-owned (job record) | 010 |
| 35 | `ai_generations` | AI Operations | platform, content-free | 010 |
| 36 | `technology_categories` | Technology | shared | 011 |
| 37 | `technologies` | Technology | shared | 011 |
| 38 | `technology_sources` | Technology | shared | 011 |
| 39 | `technology_updates` | Technology | shared | 011 |
| 40 | `user_update_relevance` | Technology | user-owned | 011 |
| 41 | `update_delivery_history` | Technology | user-owned | 011 |
| 42 | `admin_users` | Administration | platform | 012 |
| 43 | `system_configurations` | Administration | platform | 012 |
| 44 | `feature_controls` | Administration | platform | 012 |
| 45 | `user_access_overrides` | Administration | per-user (admin-written) | 012 |
| 46 | `admin_audit_logs` | Administration | platform, append-only | 012 |
| 47 | `user_ratings` | Quality Feedback (Gap G1) | user-owned (`EP-F01`) | 020 |
| 48 | `content_reports` | Quality Feedback (Gap G1) | user-owned, append-only (`EP-F02`) | 020 |
| 49 | `account_deletion_requests` | Identity / Account (Gap G2) | user-owned, `ON DELETE SET NULL` tombstone (`EP-X01/02`) | 020 |
| 50 | `user_skill_aliases` | Career (Gap G3) | user-owned (`EP-P05`) | 020 |

---

# 2. Migration Repository Layout

```text
supabase/
├── config.toml
├── README.md
├── migrations/
│   ├── 000_extensions.sql
│   ├── 001_enums.sql
│   ├── 002_identity.sql
│   ├── 003_profiles.sql
│   ├── 004_career_intelligence.sql
│   ├── 005_roadmap.sql
│   ├── 006_learning.sql
│   ├── 007_assessment.sql
│   ├── 008_progress.sql
│   ├── 009_ai_mentor.sql
│   ├── 010_ai_operations.sql
│   ├── 011_technology_intelligence.sql
│   ├── 012_administration.sql
│   ├── 013_constraints.sql
│   ├── 014_indexes.sql
│   ├── 015_functions.sql
│   ├── 016_triggers.sql
│   ├── 017_rls.sql
│   ├── 018_seed.sql
│   ├── 019_tests.sql
│   └── 020_gaps_and_alignment.sql
├── seed/
│   ├── production_seed.sql
│   └── development_seed.sql
├── tests/database/
│   ├── 001_schema.test.sql
│   ├── 002_constraints.test.sql
│   ├── 003_rls_security.test.sql
│   ├── 004_trigger_behavior.test.sql
│   ├── 005_ai_usage.test.sql
│   ├── 006_roadmap_integrity.test.sql
│   ├── 007_retention.test.sql
│   └── 008_gaps.test.sql
└── rollbacks/
    └── 020_down.sql ... 000_down.sql
scripts/db/
├── check-migration-order.sh
├── test-fresh-install.sh
├── test-failure-handling.sh
├── test-upgrade.sh
└── perf/
    ├── seed_volume.sql
    └── explain_checks.sql
```

---

# 3. Migration Catalog

| File | Purpose | Depends on | Creates | Rollback |
|---|---|---|---|---|
| `000_extensions.sql` | Schemas and extensions | — | schema `private`; `citext`, `pg_trgm`, `pg_cron` | `000_down.sql` |
| `001_enums.sql` | Base PostgreSQL enums | 000 | 41 enum types | `001_down.sql` |
| `002_identity.sql` | Identity | 000, 001 | `users`, `user_auth_providers` | `002_down.sql` |
| `003_profiles.sql` | Profile and preferences | 002 | `user_profiles`, `user_preferences` | `003_down.sql` |
| `004_career_intelligence.sql` | Shared career taxonomy, goals | 002 | `career_roles`, `skill_categories`, `skills`, `skill_aliases`, `skill_dependencies`, `career_goals` | `004_down.sql` |
| `005_roadmap.sql` | Roadmaps, versions, items, merges | 004 | `roadmaps`, `roadmap_versions`, `roadmap_items`, `roadmap_merges`, `roadmap_merge_items` | `005_down.sql` |
| `006_learning.sql` | Topics, resources, daily plans | 004, 005 | `topics`, `learning_resources`, `daily_plans`, `daily_plan_items` | `006_down.sql` |
| `007_assessment.sql` | Quizzes, attempts, reviews | 006 | `quizzes`, `quiz_questions`, `quiz_attempts`, `quiz_answers`, `practice_reviews` | `007_down.sql` |
| `008_progress.sql` | Evidence and progress | 004–007 | `learning_evidence`, `skill_progress`, `achievement_history` | `008_down.sql` |
| `009_ai_mentor.sql` | Mentor conversations and memory | 005, 006 | `conversations`, `messages`, `conversation_summaries`, `ai_context_records` | `009_down.sql` |
| `010_ai_operations.sql` | AI operations | 002 | `ai_models`, `prompt_versions`, `ai_requests`, `ai_generations` | `010_down.sql` |
| `011_technology_intelligence.sql` | Technology updates | 004, 005, 010 | `technology_categories`, `technologies`, `technology_sources`, `technology_updates`, `user_update_relevance`, `update_delivery_history` | `011_down.sql` |
| `012_administration.sql` | Admin and access control | 002 | `admin_users`, `system_configurations`, `feature_controls`, `user_access_overrides`, `admin_audit_logs` | `012_down.sql` |
| `013_constraints.sql` | Forward/cyclic foreign keys | 002–012 | 17 FKs | `013_down.sql` |
| `014_indexes.sql` | Base secondary indexes | 002–013 | 99 indexes | `014_down.sql` |
| `015_functions.sql` | Functions and scheduled jobs | 002–014 | 20 functions; 2 cron jobs | `015_down.sql` |
| `016_triggers.sql` | Base triggers | 015 | 62 triggers across 5 families | `016_down.sql` |
| `017_rls.sql` | Base grants and RLS | 015 | RLS on 46 tables, 44 policies | `017_down.sql` |
| `018_seed.sql` | Reference seed | 002–012 | Roles, categories, feature controls, 11 base configs | `018_down.sql` |
| `019_tests.sql` | Base structural assertions | 000–018 | 12 read-only catalog assertions | `019_down.sql` |
| `020_gaps_and_alignment.sql` | Gaps `G1`–`G3`, AI quota seeds, `ADR-019`/`ADR-020` | 000–019 | 4 enums, 4 tables, 4 indexes, 1 function, 5 triggers, 4 policies, 4 config seeds, 7 catalog assertions | `020_down.sql` |

---

# 4. Extension Migration (`000_extensions.sql`)

```sql
-- 000_extensions.sql
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE EXTENSION IF NOT EXISTS citext  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable (%). Retention jobs must be scheduled externally.', SQLERRM;
  END;
END $$;
```

---

# 5. Enum Migration (`001_enums.sql`)

```sql
-- 001_enums.sql
CREATE TYPE public.user_status            AS ENUM ('active','suspended');
CREATE TYPE public.auth_provider          AS ENUM ('email','phone','google','facebook');
CREATE TYPE public.experience_level       AS ENUM ('beginner','junior','mid','senior');
CREATE TYPE public.career_level           AS ENUM ('junior','mid','senior');
CREATE TYPE public.content_status         AS ENUM ('draft','approved','hidden','retired');
CREATE TYPE public.alias_status           AS ENUM ('candidate','validated','rejected');
CREATE TYPE public.goal_status            AS ENUM ('clarifying','awaiting_confirmation','confirmed','discontinued');
CREATE TYPE public.roadmap_status         AS ENUM ('draft','locked','archived');
CREATE TYPE public.roadmap_version_state  AS ENUM ('draft','locked','superseded','restored');
CREATE TYPE public.roadmap_version_origin AS ENUM ('user_request','ai','merge','undo');
CREATE TYPE public.item_priority          AS ENUM ('core','supporting','optional');
CREATE TYPE public.skill_gap_type         AS ENUM ('existing','transferable','refresh','strengthen','missing');
CREATE TYPE public.merge_status           AS ENUM ('proposed','accepted','rejected','undone','superseded');
CREATE TYPE public.merge_origin           AS ENUM ('user_request','level_change','ai_proposal');
CREATE TYPE public.merge_op               AS ENUM ('add_topic','update_topic','reprioritize','reclassify','retire_topic');
CREATE TYPE public.resource_type          AS ENUM ('official_docs','release_notes','article','standard','video','other');
CREATE TYPE public.plan_status            AS ENUM ('active','completed');
CREATE TYPE public.plan_item_status       AS ENUM ('pending','in_progress','completed');
CREATE TYPE public.question_type          AS ENUM ('mcq','free_response');
CREATE TYPE public.question_difficulty    AS ENUM ('basic','application','analysis');
CREATE TYPE public.attempt_status         AS ENUM ('generated','started','submitted','ai_reviewed','feedback_available');
CREATE TYPE public.performance_level      AS ENUM ('good','needs_work');
CREATE TYPE public.review_status          AS ENUM ('pending','reviewed','failed','not_evidence');
CREATE TYPE public.learning_state         AS ENUM ('not_started','learning','practicing','proficient');
CREATE TYPE public.evidence_source        AS ENUM ('quiz_attempt','practice_review');
CREATE TYPE public.progress_event_type    AS ENUM ('state_change','evidence_added');
CREATE TYPE public.message_role           AS ENUM ('user','assistant');
CREATE TYPE public.ui_language            AS ENUM ('bn','en','mixed');
CREATE TYPE public.conversation_context   AS ENUM ('focus_roadmap','topic','general');
CREATE TYPE public.ai_context_type        AS ENUM ('profile','roadmap','daily_plan','practice','shared_skill','technology_update','conversation');
CREATE TYPE public.ai_task                AS ENUM ('goal_interpretation','roadmap_generate','roadmap_revision','merge_proposal','topic_content','quiz_generate','practice_review','mentor_chat','technology_update');
CREATE TYPE public.job_status             AS ENUM ('queued','preparing','succeeded','failed');
CREATE TYPE public.job_kind               AS ENUM ('career_goal','roadmap_generate','roadmap_revision','merge_proposal','topic_content','quiz_generate','practice_review');
CREATE TYPE public.ai_validation_status   AS ENUM ('passed','failed');
CREATE TYPE public.release_status         AS ENUM ('released','announced','planned','experimental');
CREATE TYPE public.action_timing          AS ENUM ('act_now','learn_later','awareness_only');
CREATE TYPE public.relevance_level        AS ENUM ('high','medium','low');
CREATE TYPE public.technology_source_type AS ENUM ('official_release_notes','official_docs','maintainer','engineering_blog','standards_body','publication');
CREATE TYPE public.update_state           AS ENUM ('available','no_important_changes','temporarily_unavailable');
CREATE TYPE public.feature_key            AS ENUM ('roadmap_generator','daily_plan','quiz_practice','ai_practice_review','progress_tracking','ai_mentor','technology_update');
CREATE TYPE public.admin_role             AS ENUM ('platform_admin');
```

---

# 6. Table Migration Specifications (`002` – `012`)

## 6.1 `002_identity.sql`

```sql
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
```

## 6.2 `003_profiles.sql`

```sql
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
```

## 6.3 `004_career_intelligence.sql`

```sql
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
```

## 6.4 `005_roadmap.sql`

```sql
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
```

## 6.5 `006_learning.sql`

```sql
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
```

## 6.6 `007_assessment.sql`

```sql
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
```

## 6.7 `008_progress.sql`

```sql
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
```

## 6.8 `009_ai_mentor.sql`

```sql
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
```

## 6.9 `010_ai_operations.sql`

```sql
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
```

## 6.10 `011_technology_intelligence.sql`

```sql
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
```

## 6.11 `012_administration.sql`

```sql
-- 012_administration.sql
CREATE TABLE public.admin_users (
  user_id    uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  role       public.admin_role NOT NULL DEFAULT 'platform_admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL
);

CREATE TABLE public.system_configurations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key   text NOT NULL,
  config_value jsonb NOT NULL,
  description  text,
  updated_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_system_configurations_key UNIQUE (config_key),
  CONSTRAINT ck_system_configurations_key CHECK (config_key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$')
);

ALTER TABLE public.system_configurations ADD CONSTRAINT ck_product_config_bounds
CHECK (CASE
 WHEN config_key='roadmap.max_active'
   THEN config_value='3'::jsonb
 WHEN config_key='career_goal.max_clarification_rounds'
   THEN config_value='2'::jsonb
 WHEN config_key='quiz.retry_limit' THEN config_value='1'::jsonb
 WHEN config_key='quiz.standard_mcq_count' THEN config_value='20'::jsonb
 WHEN config_key='quiz.standard_free_response_min' THEN config_value='5'::jsonb
 WHEN config_key='quiz.standard_free_response_max' THEN config_value='10'::jsonb
 WHEN config_key='technology_update.active_window_days' THEN config_value='7'::jsonb
 WHEN config_key IN ('retention.raw_response_days','retention.mentor_message_days',
                     'retention.ai_operational_log_days','career_knowledge.review_days') THEN
   CASE WHEN jsonb_typeof(config_value)='number' THEN
     (config_value #>> '{}')::numeric=trunc((config_value #>> '{}')::numeric)
     AND (config_value #>> '{}')::numeric BETWEEN 1 AND
       CASE WHEN config_key='retention.ai_operational_log_days' THEN 30 ELSE 90 END
   ELSE false END
 WHEN config_key='quality.report_auto_hide_threshold' THEN
   CASE WHEN jsonb_typeof(config_value)='number' THEN
     (config_value #>> '{}')::numeric=trunc((config_value #>> '{}')::numeric)
     AND (config_value #>> '{}')::numeric BETWEEN 2 AND 1000
   ELSE false END
 WHEN config_key IN ('roadmap.soft_size_max_topics',
                     'ai_quota.roadmap_drafts_per_24h',
                     'ai_quota.mentor_messages_per_24h') THEN
   CASE WHEN jsonb_typeof(config_value)='number' THEN
     (config_value #>> '{}')::numeric=trunc((config_value #>> '{}')::numeric)
     AND (config_value #>> '{}')::numeric BETWEEN 1 AND 10000
   ELSE false END
 ELSE true END);

CREATE TABLE public.feature_controls (
  feature_key          public.feature_key PRIMARY KEY,
  enabled              boolean NOT NULL DEFAULT true,
  default_user_enabled boolean NOT NULL DEFAULT true,
  updated_by           uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_access_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  feature_key public.feature_key NOT NULL,
  enabled     boolean NOT NULL,
  updated_by  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_access_overrides_pair UNIQUE (user_id, feature_key)
);

CREATE TABLE public.admin_audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        uuid REFERENCES public.users (id) ON DELETE SET NULL,
  action          text NOT NULL,
  target_type     text,
  target_id       uuid,
  target_user_id  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  before_state    jsonb,
  after_state     jsonb,
  http_request_id uuid,
  ip_address      inet,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_admin_audit_logs_action CHECK (length(btrim(action)) BETWEEN 1 AND 120)
);
```

---

# 7. Constraints (`013_constraints.sql`)

```sql
-- 013_constraints.sql
ALTER TABLE public.users
  ADD CONSTRAINT fk_users_suspended_by FOREIGN KEY (suspended_by) REFERENCES public.users (id) ON DELETE SET NULL;

ALTER TABLE public.roadmaps
  ADD CONSTRAINT fk_roadmaps_current_version FOREIGN KEY (current_version_id)
  REFERENCES public.roadmap_versions (id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.roadmap_versions
  ADD CONSTRAINT fk_roadmap_versions_base   FOREIGN KEY (base_version_id)  REFERENCES public.roadmap_versions (id),
  ADD CONSTRAINT fk_roadmap_versions_merge  FOREIGN KEY (merge_id)         REFERENCES public.roadmap_merges (id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT fk_roadmap_versions_ai_gen FOREIGN KEY (ai_generation_id) REFERENCES public.ai_generations (id) ON DELETE SET NULL;

ALTER TABLE public.roadmap_items
  ADD CONSTRAINT fk_roadmap_items_topic FOREIGN KEY (topic_id) REFERENCES public.topics (id);

ALTER TABLE public.roadmap_merges
  ADD CONSTRAINT fk_roadmap_merges_base   FOREIGN KEY (base_version_id)   REFERENCES public.roadmap_versions (id),
  ADD CONSTRAINT fk_roadmap_merges_result FOREIGN KEY (result_version_id) REFERENCES public.roadmap_versions (id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT fk_roadmap_merges_ai_gen FOREIGN KEY (ai_generation_id)  REFERENCES public.ai_generations (id) ON DELETE SET NULL;

ALTER TABLE public.roadmap_merge_items
  ADD CONSTRAINT fk_roadmap_merge_items_topic FOREIGN KEY (topic_id) REFERENCES public.topics (id);

ALTER TABLE public.daily_plans
  ADD CONSTRAINT fk_daily_plans_version FOREIGN KEY (roadmap_version_id) REFERENCES public.roadmap_versions (id);

ALTER TABLE public.daily_plan_items
  ADD CONSTRAINT fk_daily_plan_items_merge FOREIGN KEY (reconciled_by_merge_id) REFERENCES public.roadmap_merges (id) ON DELETE SET NULL;

ALTER TABLE public.topics
  ADD CONSTRAINT fk_topics_ai_gen FOREIGN KEY (ai_generation_id) REFERENCES public.ai_generations (id) ON DELETE SET NULL;

ALTER TABLE public.quizzes
  ADD CONSTRAINT fk_quizzes_ai_gen FOREIGN KEY (ai_generation_id) REFERENCES public.ai_generations (id) ON DELETE SET NULL;

ALTER TABLE public.practice_reviews
  ADD CONSTRAINT fk_practice_reviews_ai_gen FOREIGN KEY (ai_generation_id) REFERENCES public.ai_generations (id) ON DELETE SET NULL;

ALTER TABLE public.messages
  ADD CONSTRAINT fk_messages_ai_gen FOREIGN KEY (ai_generation_id) REFERENCES public.ai_generations (id) ON DELETE SET NULL;

ALTER TABLE public.conversation_summaries
  ADD CONSTRAINT fk_conversation_summaries_ai_gen FOREIGN KEY (ai_generation_id) REFERENCES public.ai_generations (id) ON DELETE SET NULL;
```

---

# 8. Indexes (`014_indexes.sql`)

```sql
-- 014_indexes.sql

-- Authentication
CREATE INDEX idx_users_status_created ON public.users (status, created_at DESC);
CREATE INDEX idx_users_last_active ON public.users (last_active_at) WHERE status = 'active';

-- Career
CREATE INDEX idx_career_roles_name_trgm ON public.career_roles USING gin (name extensions.gin_trgm_ops);
CREATE INDEX idx_skill_categories_parent ON public.skill_categories (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_skills_category ON public.skills (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX idx_skills_name_trgm ON public.skills USING gin (canonical_name extensions.gin_trgm_ops);
CREATE INDEX idx_skill_aliases_norm_trgm ON public.skill_aliases USING gin (alias_normalized extensions.gin_trgm_ops);
CREATE INDEX idx_skill_dependencies_dep ON public.skill_dependencies (depends_on_skill_id);
CREATE INDEX idx_career_goals_user_status ON public.career_goals (user_id, status, created_at DESC);
CREATE INDEX idx_career_goals_proposed_role ON public.career_goals (proposed_role_id) WHERE proposed_role_id IS NOT NULL;
CREATE INDEX idx_career_goals_confirmed_role ON public.career_goals (confirmed_role_id) WHERE confirmed_role_id IS NOT NULL;

-- Roadmap
CREATE INDEX idx_roadmaps_user_status ON public.roadmaps (user_id, status);
CREATE INDEX idx_roadmaps_role ON public.roadmaps (canonical_role_id);
CREATE INDEX idx_roadmaps_current_version ON public.roadmaps (current_version_id) WHERE current_version_id IS NOT NULL;
CREATE INDEX idx_roadmap_versions_user ON public.roadmap_versions (user_id);
CREATE INDEX idx_roadmap_versions_merge ON public.roadmap_versions (merge_id) WHERE merge_id IS NOT NULL;
CREATE INDEX idx_roadmap_versions_base ON public.roadmap_versions (base_version_id) WHERE base_version_id IS NOT NULL;
CREATE INDEX idx_roadmap_items_user ON public.roadmap_items (user_id);
CREATE INDEX idx_roadmap_items_skill ON public.roadmap_items (skill_id);
CREATE INDEX idx_roadmap_items_topic ON public.roadmap_items (topic_id);
CREATE INDEX idx_roadmap_items_lineage ON public.roadmap_items (lineage_id);
CREATE INDEX idx_roadmap_merges_roadmap_status ON public.roadmap_merges (roadmap_id, status, created_at DESC);
CREATE INDEX idx_roadmap_merges_user ON public.roadmap_merges (user_id);
CREATE INDEX idx_roadmap_merges_base_version ON public.roadmap_merges (base_version_id);
CREATE INDEX idx_roadmap_merges_result_version ON public.roadmap_merges (result_version_id) WHERE result_version_id IS NOT NULL;
CREATE INDEX idx_roadmap_merge_items_user ON public.roadmap_merge_items (user_id);
CREATE INDEX idx_roadmap_merge_items_topic ON public.roadmap_merge_items (topic_id) WHERE topic_id IS NOT NULL;

-- Learning
CREATE INDEX idx_topics_skill_level_status ON public.topics (skill_id, career_level, status);
CREATE INDEX idx_learning_resources_topic ON public.learning_resources (topic_id);
CREATE INDEX idx_daily_plans_user ON public.daily_plans (user_id);
CREATE INDEX idx_daily_plans_version ON public.daily_plans (roadmap_version_id) WHERE roadmap_version_id IS NOT NULL;
CREATE INDEX idx_daily_plan_items_open ON public.daily_plan_items (plan_id, day_no, sort_order) WHERE status <> 'completed';
CREATE INDEX idx_daily_plan_items_user ON public.daily_plan_items (user_id);
CREATE INDEX idx_daily_plan_items_topic ON public.daily_plan_items (topic_id);
CREATE INDEX idx_daily_plan_items_merge ON public.daily_plan_items (reconciled_by_merge_id) WHERE reconciled_by_merge_id IS NOT NULL;
CREATE INDEX idx_quizzes_topic_status ON public.quizzes (topic_id, status);
CREATE INDEX idx_quiz_attempts_user_status ON public.quiz_attempts (user_id, status);
CREATE INDEX idx_quiz_attempts_user_submitted ON public.quiz_attempts (user_id, submitted_at DESC) WHERE submitted_at IS NOT NULL;
CREATE INDEX idx_quiz_attempts_quiz ON public.quiz_attempts (quiz_id);
CREATE INDEX idx_quiz_attempts_retry_of ON public.quiz_attempts (retry_of_attempt_id) WHERE retry_of_attempt_id IS NOT NULL;
CREATE INDEX idx_quiz_answers_user ON public.quiz_answers (user_id);
CREATE INDEX idx_quiz_answers_question ON public.quiz_answers (question_id);
CREATE INDEX idx_quiz_answers_raw_expiry ON public.quiz_answers (raw_text_expires_at) WHERE answer_text IS NOT NULL;
CREATE INDEX idx_practice_reviews_attempt ON public.practice_reviews (attempt_id);
CREATE INDEX idx_practice_reviews_user ON public.practice_reviews (user_id);
CREATE INDEX idx_practice_reviews_question ON public.practice_reviews (question_id);
CREATE INDEX idx_practice_reviews_open ON public.practice_reviews (review_status, created_at) WHERE review_status IN ('pending','failed');

-- Progress
CREATE INDEX idx_learning_evidence_user_skill_level ON public.learning_evidence (user_id, skill_id, career_level, occurred_at DESC);
CREATE INDEX idx_learning_evidence_skill ON public.learning_evidence (skill_id);
CREATE INDEX idx_learning_evidence_topic ON public.learning_evidence (topic_id);
CREATE INDEX idx_learning_evidence_roadmap ON public.learning_evidence (roadmap_id) WHERE roadmap_id IS NOT NULL;
CREATE INDEX idx_skill_progress_user_state ON public.skill_progress (user_id, learning_state);
CREATE INDEX idx_skill_progress_skill ON public.skill_progress (skill_id);
CREATE INDEX idx_achievement_history_user_time ON public.achievement_history (user_id, occurred_at DESC);
CREATE INDEX idx_achievement_history_user_skill_time ON public.achievement_history (user_id, skill_id, occurred_at DESC);
CREATE INDEX idx_achievement_history_skill ON public.achievement_history (skill_id);

-- AI conversations
CREATE INDEX idx_conversations_user_last ON public.conversations (user_id, last_message_at DESC NULLS LAST);
CREATE INDEX idx_conversations_roadmap ON public.conversations (roadmap_id) WHERE roadmap_id IS NOT NULL;
CREATE INDEX idx_conversations_topic ON public.conversations (topic_id) WHERE topic_id IS NOT NULL;
CREATE INDEX idx_messages_conversation_created ON public.messages (conversation_id, created_at);
CREATE INDEX idx_messages_expires ON public.messages (expires_at);
CREATE INDEX idx_messages_user ON public.messages (user_id);
CREATE INDEX idx_messages_reply_to ON public.messages (reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;
CREATE INDEX idx_conversation_summaries_user ON public.conversation_summaries (user_id);
CREATE INDEX idx_ai_context_records_valid_until ON public.ai_context_records (valid_until);

-- AI analytics
CREATE INDEX idx_ai_models_routing ON public.ai_models (fallback_rank) WHERE is_active AND real_user_data_approved;
CREATE INDEX idx_ai_requests_user_status ON public.ai_requests (user_id, status);
CREATE INDEX idx_ai_requests_queue ON public.ai_requests (available_at) WHERE status = 'queued';
CREATE INDEX idx_ai_requests_created ON public.ai_requests (created_at);
CREATE INDEX idx_ai_requests_feature_created ON public.ai_requests (feature_key, created_at) WHERE feature_key IS NOT NULL;
CREATE INDEX idx_ai_requests_finished ON public.ai_requests (finished_at) WHERE finished_at IS NOT NULL;
CREATE INDEX idx_ai_requests_model ON public.ai_requests (model_id) WHERE model_id IS NOT NULL;
CREATE INDEX idx_ai_requests_prompt ON public.ai_requests (prompt_version_id) WHERE prompt_version_id IS NOT NULL;
CREATE INDEX idx_ai_requests_subject ON public.ai_requests (subject_type, subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX idx_ai_generations_task_created ON public.ai_generations (task, created_at);
CREATE INDEX idx_ai_generations_model ON public.ai_generations (model_id) WHERE model_id IS NOT NULL;
CREATE INDEX idx_ai_generations_prompt ON public.ai_generations (prompt_version_id) WHERE prompt_version_id IS NOT NULL;
CREATE INDEX idx_ai_generations_request ON public.ai_generations (request_id) WHERE request_id IS NOT NULL;

-- Technology
CREATE INDEX idx_technologies_category ON public.technologies (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX idx_technologies_skill ON public.technologies (skill_id) WHERE skill_id IS NOT NULL;
CREATE INDEX idx_technology_updates_fetched ON public.technology_updates (fetched_at DESC);
CREATE INDEX idx_technology_updates_technology ON public.technology_updates (technology_id) WHERE technology_id IS NOT NULL;
CREATE INDEX idx_technology_updates_source ON public.technology_updates (source_id) WHERE source_id IS NOT NULL;
CREATE INDEX idx_user_update_relevance_user_computed ON public.user_update_relevance (user_id, computed_at DESC);
CREATE INDEX idx_user_update_relevance_update ON public.user_update_relevance (update_id);
CREATE INDEX idx_user_update_relevance_roadmap ON public.user_update_relevance (focus_roadmap_id) WHERE focus_roadmap_id IS NOT NULL;
CREATE INDEX idx_update_delivery_update ON public.update_delivery_history (update_id) WHERE update_id IS NOT NULL;

-- Administration
CREATE INDEX idx_user_access_overrides_feature ON public.user_access_overrides (feature_key, enabled);
CREATE INDEX idx_admin_audit_logs_actor_time ON public.admin_audit_logs (actor_id, created_at DESC);
CREATE INDEX idx_admin_audit_logs_target_time ON public.admin_audit_logs (target_user_id, created_at DESC);
CREATE INDEX idx_admin_audit_logs_action_time ON public.admin_audit_logs (action, created_at DESC);

-- R02: generation FK leading indexes, before 019.
CREATE INDEX idx_roadmap_versions_ai_generation ON public.roadmap_versions (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
CREATE INDEX idx_roadmap_merges_ai_generation ON public.roadmap_merges (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
CREATE INDEX idx_topics_ai_generation ON public.topics (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
CREATE INDEX idx_quizzes_ai_generation ON public.quizzes (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
CREATE INDEX idx_practice_reviews_ai_generation ON public.practice_reviews (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
CREATE INDEX idx_messages_ai_generation ON public.messages (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
CREATE INDEX idx_conversation_summaries_ai_generation ON public.conversation_summaries (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
CREATE INDEX idx_technology_updates_ai_generation ON public.technology_updates (ai_generation_id) WHERE ai_generation_id IS NOT NULL;
```

---

# 9. Functions (`015_functions.sql`)

```sql
-- 015_functions.sql

-- 1. updated_at maintenance
CREATE OR REPLACE FUNCTION private.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- 2. ownership consistency
CREATE OR REPLACE FUNCTION private.validate_user_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_parent_table text := TG_ARGV[0];
  v_fk_column    text := TG_ARGV[1];
  v_fk_value     uuid;
  v_parent_owner uuid;
BEGIN
  v_fk_value := (to_jsonb(NEW) ->> v_fk_column)::uuid;
  IF v_fk_value IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT user_id FROM public.%I WHERE id = $1', v_parent_table)
    INTO v_parent_owner USING v_fk_value;
  IF v_parent_owner IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'OWNERSHIP_MISMATCH: %.% references a row owned by another user', TG_TABLE_NAME, v_fk_column
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- 3. roadmap lifecycle
CREATE OR REPLACE FUNCTION private.validate_roadmap_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status = 'draft'  AND NEW.status IN ('locked','archived'))
       OR (OLD.status = 'locked' AND NEW.status = 'archived')) THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: roadmap % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'locked' THEN
    NEW.locked_at := COALESCE(NEW.locked_at, now());
  ELSE
    NEW.archived_at := COALESCE(NEW.archived_at, now());
    NEW.is_focus := false;
  END IF;
  RETURN NEW;
END $$;

-- 4. active roadmap limit (<= 3)
CREATE OR REPLACE FUNCTION private.enforce_active_roadmap_limit()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_limit integer;
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));
  v_limit := 3; -- Frozen PRD §16; configuration cannot raise the ceiling.
  SELECT count(*) INTO v_count
  FROM public.roadmaps WHERE user_id = NEW.user_id AND status <> 'archived';
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'ROADMAP_LIMIT_REACHED: user already has % active roadmaps', v_count
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- 5. roadmap version immutability
CREATE OR REPLACE FUNCTION private.guard_roadmap_version_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_mutable text[] := ARRAY['state','locked_at','superseded_at','stale','stale_reason','updated_at'];
BEGIN
  IF (to_jsonb(NEW) - v_mutable) IS DISTINCT FROM (to_jsonb(OLD) - v_mutable) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW: roadmap_versions content cannot change (version %)', OLD.version_no
      USING ERRCODE = '55000';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'draft'      AND NEW.state IN ('locked','superseded'))
    OR (OLD.state = 'locked'     AND NEW.state = 'superseded')
    OR (OLD.state = 'restored'   AND NEW.state = 'superseded')
    OR (OLD.state = 'superseded' AND NEW.state = 'restored')) THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: roadmap version % -> %', OLD.state, NEW.state
      USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'locked' AND OLD.state = 'draft' THEN
    NEW.locked_at := COALESCE(NEW.locked_at, now());
  ELSIF NEW.state = 'superseded' AND OLD.state <> 'superseded' THEN
    NEW.superseded_at := COALESCE(NEW.superseded_at, now());
  END IF;
  RETURN NEW;
END $$;

-- 6. AI job state machine
CREATE OR REPLACE FUNCTION private.validate_ai_request_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status = 'queued'    AND NEW.status IN ('preparing','failed'))
       OR (OLD.status = 'preparing' AND NEW.status IN ('succeeded','failed'))
       OR (OLD.status = 'failed'    AND NEW.status = 'queued' AND OLD.retryable)) THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: ai_request % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'preparing' THEN
    NEW.started_at    := COALESCE(NEW.started_at, now());
    NEW.locked_at     := COALESCE(NEW.locked_at, now());
    NEW.attempt_count := OLD.attempt_count + 1;
  ELSIF NEW.status IN ('succeeded','failed') THEN
    NEW.finished_at := COALESCE(NEW.finished_at, now());
    NEW.locked_at   := NULL;
    NEW.locked_by   := NULL;
  ELSE
    NEW.finished_at   := NULL;
    NEW.error_code    := NULL;
    NEW.error_message := NULL;
    NEW.locked_at     := NULL;
    NEW.locked_by     := NULL;
    NEW.available_at  := GREATEST(NEW.available_at, now());
  END IF;
  RETURN NEW;
END $$;

-- 7. total usage units
CREATE OR REPLACE FUNCTION private.calculate_total_tokens()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.total_units := COALESCE(NEW.input_units, 0) + COALESCE(NEW.output_units, 0);
  RETURN NEW;
END $$;

-- 8. AI cost calculation
CREATE OR REPLACE FUNCTION private.calculate_ai_cost()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_cost numeric;
BEGIN
  IF NEW.model_id IS NOT NULL THEN
    SELECT round((COALESCE(NEW.input_units,0)  * m.input_price_per_m_units
                + COALESCE(NEW.output_units,0) * m.output_price_per_m_units) / 1000000.0, 8)
      INTO v_cost
    FROM public.ai_models m WHERE m.id = NEW.model_id;
    IF FOUND THEN
      NEW.cost_usd := v_cost;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 9. expired AI memory cleanup
CREATE OR REPLACE FUNCTION private.cleanup_expired_ai_context()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH d AS (DELETE FROM public.ai_context_records WHERE valid_until < now() RETURNING 1)
  SELECT count(*) INTO v_deleted FROM d;
  RETURN v_deleted;
END $$;

-- 10. PRD §52 retention cleanup
CREATE OR REPLACE FUNCTION private.cleanup_expired_retention()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ai_days   integer := LEAST(30, GREATEST(1, COALESCE((SELECT (config_value #>> '{}')::integer
    FROM public.system_configurations WHERE config_key = 'retention.ai_operational_log_days'), 30)));
  v_raw_days integer := LEAST(90, GREATEST(1, COALESCE((SELECT (config_value #>> '{}')::integer
    FROM public.system_configurations WHERE config_key='retention.raw_response_days'),90)));
  v_message_days integer := LEAST(90, GREATEST(1, COALESCE((SELECT (config_value #>> '{}')::integer
    FROM public.system_configurations WHERE config_key='retention.mentor_message_days'),90)));
  v_answers   integer;
  v_messages  integer;
  v_requests  integer;
BEGIN
  WITH u AS (
    UPDATE public.quiz_answers
       SET answer_text = NULL, raw_text_purged_at = now()
     WHERE answer_text IS NOT NULL AND (raw_text_expires_at <= now()
       OR created_at <= now() - make_interval(days => v_raw_days))
    RETURNING 1)
  SELECT count(*) INTO v_answers FROM u;

  WITH d AS (
    DELETE FROM public.messages
     WHERE expires_at <= now() OR created_at <= now() - make_interval(days => v_message_days)
    RETURNING 1)
  SELECT count(*) INTO v_messages FROM d;

  WITH d AS (
    DELETE FROM public.ai_requests
     WHERE created_at <= now() - make_interval(days => v_ai_days)
    RETURNING 1)
  SELECT count(*) INTO v_requests FROM d;

  -- 015 precedes table020; dynamic SQL resolves this table at execution.
  IF to_regclass('public.account_deletion_requests') IS NOT NULL THEN
    EXECUTE 'UPDATE public.account_deletion_requests
      SET provider_cleanup = ''[]''::jsonb, provider_cleanup_expires_at = NULL
      WHERE provider_cleanup_expires_at <= now()';
  END IF;

  RETURN jsonb_build_object('raw_answers_purged', v_answers,
                            'messages_deleted',   v_messages,
                            'ai_requests_deleted', v_requests);
END $$;

-- 11. generic append-only guard
CREATE OR REPLACE FUNCTION private.prevent_row_modification()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW: % is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_ROW: % rows cannot be deleted directly', TG_TABLE_NAME USING ERRCODE = '55000';
END $$;

-- 12. progress history immutability
CREATE OR REPLACE FUNCTION private.prevent_achievement_modification()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW: achievement_history is append-only' USING ERRCODE = '55000';
  END IF;
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_ROW: achievement_history rows cannot be deleted directly' USING ERRCODE = '55000';
END $$;

-- 13. audit log immutability
CREATE OR REPLACE FUNCTION private.prevent_audit_log_changes()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND pg_trigger_depth() > 1
     AND (to_jsonb(NEW) - 'actor_id' - 'target_user_id') = (to_jsonb(OLD) - 'actor_id' - 'target_user_id')
     AND (NEW.actor_id IS NULL OR NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id)
     AND (NEW.target_user_id IS NULL OR NEW.target_user_id IS NOT DISTINCT FROM OLD.target_user_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_ROW: admin_audit_logs is append-only' USING ERRCODE = '55000';
END $$;

-- 14. learning state change reason check
CREATE OR REPLACE FUNCTION private.validate_skill_progress_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.learning_state IS DISTINCT FROM OLD.learning_state THEN
    IF NEW.state_reason IS NULL OR length(btrim(NEW.state_reason)) = 0
       OR NEW.state_reason IS NOT DISTINCT FROM OLD.state_reason THEN
      RAISE EXCEPTION 'STATE_REASON_REQUIRED: a learning state change needs a new reason'
        USING ERRCODE = '23514';
    END IF;
    NEW.state_changed_at := now();
  END IF;
  RETURN NEW;
END $$;

-- 15. IANA timezone validation
CREATE OR REPLACE FUNCTION private.validate_profile_timezone()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.timezone IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'INVALID_TIMEZONE: %', NEW.timezone USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

-- 16. merge undo window auto-close
CREATE OR REPLACE FUNCTION private.close_merge_undo_window()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.roadmap_merges rm
     SET undo_window_closed_at = now()
    FROM public.daily_plan_items dpi
   WHERE dpi.id = NEW.daily_plan_item_id
     AND dpi.reconciled_by_merge_id IS NOT NULL
     AND rm.id = dpi.reconciled_by_merge_id
     AND rm.undo_window_closed_at IS NULL;
  RETURN NEW;
END $$;

-- 17. conversation timestamp update
CREATE OR REPLACE FUNCTION private.touch_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END $$;

-- 18. server-side admin check
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users au
    JOIN public.users u ON u.id = au.user_id
    WHERE au.user_id = (SELECT auth.uid()) AND u.status = 'active');
$$;

-- 19. effective feature access
CREATE OR REPLACE FUNCTION private.effective_feature_access(p_user_id uuid, p_feature public.feature_key)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((
    SELECT u.status = 'active'
       AND fc.enabled
       AND COALESCE(uao.enabled, fc.default_user_enabled)
    FROM public.users u
    JOIN public.feature_controls fc ON fc.feature_key = p_feature
    LEFT JOIN public.user_access_overrides uao ON uao.user_id = u.id AND uao.feature_key = p_feature
    WHERE u.id = p_user_id), false);
$$;

-- 20. aggregate usage counts for admin
CREATE OR REPLACE FUNCTION private.admin_usage_summary(p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'users', jsonb_build_object(
      'total', (SELECT count(*) FROM public.users),
      'active_last_7_days', (SELECT count(*) FROM public.users WHERE last_active_at >= now() - interval '7 days')),
    'counts', jsonb_build_object(
      'roadmaps_locked', (SELECT count(*) FROM public.roadmaps
                           WHERE locked_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND locked_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'quizzes_submitted', (SELECT count(*) FROM public.quiz_attempts
                             WHERE submitted_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND submitted_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'mentor_messages', (SELECT count(*) FROM public.messages
                           WHERE created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'technology_updates_generated', (SELECT count(*) FROM public.technology_updates
                                        WHERE created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC'))),
    'ai', jsonb_build_object(
      'requests',       (SELECT count(*) FROM public.ai_requests WHERE created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'failures',       (SELECT count(*) FROM public.ai_requests WHERE status = 'failed'
                           AND created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'fallbacks_used', (SELECT count(*) FROM public.ai_requests WHERE fallback_used
                           AND created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'usage_units', (SELECT jsonb_build_object('input', COALESCE(sum(input_units),0), 'output', COALESCE(sum(output_units),0))
                        FROM public.ai_requests WHERE created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'estimated_cost_usd', (SELECT COALESCE(sum(cost_usd),0) FROM public.ai_requests
                               WHERE created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')),
      'by_day', (SELECT COALESCE(jsonb_agg(x ORDER BY x.day),'[]'::jsonb) FROM (
 SELECT d.day::date AS day, count(r.id) AS requests,
        count(r.id) FILTER (WHERE r.status='failed') AS failures,
        count(r.id) FILTER (WHERE r.fallback_used) AS fallbacks_used,
        COALESCE(sum(r.input_units),0) AS input_units,
        COALESCE(sum(r.output_units),0) AS output_units,
        COALESCE(sum(r.cost_usd),0) AS estimated_cost_usd
 FROM generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d(day)
 LEFT JOIN public.ai_requests r
   ON r.created_at >= (d.day AT TIME ZONE 'UTC')
  AND r.created_at < ((d.day + interval '1 day') AT TIME ZONE 'UTC')
 GROUP BY d.day) x),
      'by_feature', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
                       SELECT feature_key, count(*) AS requests, COALESCE(sum(cost_usd),0) AS estimated_cost_usd
                         FROM public.ai_requests
                        WHERE feature_key IS NOT NULL AND created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')
                        GROUP BY feature_key) x),
      'by_provider', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
                       SELECT provider_key AS provider_id, count(*) AS requests, COALESCE(sum(cost_usd),0) AS estimated_cost_usd
                         FROM public.ai_requests
                        WHERE provider_key IS NOT NULL AND created_at >= (p_from::timestamp AT TIME ZONE 'UTC') AND created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')
                        GROUP BY provider_key) x)));
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.effective_feature_access(uuid, public.feature_key) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('cleanup-expired-ai-context', '17 * * * *',  'SELECT private.cleanup_expired_ai_context()');
    PERFORM cron.schedule('cleanup-expired-retention',  '37 2 * * *', 'SELECT private.cleanup_expired_retention()');
  END IF;
END $$;
```

---

# 10. Triggers (`016_triggers.sql`)

```sql
-- 016_triggers.sql

-- Family 1: updated_at (32 base tables)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','user_auth_providers','user_profiles','user_preferences','career_roles','skill_categories','skills',
    'skill_aliases','career_goals','roadmaps','roadmap_versions','roadmap_merges','topics','learning_resources',
    'daily_plans','daily_plan_items','quizzes','quiz_questions','quiz_attempts','quiz_answers','practice_reviews',
    'skill_progress','conversations','ai_context_records','ai_models','ai_requests','technology_categories',
    'technologies','technology_sources','system_configurations','feature_controls','user_access_overrides']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.update_updated_at_column()',
      'trg_' || t || '_updated_at', t);
  END LOOP;
END $$;

-- Family 2: ownership validation (13)
CREATE TRIGGER trg_roadmaps_owner_check BEFORE INSERT OR UPDATE OF user_id, career_goal_id ON public.roadmaps
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('career_goals', 'career_goal_id');
CREATE TRIGGER trg_roadmap_versions_owner_check BEFORE INSERT OR UPDATE OF user_id, roadmap_id ON public.roadmap_versions
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('roadmaps', 'roadmap_id');
CREATE TRIGGER trg_roadmap_items_owner_check BEFORE INSERT OR UPDATE OF user_id, version_id ON public.roadmap_items
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('roadmap_versions', 'version_id');
CREATE TRIGGER trg_roadmap_merges_owner_check BEFORE INSERT OR UPDATE OF user_id, roadmap_id ON public.roadmap_merges
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('roadmaps', 'roadmap_id');
CREATE TRIGGER trg_roadmap_merge_items_owner_check BEFORE INSERT OR UPDATE OF user_id, merge_id ON public.roadmap_merge_items
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('roadmap_merges', 'merge_id');
CREATE TRIGGER trg_daily_plans_owner_check BEFORE INSERT OR UPDATE OF user_id, roadmap_id ON public.daily_plans
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('roadmaps', 'roadmap_id');
CREATE TRIGGER trg_daily_plan_items_owner_check BEFORE INSERT OR UPDATE OF user_id, plan_id ON public.daily_plan_items
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('daily_plans', 'plan_id');
CREATE TRIGGER trg_quiz_attempts_owner_check BEFORE INSERT OR UPDATE OF user_id, daily_plan_item_id ON public.quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('daily_plan_items', 'daily_plan_item_id');
CREATE TRIGGER trg_quiz_answers_owner_check BEFORE INSERT OR UPDATE OF user_id, attempt_id ON public.quiz_answers
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('quiz_attempts', 'attempt_id');
CREATE TRIGGER trg_practice_reviews_owner_check BEFORE INSERT OR UPDATE OF user_id, attempt_id ON public.practice_reviews
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('quiz_attempts', 'attempt_id');
CREATE TRIGGER trg_messages_owner_check BEFORE INSERT OR UPDATE OF user_id, conversation_id ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('conversations', 'conversation_id');
CREATE TRIGGER trg_conversation_summaries_owner_check BEFORE INSERT OR UPDATE OF user_id, conversation_id ON public.conversation_summaries
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('conversations', 'conversation_id');
CREATE TRIGGER trg_learning_evidence_owner_check BEFORE INSERT OR UPDATE OF user_id, roadmap_id ON public.learning_evidence
  FOR EACH ROW EXECUTE FUNCTION private.validate_user_ownership('roadmaps', 'roadmap_id');

-- Family 3: lifecycle protection (8)
CREATE TRIGGER trg_roadmaps_limit BEFORE INSERT ON public.roadmaps
  FOR EACH ROW EXECUTE FUNCTION private.enforce_active_roadmap_limit();
CREATE TRIGGER trg_roadmaps_transition BEFORE UPDATE OF status ON public.roadmaps
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.validate_roadmap_transition();
CREATE TRIGGER trg_roadmap_versions_guard BEFORE UPDATE ON public.roadmap_versions
  FOR EACH ROW EXECUTE FUNCTION private.guard_roadmap_version_immutability();
CREATE TRIGGER trg_ai_requests_status BEFORE UPDATE OF status ON public.ai_requests
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.validate_ai_request_status();
CREATE TRIGGER trg_skill_progress_guard BEFORE UPDATE OF learning_state ON public.skill_progress
  FOR EACH ROW EXECUTE FUNCTION private.validate_skill_progress_change();
CREATE TRIGGER trg_user_profiles_validate_timezone BEFORE INSERT OR UPDATE OF timezone ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION private.validate_profile_timezone();
CREATE TRIGGER trg_quiz_attempts_close_undo AFTER INSERT OR UPDATE OF status ON public.quiz_attempts
  FOR EACH ROW WHEN (NEW.status = 'started')
  EXECUTE FUNCTION private.close_merge_undo_window();
CREATE TRIGGER trg_messages_touch_conversation AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.touch_conversation();

-- Family 4: audit and append-only protection (5)
CREATE TRIGGER trg_roadmap_items_append_only BEFORE UPDATE OR DELETE ON public.roadmap_items
  FOR EACH ROW EXECUTE FUNCTION private.prevent_row_modification();
CREATE TRIGGER trg_roadmap_merge_items_append_only BEFORE UPDATE OR DELETE ON public.roadmap_merge_items
  FOR EACH ROW EXECUTE FUNCTION private.prevent_row_modification();
CREATE TRIGGER trg_learning_evidence_append_only BEFORE UPDATE OR DELETE ON public.learning_evidence
  FOR EACH ROW EXECUTE FUNCTION private.prevent_row_modification();
CREATE TRIGGER trg_achievement_history_append_only BEFORE UPDATE OR DELETE ON public.achievement_history
  FOR EACH ROW EXECUTE FUNCTION private.prevent_achievement_modification();
CREATE TRIGGER trg_admin_audit_logs_append_only BEFORE UPDATE OR DELETE ON public.admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION private.prevent_audit_log_changes();

-- Family 5: AI calculations (4)
CREATE TRIGGER trg_ai_requests_a_total BEFORE INSERT OR UPDATE OF input_units, output_units ON public.ai_requests
  FOR EACH ROW EXECUTE FUNCTION private.calculate_total_tokens();
CREATE TRIGGER trg_ai_requests_b_cost BEFORE INSERT OR UPDATE OF input_units, output_units, model_id ON public.ai_requests
  FOR EACH ROW EXECUTE FUNCTION private.calculate_ai_cost();
CREATE TRIGGER trg_ai_generations_a_total BEFORE INSERT OR UPDATE OF input_units, output_units ON public.ai_generations
  FOR EACH ROW EXECUTE FUNCTION private.calculate_total_tokens();
CREATE TRIGGER trg_ai_generations_b_cost BEFORE INSERT OR UPDATE OF input_units, output_units, model_id ON public.ai_generations
  FOR EACH ROW EXECUTE FUNCTION private.calculate_ai_cost();
```

---

# 11. RLS Policies (`017_rls.sql`)

```sql
-- 017_rls.sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

CREATE OR REPLACE FUNCTION private.apply_owner_policies(p_table regclass, p_mode text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_name text := (SELECT relname FROM pg_catalog.pg_class WHERE oid = p_table);
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) AND (%s))',
    v_name || '_owner_select', p_table,
    CASE WHEN v_name = 'user_auth_providers' THEN 'true'
      WHEN v_name IN ('user_update_relevance','update_delivery_history')
        THEN 'private.effective_feature_access((SELECT auth.uid()), ''technology_update'')'
      ELSE 'EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = ''active'')' END);
  IF p_mode = 'riu' THEN
    EXECUTE format(
      'CREATE POLICY %I ON %s FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()))',
      v_name || '_owner_insert', p_table);
    EXECUTE format(
      'CREATE POLICY %I ON %s FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()))',
      v_name || '_owner_update', p_table);
  END IF;
END $$;

SELECT private.apply_owner_policies('public.user_auth_providers',     'r');
SELECT private.apply_owner_policies('public.career_goals',            'r');
SELECT private.apply_owner_policies('public.roadmaps',                'r');
SELECT private.apply_owner_policies('public.roadmap_versions',        'r');
SELECT private.apply_owner_policies('public.roadmap_items',           'r');
SELECT private.apply_owner_policies('public.roadmap_merges',          'r');
SELECT private.apply_owner_policies('public.roadmap_merge_items',     'r');
SELECT private.apply_owner_policies('public.daily_plans',             'r');
SELECT private.apply_owner_policies('public.daily_plan_items',        'r');
SELECT private.apply_owner_policies('public.quiz_attempts',           'r');
SELECT private.apply_owner_policies('public.quiz_answers',            'r');
SELECT private.apply_owner_policies('public.practice_reviews',        'r');
SELECT private.apply_owner_policies('public.learning_evidence',       'r');
SELECT private.apply_owner_policies('public.skill_progress',          'r');
SELECT private.apply_owner_policies('public.achievement_history',     'r');
SELECT private.apply_owner_policies('public.conversations',           'r');
SELECT private.apply_owner_policies('public.messages',                'r');
ALTER POLICY messages_owner_select ON public.messages USING (
  user_id = (SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active')
  AND expires_at > now() AND created_at > now() - interval '90 days');
SELECT private.apply_owner_policies('public.conversation_summaries',  'r');
SELECT private.apply_owner_policies('public.ai_context_records',      'r');
SELECT private.apply_owner_policies('public.ai_requests',             'r');
SELECT private.apply_owner_policies('public.user_update_relevance',   'r');
SELECT private.apply_owner_policies('public.update_delivery_history', 'r');
SELECT private.apply_owner_policies('public.user_access_overrides',   'r');

SELECT private.apply_owner_policies('public.user_profiles',    'riu');
SELECT private.apply_owner_policies('public.user_preferences', 'riu');

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_owner_or_admin_select ON public.users FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT private.is_admin()));

CREATE POLICY user_access_overrides_admin_select ON public.user_access_overrides FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_audit_logs_admin_select ON public.admin_audit_logs FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));

ALTER TABLE public.technology_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY technology_updates_delivered_select ON public.technology_updates FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.update_delivery_history d
                  WHERE d.update_id = technology_updates.id AND d.user_id = (SELECT auth.uid()))
    AND private.effective_feature_access((SELECT auth.uid()), 'technology_update'));

ALTER TABLE public.career_roles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_aliases          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_dependencies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_resources     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technology_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technologies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technology_sources     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_controls       ENABLE ROW LEVEL SECURITY;

CREATE POLICY career_roles_shared_select ON public.career_roles FOR SELECT TO authenticated
  USING (status = 'approved' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY skill_categories_shared_select ON public.skill_categories FOR SELECT TO authenticated
  USING (true AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY skills_shared_select ON public.skills FOR SELECT TO authenticated
  USING (status = 'approved' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY skill_aliases_shared_select ON public.skill_aliases FOR SELECT TO authenticated
  USING (status = 'validated' AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY skill_dependencies_shared_select ON public.skill_dependencies FOR SELECT TO authenticated
  USING (true AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY topics_shared_select ON public.topics FOR SELECT TO authenticated
  USING (status = 'approved' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY learning_resources_shared_select ON public.learning_resources FOR SELECT TO authenticated
  USING (status = 'approved' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY technology_categories_shared_select ON public.technology_categories FOR SELECT TO authenticated
  USING (true AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY technologies_shared_select ON public.technologies FOR SELECT TO authenticated
  USING (status = 'approved' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY technology_sources_shared_select ON public.technology_sources FOR SELECT TO authenticated
  USING (is_active AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY feature_controls_shared_select ON public.feature_controls FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.quizzes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_models             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_versions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_configurations ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON
  public.user_auth_providers, public.career_goals, public.roadmaps, public.roadmap_versions, public.roadmap_items,
  public.roadmap_merges, public.roadmap_merge_items, public.daily_plans, public.daily_plan_items,
  public.quiz_attempts, public.quiz_answers, public.practice_reviews, public.learning_evidence,
  public.skill_progress, public.achievement_history, public.conversations, public.messages,
  public.conversation_summaries, public.ai_context_records, public.ai_requests,
  public.user_update_relevance, public.update_delivery_history, public.user_access_overrides,
  public.career_roles, public.skill_categories, public.skills, public.skill_aliases, public.skill_dependencies,
  public.topics, public.learning_resources, public.technology_categories, public.technologies,
  public.technology_sources, public.technology_updates, public.feature_controls, public.admin_audit_logs
  TO authenticated;

GRANT SELECT (id, email, phone, status, verified_contact, last_active_at, created_at) ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_profiles, public.user_preferences TO authenticated;

-- R12: private queue inputs; job reads use EP-J01 exclusively.
REVOKE SELECT ON public.ai_requests FROM authenticated;
DROP FUNCTION private.apply_owner_policies(regclass, text);
```

---

# 12. Seed Data (`018_seed.sql` & `019_tests.sql` & `020_gaps_and_alignment.sql`)

## 12.1 `018_seed.sql`

```sql
-- 018_seed.sql
INSERT INTO public.feature_controls (feature_key, enabled, default_user_enabled) VALUES
  ('roadmap_generator',  true, true),
  ('daily_plan',         true, true),
  ('quiz_practice',      true, true),
  ('ai_practice_review', true, true),
  ('progress_tracking',  true, true),
  ('ai_mentor',          true, true),
  ('technology_update',  true, false)
ON CONFLICT (feature_key) DO NOTHING;

INSERT INTO public.system_configurations (config_key, config_value, description) VALUES
  ('roadmap.max_active',                   '3'::jsonb,  'PRD §16: maximum non-archived roadmaps per user'),
  ('career_goal.max_clarification_rounds', '2'::jsonb,  'PRD §15'),
  ('quiz.retry_limit',                     '1'::jsonb,  'PRD §32: one retry per topic quiz'),
  ('quiz.standard_mcq_count',              '20'::jsonb, 'PRD §29'),
  ('quiz.standard_free_response_min',      '5'::jsonb,  'PRD §29'),
  ('quiz.standard_free_response_max',      '10'::jsonb, 'PRD §29'),
  ('retention.raw_response_days',          '90'::jsonb, 'PRD §52: raw short free-response text'),
  ('retention.mentor_message_days',        '90'::jsonb, 'PRD §52: full mentor messages'),
  ('retention.ai_operational_log_days',    '30'::jsonb, 'PRD §52: AI / operational logs (maximum)'),
  ('career_knowledge.review_days',         '90'::jsonb, 'PRD §23: default review target'),
  ('technology_update.active_window_days', '7'::jsonb,  'PRD §39: eligibility activity window')
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO public.career_roles (slug, name, description) VALUES
  ('frontend-development',          'Frontend Development',              'Builds user-facing web interfaces'),
  ('backend-development',           'Backend Development',               'Builds server-side services and APIs'),
  ('full-stack-development',        'Full-Stack Development',            'Builds both frontend and backend'),
  ('qa-software-testing',           'QA / Software Testing',             'Designs and runs software tests'),
  ('qa-automation-sdet',            'QA Automation / SDET',              'Builds automated test systems'),
  ('devops',                        'DevOps',                            'Automates delivery and operations'),
  ('site-reliability-engineering',  'Site Reliability Engineering',      'Operates reliable production systems'),
  ('cloud-engineering',             'Cloud Engineering',                 'Designs and operates cloud infrastructure'),
  ('cybersecurity',                 'Cybersecurity',                     'Secures software and systems'),
  ('mobile-development',            'Mobile Development',                'Builds mobile applications'),
  ('data-engineering',              'Data Engineering',                  'Builds data pipelines and platforms'),
  ('ai-ml-engineering',             'AI / Machine Learning Engineering', 'Builds machine learning systems'),
  ('ai-application-llm-engineering','AI Application / LLM Engineering',  'Builds applications on language models')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.skill_categories (slug, name) VALUES
  ('software-engineering-fundamentals','Software Engineering Fundamentals'),
  ('programming-languages','Programming Languages'),
  ('web-development','Web Development'),
  ('databases','Databases'),
  ('cloud-infrastructure','Cloud and Infrastructure'),
  ('devops-tooling','DevOps Tooling'),
  ('testing-quality','Testing and Quality'),
  ('security','Security'),
  ('mobile-development','Mobile Development'),
  ('data-engineering','Data Engineering'),
  ('ai-machine-learning','AI and Machine Learning')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.technology_categories (slug, name) VALUES
  ('languages-runtimes','Languages and Runtimes'),
  ('frameworks-libraries','Frameworks and Libraries'),
  ('databases-storage','Databases and Storage'),
  ('cloud-platforms','Cloud Platforms'),
  ('devops-tooling','DevOps Tooling'),
  ('security-tooling','Security Tooling'),
  ('ai-ml-platforms','AI and ML Platforms')
ON CONFLICT (slug) DO NOTHING;
```

## 12.2 `019_tests.sql`

```sql
-- 019_tests.sql
DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_tables WHERE schemaname = 'public';
  IF v_n <> 46 THEN RAISE EXCEPTION 'DMS check: expected 46 tables, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public' AND t.typtype = 'e';
  IF v_n <> 41 THEN RAISE EXCEPTION 'DMS check: expected 41 enums, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx\_%';
  IF v_n <> 99 THEN RAISE EXCEPTION 'DMS check: expected 99 secondary indexes, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal;
  IF v_n <> 62 THEN RAISE EXCEPTION 'DMS check: expected 62 triggers, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public';
  IF v_n <> 44 THEN RAISE EXCEPTION 'DMS check: expected 44 policies, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'private';
  IF v_n <> 20 THEN RAISE EXCEPTION 'DMS check: expected 20 private functions, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF v_n <> 0 THEN RAISE EXCEPTION 'DMS check: % tables without RLS', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p');
  IF v_n <> 0 THEN RAISE EXCEPTION 'DMS check: % tables without primary key', v_n; END IF;

  SELECT count(*) INTO v_n
  FROM pg_constraint c
  WHERE c.contype='f' AND c.connamespace='public'::regnamespace
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid=c.conrelid AND i.indisvalid AND i.indisready
        AND i.indnkeyatts >= cardinality(c.conkey)
        AND NOT EXISTS (SELECT 1 FROM generate_subscripts(c.conkey,1) s
                        WHERE i.indkey[s-1] <> c.conkey[s])
        AND (i.indpred IS NULL OR
          (cardinality(c.conkey)=1 AND pg_get_expr(i.indpred,i.indrelid) =
            '(' || quote_ident((SELECT attname FROM pg_attribute
                 WHERE attrelid=c.conrelid AND attnum=c.conkey[1])) || ' IS NOT NULL)')))
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
    ('public.users'::regclass,'fk_users_suspended_by'::name,ARRAY['suspended_by']::name[]),
    ('public.admin_users'::regclass,'admin_users_created_by_fkey'::name,ARRAY['created_by']::name[]),
    ('public.system_configurations'::regclass,'system_configurations_updated_by_fkey'::name,ARRAY['updated_by']::name[]),
    ('public.feature_controls'::regclass,'feature_controls_updated_by_fkey'::name,ARRAY['updated_by']::name[]),
    ('public.user_access_overrides'::regclass,'user_access_overrides_updated_by_fkey'::name,ARRAY['updated_by']::name[])) AS e(tbl,constraint_name,cols)
      WHERE c.conrelid=e.tbl AND c.conname=e.constraint_name
        AND e.cols=ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord));
  IF v_n <> 0 THEN RAISE EXCEPTION 'DMS check: % foreign keys without a leading index', v_n; END IF;

  SELECT count(*) INTO v_n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated') AND privilege_type = 'DELETE';
  IF v_n <> 0 THEN RAISE EXCEPTION 'DMS check: client roles hold DELETE on % tables', v_n; END IF;

  SELECT count(*) INTO v_n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee = 'anon';
  IF v_n <> 0 THEN RAISE EXCEPTION 'DMS check: anon holds % table grants', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.feature_controls;
  IF v_n <> 7 THEN RAISE EXCEPTION 'DMS check: expected 7 feature controls, found %', v_n; END IF;
END $$;
```

## 12.3 `020_gaps_and_alignment.sql` (Closes Gaps `G1`–`G3`, Enforces `ADR-019` & `ADR-020`)

```sql
-- 020_gaps_and_alignment.sql
-- Purpose: Close API Spec v1.5.1 Gaps G1 (Ratings/Reports), G2 (Account Deletion Requests with ON DELETE SET NULL tombstone per ADR-020),
--          G3 (User Skill Alias Interpretations), seed AI SD v1.1.1 configurable limits,
--          enforce backend-mediated profile writes (ADR-019), and assert the 50-table catalog.

CREATE TYPE public.rating_target           AS ENUM ('roadmap_draft','roadmap_merge','topic_content','technology_update');
CREATE TYPE public.report_target           AS ENUM ('quiz_question','practice_review','topic_content','roadmap_content');
CREATE TYPE public.report_reason           AS ENUM ('incorrect','unclear','unfair_scoring','inappropriate','outdated','other');
CREATE TYPE public.deletion_request_status AS ENUM ('scheduled','in_progress','completed');

CREATE TABLE public.user_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  target_type public.rating_target NOT NULL,
  target_id   uuid NOT NULL,
  score       smallint NOT NULL,
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_ratings_user_target UNIQUE (user_id, target_type, target_id),
  CONSTRAINT ck_user_ratings_score CHECK (score BETWEEN 1 AND 5),
  CONSTRAINT ck_user_ratings_comment CHECK (comment IS NULL OR length(comment) <= 500)
);

CREATE TABLE public.content_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  target_type public.report_target NOT NULL,
  target_id   uuid NOT NULL,
  reason      public.report_reason NOT NULL,
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_content_reports_user_target UNIQUE (user_id, target_type, target_id),
  CONSTRAINT ck_content_reports_comment CHECK (comment IS NULL OR length(comment) <= 1000)
);

-- ADR-020: user_id uses ON DELETE SET NULL so an locally completed, temporarily pseudonymous status='completed' tombstone survives user cascade deletion
CREATE TABLE public.account_deletion_requests (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid REFERENCES public.users (id) ON DELETE SET NULL,
  status                      public.deletion_request_status NOT NULL DEFAULT 'scheduled',
  provider_deletion_requested boolean NOT NULL DEFAULT false,
  requested_at                timestamptz NOT NULL DEFAULT now(),
  completed_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_account_deletion_completed CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CONSTRAINT ck_account_deletion_active_user CHECK (status = 'completed' OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX uq_account_deletion_one_active
  ON public.account_deletion_requests (user_id) WHERE status IN ('scheduled','in_progress');

ALTER TABLE public.account_deletion_requests
  ADD COLUMN provider_cleanup jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN provider_cleanup_expires_at timestamptz;
ALTER TABLE public.account_deletion_requests ADD CONSTRAINT ck_provider_cleanup
  CHECK (jsonb_typeof(provider_cleanup)='array' AND
    octet_length(provider_cleanup::text)<=16384 AND
    (provider_cleanup='[]'::jsonb OR provider_cleanup_expires_at IS NOT NULL));
ALTER TABLE public.account_deletion_requests ADD CONSTRAINT ck_provider_cleanup_expiry
  CHECK (provider_cleanup_expires_at IS NULL OR
    provider_cleanup_expires_at <= requested_at + interval '30 days');
REVOKE SELECT ON public.account_deletion_requests FROM authenticated;

CREATE OR REPLACE FUNCTION private.complete_deletion_on_user_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.account_deletion_requests
     SET status = 'completed', completed_at = clock_timestamp()
   WHERE user_id = OLD.id AND status IN ('scheduled','in_progress');
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION private.complete_deletion_on_user_delete()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.complete_deletion_on_user_delete() TO service_role;
CREATE TRIGGER trg_users_complete_deletion
BEFORE DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION private.complete_deletion_on_user_delete();

CREATE TABLE public.user_skill_aliases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  input_alias      text NOT NULL,
  alias_normalized text NOT NULL,
  skill_id         uuid NOT NULL REFERENCES public.skills (id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_skill_aliases_norm UNIQUE (user_id, alias_normalized),
  CONSTRAINT ck_user_skill_aliases_len CHECK (length(btrim(input_alias)) BETWEEN 1 AND 80)
);

CREATE INDEX idx_user_ratings_target      ON public.user_ratings (target_type, target_id);
CREATE INDEX idx_content_reports_target   ON public.content_reports (target_type, target_id);
CREATE INDEX idx_user_skill_aliases_skill ON public.user_skill_aliases (skill_id);
CREATE INDEX idx_account_deletion_requests_user ON public.account_deletion_requests (user_id) WHERE user_id IS NOT NULL;

-- R27: all trusted writers MUST acquire the target advisory lock in a
-- preceding READ COMMITTED statement before INSERT (service protocol below).
CREATE OR REPLACE FUNCTION private.evaluate_content_report_threshold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_threshold integer;
  v_count     integer;
BEGIN
  SELECT COALESCE((SELECT (config_value #>> '{}')::integer
                   FROM public.system_configurations
                   WHERE config_key = 'quality.report_auto_hide_threshold'), 5)
    INTO v_threshold;

  SELECT count(DISTINCT user_id) INTO v_count
  FROM public.content_reports
  WHERE target_type = NEW.target_type AND target_id = NEW.target_id;

  IF v_count >= v_threshold THEN
    IF NEW.target_type = 'topic_content' THEN
      UPDATE public.topics
         SET status = 'hidden', hidden_at = COALESCE(hidden_at, now()),
             hidden_reason = COALESCE(hidden_reason, 'Auto-hidden: report threshold reached')
       WHERE id = NEW.target_id AND status <> 'hidden';
    ELSIF NEW.target_type = 'quiz_question' THEN
      UPDATE public.quiz_questions
         SET hidden_at = COALESCE(hidden_at, now()),
             hidden_reason = COALESCE(hidden_reason, 'Auto-hidden: report threshold reached')
       WHERE id = NEW.target_id AND hidden_at IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.evaluate_content_report_threshold() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.evaluate_content_report_threshold() TO service_role;

CREATE TRIGGER trg_user_ratings_updated_at BEFORE UPDATE ON public.user_ratings
  FOR EACH ROW EXECUTE FUNCTION private.update_updated_at_column();
CREATE TRIGGER trg_account_deletion_requests_updated_at BEFORE UPDATE ON public.account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION private.update_updated_at_column();
CREATE TRIGGER trg_user_skill_aliases_updated_at BEFORE UPDATE ON public.user_skill_aliases
  FOR EACH ROW EXECUTE FUNCTION private.update_updated_at_column();
CREATE TRIGGER trg_content_reports_append_only BEFORE UPDATE OR DELETE ON public.content_reports
  FOR EACH ROW EXECUTE FUNCTION private.prevent_row_modification();
CREATE TRIGGER trg_content_reports_threshold AFTER INSERT ON public.content_reports
  FOR EACH ROW EXECUTE FUNCTION private.evaluate_content_report_threshold();

-- ADR-019: revoke direct client writes on user_profiles and user_preferences
REVOKE INSERT, UPDATE ON public.user_profiles, public.user_preferences FROM authenticated;
DROP POLICY IF EXISTS user_profiles_owner_insert    ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_owner_update    ON public.user_profiles;
DROP POLICY IF EXISTS user_preferences_owner_insert ON public.user_preferences;
DROP POLICY IF EXISTS user_preferences_owner_update ON public.user_preferences;

ALTER TABLE public.user_ratings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_reports           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_skill_aliases        ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_ratings_owner_select ON public.user_ratings FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY content_reports_owner_select ON public.content_reports FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));
CREATE POLICY account_deletion_requests_owner_select ON public.account_deletion_requests FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY user_skill_aliases_owner_select ON public.user_skill_aliases FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.status = 'active'));

GRANT SELECT ON public.user_ratings, public.content_reports,
                public.account_deletion_requests, public.user_skill_aliases TO authenticated;
GRANT ALL ON public.user_ratings, public.content_reports,
             public.account_deletion_requests, public.user_skill_aliases TO service_role;
-- R35: final privilege after the earlier shared GRANT list.
REVOKE SELECT ON public.account_deletion_requests FROM authenticated;

INSERT INTO public.system_configurations (config_key, config_value, description) VALUES
  ('quality.report_auto_hide_threshold', '5'::jsonb,  'PRD §24: independent user reports required to auto-hide shared content'),
  ('roadmap.soft_size_max_topics',       '45'::jsonb, 'PRD §20: soft topic count guardrail before materially_large warning'),
  ('ai_quota.roadmap_drafts_per_24h',    '5'::jsonb,  'AI SD §15.1: default max roadmap draft generations per user per 24h'),
  ('ai_quota.mentor_messages_per_24h',   '50'::jsonb, 'AI SD §15.1: default max mentor chat messages per user per 24h')
ON CONFLICT (config_key) DO NOTHING;

-- Final 50-table catalog assertion gate
DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_tables WHERE schemaname = 'public';
  IF v_n <> 50 THEN RAISE EXCEPTION 'DMS 020 check: expected 50 tables, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public' AND t.typtype = 'e';
  IF v_n <> 45 THEN RAISE EXCEPTION 'DMS 020 check: expected 45 enums, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx\_%';
  IF v_n <> 103 THEN RAISE EXCEPTION 'DMS 020 check: expected 103 secondary indexes, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal;
  IF v_n <> 68 THEN RAISE EXCEPTION 'DMS 020 check: expected 68 triggers, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public';
  IF v_n <> 44 THEN RAISE EXCEPTION 'DMS 020 check: expected 44 policies, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'private';
  IF v_n <> 22 THEN RAISE EXCEPTION 'DMS 020 check: expected 22 private functions, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated') AND privilege_type IN ('INSERT','UPDATE','DELETE');
  IF v_n <> 0 THEN RAISE EXCEPTION 'DMS 020 check: client roles hold write/delete grants on % tables (violates ADR-019)', v_n; END IF;
END $$;
```

---

# 13. Testing Suite (`scripts/db/*` & `supabase/tests/database/001`–`008`)

## 13.1 Migration Verification Scripts

```bash
#!/usr/bin/env bash
# scripts/db/check-migration-order.sh
set -euo pipefail
cd "$(dirname "$0")/../../supabase/migrations"
prev=""
for f in $(ls -1 *.sql | sort); do
  num="${f%%_*}"
  if [[ -n "$prev" && ! "$num" > "$prev" ]]; then echo "ORDER ERROR: $f after $prev"; exit 1; fi
  prev="$num"
done
expected=$(printf '%03d ' $(seq 0 20))
actual=$(ls -1 | grep -E '^[0-9]{3}_' | cut -d_ -f1 | tr '\n' ' ')
[[ "$actual" == "$expected" ]] || { echo "Expected [$expected] got [$actual]"; exit 1; }
echo "migration order OK (000..020)"
```

```bash
#!/usr/bin/env bash
# scripts/db/test-fresh-install.sh
set -euo pipefail
: "${DB_URL:=postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
supabase db reset
psql "$DB_URL" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public'" | grep -qx 50
supabase db lint --level error
supabase test db
echo "fresh install OK"
```

```bash
#!/usr/bin/env bash
# scripts/db/test-failure-handling.sh
set -uo pipefail
: "${DB_URL:=postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
BROKEN=supabase/migrations/20990101000000_broken_probe.sql
cat > "$BROKEN" <<'SQL'
CREATE TABLE public.tmp_failure_probe (id int);
SELECT 1/0;
SQL
if supabase migration up --local; then
  echo "FAIL: broken migration was applied"; rm -f "$BROKEN"; exit 1
fi
exists=$(psql "$DB_URL" -Atc "SELECT to_regclass('public.tmp_failure_probe') IS NOT NULL")
recorded=$(psql "$DB_URL" -Atc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20990101000000'")
rm -f "$BROKEN"
[[ "$exists" == "f" && "$recorded" == "0" ]] || { echo "FAIL: partial state (exists=$exists recorded=$recorded)"; exit 1; }
echo "failure handling OK"
```

## 13.2 Complete pgTAP Test Suite (`001` – `008`, 185 Assertions, 100% Valid Hex UUIDs)

### `001_schema.test.sql` (110 Assertions)
```sql
-- supabase/tests/database/001_schema.test.sql
BEGIN;
SELECT plan(110);

SELECT tables_are('public', ARRAY[
  'users','user_auth_providers','user_profiles','user_preferences','account_deletion_requests',
  'career_roles','skill_categories','skills','skill_aliases','user_skill_aliases','skill_dependencies','career_goals',
  'roadmaps','roadmap_versions','roadmap_items','roadmap_merges','roadmap_merge_items',
  'topics','learning_resources','daily_plans','daily_plan_items',
  'quizzes','quiz_questions','quiz_attempts','quiz_answers','practice_reviews',
  'learning_evidence','skill_progress','achievement_history',
  'conversations','messages','conversation_summaries','ai_context_records',
  'ai_models','prompt_versions','ai_requests','ai_generations',
  'technology_categories','technologies','technology_sources','technology_updates',
  'user_update_relevance','update_delivery_history',
  'user_ratings','content_reports',
  'admin_users','system_configurations','feature_controls','user_access_overrides','admin_audit_logs'],
  'All 50 required tables exist in public schema');

SELECT is((SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public' AND t.typtype = 'e'), 45, 'All 45 domain enum types exist');

SELECT has_pk('public', c.relname::name, 'Table public.' || c.relname || ' has a primary key')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname;

SELECT ok(c.relrowsecurity, 'RLS is enabled on table public.' || c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname;

SELECT is_empty($$
  SELECT c.conrelid::regclass AS table_name,c.conname AS constraint_name
  FROM pg_constraint c
  WHERE c.contype='f' AND c.connamespace='public'::regnamespace
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid=c.conrelid AND i.indisvalid AND i.indisready
        AND i.indnkeyatts >= cardinality(c.conkey)
        AND NOT EXISTS (SELECT 1 FROM generate_subscripts(c.conkey,1) s
                        WHERE i.indkey[s-1] <> c.conkey[s])
        AND (i.indpred IS NULL OR
          (cardinality(c.conkey)=1 AND pg_get_expr(i.indpred,i.indrelid) =
            '(' || quote_ident((SELECT attname FROM pg_attribute
                 WHERE attrelid=c.conrelid AND attnum=c.conkey[1])) || ' IS NOT NULL)')))
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
    ('public.users'::regclass,'fk_users_suspended_by'::name,ARRAY['suspended_by']::name[]),
    ('public.admin_users'::regclass,'admin_users_created_by_fkey'::name,ARRAY['created_by']::name[]),
    ('public.system_configurations'::regclass,'system_configurations_updated_by_fkey'::name,ARRAY['updated_by']::name[]),
    ('public.feature_controls'::regclass,'feature_controls_updated_by_fkey'::name,ARRAY['updated_by']::name[]),
    ('public.user_access_overrides'::regclass,'user_access_overrides_updated_by_fkey'::name,ARRAY['updated_by']::name[])) AS e(tbl,constraint_name,cols)
      WHERE c.conrelid=e.tbl AND c.conname=e.constraint_name
        AND e.cols=ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord))
$$, 'Every foreign key column has a leading index');

SELECT is((SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%'),
          103, 'All 103 secondary indexes exist');

SELECT col_type_is('public', 'user_profiles', 'preferred_daily_hours', 'numeric(3,1)', 'preferred_daily_hours is numeric(3,1)');
SELECT col_type_is('public', 'skill_progress', 'learning_state', 'learning_state', 'learning_state is enum learning_state');
SELECT col_not_null('public', 'ai_requests', 'status', 'ai_requests.status is NOT NULL');
SELECT col_default_is('public', 'feature_controls', 'default_user_enabled', 'true', 'default_user_enabled defaults to true');
SELECT fk_ok('public', 'roadmaps', 'career_goal_id', 'public', 'career_goals', 'id', 'roadmaps.career_goal_id points to career_goals.id');
SELECT hasnt_column('public', 'skill_progress', 'job_ready', 'No job_ready column exists in skill_progress (PRD §36)');

SELECT * FROM finish();
ROLLBACK;
```

### `002_constraints.test.sql` (12 Assertions)
```sql
-- supabase/tests/database/002_constraints.test.sql
BEGIN;
SELECT plan(12);

CREATE FUNCTION pg_temp.mk_user(p uuid, e text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (p, e);
  INSERT INTO public.users (id, email) VALUES (p, e);
$$;
SELECT pg_temp.mk_user('aaaaaaaa-0000-0000-0000-000000000001', 'test_user1@test.local');

INSERT INTO public.skills (id, slug, canonical_name) VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1', 'test-skill', 'Test Skill');
INSERT INTO public.topics (id, skill_id, slug, title, career_level)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'test-topic', 'Test Topic', 'mid');
INSERT INTO public.quizzes (id, topic_id, mcq_count, free_response_count)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000b1', 20, 5);
INSERT INTO public.career_goals (id, user_id, goal_text, status, confirmed_role_id, target_level, confirmed_at)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Backend Dev', 'confirmed',
          (SELECT id FROM public.career_roles LIMIT 1), 'mid', now());
INSERT INTO public.roadmaps (id, user_id, career_goal_id, canonical_role_id, target_level)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-0000000000d1', (SELECT id FROM public.career_roles LIMIT 1), 'mid');

SELECT throws_ok(
  $$UPDATE public.users SET phone = '01712345678' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'Invalid phone format without +880 is rejected');

SELECT throws_ok(
  $$UPDATE public.users SET status = 'suspended' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'Suspension status without suspended_at timestamp is rejected');

SELECT throws_ok(
  $$INSERT INTO public.user_profiles (user_id, preferred_daily_hours) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 0.7)$$,
  '23514', NULL, 'Non-0.5 step preferred_daily_hours is rejected');

SELECT throws_ok(
  $$INSERT INTO public.user_profiles (user_id, existing_skills_none, self_reported_skill_ids)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', true, ARRAY[gen_random_uuid()])$$,
  '23514', NULL, 'existing_skills_none cannot coexist with non-empty skills list');

SELECT throws_ok(
  $$UPDATE public.career_goals SET clarification_round = 3 WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000d1'$$,
  '23514', NULL, 'Clarification round > 2 is rejected');

SELECT throws_ok(
  $$INSERT INTO public.quiz_questions (quiz_id, sort_order, question_type, difficulty, prompt, options, correct_option_id)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 1, 'mcq', 'basic', 'Q?',
            '[{"option_id":"a","text":"optA"},{"option_id":"b","text":"optB"}]', 'invalid_opt')$$,
  '23514', NULL, 'MCQ correct_option_id must exist in options array');

SELECT throws_ok(
  $$INSERT INTO public.quizzes (topic_id, content_version, mcq_count, free_response_count)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000b1', 2, 10, 5)$$,
  '23514', NULL, 'Non-standard quiz counts rejected when is_reduced = false');

SELECT throws_ok(
  $$INSERT INTO public.update_delivery_history (user_id, local_date, state)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'available')$$,
  '23514', NULL, 'Update state available requires non-null update_id');

INSERT INTO public.update_delivery_history (user_id, local_date, state)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'no_important_changes');
SELECT throws_ok(
  $$INSERT INTO public.update_delivery_history (user_id, local_date, state)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'temporarily_unavailable')$$,
  '23505', NULL, 'Duplicate delivery record for same user on same local_date is rejected');

SELECT throws_ok(
  $$UPDATE public.roadmaps SET is_focus = true WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000e1'$$,
  '23514', NULL, 'Focus roadmap cannot be in draft status');

INSERT INTO public.roadmap_versions (roadmap_id, user_id, version_no, created_by, target_level)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000001', 1, 'ai', 'mid');
SELECT throws_ok(
  $$INSERT INTO public.roadmap_versions (roadmap_id, user_id, version_no, created_by, target_level)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000001', 2, 'ai', 'mid')$$,
  '23505', NULL, 'At most one open draft per roadmap is permitted');

SELECT lives_ok(
  $$UPDATE public.users SET phone = '+8801712345678' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'Valid +880 Bangladesh phone number passes validation');

SELECT * FROM finish();
ROLLBACK;
```

### `003_rls_security.test.sql` (16 Assertions)
```sql
-- supabase/tests/database/003_rls_security.test.sql
BEGIN;
SELECT plan(16);

CREATE FUNCTION pg_temp.mk_user(p uuid, e text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (p, e);
  INSERT INTO public.users (id, email) VALUES (p, e);
$$;
SELECT pg_temp.mk_user('cccccccc-0000-0000-0000-00000000000a', 'alice@test.local');
SELECT pg_temp.mk_user('cccccccc-0000-0000-0000-00000000000b', 'bob@test.local');
SELECT pg_temp.mk_user('cccccccc-0000-0000-0000-00000000000c', 'admin@test.local');
INSERT INTO public.admin_users (user_id) VALUES ('cccccccc-0000-0000-0000-00000000000c');

INSERT INTO public.career_goals (user_id, goal_text) VALUES
  ('cccccccc-0000-0000-0000-00000000000a', 'Alice Goal'),
  ('cccccccc-0000-0000-0000-00000000000b', 'Bob Goal');
INSERT INTO public.user_profiles (user_id, current_role_title) VALUES
  ('cccccccc-0000-0000-0000-00000000000a', 'Alice Engineer'),
  ('cccccccc-0000-0000-0000-00000000000b', 'Bob Developer');
INSERT INTO public.conversations (id, user_id) VALUES ('cccccccc-0000-0000-0000-0000000000c2', 'cccccccc-0000-0000-0000-00000000000b');
INSERT INTO public.messages (conversation_id, user_id, role, content)
  VALUES ('cccccccc-0000-0000-0000-0000000000c2', 'cccccccc-0000-0000-0000-00000000000b', 'user', 'Confidential chat message from Bob');
INSERT INTO public.ai_context_records (user_id, context_type, summary_text, valid_until)
  VALUES ('cccccccc-0000-0000-0000-00000000000b', 'profile', 'Bob context summary', now() + interval '1 day');
INSERT INTO public.skills (id, slug, canonical_name) VALUES ('cccccccc-0000-0000-0000-0000000000a1', 'rls-test-skill', 'RLS Skill');
INSERT INTO public.topics (skill_id, slug, title, career_level, status, explanation_markdown, approved_at)
  VALUES ('cccccccc-0000-0000-0000-0000000000a1', 'rls-approved-topic', 'Approved Topic', 'mid', 'approved', 'Content', now());
INSERT INTO public.topics (skill_id, slug, title, career_level, status)
  VALUES ('cccccccc-0000-0000-0000-0000000000a1', 'rls-draft-topic', 'Draft Topic', 'mid', 'draft');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'cccccccc-0000-0000-0000-00000000000a', 'role', 'authenticated')::text, true);

SELECT is((SELECT count(*)::int FROM public.career_goals), 1, 'Alice sees exactly her own career goal');
SELECT is((SELECT count(*)::int FROM public.career_goals WHERE user_id = 'cccccccc-0000-0000-0000-00000000000b'), 0, 'Alice cannot see Bob career goal');
SELECT is((SELECT count(*)::int FROM public.messages), 0, 'Alice cannot see Bob mentor messages');
SELECT throws_ok($$INSERT INTO public.career_goals (user_id, goal_text) VALUES ('cccccccc-0000-0000-0000-00000000000a', 'Direct Insert')$$,
  '42501', NULL, 'Direct client INSERT on career_goals is denied');
SELECT throws_ok($$UPDATE public.career_goals SET goal_text = 'Tampered' WHERE user_id = 'cccccccc-0000-0000-0000-00000000000a'$$,
  '42501', NULL, 'Direct client UPDATE on career_goals is denied');
SELECT throws_ok($$DELETE FROM public.career_goals WHERE user_id = 'cccccccc-0000-0000-0000-00000000000a'$$,
  '42501', NULL, 'Client DELETE privilege is entirely revoked');
SELECT is((SELECT current_role_title FROM public.user_profiles WHERE user_id = 'cccccccc-0000-0000-0000-00000000000a'),
  'Alice Engineer', 'Alice can read her own user_profile');
SELECT throws_ok($$UPDATE public.user_profiles SET current_role_title = 'Bypass API' WHERE user_id = 'cccccccc-0000-0000-0000-00000000000a'$$,
  '42501', NULL, 'Direct client UPDATE on user_profiles is blocked per ADR-019 (must use NestJS API)');
SELECT throws_ok($$SELECT * FROM public.quiz_questions$$,
  '42501', NULL, 'Direct client access to quiz_questions answer keys is denied');
SELECT is((SELECT count(*)::int FROM public.topics WHERE slug = 'rls-approved-topic'), 1, 'Approved shared topic is readable');
SELECT is((SELECT count(*)::int FROM public.topics WHERE slug = 'rls-draft-topic'), 0, 'Draft shared topic is hidden from client');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'cccccccc-0000-0000-0000-00000000000c', 'role', 'authenticated')::text, true);

SELECT is((SELECT count(*)::int FROM public.users WHERE id IN ('cccccccc-0000-0000-0000-00000000000a','cccccccc-0000-0000-0000-00000000000b')), 2,
  'Admin can query all user accounts for administration');
SELECT is((SELECT count(*)::int FROM public.messages), 0,
  'CRITICAL PRIVACY: Admin CANNOT read private mentor messages (PRD §51)');
SELECT is((SELECT count(*)::int FROM public.conversations), 0,
  'CRITICAL PRIVACY: Admin CANNOT read user conversations');
SELECT is((SELECT count(*)::int FROM public.ai_context_records), 0,
  'CRITICAL PRIVACY: Admin CANNOT read AI context memory records');

RESET ROLE;
UPDATE public.users SET status = 'suspended', suspended_at = now() WHERE id = 'cccccccc-0000-0000-0000-00000000000c';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'cccccccc-0000-0000-0000-00000000000c', 'role', 'authenticated')::text, true);

SELECT is((SELECT count(*)::int FROM public.users), 1,
  'Suspended admin immediately loses elevated multi-user read privileges');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
```

### `004_trigger_behavior.test.sql` (11 Assertions)
```sql
-- supabase/tests/database/004_trigger_behavior.test.sql
BEGIN;
SELECT plan(11);

CREATE FUNCTION pg_temp.mk_user(p uuid, e text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (p, e);
  INSERT INTO public.users (id, email) VALUES (p, e);
$$;
SELECT pg_temp.mk_user('dddddddd-0000-0000-0000-000000000001', 'trg_user1@test.local');
SELECT pg_temp.mk_user('dddddddd-0000-0000-0000-000000000002', 'trg_user2@test.local');

INSERT INTO public.career_goals (id, user_id, goal_text, status, confirmed_role_id, target_level, confirmed_at)
  VALUES ('dddddddd-0000-0000-0000-0000000000d1', 'dddddddd-0000-0000-0000-000000000001', 'Goal', 'confirmed',
          (SELECT id FROM public.career_roles LIMIT 1), 'mid', now());
INSERT INTO public.roadmaps (id, user_id, career_goal_id, canonical_role_id, target_level)
  VALUES ('dddddddd-0000-0000-0000-0000000000e1', 'dddddddd-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-0000000000d1', (SELECT id FROM public.career_roles LIMIT 1), 'mid');

SELECT throws_ok(
  $$INSERT INTO public.roadmap_versions (roadmap_id, user_id, version_no, created_by, target_level)
    VALUES ('dddddddd-0000-0000-0000-0000000000e1', 'dddddddd-0000-0000-0000-000000000002', 1, 'ai', 'mid')$$,
  '42501', NULL, 'Cross-user child record insert is rejected by ownership validation trigger');

SELECT lives_ok(
  $$INSERT INTO public.roadmap_versions (id, roadmap_id, user_id, version_no, created_by, target_level)
    VALUES ('dddddddd-0000-0000-0000-0000000000f1', 'dddddddd-0000-0000-0000-0000000000e1',
            'dddddddd-0000-0000-0000-000000000001', 1, 'ai', 'mid')$$,
  'Owner can insert roadmap_version for own roadmap');

SELECT throws_ok(
  $$UPDATE public.roadmap_versions SET summary = '{"tampered":true}' WHERE id = 'dddddddd-0000-0000-0000-0000000000f1'$$,
  '55000', NULL, 'Modifying immutable roadmap_versions summary throws IMMUTABLE_ROW');

SELECT throws_ok(
  $$UPDATE public.roadmap_versions SET state = 'restored' WHERE id = 'dddddddd-0000-0000-0000-0000000000f1'$$,
  '23514', NULL, 'Illegal state transition draft -> restored is rejected');

INSERT INTO public.skills (id, slug, canonical_name) VALUES ('dddddddd-0000-0000-0000-0000000000a1', 'trg-skill', 'TRG Skill');
INSERT INTO public.topics (id, skill_id, slug, title, career_level)
  VALUES ('dddddddd-0000-0000-0000-0000000000b1', 'dddddddd-0000-0000-0000-0000000000a1', 'trg-topic', 'TRG Topic', 'mid');
INSERT INTO public.learning_evidence (id, user_id, skill_id, career_level, topic_id, source_type, source_id, difficulty, score_summary, attempt_no, occurred_at)
  VALUES ('dddddddd-0000-0000-0000-0000000000c1', 'dddddddd-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-0000000000a1', 'mid', 'dddddddd-0000-0000-0000-0000000000b1',
          'quiz_attempt', gen_random_uuid(), 'basic', '{"mcq_correct":18,"mcq_total":20}', 1, now());

SELECT throws_ok(
  $$UPDATE public.learning_evidence SET attempt_no = 2 WHERE id = 'dddddddd-0000-0000-0000-0000000000c1'$$,
  '55000', NULL, 'Direct UPDATE on learning_evidence is rejected');

SELECT throws_ok(
  $$DELETE FROM public.learning_evidence WHERE id = 'dddddddd-0000-0000-0000-0000000000c1'$$,
  '55000', NULL, 'Direct DELETE on learning_evidence is rejected');

INSERT INTO public.admin_audit_logs (id, actor_id, action)
  VALUES ('dddddddd-0000-0000-0000-0000000000a9', 'dddddddd-0000-0000-0000-000000000001', 'audit_probe');

SELECT throws_ok(
  $$DELETE FROM public.admin_audit_logs WHERE id = 'dddddddd-0000-0000-0000-0000000000a9'$$,
  '55000', NULL, 'Direct DELETE on admin_audit_logs is rejected');

SELECT throws_ok(
  $$UPDATE public.admin_audit_logs SET action = 'tampered' WHERE id = 'dddddddd-0000-0000-0000-0000000000a9'$$,
  '55000', NULL, 'Direct UPDATE on admin_audit_logs is rejected');

SELECT lives_ok(
  $$DELETE FROM auth.users WHERE id = 'dddddddd-0000-0000-0000-000000000001'$$,
  'Account deletion cleanly cascades through append-only tables without trigger error');

SELECT is(
  (SELECT count(*)::int FROM public.learning_evidence WHERE user_id = 'dddddddd-0000-0000-0000-000000000001'),
  0, 'All user learning evidence was purged with account');

SELECT is(
  (SELECT actor_id FROM public.admin_audit_logs WHERE id = 'dddddddd-0000-0000-0000-0000000000a9'),
  NULL::uuid, 'Audit log row was preserved with actor_id nulled (compliance retention)');

SELECT * FROM finish();
ROLLBACK;
```

### `005_ai_usage.test.sql` (10 Assertions — Hex UUIDs Fixed)
```sql
-- supabase/tests/database/005_ai_usage.test.sql
BEGIN;
SELECT plan(10);

CREATE FUNCTION pg_temp.mk_user(p uuid, e text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (p, e);
  INSERT INTO public.users (id, email) VALUES (p, e);
$$;
SELECT pg_temp.mk_user('eeeeeeee-0000-0000-0000-000000000001', 'ai_tester@test.local');

INSERT INTO public.ai_models (id, provider_key, model_identifier, display_name, input_price_per_m_units, output_price_per_m_units)
  VALUES ('eeeeeeee-0000-0000-0000-0000000000a1', 'anthropic', 'claude-3-sonnet', 'Claude Sonnet', 2.50, 10.00);

INSERT INTO public.ai_requests (id, user_id, task, model_id, input_units, output_units, idempotency_key)
  VALUES ('eeeeeeee-0000-0000-0000-0000000000b1', 'eeeeeeee-0000-0000-0000-000000000001', 'mentor_chat',
          'eeeeeeee-0000-0000-0000-0000000000a1', 2000000, 500000, 'idem_key_001');

SELECT is((SELECT total_units FROM public.ai_requests WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'),
          2500000::bigint, 'total_units correctly computed by calculate_total_tokens trigger');

SELECT is((SELECT cost_usd FROM public.ai_requests WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'),
          10.00000000::numeric, 'cost_usd correctly derived from model prices by calculate_ai_cost trigger');

SELECT throws_ok(
  $$INSERT INTO public.ai_requests (user_id, task, idempotency_key)
    VALUES ('eeeeeeee-0000-0000-0000-000000000001', 'mentor_chat', 'idem_key_001')$$,
  '23505', NULL, 'Duplicate idempotency key for same user is rejected');

SELECT lives_ok(
  $$UPDATE public.ai_requests SET status = 'preparing' WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'$$,
  'Transition queued -> preparing succeeds');

SELECT ok((SELECT started_at IS NOT NULL AND attempt_count = 1 FROM public.ai_requests WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'),
  'preparing state automatically sets started_at timestamp and increments attempt_count');

SELECT lives_ok(
  $$UPDATE public.ai_requests SET status = 'succeeded' WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'$$,
  'Transition preparing -> succeeded succeeds');

SELECT ok((SELECT finished_at IS NOT NULL AND locked_at IS NULL FROM public.ai_requests WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'),
  'succeeded state sets finished_at and clears lock');

SELECT throws_ok(
  $$UPDATE public.ai_requests SET status = 'queued' WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b1'$$,
  '23514', NULL, 'Terminal state succeeded cannot transition back to queued');

SELECT throws_ok(
  $$INSERT INTO public.ai_requests (user_id, task, status, finished_at)
    VALUES ('eeeeeeee-0000-0000-0000-000000000001', 'roadmap_generate', 'failed', now())$$,
  '23514', NULL, 'Failed AI request without error_code is rejected');

INSERT INTO public.ai_requests (id, user_id, task, status, retryable, error_code, finished_at)
  VALUES ('eeeeeeee-0000-0000-0000-0000000000b2', 'eeeeeeee-0000-0000-0000-000000000001', 'quiz_generate', 'failed', true, 'UPSTREAM_503', now());

SELECT lives_ok(
  $$UPDATE public.ai_requests SET status = 'queued' WHERE id = 'eeeeeeee-0000-0000-0000-0000000000b2'$$,
  'Retryable failed request can transition back to queued');

SELECT * FROM finish();
ROLLBACK;
```

### `006_roadmap_integrity.test.sql` (6 Assertions — Hex UUIDs & Plan Fixed)
```sql
-- supabase/tests/database/006_roadmap_integrity.test.sql
BEGIN;
SELECT plan(6);

CREATE FUNCTION pg_temp.mk_user(p uuid, e text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (p, e);
  INSERT INTO public.users (id, email) VALUES (p, e);
$$;
SELECT pg_temp.mk_user('ffffffff-0000-0000-0000-000000000001', 'roadmap_tester@test.local');

CREATE FUNCTION pg_temp.create_roadmap(p_goal uuid, p_rm uuid, p_title text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.career_goals (id, user_id, goal_text, status, confirmed_role_id, target_level, confirmed_at)
    VALUES (p_goal, 'ffffffff-0000-0000-0000-000000000001', p_title, 'confirmed', (SELECT id FROM public.career_roles LIMIT 1), 'mid', now());
  INSERT INTO public.roadmaps (id, user_id, career_goal_id, canonical_role_id, target_level, status)
    VALUES (p_rm, 'ffffffff-0000-0000-0000-000000000001', p_goal, (SELECT id FROM public.career_roles LIMIT 1), 'mid', 'draft');
$$;

SELECT pg_temp.create_roadmap(gen_random_uuid(), gen_random_uuid(), 'Goal 1');
SELECT pg_temp.create_roadmap(gen_random_uuid(), gen_random_uuid(), 'Goal 2');
SELECT pg_temp.create_roadmap(gen_random_uuid(), gen_random_uuid(), 'Goal 3');

SELECT throws_ok(
  $$SELECT pg_temp.create_roadmap(gen_random_uuid(), gen_random_uuid(), 'Goal 4')$$,
  '23514', NULL, '4th active roadmap is rejected by enforce_active_roadmap_limit trigger');

UPDATE public.roadmaps SET status = 'archived' WHERE id = (SELECT id FROM public.roadmaps LIMIT 1);
SELECT lives_ok(
  $$SELECT pg_temp.create_roadmap(gen_random_uuid(), gen_random_uuid(), 'Goal 4 after archive')$$,
  'Creating a 3rd active roadmap after archiving one succeeds');

CREATE TEMP TABLE active_rms AS
  SELECT id FROM public.roadmaps WHERE status = 'draft' LIMIT 2;

SET CONSTRAINTS fk_roadmaps_current_version DEFERRED;
UPDATE public.roadmaps SET status = 'locked', current_version_id = gen_random_uuid() WHERE id IN (SELECT id FROM active_rms);
INSERT INTO public.roadmap_versions (id, roadmap_id, user_id, version_no, state, created_by, target_level, locked_at)
SELECT current_version_id, id, 'ffffffff-0000-0000-0000-000000000001', 1, 'locked', 'ai', 'mid', now()
FROM public.roadmaps WHERE id IN (SELECT id FROM active_rms);

UPDATE public.roadmaps SET is_focus = true WHERE id = (SELECT id FROM active_rms LIMIT 1);

SELECT throws_ok(
  $$UPDATE public.roadmaps SET is_focus = true WHERE id = (SELECT id FROM active_rms OFFSET 1 LIMIT 1)$$,
  '23505', NULL, 'Setting second focus roadmap violates unique partial index uq_roadmaps_one_focus');

CREATE TEMP TABLE test_focus_rm AS SELECT id FROM active_rms LIMIT 1;
INSERT INTO public.roadmap_merges (id, roadmap_id, user_id, origin, status, base_version_id)
  VALUES ('ffffffff-0000-0000-0000-0000000000a1', (SELECT id FROM test_focus_rm),
          'ffffffff-0000-0000-0000-000000000001', 'user_request', 'proposed',
          (SELECT current_version_id FROM public.roadmaps WHERE id = (SELECT id FROM test_focus_rm)));

SELECT throws_ok(
  $$INSERT INTO public.roadmap_merges (roadmap_id, user_id, origin, status, base_version_id)
    VALUES ((SELECT id FROM test_focus_rm), 'ffffffff-0000-0000-0000-000000000001', 'user_request', 'proposed',
            (SELECT current_version_id FROM public.roadmaps WHERE id = (SELECT id FROM test_focus_rm)))$$,
  '23505', NULL, 'At most one open proposed merge per roadmap (uq_roadmap_merges_one_open)');

UPDATE public.roadmap_merges SET status = 'accepted', accepted_at = now() WHERE id = 'ffffffff-0000-0000-0000-0000000000a1';

INSERT INTO public.daily_plans (id, user_id, roadmap_id, hours_per_day)
  VALUES ('ffffffff-0000-0000-0000-0000000000b1', 'ffffffff-0000-0000-0000-000000000001', (SELECT id FROM test_focus_rm), 2);

INSERT INTO public.skills (id, slug, canonical_name) VALUES ('ffffffff-0000-0000-0000-0000000000c1', 'rm-skill', 'RM Skill');
INSERT INTO public.topics (id, skill_id, slug, title, career_level)
  VALUES ('ffffffff-0000-0000-0000-0000000000d1', 'ffffffff-0000-0000-0000-0000000000c1', 'rm-topic', 'RM Topic', 'mid');
INSERT INTO public.quizzes (id, topic_id, mcq_count, free_response_count)
  VALUES ('ffffffff-0000-0000-0000-0000000000e1', 'ffffffff-0000-0000-0000-0000000000d1', 20, 5);

INSERT INTO public.daily_plan_items (id, plan_id, user_id, day_no, lineage_id, topic_id, reconciled_by_merge_id)
  VALUES ('ffffffff-0000-0000-0000-0000000000f1', 'ffffffff-0000-0000-0000-0000000000b1',
          'ffffffff-0000-0000-0000-000000000001', 1, gen_random_uuid(), 'ffffffff-0000-0000-0000-0000000000d1',
          'ffffffff-0000-0000-0000-0000000000a1');

SELECT is((SELECT undo_window_closed_at FROM public.roadmap_merges WHERE id = 'ffffffff-0000-0000-0000-0000000000a1'),
          NULL::timestamptz, 'Undo window is open on freshly accepted merge');

INSERT INTO public.quiz_attempts (id, user_id, daily_plan_item_id, quiz_id, question_ids, status, started_at)
  VALUES ('ffffffff-0000-0000-0000-0000000000a2', 'ffffffff-0000-0000-0000-000000000001',
          'ffffffff-0000-0000-0000-0000000000f1', 'ffffffff-0000-0000-0000-0000000000e1',
          ARRAY[gen_random_uuid()], 'started', now());

SELECT isnt((SELECT undo_window_closed_at FROM public.roadmap_merges WHERE id = 'ffffffff-0000-0000-0000-0000000000a1'),
          NULL::timestamptz, 'Starting learning on reconciled plan item automatically closes merge undo window (PRD §21)');

SELECT * FROM finish();
ROLLBACK;
```

### `007_retention.test.sql` (9 Assertions — Hex UUIDs & Plan Fixed)
```sql
-- supabase/tests/database/007_retention.test.sql
BEGIN;
SELECT plan(9);

CREATE FUNCTION pg_temp.mk_user(p uuid, e text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (p, e);
  INSERT INTO public.users (id, email) VALUES (p, e);
$$;
SELECT pg_temp.mk_user('77777777-0000-0000-0000-000000000001', 'retention_tester@test.local');

INSERT INTO public.conversations (id, user_id, summarized_through_at) VALUES
  ('77777777-0000-0000-0000-0000000000c1', '77777777-0000-0000-0000-000000000001', now()),
  ('77777777-0000-0000-0000-0000000000c2', '77777777-0000-0000-0000-000000000001', NULL);

INSERT INTO public.messages (id, conversation_id, user_id, role, content, created_at, expires_at) VALUES
  ('77777777-0000-0000-0000-000000000101', '77777777-0000-0000-0000-0000000000c1',
   '77777777-0000-0000-0000-000000000001', 'user', 'old summarized message',
   now() - interval '95 days', now() - interval '5 days'),
  ('77777777-0000-0000-0000-000000000102', '77777777-0000-0000-0000-0000000000c2',
   '77777777-0000-0000-0000-000000000001', 'user', 'old unsummarized message',
   now() - interval '95 days', now() - interval '5 days');

INSERT INTO public.ai_context_records (id, user_id, context_type, summary_text, valid_until)
  VALUES ('77777777-0000-0000-0000-000000000103', '77777777-0000-0000-0000-000000000001',
          'profile', 'expired context memory', now() - interval '2 hours');

INSERT INTO public.ai_requests (id, user_id, task, status, finished_at, error_code, created_at) VALUES
  ('77777777-0000-0000-0000-000000000104', '77777777-0000-0000-0000-000000000001',
   'mentor_chat', 'failed', now() - interval '32 days', 'TIMEOUT', now() - interval '33 days'),
  ('77777777-0000-0000-0000-000000000105', '77777777-0000-0000-0000-000000000001',
   'mentor_chat', 'failed', now() - interval '10 days', 'TIMEOUT', now() - interval '11 days');

INSERT INTO public.skills (id, slug, canonical_name) VALUES ('77777777-0000-0000-0000-000000000106', 'ret-skill', 'Ret Skill');
INSERT INTO public.topics (id, skill_id, slug, title, career_level)
  VALUES ('77777777-0000-0000-0000-000000000107', '77777777-0000-0000-0000-000000000106', 'ret-topic', 'Ret Topic', 'mid');
INSERT INTO public.quizzes (id, topic_id, mcq_count, free_response_count)
  VALUES ('77777777-0000-0000-0000-000000000108', '77777777-0000-0000-0000-000000000107', 20, 5);
INSERT INTO public.quiz_questions (id, quiz_id, sort_order, question_type, difficulty, prompt, rubric)
  VALUES ('77777777-0000-0000-0000-000000000109', '77777777-0000-0000-0000-000000000108',
          1, 'free_response', 'basic', 'Explain concurrency', '{"rubric":true}');

INSERT INTO public.career_goals (id, user_id, goal_text, status, confirmed_role_id, target_level, confirmed_at)
  VALUES ('77777777-0000-0000-0000-00000000010a', '77777777-0000-0000-0000-000000000001', 'Goal', 'confirmed',
          (SELECT id FROM public.career_roles LIMIT 1), 'mid', now());
INSERT INTO public.roadmaps (id, user_id, career_goal_id, canonical_role_id, target_level)
  VALUES ('77777777-0000-0000-0000-00000000010b', '77777777-0000-0000-0000-000000000001',
          '77777777-0000-0000-0000-00000000010a', (SELECT id FROM public.career_roles LIMIT 1), 'mid');
INSERT INTO public.daily_plans (id, user_id, roadmap_id, hours_per_day)
  VALUES ('77777777-0000-0000-0000-00000000010c', '77777777-0000-0000-0000-000000000001',
          '77777777-0000-0000-0000-00000000010b', 2);
INSERT INTO public.daily_plan_items (id, plan_id, user_id, day_no, lineage_id, topic_id)
  VALUES ('77777777-0000-0000-0000-00000000010d', '77777777-0000-0000-0000-00000000010c',
          '77777777-0000-0000-0000-000000000001', 1, gen_random_uuid(), '77777777-0000-0000-0000-000000000107');
INSERT INTO public.quiz_attempts (id, user_id, daily_plan_item_id, quiz_id, question_ids)
  VALUES ('77777777-0000-0000-0000-00000000010e', '77777777-0000-0000-0000-000000000001',
          '77777777-0000-0000-0000-00000000010d', '77777777-0000-0000-0000-000000000108',
          ARRAY['77777777-0000-0000-0000-000000000109'::uuid]);

INSERT INTO public.quiz_answers (id, attempt_id, user_id, question_id, answer_text, raw_text_expires_at)
  VALUES ('77777777-0000-0000-0000-00000000010f', '77777777-0000-0000-0000-00000000010e',
          '77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000109',
          'Sensitive free response student answer', now() - interval '2 days');

SELECT lives_ok($$SELECT private.cleanup_expired_ai_context()$$, 'private.cleanup_expired_ai_context() executes without error');
SELECT lives_ok($$SELECT private.cleanup_expired_retention()$$, 'private.cleanup_expired_retention() executes without error');

SELECT is((SELECT count(*)::int FROM public.ai_context_records WHERE id = '77777777-0000-0000-0000-000000000103'),
          0, 'Expired AI context record is successfully purged');
SELECT is((SELECT count(*)::int FROM public.messages WHERE id = '77777777-0000-0000-0000-000000000101'),
          0, 'Expired mentor message covered by summary is successfully purged');
SELECT is((SELECT count(*)::int FROM public.messages WHERE id = '77777777-0000-0000-0000-000000000102'),
          0, 'Expired unsummarized message is purged independently of summaries');
SELECT is((SELECT count(*)::int FROM public.ai_requests WHERE id = '77777777-0000-0000-0000-000000000104'),
          0, 'Completed AI request older than 30 days is purged (PRD §52)');
SELECT is((SELECT count(*)::int FROM public.ai_requests WHERE id = '77777777-0000-0000-0000-000000000105'),
          1, 'Recent AI request within 30-day window is preserved');
SELECT is((SELECT answer_text FROM public.quiz_answers WHERE id = '77777777-0000-0000-0000-00000000010f'),
          NULL::text, 'Expired raw free response answer text is NULLed');
SELECT isnt((SELECT raw_text_purged_at FROM public.quiz_answers WHERE id = '77777777-0000-0000-0000-00000000010f'),
          NULL::timestamptz, 'raw_text_purged_at timestamp is stamped upon answer purge');

SELECT * FROM finish();
ROLLBACK;
```

### `008_gaps.test.sql` (11 Assertions — Verifies Gaps `G1`–`G3` & `ADR-020` Tombstone)
```sql
-- supabase/tests/database/008_gaps.test.sql
BEGIN;
SELECT plan(11);

CREATE FUNCTION pg_temp.mk_user(p uuid, e text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email) VALUES (p, e);
  INSERT INTO public.users (id, email) VALUES (p, e);
$$;
SELECT pg_temp.mk_user('88888888-0000-0000-0000-000000000001', 'gap_u1@test.local');
SELECT pg_temp.mk_user('88888888-0000-0000-0000-000000000002', 'gap_u2@test.local');
SELECT pg_temp.mk_user('88888888-0000-0000-0000-000000000003', 'gap_u3@test.local');
SELECT pg_temp.mk_user('88888888-0000-0000-0000-000000000004', 'gap_u4@test.local');
SELECT pg_temp.mk_user('88888888-0000-0000-0000-000000000005', 'gap_u5@test.local');

INSERT INTO public.skills (id, slug, canonical_name)
  VALUES ('88888888-0000-0000-0000-0000000000a1', 'gap-skill', 'Gap Skill');
INSERT INTO public.topics (id, skill_id, slug, title, career_level, status, explanation_markdown, approved_at)
  VALUES ('88888888-0000-0000-0000-0000000000b1', '88888888-0000-0000-0000-0000000000a1',
          'gap-topic', 'Gap Topic', 'mid', 'approved', 'Explanation', now());

SELECT throws_ok(
  $$INSERT INTO public.user_ratings (user_id, target_type, target_id, score)
    VALUES ('88888888-0000-0000-0000-000000000001', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 6)$$,
  '23514', NULL, 'Rating score > 5 is rejected');

SELECT lives_ok(
  $$INSERT INTO public.user_ratings (user_id, target_type, target_id, score)
    VALUES ('88888888-0000-0000-0000-000000000001', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 5)$$,
  'Valid 1-5 rating is stored');

INSERT INTO public.content_reports (user_id, target_type, target_id, reason) VALUES
  ('88888888-0000-0000-0000-000000000001', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 'incorrect'),
  ('88888888-0000-0000-0000-000000000002', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 'incorrect'),
  ('88888888-0000-0000-0000-000000000003', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 'incorrect'),
  ('88888888-0000-0000-0000-000000000004', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 'incorrect');

SELECT throws_ok(
  $$INSERT INTO public.content_reports (user_id, target_type, target_id, reason)
    VALUES ('88888888-0000-0000-0000-000000000001', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 'outdated')$$,
  '23505', NULL, 'Duplicate report from the same user on the same target is rejected');

SELECT is((SELECT status FROM public.topics WHERE id = '88888888-0000-0000-0000-0000000000b1'),
  'approved'::public.content_status, 'Topic remains approved below 5 independent user reports');

INSERT INTO public.content_reports (user_id, target_type, target_id, reason)
  VALUES ('88888888-0000-0000-0000-000000000005', 'topic_content', '88888888-0000-0000-0000-0000000000b1', 'incorrect');

SELECT is((SELECT status FROM public.topics WHERE id = '88888888-0000-0000-0000-0000000000b1'),
  'hidden'::public.content_status, '5th independent user report automatically hides shared topic');

SELECT lives_ok(
  $$INSERT INTO public.account_deletion_requests (id, user_id, status, provider_deletion_requested)
    VALUES ('88888888-0000-0000-0000-0000000000c1', '88888888-0000-0000-0000-000000000005', 'scheduled', true)$$,
  'User account deletion request is recorded in scheduled state');

SELECT throws_ok(
  $$INSERT INTO public.account_deletion_requests (user_id, status)
    VALUES ('88888888-0000-0000-0000-000000000005', 'in_progress')$$,
  '23505', NULL, 'Second active deletion request for the same user is rejected');

-- ADR-020 tombstone check
-- Do not pre-complete: trigger completes in the cascade transaction.
DELETE FROM auth.users WHERE id = '88888888-0000-0000-0000-000000000005';
SELECT is((SELECT status FROM public.account_deletion_requests WHERE id = '88888888-0000-0000-0000-0000000000c1'),
  'completed'::public.deletion_request_status, 'Completed deletion tombstone survives auth.users cascade deletion (ADR-020)');

SELECT lives_ok(
  $$INSERT INTO public.user_skill_aliases (user_id, input_alias, alias_normalized, skill_id)
    VALUES ('88888888-0000-0000-0000-000000000001', 'Node', 'node', '88888888-0000-0000-0000-0000000000a1')$$,
  'User-specific skill alias interpretation is stored');

SELECT is((SELECT count(*)::int FROM public.skill_aliases WHERE alias_normalized = 'node'),
  0, 'User-specific alias interpretation never auto-promotes to global skill_aliases');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '88888888-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);

SELECT is((SELECT count(*)::int FROM public.user_skill_aliases),
  0, 'User 2 cannot see User 1 skill alias interpretations via RLS');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
```

---

# 14. Complete 50-Table Reference Matrix

All column definitions and constraint details are specified in Section 6 and Section 12.3 above and in `DDD v1.2.2 §4`. Below is the complete API-to-Table traceability summary across all **50 tables**:

| # | Table | Domain | Primary Key | RLS Class | Primary API Endpoints (`API Spec v1.5.1`) |
|---|---|---|---|---|---|
| 1 | `users` | Identity | `id` | O-R + ADMIN-R | `EP-A01..A13`, `EP-AD01..AD03` |
| 2 | `user_auth_providers` | Identity | `id` | O-R | `EP-A01..A03`, `EP-A10..A12` |
| 3 | `user_profiles` | Identity | `id` | O-R | `EP-P01`, `EP-P02`, `EP-P04`, `EP-P05` |
| 4 | `user_preferences` | Identity | `id` | O-R | `EP-P01`, `EP-P03` |
| 5 | `career_roles` | Career | `id` | SHARED | `EP-C01`, `EP-C05`, `EP-R01` |
| 6 | `skill_categories` | Career | `id` | SHARED | `EP-P01`, `EP-G01` |
| 7 | `skills` | Career | `id` | SHARED | `EP-P02`, `EP-P05`, `EP-G01`, `EP-G02` |
| 8 | `skill_aliases` | Career | `id` | SHARED | `EP-P02`, `EP-P05` |
| 9 | `skill_dependencies` | Career | `id` | SHARED | `EP-R01`, `EP-R03` |
| 10 | `career_goals` | Career | `id` | O-R | `EP-C01..C07` |
| 11 | `roadmaps` | Roadmap | `id` | O-R | `EP-R01..R15` |
| 12 | `roadmap_versions` | Roadmap | `id` | O-R | `EP-R01`, `EP-R03..R07`, `EP-R11`, `EP-R13` |
| 13 | `roadmap_items` | Roadmap | `id` | O-R | `EP-R01`, `EP-R03`, `EP-L05` |
| 14 | `roadmap_merges` | Roadmap | `id` | O-R | `EP-R08..R13` |
| 15 | `roadmap_merge_items` | Roadmap | `id` | O-R | `EP-R08`, `EP-R10`, `EP-R11` |
| 16 | `topics` | Learning | `id` | SHARED | `EP-L04..L06`, `EP-F01`, `EP-F02` |
| 17 | `learning_resources` | Learning | `id` | SHARED | `EP-L04`, `EP-L07` |
| 18 | `daily_plans` | Learning | `id` | O-R | `EP-L01..L03` |
| 19 | `daily_plan_items` | Learning | `id` | O-R | `EP-L01..L04`, `EP-Q01`, `EP-Q05` |
| 20 | `quizzes` | Assessment | `id` | DENY | `EP-Q01`, `EP-Q07` |
| 21 | `quiz_questions` | Assessment | `id` | DENY | `EP-Q02`, `EP-Q05`, `EP-Q06`, `EP-F02` |
| 22 | `quiz_attempts` | Assessment | `id` | O-R | `EP-Q01..Q07` |
| 23 | `quiz_answers` | Assessment | `id` | O-R | `EP-Q02`, `EP-Q04..Q06` |
| 24 | `practice_reviews` | Assessment | `id` | O-R | `EP-PR01..PR03`, `EP-F02` |
| 25 | `learning_evidence` | Progress | `id` | O-R | `EP-G01..G04` |
| 26 | `skill_progress` | Progress | `id` | O-R | `EP-G01..G04`, `EP-P02`, `EP-P05` |
| 27 | `achievement_history` | Progress | `id` | O-R | `EP-G03`, `EP-G04` |
| 28 | `conversations` | AI Mentor | `id` | O-R | `EP-M01`, `EP-M02`, `EP-M04` |
| 29 | `messages` | AI Mentor | `id` | O-R | `EP-M03`, `EP-M04` |
| 30 | `conversation_summaries` | AI Mentor | `id` | O-R | `EP-M03` (Context Builder) |
| 31 | `ai_context_records` | AI Mentor | `id` | O-R | `EP-M01`, `EP-M03`, `EP-R01` |
| 32 | `ai_models` | AI Operations | `id` | DENY | Internal Model Router |
| 33 | `prompt_versions` | AI Operations | `id` | DENY | Internal Prompt Manager |
| 34 | `ai_requests` | AI Operations | `id` | O-R | `EP-J01`, `EP-AD08`, Async Endpoints |
| 35 | `ai_generations` | AI Operations | `id` | DENY | Internal Provenance Tracker |
| 36 | `technology_categories` | Technology | `id` | SHARED | `EP-T01`, `EP-T02` |
| 37 | `technologies` | Technology | `id` | SHARED | `EP-T01`, `EP-T02` |
| 38 | `technology_sources` | Technology | `id` | SHARED | `EP-T01`, `EP-T02` |
| 39 | `technology_updates` | Technology | `id` | DELIVERED | `EP-T01`, `EP-T02`, `EP-F01` |
| 40 | `user_update_relevance` | Technology | `id` | O-R | `EP-T01`, `EP-T02` |
| 41 | `update_delivery_history` | Technology | `id` | O-R | `EP-T01`, `EP-T03` |
| 42 | `admin_users` | Administration | `user_id` | DENY | `AccessGuard` (`private.is_admin()`) |
| 43 | `system_configurations` | Administration | `id` | DENY | Internal Quota & Threshold Services |
| 44 | `feature_controls` | Administration | `feature_key` | SHARED | `EP-A13`, `EP-AD04`, `EP-AD05` |
| 45 | `user_access_overrides` | Administration | `id` | O-R + ADMIN-R | `EP-A13`, `EP-AD02`, `EP-AD06` |
| 46 | `admin_audit_logs` | Administration | `id` | ADMIN-R | `EP-AD07`, All Admin Writes |
| 47 | `user_ratings` | Quality Feedback | `id` | O-R | `EP-F01` |
| 48 | `content_reports` | Quality Feedback | `id` | O-R | `EP-F02` |
| 49 | `account_deletion_requests` | Identity / Account | `id` | O-R | `EP-X01`, `EP-X02` |
| 50 | `user_skill_aliases` | Career | `id` | O-R | `EP-P05`, `EP-P02` |

---

# 15. Cascade Deletion & Compliance Lineage (`ADR-020`)

Deleting a row from `auth.users` cascades through `public.users` to all user-owned personal data tables (bypassing append-only triggers via `pg_trigger_depth() > 1`), while preserving:
- Shared non-personal catalogs (`career_roles`, `skills`, `skill_aliases`, `topics`, `learning_resources`, `quizzes`, `quiz_questions`, `technology_*`)
- `admin_audit_logs` (`actor_id` and `target_user_id` set to `NULL` via `ON DELETE SET NULL`)
- `ai_generations` (`request_id` set to `NULL` via `ON DELETE SET NULL`)
- `account_deletion_requests` (`user_id` set to `NULL` via `ON DELETE SET NULL` when `status = 'completed'`, preserving the local completion tombstone (anonymized only after provider references are cleared) per `ADR-020`)

---

# 16. Rollback Strategy & Down-Migration Catalog (`020_down.sql` – `000_down.sql`)

```sql
-- supabase/rollbacks/020_down.sql
BEGIN;
DELETE FROM public.system_configurations WHERE config_key IN (
  'quality.report_auto_hide_threshold','roadmap.soft_size_max_topics',
  'ai_quota.roadmap_drafts_per_24h','ai_quota.mentor_messages_per_24h');
DROP POLICY IF EXISTS user_skill_aliases_owner_select        ON public.user_skill_aliases;
DROP POLICY IF EXISTS account_deletion_requests_owner_select ON public.account_deletion_requests;
DROP POLICY IF EXISTS content_reports_owner_select           ON public.content_reports;
DROP POLICY IF EXISTS user_ratings_owner_select              ON public.user_ratings;
CREATE POLICY user_profiles_owner_insert ON public.user_profiles FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY user_profiles_owner_update ON public.user_profiles FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY user_preferences_owner_insert ON public.user_preferences FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY user_preferences_owner_update ON public.user_preferences FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
GRANT INSERT, UPDATE ON public.user_profiles, public.user_preferences TO authenticated;
DROP TRIGGER IF EXISTS trg_content_reports_threshold            ON public.content_reports;
DROP TRIGGER IF EXISTS trg_content_reports_append_only          ON public.content_reports;
DROP TRIGGER IF EXISTS trg_user_skill_aliases_updated_at        ON public.user_skill_aliases;
DROP TRIGGER IF EXISTS trg_account_deletion_requests_updated_at ON public.account_deletion_requests;
DROP TRIGGER IF EXISTS trg_user_ratings_updated_at              ON public.user_ratings;
DROP TRIGGER IF EXISTS trg_users_complete_deletion ON public.users;
DROP FUNCTION IF EXISTS private.complete_deletion_on_user_delete();
DROP FUNCTION IF EXISTS private.evaluate_content_report_threshold();
DROP TABLE IF EXISTS public.user_skill_aliases;
DROP TABLE IF EXISTS public.account_deletion_requests;
DROP TABLE IF EXISTS public.content_reports;
DROP TABLE IF EXISTS public.user_ratings;
DROP TYPE IF EXISTS public.deletion_request_status;
DROP TYPE IF EXISTS public.report_reason;
DROP TYPE IF EXISTS public.report_target;
DROP TYPE IF EXISTS public.rating_target;
COMMIT;

-- supabase/rollbacks/019_down.sql
DO $$ BEGIN RAISE NOTICE 'Rollback 019: no-op.'; END $$;

-- supabase/rollbacks/018_down.sql
BEGIN;
DELETE FROM public.technology_categories WHERE slug IN ('languages-runtimes','frameworks-libraries','databases-storage','cloud-platforms','devops-tooling','security-tooling','ai-ml-platforms');
DELETE FROM public.skill_categories WHERE slug IN ('software-engineering-fundamentals','programming-languages','web-development','databases','cloud-infrastructure','devops-tooling','testing-quality','security','mobile-development','data-engineering','ai-machine-learning');
DELETE FROM public.career_roles WHERE slug IN ('frontend-development','backend-development','full-stack-development','qa-software-testing','qa-automation-sdet','devops','site-reliability-engineering','cloud-engineering','cybersecurity','mobile-development','data-engineering','ai-ml-engineering','ai-application-llm-engineering');
DELETE FROM public.system_configurations WHERE config_key IN ('roadmap.max_active','career_goal.max_clarification_rounds','quiz.retry_limit','quiz.standard_mcq_count','quiz.standard_free_response_min','quiz.standard_free_response_max','retention.raw_response_days','retention.mentor_message_days','retention.ai_operational_log_days','career_knowledge.review_days','technology_update.active_window_days');
DELETE FROM public.feature_controls WHERE feature_key IN ('roadmap_generator','daily_plan','quiz_practice','ai_practice_review','progress_tracking','ai_mentor','technology_update');
COMMIT;

-- supabase/rollbacks/017_down.sql
BEGIN;
DROP POLICY IF EXISTS users_owner_or_admin_select ON public.users;
DROP POLICY IF EXISTS user_access_overrides_admin_select ON public.user_access_overrides;
DROP POLICY IF EXISTS admin_audit_logs_admin_select ON public.admin_audit_logs;
DROP POLICY IF EXISTS technology_updates_delivered_select ON public.technology_updates;
DROP POLICY IF EXISTS career_roles_shared_select ON public.career_roles;
DROP POLICY IF EXISTS skill_categories_shared_select ON public.skill_categories;
DROP POLICY IF EXISTS skills_shared_select ON public.skills;
DROP POLICY IF EXISTS skill_aliases_shared_select ON public.skill_aliases;
DROP POLICY IF EXISTS skill_dependencies_shared_select ON public.skill_dependencies;
DROP POLICY IF EXISTS topics_shared_select ON public.topics;
DROP POLICY IF EXISTS learning_resources_shared_select ON public.learning_resources;
DROP POLICY IF EXISTS technology_categories_shared_select ON public.technology_categories;
DROP POLICY IF EXISTS technologies_shared_select ON public.technologies;
DROP POLICY IF EXISTS technology_sources_shared_select ON public.technology_sources;
DROP POLICY IF EXISTS feature_controls_shared_select ON public.feature_controls;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_auth_providers','career_goals','roadmaps','roadmap_versions','roadmap_items',
    'roadmap_merges','roadmap_merge_items','daily_plans','daily_plan_items',
    'quiz_attempts','quiz_answers','practice_reviews','learning_evidence',
    'skill_progress','achievement_history','conversations','messages',
    'conversation_summaries','ai_context_records','ai_requests',
    'user_update_relevance','update_delivery_history','user_access_overrides',
    'user_profiles','user_preferences']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_update', t);
  END LOOP;
END $$;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r')
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;
COMMIT;

-- supabase/rollbacks/016_down.sql
BEGIN;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','user_auth_providers','user_profiles','user_preferences','career_roles','skill_categories','skills',
    'skill_aliases','career_goals','roadmaps','roadmap_versions','roadmap_merges','topics','learning_resources',
    'daily_plans','daily_plan_items','quizzes','quiz_questions','quiz_attempts','quiz_answers','practice_reviews',
    'skill_progress','conversations','ai_context_records','ai_models','ai_requests','technology_categories',
    'technologies','technology_sources','system_configurations','feature_controls','user_access_overrides']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_updated_at', t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_roadmaps_owner_check ON public.roadmaps;
DROP TRIGGER IF EXISTS trg_roadmap_versions_owner_check ON public.roadmap_versions;
DROP TRIGGER IF EXISTS trg_roadmap_items_owner_check ON public.roadmap_items;
DROP TRIGGER IF EXISTS trg_roadmap_merges_owner_check ON public.roadmap_merges;
DROP TRIGGER IF EXISTS trg_roadmap_merge_items_owner_check ON public.roadmap_merge_items;
DROP TRIGGER IF EXISTS trg_daily_plans_owner_check ON public.daily_plans;
DROP TRIGGER IF EXISTS trg_daily_plan_items_owner_check ON public.daily_plan_items;
DROP TRIGGER IF EXISTS trg_quiz_attempts_owner_check ON public.quiz_attempts;
DROP TRIGGER IF EXISTS trg_quiz_answers_owner_check ON public.quiz_answers;
DROP TRIGGER IF EXISTS trg_practice_reviews_owner_check ON public.practice_reviews;
DROP TRIGGER IF EXISTS trg_messages_owner_check ON public.messages;
DROP TRIGGER IF EXISTS trg_conversation_summaries_owner_check ON public.conversation_summaries;
DROP TRIGGER IF EXISTS trg_learning_evidence_owner_check ON public.learning_evidence;
DROP TRIGGER IF EXISTS trg_roadmaps_limit ON public.roadmaps;
DROP TRIGGER IF EXISTS trg_roadmaps_transition ON public.roadmaps;
DROP TRIGGER IF EXISTS trg_roadmap_versions_guard ON public.roadmap_versions;
DROP TRIGGER IF EXISTS trg_ai_requests_status ON public.ai_requests;
DROP TRIGGER IF EXISTS trg_skill_progress_guard ON public.skill_progress;
DROP TRIGGER IF EXISTS trg_user_profiles_validate_timezone ON public.user_profiles;
DROP TRIGGER IF EXISTS trg_quiz_attempts_close_undo ON public.quiz_attempts;
DROP TRIGGER IF EXISTS trg_messages_touch_conversation ON public.messages;
DROP TRIGGER IF EXISTS trg_roadmap_items_append_only ON public.roadmap_items;
DROP TRIGGER IF EXISTS trg_roadmap_merge_items_append_only ON public.roadmap_merge_items;
DROP TRIGGER IF EXISTS trg_learning_evidence_append_only ON public.learning_evidence;
DROP TRIGGER IF EXISTS trg_achievement_history_append_only ON public.achievement_history;
DROP TRIGGER IF EXISTS trg_admin_audit_logs_append_only ON public.admin_audit_logs;
DROP TRIGGER IF EXISTS trg_ai_requests_a_total ON public.ai_requests;
DROP TRIGGER IF EXISTS trg_ai_requests_b_cost ON public.ai_requests;
DROP TRIGGER IF EXISTS trg_ai_generations_a_total ON public.ai_generations;
DROP TRIGGER IF EXISTS trg_ai_generations_b_cost ON public.ai_generations;
COMMIT;

-- supabase/rollbacks/015_down.sql
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cleanup-expired-ai-context');
    PERFORM cron.unschedule('cleanup-expired-retention');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DROP FUNCTION IF EXISTS private.admin_usage_summary(date, date);
DROP FUNCTION IF EXISTS private.effective_feature_access(uuid, public.feature_key);
DROP FUNCTION IF EXISTS private.is_admin();
DROP FUNCTION IF EXISTS private.touch_conversation();
DROP FUNCTION IF EXISTS private.close_merge_undo_window();
DROP FUNCTION IF EXISTS private.validate_profile_timezone();
DROP FUNCTION IF EXISTS private.validate_skill_progress_change();
DROP FUNCTION IF EXISTS private.prevent_audit_log_changes();
DROP FUNCTION IF EXISTS private.prevent_achievement_modification();
DROP FUNCTION IF EXISTS private.prevent_row_modification();
DROP FUNCTION IF EXISTS private.cleanup_expired_retention();
DROP FUNCTION IF EXISTS private.cleanup_expired_ai_context();
DROP FUNCTION IF EXISTS private.calculate_ai_cost();
DROP FUNCTION IF EXISTS private.calculate_total_tokens();
DROP FUNCTION IF EXISTS private.validate_ai_request_status();
DROP FUNCTION IF EXISTS private.guard_roadmap_version_immutability();
DROP FUNCTION IF EXISTS private.enforce_active_roadmap_limit();
DROP FUNCTION IF EXISTS private.validate_roadmap_transition();
DROP FUNCTION IF EXISTS private.validate_user_ownership();
DROP FUNCTION IF EXISTS private.update_updated_at_column();
COMMIT;

-- supabase/rollbacks/014_down.sql
BEGIN;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx\_%')
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.indexname);
  END LOOP;
END $$;
COMMIT;

-- supabase/rollbacks/013_down.sql
BEGIN;
ALTER TABLE public.conversation_summaries DROP CONSTRAINT IF EXISTS fk_conversation_summaries_ai_gen;
ALTER TABLE public.messages               DROP CONSTRAINT IF EXISTS fk_messages_ai_gen;
ALTER TABLE public.practice_reviews       DROP CONSTRAINT IF EXISTS fk_practice_reviews_ai_gen;
ALTER TABLE public.quizzes                DROP CONSTRAINT IF EXISTS fk_quizzes_ai_gen;
ALTER TABLE public.topics                 DROP CONSTRAINT IF EXISTS fk_topics_ai_gen;
ALTER TABLE public.daily_plan_items       DROP CONSTRAINT IF EXISTS fk_daily_plan_items_merge;
ALTER TABLE public.daily_plans            DROP CONSTRAINT IF EXISTS fk_daily_plans_version;
ALTER TABLE public.roadmap_merge_items    DROP CONSTRAINT IF EXISTS fk_roadmap_merge_items_topic;
ALTER TABLE public.roadmap_merges         DROP CONSTRAINT IF EXISTS fk_roadmap_merges_ai_gen;
ALTER TABLE public.roadmap_merges         DROP CONSTRAINT IF EXISTS fk_roadmap_merges_result;
ALTER TABLE public.roadmap_merges         DROP CONSTRAINT IF EXISTS fk_roadmap_merges_base;
ALTER TABLE public.roadmap_items          DROP CONSTRAINT IF EXISTS fk_roadmap_items_topic;
ALTER TABLE public.roadmap_versions       DROP CONSTRAINT IF EXISTS fk_roadmap_versions_ai_gen;
ALTER TABLE public.roadmap_versions       DROP CONSTRAINT IF EXISTS fk_roadmap_versions_merge;
ALTER TABLE public.roadmap_versions       DROP CONSTRAINT IF EXISTS fk_roadmap_versions_base;
ALTER TABLE public.roadmaps               DROP CONSTRAINT IF EXISTS fk_roadmaps_current_version;
ALTER TABLE public.users                  DROP CONSTRAINT IF EXISTS fk_users_suspended_by;
COMMIT;

-- supabase/rollbacks/012_down.sql
BEGIN;
DROP TABLE IF EXISTS public.admin_audit_logs, public.user_access_overrides,
  public.feature_controls, public.system_configurations, public.admin_users;
COMMIT;
-- supabase/rollbacks/011_down.sql
BEGIN;
DROP TABLE IF EXISTS public.update_delivery_history, public.user_update_relevance,
  public.technology_updates, public.technology_sources, public.technologies,
  public.technology_categories;
COMMIT;
-- supabase/rollbacks/010_down.sql
BEGIN;
DROP TABLE IF EXISTS public.ai_generations, public.ai_requests,
  public.prompt_versions, public.ai_models;
COMMIT;
-- supabase/rollbacks/009_down.sql
BEGIN;
DROP TABLE IF EXISTS public.ai_context_records, public.conversation_summaries,
  public.messages, public.conversations;
COMMIT;
-- supabase/rollbacks/008_down.sql
BEGIN;
DROP TABLE IF EXISTS public.achievement_history, public.skill_progress,
  public.learning_evidence;
COMMIT;
-- supabase/rollbacks/007_down.sql
BEGIN;
DROP TABLE IF EXISTS public.practice_reviews, public.quiz_answers,
  public.quiz_attempts, public.quiz_questions, public.quizzes;
COMMIT;
-- supabase/rollbacks/006_down.sql
BEGIN;
DROP TABLE IF EXISTS public.daily_plan_items, public.daily_plans,
  public.learning_resources, public.topics;
COMMIT;
-- supabase/rollbacks/005_down.sql
BEGIN;
DROP TABLE IF EXISTS public.roadmap_merge_items, public.roadmap_merges,
  public.roadmap_items, public.roadmap_versions, public.roadmaps;
COMMIT;
-- supabase/rollbacks/004_down.sql
BEGIN;
DROP TABLE IF EXISTS public.career_goals, public.skill_dependencies,
  public.skill_aliases, public.skills, public.skill_categories, public.career_roles;
COMMIT;
-- supabase/rollbacks/003_down.sql
BEGIN;
DROP TABLE IF EXISTS public.user_preferences, public.user_profiles;
COMMIT;
-- supabase/rollbacks/002_down.sql
BEGIN;
DROP TABLE IF EXISTS public.user_auth_providers, public.users;
COMMIT;

-- supabase/rollbacks/001_down.sql
BEGIN;
DROP TYPE IF EXISTS public.admin_role, public.feature_key, public.update_state, public.technology_source_type,
  public.relevance_level, public.action_timing, public.release_status, public.ai_validation_status,
  public.job_kind, public.job_status, public.ai_task, public.ai_context_type, public.conversation_context,
  public.ui_language, public.message_role, public.progress_event_type, public.evidence_source,
  public.learning_state, public.review_status, public.performance_level, public.attempt_status,
  public.question_difficulty, public.question_type, public.plan_item_status, public.plan_status,
  public.resource_type, public.merge_op, public.merge_origin, public.merge_status, public.skill_gap_type,
  public.item_priority, public.roadmap_version_origin, public.roadmap_version_state, public.roadmap_status,
  public.goal_status, public.alias_status, public.content_status, public.career_level,
  public.experience_level, public.auth_provider, public.user_status;
COMMIT;

-- supabase/rollbacks/000_down.sql
BEGIN;
DROP EXTENSION IF EXISTS pg_cron;
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS citext;
DROP SCHEMA IF EXISTS private CASCADE;
COMMIT;
```

---

# 17. Enterprise Database Deployment Runbook

## 17.1 Local Development Environment Runbook
1. **Prerequisites:** Supabase CLI `>= 1.145.0`, Docker Engine (`>= 4 GB` RAM), PostgreSQL 15/16 client (`psql`).
2. **Local Execution Workflow:**
   ```bash
   supabase start
   supabase db reset
   supabase test db
   supabase db lint --level error
   ```
3. **Expected Outputs & Verification Gates:**
   - Output of `supabase db reset` terminates with:
     ```text
     Applying migration 019_tests.sql...
     Applying migration 020_gaps_and_alignment.sql...
     Finished supabase db reset.
     ```
   - Output of `supabase test db` reports `All tests successful` across `001`–`008` (185 pgTAP assertions).

## 17.2 Staging & Production Deployment Runbook
1. **Pre-Flight Check:**
   - Verify automated physical base backup and continuous WAL archiving status in Supabase dashboard.
   - Confirm zero queries running `> 30s`:
     `SELECT pid, now() - xact_start AS duration, query FROM pg_stat_activity WHERE state <> 'idle' ORDER BY duration DESC;`
2. **Staging Gate:**
   - Run `./scripts/db/check-migration-order.sh` and `./scripts/db/test-upgrade.sh <prev-release-tag>`.
3. **Production Push:**
   - Execute `supabase db push --db-url "$PROD_DIRECT_DB_URL"` (using direct connection port `5432`, bypassing PgBouncer port `6543` for DDL).
4. **Post-Flight Smoke Gate:**
   - Confirm catalog counts (`50` tables, `45` enums, `103` secondary indexes, `68` triggers, `44` RLS policies, `22` private functions).

---

# 18. Backup, PITR, and Disaster Recovery Runbooks

- **RPO / RTO SLAs:** RPO `< 5 minutes` via continuous WAL archiving; RTO `< 30 minutes` via standby promotion.
- **Accidental Data Corruption Runbook:**
  1. Enable maintenance mode at API Gateway (`503 SERVICE_UNAVAILABLE`).
  2. Restore Supabase Point-in-Time Recovery (PITR) to timestamp $T_{\text{incident}} - 60\text{ seconds}$.
  3. Identify restored migration/checksum manifest, then run its read-only smoke suite. Never replay pre-020 gate019 or migration020 DDL against a post-020 database.
  4. Re-point backend `DATABASE_URL` and exit maintenance mode.

---

# 19. Automated Database CI/CD Pipeline (`.github/workflows/database-ci.yml`)

```yaml
name: Database CI Gate
on:
  pull_request:
    paths:
      - 'supabase/**'
      - 'scripts/db/**'
jobs:
  verify-database:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: ">=1.145.0"
      - name: Verify Migration Sequence Order (000..020)
        run: bash scripts/db/check-migration-order.sh
      - name: Start Local Supabase Stack
        run: supabase start
      - name: Execute Fresh Install, Linting & pgTAP Suite (204 Assertions)
        run: bash scripts/db/test-fresh-install.sh
      - name: Verify Transaction Rollback on Broken Migration
        run: bash scripts/db/test-failure-handling.sh
```

---

# 20. Operational Maintenance & Autovacuum Tuning

Execute on initial cluster stand-up for high-churn tables (`ai_requests`, `messages`, `quiz_answers`, `ai_context_records`):

```sql
ALTER TABLE public.ai_requests        SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE public.messages           SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.quiz_answers       SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.ai_context_records SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
```

## Accepted R01 implementation contract

D001 — Fresh Supabase restart: all four legacy Phase 1 TypeORM migrations ran on the old Docker PostgreSQL 15 database. Current DMS 000–020 has never run anywhere; legacy data/database preservation and transfer are not required (inputs/legacy_phase1/OWNER_CONFIRMATION.json).
The target is Supabase Auth AND primary application PostgreSQL storage. Correct this pre-release baseline in place; place R02 indexes in 014 before gate 019. Do not replay legacy TypeORM migrations or overlay DMS on their incompatible users schema. Legacy-to-DMS upgrade parity is N/A for this restart with owner evidence; fresh install and corrected-baseline rollback/reapply remain required. Once first applied, freeze corrected checksums and use forward migrations. This toolkit does not delete a legacy container, volume or database.

## Accepted R27 implementation contract

Every report writer (FeedbackService and maintenance tooling) uses this READ COMMITTED protocol. The advisory-lock statement completes before the INSERT snapshot; a lock only in the AFTER trigger is insufficient. Keep visibility checks and per-user target uniqueness. Arbitrary client writes remain forbidden.

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
-- Parameters are validated target_type and target_id. This statement completes
-- before the INSERT obtains its next READ COMMITTED snapshot.
SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0));
-- Perform target visibility/referential checks under the same transaction.
INSERT INTO public.content_reports(user_id,target_type,target_id,reason,comment)
VALUES ($3,$1,$2,$4,$5);
COMMIT;
```

Test two sessions at threshold, duplicate users, nondefault thresholds and rollback. No concurrency execution is claimed.

## Accepted R13 implementation contract

Commit the claim before external calls. The trigger owns the incremented
attempt_count. Treat (request_id, locked_by, attempt_count) as an attempt fence.
Heartbeat updates locked_at only while that fence still owns preparing.
On expiry, the reaper row-locks the same request and sets preparing→failed with
WORKER_LEASE_EXPIRED and retryable=true; then failed→queued in a separate UPDATE
only within bounded attempts/deadline. Do not use preparing→queued.
Before domain writes, the worker locks the row and verifies the same live fence,
deadline and account/access preconditions. Write artifact/result/status in one
transaction. If fence lost, discard output; never commit a stale attempt.
Use domain uniqueness/version checks as well as request fencing. A provider may
have charged for an interrupted call; do not claim exactly-once external billing.
Proposed configurable operating defaults: lease 120s, heartbeat 30s, max attempts
5, total request age deadline 1h. These are reviewable defaults, not PRD limits.
Retry backoff: min(300s, 2^attempt_count seconds) plus bounded jitter.
At deadline/exhaustion set a nonretryable terminal error and clear job inputs.

Heartbeat uses WHERE id=$id AND status='preparing' AND locked_by=$worker AND attempt_count=$attempt; zero rows means ownership lost. Reaper locks expired row FOR UPDATE, verifies the fence, performs preparing→failed and then a separate failed→queued UPDATE only while attempts<5 and created_at>now()-interval '1 hour'. Final failure sets retryable=false and clears input_payload. Before artifact writes lock the request FOR UPDATE and verify the same live fence, locked_at>clock_timestamp()-interval '120 seconds', deadline, owner/access and expected domain version. Keep that row lock through artifact/result/status commit. All error updates use the fence. Domain write failure rolls back; a separate fenced transaction records failure. Reaper runs at least every 30s. Deleted/expired requests invalidate every fence.

## Accepted R08 implementation contract

When an approved retention setting shortens raw-answer/message lifetime, the trusted producer sets raw_text_expires_at/expires_at to the earlier configured cutoff. Reads apply that stored expiry plus the independent90d ceiling. Cleanup consumes bounded1..90d settings too; longer/future client expiries cannot extend retention. No client may set expiry fields.

## Accepted R09 implementation contract

AI request operational retention is measured from created_at, maximum 30 days.
Job recovery/deadlines must resolve stalled work much earlier (R13).
Purge request rows when created_at <= now() - configured retention, with the
configuration bounded to 1..30 days. Do not preserve a raw input/error payload
just because finished_at is NULL. Clear input_payload at final completion
(succeeded, or failed with no further retry); a transient retryable failed state
retains inputs only within R13's finite retry deadline. Retain only approved
content-free metrics after final completion until purge.
Permanent reusable generation provenance is a separate content-free artifact,
not a copy of request text; request_id may become NULL via its existing FK.
External/provider/security logs have explicit equivalent retention contracts;
no indefinite exception follows from a provider request or an error.

## Accepted R05 implementation contract

The worker never pre-completes a request in a separate transaction. It calls the supported Auth deletion operation; BEFORE DELETE ON public.users invokes private.complete_deletion_on_user_delete() before SET NULL. Auth/application deletion and completed status commit or roll back together. completed means LOCAL deletion; provider acknowledgement is separate. JWT bytes need not expire cryptographically immediately; backend account existence/status and R06 receipt enforce access. Inject failure before/during cascade and before commit under R32.

## Accepted R14 implementation contract

Key identity = authenticated user + Idempotency-Key, matching SQL uniqueness.
Store the method, canonical route, canonical body hash, in-flight ownership and
replayable HTTP status/body for 24h; a changed method/route/body under the same key
returns the existing 409 IDEMPOTENCY_KEY_REUSED.
Serialize creation of the in-flight record; do not issue the mutation twice.
Use a new random UUID for each new logical operation; retries reuse that UUID.
If Redis is unavailable, or acknowledged key state was lost inside its TTL,
fail H-IDEM mutations closed with retryable 503 until TTL-preserving state is
restored or 24h after the known loss boundary. Do not silently promise replay
from an incomplete cache. Record this availability tradeoff in the runbook.
For a key reused after TTL: no new-execution guarantee is made. If a durable
ai_requests row still owns it, return 409 IDEMPOTENCY_KEY_REUSED with
instructions to use a new key for a new operation; never leak a SQL exception.
Where a durable result can be verified, replay it with the original request hash;
do not reconstruct a success solely from an unrelated resource's existence.

Keep the acknowledged Redis loss epoch outside the lost keyspace in deployment control state. Startup checks cache generation; uncertain restart/flush/failover opens a recovery barrier until TTL-preserving restore or 24h after loss. PING does not prove key survival. In-flight owner crash or effect committed before replay-cache write is ambiguous: never expire reservation and execute again inside TTL. Reconcile with a verified durable request/result hash; otherwise return retryable503 through remaining key lifetime. SQL uniqueness collisions map to409. This availability interruption is accepted engineering policy; durable generic replay storage would require another reviewed schema change.

## Accepted R06 implementation contract

EP-X01 202 adds deletion_receipt and receipt_expires_at to the response.
Receipt claims: typ=deletion_receipt, request_id, aud=account-deletion-status,
iat, exp; signed with a dedicated server key; no user/contact/name data.
Proposed default validity: 24h (operational choice to review, not a PRD mandate).
EP-X02 accepts either the existing account JWT or
Authorization: DeletionReceipt <receipt> (never in a URL).
Receipt auth bypasses only account-token lookup for this route. It validates
signature, type, audience and expiry, then looks up only that request_id through
the backend. It grants no other API/RLS access and no anonymous table SELECT.
Return 200 AccountDeletionStatusDTO for scheduled/in_progress/completed,
including a completed null-owner tombstone. status=completed is success evidence.
401/404/network failure alone means unconfirmed, never completed.
An expired receipt requires recovery while the account still exists, or displays
'Unable to confirm completion' after local sign-out. Do not promise recovery
after the receipt lifetime without an additional approved mechanism.
EP-X01 idempotent retry returns the same request and a valid request-bound receipt.

## Accepted R35 implementation contract

Before the local cascade, persist only the minimal supported provider-object
deletion references encrypted at rest, provider key, retry attempt and next retry
time in provider_cleanup; no password/token/message/answer/contact copy. References
can be pseudonymous personal data: do not call this row anonymized while present.
Expiry is explicitly at most requested_at+30 days (proposed policy under PRD §13).
The deletion worker retries pending entries after local completed status, using
the row as workflow state, not Redis as a durable queue. Provider request acceptance
removes that entry; a successful provider request is not proof the provider erased
every backup. provider_deletion_requested is true only when all applicable requests
were accepted; no applicable provider keeps it false with no pending entries.
At expiry clear remaining encrypted references and record only a content-free
unconfirmed/failed outcome in bounded operational evidence. Never retain retry
inputs indefinitely or block local account deletion forever on provider failure.
Only backend code reads/writes provider_cleanup; status reads are mediated by
EP-X02 rather than whole-table direct SELECT. Omit it from status DTOs, direct
client grants, admin screens and logs. The initial 202 example uses false until
the worker actually has provider acknowledgements. After references are removed, the retained
tombstone has no account identifier. Status=completed means local deletion only.

Outbox entry={provider_key,encrypted_object_ref,attempts,next_retry_at,state:'pending'}; reject unknown fields, plaintext references and credentials. AEAD managed server key/version uses request_id+provider_key as authenticated data. Max5 attempts,10s calls and exponential backoff before requested_at+30d deadline. Serialize worker ownership by request row lock, capture entry identity, call outside transaction, then conditionally remove that entry. Use provider-supported request+entry idempotency; crash after acknowledgement can replay the same external call. No exactly-once billing/deletion claim. Scrub expired references before use and in retention runner; content-free failed/unconfirmed operational outcome expires within30d. Do not optimistically mark provider acknowledgements.

## Accepted R07 implementation contract

Under one user-scoped transaction lock, EP-P02/P05 save canonical self-reported
skill IDs, deduplicate, enforce the total 100-skill cap, and set None=false when
the resulting list is nonempty. EP-P05 also upserts only this user's alias.
Before a confirmed goal level exists, profile skills are explicitly represented
as self-reported Learning context; do not insert an unkeyed skill_progress row.
Return progress_initialization='deferred_until_level_confirmation'.
On EP-C05 confirmation, initialize each self-reported skill for that confirmed
Career Level in the same goal-confirmation transaction. For existing confirmed
goals, initialize their distinct target levels during EP-P02/P05.
Insert missing rows at learning with state_reason='Self-reported skill'; change
not_started to learning with a new explanatory reason. Preserve learning,
practicing, proficient and all stronger evidence; never copy lower-level
Proficient into another level. Repeated resolution is idempotent.
None with an empty list creates no artificial skills. Removing a profile skill
does not erase prior evidence or mutate a locked roadmap.

## Accepted R25 implementation contract

For each candidate, acquire a session advisory lock keyed by user ID and captured
local date on a dedicated backend DB connection; if unavailable, skip this pass.
Recheck account, feature, meaningful activity, profile timezone and existing date
outcome after acquiring it. Capture timezone/local_date once for this attempt.
Keep the connection pinned and lock held through the bounded external attempt;
release in finally; a lost DB session invalidates ownership, so discard its result.
Before inserting, recheck the captured date/timezone. If they changed, discard
this attempt and let a subsequent pass handle the current date; do not relabel it.
Use the existing unique user/date constraint as the final stored-outcome guard.
Do not invent a delivered/no-change/unavailable outcome merely to reserve work.
Every external attempt has a deadline/concurrency cap; monitor pinned connection
capacity. A crashed call may incur cost twice on retry; no exactly-once billing
claim is made. PostgreSQL remains authoritative; Redis is not a durable reservation.

Edits apply on next pass; never rewrite prior local_date or backfill dates. Use a dedicated direct/session connection, never transaction-pool session locks. Defaults:60s external deadline, concurrency2 and max2 pinned scheduler connections per instance. Capture timezone/date and check after call on same still-owned session; session loss invalidates result. Recheck activity/account/access before commit. Advisory lock prevents concurrent live attempts; provider cost may repeat after crash. Hourly cadence is best effort from first eligible hour>=06, no fixed delivery-time or rolling24h guarantee. When no committed outcome exists, EP-T01 returns today_state:null,generation_pending:true; do not invent no_important_changes/outage rows to reserve work. Completed outcomes return generation_pending:false and one existing update_state value.

## Accepted R23 implementation contract

After PITR, first identify the restored migration version/checksums. Do not replay
019_tests.sql as a final-schema gate and do not replay 020's DDL on a post-020
database. Run the read-only smoke suite for that restored version. Compare its
catalog/privilege manifest to the approved release manifest, run behavioral tests
only in a safe validation clone, and record restored timestamp, observed data
loss window and time to service recovery. Apply forward migrations only if the
restored version is older than the target, using the reviewed upgrade path.

Read-only catalog starting point:

```sql
SELECT 'public_tables' AS metric,count(*)::bigint AS value
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r'
UNION ALL SELECT 'public_enums',count(*) FROM pg_type t
 JOIN pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname='public' AND t.typtype='e'
UNION ALL SELECT 'private_functions',count(*) FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private';
```

PITR configuration/RPO/RTO values are targets; record timestamped sentinels, observed data loss and actual recovery time in a restore drill.

## Operational script bodies (R22)

D001 fresh restart: legacy upgrade execution is N/A with owner evidence; corrected baseline fresh install and rollback/reapply are required. The comparison script below is retained for FUTURE releases after both isolated fresh/upgraded databases have been prepared from named reviewed revisions. It performs comparison only, never checks out/stashes/reset the user's working tree. Pin matching pg_dump/Supabase/PostgreSQL versions in execution evidence.

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${FRESH_DB_URL:?Set disposable fresh database URL}"
: "${UPGRADED_DB_URL:?Set disposable upgraded database URL}"
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
for task_kind in fresh upgraded; do
  if [[ "$task_kind" == fresh ]]; then
    task_db_url=$FRESH_DB_URL
  else
    task_db_url=$UPGRADED_DB_URL
  fi
  pg_dump --schema-only --no-owner --no-comments \
    --schema=public --schema=private --schema=extensions "$task_db_url" \
    > "$task_tmp/$task_kind.raw.sql"
  sed '/^\\restrict /d; /^\\unrestrict /d; /^--/d; /^[[:space:]]*$/d' \
    "$task_tmp/$task_kind.raw.sql" > "$task_tmp/$task_kind.sql"
done
diff -u "$task_tmp/fresh.sql" "$task_tmp/upgraded.sql"
printf '%s\n' 'Schema/privilege parity passed; run pgTAP on both databases separately.'
```

Performance fixtures below are disposable synthetic volume only, not migrations or behavior tests. Disable all workers; replica mode bypasses FK/triggers for volume construction. Require explicit disposable DB identification; run once on clean accepted baseline. Save EXPLAIN JSON plus host/tier/config and cold/warm timing; index-name checks are diagnostics. Verify100 users,300 roadmaps,12000 roadmap items,60000 plan items,210000 messages,100000 requests,5000 progress rows and a nonempty synthetic async queue.

```sql
-- scripts/db/perf/seed_volume.sql
-- DISPOSABLE PERFORMANCE DATABASE ONLY. Synthetic volume, not functional fixtures.
-- No application workers may dispatch these synthetic queued rows.
BEGIN;
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE perf_users AS
  SELECT g AS n, gen_random_uuid() AS id FROM generate_series(1, 100) g;
INSERT INTO auth.users (id, email) SELECT id, 'perf' || n || '@test.local' FROM perf_users;
INSERT INTO public.users (id, email, last_active_at) SELECT id, 'perf' || n || '@test.local', now() FROM perf_users;

INSERT INTO public.skills (id, slug, canonical_name)
  SELECT gen_random_uuid(), 'perf-skill-' || g, 'Perf Skill ' || g FROM generate_series(1, 50) g;
INSERT INTO public.topics (id, skill_id, slug, title, career_level, status, explanation_markdown, approved_at)
  SELECT gen_random_uuid(), s.id, 'perf-topic-' || row_number() OVER (), 'Topic', 'mid', 'approved', 'x', now()
  FROM public.skills s WHERE s.slug LIKE 'perf-skill-%';

CREATE TEMP TABLE perf_rm AS
  SELECT u.id AS user_id, gen_random_uuid() AS goal_id, gen_random_uuid() AS roadmap_id, gen_random_uuid() AS version_id, k
  FROM perf_users u CROSS JOIN generate_series(1, 3) k;
INSERT INTO public.career_goals (id, user_id, goal_text, status, confirmed_role_id, target_level, confirmed_at)
  SELECT goal_id, user_id, 'Perf goal ' || k, 'confirmed', (SELECT id FROM public.career_roles LIMIT 1), 'mid', now() FROM perf_rm;
INSERT INTO public.roadmaps (id, user_id, career_goal_id, canonical_role_id, target_level, status, is_focus, current_version_id, locked_at)
  SELECT roadmap_id, user_id, goal_id, (SELECT id FROM public.career_roles LIMIT 1), 'mid', 'locked', (k = 1), version_id, now() FROM perf_rm;
INSERT INTO public.roadmap_versions (id, roadmap_id, user_id, version_no, state, created_by, target_level, locked_at)
  SELECT version_id, roadmap_id, user_id, 1, 'locked', 'ai', 'mid', now() FROM perf_rm;
INSERT INTO public.roadmap_items (version_id, user_id, topic_id, skill_id, title, priority, gap_type, sequence_no)
  SELECT r.version_id, r.user_id, t.id, t.skill_id, 'Item', 'core', 'missing', t.rn
  FROM perf_rm r CROSS JOIN LATERAL (SELECT id, skill_id, row_number() OVER () AS rn FROM public.topics WHERE slug LIKE 'perf-topic-%' LIMIT 40) t;

INSERT INTO public.daily_plans (id, user_id, roadmap_id, hours_per_day, roadmap_version_id)
  SELECT gen_random_uuid(), user_id, roadmap_id, 2, version_id FROM perf_rm;
INSERT INTO public.daily_plan_items (plan_id, user_id, day_no, sort_order, lineage_id, topic_id, status, completed_at)
  SELECT p.id, p.user_id, d, 1, gen_random_uuid(), (SELECT id FROM public.topics WHERE slug LIKE 'perf-topic-%' LIMIT 1),
         CASE WHEN d <= 100 THEN 'completed'::public.plan_item_status ELSE 'pending' END,
         CASE WHEN d <= 100 THEN now() END
  FROM public.daily_plans p CROSS JOIN generate_series(1, 200) d;

INSERT INTO public.conversations (id, user_id) SELECT gen_random_uuid(), id FROM perf_users;
INSERT INTO public.messages (conversation_id, user_id, role, content, created_at)
  SELECT c.id, c.user_id, CASE WHEN g % 2 = 0 THEN 'user'::public.message_role ELSE 'assistant' END,
         'perf message ' || g, now() - (g || ' minutes')::interval
  FROM public.conversations c CROSS JOIN generate_series(1, 2100) g;

INSERT INTO public.ai_requests
  (user_id,task,feature_key,is_async,job_kind,status,finished_at,provider_key,
   input_units,output_units,total_units,cost_usd,created_at)
  SELECT u.id,
    CASE WHEN g<=10 THEN 'roadmap_generate'::public.ai_task ELSE 'mentor_chat'::public.ai_task END,
    CASE WHEN g<=10 THEN 'roadmap_generator'::public.feature_key ELSE 'ai_mentor'::public.feature_key END,
    g<=10,
    CASE WHEN g<=10 THEN 'roadmap_generate'::public.job_kind ELSE NULL END,
    CASE WHEN g<=10 THEN 'queued'::public.job_status ELSE 'succeeded'::public.job_status END,
    CASE WHEN g<=10 THEN NULL ELSE now() END,
    'dev-provider',1000,500,1500,0.001,now()-(g || ' minutes')::interval
  FROM perf_users u CROSS JOIN generate_series(1,1000) g;

INSERT INTO public.skill_progress (user_id, skill_id, career_level, learning_state, state_reason)
  SELECT u.id, s.id, 'mid', 'practicing', 'perf' FROM perf_users u CROSS JOIN public.skills s WHERE s.slug LIKE 'perf-skill-%';

COMMIT;
-- Fixture postconditions execute before accepting a performance run.
DO $$ BEGIN
 IF (SELECT count(*) FROM public.users WHERE email LIKE 'perf%@test.local')<>100
 OR (SELECT count(*) FROM public.roadmaps WHERE user_id IN (SELECT id FROM perf_users))<>300
 OR (SELECT count(*) FROM public.roadmap_items WHERE user_id IN (SELECT id FROM perf_users))<>12000
 OR (SELECT count(*) FROM public.daily_plan_items WHERE user_id IN (SELECT id FROM perf_users))<>60000
 OR (SELECT count(*) FROM public.messages WHERE user_id IN (SELECT id FROM perf_users))<>210000
 OR (SELECT count(*) FROM public.ai_requests WHERE user_id IN (SELECT id FROM perf_users))<>100000
 OR (SELECT count(*) FROM public.skill_progress WHERE user_id IN (SELECT id FROM perf_users))<>5000
 OR NOT EXISTS(SELECT 1 FROM public.ai_requests WHERE is_async AND status='queued')
 THEN RAISE EXCEPTION 'Performance fixture volume postcondition failed'; END IF;
END $$;
ANALYZE;
```

```sql
-- scripts/db/perf/explain_checks.sql
CREATE SCHEMA IF NOT EXISTS perf;
CREATE OR REPLACE FUNCTION perf.assert_plan(p_name text, p_sql text, p_max_ms numeric, p_index_like text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_plan jsonb;
  v_ms   numeric;
BEGIN
  EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON) ' || p_sql INTO v_plan;
  v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
  RAISE NOTICE 'PERF_PLAN_JSON %', jsonb_build_object('name',p_name,'plan',v_plan);
  IF v_ms > p_max_ms THEN
    RAISE EXCEPTION 'PERF FAIL %: % ms > % ms', p_name, v_ms, p_max_ms;
  END IF;
  IF p_index_like IS NOT NULL AND position(p_index_like IN v_plan::text) = 0 THEN
    RAISE EXCEPTION 'PERF FAIL %: plan does not use index %', p_name, p_index_like;
  END IF;
  RAISE NOTICE 'PERF OK %: % ms', p_name, v_ms;
END $$;

DO $$
DECLARE
  v_user uuid := (SELECT id FROM public.users WHERE email = 'perf1@test.local');
  v_plan uuid := (SELECT id FROM public.daily_plans WHERE user_id = v_user LIMIT 1);
  v_conv uuid := (SELECT id FROM public.conversations WHERE user_id = v_user LIMIT 1);
  v_ver  uuid := (SELECT current_version_id FROM public.roadmaps WHERE user_id = v_user AND is_focus);
BEGIN
  -- roadmap queries
  PERFORM perf.assert_plan('active roadmaps',
    format('SELECT * FROM public.roadmaps WHERE user_id = %L AND status <> %L', v_user, 'archived'), 5, 'idx_roadmaps_user_status');
  PERFORM perf.assert_plan('roadmap items of current version',
    format('SELECT * FROM public.roadmap_items WHERE version_id = %L ORDER BY sequence_no', v_ver), 5, 'uq_roadmap_items_');
  -- learning workflow: Today = next incomplete plan item
  PERFORM perf.assert_plan('today next incomplete day',
    format('SELECT * FROM public.daily_plan_items WHERE plan_id = %L AND status <> %L ORDER BY day_no, sort_order LIMIT 5', v_plan, 'completed'),
    5, 'idx_daily_plan_items_open');
  -- progress tracking
  PERFORM perf.assert_plan('progress by state',
    format('SELECT * FROM public.skill_progress WHERE user_id = %L AND learning_state = %L', v_user, 'practicing'), 10, 'idx_skill_progress_user_state');
  -- message retrieval (keyset page of 20)
  PERFORM perf.assert_plan('message history page',
    format('SELECT * FROM public.messages WHERE conversation_id = %L ORDER BY created_at DESC, id DESC LIMIT 20', v_conv),
    10, 'idx_messages_conversation_created');
  -- AI operations
  PERFORM perf.assert_plan('job polling',
    format('SELECT * FROM public.ai_requests WHERE user_id = %L AND is_async AND status = %L', v_user, 'queued'), 5, 'idx_ai_requests_');
  PERFORM perf.assert_plan('worker queue claim',
    'SELECT id FROM public.ai_requests WHERE is_async AND status = ''queued'' AND available_at <= now() ORDER BY available_at, id LIMIT 10 FOR UPDATE SKIP LOCKED',
    5, 'idx_ai_requests_queue');
  -- AI analytics / admin reporting
  PERFORM perf.assert_plan('usage by feature (30 days)',
    'SELECT feature_key, count(*), sum(cost_usd) FROM public.ai_requests WHERE created_at >= now() - interval ''30 days'' GROUP BY feature_key',
    300, NULL);
  PERFORM perf.assert_plan('admin usage summary',
    'SELECT private.admin_usage_summary(current_date - 30, current_date)', 1000, NULL);
END $$;
```

Standalone extraction command: node scripts/extract-db.mjs. It writes only generated-db artifacts; it never connects to or migrates a database. A DB operator materializes/executes these scripts in a disposable validation environment and records results under R32.

## Accepted E01 implementation contract

FK coverage checks every ordered referencing prefix against a valid ready index (plain or the exact single-column IS NOT NULL partial predicate). Every public FK is reported; only these exact table+constraint+column exceptions are allowed. New actor-named columns are not automatically exempt. Validate observed constraint names and index predicates on installation; owner review and real catalog execution remain R32.

| Schema.Table | Constraint | Ordered columns | Reason | Review |
|---|---|---|---|---|
| public.users | fk_users_suspended_by | suspended_by | Low-volume admin actor pointer; reviewed exception, not a column-name wildcard | Executor specification review 2026-10-19; owner review pending |
| public.admin_users | admin_users_created_by_fkey | created_by | Low-volume admin actor pointer; reviewed exception, not a column-name wildcard | Executor specification review 2026-10-19; owner review pending |
| public.system_configurations | system_configurations_updated_by_fkey | updated_by | Low-volume admin actor pointer; reviewed exception, not a column-name wildcard | Executor specification review 2026-10-19; owner review pending |
| public.feature_controls | feature_controls_updated_by_fkey | updated_by | Low-volume admin actor pointer; reviewed exception, not a column-name wildcard | Executor specification review 2026-10-19; owner review pending |
| public.user_access_overrides | user_access_overrides_updated_by_fkey | updated_by | Low-volume admin actor pointer; reviewed exception, not a column-name wildcard | Executor specification review 2026-10-19; owner review pending |

# END OF DMS v1.2.2
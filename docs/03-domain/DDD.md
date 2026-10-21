# AI Career Intelligence Mentor

# Database Design Document (DDD v1.2.2)

## Production Database Implementation Specification & Migration Readiness Edition

| Metadata Item | Value |
|---|---|
| **Version** | **1.2.2 (Complete 50-Table Schema & Column Specification Edition)** |
| **Supersedes** | DDD v1.1, DDD v1.2, DDD v1.2.1 |
| **Executable SQL Package** | `AI_Career_Intelligence_Mentor_DMS_v1.2.2.md` (`000_extensions.sql` – `020_gaps_and_alignment.sql`) |
| **Baseline Alignment** | PRD v1.4.1 Final Freeze · SAD v1.1.1 (ADRs 001–020) · API Specification v1.5.1 · DIS v1.1.1 · AI SD v1.1.1 · UI/UX Spec v2.0.2 |
| **Status** | **SPECIFIED / RUNTIME NOT EXECUTED — SPECIFICATION CORRECTIONS PREPARED — R32 NOT EXECUTED** |

------------------------------------------------------------------------

# 1. Overview & Governance (`ADR-016`)

This document defines the production relational database architecture for the **AI Career Intelligence Mentor** platform.

Version 1.2.2 resolves all prior gaps between the conceptual domain design and the physical SQL package:
1. **Complete 50-Table & Column Catalog:** Expands the domain table list from `v1.2.1` to include column identities and abbreviated type/key descriptions for all **50 tables** across **11 domains** (including `technology_categories`, `technologies`, `system_configurations`, and the Gap `G1`–`G3` tables `user_ratings`, `content_reports`, `account_deletion_requests`, and `user_skill_aliases`).
2. **Enum Standardization (`public.career_level`):** Clarifies that career seniority (`junior`, `mid`, `senior`) is implemented as the PostgreSQL enum `public.career_level` (part of the **45 custom enums**) rather than a separate lookup table.
3. **Physical DDL Authority (`ADR-016`):** This abbreviated domain reference inherits exact physical definitions from **DMS v1.2.2**; `DMS v1.2.2` (`000_extensions.sql` through `020_gaps_and_alignment.sql`) is the executable SQL source of truth.

------------------------------------------------------------------------

# 2. Database Architecture & Execution Contexts

## 2.1 Technology Stack
- **Database Engine:** PostgreSQL 16+ on Supabase Managed PostgreSQL
- **Authentication:** Supabase Auth (`auth.users`) with JWT Bearer tokens
- **Access Control:** Universal PostgreSQL Row Level Security (RLS enabled on all 50 tables)
- **Extensions (`000_extensions.sql`):** `extensions.citext` (case-insensitive emails), `extensions.pg_trgm` (GIN trigram fuzzy search), and `pg_cron` (scheduled retention purges)
- **Schemas:**
  - `public`: 50 application tables and 45 custom enum types
  - `private`: 22 private functions (10 SECURITY DEFINER + 12 SECURITY INVOKER) with `SET search_path = ''` (never exposed via PostgREST Data API)
  - `extensions`: PostgreSQL extensions

## 2.2 Database Execution Roles (`ADR-019`)

| Execution Context | PostgreSQL Role | Permitted Operations |
|---|---|---|
| **End-User Client (Supabase Data API)** | `authenticated` | `SELECT` only explicitly granted owner/shared rows under active/expiry/technology predicates; queue and deletion status are backend-only. **Zero `INSERT`, `UPDATE`, or `DELETE` grants on any table (`ADR-019`).** |
| **Unauthenticated Client** | `anon` | **Zero table grants.** All public routes go through NestJS. |
| **NestJS Backend & Queue Workers** | `service_role` | Full CRUD after `AccessGuard` verification; executes atomic transactions, skill resolution, evidence calculation, and admin actions. |
| **Migrations & `pg_cron` Jobs** | `postgres` | DDL migrations (`000`–`020`) and scheduled `private.cleanup_*` retention functions. |

------------------------------------------------------------------------

# 3. Complete ENUM Strategy (45 Custom Types)

Defined in `001_enums.sql` (41 base enums) and `020_gaps_and_alignment.sql` (4 feedback/deletion enums):

| # | Enum Name (`public.*`) | Allowed Values | Primary Domain |
|---|---|---|---|
| 1 | `user_status` | `active`, `suspended` | Identity |
| 2 | `auth_provider` | `email`, `phone`, `google`, `facebook` | Identity |
| 3 | `experience_level` | `beginner`, `junior`, `mid`, `senior` | Identity / Profile |
| 4 | `career_level` | `junior`, `mid`, `senior` | Career / Roadmap / Progress |
| 5 | `content_status` | `draft`, `approved`, `hidden`, `retired` | Shared Catalogs |
| 6 | `alias_status` | `candidate`, `validated`, `rejected` | Career / Skills |
| 7 | `goal_status` | `clarifying`, `awaiting_confirmation`, `confirmed`, `discontinued` | Career Goals |
| 8 | `roadmap_status` | `draft`, `locked`, `archived` | Roadmap |
| 9 | `roadmap_version_state` | `draft`, `locked`, `superseded`, `restored` | Roadmap |
| 10 | `roadmap_version_origin` | `user_request`, `ai`, `merge`, `undo` | Roadmap |
| 11 | `item_priority` | `core`, `supporting`, `optional` | Roadmap |
| 12 | `skill_gap_type` | `existing`, `transferable`, `refresh`, `strengthen`, `missing` | Roadmap |
| 13 | `merge_status` | `proposed`, `accepted`, `rejected`, `undone`, `superseded` | Roadmap |
| 14 | `merge_origin` | `user_request`, `level_change`, `ai_proposal` | Roadmap |
| 15 | `merge_op` | `add_topic`, `update_topic`, `reprioritize`, `reclassify`, `retire_topic` | Roadmap |
| 16 | `resource_type` | `official_docs`, `release_notes`, `article`, `standard`, `video`, `other` | Learning |
| 17 | `plan_status` | `active`, `completed` | Learning |
| 18 | `plan_item_status` | `pending`, `in_progress`, `completed` | Learning |
| 19 | `question_type` | `mcq`, `free_response` | Assessment |
| 20 | `question_difficulty` | `basic`, `application`, `analysis` | Assessment / Progress |
| 21 | `attempt_status` | `generated`, `started`, `submitted`, `ai_reviewed`, `feedback_available` | Assessment |
| 22 | `performance_level` | `good`, `needs_work` | Assessment / Progress |
| 23 | `review_status` | `pending`, `reviewed`, `failed`, `not_evidence` | Assessment |
| 24 | `learning_state` | `not_started`, `learning`, `practicing`, `proficient` | Progress |
| 25 | `evidence_source` | `quiz_attempt`, `practice_review` | Progress |
| 26 | `progress_event_type` | `state_change`, `evidence_added` | Progress |
| 27 | `message_role` | `user`, `assistant` | AI Mentor |
| 28 | `ui_language` | `bn`, `en`, `mixed` | AI Mentor / Learning |
| 29 | `conversation_context` | `focus_roadmap`, `topic`, `general` | AI Mentor |
| 30 | `ai_context_type` | `profile`, `roadmap`, `daily_plan`, `practice`, `shared_skill`, `technology_update`, `conversation` | AI Mentor |
| 31 | `ai_task` | `goal_interpretation`, `roadmap_generate`, `roadmap_revision`, `merge_proposal`, `topic_content`, `quiz_generate`, `practice_review`, `mentor_chat`, `technology_update` | AI Operations |
| 32 | `job_status` | `queued`, `preparing`, `succeeded`, `failed` | AI Operations |
| 33 | `job_kind` | `career_goal`, `roadmap_generate`, `roadmap_revision`, `merge_proposal`, `topic_content`, `quiz_generate`, `practice_review` | AI Operations |
| 34 | `ai_validation_status` | `passed`, `failed` | AI Operations |
| 35 | `release_status` | `released`, `announced`, `planned`, `experimental` | Technology Intelligence |
| 36 | `action_timing` | `act_now`, `learn_later`, `awareness_only` | Technology Intelligence |
| 37 | `relevance_level` | `high`, `medium`, `low` | Technology Intelligence |
| 38 | `technology_source_type` | `official_release_notes`, `official_docs`, `maintainer`, `engineering_blog`, `standards_body`, `publication` | Technology Intelligence |
| 39 | `update_state` | `available`, `no_important_changes`, `temporarily_unavailable` | Technology Intelligence |
| 40 | `feature_key` | `roadmap_generator`, `daily_plan`, `quiz_practice`, `ai_practice_review`, `progress_tracking`, `ai_mentor`, `technology_update` | Administration |
| 41 | `admin_role` | `platform_admin` | Administration |
| 42 | `rating_target` | `roadmap_draft`, `roadmap_merge`, `topic_content`, `technology_update` | Quality Feedback (`020`) |
| 43 | `report_target` | `quiz_question`, `practice_review`, `topic_content`, `roadmap_content` | Quality Feedback (`020`) |
| 44 | `report_reason` | `incorrect`, `unclear`, `unfair_scoring`, `inappropriate`, `outdated`, `other` | Quality Feedback (`020`) |
| 45 | `deletion_request_status` | `scheduled`, `in_progress`, `completed` | Identity / Account (`020`) |

------------------------------------------------------------------------

# 4. Complete Domain & Table Specifications (All 50 Tables)

## 4.1 Identity & Account Domain (5 Tables — `002`, `003`, `020`)

### 1. `public.users` (`002_identity.sql`)
- **Purpose:** Core application account state linked 1:1 with `auth.users`.
- **Columns:**
  - `id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`
  - `email extensions.citext` (Partial Unique `uq_users_email WHERE email IS NOT NULL`, length `<= 254`)
  - `phone text` (Partial Unique `uq_users_phone WHERE phone IS NOT NULL`, `CHECK phone ~ '^\+8801[3-9][0-9]{8}$'`)
  - `status public.user_status NOT NULL DEFAULT 'active'`
  - `status_reason text`
  - `suspended_at timestamptz` (`CHECK (status = 'suspended') = (suspended_at IS NOT NULL)`)
  - `suspended_by uuid REFERENCES public.users(id) ON DELETE SET NULL`
  - `verified_contact boolean NOT NULL DEFAULT false`
  - `last_active_at timestamptz` (Drives 7-day Daily Tech Update eligibility per PRD §39)
  - `last_login_at timestamptz`
  - `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`

### 2. `public.user_auth_providers` (`002_identity.sql`)
- **Purpose:** Linked authentication identities (`email`, `phone`, `google`, `facebook`) for safe identity linking (PRD §12).
- **Columns:**
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`
  - `provider public.auth_provider NOT NULL`
  - `provider_subject text NOT NULL`
  - `contact_value text`
  - `verified_at timestamptz`
  - `is_primary boolean NOT NULL DEFAULT false`
  - `linked_at timestamptz NOT NULL DEFAULT now()`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`
- **Constraints:** `UNIQUE (provider, provider_subject)`, `UNIQUE (user_id, provider)`, Partial Unique `uq_user_auth_providers_one_primary ON (user_id) WHERE is_primary`.

### 3. `public.user_profiles` (`003_profiles.sql`)
- **Purpose:** User background, self-reported skills, beginner `"None"` flag, daily learning hours, and IANA timezone (PRD §14).
- **Columns:**
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE`
  - `current_role_title text` (`<= 120` chars)
  - `education text` (`<= 200` chars)
  - `experience_level public.experience_level`
  - `self_reported_skill_ids uuid[] NOT NULL DEFAULT '{}'` (Max cardinality `100`)
  - `existing_skills_none boolean NOT NULL DEFAULT false` (`CHECK NOT (existing_skills_none AND cardinality(self_reported_skill_ids) > 0)`)
  - `preferred_daily_hours numeric(3,1)` (`CHECK preferred_daily_hours BETWEEN 0.5 AND 12 AND preferred_daily_hours * 2 = trunc(preferred_daily_hours * 2)`)
  - `timezone text` (Validated against `pg_timezone_names` by `trg_user_profiles_validate_timezone`)
  - `timezone_detected boolean NOT NULL DEFAULT false`
  - `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`

### 4. `public.user_preferences` (`003_profiles.sql`)
- **Purpose:** User learning style preference.
- **Columns:**
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE`
  - `learning_preference text` (`CHECK learning_preference IN ('reading','hands_on','visual','mixed')`)
  - `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`

### 5. `public.account_deletion_requests` (`020_gaps_and_alignment.sql` — Gap G2)
- **Purpose:** Tracks in-app account deletion requests (`EP-X01`, `EP-X02`, PRD §13). Uses `ON DELETE SET NULL` on `user_id` (`ADR-020`) so an locally completed (pseudonymous until provider references are cleared) tombstone survives after `auth.users` / `public.users` cascade deletion completes.
- **Columns:**
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id uuid REFERENCES public.users(id) ON DELETE SET NULL`
  - `status public.deletion_request_status NOT NULL DEFAULT 'scheduled'`
  - `provider_deletion_requested boolean NOT NULL DEFAULT false`
  - `requested_at timestamptz NOT NULL DEFAULT now()`
  - `completed_at timestamptz`
  - `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`
- **Constraints:** `CHECK ((status = 'completed') = (completed_at IS NOT NULL))`, `CHECK (status = 'completed' OR user_id IS NOT NULL)`, Partial Unique `uq_account_deletion_one_active ON (user_id) WHERE status IN ('scheduled','in_progress')`.

---

## 4.2 Career Intelligence Domain (7 Tables — `004`, `020`)

### 6. `public.career_roles` (`004_career_intelligence.sql`)
- **Purpose:** Canonical technology role identities (PRD §3, §15).
- **Columns:** `id uuid PK`, `slug text NOT NULL UNIQUE`, `name text NOT NULL`, `description text`, `aliases text[] NOT NULL DEFAULT '{}'`, `status public.content_status NOT NULL DEFAULT 'approved'`, `deleted_at timestamptz`, `created_at`, `updated_at`.

### 7. `public.skill_categories` (`004_career_intelligence.sql`)
- **Purpose:** Hierarchical skill grouping taxonomy.
- **Columns:** `id uuid PK`, `slug text NOT NULL UNIQUE`, `name text NOT NULL`, `parent_id uuid REFERENCES public.skill_categories(id)` (`CHECK parent_id <> id`), `created_at`, `updated_at`.

### 8. `public.skills` (`004_career_intelligence.sql`)
- **Purpose:** Shared canonical skill identities reused across roadmaps (PRD §17).
- **Columns:** `id uuid PK`, `slug text NOT NULL UNIQUE`, `canonical_name text NOT NULL` (`1..120` chars), `category_id uuid REFERENCES public.skill_categories(id)`, `description text`, `status public.content_status NOT NULL DEFAULT 'approved'`, `deleted_at timestamptz`, `created_at`, `updated_at`.

### 9. `public.skill_aliases` (`004_career_intelligence.sql`)
- **Purpose:** Global known aliases (`React.js -> React`, `AWS -> Amazon Web Services`; `SQL <> MySQL`).
- **Columns:** `id uuid PK`, `skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE`, `alias text NOT NULL` (`1..80` chars), `alias_normalized text NOT NULL`, `status public.alias_status NOT NULL DEFAULT 'candidate'`, `source text NOT NULL DEFAULT 'seed'` (`seed | ai_candidate | validated_review`), `validated_at timestamptz`, `created_at`, `updated_at`.
- **Constraints:** Partial Unique `uq_skill_aliases_validated ON (alias_normalized) WHERE status = 'validated'`, `UNIQUE (skill_id, alias_normalized)`.

### 10. `public.user_skill_aliases` (`020_gaps_and_alignment.sql` — Gap G3)
- **Purpose:** User-specific skill alias interpretations (`EP-P05`, PRD §17). Never auto-promotes to global `skill_aliases`. Per `ADR-019`, inserting a row via `EP-P05` also atomically appends `skill_id` to `user_profiles.self_reported_skill_ids` and defers level-scoped progress until a confirmed Career Level exists.
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `input_alias text NOT NULL` (`1..80` chars), `alias_normalized text NOT NULL`, `skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE`, `created_at`, `updated_at`.
- **Constraints:** `UNIQUE (user_id, alias_normalized)`.

### 11. `public.skill_dependencies` (`004_career_intelligence.sql`)
- **Purpose:** Directed prerequisite graph between canonical skills.
- **Columns:** `id uuid PK`, `skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE`, `depends_on_skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE`, `created_at`.
- **Constraints:** `UNIQUE (skill_id, depends_on_skill_id)`, `CHECK (skill_id <> depends_on_skill_id)`.

### 12. `public.career_goals` (`004_career_intelligence.sql`)
- **Purpose:** Dynamic user technology career goals with up to 2 AI clarification rounds (PRD §15).
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `goal_text text NOT NULL` (`3..300` chars), `status public.goal_status NOT NULL DEFAULT 'clarifying'`, `clarification_round smallint NOT NULL DEFAULT 0` (`0..2`), `clarification_question text`, `clarifications jsonb NOT NULL DEFAULT '[]'`, `proposed_role_id uuid REFERENCES public.career_roles(id)`, `alternative_role_ids uuid[] NOT NULL DEFAULT '{}'`, `suggested_level public.career_level`, `target_level public.career_level`, `confirmed_role_id uuid REFERENCES public.career_roles(id)`, `confirmed_at timestamptz`, `discontinued_at timestamptz`, `created_at`, `updated_at`.

---

## 4.3 Roadmap Domain (5 Tables — `005_roadmap.sql`)

### 13. `public.roadmaps`
- **Purpose:** Root aggregate per confirmed career goal. Max 3 non-archived roadmaps per user (`trg_roadmaps_limit`); at most 1 Focus Roadmap (`uq_roadmaps_one_focus`).
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `career_goal_id uuid NOT NULL UNIQUE REFERENCES public.career_goals(id) ON DELETE CASCADE`, `canonical_role_id uuid NOT NULL REFERENCES public.career_roles(id)`, `target_level public.career_level NOT NULL`, `status public.roadmap_status NOT NULL DEFAULT 'draft'`, `is_focus boolean NOT NULL DEFAULT false` (`CHECK NOT is_focus OR status = 'locked'`), `current_version_id uuid REFERENCES public.roadmap_versions(id) DEFERRABLE INITIALLY DEFERRED`, `locked_at timestamptz`, `archived_at timestamptz`, `archive_reason text`, `created_at`, `updated_at`.

### 14. `public.roadmap_versions`
- **Purpose:** Immutable roadmap content snapshots (`trg_roadmap_versions_guard`).
- **Columns:** `id uuid PK`, `roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `version_no integer NOT NULL` (`>= 1`), `state public.roadmap_version_state NOT NULL DEFAULT 'draft'`, `created_by public.roadmap_version_origin NOT NULL`, `target_level public.career_level NOT NULL`, `base_version_id uuid REFERENCES public.roadmap_versions(id)`, `merge_id uuid REFERENCES public.roadmap_merges(id) DEFERRABLE INITIALLY DEFERRED`, `summary jsonb NOT NULL DEFAULT '{}'`, `phases jsonb NOT NULL DEFAULT '[]'`, `level_outline jsonb NOT NULL DEFAULT '[]'`, `warnings jsonb NOT NULL DEFAULT '[]'`, `stale boolean NOT NULL DEFAULT false`, `stale_reason text`, `context_hash text`, `ai_generation_id uuid REFERENCES public.ai_generations(id) ON DELETE SET NULL`, `locked_at timestamptz`, `superseded_at timestamptz`, `created_at`, `updated_at`.
- **Constraints:** `UNIQUE (roadmap_id, version_no)`, Partial Unique `uq_roadmap_versions_one_draft ON (roadmap_id) WHERE state = 'draft'`.

### 15. `public.roadmap_items`
- **Purpose:** Append-only curriculum items within a roadmap version (`trg_roadmap_items_append_only`).
- **Columns:** `id uuid PK`, `version_id uuid NOT NULL REFERENCES public.roadmap_versions(id) ON DELETE CASCADE`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `lineage_id uuid NOT NULL DEFAULT gen_random_uuid()`, `topic_id uuid NOT NULL REFERENCES public.topics(id)`, `skill_id uuid NOT NULL REFERENCES public.skills(id)`, `phase_no smallint NOT NULL DEFAULT 1`, `phase_title text`, `title text NOT NULL`, `priority public.item_priority NOT NULL`, `gap_type public.skill_gap_type NOT NULL`, `required_depth text`, `estimated_effort_hours numeric(5,1)`, `sequence_no integer NOT NULL`, `depends_on_lineage_ids uuid[] NOT NULL DEFAULT '{}'`, `reason text`, `retired boolean NOT NULL DEFAULT false`, `retired_at timestamptz`, `sources jsonb NOT NULL DEFAULT '[]'`, `created_at`.
- **Constraints:** `UNIQUE (version_id, lineage_id)`, `UNIQUE (version_id, topic_id)`, `UNIQUE (version_id, sequence_no)`.

### 16. `public.roadmap_merges`
- **Purpose:** Post-lock change proposals (`user_request`, `level_change`, `ai_proposal`) and 1-step Undo snapshot (PRD §18, §21).
- **Columns:** `id uuid PK`, `roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `origin public.merge_origin NOT NULL`, `status public.merge_status NOT NULL DEFAULT 'proposed'`, `base_version_id uuid NOT NULL REFERENCES public.roadmap_versions(id)`, `result_version_id uuid REFERENCES public.roadmap_versions(id) DEFERRABLE INITIALLY DEFERRED`, `target_level public.career_level`, `instruction text` (`<= 1000` chars), `reason text`, `size_before integer`, `size_after integer`, `materially_large boolean NOT NULL DEFAULT false`, `daily_plan_impact jsonb NOT NULL DEFAULT '{}'`, `undo_snapshot jsonb`, `ai_generation_id uuid REFERENCES public.ai_generations(id) ON DELETE SET NULL`, `accepted_at timestamptz`, `rejected_at timestamptz`, `undone_at timestamptz`, `undo_window_closed_at timestamptz`, `created_at`, `updated_at`.
- **Constraints:** Partial Unique `uq_roadmap_merges_one_open ON (roadmap_id) WHERE status = 'proposed'`, Partial Unique `uq_roadmap_merges_one_undoable ON (roadmap_id) WHERE status = 'accepted' AND undo_window_closed_at IS NULL`.

### 17. `public.roadmap_merge_items`
- **Purpose:** Append-only operations belonging to a merge proposal (`trg_roadmap_merge_items_append_only`).
- **Columns:** `id uuid PK`, `merge_id uuid NOT NULL REFERENCES public.roadmap_merges(id) ON DELETE CASCADE`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `sort_order smallint NOT NULL`, `op public.merge_op NOT NULL`, `lineage_id uuid`, `topic_id uuid REFERENCES public.topics(id)`, `title text`, `priority public.item_priority`, `reason text`, `payload jsonb NOT NULL DEFAULT '{}'`, `created_at`.

---

## 4.4 Learning Domain (4 Tables — `006_learning.sql`)

### 18. `public.topics`
- **Purpose:** Shared canonical topic content per skill, Career Level, and content version (PRD §28, §30).
- **Columns:** `id uuid PK`, `skill_id uuid NOT NULL REFERENCES public.skills(id)`, `slug text NOT NULL`, `title text NOT NULL`, `career_level public.career_level NOT NULL`, `content_version integer NOT NULL DEFAULT 1`, `status public.content_status NOT NULL DEFAULT 'draft'`, `explanation_markdown text`, `important_questions jsonb NOT NULL DEFAULT '[]'`, `language public.ui_language NOT NULL DEFAULT 'mixed'`, `ai_generation_id uuid REFERENCES public.ai_generations(id) ON DELETE SET NULL`, `approved_at timestamptz`, `hidden_at timestamptz`, `hidden_reason text`, `deleted_at timestamptz`, `created_at`, `updated_at`.
- **Constraints:** `UNIQUE (skill_id, slug, career_level, content_version)`, Partial Unique `uq_topics_one_approved ON (skill_id, slug, career_level) WHERE status = 'approved' AND deleted_at IS NULL`.

### 19. `public.learning_resources`
- **Purpose:** Attribution links for a shared topic (PRD §28, §58).
- **Columns:** `id uuid PK`, `topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE`, `title text NOT NULL`, `publisher text NOT NULL`, `url text NOT NULL` (`^https?://`), `resource_type public.resource_type NOT NULL DEFAULT 'official_docs'`, `retrieved_at timestamptz`, `status public.content_status NOT NULL DEFAULT 'approved'`, `deleted_at timestamptz`, `created_at`, `updated_at`.

### 20. `public.daily_plans`
- **Purpose:** Roadmap-specific sequential Daily Plan independent of Focus status (PRD §16, §27).
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `roadmap_id uuid NOT NULL UNIQUE REFERENCES public.roadmaps(id) ON DELETE CASCADE`, `hours_per_day numeric(3,1) NOT NULL` (`0.5..12.0` step `0.5`), `status public.plan_status NOT NULL DEFAULT 'active'`, `roadmap_version_id uuid REFERENCES public.roadmap_versions(id)`, `plan_revision integer NOT NULL DEFAULT 1`, `created_at`, `updated_at`.

### 21. `public.daily_plan_items`
- **Purpose:** Sequential learning days (`day_no >= 1`). Missed calendar days never skip items (PRD §27).
- **Columns:** `id uuid PK`, `plan_id uuid NOT NULL REFERENCES public.daily_plans(id) ON DELETE CASCADE`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `day_no integer NOT NULL`, `sort_order smallint NOT NULL DEFAULT 1`, `lineage_id uuid NOT NULL`, `topic_id uuid NOT NULL REFERENCES public.topics(id)`, `allocated_hours numeric(4,1)`, `status public.plan_item_status NOT NULL DEFAULT 'pending'`, `started_at timestamptz`, `completed_at timestamptz`, `reconciled_by_merge_id uuid REFERENCES public.roadmap_merges(id) ON DELETE SET NULL`, `created_at`, `updated_at`.
- **Constraints:** `UNIQUE (plan_id, day_no, sort_order)`, `UNIQUE (plan_id, lineage_id)`.

---

## 4.5 Assessment Domain (5 Tables — `007_assessment.sql`)

### 22. `public.quizzes`
- **Purpose:** Shared reusable quiz packages (`20` MCQ + `5..10` free-response unless `is_reduced`; `variant_no` 1 and 2 for retry) (PRD §29–§32). Shielded from direct client access (`DENY` RLS).
- **Columns:** `id uuid PK`, `topic_id uuid NOT NULL REFERENCES public.topics(id)`, `content_version integer NOT NULL DEFAULT 1`, `variant_no smallint NOT NULL DEFAULT 1` (`1..2`), `status public.content_status NOT NULL DEFAULT 'draft'`, `mcq_count smallint NOT NULL`, `free_response_count smallint NOT NULL`, `is_reduced boolean NOT NULL DEFAULT false`, `ai_generation_id uuid REFERENCES public.ai_generations(id) ON DELETE SET NULL`, `approved_at timestamptz`, `hidden_at timestamptz`, `hidden_reason text`, `created_at`, `updated_at`.

### 23. `public.quiz_questions`
- **Purpose:** Shared quiz questions, MCQ answer keys (`correct_option_id`), explanations, and free-response rubrics. Shielded from direct client access (`DENY` RLS).
- **Columns:** `id uuid PK`, `quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE`, `sort_order smallint NOT NULL`, `question_type public.question_type NOT NULL`, `difficulty public.question_difficulty NOT NULL`, `prompt text NOT NULL`, `options jsonb`, `correct_option_id text`, `explanation text`, `rubric jsonb`, `response_hint text`, `max_length integer` (`1..8000`), `allow_i_dont_know boolean NOT NULL DEFAULT true`, `hidden_at timestamptz`, `hidden_reason text`, `created_at`, `updated_at`.

### 24. `public.quiz_attempts`
- **Purpose:** Per-user quiz attempts (`attempt_no` 1 = initial, 2 = single retry) (PRD §32–§33). Starting an attempt on a post-merge item closes the merge Undo window (`trg_quiz_attempts_close_undo`).
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `daily_plan_item_id uuid NOT NULL REFERENCES public.daily_plan_items(id) ON DELETE CASCADE`, `quiz_id uuid NOT NULL REFERENCES public.quizzes(id)`, `attempt_no smallint NOT NULL DEFAULT 1` (`1..2`), `retry_of_attempt_id uuid REFERENCES public.quiz_attempts(id)`, `status public.attempt_status NOT NULL DEFAULT 'generated'`, `question_ids uuid[] NOT NULL`, `started_at timestamptz`, `submitted_at timestamptz`, `reviewed_at timestamptz`, `mcq_correct smallint`, `mcq_total smallint`, `performance_level public.performance_level`, `improvement_recommendations jsonb NOT NULL DEFAULT '[]'`, `created_at`, `updated_at`.
- **Constraints:** `UNIQUE (daily_plan_item_id, attempt_no)`.

### 25. `public.quiz_answers`
- **Purpose:** Autosaved and submitted answers. Raw `answer_text` expires after 90 days (`raw_text_expires_at`, PRD §52).
- **Columns:** `id uuid PK`, `attempt_id uuid NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `question_id uuid NOT NULL REFERENCES public.quiz_questions(id)`, `selected_option_id text`, `answer_text text` (`<= 8000` chars), `i_dont_know boolean NOT NULL DEFAULT false`, `is_correct boolean`, `saved_at timestamptz NOT NULL DEFAULT now()`, `raw_text_expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days')`, `raw_text_purged_at timestamptz`, `created_at`, `updated_at`.
- **Constraints:** `UNIQUE (attempt_id, question_id)`.

### 26. `public.practice_reviews`
- **Purpose:** Formative AI Practice Review on submitted short free-response answers (PRD §31).
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `attempt_id uuid NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE`, `answer_id uuid NOT NULL UNIQUE REFERENCES public.quiz_answers(id) ON DELETE CASCADE`, `question_id uuid NOT NULL REFERENCES public.quiz_questions(id)`, `review_status public.review_status NOT NULL DEFAULT 'pending'`, `performance_level public.performance_level`, `dimensions jsonb`, `strengths jsonb NOT NULL DEFAULT '[]'`, `mistakes jsonb NOT NULL DEFAULT '[]'`, `weaknesses jsonb NOT NULL DEFAULT '[]'`, `improvement_recommendations jsonb NOT NULL DEFAULT '[]'`, `evidence_eligible boolean NOT NULL DEFAULT false` (`false` for junk/non-attempts), `ai_generation_id uuid REFERENCES public.ai_generations(id) ON DELETE SET NULL`, `failure_code text`, `reviewed_at timestamptz`, `created_at`, `updated_at`.

---

## 4.6 Progress Domain (3 Tables — `008_progress.sql`)

### 27. `public.learning_evidence`
- **Purpose:** Append-only derived learning evidence (`trg_learning_evidence_append_only`, PRD §35). Survives 90-day raw answer purge (PRD §52).
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `skill_id uuid NOT NULL REFERENCES public.skills(id)`, `career_level public.career_level NOT NULL`, `roadmap_id uuid REFERENCES public.roadmaps(id)`, `topic_id uuid NOT NULL REFERENCES public.topics(id)`, `source_type public.evidence_source NOT NULL`, `source_id uuid NOT NULL`, `difficulty public.question_difficulty NOT NULL`, `score_summary jsonb NOT NULL`, `performance_level public.performance_level`, `attempt_no smallint NOT NULL` (`1..2`), `occurred_at timestamptz NOT NULL`, `created_at`.
- **Constraints:** `UNIQUE (source_type, source_id, skill_id)`.

### 28. `public.skill_progress`
- **Purpose:** Current learning state (`not_started`, `learning`, `practicing`, `proficient`) per user, canonical skill, and Career Level (PRD §34–§36). Never contains a `"job_ready"` column.
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `skill_id uuid NOT NULL REFERENCES public.skills(id)`, `career_level public.career_level NOT NULL`, `learning_state public.learning_state NOT NULL DEFAULT 'not_started'`, `state_reason text` (`NOT NULL` when `learning_state <> 'not_started'`, enforced by `trg_skill_progress_guard`), `last_evidence_at timestamptz`, `evidence_count integer NOT NULL DEFAULT 0`, `state_changed_at timestamptz NOT NULL DEFAULT now()`, `created_at`, `updated_at`.
- **Constraints:** `UNIQUE (user_id, skill_id, career_level)`.

### 29. `public.achievement_history`
- **Purpose:** Append-only explainable log of state changes and evidence additions (`trg_achievement_history_append_only`, `EP-G03`).
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `skill_id uuid NOT NULL REFERENCES public.skills(id)`, `career_level public.career_level NOT NULL`, `event_type public.progress_event_type NOT NULL`, `from_state public.learning_state`, `to_state public.learning_state`, `reason text`, `source_type public.evidence_source`, `source_id uuid`, `occurred_at timestamptz NOT NULL DEFAULT now()`, `created_at`.

---

## 4.7 AI Mentor Domain (4 Tables — `009_ai_mentor.sql`)

### 30. `public.conversations`
- **Purpose:** Private user mentor sessions with `summarized_through_at` watermark (PRD §37, §49, §51).
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `context_type public.conversation_context NOT NULL DEFAULT 'general'`, `roadmap_id uuid REFERENCES public.roadmaps(id) ON DELETE SET NULL`, `topic_id uuid REFERENCES public.topics(id) ON DELETE SET NULL`, `title text` (`<= 200` chars), `last_message_at timestamptz`, `summarized_through_at timestamptz`, `created_at`, `updated_at`.

### 31. `public.messages`
- **Purpose:** Private chat messages (90-day maximum retention independent of summaries, PRD §52). Zero admin access (PRD §51).
- **Columns:** `id uuid PK`, `conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `role public.message_role NOT NULL`, `content text NOT NULL` (`1..4000` user, `1..16000` assistant), `language public.ui_language NOT NULL DEFAULT 'mixed'`, `client_message_id uuid`, `reply_to_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL`, `safety_mode boolean NOT NULL DEFAULT false`, `learning_claim_recorded boolean NOT NULL DEFAULT false`, `ai_generation_id uuid REFERENCES public.ai_generations(id) ON DELETE SET NULL`, `expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days')`, `created_at`.
- **Constraints:** Partial Unique `uq_messages_client_message ON (conversation_id, client_message_id) WHERE client_message_id IS NOT NULL`.

### 32. `public.conversation_summaries`
- **Purpose:** Rolling episodic conversation summaries used instead of full chat history (PRD §49).
- **Columns:** `id uuid PK`, `conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `version_no integer NOT NULL` (`>= 1`), `summary_text text NOT NULL` (`1..8000` chars), `covers_until timestamptz NOT NULL`, `ai_generation_id uuid REFERENCES public.ai_generations(id) ON DELETE SET NULL`, `created_at`.
- **Constraints:** `UNIQUE (conversation_id, version_no)`.

### 33. `public.ai_context_records`
- **Purpose:** Compact TTL-bounded AI memory records purged hourly once `valid_until < now()` (PRD §49).
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `context_type public.ai_context_type NOT NULL`, `scope_key text NOT NULL DEFAULT ''`, `summary_text text NOT NULL` (`1..8000` chars), `source_ref jsonb NOT NULL DEFAULT '{}'`, `version integer NOT NULL DEFAULT 1`, `valid_until timestamptz NOT NULL`, `created_at`, `updated_at`.
- **Constraints:** `UNIQUE (user_id, context_type, scope_key)`.

---

## 4.8 AI Operations Domain (4 Tables — `010_ai_operations.sql`)

### 34. `public.ai_models`
- **Purpose:** Approved provider/model catalog with task-specific approvals and `real_user_data_approved` gate (PRD §47).
- **Columns:** `id uuid PK`, `provider_key text NOT NULL`, `model_identifier text NOT NULL`, `display_name text NOT NULL`, `input_price_per_m_units numeric(14,6) NOT NULL DEFAULT 0`, `output_price_per_m_units numeric(14,6) NOT NULL DEFAULT 0`, `approved_tasks public.ai_task[] NOT NULL DEFAULT '{}'`, `real_user_data_approved boolean NOT NULL DEFAULT false`, `fallback_rank smallint`, `is_active boolean NOT NULL DEFAULT true`, `created_at`, `updated_at`.
- **Constraints:** `UNIQUE (provider_key, model_identifier)`.

### 35. `public.prompt_versions`
- **Purpose:** Versioned prompt template registry with SHA-256 `template_hash`.
- **Columns:** `id uuid PK`, `task public.ai_task NOT NULL`, `name text NOT NULL`, `version integer NOT NULL` (`>= 1`), `template_ref text NOT NULL`, `template_hash text NOT NULL`, `output_schema_id text NOT NULL`, `is_active boolean NOT NULL DEFAULT true`, `created_at`.
- **Constraints:** `UNIQUE (task, name, version)`.

### 36. `public.ai_requests`
- **Purpose:** Durable asynchronous job queue (`FOR UPDATE SKIP LOCKED` per `ADR-017`) and bounded private queue input plus content-free operational telemetry (purged at most 30 days from `created_at` per PRD §52).
- **Columns:** `id uuid PK`, `user_id uuid REFERENCES public.users(id) ON DELETE CASCADE`, `task public.ai_task NOT NULL`, `feature_key public.feature_key`, `job_kind public.job_kind`, `is_async boolean NOT NULL DEFAULT false`, `status public.job_status NOT NULL DEFAULT 'queued'`, `input_payload jsonb` (service-only, object, <=32768 bytes), `idempotency_key text`, `subject_type text`, `subject_id uuid`, `result_type text`, `result_id uuid`, `error_code text`, `error_message text`, `retryable boolean NOT NULL DEFAULT false`, `attempt_count smallint NOT NULL DEFAULT 0`, `available_at timestamptz NOT NULL DEFAULT now()`, `locked_at timestamptz`, `locked_by text`, `started_at timestamptz`, `finished_at timestamptz`, `http_request_id uuid`, `language public.ui_language`, `provider_key text`, `model_id uuid REFERENCES public.ai_models(id)`, `fallback_used boolean NOT NULL DEFAULT false`, `prompt_version_id uuid REFERENCES public.prompt_versions(id)`, `input_units bigint NOT NULL DEFAULT 0`, `output_units bigint NOT NULL DEFAULT 0`, `total_units bigint NOT NULL DEFAULT 0` (trigger `trg_ai_requests_a_total`), `cost_usd numeric(14,8) NOT NULL DEFAULT 0` (trigger `trg_ai_requests_b_cost`), `latency_ms integer`, `validation_status public.ai_validation_status`, `created_at`, `updated_at`.
- **Constraints:** Partial Unique `uq_ai_requests_idempotency ON (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.

### 37. `public.ai_generations`
- **Purpose:** Content-free durable provider/model provenance for generated shared and user artifacts (PRD §30, §47). Survives 30-day `ai_requests` purge (`request_id ON DELETE SET NULL`).
- **Columns:** `id uuid PK`, `request_id uuid REFERENCES public.ai_requests(id) ON DELETE SET NULL`, `task public.ai_task NOT NULL`, `provider_key text NOT NULL`, `model_id uuid REFERENCES public.ai_models(id)`, `prompt_version_id uuid REFERENCES public.prompt_versions(id)`, `output_schema_id text`, `validation_status public.ai_validation_status NOT NULL`, `fallback_used boolean NOT NULL DEFAULT false`, `language public.ui_language`, `input_units bigint NOT NULL DEFAULT 0`, `output_units bigint NOT NULL DEFAULT 0`, `total_units bigint NOT NULL DEFAULT 0`, `cost_usd numeric(14,8) NOT NULL DEFAULT 0`, `latency_ms integer`, `output_hash text`, `created_at`.

---

## 4.9 Technology Intelligence Domain (6 Tables — `011_technology_intelligence.sql`)

### 38. `public.technology_categories`
- **Columns:** `id uuid PK`, `slug text NOT NULL UNIQUE`, `name text NOT NULL`, `created_at`, `updated_at`.

### 39. `public.technologies`
- **Columns:** `id uuid PK`, `category_id uuid REFERENCES public.technology_categories(id)`, `skill_id uuid REFERENCES public.skills(id)`, `slug text NOT NULL UNIQUE`, `name text NOT NULL`, `official_url text`, `status public.content_status NOT NULL DEFAULT 'approved'`, `deleted_at timestamptz`, `created_at`, `updated_at`.

### 40. `public.technology_sources`
- **Purpose:** Configured preferred-source allowlist (PRD §41).
- **Columns:** `id uuid PK`, `name text NOT NULL`, `publisher text NOT NULL`, `base_url text NOT NULL UNIQUE`, `source_type public.technology_source_type NOT NULL`, `trust_tier smallint NOT NULL DEFAULT 2` (`1..3`), `is_active boolean NOT NULL DEFAULT true`, `created_at`, `updated_at`.

### 41. `public.technology_updates`
- **Purpose:** Deduplicated (`content_hash`), source-grounded technology update facts (PRD §40–§45).
- **Columns:** `id uuid PK`, `technology_id uuid REFERENCES public.technologies(id)`, `source_id uuid REFERENCES public.technology_sources(id)`, `title text NOT NULL`, `what_changed text NOT NULL`, `publisher text NOT NULL`, `source_url text NOT NULL`, `fetched_at timestamptz NOT NULL`, `published_at timestamptz`, `release_status public.release_status NOT NULL`, `content_hash text NOT NULL UNIQUE`, `ai_generation_id uuid REFERENCES public.ai_generations(id) ON DELETE SET NULL`, `created_at`.

### 42. `public.user_update_relevance`
- **Purpose:** Personalized update relevance (`high/medium/low`), `action_timing` (`act_now/learn_later/awareness_only`), and `why_it_matters` (PRD §42).
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `update_id uuid NOT NULL REFERENCES public.technology_updates(id) ON DELETE CASCADE`, `relevance public.relevance_level NOT NULL`, `action_timing public.action_timing NOT NULL`, `why_it_matters text NOT NULL`, `roadmap_relation text`, `focus_roadmap_id uuid REFERENCES public.roadmaps(id) ON DELETE SET NULL`, `computed_at timestamptz NOT NULL DEFAULT now()`, `created_at`.
- **Constraints:** `UNIQUE (user_id, update_id)`.

### 43. `public.update_delivery_history`
- **Purpose:** Stores at most one update outcome per eligible user per local calendar date (`available`, `no_important_changes`, `temporarily_unavailable`) (PRD §39–§46).
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `update_id uuid REFERENCES public.technology_updates(id)`, `local_date date NOT NULL`, `state public.update_state NOT NULL DEFAULT 'available'`, `delivered_at timestamptz NOT NULL DEFAULT now()`, `viewed_at timestamptz`, `created_at`.
- **Constraints:** `UNIQUE (user_id, local_date)`, Partial Unique `uq_update_delivery_user_update ON (user_id, update_id) WHERE update_id IS NOT NULL`.

---

## 4.10 Quality Feedback Domain (2 Tables — `020_gaps_and_alignment.sql` — Gap G1)

### 44. `public.user_ratings`
- **Purpose:** 1–5 star ratings on `roadmap_draft`, `roadmap_merge`, `topic_content`, and `technology_update` (`EP-F01`, PRD §24).
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `target_type public.rating_target NOT NULL`, `target_id uuid NOT NULL`, `score smallint NOT NULL` (`1..5`), `comment text` (`<= 500` chars), `created_at`, `updated_at`.
- **Constraints:** `UNIQUE (user_id, target_type, target_id)`.

### 45. `public.content_reports`
- **Purpose:** Append-only quality reports on `quiz_question`, `practice_review`, `topic_content`, and `roadmap_content` (`EP-F02`, PRD §24, §32). Trigger `trg_content_reports_threshold` auto-hides shared `topics` or `quiz_questions` once independent user reports reach `quality.report_auto_hide_threshold`.
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `target_type public.report_target NOT NULL`, `target_id uuid NOT NULL`, `reason public.report_reason NOT NULL`, `comment text` (`<= 1000` chars), `created_at`.
- **Constraints:** `UNIQUE (user_id, target_type, target_id)`.

---

## 4.11 Administration Domain (5 Tables — `012_administration.sql`)

### 46. `public.admin_users`
- **Purpose:** Trusted server-side platform administrator table (PRD §50).
- **Columns:** `user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE`, `role public.admin_role NOT NULL DEFAULT 'platform_admin'`, `created_at`, `created_by uuid REFERENCES public.users(id) ON DELETE SET NULL`.

### 47. `public.system_configurations`
- **Purpose:** Non-secret runtime configuration parameters and PRD thresholds.
- **Columns:** `id uuid PK`, `config_key text NOT NULL UNIQUE`, `config_value jsonb NOT NULL`, `description text`, `updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL`, `created_at`, `updated_at`.

### 48. `public.feature_controls`
- **Purpose:** Global feature toggles and per-user defaults (`technology_update` has `default_user_enabled = false` per PRD §7).
- **Columns:** `feature_key public.feature_key PRIMARY KEY`, `enabled boolean NOT NULL DEFAULT true`, `default_user_enabled boolean NOT NULL DEFAULT true`, `updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL`, `created_at`, `updated_at`.

### 49. `public.user_access_overrides`
- **Purpose:** Per-user feature access overrides managed by admin (`EP-AD06`, PRD §7).
- **Columns:** `id uuid PK`, `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`, `feature_key public.feature_key NOT NULL`, `enabled boolean NOT NULL`, `updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL`, `created_at`, `updated_at`.
- **Constraints:** `UNIQUE (user_id, feature_key)`.

### 50. `public.admin_audit_logs`
- **Purpose:** Tamper-proof append-only log of all administrative actions (`trg_admin_audit_logs_append_only`, `EP-AD07`).
- **Columns:** `id uuid PK`, `actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL`, `action text NOT NULL` (`1..120` chars), `target_type text`, `target_id uuid`, `target_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL`, `before_state jsonb`, `after_state jsonb`, `http_request_id uuid`, `ip_address inet`, `created_at`.

------------------------------------------------------------------------

# 5. Security, RLS & Admin Privacy Model

1. **Universal RLS:** Enabled on all **50 tables** (`017_rls.sql` + `020_gaps_and_alignment.sql`).
2. **Owner Read Isolation:** All user-owned tables enforce `USING (user_id = (SELECT auth.uid()))` (or `id = (SELECT auth.uid())` on `users`).
3. **Backend-Mediated Writes (`ADR-019`):** `anon` and `authenticated` hold **zero** `INSERT`, `UPDATE`, or `DELETE` grants on any table. Every mutation flows through the NestJS backend (`service_role`).
4. **Answer Key Shielding:** `quizzes` and `quiz_questions` have RLS enabled with zero client policies (`DENY`).
5. **Admin Privacy Firewall (PRD §51):** `private.is_admin()` grants `SELECT` only on `users`, `user_access_overrides`, and `admin_audit_logs`. Admins have zero RLS policies and zero API endpoints to read `messages`, `conversations`, `conversation_summaries`, `ai_context_records`, or `quiz_answers`.

------------------------------------------------------------------------

# 6. Performance, Backup & Readiness Summary

- **Index Coverage:** 103 secondary indexes (`014_indexes.sql` + `020_gaps_and_alignment.sql`) supply leading indexes subject to E01 named exceptions; `<5–10ms` is an unmeasured query target.
- **Retention Automation (`pg_cron`):** `private.cleanup_expired_ai_context()` runs hourly; `private.cleanup_expired_retention()` runs daily (90d raw answer text purge, 90d message purge independent of summaries, 30d creation-clock `ai_requests` purge).
- **Backup & Recovery:** Daily physical base backups, continuous WAL archiving for PITR (`RPO < 5 min`, `RTO < 30 min`), and 21 reversible down-migrations (`020_down.sql` to `000_down.sql`).
- **Readiness Score:** **NOT AN EXECUTION SCORE (Runtime readiness pending — Zero Open Gaps)**

## Accepted R10 implementation contract

Direct authenticated reads of ordinary owner/shared rows require an active account; technology_updates, user_update_relevance and update_delivery_history also require effective technology_update access. Settings exceptions are own users row, linked identities, minimal feature-control display metadata, and deletion status through EP-X02. The users policy must not recursively query itself. Active users retain existing roadmap/plan/progress/chat reads when generation flags are OFF. service_role queries enforce the same rules. Never add a permissive alternative that ORs away these restrictions.

## Accepted R26 implementation contract

Product-fixed settings remain 3 active roadmaps, 2 clarification rounds, 1 quiz
retry and 20 standard MCQs; standard free-response bounds remain 5 and 10,
and technology active_window_days remains 7. A change needs PRD change control.
Retention settings are positive integers capped at 90/90/30 days; a shorter
policy must be declared. Tunable report/AI/soft-size defaults are not new PRD
limits. Proposed operational bounds: report threshold 2..1000; AI quota and
soft-size values 1..10000. Enforce types (no strings, null or fractional values).
Only reviewed operational migrations/service-role tooling may update configs;
no new admin configuration UI is introduced. Cache at most five seconds, invalidate
on approved update; expiry/missing/invalid values use a validated safe default,
never an unlimited fallback. Retention enforcement independently clamps ceilings.

Versioned server-only operating defaults (not unregistered system_configurations keys): worker lease 120s, heartbeat 30s, attempts 5, total age 3600s; scheduler external deadline 60s/concurrency 2; deletion receipt 24h; provider cleanup deadline <=30d from request. Validate positive integers, heartbeat<lease, total age<=3600s, attempts 1..5, scheduler capacity within dedicated connection budget. Auth defaults are in R31. These are engineering defaults, not PRD limits.

## Accepted R12 implementation contract

Create the domain request and its queued ai_requests row/input_payload in one
transaction before returning 202. Envelope: {v:1,args:{...},expected_refs:{...}}.
Reject unknown v/fields and oversized inputs. Persist only validated DTO inputs
and required version references, never an assembled prompt, fetched web page,
raw completion or hidden provider credentials. Mark input_payload service-only;
do not include it in JobStatusDTO, admin telemetry, logs or direct-client columns.
Clear it on succeeded or final nonretryable failure. Preserve it across transient
retryable failed→queued recovery only within R13's finite deadline; then purge.
Bound stalled lifetime under R13/R09.
Use subject/result references for durable output, not another output copy here.

Version-1 args schemas (reject unknown properties; validate UUID ownership):
roadmap_generate={career_goal_id}; expected_refs={goal_updated_at,profile_updated_at}.
roadmap_revision={roadmap_id,base_version_no,instruction?,refresh_stale}; require instruction or refresh_stale=true.
merge_proposal={roadmap_id,base_version_no,origin,instruction?,target_level?}; user_request requires instruction, level_change requires changed target_level; AI origin requires immutable source reference.
topic_content={topic_id,skill_id,career_level,content_version}; expected_refs identifies accepted content/roadmap version.
quiz_generate={daily_plan_item_id,topic_id,content_version,variant_no}; reuse an existing generated attempt.
practice_review={review_id,attempt_id}; expected_refs={submitted_at,answer_saved_at}; recheck raw text expiry.
career_goal is synchronous and excluded from async dispatch. Producer validation precedes durable INSERT. Revalidate owner/version/access at execution; changed refs return STALE_JOB_INPUT, never silently substitute context. Retrying stale inputs requires explicit producer validation/refresh or a new logical request. JobStatusDTO/admin logs never expose input_payload.

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

Raw mentor text expires at the earlier of expires_at and created_at+90d; API/service/direct reads apply both predicates. Prepare summaries before expiry; a failed summarizer never delays purge or fabricates memory. Physical purge lag must be measured under R32: the daily cron alone is not a strict boundary guarantee. Production requires a monitored purge runner at the declared cutoff, outage recovery and oldest-retained-text alerts. No retention grace is approved.

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

## Accepted R19 implementation contract

This is the domain/column reference for the DMS physical schema, not a second
independent DDL specification. DMS v1.2.2 and its approved corrections own exact
types, defaults, nullability, checks, FKs, grants and policies. Abbreviated entries
inherit those definitions; do not generate migrations from shorthand alone.
Common shorthand: id uuid PK inherits the DMS default gen_random_uuid();
created_at/updated_at inherit the DMS timestamp type, nullability and default
where those columns exist. Each table references its named DMS migration.

Inherited exact constraint references: ck_roadmaps_focus_requires_locked/locked_has_version/archived_ts; ck_quizzes_standard_size; ck_quiz_questions_mcq/free_response; ck_quiz_attempts_no/retry; ck_update_delivery_state/viewed; ck_skill_progress_reason. Learning INSERT needs a nonnull reason; UPDATE state change needs a new nonempty explanatory reason through trg_skill_progress_guard.

## Accepted R20 implementation contract

After R05:22 private functions=10 SECURITY DEFINER+12 SECURITY INVOKER (including default mode), all with explicit empty search_path. Never elevate Invoker functions to match prose. Installed pg_proc modes,owners,ACLs and policy calls remain runtime checks.

## Accepted R21 implementation contract

ai_requests adds input_payload jsonb (nullable, bounded, service-only). account_deletion_requests adds provider_cleanup jsonb default[] and provider_cleanup_expires_at timestamptz; row is pseudonymous while encrypted refs remain. Exact fields/constraints/grants inherit C06.

## Evidence scope and readiness (R21)

Evidence dimensions are separate: SPECIFIED; STATICALLY CHECKED (named method/evidence); IMPLEMENTED (repository/commit); EXECUTED (command/environment/result); ACCEPTED (review gate).
This correction pack provides specifications and finite static checks, not implemented software or a production certificate. Tests are defined, not passed. R32 remains NOT EXECUTED for database fresh install, rollback/reapply, pgTAP, deletion/RLS/retention/concurrency, API/UI/AI contracts, performance and PITR. C01 product scope remains frozen. Existing numerical latency/RPO/RTO and quality values are targets until measured. Agent review is not owner sign-off.

# END OF DDD v1.2.2
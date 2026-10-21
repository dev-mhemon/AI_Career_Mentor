# AI Career Intelligence Mentor

# Database Implementation Specification (DIS) v1.1.1

## Complete PostgreSQL Migration & Implementation Contract Edition

| Metadata Item | Value |
|---|---|
| **Document ID** | `DIS-v1.1.1` |
| **Version** | **1.1.1 (Complete 50-Table & 21-Migration Implementation Specification)** |
| **Supersedes** | DIS v1.0, DIS v1.1 |
| **Executable SQL Authority** | `AI_Career_Intelligence_Mentor_DMS_v1.2.2.md` (`000_extensions.sql` – `020_gaps_and_alignment.sql`) per `ADR-016` |
| **Baseline Alignment** | PRD v1.4.1 Final Freeze · SAD v1.1.1 (ADRs 001–020) · DDD v1.2.2 · API Specification v1.5.1 · DB Validation Report v1.1 · AI SD v1.1.1 · UI/UX Spec v2.0.2 |
| **Status** | **DATABASE IMPLEMENTATION READY — RUNTIME EVIDENCE PENDING** |

------------------------------------------------------------------------

# 0. Document Purpose & Upgrade Summary

## 0.1 Purpose
DIS v1.1.1 transforms the conceptual domain model in **DDD v1.2.2** into a deterministic, implementation-ready PostgreSQL 16+ / Supabase execution contract that governs the physical SQL in **DMS v1.2.2**.

It preserves 100% alignment with:
- **PRD v1.4.1** product behavior, data retention rules (§13, §52), and admin privacy boundaries (§51)
- **SAD v1.1.1** architectural decisions (`ADR-001` through `ADR-020`)
- **DDD v1.2.2** domain model (50 tables across 11 domains, 45 custom enums)
- **API Specification v1.5.1** (82 catalog entries (81 HTTP routes + internal EP-G04), DTO schemas, and closed Gaps `G1`–`G13`)

## 0.2 DIS v1.1 → DIS v1.1.1 Alignment Changelog

| Area | DIS v1.1 State | DIS v1.1.1 Resolution |
|---|---|---|
| **Migration File Numbering (`ADR-016`)** | Listed 21 conceptual files numbered `001`–`021` with `create_*` names. | Standardized to the exact **21 executable files (`000_extensions.sql` through `020_gaps_and_alignment.sql`)** in `DMS v1.2.2`. |
| **Table & Enum Coverage (`G1`–`G3`)** | Covered 39 tables; omitted `user_auth_providers`, `skill_aliases`, `roadmap_merge_items`, `technology_*`, and Gap `G1`–`G3` tables. | Expanded to all **50 tables** and **45 custom enums**, including `user_ratings`, `content_reports`, `account_deletion_requests`, and `user_skill_aliases`. |
| **Write Mediation (`ADR-019`)** | Allowed direct client writes to profile tables. | Enforces **backend-mediated writes (`service_role`)** across all 50 tables; revokes `INSERT`/`UPDATE`/`DELETE` from `anon` and `authenticated`. |
| **Deletion Tombstone (`ADR-020`)** | Immediate cascade deletion left `EP-X02` with no record. | Specifies `user_id REFERENCES public.users(id) ON DELETE SET NULL` on `account_deletion_requests` so `completed` tombstones survive user cascade deletion. |
| **Job Queue Architecture (`ADR-017`)** | Unspecified queue index mechanics. | Specifies `public.ai_requests` as the sole durable job queue polled via `FOR UPDATE SKIP LOCKED` on `idx_ai_requests_queue`. |

------------------------------------------------------------------------

# 1. Database Implementation Overview

## 1.1 Technology Foundation
- **Database Engine:** PostgreSQL 16+ on Supabase Managed PostgreSQL
- **Authentication:** Supabase Auth (`auth.users`) issuing JWT Bearer tokens
- **Row-Level Security:** Universal PostgreSQL RLS enabled across all 50 tables
- **Connection Pooling:** PgBouncer in Transaction Mode (`default_pool_size = 25`, `max_client_conn = 500`)
- **Required Extensions (`000_extensions.sql`):**
  - `extensions.citext` — Case-insensitive email storage and uniqueness
  - `extensions.pg_trgm` — GIN trigram indexes for fuzzy search on roles, skills, and aliases
  - `pg_cron` — Scheduled background retention and AI context cleanup jobs

## 1.2 Schema Isolation & Execution Roles (`ADR-019`)

```text
Next.js PWA Client
       │ (HTTPS + Bearer JWT + Idempotency-Key)
       ▼
NestJS Backend API & Workers
       │ (AccessGuard -> Domain Service -> Repository using service_role)
       ▼
Supabase PostgreSQL 16+
  ├── Schema: public     (50 application tables, 45 domain enums, 103 secondary indexes)
  ├── Schema: private    (22 private functions (10 SECURITY DEFINER + 12 SECURITY INVOKER) with SET search_path = '')
  └── Schema: extensions (citext, pg_trgm, pg_cron)
```

| Execution Context | PostgreSQL Role | Access Scope & Security Rule |
|---|---|---|
| **End-User Client (Supabase Data API)** | `authenticated` | `SELECT` only explicitly granted owner/shared rows under active/expiry/technology predicates; queue and deletion status are backend-only. **Zero `INSERT`, `UPDATE`, or `DELETE` privileges on any table (`ADR-019`).** |
| **Anonymous Client** | `anon` | **Zero privileges** on all tables and functions in `public` and `private`. |
| **NestJS Backend & Queue Workers** | `service_role` | Bypasses RLS after server-side `AccessGuard` validation; executes all writes, atomic merge transactions, skill alias state-sync (`ADR-019`), and evidence recording. |
| **Migrations & Retention Cron** | `postgres` | Executes transactional DDL migrations (`000`–`020`) and `pg_cron` jobs (`private.cleanup_*`). |

------------------------------------------------------------------------

# 2. Migration Implementation Strategy (`ADR-016`)

## 2.1 Sequential Migration Layout (`supabase/migrations/`)

```text
supabase/
├── config.toml
├── migrations/
│   ├── 000_extensions.sql               # Schema `private`; extensions `citext`, `pg_trgm`, `pg_cron`
│   ├── 001_enums.sql                    # 41 base PostgreSQL ENUM types
│   ├── 002_identity.sql                 # `users`, `user_auth_providers`
│   ├── 003_profiles.sql                 # `user_profiles`, `user_preferences`
│   ├── 004_career_intelligence.sql      # `career_roles`, `skill_categories`, `skills`, `skill_aliases`, `skill_dependencies`, `career_goals`
│   ├── 005_roadmap.sql                  # `roadmaps`, `roadmap_versions`, `roadmap_items`, `roadmap_merges`, `roadmap_merge_items`
│   ├── 006_learning.sql                 # `topics`, `learning_resources`, `daily_plans`, `daily_plan_items`
│   ├── 007_assessment.sql               # `quizzes`, `quiz_questions`, `quiz_attempts`, `quiz_answers`, `practice_reviews`
│   ├── 008_progress.sql                 # `learning_evidence`, `skill_progress`, `achievement_history`
│   ├── 009_ai_mentor.sql                # `conversations`, `messages`, `conversation_summaries`, `ai_context_records`
│   ├── 010_ai_operations.sql            # `ai_models`, `prompt_versions`, `ai_requests`, `ai_generations`
│   ├── 011_technology_intelligence.sql  # `technology_categories`, `technologies`, `technology_sources`, `technology_updates`, `user_update_relevance`, `update_delivery_history`
│   ├── 012_administration.sql           # `admin_users`, `system_configurations`, `feature_controls`, `user_access_overrides`, `admin_audit_logs`
│   ├── 013_constraints.sql              # 17 forward, cyclic, and cross-domain foreign keys
│   ├── 014_indexes.sql                  # 99 base secondary, partial, and GIN trigram indexes
│   ├── 015_functions.sql                # 20 base `private.*` functions and 2 `pg_cron` schedules
│   ├── 016_triggers.sql                 # 62 base triggers across 5 operational families
│   ├── 017_rls.sql                      # Base universal RLS enablement, 44 policies, and privilege grants
│   ├── 018_seed.sql                     # Production reference taxonomy, 7 feature controls, 11 base system configs
│   ├── 019_tests.sql                    # Base 46-table in-migration PL/pgSQL assertion gate
│   └── 020_gaps_and_alignment.sql       # 4 Gap G1–G2 enums, 4 Gap G1–G3 tables, 4 indexes, `evaluate_content_report_threshold()`, 5 triggers, ADR-019 write lock, 4 AI/quality config seeds, and 50-table catalog assertion gate
├── rollbacks/
│   └── 020_down.sql ... 000_down.sql    # 21 reversible transactional down-migrations
├── seed/
│   ├── production_seed.sql
│   └── development_seed.sql             # Local/CI fixtures (`supabase/seed.sql`)
└── tests/database/
    └── 001_schema.test.sql ... 008_gaps.test.sql  # 8 pgTAP test files (185 assertions)
```

## 2.2 Migration Execution Invariants
1. **Immutability of Applied Migrations:** Once a migration file (`000`–`020`) is applied, it is never modified in place; subsequent schema changes use forward timestamped migrations.
2. **Transactional Atomicity:** Each migration file runs inside a single database transaction. Non-transactional commands (`CREATE INDEX CONCURRENTLY`) are prohibited in baseline migrations `000`–`020`.
3. **Cyclic Dependency Decoupling:** Inline foreign keys are used only when the referenced table already exists in an earlier or same migration. All 17 forward, self-referential, or cyclic foreign keys are isolated in `013_constraints.sql` using `DEFERRABLE INITIALLY DEFERRED` where two-way pointer updates occur in one transaction.

------------------------------------------------------------------------

# 3. SQL Migration Implementation Catalog (Files `000`–`020`)

| File | Depends On | Objects Created / Modified | Key Implementation Rules Enforced |
|---|---|---|---|
| `000_extensions.sql` | None | Schema `private`, `extensions.citext`, `extensions.pg_trgm`, `pg_cron` | Revokes `ALL ON SCHEMA private FROM PUBLIC`; wraps `pg_cron` in `DO $$ EXCEPTION` block for lightweight CI containers. |
| `001_enums.sql` | `000` | 41 custom domain enums | Matches API Spec v1.5.1 §13.7 enum values (`user_status` through `admin_role`). |
| `002_identity.sql` | `000`, `001` | `users`, `user_auth_providers` | Enforces `+8801[3-9][0-9]{8}` phone regex, suspension consistency, and 1 primary provider per user. |
| `003_profiles.sql` | `002` | `user_profiles`, `user_preferences` | Enforces `0.5..12.0` daily hours in `0.5` steps, beginner `existing_skills_none` exclusivity, and `<= 100` skills cap. |
| `004_career_intelligence.sql` | `002` | `career_roles`, `skill_categories`, `skills`, `skill_aliases`, `skill_dependencies`, `career_goals` | Enforces kebab-case slugs, validated alias uniqueness, no self-dependencies, and `0..2` goal clarification rounds. |
| `005_roadmap.sql` | `004` | `roadmaps`, `roadmap_versions`, `roadmap_items`, `roadmap_merges`, `roadmap_merge_items` | Enforces 1 Focus Roadmap per user (locked only), 1 open draft per roadmap, 1 open merge proposal, and 1 open undo window. |
| `006_learning.sql` | `004`, `005` | `topics`, `learning_resources`, `daily_plans`, `daily_plan_items` | Enforces 1 approved version per `(skill_id, slug, career_level)`, 1 Daily Plan per roadmap, and sequential `day_no >= 1`. |
| `007_assessment.sql` | `006` | `quizzes`, `quiz_questions`, `quiz_attempts`, `quiz_answers`, `practice_reviews` | Enforces standard quiz size (`20` MCQ + `5..10` FR unless `is_reduced`), MCQ answer-key validity in JSONB options, `attempt_no` `1..2`, and 90-day raw answer expiry. |
| `008_progress.sql` | `004`–`007` | `learning_evidence`, `skill_progress`, `achievement_history` | Enforces mandatory `state_reason` for non-initial states and excludes any `"job_ready"` column (PRD §36). |
| `009_ai_mentor.sql` | `005`, `006` | `conversations`, `messages`, `conversation_summaries`, `ai_context_records` | Enforces `client_message_id` retry deduplication, user message `<= 4000` chars, and 90-day message expiry. |
| `010_ai_operations.sql` | `002` | `ai_models`, `prompt_versions`, `ai_requests`, `ai_generations` | Enforces `real_user_data_approved` default `false`, idempotency key uniqueness on `ai_requests`, and content-free provenance on `ai_generations`. |
| `011_technology_intelligence.sql` | `004`, `005`, `010` | `technology_categories`, `technologies`, `technology_sources`, `technology_updates`, `user_update_relevance`, `update_delivery_history` | Enforces `content_hash` deduplication and 1 delivery outcome per user per `local_date`. |
| `012_administration.sql` | `002` | `admin_users`, `system_configurations`, `feature_controls`, `user_access_overrides`, `admin_audit_logs` | Establishes server-side admin table, global/user feature flags, and tamper-proof audit log table. |
| `013_constraints.sql` | `002`–`012` | 17 forward/cyclic foreign keys | Uses `DEFERRABLE INITIALLY DEFERRED` on `fk_roadmaps_current_version`, `fk_roadmap_versions_merge`, and `fk_roadmap_merges_result`. |
| `014_indexes.sql` | `002`–`013` | 99 secondary indexes | Supplies declared leading indexes subject to the named E01 exceptions; runtime plans remain pending. |
| `015_functions.sql` | `002`–`014` | 20 `private.*` functions + 2 `pg_cron` jobs | Implements ownership checks, state machines, token/cost math, retention purges, and `admin_usage_summary()`. |
| `016_triggers.sql` | `015` | 62 triggers across 5 families | Wires `updated_at`, ownership validation, lifecycle guards, append-only locks, and AI unit/cost triggers (`a_total` before `b_cost`). |
| `017_rls.sql` | `015` | Universal RLS on 46 tables + 44 policies | Revokes `anon`/`authenticated` defaults; shields `quizzes`/`quiz_questions` answer keys; blocks admin access to private chats/memory. |
| `018_seed.sql` | `002`–`012` | Reference seed data | Seeds 7 feature controls (`technology_update` default `false`), 11 base configs, 13 roles, 11 skill categories, 7 tech categories. |
| `019_tests.sql` | `000`–`018` | 12 PL/pgSQL catalog assertions | Verifies 46 base tables, 41 base enums, 99 indexes, 62 triggers, 44 policies, 20 functions, and 0 unindexed FKs. |
| `020_gaps_and_alignment.sql` | `000`–`019` | 4 enums, 4 tables (`user_ratings`, `content_reports`, `account_deletion_requests`, `user_skill_aliases`), 4 indexes, 1 function, 5 triggers, 4 policies, 4 config seeds, 7 catalog assertions | Closes API Gaps `G1`–`G3`, implements auto-hide report threshold trigger, revokes client profile write grants (`ADR-019`), uses `ON DELETE SET NULL` on `account_deletion_requests.user_id` (`ADR-020`), and verifies the final 50-table catalog. |

------------------------------------------------------------------------

# 4. Constraint Implementation Specification

## 4.1 Forward, Cyclic & Cross-Domain Foreign Keys (`013_constraints.sql`)

| # | Constraint Name | Child Table.Column | Parent Table.Column | On Delete | Deferrable Rule |
|---|---|---|---|---|---|
| 1 | `fk_users_suspended_by` | `users.suspended_by` | `users.id` | `SET NULL` | Immediate |
| 2 | `fk_roadmaps_current_version` | `roadmaps.current_version_id` | `roadmap_versions.id` | `NO ACTION` | `DEFERRABLE INITIALLY DEFERRED` |
| 3 | `fk_roadmap_versions_base` | `roadmap_versions.base_version_id` | `roadmap_versions.id` | `NO ACTION` | Immediate |
| 4 | `fk_roadmap_versions_merge` | `roadmap_versions.merge_id` | `roadmap_merges.id` | `NO ACTION` | `DEFERRABLE INITIALLY DEFERRED` |
| 5 | `fk_roadmap_versions_ai_gen` | `roadmap_versions.ai_generation_id` | `ai_generations.id` | `SET NULL` | Immediate |
| 6 | `fk_roadmap_items_topic` | `roadmap_items.topic_id` | `topics.id` | `NO ACTION` | Immediate |
| 7 | `fk_roadmap_merges_base` | `roadmap_merges.base_version_id` | `roadmap_versions.id` | `NO ACTION` | Immediate |
| 8 | `fk_roadmap_merges_result` | `roadmap_merges.result_version_id` | `roadmap_versions.id` | `NO ACTION` | `DEFERRABLE INITIALLY DEFERRED` |
| 9 | `fk_roadmap_merges_ai_gen` | `roadmap_merges.ai_generation_id` | `ai_generations.id` | `SET NULL` | Immediate |
| 10 | `fk_roadmap_merge_items_topic` | `roadmap_merge_items.topic_id` | `topics.id` | `NO ACTION` | Immediate |
| 11 | `fk_daily_plans_version` | `daily_plans.roadmap_version_id` | `roadmap_versions.id` | `NO ACTION` | Immediate |
| 12 | `fk_daily_plan_items_merge` | `daily_plan_items.reconciled_by_merge_id` | `roadmap_merges.id` | `SET NULL` | Immediate |
| 13 | `fk_topics_ai_gen` | `topics.ai_generation_id` | `ai_generations.id` | `SET NULL` | Immediate |
| 14 | `fk_quizzes_ai_gen` | `quizzes.ai_generation_id` | `ai_generations.id` | `SET NULL` | Immediate |
| 15 | `fk_practice_reviews_ai_gen` | `practice_reviews.ai_generation_id` | `ai_generations.id` | `SET NULL` | Immediate |
| 16 | `fk_messages_ai_gen` | `messages.ai_generation_id` | `ai_generations.id` | `SET NULL` | Immediate |
| 17 | `fk_conversation_summaries_ai_gen` | `conversation_summaries.ai_generation_id` | `ai_generations.id` | `SET NULL` | Immediate |

## 4.2 Partial Unique Indexes Enforcing PRD Business Invariants

| Index Name | Table | Columns & Predicate | PRD Invariant Enforced |
|---|---|---|---|
| `uq_users_email` | `users` | `(email) WHERE email IS NOT NULL` | Case-insensitive unique email (`citext`) |
| `uq_users_phone` | `users` | `(phone) WHERE phone IS NOT NULL` | Unique normalized `+880` phone number |
| `uq_user_auth_providers_one_primary` | `user_auth_providers` | `(user_id) WHERE is_primary` | At most one primary identity per user |
| `uq_skill_aliases_validated` | `skill_aliases` | `(alias_normalized) WHERE status = 'validated'` | A validated global alias maps to exactly one canonical skill (PRD §17) |
| `uq_roadmaps_one_focus` | `roadmaps` | `(user_id) WHERE is_focus` | At most one Focus Roadmap per user (PRD §16) |
| `uq_roadmap_versions_one_draft` | `roadmap_versions` | `(roadmap_id) WHERE state = 'draft'` | At most one open draft per roadmap (PRD §21) |
| `uq_roadmap_merges_one_open` | `roadmap_merges` | `(roadmap_id) WHERE status = 'proposed'` | At most one open merge proposal per roadmap (API Assumption A4) |
| `uq_roadmap_merges_one_undoable` | `roadmap_merges` | `(roadmap_id) WHERE status = 'accepted' AND undo_window_closed_at IS NULL` | Only the latest accepted merge with an open window can be undone (PRD §21) |
| `uq_topics_one_approved` | `topics` | `(skill_id, slug, career_level) WHERE status = 'approved' AND deleted_at IS NULL` | Exactly one active approved content version per canonical topic and Career Level |
| `uq_messages_client_message` | `messages` | `(conversation_id, client_message_id) WHERE client_message_id IS NOT NULL` | De-duplicates client message retries (`EP-M03`) |
| `uq_ai_requests_idempotency` | `ai_requests` | `(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL` | Database-level idempotency guarantee for async AI jobs |
| `uq_update_delivery_user_update` | `update_delivery_history` | `(user_id, update_id) WHERE update_id IS NOT NULL` | Prevents delivering the same technology update twice to the same user (PRD §45) |
| `uq_account_deletion_one_active` | `account_deletion_requests` | `(user_id) WHERE status IN ('scheduled','in_progress')` | Prevents duplicate active account deletion requests (`EP-X01`) |

------------------------------------------------------------------------

# 5. Index Implementation Specification (All 103 Secondary Indexes)

Every foreign key column (except low-volume admin actor pointers `updated_by`, `created_by`, `suspended_by`) is the leading column of an index, verified automatically by `019_tests.sql` and `001_schema.test.sql`.

## 5.1 Complete 103-Index Catalog (`014_indexes.sql` + `020_gaps_and_alignment.sql`)

| # | Domain | Index Name | Table | Columns & Partial Predicate | Target Query / API Endpoint |
|---|---|---|---|---|---|
| 1 | Auth | `idx_users_status_created` | `users` | `(status, created_at DESC)` | Admin user list (`EP-AD01`) |
| 2 | Auth | `idx_users_last_active` | `users` | `(last_active_at) WHERE status = 'active'` | 7-day Tech Update eligibility (PRD §39) |
| 3 | Career | `idx_career_roles_name_trgm` | `career_roles` | `USING gin (name extensions.gin_trgm_ops)` | Fuzzy role matching (`EP-C01`) |
| 4 | Career | `idx_skill_categories_parent` | `skill_categories` | `(parent_id) WHERE parent_id IS NOT NULL` | Category tree traversal |
| 5 | Career | `idx_skills_category` | `skills` | `(category_id) WHERE category_id IS NOT NULL` | Skills by category |
| 6 | Career | `idx_skills_name_trgm` | `skills` | `USING gin (canonical_name extensions.gin_trgm_ops)` | Skill search & alias resolution (`EP-P02`) |
| 7 | Career | `idx_skill_aliases_norm_trgm` | `skill_aliases` | `USING gin (alias_normalized extensions.gin_trgm_ops)` | Uncertain alias candidate suggestions |
| 8 | Career | `idx_skill_dependencies_dep` | `skill_dependencies` | `(depends_on_skill_id)` | Reverse dependency lookup |
| 9 | Career | `idx_career_goals_user_status` | `career_goals` | `(user_id, status, created_at DESC)` | List user career goals (`EP-C02`) |
| 10 | Career | `idx_career_goals_proposed_role` | `career_goals` | `(proposed_role_id) WHERE proposed_role_id IS NOT NULL` | Leading FK index |
| 11 | Career | `idx_career_goals_confirmed_role` | `career_goals` | `(confirmed_role_id) WHERE confirmed_role_id IS NOT NULL` | Leading FK index |
| 12 | Roadmap | `idx_roadmaps_user_status` | `roadmaps` | `(user_id, status)` | Active roadmaps & 3-roadmap cap (`EP-R02`) |
| 13 | Roadmap | `idx_roadmaps_role` | `roadmaps` | `(canonical_role_id)` | Leading FK index |
| 14 | Roadmap | `idx_roadmaps_current_version` | `roadmaps` | `(current_version_id) WHERE current_version_id IS NOT NULL` | Current version join (`EP-R03`) |
| 15 | Roadmap | `idx_roadmap_versions_user` | `roadmap_versions` | `(user_id)` | Leading FK & RLS filter |
| 16 | Roadmap | `idx_roadmap_versions_merge` | `roadmap_versions` | `(merge_id) WHERE merge_id IS NOT NULL` | Merge-to-version lookup |
| 17 | Roadmap | `idx_roadmap_versions_base` | `roadmap_versions` | `(base_version_id) WHERE base_version_id IS NOT NULL` | Version lineage |
| 18 | Roadmap | `idx_roadmap_items_user` | `roadmap_items` | `(user_id)` | Leading FK & RLS filter |
| 19 | Roadmap | `idx_roadmap_items_skill` | `roadmap_items` | `(skill_id)` | Cross-roadmap shared skill lookup (PRD §17) |
| 20 | Roadmap | `idx_roadmap_items_topic` | `roadmap_items` | `(topic_id)` | Topic-to-roadmap membership (`EP-L06`) |
| 21 | Roadmap | `idx_roadmap_items_lineage` | `roadmap_items` | `(lineage_id)` | Item lineage across versions |
| 22 | Roadmap | `idx_roadmap_merges_roadmap_status` | `roadmap_merges` | `(roadmap_id, status, created_at DESC)` | List merge proposals (`EP-R09`) |
| 23 | Roadmap | `idx_roadmap_merges_user` | `roadmap_merges` | `(user_id)` | Leading FK & RLS filter |
| 24 | Roadmap | `idx_roadmap_merges_base_version` | `roadmap_merges` | `(base_version_id)` | Stale base version check |
| 25 | Roadmap | `idx_roadmap_merges_result_version` | `roadmap_merges` | `(result_version_id) WHERE result_version_id IS NOT NULL` | Undo lookup (`EP-R13`) |
| 26 | Roadmap | `idx_roadmap_merge_items_user` | `roadmap_merge_items` | `(user_id)` | Leading FK & RLS filter |
| 27 | Roadmap | `idx_roadmap_merge_items_topic` | `roadmap_merge_items` | `(topic_id) WHERE topic_id IS NOT NULL` | Leading FK index |
| 28 | Learning | `idx_topics_skill_level_status` | `topics` | `(skill_id, career_level, status)` | Shared topic lookup (`EP-L04`) |
| 29 | Learning | `idx_learning_resources_topic` | `learning_resources` | `(topic_id)` | Topic resources (`EP-L07`) |
| 30 | Learning | `idx_daily_plans_user` | `daily_plans` | `(user_id)` | Leading FK & RLS filter |
| 31 | Learning | `idx_daily_plans_version` | `daily_plans` | `(roadmap_version_id) WHERE roadmap_version_id IS NOT NULL` | Leading FK index |
| 32 | Learning | `idx_daily_plan_items_open` | `daily_plan_items` | `(plan_id, day_no, sort_order) WHERE status <> 'completed'` | Today: next incomplete plan day (`EP-L04`) |
| 33 | Learning | `idx_daily_plan_items_user` | `daily_plan_items` | `(user_id)` | Leading FK & RLS filter |
| 34 | Learning | `idx_daily_plan_items_topic` | `daily_plan_items` | `(topic_id)` | Leading FK index |
| 35 | Learning | `idx_daily_plan_items_merge` | `daily_plan_items` | `(reconciled_by_merge_id) WHERE reconciled_by_merge_id IS NOT NULL` | Undo window auto-close lookup |
| 36 | Assessment | `idx_quizzes_topic_status` | `quizzes` | `(topic_id, status)` | Reusable quiz lookup (`EP-Q01`) |
| 37 | Assessment | `idx_quiz_attempts_user_status` | `quiz_attempts` | `(user_id, status)` | Resume unfinished quiz (`EP-Q02`); all-state user FK and cascade coverage |
| 38 | Assessment | `idx_quiz_attempts_user_submitted` | `quiz_attempts` | `(user_id, submitted_at DESC) WHERE submitted_at IS NOT NULL` | Submitted quiz history |
| 39 | Assessment | `idx_quiz_attempts_quiz` | `quiz_attempts` | `(quiz_id)` | Leading FK index |
| 40 | Assessment | `idx_quiz_attempts_retry_of` | `quiz_attempts` | `(retry_of_attempt_id) WHERE retry_of_attempt_id IS NOT NULL` | Retry lineage (`EP-Q07`) |
| 41 | Assessment | `idx_quiz_answers_user` | `quiz_answers` | `(user_id)` | Leading FK & RLS filter |
| 42 | Assessment | `idx_quiz_answers_question` | `quiz_answers` | `(question_id)` | Leading FK index |
| 43 | Assessment | `idx_quiz_answers_raw_expiry` | `quiz_answers` | `(raw_text_expires_at) WHERE answer_text IS NOT NULL` | 90-day raw answer purge (PRD §52) |
| 44 | Assessment | `idx_practice_reviews_attempt` | `practice_reviews` | `(attempt_id)` | Reviews for attempt (`EP-PR01`) |
| 45 | Assessment | `idx_practice_reviews_user` | `practice_reviews` | `(user_id)` | Leading FK & RLS filter |
| 46 | Assessment | `idx_practice_reviews_question` | `practice_reviews` | `(question_id)` | Leading FK index |
| 47 | Assessment | `idx_practice_reviews_open` | `practice_reviews` | `(review_status, created_at) WHERE review_status IN ('pending','failed')` | Retryable practice reviews (`EP-PR03`) |
| 48 | Progress | `idx_learning_evidence_user_skill_level` | `learning_evidence` | `(user_id, skill_id, career_level, occurred_at DESC)` | Evidence evaluation (PRD §35) |
| 49 | Progress | `idx_learning_evidence_skill` | `learning_evidence` | `(skill_id)` | Leading FK index |
| 50 | Progress | `idx_learning_evidence_topic` | `learning_evidence` | `(topic_id)` | Leading FK index |
| 51 | Progress | `idx_learning_evidence_roadmap` | `learning_evidence` | `(roadmap_id) WHERE roadmap_id IS NOT NULL` | Leading FK index |
| 52 | Progress | `idx_skill_progress_user_state` | `skill_progress` | `(user_id, learning_state)` | Progress dashboard (`EP-G01`) |
| 53 | Progress | `idx_skill_progress_skill` | `skill_progress` | `(skill_id)` | Leading FK index |
| 54 | Progress | `idx_achievement_history_user_time` | `achievement_history` | `(user_id, occurred_at DESC)` | Progress history (`EP-G03`) |
| 55 | Progress | `idx_achievement_history_user_skill_time` | `achievement_history` | `(user_id, skill_id, occurred_at DESC)` | Per-skill history (`EP-G02`) |
| 56 | Progress | `idx_achievement_history_skill` | `achievement_history` | `(skill_id)` | Leading FK index |
| 57 | AI Mentor | `idx_conversations_user_last` | `conversations` | `(user_id, last_message_at DESC NULLS LAST)` | Conversation list (`EP-M02`) |
| 58 | AI Mentor | `idx_conversations_roadmap` | `conversations` | `(roadmap_id) WHERE roadmap_id IS NOT NULL` | Leading FK index |
| 59 | AI Mentor | `idx_conversations_topic` | `conversations` | `(topic_id) WHERE topic_id IS NOT NULL` | Leading FK index |
| 60 | AI Mentor | `idx_messages_conversation_created` | `messages` | `(conversation_id, created_at)` | Message history pagination (`EP-M04`) |
| 61 | AI Mentor | `idx_messages_expires` | `messages` | `(expires_at)` | 90-day message retention purge (PRD §52) |
| 62 | AI Mentor | `idx_messages_user` | `messages` | `(user_id)` | Leading FK & RLS filter |
| 63 | AI Mentor | `idx_messages_reply_to` | `messages` | `(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL` | Leading FK index |
| 64 | AI Mentor | `idx_conversation_summaries_user` | `conversation_summaries` | `(user_id)` | Leading FK & RLS filter |
| 65 | AI Mentor | `idx_ai_context_records_valid_until` | `ai_context_records` | `(valid_until)` | Hourly expired AI context purge |
| 66 | AI Ops | `idx_ai_models_routing` | `ai_models` | `(fallback_rank) WHERE is_active AND real_user_data_approved` | Model Router fallback order (PRD §47) |
| 67 | AI Ops | `idx_ai_requests_user_status` | `ai_requests` | `(user_id, status)` | User job status polling (`EP-J01`) |
| 68 | AI Ops | `idx_ai_requests_queue` | `ai_requests` | `(available_at) WHERE status = 'queued'` | Worker `FOR UPDATE SKIP LOCKED` claim (`ADR-017`) |
| 69 | AI Ops | `idx_ai_requests_created` | `ai_requests` | `(created_at)` | Admin usage summary (`EP-AD08`) |
| 70 | AI Ops | `idx_ai_requests_feature_created` | `ai_requests` | `(feature_key, created_at) WHERE feature_key IS NOT NULL` | Per-feature AI cost & usage (`EP-AD08`) |
| 71 | AI Ops | `idx_ai_requests_finished` | `ai_requests` | `(finished_at) WHERE finished_at IS NOT NULL` | 30-day operational log purge (PRD §52) |
| 72 | AI Ops | `idx_ai_requests_model` | `ai_requests` | `(model_id) WHERE model_id IS NOT NULL` | Leading FK index |
| 73 | AI Ops | `idx_ai_requests_prompt` | `ai_requests` | `(prompt_version_id) WHERE prompt_version_id IS NOT NULL` | Leading FK index |
| 74 | AI Ops | `idx_ai_requests_subject` | `ai_requests` | `(subject_type, subject_id) WHERE subject_id IS NOT NULL` | Resource job lookup |
| 75 | AI Ops | `idx_ai_generations_task_created` | `ai_generations` | `(task, created_at)` | Generation provenance by task |
| 76 | AI Ops | `idx_ai_generations_model` | `ai_generations` | `(model_id) WHERE model_id IS NOT NULL` | Leading FK index |
| 77 | AI Ops | `idx_ai_generations_prompt` | `ai_generations` | `(prompt_version_id) WHERE prompt_version_id IS NOT NULL` | Leading FK index |
| 78 | AI Ops | `idx_ai_generations_request` | `ai_generations` | `(request_id) WHERE request_id IS NOT NULL` | Leading FK index |
| 79 | Tech | `idx_technologies_category` | `technologies` | `(category_id) WHERE category_id IS NOT NULL` | Leading FK index |
| 80 | Tech | `idx_technologies_skill` | `technologies` | `(skill_id) WHERE skill_id IS NOT NULL` | Technology-to-skill join |
| 81 | Tech | `idx_technology_updates_fetched` | `technology_updates` | `(fetched_at DESC)` | Recent updates scan |
| 82 | Tech | `idx_technology_updates_technology` | `technology_updates` | `(technology_id) WHERE technology_id IS NOT NULL` | Leading FK index |
| 83 | Tech | `idx_technology_updates_source` | `technology_updates` | `(source_id) WHERE source_id IS NOT NULL` | Leading FK index |
| 84 | Tech | `idx_user_update_relevance_user_computed` | `user_update_relevance` | `(user_id, computed_at DESC)` | User update list (`EP-T01`) |
| 85 | Tech | `idx_user_update_relevance_update` | `user_update_relevance` | `(update_id)` | Leading FK index |
| 86 | Tech | `idx_user_update_relevance_roadmap` | `user_update_relevance` | `(focus_roadmap_id) WHERE focus_roadmap_id IS NOT NULL` | Leading FK index |
| 87 | Tech | `idx_update_delivery_update` | `update_delivery_history` | `(update_id) WHERE update_id IS NOT NULL` | Leading FK index |
| 88 | Admin | `idx_user_access_overrides_feature` | `user_access_overrides` | `(feature_key, enabled)` | Per-feature user override lookup |
| 89 | Admin | `idx_admin_audit_logs_actor_time` | `admin_audit_logs` | `(actor_id, created_at DESC)` | Audit log by actor (`EP-AD07`) |
| 90 | Admin | `idx_admin_audit_logs_target_time` | `admin_audit_logs` | `(target_user_id, created_at DESC)` | Audit log by target user (`EP-AD07`) |
| 91 | Admin | `idx_admin_audit_logs_action_time` | `admin_audit_logs` | `(action, created_at DESC)` | Audit log by action (`EP-AD07`) |
| 92 | Feedback (`020`) | `idx_user_ratings_target` | `user_ratings` | `(target_type, target_id)` | Rating aggregation by target (`EP-F01`) |
| 93 | Feedback (`020`) | `idx_content_reports_target` | `content_reports` | `(target_type, target_id)` | Report count threshold check (`EP-F02`) |
| 94 | Career (`020`) | `idx_user_skill_aliases_skill` | `user_skill_aliases` | `(skill_id)` | Leading FK index on user aliases (`EP-P05`) |
| 95 | AI provenance (014) | `idx_roadmap_versions_ai_generation` | `roadmap_versions` | `(ai_generation_id) WHERE ai_generation_id IS NOT NULL` | Leading FK index |
| 96 | AI provenance (014) | `idx_roadmap_merges_ai_generation` | `roadmap_merges` | `(ai_generation_id) WHERE ai_generation_id IS NOT NULL` | Leading FK index |
| 97 | AI provenance (014) | `idx_topics_ai_generation` | `topics` | `(ai_generation_id) WHERE ai_generation_id IS NOT NULL` | Leading FK index |
| 98 | AI provenance (014) | `idx_quizzes_ai_generation` | `quizzes` | `(ai_generation_id) WHERE ai_generation_id IS NOT NULL` | Leading FK index |
| 99 | AI provenance (014) | `idx_practice_reviews_ai_generation` | `practice_reviews` | `(ai_generation_id) WHERE ai_generation_id IS NOT NULL` | Leading FK index |
| 100 | AI provenance (014) | `idx_messages_ai_generation` | `messages` | `(ai_generation_id) WHERE ai_generation_id IS NOT NULL` | Leading FK index |
| 101 | AI provenance (014) | `idx_conversation_summaries_ai_generation` | `conversation_summaries` | `(ai_generation_id) WHERE ai_generation_id IS NOT NULL` | Leading FK index |
| 102 | AI provenance (014) | `idx_technology_updates_ai_generation` | `technology_updates` | `(ai_generation_id) WHERE ai_generation_id IS NOT NULL` | Leading FK index |
| 103 | Account deletion (`020`) | `idx_account_deletion_requests_user` | `account_deletion_requests` | `(user_id) WHERE user_id IS NOT NULL` | All non-null user FK coverage across request states |

------------------------------------------------------------------------

# 6. Row Level Security (RLS) Implementation Specification

## 6.1 Universal RLS Rules (`017_rls.sql` + `020_gaps_and_alignment.sql`)
1. **100% Table Coverage:** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is applied to all **50 tables**.
2. **Statement-Cached Auth UID:** Policies use `(SELECT auth.uid())` so PostgreSQL evaluates `auth.uid()` once per query plan (InitPlan) rather than once per scanned row.
3. **Zero Client Write or Delete Grants (`ADR-019`):** Neither `anon` nor `authenticated` holds `INSERT`, `UPDATE`, or `DELETE` privileges on any table. All state mutations are executed by the NestJS backend (`service_role`) after `AccessGuard` verification.
4. **Admin Privacy Firewall (PRD §51):** `private.is_admin()` unlocks `SELECT` only on `users`, `user_access_overrides`, and `admin_audit_logs`. Admins have zero RLS policies on `conversations`, `messages`, `conversation_summaries`, `ai_context_records`, `quiz_answers`, `practice_reviews`, or `ai_requests`.

## 6.2 Complete 50-Table RLS & Privilege Matrix (44 Policies Total)

| Policy Class | Tables Covered | `authenticated` SELECT Policy | `authenticated` Write/Delete |
|---|---|---|---|
| **O-R (26 directly granted owner tables)** | `user_auth_providers`, `user_profiles`, `user_preferences`, `user_skill_aliases`, `career_goals`, `roadmaps`, `roadmap_versions`, `roadmap_items`, `roadmap_merges`, `roadmap_merge_items`, `daily_plans`, `daily_plan_items`, `quiz_attempts`, `quiz_answers`, `practice_reviews`, `learning_evidence`, `skill_progress`, `achievement_history`, `conversations`, `messages`, `conversation_summaries`, `ai_context_records`, `user_update_relevance`, `update_delivery_history`, `user_ratings`, `content_reports` | Existing owner predicate plus active-account/expiry/technology conditions; linked-identity settings exception. Queue/deletion policies persist without client SELECT grants. | **NONE** (`service_role` only per `ADR-019`) |
| **O-R + ADMIN-R (2 Tables)** | `users` (column-restricted `SELECT` grant excluding `status_reason`, `suspended_by`), `user_access_overrides` | `users_owner_or_admin_select` (`1` policy); `user_access_overrides_owner_select` + `user_access_overrides_admin_select` (`2` policies) | **NONE** |
| **ADMIN-R (1 Table)** | `admin_audit_logs` | `USING ((SELECT private.is_admin()))` (`1` policy) | **NONE** |
| **SHARED (11 Tables)** | `career_roles`, `skill_categories`, `skills`, `skill_aliases` (`status = 'validated'`), `skill_dependencies`, `topics`, `learning_resources`, `technology_categories`, `technologies`, `technology_sources` (`is_active`), `feature_controls` | Approved & non-deleted shared rows (`11` policies) | **NONE** |
| **DELIVERED-SHARED (1 Table)** | `technology_updates` | `EXISTS (SELECT 1 FROM update_delivery_history d WHERE d.update_id = id AND d.user_id = (SELECT auth.uid()))` (`1` policy) | **NONE** |
| **DENY (7 Tables — 0 Policies)** | `quizzes`, `quiz_questions`, `ai_models`, `prompt_versions`, `ai_generations`, `admin_users`, `system_configurations` | **NONE** (Shields quiz answer keys, rubrics, model configs, and admin list) | **NONE** |

------------------------------------------------------------------------

# 7. Database Functions & Triggers Implementation (`015`, `016`, `020`)

## 7.1 Private Schema Functions (All 22 Functions in Schema `private`)

Every function in `private` is created with `SET search_path = ''` so all object references are schema-qualified and immune to search-path hijacking:

| # | Function Signature | Security | Purpose & Enforcement Rule |
|---|---|---|---|
| 1 | `private.update_updated_at_column()` | `INVOKER` | Sets `NEW.updated_at := now()` on `BEFORE UPDATE` across 35 mutable tables. |
| 2 | `private.validate_user_ownership()` | `DEFINER` | Verifies child `NEW.user_id` equals parent `user_id` across 13 hierarchical tables; raises `42501 OWNERSHIP_MISMATCH`. |
| 3 | `private.validate_roadmap_transition()` | `INVOKER` | Enforces `draft -> locked | archived` and `locked -> archived`; clears `is_focus` on archive. |
| 4 | `private.enforce_active_roadmap_limit()` | `INVOKER` | Takes `pg_advisory_xact_lock`, reads `roadmap.max_active` (default `3`), and blocks 4th non-archived roadmap (PRD §16). |
| 5 | `private.guard_roadmap_version_immutability()` | `INVOKER` | Blocks mutating version content columns (`summary`, `phases`, `level_outline`, `target_level`); allows only legal state transitions. |
| 6 | `private.validate_ai_request_status()` | `INVOKER` | Enforces `queued -> preparing -> succeeded | failed` (and `failed -> queued` when `retryable = true`). |
| 7 | `private.calculate_total_tokens()` | `INVOKER` | Computes `NEW.total_units := COALESCE(NEW.input_units, 0) + COALESCE(NEW.output_units, 0)`. |
| 8 | `private.calculate_ai_cost()` | `INVOKER` | Computes `NEW.cost_usd` from `public.ai_models` unit pricing (`input_price_per_m_units`, `output_price_per_m_units`). |
| 9 | `private.cleanup_expired_ai_context()` | `DEFINER` | Hourly `pg_cron` job (`17 * * * *`): deletes `ai_context_records WHERE valid_until < now()`. |
| 10 | `private.cleanup_expired_retention()` | `DEFINER` | Daily `pg_cron` job (`37 2 * * *`): nulls `quiz_answers.answer_text` after 90d; deletes `messages` at expiry independently of summary coverage; deletes all `ai_requests` at the bounded created_at retention cutoff (PRD §52). |
| 11 | `private.prevent_row_modification()` | `INVOKER` | Blocks `UPDATE` and direct `DELETE` (`pg_trigger_depth() = 1`) on `roadmap_items`, `roadmap_merge_items`, `learning_evidence`, and `content_reports`; allows FK cascade deletes (`pg_trigger_depth() > 1`). |
| 12 | `private.prevent_achievement_modification()` | `INVOKER` | Append-only protection on `achievement_history` (allows FK cascade delete at `pg_trigger_depth() > 1`). |
| 13 | `private.prevent_audit_log_changes()` | `INVOKER` | Tamper-proof guard on `admin_audit_logs`; allows only FK `ON DELETE SET NULL` of `actor_id` / `target_user_id` during user deletion. |
| 14 | `private.validate_skill_progress_change()` | `INVOKER` | Requires a non-empty, updated `state_reason` whenever `learning_state` changes (PRD §35). |
| 15 | `private.validate_profile_timezone()` | `INVOKER` | Validates `NEW.timezone` against `pg_catalog.pg_timezone_names` (PRD §14). |
| 16 | `private.close_merge_undo_window()` | `DEFINER` | Sets `roadmap_merges.undo_window_closed_at = now()` when a quiz attempt reaches `started` on a post-merge plan item (`reconciled_by_merge_id IS NOT NULL`, PRD §21). |
| 17 | `private.touch_conversation()` | `DEFINER` | Updates `conversations.last_message_at = NEW.created_at` on `AFTER INSERT ON messages`. |
| 18 | `private.is_admin()` | `DEFINER` | Returns `true` when `(SELECT auth.uid())` exists in `admin_users` and `users.status = 'active'` (PRD §50). |
| 19 | `private.effective_feature_access(uuid, feature_key)` | `DEFINER` | Evaluates `users.status = 'active' AND feature_controls.enabled AND COALESCE(user_access_overrides.enabled, feature_controls.default_user_enabled)` (PRD §7). |
| 20 | `private.admin_usage_summary(date, date)` | `DEFINER` | Returns aggregate counts and AI usage/cost grouped by feature and provider without exposing any private user content (`EP-AD08`, PRD §51). |
| 21 | `private.evaluate_content_report_threshold()` | `DEFINER` | Counts distinct `user_id` reports in `content_reports`; auto-hides shared `topics` or `quiz_questions` when count reaches `quality.report_auto_hide_threshold` (PRD §24, `020`). |

## 7.2 Trigger Catalog (All 68 Triggers Across 5 Families)

1. **Family 1 — Timestamp Maintenance (35 Triggers):** `trg_<table>_updated_at BEFORE UPDATE` on the 32 base mutable tables (`016_triggers.sql`) plus `user_ratings`, `account_deletion_requests`, and `user_skill_aliases` (`020_gaps_and_alignment.sql`).
2. **Family 2 — Ownership Validation (13 Triggers):** `trg_<table>_owner_check BEFORE INSERT OR UPDATE` on `roadmaps`, `roadmap_versions`, `roadmap_items`, `roadmap_merges`, `roadmap_merge_items`, `daily_plans`, `daily_plan_items`, `quiz_attempts`, `quiz_answers`, `practice_reviews`, `messages`, `conversation_summaries`, and `learning_evidence`.
3. **Family 3 — Lifecycle & Business Rule Protection (10 Triggers):** `trg_roadmaps_limit`, `trg_roadmaps_transition`, `trg_roadmap_versions_guard`, `trg_ai_requests_status`, `trg_skill_progress_guard`, `trg_user_profiles_validate_timezone`, `trg_quiz_attempts_close_undo`, `trg_messages_touch_conversation`, and `trg_content_reports_threshold` (`020`).
4. **Family 4 — Audit & Append-Only Immutability (6 Triggers):** `trg_roadmap_items_append_only`, `trg_roadmap_merge_items_append_only`, `trg_learning_evidence_append_only`, `trg_achievement_history_append_only`, `trg_admin_audit_logs_append_only`, and `trg_content_reports_append_only` (`020`).
5. **Family 5 — AI Token & Cost Calculation (4 Triggers):** `trg_ai_requests_a_total`, `trg_ai_requests_b_cost`, `trg_ai_generations_a_total`, and `trg_ai_generations_b_cost` (alphabetical naming guarantees `a_total` runs before `b_cost`).

------------------------------------------------------------------------

# 8. Seed Data Implementation (`018_seed.sql` + `020_gaps_and_alignment.sql`)

## 8.1 Production Reference Seed (15 System Configurations & 7 Feature Controls)

All production seeds use `ON CONFLICT DO NOTHING` for idempotency:
- **7 Feature Controls (`public.feature_controls`):** `roadmap_generator`, `daily_plan`, `quiz_practice`, `ai_practice_review`, `progress_tracking`, and `ai_mentor` seeded with `(enabled = true, default_user_enabled = true)`; **`technology_update` seeded with `(enabled = true, default_user_enabled = false)` per PRD §7**.
- **15 System Configurations (`public.system_configurations`):**
  1. `roadmap.max_active` = `3` (PRD §16)
  2. `roadmap.soft_size_max_topics` = `45` (PRD §20, added in `020`)
  3. `career_goal.max_clarification_rounds` = `2` (PRD §15)
  4. `quiz.retry_limit` = `1` (PRD §32)
  5. `quiz.standard_mcq_count` = `20` (PRD §29)
  6. `quiz.standard_free_response_min` = `5` (PRD §29)
  7. `quiz.standard_free_response_max` = `10` (PRD §29)
  8. `retention.raw_response_days` = `90` (PRD §52)
  9. `retention.mentor_message_days` = `90` (PRD §52)
  10. `retention.ai_operational_log_days` = `30` (PRD §52)
  11. `career_knowledge.review_days` = `90` (PRD §23)
  12. `technology_update.active_window_days` = `7` (PRD §39)
  13. `quality.report_auto_hide_threshold` = `5` (PRD §24, added in `020`)
  14. `ai_quota.roadmap_drafts_per_24h` = `5` (AI SD §15.1, added in `020`)
  15. `ai_quota.mentor_messages_per_24h` = `50` (AI SD §15.1, added in `020`)
- **Reference Taxonomy:** 13 canonical technology career roles (PRD §3), 11 skill categories, and 7 technology categories.

------------------------------------------------------------------------

# 9. Migration Rollback & Lifecycle Management

## 9.1 Reversible Down-Migrations (`supabase/rollbacks/020_down.sql` – `000_down.sql`)
- Every forward migration (`000`–`020`) has a tested, transaction-wrapped down-migration in `supabase/rollbacks/`.
- Teardown executes strictly in reverse topological order:
  `020_down (Gaps G1–G3 & seeds) -> 019_down (no-op) -> 018_down (seeds) -> 017_down (RLS) -> 016_down (triggers) -> 015_down (functions & cron) -> 014_down (indexes) -> 013_down (forward FKs) -> 012_down..002_down (tables) -> 001_down (enums) -> 000_down (extensions & private schema)`.
- In production, applied migrations are immutable; post-deployment schema fixes are delivered via forward corrective migrations.

## 9.2 Account Deletion & Retention Lifecycle (PRD §13, §52 & `ADR-020`)
- **Account Deletion Cascade (`EP-X01` / `EP-X02`):** When the deletion worker deletes the user from `auth.users`, PostgreSQL cascades deletion through `public.users` to all user-owned tables (bypassing append-only triggers via `pg_trigger_depth() > 1`). `admin_audit_logs` (`actor_id`, `target_user_id`), `ai_generations` (`request_id`), and `account_deletion_requests` (`user_id` via `ON DELETE SET NULL` per `ADR-020`) retain content-free audit/provenance and a local deletion tombstone; bounded encrypted provider references keep that request pseudonymous until removed.

------------------------------------------------------------------------

# 10. Database Testing & Production Deployment Gate (`ADR-020`)

## 10.1 Automated Verification Suite (204 Defined Assertions)
1. **In-Migration Structural Gates (`019_tests.sql` + `020_gaps_and_alignment.sql` — 19 Assertions):** Fails the migration transaction immediately if table count (`50`), enum count (`45`), secondary index count (`103`), trigger count (`68`), RLS policy count (`44`), private function count (`22`), PK coverage, RLS coverage, FK leading-index coverage, or zero client write/delete grants (`ADR-019`) deviate.
2. **pgTAP Test Suite (`supabase/tests/database/001`–`008` — 185 Assertions, All Hex-Valid UUIDs):**
   - `001_schema.test.sql` (`110` assertions)
   - `002_constraints.test.sql` (`12` assertions)
   - `003_rls_security.test.sql` (`16` assertions, including `ADR-019` client profile write denial & admin privacy boundary)
   - `004_trigger_behavior.test.sql` (`11` assertions)
   - `005_ai_usage.test.sql` (`10` assertions)
   - `006_roadmap_integrity.test.sql` (`6` assertions)
   - `007_retention.test.sql` (`9` assertions)
   - `008_gaps.test.sql` (`11` assertions covering Gaps `G1`–`G3`, report auto-hide threshold, and `ADR-020` deletion tombstone)

## 10.2 Final Production Readiness Scorecard

| Category | Score | Status |
|---|---|---|
| Schema & Domain Completeness (50 Tables, 45 Enums) | SPECIFIED; NOT EXECUTED | SPECIFIED / NOT EXECUTED |
| Migration Contiguity & Rollback Safety (`000`–`020`) | SPECIFIED; NOT EXECUTED | SPECIFIED / NOT EXECUTED |
| Constraint, Trigger & Index Coverage (103 Indexes, 0 Unindexed FKs) | SPECIFIED; NOT EXECUTED | SPECIFIED / NOT EXECUTED |
| Multi-Tenant RLS & Admin Privacy Firewall (`ADR-019`) | SPECIFIED; NOT EXECUTED | SPECIFIED / NOT EXECUTED |
| Automated Test Suite & CI Gate (`ADR-020`, 204 Assertions) | SPECIFIED; NOT EXECUTED | SPECIFIED / NOT EXECUTED |

**Final status: specification supplied; runtime acceptance NOT EXECUTED.**

## Accepted R01 implementation contract

D001 — Fresh Supabase restart: all four legacy Phase 1 TypeORM migrations ran on the old Docker PostgreSQL 15 database. Current DMS 000–020 has never run anywhere; legacy data/database preservation and transfer are not required (inputs/legacy_phase1/OWNER_CONFIRMATION.json).
The target is Supabase Auth AND primary application PostgreSQL storage. Correct this pre-release baseline in place; place R02 indexes in 014 before gate 019. Do not replay legacy TypeORM migrations or overlay DMS on their incompatible users schema. Legacy-to-DMS upgrade parity is N/A for this restart with owner evidence; fresh install and corrected-baseline rollback/reapply remain required. Once first applied, freeze corrected checksums and use forward migrations. This toolkit does not delete a legacy container, volume or database.

## Accepted R04 implementation contract

All 21 rollback bodies are authored in C06 §16. Reverse execution must be tested on a disposable fresh-baseline database; a failed-forward-transaction probe does not test down migrations. SQL execution remains NOT EXECUTED.

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

## Accepted R31 implementation contract

Accepted shared auth policy (version prefix auth:v1; HMAC contact/IP key components, no raw PII in keys):
OTP challenge6digits/provider-supported10min validity;5 failures per challenge; consume success once.
Resend60s; send attempts3/contact/15min and10/IP/15min; login failures5/identifier+IP/15min with15min lockout. Do not lock unrelated shared-IP users solely on that IP.
Atomic increment+first-expiry and compare/consume scripts run in Redis; every instance uses the same policy/version. Redis outage fails auth-send/verification-attempt operations closed with retryable503, never bypasses limits. Server retryAfterSeconds is authoritative; unknown contacts use anti-enumerating responses.
SMS metadata={provider_request_id,provider,timestamp,outcome,error_code,optional masked_contact}, TTL24h. Never store OTP/body/password/full contact. Challenge secrets stay in provider/approved secret store, not logs. Provider-side logs require explicitly approved <=30d policy. These operating defaults implement PRD abuse controls and are not frozen product requirements.

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

## Accepted R22 implementation contract

Executable upgrade-comparison and performance seed/EXPLAIN bodies are in C06 R22 operations, materialized by scripts/extract-db.mjs. D001 legacy upgrade is N/A; fresh corrected-baseline install/rollback/reapply and measured performance remain NOT EXECUTED.

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

## Accepted E01 implementation contract

FK coverage checks every ordered referencing prefix against a valid ready index (plain or the exact single-column IS NOT NULL partial predicate). Every public FK is reported; only these exact table+constraint+column exceptions are allowed. New actor-named columns are not automatically exempt. Validate observed constraint names and index predicates on installation; owner review and real catalog execution remain R32.

| Schema.Table | Constraint | Ordered columns | Reason | Review |
|---|---|---|---|---|
| public.users | fk_users_suspended_by | suspended_by | Low-volume admin actor pointer; reviewed exception, not a column-name wildcard | Executor specification review 2026-10-19; owner review pending |
| public.admin_users | admin_users_created_by_fkey | created_by | Low-volume admin actor pointer; reviewed exception, not a column-name wildcard | Executor specification review 2026-10-19; owner review pending |
| public.system_configurations | system_configurations_updated_by_fkey | updated_by | Low-volume admin actor pointer; reviewed exception, not a column-name wildcard | Executor specification review 2026-10-19; owner review pending |
| public.feature_controls | feature_controls_updated_by_fkey | updated_by | Low-volume admin actor pointer; reviewed exception, not a column-name wildcard | Executor specification review 2026-10-19; owner review pending |
| public.user_access_overrides | user_access_overrides_updated_by_fkey | updated_by | Low-volume admin actor pointer; reviewed exception, not a column-name wildcard | Executor specification review 2026-10-19; owner review pending |

## Accepted R21 implementation contract

Final grants: ai_requests and account_deletion_requests are service-only despite retained owner policies; EP-J01 and EP-X02 mediate reads. Final policy count remains44. An owner policy without SELECT grant does not expose input_payload/provider_cleanup.

## Accepted R21 implementation contract

Function22 private.complete_deletion_on_user_delete(): SECURITY DEFINER, BEFORE DELETE ON public.users, atomic local tombstone completion. Trigger68 trg_users_complete_deletion belongs to lifecycle family (10 including threshold), not a new timestamp trigger.

## Evidence scope and readiness (R21)

Evidence dimensions are separate: SPECIFIED; STATICALLY CHECKED (named method/evidence); IMPLEMENTED (repository/commit); EXECUTED (command/environment/result); ACCEPTED (review gate).
This correction pack provides specifications and finite static checks, not implemented software or a production certificate. Tests are defined, not passed. R32 remains NOT EXECUTED for database fresh install, rollback/reapply, pgTAP, deletion/RLS/retention/concurrency, API/UI/AI contracts, performance and PITR. C01 product scope remains frozen. Existing numerical latency/RPO/RTO and quality values are targets until measured. Agent review is not owner sign-off.

# END OF DIS v1.1.1
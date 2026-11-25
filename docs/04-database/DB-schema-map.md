# Database Schema Map (`000`–`027`)

Derived from frozen SQL migrations [supabase/migrations](../../supabase/migrations/) (`000_extensions.sql`–`027_seed_gemini_real_user_models.sql`), standalone [admin_bootstrap.sql](../../supabase/seeds/admin_bootstrap.sql), [DMS](DMS.md), [DIS](DIS.md), and [validation report](validation-report.md). All SQL migrations `000`–`027` remain immutable; applied schema changes require separately reviewed forward migrations.

## 1. Migration Inventory & Baseline Counts

- **Core DMS (`000`–`020`):** `50` `public` tables, `45` `public` enums, `103` `idx_*` secondary indexes, `68` `public` triggers, `44` RLS policies, `22` core `private` schema functions (`10` `SECURITY DEFINER` + `12` `SECURITY INVOKER`), and `0` write/delete grants on `public` tables to `anon`/`authenticated` (`ADR-019`).
- **Session Approval Hardening (`022`–`024`):** Adds `1` private table (`private.approved_auth_sessions`) and hardens `private.approve_auth_session` / `private.has_approved_session` (including `revoked_at`/`updated_at` revocation checks).
- **Catalog, Prompt & Approved Model Seeds (`025`–`027`):** Populates canonical `public.skills` catalog, the 9 frozen `public.prompt_versions` + synthetic model entry, and approved real-user Gemini model routing entries (`public.ai_models`).
- **Standalone Out-of-Band Seed (`supabase/seeds/admin_bootstrap.sql`):** Not a migration; idempotent platform admin provisioning script with pre-registration hijack guard and documented SQL rotation/revocation blocks.

| Migration | Responsibility | Key Objects Added |
|---|---|---|
| `000_extensions.sql` | Extensions & private schema | `pgcrypto`, `citext`, `pg_trgm`, `private` schema |
| `001_enums.sql` | Domain enumerations | 41 core enums (`ai_task`, `job_status`, `job_kind`, `feature_key`, `ui_language`, etc.) |
| `002_identity.sql` | User & auth identity | `users`, `user_auth_providers` |
| `003_profiles.sql` | User profile & learning prefs | `user_profiles`, `user_preferences` |
| `004_career_intelligence.sql` | Roles, skills, goals | `career_roles`, `skill_categories`, `skills`, `skill_aliases`, `skill_dependencies`, `career_goals` |
| `005_roadmap.sql` | Roadmaps, versions & merges | `roadmaps`, `roadmap_versions`, `roadmap_items`, `roadmap_merges`, `roadmap_merge_items` |
| `006_learning.sql` | Topics, resources, daily plans | `topics`, `learning_resources`, `daily_plans`, `daily_plan_items` |
| `007_assessment.sql` | Quizzes & AI practice reviews | `quizzes`, `quiz_questions`, `quiz_attempts`, `quiz_answers`, `practice_reviews` |
| `008_progress.sql` | Evidence & skill mastery | `learning_evidence`, `skill_progress`, `achievement_history` |
| `009_ai_mentor.sql` | Mentor chat & context memory | `conversations`, `messages`, `conversation_summaries`, `ai_context_records` |
| `010_ai_operations.sql` | Models, prompts, queue & logs | `ai_models`, `prompt_versions`, `ai_requests`, `ai_generations` |
| `011_technology_intelligence.sql` | Tech catalog & daily updates | `technology_categories`, `technologies`, `technology_sources`, `technology_updates`, `user_update_relevance`, `update_delivery_history` |
| `012_administration.sql` | Admin, flags, audit logs | `admin_users`, `system_configurations`, `feature_controls`, `user_access_overrides`, `admin_audit_logs` |
| `013_constraints.sql` | Deferred forward FK constraints | Cross-table `roadmap_versions`, `roadmap_merges`, `ai_generations`, etc. |
| `014_indexes.sql` | Secondary & queue indexes | 99 `idx_*` indexes including `idx_ai_models_routing`, `idx_ai_requests_queue`, `uq_ai_requests_idempotency` (in `010`) |
| `015_functions.sql` | Trigger & security functions | `validate_ai_request_status`, `calculate_total_tokens`, `calculate_ai_cost`, `cleanup_expired_retention`, `effective_feature_access`, `admin_usage_summary` |
| `016_triggers.sql` | 5 trigger families | `updated_at`, ownership, lifecycle protection, append-only immutability, AI calculations |
| `017_rls.sql` | Universal RLS & least privilege | Enables RLS on all 50 tables; `REVOKE SELECT ON public.ai_requests FROM authenticated` (`R12`) |
| `018_seed.sql` | Initial catalog & config defaults | 7 `feature_controls`, 11 `system_configurations`, 13 `career_roles`, `skill_categories`, `technology_categories` |
| `019_tests.sql` | In-migration assertions | Static schema verification helpers |
| `020_gaps_and_alignment.sql` | API v1.5.1 gaps G1–G3 & gate | 4 enums + `user_ratings`, `content_reports`, `account_deletion_requests`, `user_skill_aliases` + AI/soft-size configs + 50-table gate |
| `022_session_approval_gate.sql` | Approved session table & policies | `private.approved_auth_sessions`, owner policy updates |
| `023_session_gate_hardening.sql` | Dynamic SQL session check | Hardens `private.has_approved_session` |
| `024_session_revocation.sql` | Explicit session revocation | Adds `revoked_at`/`updated_at` on `private.approved_auth_sessions` |
| `025_seed_skills_catalog.sql` | Approved skills catalog seed | Canonical technology `public.skills` rows for profile/roadmap resolution |
| `026_seed_ai_prompts_and_synthetic_model.sql` | Frozen prompt & synthetic model seed | 9 frozen `public.prompt_versions` (SHA-256 verified) + synthetic `public.ai_models` row |
| `027_seed_gemini_real_user_models.sql` | Approved Gemini routing seed | Active `real_user_data_approved` Gemini entries in `public.ai_models` |
| `supabase/seeds/admin_bootstrap.sql` | Standalone admin bootstrap (non-migration) | Idempotent `platform_admin` provisioning (`public.admin_users`) + documented rotation/revocation SQL |

## 2. Domain Table Mapping (50 Public Tables + 1 Private Auth Table)

| Domain | Tables | RLS / Access Model |
|---|---|---|
| Identity & Sessions | `public.users`, `public.user_auth_providers`, `private.approved_auth_sessions` | Owner/admin select on `users`; owner select on providers; `service_role`-only writes (`ADR-019`) |
| Profile & Preferences | `public.user_profiles`, `public.user_preferences`, `public.user_skill_aliases` | Owner select (approved session); direct client writes revoked in `020` |
| Career Intelligence | `public.career_roles`, `public.skill_categories`, `public.skills`, `public.skill_aliases`, `public.skill_dependencies`, `public.career_goals` | Shared read (`approved`/`validated` + active user); `career_goals` owner select |
| Roadmaps | `public.roadmaps`, `public.roadmap_versions`, `public.roadmap_items`, `public.roadmap_merges`, `public.roadmap_merge_items` | Owner select; active limit `<= 3`; immutable versions & merge items |
| Learning & Daily Plans | `public.topics`, `public.learning_resources`, `public.daily_plans`, `public.daily_plan_items` | Shared approved reads on topics/resources; owner select on plans/items |
| Assessment & Reviews | `public.quizzes`, `public.quiz_questions`, `public.quiz_attempts`, `public.quiz_answers`, `public.practice_reviews` | `quizzes`/`quiz_questions` service-only (prevent answer leakage); attempts/answers/reviews owner select |
| Progress | `public.learning_evidence`, `public.skill_progress`, `public.achievement_history` | Owner select; append-only `learning_evidence` & `achievement_history` |
| AI Mentor & Context | `public.conversations`, `public.messages`, `public.conversation_summaries`, `public.ai_context_records` | Owner select (`messages` enforces `expires_at > now()` and 90d ceiling); admin excluded (`PRD §51`) |
| AI Operations (`010`) | `public.ai_models`, `public.prompt_versions`, `public.ai_requests`, `public.ai_generations` | Service-only (`ai_requests` SELECT revoked from `authenticated` in `017`, read exclusively via `EP-J01`) |
| Technology Intelligence | `public.technology_categories`, `public.technologies`, `public.technology_sources`, `public.technology_updates`, `public.user_update_relevance`, `public.update_delivery_history` | Shared catalog reads; `technology_updates` gated by delivery + `effective_feature_access(..., 'technology_update')` |
| Administration & Feedback | `public.admin_users`, `public.system_configurations`, `public.feature_controls`, `public.user_access_overrides`, `public.admin_audit_logs`, `public.user_ratings`, `public.content_reports`, `public.account_deletion_requests` | Append-only `admin_audit_logs` & `content_reports`; `account_deletion_requests` service-only (`R35`) |

## 3. AI Operations Schema, Indexes, Triggers & RLS (`010`, `014`, `015`, `016`, `017`)

- **`public.ai_requests`:** Durable queue (`available_at`, `status` enum `queued | preparing | succeeded | failed`, `attempt_count`, `locked_by`, `locked_at`, `input_payload jsonb <= 32768 bytes`, `uq_ai_requests_idempotency` on `(user_id, idempotency_key)`).
  - Queue index: `idx_ai_requests_queue ON public.ai_requests (available_at) WHERE status = 'queued'`.
  - State-machine trigger (`trg_ai_requests_status` -> `private.validate_ai_request_status()`): allows `queued -> preparing | failed`, `preparing -> succeeded | failed`, `failed -> queued` (only when `OLD.retryable = true`). Forbids `preparing -> queued` (`23514`). Auto-increments `attempt_count` on `-> preparing` and resets `locked_at`/`locked_by`/`error_code` on `failed -> queued`.
  - Cost/total triggers: `trg_ai_requests_a_total` & `trg_ai_requests_b_cost` compute `total_units` and `cost_usd` from `ai_models` pricing.
  - Retention: Purged via `private.cleanup_expired_retention()` after `retention.ai_operational_log_days` (`1..30` days); `input_payload` cleared immediately on `succeeded` or terminal `failed`.
- **`public.ai_generations`:** Permanent content-free provenance (`request_id ON DELETE SET NULL`, `task`, `provider_key`, `model_id`, `prompt_version_id`, `output_schema_id`, `validation_status`, `fallback_used`, `language`, `input_units`, `output_units`, `total_units`, `cost_usd`, `latency_ms`, `output_hash`).
- **`public.ai_models`:** Model routing table indexed by `idx_ai_models_routing (fallback_rank) WHERE is_active AND real_user_data_approved`.
- **`public.prompt_versions`:** Registry storing `(task, name, version)` with SHA-256 `template_hash` and `output_schema_id` verified fail-closed by `PromptManagerService`.

## 4. `E01` Approved 5-FK Exception Summary (`DMS.md`)

Five nullable admin-actor foreign keys pointing to `public.admin_users(user_id)` deliberately retain `ON DELETE RESTRICT` (`E01`) rather than `ON DELETE SET NULL` to preserve administrative accountability trails:

1. `public.users` (`fk_users_suspended_by` on `suspended_by`)
2. `public.admin_users` (`admin_users_created_by_fkey` on `created_by`)
3. `public.system_configurations` (`system_configurations_updated_by_fkey` on `updated_by`)
4. `public.feature_controls` (`feature_controls_updated_by_fkey` on `updated_by`)
5. `public.user_access_overrides` (`user_access_overrides_updated_by_fkey` on `updated_by`)

See [deployment.md](../09-operations/deployment.md) for autovacuum tuning (`C06 §20`), `R22` disposable capacity procedures, and `R23` PITR read-only catalog smoke verification.

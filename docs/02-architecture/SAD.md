# AI Career Intelligence Mentor

# System Architecture Document (SAD v1.1.1)

## Engineering Implementation Handoff Edition

**Status:** Approved for Engineering Implementation  
**Version:** 1.1.1  
**Supersedes:** SAD v1.1  
**Baseline Alignment:** PRD v1.4.1 Final Freeze · DDD v1.2.2 · DIS v1.1.1 · API Spec v1.5.1 · DMS v1.2.2 · DB Validation Report v1.1 · AI SD v1.1.1 · UI/UX Spec v2.0.2

------------------------------------------------------------------------

## Purpose

This document is the complete engineering handoff architecture baseline for AI Career Intelligence Mentor.

It converts approved product planning into an implementation-ready system architecture and locks all cross-document architectural decisions (`ADR-001` through `ADR-020`).

------------------------------------------------------------------------

# 1. Document Overview

## 1.1 Architectural Goals

- Preserve PRD v1.4.1 behavior without scope expansion
- Maintain MVP scope (50–100 initial active users)
- Enable deterministic production implementation
- Support AI provider flexibility via the Vercel AI SDK
- Provide secure, multi-tenant scalable foundations

## 1.2 Authoritative Document Precedence Chain

In any case of conflict across implementation documents, earlier documents in this chain govern downstream documents:

```text
[01. PRD v1.4.1] (Ultimate Product Source of Truth & Frozen Business Invariants)
       │
       ▼
[02. SAD v1.1.1 + ADRs 001–020] (System Architecture, Tech Stack & Runtime Topology)
       │
       ▼
[03. API Specification v1.5.1] (Endpoint Contracts, DTOs, Auth Guards & Error Catalog)
       │
       ▼
[04. DMS v1.2.2 (Migrations 000–020)] (Physical Database Schema Authority — Supersedes DDD & DIS)
       │
       ├──► [05. DB Validation Report v1.1] (CI Verification Gate & Performance SLAs)
       ├──► [06. AI System Design v1.1.1] (AI Gateway, Prompts, Memory & Schema Validation)
       └──► [07. UI/UX Specification v2.0.2] (Frontend Screens, Components & API Traceability)
```

------------------------------------------------------------------------

# 2. System Overview

Architecture:

```text
Users
 |
Next.js PWA (Bangla-first UI)
 |
NestJS Backend (/api/v1)
 |
Modules:
Auth & Account
Profile
Career Intelligence
Roadmap
Learning
Quiz
Practice Review
Progress
Mentor
Technology Update
Quality Feedback (Ratings & Reports)
Jobs
Admin
 |
AI Gateway (Vercel AI SDK)
 |
PostgreSQL 16+ (Supabase) + Redis 7+ (Ephemeral TTL Store)
 |
External Providers (Approved LLM Providers, Bangladesh Local SMS OTP Provider)
```

------------------------------------------------------------------------

# 3. Technology Stack Finalization

Approved stack:

| Layer | Technology | Role |
|---|---|---|
| Frontend | Next.js + TypeScript | Mobile-responsive Progressive Web App (PWA) |
| UI | React + Tailwind CSS | Component system and responsive styling |
| Backend | NestJS + TypeScript | Modular monolith REST API and background workers |
| Runtime & Package Mgr | Node.js + pnpm | Server execution and deterministic package management |
| Database | PostgreSQL 16+ + Supabase | Primary relational storage, RLS, and `ai_requests` durable job queue |
| Ephemeral Store | Redis 7+ | 24h `Idempotency-Key` cache, OTP cooldowns, login lockouts, and rate limits |
| API | REST (`/api/v1`) + OpenAPI 3.0 | HTTP endpoint contract and schema validation |
| Authentication | Supabase Auth (GoTrue) | Email, Bangladesh Phone (`+880`), Google, and Facebook authentication |
| AI Integration Layer | Vercel AI SDK | Provider-agnostic LLM execution (`generateObject`, `generateText`, `streamText`) |
| CI/CD | GitHub Actions | Automated lint, test, database migration verification, and staged deployment |

AI providers and Bangladesh local SMS providers are intentionally not fixed to a single vendor.

The system uses abstraction layers so providers can be changed based on:

- Cost
- Performance and Bangla/English/Mixed-language quality
- Structured-output reliability
- Data-handling and privacy terms (`real_user_data_approved`)
- Reliability and availability

------------------------------------------------------------------------

# 4. Component Architecture

Backend layered architecture:

```text
Controller
 |
AccessGuard (JWT -> User Status -> Role -> Global Feature -> User Feature -> Ownership)
 |
Service
 |
Domain Logic
 |
Repository (Supabase service_role)
 |
Database (PostgreSQL 16+ with Universal RLS)
```

Core backend modules:

- Authentication & Account (`/auth`, `/account`)
- User Profile (`/profile`)
- Career Intelligence (`/career`)
- Roadmap (`/roadmaps`)
- Learning (`/learning`)
- Quiz (`/quiz`)
- Practice Review (`/practice-review`)
- Progress (`/progress`)
- Mentor (`/mentor`)
- Technology Update (`/technology-updates`)
- Quality Feedback & Jobs (`/ratings`, `/reports`, `/jobs`)
- Admin (`/admin`)
- Health (`/health`)

AI access is exclusively through the centralized AI Gateway module (`src/ai/`).

------------------------------------------------------------------------

# 5. Database Architecture

Database: PostgreSQL 16+ through Supabase.  
Physical Schema Authority: **DMS v1.2.2 (`000_extensions.sql` through `020_gaps_and_alignment.sql`, 50 tables, 45 enums)**.

Standards:

- UUID identifiers (`gen_random_uuid()`)
- `snake_case` naming
- `created_at` / `updated_at` timestamps (`timestamptz`)
- Audit fields and content-free provenance tracking (`ai_generations`)
- Append-only immutability triggers on roadmap versions, roadmap items, merge items, learning evidence, achievement history, content reports, and admin audit logs
- Hard cascading delete of personal data from `auth.users` -> `public.users` upon account deletion while preserving shared non-personal content and anonymized audit records
- Version-controlled sequential migrations (`000`–`020`)

Core entities (50 tables across 11 domains):

- **Identity & Account (5):** `users`, `user_auth_providers`, `user_profiles`, `user_preferences`, `account_deletion_requests`
- **Career Intelligence (7):** `career_roles`, `skill_categories`, `skills`, `skill_aliases`, `user_skill_aliases`, `skill_dependencies`, `career_goals`
- **Roadmap (5):** `roadmaps`, `roadmap_versions`, `roadmap_items`, `roadmap_merges`, `roadmap_merge_items`
- **Learning (4):** `topics`, `learning_resources`, `daily_plans`, `daily_plan_items`
- **Assessment (5):** `quizzes`, `quiz_questions`, `quiz_attempts`, `quiz_answers`, `practice_reviews`
- **Progress (3):** `learning_evidence`, `skill_progress`, `achievement_history`
- **AI Mentor (4):** `conversations`, `messages`, `conversation_summaries`, `ai_context_records`
- **AI Operations (4):** `ai_models`, `prompt_versions`, `ai_requests`, `ai_generations`
- **Technology Intelligence (6):** `technology_categories`, `technologies`, `technology_sources`, `technology_updates`, `user_update_relevance`, `update_delivery_history`
- **Quality Feedback (2):** `user_ratings`, `content_reports`
- **Administration (5):** `admin_users`, `system_configurations`, `feature_controls`, `user_access_overrides`, `admin_audit_logs`

Security:

- Backend authorization (`AccessGuard`) and backend-mediated writes (`service_role`)
- Universal PostgreSQL Row Level Security (RLS enabled on all 50 tables; zero client `INSERT`/`UPDATE`/`DELETE` grants; zero admin access to private mentor conversations, messages, summaries, or AI context memory)

------------------------------------------------------------------------

# 6. API Architecture

API style: REST

Version:

```text
/api/v1
```

Authentication: JWT Bearer token (`Authorization: Bearer <JWT>`).

Standard success response:

```json
{
  "success": true,
  "data": {}
}
```

Standard error response:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "requestId": "uuid",
    "details": [],
    "retryable": false,
    "retryAfterSeconds": null
  }
}
```

API route groups:

- `/auth`
- `/account`
- `/profile`
- `/career`
- `/roadmaps`
- `/learning`
- `/quiz`
- `/practice-review`
- `/progress`
- `/mentor`
- `/technology-updates`
- `/ratings`
- `/reports`
- `/jobs`
- `/admin`
- `/health` (unversioned)

------------------------------------------------------------------------

# 7. AI Architecture

AI architecture:

```text
Application Modules
 |
AI Gateway
 |
Context Builder (PII Redaction + Scoped Summary Collation)
 |
Prompt Manager (SHA-256 Verified Templates)
 |
Model Router (Task Approval + Cost/Fallback Ranking)
 |
Provider Adapter (Vercel AI SDK)
 |
Approved AI Provider
 |
Output Validator (Zod Schema + DAG Acyclicity + Product Rules)
```

AI Gateway contains:

- Prompt Manager
- Context Builder
- Model Router
- Provider Adapter (Vercel AI SDK)
- Output Validator
- Cost & Provenance Tracker
- Evaluation System

Supported AI tasks (`public.ai_task`):

1. `goal_interpretation` — Career goal interpretation and clarification (Synchronous `< 10 s`)
2. `roadmap_generate` — Career roadmap draft generation (Asynchronous `202 Accepted` job)
3. `roadmap_revision` — Pre-lock draft revision (Asynchronous `202 Accepted` job)
4. `merge_proposal` — Post-lock roadmap merge and level-change proposals (Asynchronous `202 Accepted` job)
5. `topic_content` — Shared canonical topic content generation (Asynchronous `202 Accepted` job)
6. `quiz_generate` — Shared daily quiz generation: 20 MCQ + 5–10 free-response (Asynchronous `202 Accepted` job)
7. `practice_review` — Formative AI Practice Review on free-response submissions (Asynchronous `202 Accepted` job)
8. `mentor_chat` — AI Career Mentor conversation (Synchronous JSON `< 10 s` default for MVP; opt-in SSE streaming via `Accept: text/event-stream`)
9. `technology_update` — Personalized daily technology update synthesis (Hourly timezone-aware background batch)

AI output must pass structural, product-rule, and source-grounding validation before storage.

------------------------------------------------------------------------

# 8. Security Architecture

Security layers:

1. Authentication (Supabase JWT validation)
2. System Suspension Enforcement (`users.status = 'active'`, with `AZ-SUSP` carve-outs for logout, `/auth/me`, and account deletion)
3. Role-Based Authorization (`USER` vs. server-verified `PLATFORM_ADMIN` in `public.admin_users`)
4. Effective Feature Access (`System User Status + Global Feature Status + User Feature Status = Effective Access`)
5. Database Protection & Universal Row Level Security (`user_id = (SELECT auth.uid())`)
6. API Security (Rate limiting, `Idempotency-Key` validation, strict DTO whitelisting)
7. AI Safety (Untrusted input wrapping for user text and retrieved web pages; PII redaction)

Threats addressed:

- Account takeover & brute-force login attempts
- Phone OTP abuse (`+880` normalization, per-number and per-IP rate limits)
- Unauthorized cross-tenant access
- API abuse & replay/duplicate mutations
- Direct and indirect prompt injection
- Data leakage & admin snooping on private mentor chats
- AI manipulation

Controls:

- JWT signature, expiration, and status validation
- Resource ownership checks (at both service and DB trigger levels)
- Universal RLS policies across all 50 tables
- Redis-backed rate limiting and cooldowns
- Runtime environment secret injection (zero secrets stored in DB or Git)

------------------------------------------------------------------------

# 9. Deployment Architecture

Environments:

```text
Local
Development
Staging
Production
```

CI/CD:

```text
Commit
 |
Lint & Typecheck
 |
Unit & Integration Tests
 |
Database Reset & pgTAP Test Suite (001–008)
 |
Build
 |
Staging Deployment & Smoke Verification
 |
Approval
 |
Production Deployment
```

Database changes use version-controlled forward migrations (`000_extensions.sql` through `020_gaps_and_alignment.sql`).

------------------------------------------------------------------------

# 10. Testing Architecture

Testing layers:

- Unit testing (Jest)
- Integration testing
- API contract testing (OpenAPI 3.0 schema validation)
- Database testing (19 in-migration assertions + 185 pgTAP assertions across `001`–`008`)
- Security, RLS isolation & prompt-injection testing
- AI quality benchmark testing (8 technology roles × 3 language modes: English, Bangla, Bangla-English mixed language)
- Performance & query-plan testing (`explain_checks.sql` and k6 load testing)
- End-to-end testing (Playwright)

------------------------------------------------------------------------

# 11. Performance, Scalability & Reliability

Initial target: 50–100 active users.

Strategy:

- Modular monolith architecture
- Database indexing optimization (103 secondary indexes; leading FK coverage with named E01 exceptions; execution pending)
- PostgreSQL `FOR UPDATE SKIP LOCKED` background job queue on `public.ai_requests`
- AI request quota, timeout, and circuit-breaker management

Latency targets:

- Standard APIs: `< 300 ms`
- Complex read APIs (`/learning/today`, `/progress`, `/admin/usage`): `< 1 s`
- Synchronous AI APIs (`POST /mentor/messages`, `POST /career/goals`): `< 10 s`
- Asynchronous AI generation APIs: `202 Accepted` (`Preparing` state) polled via `GET /api/v1/jobs/{id}`

Reliability patterns:

- Retry with exponential backoff and approved model fallback
- Per-provider circuit breakers
- Timeout enforcement
- Graceful degradation (preserving user data, roadmaps, plans, quizzes, and progress on AI failure)
- Idempotency (`Idempotency-Key` header with 24h TTL)

------------------------------------------------------------------------

# 12. Monitoring & Operations

Observability pillars:

- Logs (Structured JSON correlated via `X-Request-Id`)
- Metrics (Prometheus)
- Traces

Monitor:

- **Application:** API latency, error rate, availability, job queue depth
- **AI:** Usage units (`input_units`, `output_units`, `total_units`), trigger-derived `cost_usd`, latency, provider fallback rate, validation failure rate
- **Business:** Active users (7-day window), roadmaps locked, daily learning & quiz completion, content ratings and reports

------------------------------------------------------------------------

# 13. Architecture Risk Register

Major risks:

## AI Provider Dependency
Mitigation: AI Gateway abstraction on the Vercel AI SDK and multi-provider fallback routing.

## AI Cost Growth
Mitigation: Database trigger-driven cost tracking, configurable 24h quotas in `system_configurations`, and lowest-cost approved model routing.

## Data Security & Privacy
Mitigation: Universal RLS across all 50 tables, backend-mediated writes (`service_role`), and strict exclusion of admin access to private mentor messages and AI memory.

## SMS Provider Dependency
Mitigation: Replaceable Bangladesh local SMS adapter layer with OTP cooldowns and rate limits.

## Scope Expansion
Mitigation: Frozen PRD v1.4.1 governance and strict Precedence Chain enforcement.

------------------------------------------------------------------------

# 14. Architecture Decision Records (ADRs 001–020)

Approved ADRs:

1.  **ADR-001:** Next.js PWA frontend
2.  **ADR-002:** NestJS backend
3.  **ADR-003:** Node.js runtime
4.  **ADR-004:** pnpm package manager
5.  **ADR-005:** PostgreSQL 16+ + Supabase
6.  **ADR-006:** Supabase Auth (GoTrue)
7.  **ADR-007:** REST API (`/api/v1`) + OpenAPI 3.0
8.  **ADR-008:** AI Gateway abstraction using the Vercel AI SDK
9.  **ADR-009:** Replaceable Bangladesh local SMS adapter architecture
10. **ADR-010:** Managed cloud deployment
11. **ADR-011:** JWT security model with `AccessGuard` evaluation order
12. **ADR-012:** GitHub Actions CI/CD
13. **ADR-013:** Modular monolith architecture
14. **ADR-014:** Asynchronous `Preparing` job processing (`202 Accepted`)
15. **ADR-015:** Universal PostgreSQL Row Level Security (RLS)
16. **ADR-016 (Physical Schema Authority):** `DMS v1.2.2` (`000_extensions.sql` through `020_gaps_and_alignment.sql`, 50 tables, 45 enums) is the sole physical database authority, superseding `DDD` and `DIS` wherever table counts, column definitions, enum types (`public.career_level`), or migration filenames differ.
17. **ADR-017 (Unified Job Queue & Redis Scope):** Asynchronous AI jobs use PostgreSQL `public.ai_requests` polled by NestJS workers via `SELECT ... FOR UPDATE SKIP LOCKED` (`idx_ai_requests_queue`). Redis is used strictly for ephemeral TTL storage (24h `Idempotency-Key` store, OTP cooldowns, login lockouts, and rate limits). References to BullMQ in AI design docs map to `PostgresJobQueueConsumer` polling `public.ai_requests`.
18. **ADR-018 (Mentor Chat Transport Protocol):** For MVP, `POST /api/v1/mentor/messages` (`EP-M03`) returns a synchronous `201 Created` JSON response (`MessageResponseDTO`, `< 10 s` timeout) via `generateText()`. SSE streaming (`validated committed reply chunks (SSE)`) is an optional non-breaking mode activated only when the client sends `Accept: text/event-stream`.
19. **ADR-019 (Backend-Mediated Profile Writes & Alias State-Sync):** All writes to `user_profiles`, `user_preferences`, and `user_skill_aliases` execute in the NestJS backend via `service_role` (direct client `INSERT`/`UPDATE` grants to `authenticated` are revoked in `020_gaps_and_alignment.sql`). Resolving a skill alias via `EP-P05` atomically inserts into `user_skill_aliases`, appends the resolved `skill_id` to `user_profiles.self_reported_skill_ids`, and defers level-scoped progress until a confirmed Career Level exists (unless stronger evidence already exists).
20. **ADR-020 (Live CI Database Verification Gate & Deletion Tombstone):** Production database freeze is unlocked when `.github/workflows/database-ci.yml` passes `supabase db reset` and `supabase test db` (`001`–`008`). For account deletion (`EP-X01`/`EP-X02`), `account_deletion_requests.user_id` uses `ON DELETE SET NULL` so the locally completed (pseudonymous until provider references are cleared) status record survives user cascade deletion, and EP-X02 accepts a scoped DeletionReceipt; only returned status=completed confirms local deletion. Generic401 is unconfirmed.

------------------------------------------------------------------------

# 15. Final Architecture Review

## Status

# SPECIFIED / STATIC VALIDATION SCOPED

Completed & Aligned Engineering Handoff Suite:

- Architecture design (`SAD v1.1.1`)
- Technology decisions & ADRs (`ADR-001`–`ADR-020`)
- Module boundaries & security model
- Domain database design (`DDD v1.2.2`)
- Database implementation specification (`DIS v1.1.1`)
- Endpoint API specification (`API Spec v1.5.1`)
- Executable SQL migrations & tests (`DMS v1.2.2`)
- Database validation gate (`DB Validation Report v1.1`)
- AI system design (`AI SD v1.1.1`)
- UI/UX screen & component contract (`UI/UX Spec v2.0.2`)

------------------------------------------------------------------------

## Accepted R01 implementation contract

D001 — Fresh Supabase restart: all four legacy Phase 1 TypeORM migrations ran on the old Docker PostgreSQL 15 database. Current DMS 000–020 has never run anywhere; legacy data/database preservation and transfer are not required (inputs/legacy_phase1/OWNER_CONFIRMATION.json).
The target is Supabase Auth AND primary application PostgreSQL storage. Correct this pre-release baseline in place; place R02 indexes in 014 before gate 019. Do not replay legacy TypeORM migrations or overlay DMS on their incompatible users schema. Legacy-to-DMS upgrade parity is N/A for this restart with owner evidence; fresh install and corrected-baseline rollback/reapply remain required. Once first applied, freeze corrected checksums and use forward migrations. This toolkit does not delete a legacy container, volume or database.

## Accepted R10 implementation contract

Direct authenticated reads of ordinary owner/shared rows require an active account; technology_updates, user_update_relevance and update_delivery_history also require effective technology_update access. Settings exceptions are own users row, linked identities, minimal feature-control display metadata, and deletion status through EP-X02. The users policy must not recursively query itself. Active users retain existing roadmap/plan/progress/chat reads when generation flags are OFF. service_role queries enforce the same rules. Never add a permissive alternative that ORs away these restrictions.

## Accepted R11 implementation contract

Human quality review uses synthetic benchmark conversations/practice answers and
approved shared non-personal learning content. It must not sample production
users' private mentor turns, memory, summaries or raw practice answers.
Production quality monitoring uses content-free latency/failure/report metrics.
Do not add a staff/admin content-reading role or use service_role as a human
review exception. Any later consent-based research access is a separate product
and privacy decision, outside this correction.

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

## Accepted R08 implementation contract

Raw mentor text expires at the earlier of expires_at and created_at+90d; API/service/direct reads apply both predicates. Prepare summaries before expiry; a failed summarizer never delays purge or fabricates memory. Physical purge lag must be measured under R32: the daily cron alone is not a strict boundary guarantee. Production requires a monitored purge runner at the declared cutoff, outage recovery and oldest-retained-text alerts. No retention grace is approved.

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

## Accepted R24 implementation contract

Advance last_active_at for successful explicit login/verification/OAuth session
establishment and successful foreground user actions: profile/goal edits,
roadmap/plan selection or inspection, learning/topic interaction, quiz autosave/
submit, mentor send and technology-update open. Use authenticated server identity
and server time. Coalesce writes to at most once per five minutes per user,
with last_active_at=GREATEST(last_active_at, observed_server_time).
Do not advance it for silent token refresh, job polling, health checks, scheduler
work, background prefetch or passive telemetry. Session refresh timestamps are
separate. A foreground action can record activity while using a refreshed session.

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

## Accepted R31 implementation contract

Accepted shared auth policy (version prefix auth:v1; HMAC contact/IP key components, no raw PII in keys):
OTP challenge6digits/provider-supported10min validity;5 failures per challenge; consume success once.
Resend60s; send attempts3/contact/15min and10/IP/15min; login failures5/identifier+IP/15min with15min lockout. Do not lock unrelated shared-IP users solely on that IP.
Atomic increment+first-expiry and compare/consume scripts run in Redis; every instance uses the same policy/version. Redis outage fails auth-send/verification-attempt operations closed with retryable503, never bypasses limits. Server retryAfterSeconds is authoritative; unknown contacts use anti-enumerating responses.
SMS metadata={provider_request_id,provider,timestamp,outcome,error_code,optional masked_contact}, TTL24h. Never store OTP/body/password/full contact. Challenge secrets stay in provider/approved secret store, not logs. Provider-side logs require explicitly approved <=30d policy. These operating defaults implement PRD abuse controls and are not frozen product requirements.

## Accepted R15 implementation contract

Default Accept:application/json → 201 JSON, unchanged.
Opt-in Accept:text/event-stream → 200 text/event-stream; Cache-Control:no-store.
Use POST fetch streaming; native EventSource's GET is not the transport here.
Generate, validate and commit the assistant message before emitting its content.
Then chunk that validated reply as display deltas; this is not raw model streaming.
Before headers, normal JSON errors/statuses apply. After headers, emit a typed
error event if possible and close; never attempt to change the HTTP status.
The same client_message_id retrieves the committed response on retry, with no
second model call. No automatic reconnect/repost that creates a new message ID.

```typescript
type MentorStreamEvent =
  | { event: 'message.delta'; data: {
      message_id: string; seq: number; text: string } }
  | { event: 'message.completed'; data: MessageResponseDTO }
  | { event: 'message.error'; data: {
      code: string; retryable: boolean; request_id: string } };
```

SSE frames use event:<name> followed by data:<JSON> and a blank line; seq starts at0. message.completed is authoritative, EOF is not. JSON remains201 by default; opt-in transport is200. Same client_message_id replays the committed validated reply without another model call. Disconnect preserves draft/client ID; reconcile with history or same-ID retry. No automatic new-ID repost. The application chunks the already validated committed output, never unvalidated provider deltas.

## Accepted R28 implementation contract

Inventory:82 catalog entries,81 HTTP operations including GET /health,1 internal-only EP-G04. No POST /progress/evidence exists. Twelve UI service groups are not endpoint/controller counts; do not add endpoints to satisfy an old headline.

## Evidence scope and readiness (R21)

Evidence dimensions are separate: SPECIFIED; STATICALLY CHECKED (named method/evidence); IMPLEMENTED (repository/commit); EXECUTED (command/environment/result); ACCEPTED (review gate).
This correction pack provides specifications and finite static checks, not implemented software or a production certificate. Tests are defined, not passed. R32 remains NOT EXECUTED for database fresh install, rollback/reapply, pgTAP, deletion/RLS/retention/concurrency, API/UI/AI contracts, performance and PITR. C01 product scope remains frozen. Existing numerical latency/RPO/RTO and quality values are targets until measured. Agent review is not owner sign-off.

# END OF SAD v1.1.1

# ENGINEERING IMPLEMENTATION HANDOFF EDITION
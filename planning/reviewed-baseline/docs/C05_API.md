# AI Career Intelligence Mentor

# API Specification Document v1.5.1

## Complete Endpoint Implementation Contract Edition (Zero-Gap Aligned Release)

**Supersedes:** API Specification Document v1.5 and v1.4  
**Baseline documents:** PRD v1.4.1 Final Freeze · SAD v1.1.1 (ADRs 001–020) · DMS v1.2.2 (Migrations 000–020, 50 Tables) · DDD v1.2.2 · DIS v1.1.1 · AI SD v1.1.1 · UI/UX Spec v2.0.2  
**Status:** Specification correction candidate for implementation review — Specification contracts supplied; execution pending

---

# 0. Document Control

## 0.1 Purpose

v1.4 defined API architecture, security, operations, and governance. v1.5 added the complete endpoint-level implementation contract (endpoints, DTOs, validation, errors, database mapping, service mapping, tests, workflows). **v1.5.1** preserves 100% of the v1.5 endpoint contracts and DTO schemas while closing all 13 database and infrastructure gaps (`G1`–`G13` in §21) via **DMS v1.2.2 (`020_gaps_and_alignment.sql`)** and **SAD v1.1.1 (`ADR-016`–`ADR-020`)**.

## 0.2 What changed from v1.4 -> v1.5 -> v1.5.1

| Area | Change |
|-|-|
| §1–§12 (v1.4) | Preserved. Only additive changes, each marked **[v1.5+]**. |
| §13 Global Contract Conventions | Shared headers, authorization profiles, pagination, async jobs (`public.ai_requests`), idempotency, enums. |
| §14 Endpoint Contract Catalog | 82 catalog entries (81 HTTP routes + internal EP-G04) in the required template, mapped 1:1 to all 50 tables in DMS v1.2.2. |
| §15 DTO Reference Library | Field-level DTO tables. |
| §16 API Error Catalog | Complete error code catalog and HTTP mappings. |
| §17 API Testing Matrix | Per-endpoint and cross-cutting test suites. |
| §18 Workflow Documentation | Four end-to-end flows. |
| §19–§22 | PRD Traceability, 100% Readiness Assessment, Closed Gap Register (`G1`–`G13`), Final Statement. |

## 0.3 Reconciliation decisions (PRD/SAD override the original request list)

The PRD forbids scope expansion and behavior changes without a new product decision. Where the original v1.5 endpoint request conflicted with the frozen PRD/SAD, the PRD/SAD won.

| Requested item | Decision | Reason |
|-|-|-|
| Notification, Analytics, File, Search APIs | **Reserved / not in MVP.** No endpoints. Only admin aggregate usage counts exist (`GET /admin/usage`). | PRD §6 has no such feature; PRD §4/§58 exclude push notifications and advanced analytics; SAD has no module; DMS has no tables. |
| Roles `CONTENT_ADMIN`, `AI_ADMIN`, `SUPER_ADMIN` | **Reserved, unused.** MVP uses `USER` and one admin role (`PLATFORM_ADMIN`, shown as **ADMIN** in this document). | PRD §7/§51: no permission complexity, no admin content management. |
| `PATCH /roadmaps/{id}` | **Removed.** Replaced by draft revision, merge proposal, and focus/archive endpoints. | PRD §21: users never edit roadmap structure directly. Locked roadmaps change only via accepted merge. |
| `POST /roadmaps/{id}/approve` | **Removed** (duplicate of `/lock`). | PRD §21. |
| `POST /roadmaps/{id}/merge` | **Renamed** to `POST /roadmaps/{id}/merges` (proposal), plus accept / reject / undo. | PRD §21 merge lifecycle. |
| `POST /learning/{id}/complete` | **Removed.** Plan-day completion is a side effect of quiz submission. | PRD §33: a "Complete" click is not evidence; submission unlocks the next day. |
| `POST /progress/evidence` | **Internal only** (service call, not client-callable). | PRD §35/§37: evidence is system-derived; "I studied this" is not evidence. |
| `PATCH /technology-updates/preferences` | **Removed.** Users view and rate only. Access is admin-controlled. | PRD §7, §38–§39. |
| `POST /practice` (standalone) | **Removed.** Short free-response is part of the quiz; AI Practice Review is a resource of the submitted attempt. | PRD §29–§33. |
| `/career-goals`, `/quizzes`, `/practice` | **Use SAD paths:** `/career/goals`, `/quiz`, `/practice-review`. | SAD §6. |
| "AI APIs < 10s" | Generation endpoints return **202 Accepted** + job (Preparing state). Mentor chat and goal interpretation stay synchronous (`< 10 s`). | PRD §48, ADR-018. |
| `POST /auth/verify-phone` | Kept; `verify-email` added. | PRD §9–§10. |

**Endpoints added because the PRD requires them:** email verification, resend, forgot-password, OAuth session bootstrap, identity linking, contact add, account deletion, Focus switching, Daily Plan create/rebuild, merge accept/reject/undo, roadmap archive, quiz resume/retry, ratings, reports, jobs, effective access (`/auth/me`), admin per-user feature control, and usage counts.

## 0.4 PRD v1.4.1 & SAD v1.1.1 Alignment Summary

| Policy / ADR | Effect on this specification |
|-|-|
| **PRD v1.4.1 §47 (Vercel AI SDK)** | Internal to the AI Gateway Provider Adapter (§1). Provider and model (`provider_key`, `model_id`, `fallback_used`) are stored in `ai_requests` and `ai_generations` for traceability and are never exposed in public client DTOs. |
| **Usage Units & Cost Aggregation** | `AIRequestDTO.budget` and `AIResponseDTO` use `usage_units` (`input_units`, `output_units`, `total_units`); `GET /admin/usage` returns `by_feature`, `by_provider`, `fallbacks_used`, and supports `group_by=provider`. |
| **ADR-016 (DMS v1.2.2 Authority)** | All 50 tables and 45 enums in `DMS v1.2.2` (`000`–`020`) back this specification. All 13 gaps (`G1`–`G13`) in §21 are closed. |
| **ADR-017 (Unified Queue & Redis Scope)** | Async AI jobs use PostgreSQL `public.ai_requests` polled via `FOR UPDATE SKIP LOCKED` (`idx_ai_requests_queue`). Redis is used strictly for ephemeral TTL storage (24h `Idempotency-Key` store, OTP cooldowns, login lockouts, rate limits). |
| **ADR-018 (Mentor Chat Transport)** | `POST /api/v1/mentor/messages` (`EP-M03`) returns synchronous `201 Created` JSON (`MessageResponseDTO`, `< 10 s` target) by default; opt-in SSE streaming is supported when the client sends `Accept: text/event-stream`. |
| **ADR-019 (Backend Write Mediation & Alias Sync)** | All profile/preference writes route through NestJS (`service_role`). Resolving a skill alias via `EP-P05` atomically writes to `user_skill_aliases`, appends `skill_id` to `user_profiles.self_reported_skill_ids`, and defers level-scoped progress until a confirmed Career Level exists. |
| **ADR-020 (Local deletion/status)** | BEFORE DELETE atomically completes local deletion; request-scoped DeletionReceipt supports EP-X02 after cascade. Only returned status=completed is success;401 unconfirmed. |

---

# Part A — Preserved v1.4 Content (additive changes marked [v1.5+])

# 1. API Architecture Overview

## Core Architecture

- REST API architecture, `/api/v1` versioning, OpenAPI 3.0 compatible
- NestJS modular backend (modular monolith), TypeScript, Node.js
- Supabase Authentication (JWT Bearer)
- PostgreSQL 16+ on Supabase with Universal Row Level Security (50 tables)
- Redis 7+ ephemeral TTL store (24h `Idempotency-Key` cache, OTP cooldowns, login lockouts, rate limits per `ADR-017`)
- AI Gateway abstraction layer (Prompt Manager, Context Builder, Model Router, Provider Adapter on the **Vercel AI SDK**, Output Validator, Cost Tracker)

```text
Client Application (Next.js PWA)
        ↓
API Layer  (Controller → AccessGuard → Service → Domain Logic → Repository [service_role])
        ↓
Backend Modules
        ↓
Database (PostgreSQL 16+ / Redis 7+) / External Services
        ↓
AI Gateway (Vercel AI SDK)
```

**[v1.5+]** Module-to-path map (follows SAD §6):

| Module | Path prefix |
|-|-|
| Authentication / Account | `/auth`, `/account` |
| User Profile | `/profile` |
| Career Intelligence | `/career` |
| Roadmap | `/roadmaps` |
| Learning | `/learning` |
| Quiz | `/quiz` |
| Practice Review | `/practice-review` |
| Progress | `/progress` |
| Mentor | `/mentor` |
| Technology Update | `/technology-updates` |
| Feedback (ratings/reports), Jobs | `/ratings`, `/reports`, `/jobs` |
| Admin | `/admin` |
| Health (unversioned) | `/health` |

# 2. API Endpoint Contract Catalog (status)

| Module | v1.4 status | v1.5.1 status |
|-|-|-|
| Authentication & Account API | "Complete" (no contracts) | Contracts in §14.1 & §14.2 |
| User Profile API | "Complete" | §14.3 |
| Career Goal API | "Complete" | §14.4 |
| Roadmap API | "Complete" | §14.5 |
| Learning API | "Complete" | §14.6 |
| Quiz API | "Complete" | §14.7 |
| Practice Review API | "Complete" | §14.8 |
| Progress API | "Complete" | §14.9 |
| AI Mentor API | "Complete" | §14.10 |
| Technology Update API | "Complete" | §14.11 |
| Feedback & Jobs API | Not in v1.4 | §14.12 & §14.13 |
| Notification API | "Complete" | **Reserved — not in MVP** (§14.15) |
| Analytics API | "Complete" | Admin aggregate counts only (§14.14); rest reserved |
| Admin & Health API | "Complete" | §14.14 |
| File Management API | "Complete" | **Reserved — not in MVP** (§14.15) |
| Search API | "Complete" | **Reserved — not in MVP** (§14.15) |

# 3. API Security Implementation Specification

## Authentication

Provider: Supabase Auth. Protected requests carry `Authorization: Bearer <JWT>`.
JWT validation: signature, expiration, user existence, role.

## Authorization

```text
RBAC + Permission Checks + Resource Ownership Validation
```

Roles defined in v1.4: `USER`, `PLATFORM_ADMIN`, `CONTENT_ADMIN`, `AI_ADMIN`, `SUPER_ADMIN`.
**[v1.5+]** MVP assigns only `USER` and `PLATFORM_ADMIN`. The other three are reserved and must not be granted or checked in MVP code paths.

## Security Controls

JWT authentication · rate limiting · input validation · RLS · audit logging · security headers · AI data protection.

**[v1.5+] Effective-access evaluation order** (applied by `AccessGuard` on every protected route, in this order):

```text
1. JWT valid                         → else AUTH_REQUIRED / INVALID_TOKEN / TOKEN_EXPIRED
2. users.status = active             → else ACCOUNT_SUSPENDED (except routes marked AZ-SUSP)
3. Role matches route                → else PERMISSION_DENIED / ADMIN_REQUIRED
4. Global feature ON                 → else FEATURE_DISABLED
5. User feature ON (override)        → else FEATURE_DISABLED
6. Resource ownership                → else RESOURCE_NOT_FOUND (path lookup) / OWNERSHIP_REQUIRED (body reference)
```

System suspension overrides all feature permissions (PRD §7). Routes marked **AZ-SUSP** remain available to suspended users: logout, `/auth/me`, account deletion (`EP-X01`, `EP-X02`).

**[v1.5+] AI-security rules for contracts:** retrieved web pages, user profile text, chat input, and practice submissions are untrusted data (PRD §44). No endpoint accepts a client-supplied system prompt, provider, model name, or AI configuration. Real user data is sent only to a provider/model/tier whose data-handling and privacy terms are approved for that use (`ai_models.real_user_data_approved = true`, PRD v1.4.1 §47); free-tier or promotional access is limited to synthetic/non-sensitive validation. Admin has no endpoint that returns mentor message content, AI context, or raw quiz answers (PRD §51).

# 4. API Error Handling & Response Standard

## Success response

```json
{ "success": true, "data": {} }
```

## Error response

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "requestId": "uuid",
    "details": [ { "field": "confirm_password", "code": "PASSWORD_MISMATCH", "message": "Passwords do not match" } ],
    "retryable": false,
    "retryAfterSeconds": null
  }
}
```

**[v1.5+]** `details` (field-level errors, needed for PRD §8 field-level validation), `retryable`, and `retryAfterSeconds` (needed for PRD §46/§48 retryable errors and OTP cooldowns) are optional additive fields.

Standard categories: authentication, authorization, validation, resource, business-state, AI service, integration, database. Full list in §16.

**[v1.5+]** Message language: `message` is English for developers. The Bangla-first UI maps `error.code` to localized strings; the API never relies on parsing `message`.

# 5. API Versioning, Documentation & Developer Integration

- Current version `/api/v1`. Breaking changes require a new version; non-breaking changes stay in v1; deprecations require a migration path.
- Documentation: OpenAPI 3.0, Swagger, DTO descriptions, examples, error documentation.
- **[v1.5+]** Each DTO in §15 becomes one OpenAPI `components/schemas` entry with the same name. Each endpoint ID (e.g., `EP-R06`) is the OpenAPI `operationId` prefix.
- **[v1.5+]** Additive response fields are non-breaking. Clients must ignore unknown fields.

# 6. API Performance, Scalability & Reliability

| Category | Target |
|-|-|
| Standard APIs | < 300 ms |
| Complex APIs | < 1 s |
| AI APIs (Synchronous) | < 10 s |

**[v1.5+]** Applied as follows:

| Class | Endpoints | Behavior |
|-|-|-|
| Standard | CRUD/read endpoints | < 300 ms |
| Complex | `/learning/today`, `/progress`, `/admin/usage` | < 1 s |
| AI synchronous | `POST /mentor/messages`, `POST /career/goals`, `POST /career/goals/{id}/clarifications` | < 10 s target; hard timeout → `AI_TIMEOUT` (504, retryable) |
| AI asynchronous | roadmap generate/revision, merge proposal, quiz generate, practice review, topic content | **202 Accepted** + job in `public.ai_requests`; poll `GET /jobs/{id}`. Not bound by the 10 s target. |

# 7. API Deployment, Infrastructure & DevOps

Docker, CI/CD (GitHub Actions: lint → test → database reset & pgTAP suite → build → staging → approval → production), environment separation (Local / Development / Staging / Production), secret management, migrations (`000`–`020`), monitoring, rollback.

# 8. API Testing & Quality Assurance

Required: unit, integration, API contract, end-to-end, security, performance, AI feature testing. Gate: tests + security validation + performance validation = release approval.
**[v1.5+]** Endpoint-level test cases are in §17. AI tests cover English, Bangla, and mixed Bangla-English (PRD §56).

# 9. API Monitoring, Observability & Operations

Metrics, logs, traces; API health, DB performance, AI operations, infrastructure, security events. Health endpoint: `GET /health` (contract in §14.14).
**[v1.5+]** Every response carries `X-Request-Id`; the same value is returned as `error.requestId`.

# 10. API Data Privacy, Compliance & Governance

Principles: data minimization, user ownership, secure processing, consent management, controlled retention. AI must prevent private-data leakage, cross-user context leakage, and system-prompt exposure.

**[v1.5+] Retention applied to the API (PRD §52):**

| Data | Retention |
|-|-|
| Raw short free-response text | Up to 90 days (`quiz_answers.raw_text_expires_at`), then derived evidence only |
| Mentor messages | 90 days (`messages.expires_at`), purged independently of summarization; already-derived summaries remain |
| AI/operational logs | Up to 30 days (`ai_requests` purged at most 30 days from `created_at` per PRD §52; content-free provenance in `ai_generations` remains) |
| Account data | While the account exists; deleted per §14.2 |

**Note:** v1.4 mentioned "data export capability". PRD v1.4.1 has no export feature. No export endpoint is defined in MVP; it is listed as reserved in §14.15.

# 11. API Maintenance, Support & Long-Term Evolution

Ownership, change management, dependency updates, documentation updates, security and performance reviews. API changes require impact analysis, testing, documentation updates, and release approval.

# 12. Final Readiness Checklist (v1.4)

Retained for history. Superseded by §20 (Readiness Assessment).

---

# Part B — v1.5.1 Implementation Contract Layer

# 13. Global Contract Conventions

These conventions apply to every endpoint. Endpoint contracts reference them by code instead of repeating them.

## 13.1 Header profiles

| Code | Headers |
|-|-|
| **H-PUB** | `Content-Type: application/json` (bodies only). Optional `X-Request-Id: <uuid>`. No `Authorization`. |
| **H-AUTH** | `Authorization: Bearer <JWT>`, `Content-Type: application/json` (bodies only), optional `X-Request-Id`, optional `Accept-Language: bn\|en`. |
| **H-IDEM** | H-AUTH plus `Idempotency-Key: <uuid>` — **required**. Stored in Redis with 24 h TTL (`ADR-017`) and backed by `uq_ai_requests_idempotency` for AI jobs. Same key + same body within 24 h returns the original response; same key + different body returns `IDEMPOTENCY_KEY_REUSED` (409). |

Every response includes `X-Request-Id`. Rate-limited responses (429) include `Retry-After`.

## 13.2 Authorization profiles

| Code | Rule |
|-|-|
| **AZ-PUB** | No token. IP-based rate limits apply. |
| **AZ-SUSP** | Valid JWT, any user status (active or suspended). Role USER. |
| **AZ-USER** | Valid JWT, `users.status = active`, role USER (or ADMIN acting as own user), ownership validated. Feature gate applies where the endpoint names a **Feature key**. |
| **AZ-ADMIN** | Valid JWT, `users.status = active`, role ADMIN (`PLATFORM_ADMIN`), verified server-side against `public.admin_users`. Every write call is written to `public.admin_audit_logs`. |

Feature keys (used by `feature_controls` and `user_access_overrides`): `roadmap_generator`, `daily_plan`, `quiz_practice`, `ai_practice_review`, `progress_tracking`, `ai_mentor`, `technology_update`.
PRD §7: disabling a feature blocks **new generation** only; existing data stays readable. Contracts therefore mark each endpoint as **Gate: write** (blocked when disabled) or **Gate: none** (read of existing data always allowed).

## 13.3 Common errors (not repeated per endpoint)

| Applies to | Errors |
|-|-|
| All AZ-USER / AZ-ADMIN / AZ-SUSP | `AUTH_REQUIRED` 401, `INVALID_TOKEN` 401, `TOKEN_EXPIRED` 401, `RATE_LIMITED` 429, `INTERNAL_ERROR` 500, `SERVICE_UNAVAILABLE` 503 |
| All AZ-USER / AZ-ADMIN | `ACCOUNT_SUSPENDED` 403 |
| All endpoints with a body or params | `VALIDATION_FAILED` 422, `INVALID_FORMAT` 400, `INVALID_ENUM_VALUE` 422 |
| All AZ-ADMIN | `ADMIN_REQUIRED` 403 |
| Endpoints with **Gate: write** | `FEATURE_DISABLED` 403 |
| Path-id endpoints | `RESOURCE_NOT_FOUND` 404 (also returned when the resource belongs to another user) |

Each endpoint's **Errors** line lists only endpoint-specific codes. Meaning and resolution for every code are in §16.

## 13.4 Compact parameter notation

`name:type:req|opt — note`. Types: `uuid`, `string`, `int`, `bool`, `enum(...)`, `iso8601`, `date`.

## 13.5 Pagination

List endpoints accept `limit:int:opt (1–100, default 20)` and `cursor:string:opt`.

```json
{ "success": true, "data": [ ], "meta": { "limit": 20, "next_cursor": "opaque-or-null" } }
```

## 13.6 Asynchronous (Preparing) jobs (`ADR-017`)

Long AI work inserts a row into `public.ai_requests` (`is_async = true`, `status = 'queued'`), claimed by NestJS `PostgresJobQueueConsumer` via `FOR UPDATE SKIP LOCKED` on `idx_ai_requests_queue`, and returns:

```http
HTTP/1.1 202 Accepted
Location: /api/v1/jobs/{job_id}
```
```json
{ "success": true, "data": { "job_id": "uuid", "status": "preparing", "poll_url": "/api/v1/jobs/uuid", "retry_after_seconds": 3 } }
```

Poll `GET /jobs/{job_id}` (EP-J01). Job statuses: `queued`, `preparing`, `succeeded`, `failed`. On `succeeded` the job returns `result_ref` (resource type + id) for the client to fetch. On `failed` the job returns `error.code` and `retryable`. A failed job never leaves partial writes (PRD §48).

## 13.7 Enumerations

| Enum | Values |
|-|-|
| `career_level` | `junior`, `mid`, `senior` |
| `goal_status` | `clarifying`, `awaiting_confirmation`, `confirmed`, `discontinued` |
| `roadmap_status` | `draft`, `locked`, `archived` |
| `item_priority` | `core`, `supporting`, `optional` |
| `skill_gap_type` | `existing`, `transferable`, `refresh`, `strengthen`, `missing` |
| `merge_status` | `proposed`, `accepted`, `rejected`, `undone`, `superseded` |
| `merge_origin` | `user_request`, `level_change`, `ai_proposal` |
| `merge_op` | `add_topic`, `update_topic`, `reprioritize`, `reclassify`, `retire_topic` |
| `learning_state` | `not_started`, `learning`, `practicing`, `proficient` |
| `question_type` | `mcq`, `free_response` |
| `question_difficulty` | `basic`, `application`, `analysis` |
| `attempt_status` | `generated`, `started`, `submitted`, `ai_reviewed`, `feedback_available` |
| `performance_level` | `good`, `needs_work` |
| `plan_day_status` | `pending`, `in_progress`, `completed` |
| `today_status` | `ready`, `preparing`, `no_focus_roadmap`, `no_daily_plan`, `plan_completed` |
| `update_state` | `available`, `no_important_changes`, `temporarily_unavailable` |
| `release_status` | `released`, `announced`, `planned`, `experimental` |
| `action_timing` | `act_now`, `learn_later`, `awareness_only` |
| `relevance` | `high`, `medium`, `low` |
| `rating_target` | `roadmap_draft`, `roadmap_merge`, `topic_content`, `technology_update` |
| `report_target` | `quiz_question`, `practice_review`, `topic_content`, `roadmap_content` |
| `report_reason` | `incorrect`, `unclear`, `unfair_scoring`, `inappropriate`, `outdated`, `other` |
| `job_status` | `queued`, `preparing`, `succeeded`, `failed` |
| `user_status` | `active`, `suspended` |
| `verification_channel` | `email`, `phone` |
| `oauth_provider` | `google`, `facebook` |
| `message_role` | `user`, `assistant` |
| `ui_language` | `bn`, `en`, `mixed` |

## 13.8 State rules referenced by contracts

```text
Roadmap:  draft ──lock──▶ locked ──archive──▶ archived     (draft ──archive──▶ archived allowed)
Version:  every revision / accepted merge / undo creates or re-points an IMMUTABLE roadmap_versions row
Merge:    proposed ──accept──▶ accepted ──undo (once, before post-merge learning)──▶ undone
          proposed ──reject──▶ rejected
Attempt:  generated → started → submitted → ai_reviewed → feedback_available
Plan day: pending → in_progress → completed   (completed by quiz submission, any score)
```

Limits: max **3** non-archived roadmaps per user; exactly **0 or 1** Focus Roadmap (must be locked); max **1** open draft per roadmap; max **2** career-goal clarification rounds; **1** quiz retry per topic quiz; **1** undo per roadmap (most recent accepted merge only).

## 13.9 Idempotency and concurrency

H-IDEM endpoints: roadmap generate, revision, lock, merge create/accept/undo, daily plan create, quiz generate, quiz submit, quiz retry, account deletion. State-changing endpoints on versioned resources accept optional `If-Match: <version_no>`; mismatch → `STALE_VERSION` 409.

---

# 14. Complete Endpoint Implementation Contract Catalog

**Contract format.** Headers use profile codes (§13.1); authorization uses profile codes (§13.2); parameters use compact notation (§13.4); request/response field tables live in the DTO library (§15) and are referenced by DTO name; **Errors** lists endpoint-specific `CODE status`; shared errors are in §13.3. Database mapping uses **DMS v1.2.2** table names (all 50 tables).

## 14.1 Authentication API (Module: Authentication, `AuthController` → `AuthService` → `SupabaseAuthAdapter`)

### EP-A01 Register
- **POST** `/api/v1/auth/register` · **Auth:** none · **Headers:** H-PUB · **AZ:** AZ-PUB
- **Purpose:** Create an account by email or Bangladesh phone + password (PRD §8). Starts verification. First step of the registration journey.
- **Path/Query:** none
- **Request DTO:** `RegisterRequestDTO`
```json
{ "email": "rahim@example.com", "phone": null, "password": "S3cure!Pass", "confirm_password": "S3cure!Pass", "privacy_consent": true }
```
- **Response:** `201` `RegistrationPendingDTO`
```json
{ "success": true, "data": { "verification_channel": "email", "contact_masked": "r****@example.com", "expires_in_seconds": 600, "resend_available_at": "2026-10-10T08:01:00Z" } }
```
- **Validation:** exactly one of `email` / `phone`; email RFC-valid, lower-cased; phone matches Bangladesh mobile and is normalized to `+8801[3-9][0-9]{8}`; password policy (min 8, no all-numeric — numeric thresholds are configuration); `confirm_password` equals `password` (mismatch → `details[]` on `confirm_password`, nothing is created); `privacy_consent` must be `true`.
- **Business rules:** PRD §7 (anyone may register, no invite code, no approval), §8, §9, §10 (+880 normalization, per-number and per-IP OTP limits). Phone OTP sent via the SMS adapter (provider not fixed, SAD ADR-009). Unverified accounts cannot obtain a session.
- **DB:** `users`, `user_auth_providers` (created in unverified state). Rate/OTP counters in Redis ephemeral TTL keys (`ADR-017`).
- **Backend:** `AuthController.register`; `AuthService`, `SupabaseAuthAdapter`, `SmsAdapter`, `RateLimitGuard`.
- **Errors:** `CONTACT_ALREADY_REGISTERED 409`, `INVALID_PHONE_NUMBER 422`, `PASSWORD_POLICY_FAILED 422`, `OTP_LIMIT_EXCEEDED 429`, `SMS_PROVIDER_ERROR 502`, `EMAIL_PROVIDER_ERROR 502`

### EP-A02 Verify Email
- **POST** `/api/v1/auth/verify-email` · **Auth:** none (or JWT when verifying an added contact) · **Headers:** H-PUB / H-AUTH · **AZ:** AZ-PUB
- **Purpose:** Submit the email verification code; success establishes the authenticated session (PRD §9).
- **Request DTO:** `VerifyCodeRequestDTO` (`email` form)
```json
{ "email": "rahim@example.com", "code": "482913" }
```
- **Response:** `200` `AuthSessionDTO`
```json
{ "success": true, "data": { "access_token": "jwt", "refresh_token": "opaque", "expires_in": 3600, "token_type": "Bearer",
  "user": { "id": "uuid", "email": "rahim@example.com", "phone": null, "status": "active", "role": "USER" },
  "profile_complete": false, "next_step": "profile_setup" } }
```
- **Validation:** `code` is 6 digits; `email` valid.
- **Business rules:** PRD §9 (invalid, expired, resend, cooldown, rate limit). After success the user lands in general access; profile is **not** required for access (PRD §7). Same endpoint verifies an email added via EP-A12.
- **DB:** `users`, `user_auth_providers`, `user_profiles`, `user_preferences` (empty profile/preference rows created).
- **Backend:** `AuthController.verifyEmail`; `AuthService`, `SupabaseAuthAdapter`.
- **Errors:** `VERIFICATION_CODE_INVALID 422`, `VERIFICATION_CODE_EXPIRED 410`, `VERIFICATION_ATTEMPTS_EXCEEDED 429`, `ALREADY_VERIFIED 409`

### EP-A03 Verify Phone
- **POST** `/api/v1/auth/verify-phone` · **Headers:** H-PUB / H-AUTH · **AZ:** AZ-PUB
- **Purpose:** Submit the SMS OTP; success establishes the session (PRD §10). Also verifies a phone added via EP-A12.
- **Request DTO:** `VerifyCodeRequestDTO` (`phone` form)
```json
{ "phone": "+8801712345678", "code": "482913" }
```
- **Response:** `200` `AuthSessionDTO` (as EP-A02).
- **Validation / Business rules:** as EP-A02; phone normalized to `+880` form (PRD §10).
- **DB / Backend:** as EP-A02 plus `SmsAdapter` delivery status.
- **Errors:** as EP-A02.

### EP-A04 Resend Verification Code
- **POST** `/api/v1/auth/resend-verification` · **Headers:** H-PUB · **AZ:** AZ-PUB
- **Purpose:** Resend email code or SMS OTP.
- **Request DTO:** `ResendVerificationDTO`
```json
{ "channel": "phone", "contact": "+8801712345678" }
```
- **Response:** `200` `RegistrationPendingDTO`.
- **Validation:** `channel` enum `verification_channel`; `contact` must match channel format.
- **Business rules:** PRD §9–§10 cooldown and per-number / per-IP limits. Response is the same whether or not the contact exists (anti-enumeration).
- **DB / Backend:** Redis TTL counters (`ADR-017`); `AuthService`, `SmsAdapter`.
- **Errors:** `RESEND_COOLDOWN_ACTIVE 429` (with `retryAfterSeconds`), `OTP_LIMIT_EXCEEDED 429`, `SMS_PROVIDER_ERROR 502`, `EMAIL_PROVIDER_ERROR 502`

### EP-A05 Login
- **POST** `/api/v1/auth/login` · **Headers:** H-PUB · **AZ:** AZ-PUB
- **Purpose:** Password login by email or phone (PRD §8).
- **Request DTO:** `LoginRequestDTO`
```json
{ "identifier": "rahim@example.com", "password": "S3cure!Pass" }
```
- **Response:** `200` `AuthSessionDTO`. Suspended users **can** log in (so they can reach deletion); the DTO's `user.status` shows `suspended` and every feature route returns `ACCOUNT_SUSPENDED`.
- **Validation:** `identifier` is an email or a Bangladesh phone (normalized); `password` non-empty.
- **Business rules:** PRD §8 failed-login lockout, session expiry, rate limiting, clear error states. Error is `INVALID_CREDENTIALS` for both unknown user and wrong password.
- **DB:** `users` (`last_login_at`, `last_active_at`), `user_auth_providers`. Lockout counters in Redis (`ADR-017`).
- **Backend:** `AuthService`, `SupabaseAuthAdapter`, `RateLimitGuard`.
- **Errors:** `INVALID_CREDENTIALS 401`, `ACCOUNT_LOCKED 423` (with `retryAfterSeconds`), `UNVERIFIED_ACCOUNT 403`

### EP-A06 Logout
- **POST** `/api/v1/auth/logout` · **Auth:** JWT · **Headers:** H-AUTH · **AZ:** AZ-SUSP
- **Purpose:** Invalidate the current session/refresh token. No body.
- **Response:** `200` `{ "success": true, "data": { "logged_out": true } }`
- **Business rules:** PRD §53 logout. Idempotent.
- **DB / Backend:** Supabase session revocation via `SupabaseAuthAdapter`; no application table writes.
- **Errors:** none specific.

### EP-A07 Refresh Session
- **POST** `/api/v1/auth/refresh` · **Headers:** H-PUB · **AZ:** AZ-PUB
- **Purpose:** Exchange a refresh token for a new access token (session expiry handling, PRD §8).
- **Request DTO:** `RefreshTokenDTO`
```json
{ "refresh_token": "opaque" }
```
- **Response:** `200` `AuthSessionDTO` (rotated tokens).
- **Validation:** `refresh_token` non-empty string.
- **DB / Backend:** Supabase Auth; silent refresh does not update `users.last_active_at`; `AuthService`.
- **Errors:** `REFRESH_TOKEN_INVALID 401`, `SESSION_EXPIRED 401`

### EP-A08 Forgot Password (request code)
- **POST** `/api/v1/auth/forgot-password` · **Headers:** H-PUB · **AZ:** AZ-PUB
- **Purpose:** Send a reset code to the verified registered contact (PRD §8).
- **Request DTO:** `ForgotPasswordRequestDTO`
```json
{ "identifier": "+8801712345678" }
```
- **Response:** `202` `{ "success": true, "data": { "message": "If the account exists, a code was sent." } }` — identical for unknown accounts.
- **Business rules:** code goes to email for email accounts, SMS for phone accounts; cooldown and limits as EP-A04.
- **DB / Backend:** Redis TTL counters (`ADR-017`); `AuthService`, `SmsAdapter`.
- **Errors:** `RESEND_COOLDOWN_ACTIVE 429`, `OTP_LIMIT_EXCEEDED 429`

### EP-A09 Reset Password (confirm)
- **POST** `/api/v1/auth/reset-password` · **Headers:** H-PUB · **AZ:** AZ-PUB
- **Purpose:** Set a new password using the code.
- **Request DTO:** `ResetPasswordRequestDTO`
```json
{ "identifier": "rahim@example.com", "code": "482913", "new_password": "N3w!Passw0rd", "confirm_new_password": "N3w!Passw0rd" }
```
- **Response:** `200` `{ "success": true, "data": { "password_reset": true } }`. All existing sessions are revoked; the user logs in again.
- **Validation:** as register (policy, confirmation match); code 6 digits.
- **Errors:** `VERIFICATION_CODE_INVALID 422`, `VERIFICATION_CODE_EXPIRED 410`, `VERIFICATION_ATTEMPTS_EXCEEDED 429`, `PASSWORD_POLICY_FAILED 422`

### EP-A10 OAuth Session Bootstrap (Google / Facebook)
- **POST** `/api/v1/auth/oauth/session` · **Auth:** Supabase access token from the provider sign-in · **Headers:** H-AUTH · **AZ:** AZ-SUSP
- **Purpose:** After the client completes Google/Facebook sign-in with Supabase Auth, create or load the application user and return app state (PRD §8, §11).
- **Request DTO:** `OAuthSessionRequestDTO`
```json
{ "provider": "facebook" }
```
- **Response:** `200` `OAuthSessionResponseDTO` — `user`, `profile_complete`, `verified_contact_required` (true when Facebook gave no usable verified email, PRD §11), `next_step`.
- **Validation:** `provider` enum `oauth_provider` and must match the JWT's provider claim.
- **Business rules:** PRD §11–§12. Automatic linking only when a **verified** email confidently matches an existing verified identity and Supabase's secure linking permits it. Never merge on display name, unverified email, or phone-like metadata. While `verified_contact_required` is true, identity-sensitive operations (EP-A11, EP-X01 deletion confirmation) return `VERIFIED_CONTACT_REQUIRED`.
- **DB:** `users`, `user_auth_providers`, `user_profiles`, `user_preferences`.
- **Backend:** `AuthService.bootstrapOAuth`, `IdentityLinkingService`, `SupabaseAuthAdapter`.
- **Errors:** `PROVIDER_MISMATCH 422`, `IDENTITY_LINK_CONFLICT 409`

### EP-A11 Link Social Identity
- **POST** `/api/v1/auth/identities/link` · **Auth:** JWT · **Headers:** H-AUTH · **AZ:** AZ-USER (no feature gate)
- **Purpose:** An authenticated phone-only user links Google or Facebook from settings (PRD §12).
- **Request DTO:** `LinkIdentityRequestDTO`
```json
{ "provider": "google" }
```
- **Response:** `200` `{ "success": true, "data": { "linked_providers": ["phone","google"] } }`
- **Business rules:** must already be authenticated; linking never weakens authentication; refuses if the social identity already belongs to a different account.
- **DB:** `user_auth_providers`. **Backend:** `IdentityLinkingService`, `SupabaseAuthAdapter`.
- **Errors:** `IDENTITY_LINK_CONFLICT 409`, `VERIFIED_CONTACT_REQUIRED 403`, `PROVIDER_MISMATCH 422`

### EP-A12 Add Contact (email or phone)
- **POST** `/api/v1/auth/contact` · **Auth:** JWT · **Headers:** H-AUTH · **AZ:** AZ-USER (no feature gate)
- **Purpose:** Add and begin verification of a supported contact (e.g., Facebook user without email, PRD §11). Completion uses EP-A02 / EP-A03 with a JWT.
- **Request DTO:** `AddContactRequestDTO`
```json
{ "channel": "email", "contact": "rahim@example.com" }
```
- **Response:** `202` `RegistrationPendingDTO`.
- **Business rules:** PRD §11. Contact must not belong to another verified account.
- **DB:** `users`, `user_auth_providers`. **Backend:** `AuthService`, `SmsAdapter`.
- **Errors:** `CONTACT_ALREADY_REGISTERED 409`, `INVALID_PHONE_NUMBER 422`, `OTP_LIMIT_EXCEEDED 429`

### EP-A13 Current User and Effective Access
- **GET** `/api/v1/auth/me` · **Auth:** JWT · **Headers:** H-AUTH · **AZ:** AZ-SUSP
- **Purpose:** Bootstrap the client: identity, status, profile completeness, effective feature access, Focus Roadmap. Used on every app start.
- **Response:** `200` `MeResponseDTO`
```json
{ "success": true, "data": {
  "user": { "id": "uuid", "email": "rahim@example.com", "phone": null, "status": "active", "role": "USER", "linked_providers": ["email"], "verified_contact": true },
  "profile_complete": true, "focus_roadmap_id": "uuid",
  "effective_access": { "roadmap_generator": true, "daily_plan": true, "quiz_practice": true, "ai_practice_review": true, "progress_tracking": true, "ai_mentor": true, "technology_update": false },
  "can_delete_account": true } }
```
- **Business rules:** `effective_access` = system status AND global AND per-user (`private.effective_feature_access()`, PRD §7). When suspended, every flag is `false` and `can_delete_account` stays `true`.
- **DB:** `users`, `user_profiles`, `roadmaps`, `feature_controls`, `user_access_overrides`. **Backend:** `AccessService`.
- **Errors:** none specific.

## 14.2 Account API (Module: Authentication/Account, `AccountController` → `AccountDeletionService`)

### EP-X01 Request Account Deletion
- **POST** `/api/v1/account/deletion-requests` · **Auth:** JWT · **Headers:** H-IDEM · **AZ:** AZ-SUSP (**suspended users may delete**, PRD §7/§13)
- **Purpose:** In-app account deletion with explicit confirmation.
- **Request DTO:** `AccountDeletionRequestDTO`
```json
{ "confirmation": "DELETE", "password": "S3cure!Pass" }
```
- **Response:** `202` `AccountDeletionStatusDTO`
```json
{ "success": true, "data": { "id": "uuid", "status": "scheduled", "requested_at": "2026-10-10T08:00:00Z", "completed_at": null, "provider_deletion_requested": false, "deletion_receipt": "signed-request-scoped-receipt", "receipt_expires_at": "2026-10-11T08:00:00Z" } }
```
- **Validation:** `confirmation` equals the literal `DELETE`; `password` required for password accounts; OAuth-only accounts must re-authenticate (secure re-auth, PRD §8) and send `reauth_token` instead.
- **Business rules:** PRD §13 & `ADR-020`: creates a row in `public.account_deletion_requests` (`status = 'scheduled'`, `uq_account_deletion_one_active`). The deletion worker propagates external-provider deletion requests where applicable, deletes the user from `auth.users` (which cascades through `public.users` to all user-owned tables while preserving shared content and anonymized `admin_audit_logs` and `ai_generations`), while private.complete_deletion_on_user_delete() atomically completes the request in that Auth cascade transaction; its FK then sets user_id=NULL. **Suspension is not deletion.**
- **DB:** `public.account_deletion_requests` (`020_gaps_and_alignment.sql`), `auth.users` -> `public.users` cascade.
- **Backend:** `AccountController.requestDeletion`; `AccountDeletionService`, `SupabaseAuthAdapter`, deletion worker.
- **Errors:** `CONFIRMATION_MISMATCH 422`, `REAUTH_REQUIRED 401`, `DELETION_ALREADY_REQUESTED 409`, `VERIFIED_CONTACT_REQUIRED 403`

### EP-X02 Get Deletion Status
- **GET** `/api/v1/account/deletion-requests/current` · **Auth:** account JWT or DeletionReceipt · **Headers:** H-AUTH or Authorization: DeletionReceipt <receipt> · **AZ:** AZ-SUSP or route-scoped receipt
- **Purpose:** Show progress of the user's deletion request.
- **Response:** `200` `AccountDeletionStatusDTO` with valid account JWT or scoped DeletionReceipt, including completed null-owner tombstone. 401/404/network error is unconfirmed.
- **DB:** `public.account_deletion_requests` (`020_gaps_and_alignment.sql`). **Backend:** `AccountDeletionService`.

## 14.3 Profile API (Module: User Profile, `ProfileController` → `ProfileService` → `SkillResolutionService`)

Profile completeness (PRD §14) = current profession/role + experience level + existing skills (the explicit value **None** counts) + at least one confirmed active career goal + learning availability (daily hours) + learning preference + timezone. Profile completion is required **only** for roadmap generation (PRD §7). Per `ADR-019`, all profile writes route through this API via `service_role`.

### EP-P01 Get Profile
- **GET** `/api/v1/profile` · **Auth:** JWT · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Purpose:** Load profile and completeness for Profile Setup and Settings.
- **Response:** `200` `ProfileResponseDTO`
```json
{ "success": true, "data": {
  "current_role": "Frontend Developer", "education": "BSc CSE", "experience_level": "junior",
  "existing_skills": [ { "skill_id": "uuid", "name": "React", "alias_resolved": true, "learning_state": "learning", "source": "self_reported" } ],
  "existing_skills_none": false,
  "learning_preference": "hands_on", "preferred_daily_hours": 2, "timezone": "Asia/Dhaka", "timezone_detected": true,
  "active_career_goal_ids": ["uuid"], "profile_complete": false, "missing_fields": ["learning_preference"], "updated_at": "2026-10-10T08:00:00Z" } }
```
- **Business rules:** PRD §14. Raw profile free text is untrusted when sent to AI (PRD §44).
- **DB:** `user_profiles`, `user_preferences`, `skill_progress`, `skills`, `user_skill_aliases`, `career_goals`. **Backend:** `ProfileService`.
- **Errors:** none specific.

### EP-P02 Update Profile
- **PATCH** `/api/v1/profile` · **Auth:** JWT · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Purpose:** Create/update background and existing skills. Partial update; only sent fields change.
- **Request DTO:** `ProfileUpdateDTO`
```json
{ "current_role": "Frontend Developer", "education": "BSc CSE", "experience_level": "junior",
  "existing_skills": [ { "name": "React.js" }, { "name": "TypeScript" } ], "existing_skills_none": false }
```
- **Response:** `200` `ProfileResponseDTO` plus `unresolved_skills: [ { "input": "…", "candidates": [ {"skill_id":"uuid","name":"…"} ] } ]` when an alias is uncertain.
- **Validation:** strings trimmed, `current_role` ≤ 120 (`user_profiles.current_role_title`), `education` ≤ 200; `experience_level` enum `beginner|junior|mid|senior`; `existing_skills` ≤ 100 items; `existing_skills_none = true` requires an empty/absent `existing_skills` (conflict → `VALIDATION_FAILED`); each `name` ≤ 80.
- **Business rules:** PRD §14: **None is valid for a beginner and creates no artificial skills**. Self-reported skills display Learning context immediately; level-scoped skill_progress initializes only for confirmed goal levels and preserves stronger evidence. Aliases resolve against `skills`, validated `skill_aliases`, and the user's own `user_skill_aliases` (React = React.js; SQL ≠ MySQL, PRD §17). Uncertain aliases are returned in `unresolved_skills`; the user answers via EP-P05. Updated profile information influences future AI proposals and may trigger an optional AI merge proposal (never an automatic change).
- **DB:** `user_profiles`, `skills`, `skill_aliases`, `user_skill_aliases`, `skill_progress`, `learning_evidence`.
- **Backend:** `ProfileService`, `SkillResolutionService`.
- **Errors:** none specific beyond validation.

### EP-P03 Update Preferences
- **PATCH** `/api/v1/profile/preferences` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Purpose:** Learning preference.
- **Request DTO:** `ProfilePreferencesDTO`
```json
{ "learning_preference": "hands_on" }
```
- **Response:** `200` `ProfileResponseDTO`.
- **Validation:** `learning_preference` in `reading | hands_on | visual | mixed` (`ck_user_preferences_learning`).
- **DB:** `user_preferences`. **Backend:** `ProfileService`.

### EP-P04 Update Learning Settings
- **PATCH** `/api/v1/profile/learning-settings` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Purpose:** Timezone and preferred daily learning hours (PRD §14).
- **Request DTO:** `LearningSettingsDTO`
```json
{ "timezone": "Asia/Dhaka", "preferred_daily_hours": 2 }
```
- **Response:** `200` `ProfileResponseDTO`.
- **Validation:** `timezone` valid IANA id (`trg_user_profiles_validate_timezone`); `preferred_daily_hours` 0.5–12 in 0.5 steps (`ck_user_profiles_hours`).
- **Business rules:** timezone is auto-detected by the client and user-editable; it defines the local calendar day for Daily Technology Updates (PRD §39). Changing hours does **not** rebuild any Daily Plan; rebuild is explicit (EP-L03).
- **DB:** `user_profiles`. **Backend:** `ProfileService`.
- **Errors:** `INVALID_TIMEZONE 422`

### EP-P05 Answer Skill Alias Clarification
- **POST** `/api/v1/profile/skill-alias-interpretations` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Purpose:** Resolve an uncertain alias for this user only and synchronize their profile skills (PRD §17, `ADR-019`).
- **Request DTO:** `SkillAliasInterpretationDTO`
```json
{ "input": "node", "skill_id": "uuid" }
```
- **Response:** `201` `{ "success": true, "data": { "input": "node", "skill_id": "uuid", "scope": "user", "added_to_profile": true, "progress_initialization": "deferred_until_level_confirmation" } }`
- **Business rules:** PRD §17 & `ADR-019`: in a single transaction, `SkillResolutionService` (1) upserts the mapping into `public.user_skill_aliases` (user-scoped only; **never** automatically promoted to global `skill_aliases`), (2) appends `skill_id` to `user_profiles.self_reported_skill_ids` (if not already present and sets `existing_skills_none = false`), and (3) initializes Learning only for distinct confirmed goal levels, or returns progress_initialization=deferred_until_level_confirmation before any confirmed level exists; preserve stronger evidence and supply state_reason. A candidate row may optionally be queued in `skill_aliases` with `status = 'candidate'` for separate validation.
- **DB:** `public.user_skill_aliases` (`020_gaps_and_alignment.sql`), `public.user_profiles`, `public.skill_progress`, `public.skills`. **Backend:** `SkillResolutionService`.
- **Errors:** `SKILL_NOT_FOUND 404`

## 14.4 Career Goal API (Module: Career Intelligence, `CareerGoalController` → `CareerGoalService` → AI Gateway)

PRD §15: any technology-related goal; up to **two** clarification rounds; after round two the AI proposes its best interpretation and the user confirms; each confirmed goal maps to one canonical role. Non-technology goals are out of scope.

### EP-C01 Create Career Goal
- **POST** `/api/v1/career/goals` · **Auth:** JWT · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** write (`roadmap_generator`)
- **Purpose:** Submit a free-text goal; AI interprets it. Synchronous (short AI call, 10 s target; `AI_TIMEOUT` is retryable).
- **Request DTO:** `CareerGoalCreateDTO`
```json
{ "goal_text": "Backend developer, mainly Node.js" }
```
- **Response:** `201` `CareerGoalResponseDTO`
```json
{ "success": true, "data": { "id": "uuid", "goal_text": "Backend developer, mainly Node.js", "status": "awaiting_confirmation",
  "clarification_round": 0, "clarification_question": null,
  "proposed_role": { "canonical_role_id": "uuid", "name": "Backend Development" }, "suggested_level": "junior", "target_level": null,
  "roadmap_id": null, "created_at": "2026-10-10T08:00:00Z" } }
```
When ambiguous: `status: "clarifying"`, `clarification_round: 1`, `clarification_question` populated, `proposed_role: null`.
- **Validation:** `goal_text` 3–300 chars; treated as untrusted text.
- **Business rules:** PRD §15, §3 (technology boundary), §44. The AI may suggest a level; the user confirms it later (EP-C05).
- **DB:** `career_goals`, `career_roles`, `ai_requests`, `ai_generations`.
- **Backend:** `CareerGoalService`, AI Gateway (`goal_interpretation`), `OutputValidator`.
- **Errors:** `OUT_OF_SCOPE_GOAL 422`, `ROADMAP_LIMIT_REACHED 409`, `AI_TIMEOUT 504`, `AI_SERVICE_ERROR 502`, `AI_VALIDATION_FAILED 502`

### EP-C02 List Career Goals
- **GET** `/api/v1/career/goals` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Query:** `status:enum(goal_status):opt`, `limit`, `cursor`
- **Response:** `200` array of `CareerGoalResponseDTO` + `meta`. **DB:** `career_goals`. **Backend:** `CareerGoalService`.

### EP-C03 Get Career Goal
- **GET** `/api/v1/career/goals/{id}` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Path:** `id:uuid:req`. **Response:** `200` `CareerGoalResponseDTO`. **DB:** `career_goals`.

### EP-C04 Answer Clarification
- **POST** `/api/v1/career/goals/{id}/clarifications` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** write
- **Purpose:** Answer the AI's clarification question.
- **Request DTO:** `GoalClarificationDTO`
```json
{ "answer": "Server-side APIs, not DevOps" }
```
- **Response:** `200` `CareerGoalResponseDTO`. After round 2 the status becomes `awaiting_confirmation` with the AI's best supported interpretation (PRD §15).
- **Validation:** `answer` 1–300 chars; goal status must be `clarifying`.
- **DB:** `career_goals`, `ai_requests`, `ai_generations`. **Backend:** `CareerGoalService`, AI Gateway.
- **Errors:** `INVALID_STATE_TRANSITION 409`, `CLARIFICATION_LIMIT_REACHED 409`, `AI_TIMEOUT 504`, `AI_SERVICE_ERROR 502`

### EP-C05 Confirm Goal and Career Level
- **POST** `/api/v1/career/goals/{id}/confirm` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** write
- **Purpose:** The user confirms the interpreted role and the target Career Level (PRD §18).
- **Request DTO:** `GoalConfirmDTO`
```json
{ "canonical_role_id": "uuid", "target_level": "mid" }
```
- **Response:** `200` `CareerGoalResponseDTO` (`status: confirmed`).
- **Validation:** `canonical_role_id` must equal `proposed_role_id` or an element of `alternative_role_ids`; `target_level` enum `public.career_level` (`junior`, `mid`, `senior`).
- **Business rules:** PRD §16 (max 3 active roadmaps; each confirmed goal has its own roadmap), §18. Counts toward the 3-goal limit at confirmation.
- **DB:** `career_goals`, `career_roles`. **Backend:** `CareerGoalService`.
- **Errors:** `INVALID_STATE_TRANSITION 409`, `ROADMAP_LIMIT_REACHED 409`, `ROLE_MISMATCH 422`

### EP-C06 Edit Unconfirmed Goal
- **PATCH** `/api/v1/career/goals/{id}` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** write
- **Purpose:** Reword a goal **before** confirmation. A confirmed goal's text is never edited; a different goal means discontinue + create new; a level change uses the merge flow (EP-R08).
- **Request DTO:** `CareerGoalCreateDTO`. **Response:** `200` `CareerGoalResponseDTO` (re-interpreted, round reset).
- **Errors:** `GOAL_ALREADY_CONFIRMED 409`, `AI_TIMEOUT 504`, `AI_SERVICE_ERROR 502`

### EP-C07 Discontinue Career Goal
- **DELETE** `/api/v1/career/goals/{id}` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Purpose:** Discontinue a goal. If it has a roadmap, that roadmap is archived (PRD §22) through the same service as EP-R15.
- **Response:** `200`
```json
{ "success": true, "data": { "id": "uuid", "status": "discontinued", "archived_roadmap_id": "uuid", "new_focus_roadmap_id": "uuid-or-null" } }
```
- **Business rules:** history, evidence, progress, and Daily Plan history are retained. If the archived roadmap was Focus, another active **locked** roadmap becomes Focus automatically, else none (PRD §22).
- **DB:** `career_goals`, `roadmaps`, `daily_plans`. **Backend:** `CareerGoalService`, `RoadmapService.archive`.
- **Errors:** none specific.

## 14.5 Roadmap API (Module: Roadmap, `RoadmapController` → `RoadmapService` → `RoadmapDraftService`, `RoadmapMergeService`, AI Gateway, `RoadmapValidator`)

Core product module. Invariants enforced here: max **3** non-archived roadmaps (`trg_roadmaps_limit`); one Focus Roadmap (`uq_roadmaps_one_focus`, locked only); AI never changes a locked roadmap silently; versions are immutable (`trg_roadmap_versions_guard`); one open draft per roadmap (`uq_roadmap_versions_one_draft`); AI output is validated before storage.

### EP-R01 Generate Roadmap Draft
- **POST** `/api/v1/roadmaps/generate` · **Auth:** JWT · **Headers:** H-IDEM · **AZ:** AZ-USER · **Gate:** write (`roadmap_generator`)
- **Purpose:** Create a Draft Roadmap for a confirmed career goal and level. Starts the roadmap journey after Profile Setup.
- **Request DTO:** `GenerateRoadmapRequestDTO`
```json
{ "career_goal_id": "uuid", "target_level": "mid", "level_confirmed": true }
```
- **Response:** `202` job (§13.6). On success the job's `result_ref` is `{ "type": "roadmap", "id": "uuid" }` and `GET /roadmaps/{id}` returns the draft (`RoadmapResponseDTO`, `status: draft`, version 1).
- **Validation:** `career_goal_id` UUID, goal `confirmed` and owned; `target_level` enum and equal to the confirmed goal level; `level_confirmed` must be `true`.
- **Business rules:** PRD §7 (profile completion required **here**), §16, §18–§21, §23. Draft is a proposal the user reviews; the user does not edit structure directly. AI uses shared career knowledge where available and fresh web research where current information matters; no unsupported market statistics; effort estimates are guidance, not promises. Shared knowledge validated structurally, for consistency, product rules, and source grounding (PRD §23).
- **DB:** `roadmaps`, `roadmap_versions`, `roadmap_items`, `skill_dependencies`, `skills`, `topics`, `career_roles`, `ai_requests`, `ai_generations`, `prompt_versions`, `ai_models`.
- **Backend:** `RoadmapController.generate`; `RoadmapDraftService`, `ContextBuilder`, AI Gateway, `RoadmapValidator`, `PostgresJobQueueConsumer`.
- **Errors:** `PROFILE_INCOMPLETE 422` (`details[]` lists missing fields), `GOAL_NOT_CONFIRMED 409`, `ROADMAP_LIMIT_REACHED 409`, `ROADMAP_EXISTS_FOR_GOAL 409`, `LEVEL_NOT_CONFIRMED 422`, `AI_GENERATION_FAILED` / `AI_VALIDATION_FAILED` (surface via the job as `retryable: true`)

### EP-R02 List Roadmaps
- **GET** `/api/v1/roadmaps` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Query:** `status:enum(roadmap_status):opt`, `limit`, `cursor`
- **Response:** `200` array of `RoadmapSummaryDTO` (`id, career_goal_id, role_name, target_level, status, is_focus, current_version_no, has_open_draft, has_open_merge, has_daily_plan, stale_draft`) + `meta`.
- **DB:** `roadmaps`, `roadmap_versions`, `daily_plans`, `roadmap_merges`. **Backend:** `RoadmapService`.

### EP-R03 Get Roadmap
- **GET** `/api/v1/roadmaps/{id}` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Path:** `id:uuid:req`. **Query:** `version:string:opt` — `current` (default: locked version, else open draft), `draft`, or an integer version number.
- **Response:** `200` `RoadmapResponseDTO`
```json
{ "success": true, "data": {
  "id": "uuid", "status": "locked", "is_focus": true, "career_goal_id": "uuid", "role_name": "Backend Development", "target_level": "mid", "version_no": 3,
  "summary": { "current_situation": "…", "target_interpretation": "…", "expected_career_impact": "…", "next_steps": ["…"] },
  "phases": [ { "phase_no": 1, "title": "HTTP & API fundamentals", "milestones": [ { "id": "uuid", "title": "Build a REST API" } ],
    "items": [ { "item_id": "uuid", "topic_id": "uuid", "skill_id": "uuid", "title": "REST API design", "priority": "core", "gap_type": "missing",
      "required_depth": "production API design", "estimated_effort_hours": 12, "depends_on": ["uuid"], "reason": "…", "retired": false,
      "sources": [ { "publisher": "MDN", "url": "https://…" } ] } ] } ],
  "level_outline": [ { "career_level": "senior", "outline": ["…"] } ],
  "warnings": [], "stale": false, "locked_at": "2026-10-10T08:30:00Z", "created_at": "2026-10-10T08:00:00Z" } }
```
- **Business rules:** the selected level has detailed content; other levels appear only as a light `level_outline` (PRD §18). `item_id` maps to `roadmap_items.lineage_id`. `retired` topics are hidden from the active path but kept in history. Effort values are guidance only.
- **DB:** `roadmaps`, `roadmap_versions`, `roadmap_items`, `skills`, `topics`. **Backend:** `RoadmapService`.
- **Errors:** `VERSION_NOT_FOUND 404`

### EP-R04 Request Draft Revision
- **POST** `/api/v1/roadmaps/{id}/revision` · **Headers:** H-IDEM · **AZ:** AZ-USER · **Gate:** write
- **Purpose:** Ask the AI to change an **open draft** before lock; also used to refresh a stale draft (PRD §21).
- **Path:** `id:uuid:req`
- **Request DTO:** `RevisionRequestDTO`
```json
{ "instruction": "Add more on testing and remove GraphQL", "refresh_stale": false }
```
- **Response:** `202` job; result is a new draft version of the same roadmap. The previous draft version is marked `superseded` and stays immutable.
- **Validation:** `instruction` 3–1000 chars, untrusted; at least one of `instruction` / `refresh_stale=true`.
- **Business rules:** only one open draft per roadmap; locked roadmaps use merges, not revisions.
- **DB:** `roadmap_versions`, `roadmap_items`, `ai_requests`, `ai_generations`. **Backend:** `RoadmapDraftService`, AI Gateway, `RoadmapValidator`.
- **Errors:** `ROADMAP_LOCKED 409`, `NO_OPEN_DRAFT 409`, `STALE_VERSION 409`, `AI_GENERATION_FAILED`/`AI_VALIDATION_FAILED` via job

### EP-R05 Lock Roadmap (accept draft)
- **POST** `/api/v1/roadmaps/{id}/lock` · **Headers:** H-IDEM · **AZ:** AZ-USER · **Gate:** write
- **Purpose:** Accept the draft; the roadmap becomes the stable source for its Daily Plan.
- **Request DTO:** `LockRoadmapDTO`
```json
{ "version_no": 2, "acknowledge_stale": false }
```
- **Response:** `200`
```json
{ "success": true, "data": { "roadmap_id": "uuid", "status": "locked", "version_no": 2, "is_focus": true, "next_step": "confirm_learning_hours", "preferred_daily_hours": 2 } }
```
- **Validation:** `version_no` must be the current open draft version.
- **Business rules:** PRD §21. Lock is final for that version. If a stale warning exists and `acknowledge_stale` is false → `DRAFT_STALE`. If the user has no Focus Roadmap, this roadmap becomes Focus; otherwise Focus is retained (assumption A1). The client then asks the user to confirm learning hours and calls EP-L02 (PRD §14, §27). The lock does **not** create the Daily Plan.
- **DB:** `roadmaps`, `roadmap_versions`. **Backend:** `RoadmapService.lock`.
- **Errors:** `NO_OPEN_DRAFT 409`, `STALE_VERSION 409`, `DRAFT_STALE 409`, `ROADMAP_LOCKED 409`, `INVALID_STATE_TRANSITION 409`

### EP-R06 List Roadmap Versions
- **GET** `/api/v1/roadmaps/{id}/versions` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Response:** `200` array of `RoadmapVersionDTO` (`version_no, state(draft|locked|superseded|restored), created_by(user_request|ai|merge|undo), merge_id, created_at`) + `meta`. **DB:** `roadmap_versions`, `roadmap_merges`.

### EP-R07 Get Roadmap Version
- **GET** `/api/v1/roadmaps/{id}/versions/{version_no}` · **Path:** `id:uuid:req`, `version_no:int:req`
- **Response:** `200` `RoadmapResponseDTO` for that immutable version. **Errors:** `VERSION_NOT_FOUND 404`.

### EP-R08 Create Merge Proposal (user-requested)
- **POST** `/api/v1/roadmaps/{id}/merges` · **Headers:** H-IDEM · **AZ:** AZ-USER · **Gate:** write
- **Purpose:** Ask the AI to change a **locked** roadmap — add/strengthen/re-prioritize/retire topics or change Career Level (PRD §18, §21).
- **Request DTO:** `MergeRequestDTO`
```json
{ "origin": "level_change", "target_level": "senior", "instruction": "I want to move to Senior" }
```
- **Response:** `202` job; `result_ref` `{ "type": "roadmap_merge", "id": "uuid" }`; fetch with EP-R10.
- **Validation:** `origin` is `user_request` or `level_change` (`ai_proposal` is system-created only); `level_change` requires `target_level` ≠ current; `user_request` requires `instruction` 3–1000 chars.
- **Business rules:** a request **never** edits the roadmap directly. A level change preserves valid evidence and does not archive the roadmap. Only one proposal may be open per roadmap (`uq_roadmap_merges_one_open`).
- **DB:** `roadmap_merges`, `roadmap_merge_items`, `ai_requests`, `ai_generations`, `learning_evidence` and `skill_progress` (read). **Backend:** `RoadmapMergeService`, AI Gateway, `RoadmapValidator`.
- **Errors:** `ROADMAP_NOT_LOCKED 409`, `MERGE_ALREADY_PROPOSED 409`, `LEVEL_UNCHANGED 422`, `AI_GENERATION_FAILED`/`AI_VALIDATION_FAILED` via job

### EP-R09 List Merge Proposals
- **GET** `/api/v1/roadmaps/{id}/merges` · **Query:** `status:enum(merge_status):opt`, `limit`, `cursor`
- **Response:** `200` array of `MergeProposalSummaryDTO` (`id, origin, status, created_at, undo_available`) + `meta`. Includes AI-originated proposals (`origin: ai_proposal`).

### EP-R10 Get Merge Proposal
- **GET** `/api/v1/roadmaps/{id}/merges/{merge_id}` · **Path:** `id:uuid:req`, `merge_id:uuid:req`
- **Response:** `200` `MergeProposalDTO`
```json
{ "success": true, "data": { "id": "uuid", "roadmap_id": "uuid", "origin": "ai_proposal", "status": "proposed", "base_version_no": 3,
  "reason": "New LTS runtime release affects your Node.js topics", "operations": [
    { "op": "add_topic", "topic_id": "uuid", "title": "Node.js permission model", "priority": "supporting", "reason": "…" },
    { "op": "retire_topic", "item_id": "uuid", "reason": "No longer recommended" } ],
  "size_impact": { "active_topics_before": 38, "active_topics_after": 52, "materially_large": true, "warning": "This proposal adds 14 topics." },
  "daily_plan_impact": { "future_days_affected": 9, "completed_days_unchanged": 12 }, "undo_available": false } }
```
- **Business rules:** PRD §20–§21: large expansions (`active_topics_after > roadmap.soft_size_max_topics`) carry a warning and require acknowledgement at accept. Daily Technology Updates never modify the roadmap; at most they lead to a proposal.

### EP-R11 Accept Merge
- **POST** `/api/v1/roadmaps/{id}/merges/{merge_id}/accept` · **Headers:** H-IDEM · **AZ:** AZ-USER · **Gate:** write
- **Request DTO:** `MergeAcceptDTO`
```json
{ "base_version_no": 3, "acknowledge_large_expansion": true }
```
- **Response:** `200` `{ "success": true, "data": { "roadmap_id": "uuid", "new_version_no": 4, "undo_available": true, "daily_plan_reconciled": true } }`
- **Business rules:** one transaction: close any prior accepted merge's `undo_window_closed_at`; create a new immutable `roadmap_versions` row; preserve completed items, evidence, skill progress, and completed Daily Plan days; reconcile **only future incomplete** plan days (`reconciled_by_merge_id = merge_id`); snapshot previous version pointer and previous future-plan state in `roadmap_merges.undo_snapshot` for Undo (PRD §21). Roadmap changes **only after** this explicit acceptance.
- **DB:** `roadmap_merges`, `roadmap_merge_items`, `roadmap_versions`, `roadmap_items`, `roadmaps`, `daily_plans`, `daily_plan_items`.
- **Backend:** `RoadmapMergeService.accept`, `DailyPlanReconciler`.
- **Errors:** `MERGE_NOT_PENDING 409`, `STALE_VERSION 409`, `MERGE_EXPANSION_ACK_REQUIRED 409`, `ROADMAP_NOT_LOCKED 409`

### EP-R12 Reject Merge
- **POST** `/api/v1/roadmaps/{id}/merges/{merge_id}/reject` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Response:** `200` `{ merge_id, status: "rejected" }`. Roadmap unchanged. **Errors:** `MERGE_NOT_PENDING 409`.

### EP-R13 Undo Last Merge
- **POST** `/api/v1/roadmaps/{id}/merges/undo` · **Headers:** H-IDEM · **AZ:** AZ-USER · **Gate:** none
- **Purpose:** One-step undo of the most recently accepted merge.
- **Response:** `200` `{ "restored_version_no": 3, "merge_id": "uuid", "status": "undone" }`
- **Business rules:** PRD §21: restores the previous locked-roadmap state **and** the previous future-incomplete Daily Plan state from `undo_snapshot`; completed history is never rewritten; available only while `undo_window_closed_at IS NULL` (trigger `trg_quiz_attempts_close_undo` automatically sets `undo_window_closed_at = now()` as soon as the user starts a quiz on a post-merge plan item). After that, any change needs a new merge. New evidence is always preserved.
- **DB:** `roadmaps`, `roadmap_versions`, `roadmap_merges`, `daily_plans`, `daily_plan_items`.
- **Backend:** `RoadmapMergeService.undo`, `DailyPlanReconciler`.
- **Errors:** `UNDO_NOT_AVAILABLE 409` (no accepted merge, or post-merge learning has started)

### EP-R14 Set Focus Roadmap
- **POST** `/api/v1/roadmaps/{id}/focus` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Purpose:** Choose which locked roadmap drives Today (PRD §16).
- **Response:** `200` `FocusSwitchResponseDTO`
```json
{ "success": true, "data": { "focus_roadmap_id": "uuid", "daily_plan": { "state": "existing", "plan_id": "uuid", "requires_learning_hours": false } } }
```
For a roadmap without a plan: `{ "state": "missing", "plan_id": null, "requires_learning_hours": true|false }` — `true` only when the profile has no `preferred_daily_hours`.
- **Business rules:** clears `is_focus = false` on the old Focus row first, then sets `is_focus = true` on the target row in one transaction. The previous Focus roadmap's plan, evidence, and progress are preserved untouched. The selected roadmap's existing plan resumes. If none exists, the client calls EP-L02 (asking for hours first if `requires_learning_hours`).
- **DB:** `roadmaps`, `daily_plans`, `user_profiles`. **Backend:** `RoadmapService.setFocus`.
- **Errors:** `ROADMAP_NOT_LOCKED 409`, `ROADMAP_ARCHIVED 409`

### EP-R15 Archive Roadmap
- **POST** `/api/v1/roadmaps/{id}/archive` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Purpose:** Archive a roadmap when its career goal is replaced/discontinued (PRD §22). Level changes and topic changes must use merges, **not** archive.
- **Response:** `200` `{ archived_roadmap_id, new_focus_roadmap_id }` (as EP-C07; the goal becomes `discontinued`).
- **Business rules:** history, shared skill evidence, and Daily Plan history are retained; archived evidence can still count toward other active roadmaps.
- **Errors:** `ROADMAP_ARCHIVED 409`

## 14.6 Learning API (Module: Learning, `LearningController` → `DailyPlanService`, `TodayService`, `TopicContentService`)

A Daily Plan belongs to a **locked roadmap** and exists independently of Focus status. Plan days are sequential units, not calendar appointments; missed days skip nothing (PRD §27). No endpoint marks a day complete: **quiz submission** does (PRD §33).

### EP-L01 Get Daily Plan
- **GET** `/api/v1/learning/daily-plan` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Query:** `roadmap_id:uuid:opt` (default: Focus Roadmap), `limit`, `cursor` (paginate days)
- **Response:** `200` `DailyPlanResponseDTO`
```json
{ "success": true, "data": { "plan_id": "uuid", "roadmap_id": "uuid", "is_focus": true, "hours_per_day": 2, "roadmap_version_no": 4,
  "next_incomplete_day_no": 13, "total_days": 60, "completed_days": 12,
  "days": [ { "day_no": 13, "status": "pending", "topics": [ { "plan_item_id": "uuid", "topic_id": "uuid", "title": "SQL joins" } ], "completed_at": null } ] },
  "meta": { "limit": 20, "next_cursor": "opaque" } }
```
- **DB:** `daily_plans`, `daily_plan_items`, `topics`. **Backend:** `DailyPlanService`.
- **Errors:** `DAILY_PLAN_NOT_FOUND 404`, `NO_FOCUS_ROADMAP 404` (when `roadmap_id` omitted and no Focus)

### EP-L02 Create Daily Plan
- **POST** `/api/v1/learning/daily-plans` · **Headers:** H-IDEM · **AZ:** AZ-USER · **Gate:** write (`daily_plan`)
- **Purpose:** Build the sequence of learning days for a locked roadmap after the user confirms hours (PRD §27). Also used after Focus switching when no plan exists. Deterministic scheduling from roadmap effort estimates; **no AI call**, so it is synchronous.
- **Request DTO:** `CreateDailyPlanDTO`
```json
{ "roadmap_id": "uuid", "hours_per_day": 2 }
```
- **Response:** `201` `DailyPlanResponseDTO`.
- **Validation:** roadmap owned and `locked`; `hours_per_day` 0.5–12 in 0.5 steps; required (no silent default).
- **Business rules:** PRD §14: hours are pre-filled from the profile, editable here, and **saved back to `user_profiles.preferred_daily_hours`**. One plan per roadmap (`uq_daily_plans_roadmap`). Retired topics are excluded; completed roadmap items are not scheduled again.
- **DB:** `daily_plans`, `daily_plan_items`, `roadmap_items`, `user_profiles`. **Backend:** `DailyPlanService.create`.
- **Errors:** `ROADMAP_NOT_LOCKED 409`, `DAILY_PLAN_EXISTS 409`, `LEARNING_HOURS_REQUIRED 422`

### EP-L03 Rebuild Daily Plan
- **POST** `/api/v1/learning/daily-plans/{id}/rebuild` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** write
- **Path:** `id:uuid:req`. **Request DTO:** `RebuildDailyPlanDTO`
```json
{ "hours_per_day": 1.5 }
```
- **Response:** `200` `DailyPlanResponseDTO`.
- **Business rules:** PRD §27: rebuild never changes the roadmap and never rewrites completed days; only future incomplete days are re-sequenced. A day with an in-progress quiz is kept. Saves hours to `user_profiles.preferred_daily_hours`.
- **DB:** `daily_plans`, `daily_plan_items`, `user_profiles`. **Backend:** `DailyPlanService.rebuild`.
- **Errors:** `LEARNING_HOURS_REQUIRED 422`, `ROADMAP_ARCHIVED 409`

### EP-L04 Get Today
- **GET** `/api/v1/learning/today` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none for existing content; generating missing shared content requires `daily_plan` ON
- **Purpose:** Today's learning unit from the Focus Roadmap's next incomplete plan day (PRD §28).
- **Response:** `200` `TodayResponseDTO`
```json
{ "success": true, "data": { "status": "ready", "roadmap_id": "uuid", "plan_id": "uuid", "plan_day": { "day_no": 13, "total_days": 60 },
  "topic": { "topic_id": "uuid", "title": "SQL joins", "career_level": "mid", "content_version": 2,
    "explanation_markdown": "…", "important_questions": [ { "question": "…", "answer_markdown": "…" } ],
    "sources": [ { "publisher": "PostgreSQL Docs", "url": "https://…" } ], "rating_allowed": true, "report_allowed": true },
  "quiz": { "attempt_id": "uuid-or-null", "status": "started", "can_retry": false }, "job": null } }
```
When content is not ready: `status: "preparing"`, `job: { "job_id": "uuid", "poll_url": "…" }`. Other statuses: `no_focus_roadmap`, `no_daily_plan` (with `requires_learning_hours`), `plan_completed`.
- **Business rules:** shared topic content is reused by canonical topic + Career Level + approved content version; generated only if missing (or hidden by reports) and by an approved provider/model, with provider and model retained server-side in `ai_generations` for traceability (PRD §30, §47). Mixed Bangla/English wording is allowed; technical terms may stay English.
- **DB:** `daily_plan_items`, `topics`, `learning_resources`, `quizzes`, `quiz_attempts`, `ai_requests`, `ai_generations`. **Backend:** `TodayService`, `TopicContentService`, AI Gateway.
- **Errors:** none specific (states are returned in `status`).

### EP-L05 List Topics
- **GET** `/api/v1/learning/topics` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Query:** `roadmap_id:uuid:opt` (default Focus), `priority:enum(item_priority):opt`, `learning_state:enum(learning_state):opt`, `limit`, `cursor`
- **Response:** `200` array of `TopicSummaryDTO` (`topic_id, title, skill_id, priority, career_level, learning_state, plan_day_no`) + `meta`. Only topics in the user's own roadmaps. **DB:** `roadmap_items`, `topics`, `skill_progress`.

### EP-L06 Get Topic
- **GET** `/api/v1/learning/topics/{id}` · **Path:** `id:uuid:req` · **Gate:** none
- **Response:** `200` `TopicDetailDTO` (as `topic` object in EP-L04 plus `learning_state`, `required_depth`). **Errors:** `RESOURCE_NOT_FOUND 404` if the topic is not in one of the user's roadmaps.

### EP-L07 List Learning Resources
- **GET** `/api/v1/learning/resources` · **Query:** `topic_id:uuid:req`, `limit`, `cursor` · **Gate:** none
- **Response:** `200` array of `LearningResourceDTO` (`id, title, publisher, url, resource_type, retrieved_at`) + `meta`. Only attribution links; the product does not host courses (PRD §58). **DB:** `learning_resources`.

## 14.7 Quiz API (Module: Quiz, `QuizController` → `QuizService`, `QuizGradingService`, AI Gateway)

Standard quiz: 20 MCQ + 5–10 short free-response; smaller only when the topic cannot support it (`is_reduced = true`, PRD §29). Questions span `basic`, `application`, `analysis`. **I don't know** is a valid answer. No code-execution sandbox. A generated quiz never expires and survives app closure (PRD §33). Answer keys (`quiz_questions.correct_option_id`, `rubric`) are never sent before submission.

### EP-Q01 Generate (or fetch) Quiz Attempt
- **POST** `/api/v1/quiz/generate` · **Headers:** H-IDEM · **AZ:** AZ-USER · **Gate:** write (`quiz_practice`)
- **Request DTO:** `QuizGenerateDTO`
```json
{ "daily_plan_item_id": "uuid" }
```
- **Response:** `200` `QuizAttemptDTO` if an attempt already exists for this plan item (resume); `201` if shared quiz content exists and a new attempt was created; `202` job if content must be generated first (`result_ref` `{type:"quiz_attempt", id}`).
- **Validation:** plan item belongs to the user, in an unarchived locked roadmap's plan, and is the next incomplete day **or** an already-started day.
- **Business rules:** PRD §30: shared content keyed by canonical topic + Career Level + approved content version (`variant_no = 1`), retained with provider and model traceability in `ai_generations` (server-side); not regenerated per user. Untrusted retrieved material is never executed as instructions (PRD §44).
- **DB:** `quizzes`, `quiz_questions`, `quiz_attempts`, `ai_requests`, `ai_generations`, `daily_plan_items`. **Backend:** `QuizService.generate`, `ContextBuilder`, AI Gateway, `OutputValidator`.
- **Errors:** `PLAN_ITEM_NOT_AVAILABLE 409`, `AI_GENERATION_FAILED`/`AI_VALIDATION_FAILED` via job

### EP-Q02 Get Quiz Attempt (resume)
- **GET** `/api/v1/quiz/{id}` · **Path:** `id:uuid:req` · **Gate:** none
- **Response:** `200` `QuizAttemptDTO`
```json
{ "success": true, "data": { "attempt_id": "uuid", "status": "started", "attempt_no": 1, "topic_id": "uuid", "career_level": "mid",
  "questions": [
    { "question_id": "uuid", "type": "mcq", "difficulty": "basic", "prompt": "…", "options": [ { "option_id": "a", "text": "…" } ], "allow_i_dont_know": true },
    { "question_id": "uuid", "type": "free_response", "difficulty": "analysis", "prompt": "Write a SQL query that…", "response_hint": "sql", "max_length": 4000, "allow_i_dont_know": true } ],
  "saved_answers": [ { "question_id": "uuid", "selected_option_id": "a", "text": null, "i_dont_know": false } ], "submitted_at": null } }
```
- **DB:** `quiz_attempts`, `quiz_questions`, `quiz_answers`. **Backend:** `QuizService`.

### EP-Q03 Start Quiz
- **POST** `/api/v1/quiz/{id}/start` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** write
- **Response:** `200` `QuizAttemptDTO` (`status: started`). Idempotent if already started. Starting a quiz on a post-merge plan day (`reconciled_by_merge_id IS NOT NULL`) automatically closes the Undo window for that roadmap via trigger `trg_quiz_attempts_close_undo` (PRD §21).
- **Errors:** `INVALID_STATE_TRANSITION 409` (already submitted)

### EP-Q04 Save Answers (autosave)
- **PATCH** `/api/v1/quiz/{id}/answers` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** write
- **Purpose:** Persist progress so the user can resume after closing the app or a network failure (PRD §33, §54).
- **Request DTO:** `QuizAnswersPatchDTO`
```json
{ "answers": [ { "question_id": "uuid", "selected_option_id": "b" }, { "question_id": "uuid", "text": "SELECT …" }, { "question_id": "uuid", "i_dont_know": true } ] }
```
- **Response:** `200` `{ "saved": 3, "saved_at": "iso8601" }`
- **Validation:** each answer references a question in `quiz_attempts.question_ids`; MCQ answers need `selected_option_id` valid for that question; free text ≤ `max_length` (Bangla, English, and mixed accepted); `i_dont_know` excludes the other fields (`ck_quiz_answers_idk`); ≤ 40 answers per call.
- **DB:** `quiz_answers`. **Backend:** `QuizService.saveAnswers`.
- **Errors:** `QUIZ_NOT_STARTED 409`, `QUIZ_ALREADY_SUBMITTED 409`, `QUESTION_NOT_IN_QUIZ 422`

### EP-Q05 Submit Quiz
- **POST** `/api/v1/quiz/{id}/submit` · **Headers:** H-IDEM · **AZ:** AZ-USER · **Gate:** write
- **Request DTO:** `QuizSubmissionDTO`
```json
{ "answers": [ { "question_id": "uuid", "selected_option_id": "b" } ], "confirm_unanswered": true }
```
`answers` is optional when everything was already saved with EP-Q04; submitted answers overwrite saved ones.
- **Response:** `202` (free-response present) or `200` (MCQ-only) `QuizSubmitResponseDTO`
```json
{ "success": true, "data": { "attempt_id": "uuid", "status": "submitted", "mcq_score": { "correct": 15, "total": 20 },
  "plan_day_unlocked": true, "next_plan_day_no": 14, "review_job_id": "uuid" } }
```
- **Validation:** at least one response (including **I don't know**) is required (`NO_ANSWERS_SUBMITTED`); unanswered questions need `confirm_unanswered = true`.
- **Business rules:** PRD §33: submission unlocks the next plan day **regardless of score** (`daily_plan_items.status = 'completed'`, `completed_at = now()`). MCQs are graded from the stored answer key immediately. Free-response review runs asynchronously (AI Practice Review, EP-PR). Junk/empty/irrelevant free-response is flagged (`review_status = 'not_evidence'`, `evidence_eligible = false`) and produces **no** learning evidence (PRD §31). Learning evidence and skill state are updated by the internal `EvidenceService`, never by the client (PRD §35).
- **DB:** `quiz_attempts`, `quiz_answers`, `practice_reviews`, `daily_plan_items`, `learning_evidence`, `skill_progress`, `ai_requests`. **Backend:** `QuizService.submit`, `QuizGradingService`, `PracticeReviewService`, `EvidenceService`, `DailyPlanService.markDayCompleted`.
- **Errors:** `QUIZ_NOT_STARTED 409`, `QUIZ_ALREADY_SUBMITTED 409`, `NO_ANSWERS_SUBMITTED 422`, `UNANSWERED_CONFIRMATION_REQUIRED 422`

### EP-Q06 Get Quiz Result
- **GET** `/api/v1/quiz/{id}/result` · **Gate:** none
- **Purpose:** Score, correct answers, explanations, AI feedback, performance level, recommendations (PRD §32).
- **Response:** `200` `QuizResultDTO`
```json
{ "success": true, "data": { "attempt_id": "uuid", "status": "feedback_available", "attempt_no": 1,
  "mcq_score": { "correct": 15, "total": 20 }, "performance_level": "needs_work",
  "questions": [ { "question_id": "uuid", "type": "mcq", "your_answer": "b", "correct_answer": "c", "is_correct": false, "explanation": "…", "reportable": true },
                 { "question_id": "uuid", "type": "free_response", "practice_review_id": "uuid", "review_status": "reviewed", "reportable": true } ],
  "improvement_recommendations": ["Review INNER vs LEFT JOIN"],
  "progress_change": { "skill_id": "uuid", "career_level": "mid", "from": "learning", "to": "practicing", "reason": "Consistent recent understanding across two attempts" },
  "retry_available": true } }
```
When review is still running: `status: "submitted"`, free-response items show `review_status: "pending"`; MCQ results are already present.
- **Business rules:** correct answers appear only after submission. Wording avoids "Job Ready" and employment promises (PRD §36). Result is a learning review, not a formal assessment.
- **DB:** `quiz_attempts`, `quiz_answers`, `quiz_questions`, `practice_reviews`, `learning_evidence`, `skill_progress`.
- **Errors:** `QUIZ_NOT_SUBMITTED 409`

### EP-Q07 Retry Quiz
- **POST** `/api/v1/quiz/{id}/retry` · **Headers:** H-IDEM · **AZ:** AZ-USER · **Gate:** write
- **Response:** `201` `QuizAttemptDTO` (new attempt, `attempt_no: 2`, `retry_of_attempt_id`), or `202` job if new MCQs (`variant_no = 2`) must be generated.
- **Business rules:** PRD §32: one retry per topic quiz (`ck_quiz_attempts_no`); new MCQs generated or selected; free-response prompts may be reused; both attempts' evidence is retained; improvement may influence progress. Retry does not re-lock or re-open plan days.
- **DB:** `quiz_attempts`, `quizzes` (`variant_no = 2`), `quiz_questions`, `ai_requests`.
- **Errors:** `QUIZ_NOT_SUBMITTED 409`, `RETRY_LIMIT_REACHED 409`

## 14.8 Practice Review API (Module: Practice Review, `PracticeReviewController` → `PracticeReviewService` → AI Gateway)

AI Practice Review is feedback on submitted short free-response answers. It is **not** a formal assessment (PRD §31). There is no standalone "submit practice" endpoint; submission happens through the quiz.

### EP-PR01 List Reviews for an Attempt
- **GET** `/api/v1/practice-review` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Query:** `quiz_attempt_id:uuid:req`
- **Response:** `200` array of `PracticeReviewSummaryDTO` (`id, question_id, review_status(pending|reviewed|failed|not_evidence), performance_level`). **DB:** `practice_reviews`.

### EP-PR02 Get Review Feedback
- **GET** `/api/v1/practice-review/{id}/feedback` · **Path:** `id:uuid:req` · **Gate:** none
- **Response:** `200` `PracticeFeedbackDTO`
```json
{ "success": true, "data": { "id": "uuid", "question_id": "uuid", "review_status": "reviewed", "performance_level": "needs_work",
  "dimensions": { "correctness": "partial", "understanding": "good", "reasoning": "weak" },
  "strengths": ["Correct join key"], "mistakes": ["Missing GROUP BY"], "weaknesses": ["Aggregation"], "improvement_recommendations": ["Practice GROUP BY with HAVING"],
  "evidence_eligible": true, "reportable": true } }
```
- **Business rules:** review uses a task-specific rubric; feedback is understandable to the learner; junk/non-attempt answers return `review_status: "not_evidence"` with `evidence_eligible: false`. Raw text in `quiz_answers.answer_text` is retained up to 90 days (PRD §52); derived feedback in `practice_reviews` stays.
- **DB:** `practice_reviews`, `ai_generations`. **Backend:** `PracticeReviewService`.

### EP-PR03 Trigger / Retry Review
- **POST** `/api/v1/practice-review/{id}/review` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** write (`ai_practice_review`)
- **Purpose:** Re-run a review whose AI job failed (PRD §48: retryable). Idempotent.
- **Response:** `202` job (`result_ref` `{type:"practice_review", id}`); `200` if already `reviewed` (no re-run).
- **Validation:** only `pending` or `failed` reviews; raw text in `quiz_answers.answer_text` must still exist (`raw_text_purged_at IS NULL`).
- **DB:** `practice_reviews`, `quiz_answers`, `ai_requests`, `ai_generations`. **Backend:** `PracticeReviewService.review`, AI Gateway, `OutputValidator`.
- **Errors:** `REVIEW_NOT_RETRYABLE 409`, `RAW_RESPONSE_EXPIRED 410`, `AI_GENERATION_FAILED`/`AI_VALIDATION_FAILED` via job

## 14.9 Progress API (Module: Progress, `ProgressController` → `ProgressService`, `EvidenceService`)

States: `not_started`, `learning`, `practicing`, `proficient`, tracked per **skill × Career Level × roadmap/topic context**. A 90% score is an internal heuristic only and is never exposed as a pass/fail threshold (PRD §35). Lower-level Proficient never auto-grants higher-level Proficient (PRD §18).

### EP-G01 Get Progress
- **GET** `/api/v1/progress` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Query:** `roadmap_id:uuid:opt` (default Focus), `career_level:enum:opt`, `learning_state:enum:opt`, `limit`, `cursor`
- **Response:** `200` `ProgressResponseDTO`
```json
{ "success": true, "data": { "roadmap_id": "uuid", "career_level": "mid",
  "roadmap_progress": { "items_total": 38, "items_completed": 11 },
  "skills": [ { "skill_id": "uuid", "name": "SQL", "career_level": "mid", "learning_state": "practicing", "shared_with_roadmap_ids": ["uuid"],
    "weak_area": false, "last_evidence_at": "2026-10-09T12:00:00Z", "state_reason": "Recent quizzes show consistent understanding of joins." } ],
  "weak_areas": [ { "skill_id": "uuid", "name": "Indexing", "reason": "Two recent attempts rated needs_work" } ] } }
```
- **Business rules:** shared skill evidence may count across roadmaps; the response explains why a state changed (`state_reason`, PRD §35); copy never says "Job Ready" or promises employment.
- **DB:** `skill_progress`, `learning_evidence`, `roadmap_items`, `skills`. **Backend:** `ProgressService`.

### EP-G02 Get Skill Progress Detail
- **GET** `/api/v1/progress/skills/{skill_id}` · **Path:** `skill_id:uuid:req` · **Query:** `career_level:enum:opt`
- **Response:** `200` `SkillProgressDetailDTO` (per level state, evidence summary counts, retry improvement, roadmap-specific depth requirements, `state_reason`). No raw answer text. **DB:** `skill_progress`, `learning_evidence`, `roadmap_items`.

### EP-G03 Get Progress History
- **GET** `/api/v1/progress/history` · **Query:** `skill_id:uuid:opt`, `from:iso8601:opt`, `to:iso8601:opt`, `limit`, `cursor`
- **Response:** `200` array of `ProgressHistoryItemDTO` (`occurred_at, skill_id, career_level, event(state_change|evidence_added), from_state, to_state, reason, source(quiz_attempt|practice_review), source_id`) + `meta`. **DB:** `achievement_history`, `learning_evidence`, `skill_progress`.

### EP-G04 Record Evidence — INTERNAL (not an HTTP endpoint)
- **Not exposed.** Replaces the requested `POST /progress/evidence` (§0.3). Called only by `QuizService` and `PracticeReviewService` through `EvidenceService.record(EvidenceDTO)`.
- **Rules:** junk/non-attempt answers are rejected; a mentor statement "I studied this" is stored as conversation context only (PRD §37); the service writes evidence, recomputes state using repeated and recent evidence (never one score alone), and appends to `achievement_history`.
- **DB:** `learning_evidence`, `skill_progress`, `achievement_history`.

## 14.10 AI Mentor API (Module: Mentor, `MentorController` → `MentorService`, `ContextBuilder`, AI Gateway)

Scope: technology-career and learning guidance only (PRD §37). Context is built from the user's own profile, Focus Roadmap, current topic, and conversation **summaries** — never the full history and never another user's data. Retrieved/chat text is untrusted.

### EP-M01 Create Conversation
- **POST** `/api/v1/mentor/conversations` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** write (`ai_mentor`)
- **Request DTO:** `ConversationCreateDTO`
```json
{ "context_type": "topic", "topic_id": "uuid" }
```
- **Response:** `201` `ConversationDTO` (`id, context_type, roadmap_id, topic_id, title, created_at`).
- **Validation:** `context_type` enum `focus_roadmap|topic|general`; `topic_id` required for `topic` and must be in the user's roadmap.
- **Business rules:** opens with Focus Roadmap / current-topic context where appropriate (PRD §37).
- **DB:** `conversations`, `ai_context_records`. **Backend:** `MentorService`.
- **Errors:** `NO_FOCUS_ROADMAP 409` (for `focus_roadmap` context)

### EP-M02 List Conversations
- **GET** `/api/v1/mentor/conversations` · **Gate:** none · **Query:** `limit`, `cursor` · **Response:** `200` array of `ConversationDTO` + `meta`. Own conversations only. **DB:** `conversations`.

### EP-M03 Send Message
- **POST** `/api/v1/mentor/messages` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** write (`ai_mentor`)
- **Request DTO:** `MessageRequestDTO`
```json
{ "conversation_id": "uuid", "content": "Backend এ কোন database আগে শেখা উচিত?", "client_message_id": "uuid" }
```
- **Response (`ADR-018`):** Default MVP response is synchronous `201 Created` (`Content-Type: application/json`, `< 10 s` target) returning `MessageResponseDTO`:
```json
{ "success": true, "data": { "user_message_id": "uuid", "assistant_message": { "id": "uuid", "role": "assistant",
  "content": "শুরুতে PostgreSQL দিয়ে SQL শেখাটা ভালো কারণ…", "language": "bn", "created_at": "2026-10-10T08:05:00Z" },
  "safety_mode": false, "learning_claim_recorded": false } }
```
*(Opt-in SSE streaming mode per `ADR-018`: if the client sends `Accept: text/event-stream`, the server chunks only the validated committed reply, then emits message.completed with MessageResponseDTO).*
- **Validation:** `content` 1–4000 chars; `client_message_id` de-duplicates retries (`uq_messages_client_message`: same id returns the original reply); conversation owned by caller.
- **Business rules:** PRD §26 language behavior: Bangla in → Bangla out, English in → English out, mixed in → natural mixed; technical terms may stay English. "I studied this" is stored as conversational context with `learning_claim_recorded: true` and is **not** evidence (PRD §37). Serious personal distress or safety concerns → `safety_mode: true`: a safe response that does not pretend to give professional care and redirects appropriately. The assistant never guarantees employment or says "Job Ready". Admin cannot read this content (PRD §51).
- **DB:** `messages`, `conversations`, `conversation_summaries`, `ai_context_records`, `ai_requests`, `ai_generations`. **Backend:** `MentorService.send`, `ContextBuilder`, AI Gateway (prompt manager, output validator, cost tracker).
- **Errors:** `CONVERSATION_NOT_FOUND 404`, `AI_TIMEOUT 504` (retryable; user message is saved), `AI_SERVICE_ERROR 502`, `AI_VALIDATION_FAILED 502`, `AI_BUDGET_EXHAUSTED 503`

### EP-M04 Get History
- **GET** `/api/v1/mentor/history` · **Gate:** none
- **Query:** `conversation_id:uuid:req`, `limit`, `cursor`
- **Response:** `200` array of `MessageDTO` (`id, role, content, language, created_at`) + `meta`. Own messages only; messages older than 90 days are no longer returned (PRD §52). **Errors:** `CONVERSATION_NOT_FOUND 404`.

## 14.11 Technology Update API (Module: Technology Update, `TechnologyUpdateController` → `TechnologyUpdateService`)

Updates are generated by an hourly timezone-aware scheduled background job (`15 * * * *`, not on app open), at most one per eligible user per local calendar day, using fresh external sources. Eligibility = account active + global ON + user ON + active in the last 7 days (PRD §39). The API only **reads** stored updates. Users cannot toggle their own access (default OFF; admin-controlled).

**Gate for this module is on read as well:** the feature itself is access-controlled (PRD §7, §38); with the feature OFF for the user, all three endpoints return `FEATURE_DISABLED`.

### EP-T01 List Technology Updates
- **GET** `/api/v1/technology-updates` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** read (`technology_update`)
- **Query:** `limit`, `cursor`
- **Response:** `200` `TechnologyUpdateListDTO`
```json
{ "success": true, "data": { "today_state": "available", "generation_pending": false, "message": null, "items": [ {
  "id": "uuid", "local_date": "2026-10-10", "title": "PostgreSQL minor release adds …",
  "what_changed": "…", "why_it_matters": "…", "publisher": "PostgreSQL Global Development Group", "source_url": "https://…", "fetched_at": "2026-10-10T02:10:00Z",
  "release_status": "released", "relevance": "high", "action_timing": "learn_later", "roadmap_relation": "Relates to your SQL topics", "viewed": false } ] },
  "meta": { "limit": 20, "next_cursor": null } }
```
`today_state` values (`update_state`): `available`; `no_important_changes` with `message: "No important changes for your current learning path today."`; `temporarily_unavailable` with `message: "Technology updates are temporarily unavailable."`.
- **Business rules:** PRD §40–§45. The API never fabricates a "today" update from stale model knowledge. Duplicates are suppressed via `technology_updates.content_hash` and `uq_update_delivery_user_update`. Updates are informational and never modify a locked roadmap; a significant one may lead to a separate merge proposal (EP-R10, `origin: ai_proposal`).
- **DB:** `technology_updates`, `user_update_relevance`, `update_delivery_history`, `technology_sources`. **Backend:** `TechnologyUpdateService`.

### EP-T02 Get Technology Update
- **GET** `/api/v1/technology-updates/{id}` · **Path:** `id:uuid:req` · **Response:** `200` single item as above (only if delivered to the caller). **Errors:** `RESOURCE_NOT_FOUND 404`.

### EP-T03 Mark Update Viewed
- **POST** `/api/v1/technology-updates/{id}/view` · **Headers:** H-AUTH · **Gate:** read
- **Response:** `200` `{ "id": "uuid", "viewed": true, "viewed_at": "iso8601" }`. Idempotent. **DB:** `update_delivery_history`. Rating uses EP-F01 (`rating_target = technology_update`).

## 14.12 Feedback API — Ratings and Reports (Module: Quality Feedback, `FeedbackController` → `FeedbackService`)

### EP-F01 Submit Rating (1–5)
- **POST** `/api/v1/ratings` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Purpose:** Rate approved targets only (PRD §24): roadmap draft quality, roadmap merge quality, shared topic learning content, technology-update usefulness.
- **Request DTO:** `RatingRequestDTO`
```json
{ "target_type": "technology_update", "target_id": "uuid", "score": 4, "comment": "Useful" }
```
- **Response:** `200` `{ "target_type": "…", "target_id": "uuid", "score": 4 }`. One rating per user per target (upsert on `uq_user_ratings_user_target`).
- **Validation:** `target_type` enum `rating_target`; `score` int 1–5; `comment` ≤ 500; target must be visible to the user. Quiz questions, AI Practice Review, and mentor replies are **not** ratable (use Reports; mentor has none).
- **DB:** `public.user_ratings` (`020_gaps_and_alignment.sql`). **Backend:** `FeedbackService`.
- **Errors:** `TARGET_NOT_RATABLE 422`, `TARGET_NOT_FOUND 404`

### EP-F02 Submit Report
- **POST** `/api/v1/reports` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Purpose:** Challenge a quiz question, questionable AI Practice Review scoring, or shared content (PRD §24, §32).
- **Request DTO:** `ReportRequestDTO`
```json
{ "target_type": "practice_review", "target_id": "uuid", "reason": "unfair_scoring", "comment": "My answer was correct" }
```
- **Response:** `201` `{ "report_id": "uuid", "status": "received" }`
- **Validation:** enums `report_target`, `report_reason`; `comment` ≤ 1000; target must have been shown to the caller; one report per user per target (`uq_content_reports_user_target` → `REPORT_ALREADY_SUBMITTED`).
- **Business rules:** a single user can never redefine shared content. Trigger `trg_content_reports_threshold` (`private.evaluate_content_report_threshold()`) counts independent user reports against `quality.report_auto_hide_threshold` in `public.system_configurations` and automatically hides shared `topics` or `quiz_questions` until regenerated/revalidated; the threshold is never revealed to clients. Reports on one's own review feed Bangla-scoring quality monitoring.
- **DB:** `public.content_reports`, `public.topics`, `public.quiz_questions`, `public.system_configurations` (`020_gaps_and_alignment.sql`). **Backend:** `FeedbackService`, `SharedContentQualityService`.
- **Errors:** `TARGET_NOT_FOUND 404`, `REPORT_ALREADY_SUBMITTED 409`

## 14.13 Jobs API (Module: Platform, `JobsController` → `JobService`)

### EP-J01 Get Job Status
- **GET** `/api/v1/jobs/{id}` · **Headers:** H-AUTH · **AZ:** AZ-USER · **Gate:** none
- **Path:** `id:uuid:req` (job must belong to the caller)
- **Response:** `200` `JobStatusDTO`
```json
{ "success": true, "data": { "job_id": "uuid", "kind": "roadmap_generate", "status": "succeeded",
  "result_ref": { "type": "roadmap", "id": "uuid" }, "error": null, "retryable": false, "created_at": "iso8601", "finished_at": "iso8601" } }
```
Failed: `"status": "failed", "error": { "code": "AI_VALIDATION_FAILED", "message": "…" }, "retryable": true`.
- **Business rules:** job `kind` (`job_kind`) ∈ `career_goal`, `roadmap_generate`, `roadmap_revision`, `merge_proposal`, `topic_content`, `quiz_generate`, `practice_review`. A failed job leaves no partial writes; the user's draft/lock/plan/quiz/progress state is unchanged (PRD §46, §48). Clients poll at `retry_after_seconds`.
- **DB:** `public.ai_requests` (`010_ai_operations.sql`). **Backend:** `JobService`.
- **Errors:** `JOB_NOT_FOUND 404`

## 14.14 Admin API and Health (Module: Admin, `AdminController` → `AdminUserService`, `FeatureControlService`, `AuditService`, `UsageService`)

All admin endpoints: **Auth** JWT · **Headers** H-AUTH · **AZ** AZ-ADMIN. Admin role is verified server-side against `public.admin_users` (PRD §50). Every write call writes `public.admin_audit_logs` (actor, action, target, before/after, request id). **There is no endpoint that returns mentor messages, raw practice answers, or AI context** (PRD §51).

### EP-AD01 List Users
- **GET** `/api/v1/admin/users` · **Query:** `q:string:opt` (email/phone fragment or user id), `status:enum(user_status):opt`, `limit`, `cursor`
- **Response:** `200` array of `AdminUserSummaryDTO` (`id, contact_masked, status, created_at, last_active_at, roadmap_count, technology_update_enabled`) + `meta`. **DB:** `users`, `user_profiles`, `user_access_overrides`, `roadmaps`.

### EP-AD02 Get User
- **GET** `/api/v1/admin/users/{id}` · **Path:** `id:uuid:req`
- **Response:** `200` `AdminUserDetailDTO`: summary + `feature_access: [ { feature_key, global_enabled, user_override: true|false|null, effective } ]` + aggregate counts only (roadmaps, quizzes submitted, mentor message **count**, AI request count). **DB:** `users`, `feature_controls`, `user_access_overrides`.

### EP-AD03 Suspend / Reactivate User
- **PATCH** `/api/v1/admin/users/{id}` · **Request DTO:** `AdminUserStatusDTO`
```json
{ "status": "suspended", "reason": "Abuse of AI endpoints" }
```
- **Response:** `200` `AdminUserDetailDTO`.
- **Validation:** `status` enum `user_status`; `reason` 3–300 chars required.
- **Business rules:** PRD §7: suspension blocks normal features, feature permissions cannot override it, data is preserved, the user can still reach account deletion, and reactivation restores everything subject to current global status. **Suspension is not deletion.**
- **DB:** `users`, `admin_audit_logs`. **Backend:** `AdminUserService`.
- **Errors:** `CANNOT_MODIFY_ADMIN 403`, `STATUS_UNCHANGED 409`

### EP-AD04 List Global Features
- **GET** `/api/v1/admin/features` · **Response:** `200` array of `FeatureControlDTO` (`feature_key, enabled, updated_at, updated_by`). **DB:** `feature_controls`.

### EP-AD05 Set Global Feature
- **PATCH** `/api/v1/admin/features` · **Request DTO:** `FeatureToggleDTO`
```json
{ "feature_key": "technology_update", "enabled": true }
```
- **Response:** `200` `FeatureControlDTO`. **Validation:** `feature_key` in the §13.2 list. **Business rules:** disabling blocks new generation for all users but deletes no data (PRD §7). **DB:** `feature_controls`, `admin_audit_logs`. **Errors:** `UNKNOWN_FEATURE 422`.

### EP-AD06 Set Per-User Feature Access
- **PATCH** `/api/v1/admin/users/{id}/features` · **Request DTO:** `UserFeatureToggleDTO`
```json
{ "feature_key": "technology_update", "enabled": true }
```
- **Response:** `200` `AdminUserDetailDTO`. `enabled: null` removes the override row in `user_access_overrides`.
- **Business rules:** effective access = system status AND global AND user (`private.effective_feature_access()`, PRD §7). Defaults: every feature ON per user **except `technology_update`, which is OFF by default** for new users (`default_user_enabled = false`, PRD §7). A user override never beats a global OFF or a suspension.
- **DB:** `user_access_overrides`, `admin_audit_logs`. **Errors:** `UNKNOWN_FEATURE 422`.

### EP-AD07 List Audit Logs
- **GET** `/api/v1/admin/audit-logs` · **Query:** `actor_id:uuid:opt`, `target_user_id:uuid:opt`, `action:string:opt`, `from:iso8601:opt`, `to:iso8601:opt`, `limit`, `cursor`
- **Response:** `200` array of `AuditLogDTO` (`id, actor_id, action, target_type, target_id, before, after, request_id, created_at`) + `meta`. Read-only; tamper-proof (`trg_admin_audit_logs_append_only`). **DB:** `admin_audit_logs`.

### EP-AD08 Aggregate Usage Counts
- **GET** `/api/v1/admin/usage` · **Query:** `from:date:opt`, `to:date:opt`, `group_by:enum(day|feature|provider):opt`
- **Response:** `200` `UsageSummaryDTO`
```json
{ "success": true, "data": { "range": { "from": "2026-10-01", "to": "2026-10-10" }, "series": {"group_by": "day", "buckets": [{"key": "2026-10-01", "requests": 0, "estimated_cost_usd": 0, "failures": 0, "fallbacks_used": 0, "input_units": 0, "output_units": 0}, {"key": "2026-10-02", "requests": 0, "estimated_cost_usd": 0, "failures": 0, "fallbacks_used": 0, "input_units": 0, "output_units": 0}, {"key": "2026-10-03", "requests": 0, "estimated_cost_usd": 0, "failures": 0, "fallbacks_used": 0, "input_units": 0, "output_units": 0}, {"key": "2026-10-04", "requests": 0, "estimated_cost_usd": 0, "failures": 0, "fallbacks_used": 0, "input_units": 0, "output_units": 0}, {"key": "2026-10-05", "requests": 0, "estimated_cost_usd": 0, "failures": 0, "fallbacks_used": 0, "input_units": 0, "output_units": 0}, {"key": "2026-10-06", "requests": 0, "estimated_cost_usd": 0, "failures": 0, "fallbacks_used": 0, "input_units": 0, "output_units": 0}, {"key": "2026-10-07", "requests": 0, "estimated_cost_usd": 0, "failures": 0, "fallbacks_used": 0, "input_units": 0, "output_units": 0}, {"key": "2026-10-08", "requests": 0, "estimated_cost_usd": 0, "failures": 0, "fallbacks_used": 0, "input_units": 0, "output_units": 0}, {"key": "2026-10-09", "requests": 0, "estimated_cost_usd": 0, "failures": 0, "fallbacks_used": 0, "input_units": 0, "output_units": 0}, {"key": "2026-10-10", "requests": 3100, "estimated_cost_usd": 0, "failures": 41, "fallbacks_used": 0, "input_units": 0, "output_units": 0}]}, "users": { "total": 72, "active_last_7_days": 41 },
  "counts": { "roadmaps_locked": 58, "quizzes_submitted": 410, "mentor_messages": 1290, "technology_updates_generated": 96 },
  "ai": { "requests": 3100, "failures": 41, "fallbacks_used": 0, "usage_units": { "input": 0, "output": 0 }, "estimated_cost_usd": 0,
    "by_feature": [ { "feature_key": "ai_mentor", "requests": 1290, "estimated_cost_usd": 0 } ],
    "by_provider": [ { "provider_id": "provider-a", "requests": 3100, "estimated_cost_usd": 0 } ] } } }
```
- **Business rules:** counts and aggregate cost only via `private.admin_usage_summary(p_from, p_to)` (PRD §51, §55); no user content. This is the only analytics endpoint in MVP. **DB:** `users`, `roadmaps`, `quiz_attempts`, `messages` (COUNT only), `technology_updates`, `ai_requests`. **Backend:** `UsageService`.

### EP-H01 Health
- **GET** `/health` (unversioned) · **Auth:** none · **Headers:** none · **AZ:** AZ-PUB
- **Response:** `200` `{ "status": "ok", "version": "1.5.1", "time": "iso8601", "checks": { "database": "ok", "queue": "ok" } }`; `503` when a dependency is down. No secrets or provider details exposed. **Backend:** `HealthController`.

## 14.15 Reserved / Not in MVP

The following v1.4 module names have **no routes** in MVP. Requests return `404 RESOURCE_NOT_FOUND`. Adding any requires a product decision and a PRD revision.

| Module | Reserved prefix | Reason |
|-|-|-|
| Notification API | `/notifications` | PRD §4/§58: no push notifications; no DMS tables |
| User-facing Analytics API | `/analytics` | PRD §58: no advanced analytics (admin counts exist at EP-AD08) |
| File Management API | `/files` | No upload feature in PRD |
| Search API | `/search` | No search feature in PRD |
| Data export | `/account/export` | v1.4 §10 mentions export; PRD v1.4.1 has no export feature |

---

# 15. API DTO Reference Library

Every DTO maps to one OpenAPI schema of the same name. Types: `uuid`, `string`, `int`, `number`, `bool`, `enum(...)`, `iso8601`, `date`, `T[]`, `object`. `Req` = required on input. Unknown input fields are rejected (`whitelist + forbidNonWhitelisted`). All strings are trimmed; unspecified lengths ≤ 255.

## 15.1 Common DTOs

**ErrorDTO** (`error` object)

| Field | Type | Required | Validation | Example |
|-|-|-|-|-|
| code | string | Yes | Value from §16 | `ROADMAP_LOCKED` |
| message | string | Yes | English text | `Roadmap is locked` |
| requestId | uuid | Yes | Equals `X-Request-Id` | `7f3c…` |
| details | FieldErrorDTO[] | No | Present on validation errors | `[…]` |
| retryable | bool | No | Default `false` | `true` |
| retryAfterSeconds | int | No | ≥ 0 | `45` |

**FieldErrorDTO**: `field` string (dot path), `code` string, `message` string. Example: `confirm_password`, `PASSWORD_MISMATCH`.

**PageMetaDTO**: `limit` int (1–100), `next_cursor` string|null.

**JobAcceptedDTO**: `job_id` uuid, `status` enum(job_status), `poll_url` string, `retry_after_seconds` int.

**JobStatusDTO**: `job_id` uuid; `kind` string; `status` enum(job_status); `result_ref` {`type` string, `id` uuid}|null; `error` ErrorDTO|null; `retryable` bool; `created_at`, `finished_at` iso8601.

## 15.2 Authentication DTOs

**RegisterRequestDTO**

| Field | Type | Required | Validation | Example |
|-|-|-|-|-|
| email | string | Cond. | RFC email, ≤ 254, lower-cased; exactly one of email/phone | `rahim@example.com` |
| phone | string | Cond. | Bangladesh mobile; normalized to `+880XXXXXXXXXX` | `01712345678` |
| password | string | Yes | Policy (min 8; configurable), ≤ 128 | `S3cure!Pass` |
| confirm_password | string | Yes | Must equal `password` | `S3cure!Pass` |
| privacy_consent | bool | Yes | Must be `true` | `true` |

**RegistrationPendingDTO**: `verification_channel` enum(verification_channel); `contact_masked` string; `expires_in_seconds` int; `resend_available_at` iso8601.

**VerifyCodeRequestDTO**

| Field | Type | Required | Validation | Example |
|-|-|-|-|-|
| email | string | Cond. | Required on verify-email | `rahim@example.com` |
| phone | string | Cond. | Required on verify-phone; +880 normalized | `+8801712345678` |
| code | string | Yes | `^\d{6}$` | `482913` |

**ResendVerificationDTO**: `channel` enum(verification_channel) Req; `contact` string Req (matches channel format).

**LoginRequestDTO**

| Field | Type | Required | Validation | Example |
|-|-|-|-|-|
| identifier | string | Yes | Email or Bangladesh phone | `rahim@example.com` |
| password | string | Yes | Non-empty, ≤ 128 | `S3cure!Pass` |

**RefreshTokenDTO**: `refresh_token` string Req, non-empty.

**ForgotPasswordRequestDTO**: `identifier` string Req.

**ResetPasswordRequestDTO**: `identifier` string Req; `code` `^\d{6}$` Req; `new_password` string Req (policy); `confirm_new_password` string Req (equals `new_password`).

**OAuthSessionRequestDTO**: `provider` enum(oauth_provider) Req. **OAuthSessionResponseDTO**: `user` AuthUserDTO; `profile_complete` bool; `verified_contact_required` bool; `next_step` enum(`profile_setup`,`app_home`,`add_verified_contact`).

**LinkIdentityRequestDTO**: `provider` enum(oauth_provider) Req. **AddContactRequestDTO**: `channel` enum Req; `contact` string Req.

**AuthSessionDTO**

| Field | Type | Description |
|-|-|-|
| access_token | string | JWT |
| refresh_token | string | Opaque, rotated |
| expires_in | int | Seconds |
| token_type | string | `Bearer` |
| user | AuthUserDTO | See below |
| profile_complete | bool | Profile Setup needed when false |
| next_step | enum(`profile_setup`,`app_home`) | Client routing hint |

**AuthUserDTO**: `id` uuid, `email` string|null, `phone` string|null, `status` enum(user_status), `role` enum(`USER`,`ADMIN`), `linked_providers` string[], `verified_contact` bool.

**MeResponseDTO**: `user` AuthUserDTO; `profile_complete` bool; `focus_roadmap_id` uuid|null; `effective_access` map<feature_key,bool>; `can_delete_account` bool.

**AccountDeletionRequestDTO**: `confirmation` string Req (literal `DELETE`); `password` string Cond.; `reauth_token` string Cond. (OAuth-only accounts). **AccountDeletionStatusDTO**: `id` uuid; `status` enum(`scheduled`,`in_progress`,`completed`); `requested_at` iso8601; `completed_at` iso8601|null; `provider_deletion_requested` bool; `deletion_receipt` string and `receipt_expires_at` iso8601 only on EP-X01/replay.

## 15.3 Profile DTOs

**ProfileUpdateDTO**

| Field | Type | Required | Validation | Example |
|-|-|-|-|-|
| current_role | string | No | ≤ 120 | `Frontend Developer` |
| education | string | No | ≤ 200 | `BSc CSE` |
| experience_level | enum(`beginner`,`junior`,`mid`,`senior`) | No | Enum | `junior` |
| existing_skills | SkillInputDTO[] | No | ≤ 100; excludes `existing_skills_none=true` | `[{"name":"React"}]` |
| existing_skills_none | bool | No | `true` ⇒ no skills listed | `false` |

**SkillInputDTO**: `name` string Req (≤ 80).

**ProfilePreferencesDTO**: `learning_preference` string Req (`reading | hands_on | visual | mixed`). **LearningSettingsDTO**: `timezone` string (IANA) opt; `preferred_daily_hours` number opt (0.5–12, step 0.5). **SkillAliasInterpretationDTO**: `input` string Req (≤ 80); `skill_id` uuid Req.

**ProfileResponseDTO**

| Field | Type | Description |
|-|-|-|
| current_role, education | string|null | |
| experience_level | enum|null | |
| existing_skills | ProfileSkillDTO[] | `skill_id`, `name`, `alias_resolved` bool, `learning_state`, `source`(`self_reported`\|`evidence`) |
| existing_skills_none | bool | |
| learning_preference | string|null | |
| preferred_daily_hours | number|null | |
| timezone / timezone_detected | string / bool | |
| active_career_goal_ids | uuid[] | |
| profile_complete | bool | |
| missing_fields | string[] | Drives Profile Setup UI |
| unresolved_skills | UnresolvedSkillDTO[] | Only on EP-P02 |
| updated_at | iso8601 | |

## 15.4 Career DTOs

**CareerGoalCreateDTO**

| Field | Type | Required | Validation | Example |
|-|-|-|-|-|
| goal_text | string | Yes | 3–300 chars; untrusted | `Backend developer, mainly Node.js` |

**GoalClarificationDTO**: `answer` string Req (1–300). **GoalConfirmDTO**: `canonical_role_id` uuid Req; `target_level` enum(career_level) Req.

**CareerGoalResponseDTO**

| Field | Type | Description |
|-|-|-|
| id | uuid | |
| goal_text | string | |
| status | enum(goal_status) | |
| clarification_round | int | 0–2 |
| clarification_question | string|null | Present when `clarifying` |
| proposed_role | {canonical_role_id, name}|null | |
| alternative_roles | RoleOptionDTO[] | Optional |
| suggested_level / target_level | enum|null | Suggested by AI / confirmed by user |
| roadmap_id | uuid|null | |
| created_at | iso8601 | |

## 15.5 Roadmap DTOs

**GenerateRoadmapRequestDTO**

| Field | Type | Required | Validation | Example |
|-|-|-|-|-|
| career_goal_id | uuid | Yes | Confirmed, owned goal | `3f2a…` |
| target_level | enum(career_level) | Yes | Equals the confirmed level | `mid` |
| level_confirmed | bool | Yes | Must be `true` | `true` |

**RevisionRequestDTO**: `instruction` string Cond. (3–1000); `refresh_stale` bool opt (default false); at least one present.

**LockRoadmapDTO**: `version_no` int Req (≥ 1); `acknowledge_stale` bool opt.

**MergeRequestDTO**

| Field | Type | Required | Validation | Example |
|-|-|-|-|-|
| origin | enum(`user_request`,`level_change`) | Yes | `ai_proposal` rejected | `level_change` |
| target_level | enum(career_level) | Cond. | Required for `level_change`; ≠ current | `senior` |
| instruction | string | Cond. | Required for `user_request`; 3–1000 | `Add more testing` |

**MergeAcceptDTO**: `base_version_no` int Req; `acknowledge_large_expansion` bool opt (required when `size_impact.materially_large`).

**RoadmapResponseDTO**

| Field | Type | Description |
|-|-|-|
| id | uuid | |
| status | enum(roadmap_status) | |
| is_focus | bool | |
| career_goal_id | uuid | |
| role_name | string | Canonical role |
| target_level | enum(career_level) | |
| version_no | int | |
| summary | RoadmapSummaryBlockDTO | `current_situation`, `target_interpretation`, `expected_career_impact`, `next_steps[]` |
| phases | RoadmapPhaseDTO[] | `phase_no`, `title`, `milestones[]`, `items[]` |
| level_outline | LevelOutlineDTO[] | Light outline of the other levels |
| warnings | string[] | Size, staleness |
| stale | bool | |
| locked_at / created_at | iso8601|null | |

**RoadmapItemDTO**: `item_id` uuid (`roadmap_items.lineage_id`); `topic_id` uuid; `skill_id` uuid; `title` string; `priority` enum(item_priority); `gap_type` enum(skill_gap_type); `required_depth` string; `estimated_effort_hours` number (guidance only); `depends_on` uuid[] (`depends_on_lineage_ids`); `reason` string; `retired` bool; `sources` SourceRefDTO[] (`publisher`, `url`).

**RoadmapSummaryDTO**: `id`, `career_goal_id`, `role_name`, `target_level`, `status`, `is_focus`, `current_version_no`, `has_open_draft`, `has_open_merge`, `has_daily_plan`, `stale_draft`.

**RoadmapVersionDTO**: `version_no` int; `state` enum(`draft`,`locked`,`superseded`,`restored`); `created_by` enum(`user_request`,`ai`,`merge`,`undo`); `merge_id` uuid|null; `created_at` iso8601.

**MergeProposalDTO**

| Field | Type | Description |
|-|-|-|
| id, roadmap_id | uuid | |
| origin | enum(merge_origin) | |
| status | enum(merge_status) | |
| base_version_no | int | Version the proposal was computed against |
| reason | string | Why this change is proposed |
| operations | MergeOperationDTO[] | `op` enum(merge_op), `item_id`/`topic_id`, `title`, `priority`, `reason` |
| size_impact | {active_topics_before, active_topics_after, materially_large, warning} | Soft size guardrail (PRD §20) |
| daily_plan_impact | {future_days_affected, completed_days_unchanged} | |
| undo_available | bool | |

**FocusSwitchResponseDTO**: `focus_roadmap_id` uuid; `daily_plan` {`state`(`existing`\|`missing`), `plan_id` uuid|null, `requires_learning_hours` bool}.

## 15.6 Learning DTOs

**CreateDailyPlanDTO**: `roadmap_id` uuid Req (locked, owned); `hours_per_day` number Req (0.5–12, step 0.5). **RebuildDailyPlanDTO**: `hours_per_day` number Req (same rule).

**DailyPlanResponseDTO**: `plan_id` uuid; `roadmap_id` uuid; `is_focus` bool; `hours_per_day` number; `roadmap_version_no` int; `next_incomplete_day_no` int|null; `total_days` int; `completed_days` int; `days` PlanDayDTO[] — `day_no` int, `status` enum(plan_day_status), `topics` [{`plan_item_id`, `topic_id`, `title`}], `completed_at` iso8601|null.

**TodayResponseDTO**: `status` enum(today_status); `roadmap_id`, `plan_id` uuid|null; `plan_day` {`day_no`,`total_days`}|null; `topic` TopicDetailDTO|null; `quiz` {`attempt_id` uuid|null, `status` enum(attempt_status)|null, `can_retry` bool}; `job` JobAcceptedDTO|null; `requires_learning_hours` bool.

**TopicDetailDTO**: `topic_id` uuid; `title` string; `career_level` enum; `content_version` int; `explanation_markdown` string; `important_questions` [{`question`,`answer_markdown`}]; `sources` SourceRefDTO[]; `learning_state` enum(learning_state); `required_depth` string; `rating_allowed` bool; `report_allowed` bool.

## 15.7 Quiz DTOs

**QuizGenerateDTO**: `daily_plan_item_id` uuid Req.

**QuizAnswerDTO**

| Field | Type | Required | Validation | Example |
|-|-|-|-|-|
| question_id | uuid | Yes | Belongs to this attempt | `a1b2…` |
| selected_option_id | string | Cond. | MCQ only; valid option id | `b` |
| text | string | Cond. | Free-response only; ≤ `max_length`; Bangla/English/mixed | `SELECT …` |
| i_dont_know | bool | No | If `true`, others must be absent | `false` |

**QuizAnswersPatchDTO**: `answers` QuizAnswerDTO[] Req (1–40). **QuizSubmissionDTO**: `answers` QuizAnswerDTO[] opt; `confirm_unanswered` bool opt.

**QuizAttemptDTO**: `attempt_id` uuid; `status` enum(attempt_status); `attempt_no` int (1–2); `topic_id` uuid; `career_level` enum; `questions` QuizQuestionDTO[]; `saved_answers` QuizAnswerDTO[]; `submitted_at` iso8601|null. **QuizQuestionDTO**: `question_id`, `type` enum(question_type), `difficulty` enum(question_difficulty), `prompt` string, `options` [{`option_id`,`text`}]|null, `response_hint` string|null, `max_length` int|null, `allow_i_dont_know` bool. Answer keys are never included.

**QuizSubmitResponseDTO**: `attempt_id` uuid; `status` enum; `mcq_score` {`correct`,`total`}; `plan_day_unlocked` bool; `next_plan_day_no` int|null; `review_job_id` uuid|null.

**QuizResultDTO**: `attempt_id`; `status`; `attempt_no`; `mcq_score`; `performance_level` enum(performance_level)|null; `questions` QuizResultQuestionDTO[] (`question_id`, `type`, `your_answer`, `correct_answer`, `is_correct`, `explanation`, `practice_review_id`, `review_status`, `reportable`); `improvement_recommendations` string[]; `progress_change` {`skill_id`,`career_level`,`from`,`to`,`reason`}|null; `retry_available` bool.

## 15.8 Practice DTOs

**PracticeFeedbackDTO**

| Field | Type | Description |
|-|-|-|
| id, question_id | uuid | |
| review_status | enum(`pending`,`reviewed`,`failed`,`not_evidence`) | |
| performance_level | enum(performance_level)|null | |
| dimensions | {correctness, understanding, reasoning} | Values `good`, `partial`, `weak` |
| strengths, mistakes, weaknesses, improvement_recommendations | string[] | |
| evidence_eligible | bool | `false` for junk/non-attempts |
| reportable | bool | |

## 15.9 Progress DTOs

**EvidenceDTO** (internal service contract only)

| Field | Type | Required | Validation | Example |
|-|-|-|-|-|
| user_id | uuid | Yes | Owner | |
| skill_id | uuid | Yes | Canonical skill | |
| career_level | enum | Yes | | `mid` |
| roadmap_id | uuid | No | Context | |
| topic_id | uuid | Yes | | |
| source_type | enum(`quiz_attempt`,`practice_review`) | Yes | Only system sources | `quiz_attempt` |
| source_id | uuid | Yes | | |
| difficulty | enum(question_difficulty) | Yes | | `application` |
| score_summary | object | Yes | Derived values only | `{"mcq_correct":15,"mcq_total":20}` |
| performance_level | enum | No | | `needs_work` |
| attempt_no | int | Yes | 1–2 | `2` |
| occurred_at | iso8601 | Yes | | |

**ProgressResponseDTO**: `roadmap_id`, `career_level`, `roadmap_progress` {`items_total`,`items_completed`}, `skills` SkillProgressDTO[] (`skill_id`, `name`, `career_level`, `learning_state`, `shared_with_roadmap_ids`, `weak_area`, `last_evidence_at`, `state_reason`), `weak_areas` [{`skill_id`,`name`,`reason`}].

## 15.10 Mentor DTOs

**ConversationCreateDTO**: `context_type` enum(`focus_roadmap`,`topic`,`general`) Req; `topic_id` uuid Cond. **ConversationDTO**: `id` uuid; `context_type`; `roadmap_id` uuid|null; `topic_id` uuid|null; `title` string|null; `created_at` iso8601.

**MessageRequestDTO**

| Field | Type | Required | Validation | Example |
|-|-|-|-|-|
| conversation_id | uuid | Yes | Owned | |
| content | string | Yes | 1–4000; untrusted | `How do I start with SQL?` |
| client_message_id | uuid | Yes | De-duplicates retries | |

**MessageResponseDTO**: `user_message_id` uuid; `assistant_message` MessageDTO; `safety_mode` bool; `learning_claim_recorded` bool. **MessageDTO**: `id` uuid; `role` enum(message_role); `content` string; `language` enum(ui_language); `created_at` iso8601.

## 15.11 Technology Update, Feedback and Admin DTOs

**TechnologyUpdateDTO**: `id` uuid; `local_date` date; `title` string; `what_changed` string; `why_it_matters` string; `publisher` string; `source_url` string; `fetched_at` iso8601; `release_status` enum(release_status); `relevance` enum(relevance); `action_timing` enum(action_timing); `roadmap_relation` string; `viewed` bool. **TechnologyUpdateListDTO**: `today_state` enum(update_state)|null; `generation_pending` bool; `message` string|null; `items` TechnologyUpdateDTO[].

**RatingRequestDTO**: `target_type` enum(rating_target) Req; `target_id` uuid Req; `score` int Req (1–5); `comment` string opt (≤ 500). **ReportRequestDTO**: `target_type` enum(report_target) Req; `target_id` uuid Req; `reason` enum(report_reason) Req; `comment` string opt (≤ 1000).

**AdminUserStatusDTO**: `status` enum(user_status) Req; `reason` string Req (3–300). **FeatureToggleDTO**: `feature_key` enum Req; `enabled` bool Req. **UserFeatureToggleDTO**: `feature_key` enum Req; `enabled` bool|null Req. **FeatureControlDTO**: `feature_key`, `enabled`, `updated_at`, `updated_by`.

## 15.12 AI DTOs (internal — AI Gateway contract, never exposed to clients)

**AIRequestDTO**

| Field | Type | Required | Validation | Example |
|-|-|-|-|-|
| task | enum(`goal_interpretation`,`roadmap_generate`,`roadmap_revision`,`merge_proposal`,`topic_content`,`quiz_generate`,`practice_review`,`mentor_chat`,`technology_update`) | Yes | Gateway allowlist | `roadmap_generate` |
| user_id | uuid | Yes | Owner; used for context scoping | |
| context | object | Yes | Built only by `ContextBuilder`; summaries, no unnecessary PII | |
| untrusted_inputs | string[] | No | Wrapped as data, never instructions (PRD §44) | |
| output_schema | string | Yes | Schema id validated by `OutputValidator` | `roadmap.v1` |
| language | enum(ui_language) | Yes | Follows user input | `bn` |
| idempotency_key | string | Yes | Dedupe | |
| budget | {max_input_units, max_output_units, timeout_ms} | Yes | From configuration; units are tokens or provider-equivalent usage units | |

**AIResponseDTO**: `request_id` uuid; `status` enum(`ok`,`timeout`,`provider_error`,`validation_failed`,`budget_exhausted`); `output` object|null (validated); `provider_id` string; `model_id` string; `fallback_used` bool; `prompt_version_id` uuid; `usage_units` {`input`,`output`} int (tokens or provider-equivalent); `cost` number; `latency_ms` int; `validation_status` enum(`passed`,`failed`); `sources` SourceRefDTO[]. Provider and model are stored with the generation in `public.ai_generations` for traceability (PRD §47) and are **never** exposed to or chosen by clients (SAD §7).

---

# 16. API Error Catalog

Mapping to the envelope: HTTP status from this table; `error.code` = Error Code; `retryable` as listed (R = retryable).

## 16.1 Authentication

| Error Code | HTTP | Module | Meaning | Resolution |
|-|-|-|-|-|
| AUTH_REQUIRED | 401 | Auth | No bearer token | Log in |
| INVALID_TOKEN | 401 | Auth | Malformed/invalid signature | Re-authenticate |
| TOKEN_EXPIRED | 401 | Auth | JWT expired | Call `/auth/refresh` |
| REFRESH_TOKEN_INVALID | 401 | Auth | Refresh token unknown/revoked | Log in |
| SESSION_EXPIRED | 401 | Auth | Session lifetime ended | Log in |
| INVALID_CREDENTIALS | 401 | Auth | Wrong identifier/password | Retry or reset password |
| ACCOUNT_LOCKED | 423 (R) | Auth | Temporary lockout after failures | Wait `retryAfterSeconds` |
| UNVERIFIED_ACCOUNT | 403 | Auth | Contact not verified | Complete verification |
| REAUTH_REQUIRED | 401 | Account | Sensitive action needs fresh auth | Re-authenticate |
| VERIFICATION_CODE_INVALID | 422 | Auth | Wrong code | Re-enter or resend |
| VERIFICATION_CODE_EXPIRED | 410 | Auth | Code expired | Resend |
| VERIFICATION_ATTEMPTS_EXCEEDED | 429 | Auth | Too many wrong codes | Wait, resend |
| RESEND_COOLDOWN_ACTIVE | 429 (R) | Auth | Resend too soon | Wait `retryAfterSeconds` |
| OTP_LIMIT_EXCEEDED | 429 (R) | Auth | Per-number or per-IP OTP limit | Wait / contact support |
| ALREADY_VERIFIED | 409 | Auth | Contact already verified | Log in |
| CONTACT_ALREADY_REGISTERED | 409 | Auth | Duplicate account | Log in or reset password |
| INVALID_PHONE_NUMBER | 422 | Auth | Not a valid Bangladesh number | Fix number |
| PASSWORD_POLICY_FAILED | 422 | Auth | Password too weak | Choose stronger password |
| PROVIDER_MISMATCH | 422 | Auth | OAuth provider ≠ token provider | Retry sign-in |
| IDENTITY_LINK_CONFLICT | 409 | Auth | Identity belongs to another account or unsafe to link | Use the original sign-in method |
| VERIFIED_CONTACT_REQUIRED | 403 | Auth | Identity-sensitive action needs a verified contact | Add and verify contact (EP-A12) |
| CONFIRMATION_MISMATCH | 422 | Account | Deletion confirmation text wrong | Retype `DELETE` |
| DELETION_ALREADY_REQUESTED | 409 | Account | Deletion in progress | Check status |

## 16.2 Authorization and Access

| Error Code | HTTP | Module | Meaning | Resolution |
|-|-|-|-|-|
| PERMISSION_DENIED | 403 | All | Authenticated but not allowed | Use permitted account |
| ADMIN_REQUIRED | 403 | Admin | Admin role required | Use admin account |
| OWNERSHIP_REQUIRED | 403 | All | Body references a resource the caller does not own | Use own resources |
| ACCOUNT_SUSPENDED | 403 | All | System suspension | Only logout, `/auth/me`, account deletion work |
| FEATURE_DISABLED | 403 | All | Feature off globally or for this user | Wait for admin enablement; existing data stays readable where gate is "write" |
| CANNOT_MODIFY_ADMIN | 403 | Admin | Action on admin account not allowed | None |
| RATE_LIMITED | 429 (R) | All | Request-rate limit | Wait `Retry-After` |

## 16.3 Validation

| Error Code | HTTP | Module | Meaning | Resolution |
|-|-|-|-|-|
| VALIDATION_FAILED | 422 | All | One or more fields invalid; see `details[]` | Fix fields |
| INVALID_FORMAT | 400 | All | Malformed JSON or id | Fix request |
| INVALID_ENUM_VALUE | 422 | All | Value outside enum | Use allowed value |
| INVALID_TIMEZONE | 422 | Profile | Not an IANA timezone | Choose valid timezone |
| LEARNING_HOURS_REQUIRED | 422 | Learning | Hours missing/out of range | Provide hours |
| LEVEL_NOT_CONFIRMED | 422 | Roadmap | `level_confirmed` false | Confirm level |
| LEVEL_UNCHANGED | 422 | Roadmap | Target level equals current | Pick different level |
| NO_ANSWERS_SUBMITTED | 422 | Quiz | Zero responses | Answer or choose I don't know |
| UNANSWERED_CONFIRMATION_REQUIRED | 422 | Quiz | Unanswered questions without confirmation | Confirm or answer |
| QUESTION_NOT_IN_QUIZ | 422 | Quiz | Answer for foreign question | Fix payload |
| TARGET_NOT_RATABLE | 422 | Feedback | Target type not ratable | Use Report instead |
| UNKNOWN_FEATURE | 422 | Admin | Unknown `feature_key` | Use listed key |
| ROLE_MISMATCH | 422 | Career | Role not among proposed options | Choose proposed role |
| OUT_OF_SCOPE_GOAL | 422 | Career | Not a technology career goal | Enter a technology goal |
| PROFILE_INCOMPLETE | 422 | Roadmap | Required profile fields missing | Complete listed fields |

## 16.4 Resource and Business State

| Error Code | HTTP | Module | Meaning | Resolution |
|-|-|-|-|-|
| RESOURCE_NOT_FOUND | 404 | All | Missing, or owned by another user | Check id |
| VERSION_NOT_FOUND | 404 | Roadmap | Unknown version | Check versions list |
| DAILY_PLAN_NOT_FOUND | 404 | Learning | No plan | Create plan |
| NO_FOCUS_ROADMAP | 404 / 409 | Learning, Mentor | No Focus Roadmap | Lock and focus a roadmap |
| JOB_NOT_FOUND | 404 | Jobs | Unknown/foreign job | Check id |
| CONVERSATION_NOT_FOUND | 404 | Mentor | Unknown/foreign conversation | Create conversation |
| SKILL_NOT_FOUND | 404 | Profile | Unknown skill | Choose valid skill |
| TARGET_NOT_FOUND | 404 | Feedback | Target not visible | Check id |
| ROADMAP_LOCKED | 409 | Roadmap | Locked roadmap cannot be revised/edited | Use merge proposal |
| ROADMAP_NOT_LOCKED | 409 | Roadmap | Operation needs a locked roadmap | Lock it first |
| ROADMAP_ARCHIVED | 409 | Roadmap | Roadmap archived | Use an active roadmap |
| ROADMAP_LIMIT_REACHED | 409 | Roadmap, Career | 3 active roadmaps already | Archive/discontinue one |
| ROADMAP_EXISTS_FOR_GOAL | 409 | Roadmap | Goal already has a roadmap | Open existing roadmap |
| GOAL_NOT_CONFIRMED | 409 | Roadmap | Goal not confirmed | Confirm goal and level |
| GOAL_ALREADY_CONFIRMED | 409 | Career | Cannot edit confirmed goal | Discontinue and create new |
| CLARIFICATION_LIMIT_REACHED | 409 | Career | Two rounds used | Confirm proposed interpretation |
| NO_OPEN_DRAFT | 409 | Roadmap | No open draft | Generate a draft |
| DRAFT_STALE | 409 | Roadmap | Draft stale; refresh advised | Revise with `refresh_stale` or `acknowledge_stale` |
| MERGE_ALREADY_PROPOSED | 409 | Roadmap | Open proposal exists | Accept/reject it |
| MERGE_NOT_PENDING | 409 | Roadmap | Proposal not in `proposed` state | Reload |
| MERGE_EXPANSION_ACK_REQUIRED | 409 | Roadmap | Large expansion needs acknowledgement | Resend with `acknowledge_large_expansion` |
| UNDO_NOT_AVAILABLE | 409 | Roadmap | No merge to undo or post-merge learning started | Use a new merge proposal |
| STALE_VERSION | 409 | Roadmap | Base version changed | Reload and retry |
| INVALID_STATE_TRANSITION | 409 | All | Disallowed state change | Check current state |
| DAILY_PLAN_EXISTS | 409 | Learning | Roadmap already has a plan | Use rebuild |
| PLAN_ITEM_NOT_AVAILABLE | 409 | Quiz | Plan day not currently available | Continue from Today |
| QUIZ_NOT_STARTED | 409 | Quiz | Not started | Start first |
| QUIZ_NOT_SUBMITTED | 409 | Quiz | Result/retry needs submission | Submit |
| QUIZ_ALREADY_SUBMITTED | 409 | Quiz | Already submitted | View result |
| RETRY_LIMIT_REACHED | 409 | Quiz | One retry used | None |
| REVIEW_NOT_RETRYABLE | 409 | Practice | Review not pending/failed | None |
| RAW_RESPONSE_EXPIRED | 410 | Practice | Raw answer past 90-day retention | Cannot re-review |
| REPORT_ALREADY_SUBMITTED | 409 | Feedback | Duplicate report | None |
| STATUS_UNCHANGED | 409 | Admin | Already in requested status | None |
| IDEMPOTENCY_KEY_REUSED | 409 | All | Same key, different body | Use new key |

## 16.5 AI

| Error Code | HTTP | Module | Meaning | Resolution |
|-|-|-|-|-|
| AI_TIMEOUT | 504 (R) | AI | Provider/gateway timeout | Retry; state preserved |
| AI_SERVICE_ERROR | 502 (R) | AI | Provider failure after fallback | Retry later |
| AI_GENERATION_FAILED | 502 (R) | AI | Generation failed (job/sync) | Retry; no partial data written |
| AI_VALIDATION_FAILED | 502 (R) | AI | Output failed structural/rule/grounding validation | Retry; output is discarded |
| AI_BUDGET_EXHAUSTED | 503 (R) | AI | Provider quota, credit, rate limit, or budget exhausted and no approved fallback available | Existing data remains available; try later |
| UNSUPPORTED_LANGUAGE | 422 | AI | Input not Bangla/English/mixed | Use supported language |

## 16.6 Integration, Platform and Database

| Error Code | HTTP | Module | Meaning | Resolution |
|-|-|-|-|-|
| PROVIDER_TIMEOUT | 504 (R) | Integration | External provider timed out | Retry |
| PROVIDER_ERROR | 502 (R) | Integration | External provider error | Retry |
| SMS_PROVIDER_ERROR | 502 (R) | Auth | SMS delivery failed | Retry; no cost-bypass of limits |
| EMAIL_PROVIDER_ERROR | 502 (R) | Auth | Email delivery failed | Retry |
| SERVICE_UNAVAILABLE | 503 (R) | Platform | Dependency down | Retry |
| INTERNAL_ERROR | 500 | Platform | Unhandled error; `requestId` logged | Report with requestId |
| DATABASE_ERROR | 500 | Platform | Persistence failure; transaction rolled back | Retry |

---

# 17. API Testing Matrix

**Columns:** **H** happy path · **AuthN** authentication failure (no/invalid/expired token) · **AuthZ** authorization/ownership/suspension/feature gate · **V** validation failure · **B** business-rule failure · **X** external-dependency failure. All AZ-USER/AZ-ADMIN endpoints also require the **standing cases**: no token → 401; expired token → 401 `TOKEN_EXPIRED`; suspended user → 403 `ACCOUNT_SUSPENDED` (except AZ-SUSP); response includes `X-Request-Id`; error body matches `ErrorDTO`.

## 17.1 Authentication and Account

| Endpoint | H | AuthN | AuthZ | V | B | X |
|-|-|-|-|-|-|-|
| EP-A01 POST /auth/register | Email signup → code sent; phone signup → SMS sent (+880 normalized) | — | — | Both/neither of email+phone; password mismatch (field error, nothing created); weak password; no consent; bad phone | Duplicate contact; OTP per-number and per-IP limits | SMS/email provider failure → 502, no account in verified state |
| EP-A02 POST /auth/verify-email | Correct code → session + `profile_complete=false` | — | — | Non-6-digit code | Expired; wrong code; attempts exceeded; already verified | — |
| EP-A03 POST /auth/verify-phone | Correct OTP → session | — | — | Bad phone/code format | Expired; invalid; attempts exceeded | — |
| EP-A04 POST /auth/resend-verification | Resend after cooldown | — | — | Bad channel/contact | Cooldown 429 with `retryAfterSeconds`; limits; unknown contact gives identical response | Provider failure |
| EP-A05 POST /auth/login | Email and phone login | — | Suspended user can log in (status shown), features 403 | Missing fields | Wrong password; lockout after N failures; unverified account | — |
| EP-A06 POST /auth/logout | Session revoked; repeat call OK | No token → 401 | — | — | — | — |
| EP-A07 POST /auth/refresh | New tokens, old refresh rotated | — | — | Empty token | Revoked/expired refresh | — |
| EP-A08 POST /auth/forgot-password | 202 identical for known/unknown | — | — | Bad identifier | Cooldown; limits | Provider failure |
| EP-A09 POST /auth/reset-password | Password changed; old sessions revoked | — | — | Mismatch; weak | Expired/invalid code; attempts | — |
| EP-A10 POST /auth/oauth/session | Google → user created/loaded; Facebook w/o email → `verified_contact_required=true` | Invalid Supabase token | — | Bad provider | Provider ≠ token claim; no merge on name/unverified email | — |
| EP-A11 POST /auth/identities/link | Phone-only user links Google | No token | Identity owned by other account → 409 | Bad provider | Unverified-contact restriction | — |
| EP-A12 POST /auth/contact | Facebook user adds email → code | No token | — | Bad contact | Contact owned by another verified account | Provider failure |
| EP-A13 GET /auth/me | Active user flags; technology_update default false | No token | Suspended → all flags false, `can_delete_account=true` | — | Global OFF overrides user ON | — |
| EP-X01 POST /account/deletion-requests | Confirm + password → 202 | No token | **Suspended user can delete**; OAuth-only needs re-auth | Wrong confirmation text | Duplicate request; unverified Facebook contact | Provider deletion failure → request retried, user data still deleted |
| EP-X02 GET /account/deletion-requests/current | Valid JWT/receipt returns scheduled/in_progress/completed, including null-owner tombstone | Invalid credentials→401, never completion | Receipt scoped to request/route | Forged/wrong audience rejected | None→404 unconfirmed | Network failure→unconfirmed |

## 17.2 Profile and Career

| Endpoint | H | AuthN | AuthZ | V | B | X |
|-|-|-|-|-|-|-|
| EP-P01 GET /profile | Complete and incomplete profile; `missing_fields` correct | Standing | Suspended → 403 | — | — | — |
| EP-P02 PATCH /profile | Partial update; beginner with `existing_skills_none=true` creates no skills | Standing | Suspended | `none=true` with skills; >100 skills; long strings | Self-reported skill starts `learning`; stronger evidence not overwritten; "React.js"→React; "SQL"≠"MySQL"; uncertain alias returned | — |
| EP-P03 PATCH /profile/preferences | Saved | Standing | — | Value outside allowlist | — | — |
| EP-P04 PATCH /profile/learning-settings | Hours/timezone saved | Standing | — | Bad IANA tz; 0.25 h; 13 h | Hours change does not rebuild plan | — |
| EP-P05 POST /profile/skill-alias-interpretations | User-scoped mapping stored in `user_skill_aliases` + appended to `user_profiles.self_reported_skill_ids` + progress initialized for confirmed levels or explicitly deferred | Standing | Other user's skill mapping not visible | Missing fields | Not promoted to global `skill_aliases` | — |
| EP-C01 POST /career/goals | Clear goal → `awaiting_confirmation`; ambiguous → `clarifying` | Standing | Feature gate | Too short/long | Non-technology goal → `OUT_OF_SCOPE_GOAL`; goal limit | AI timeout/validation failure; prompt-injection text in `goal_text` ignored |
| EP-C02 GET /career/goals | Own list; filter by status | Standing | Other user's goals never returned | Bad enum | — | — |
| EP-C03 GET /career/goals/{id} | Own goal | Standing | Other user's id → 404 | Bad uuid → 400 | — | — |
| EP-C04 POST …/clarifications | Round 1→2; after round 2 → proposal | Standing | Gate; ownership | Empty answer | Wrong state; third round rejected | AI failure |
| EP-C05 POST …/confirm | Confirmed with level | Standing | Ownership | Bad level; role not proposed | Not awaiting confirmation; 3-roadmap limit | — |
| EP-C06 PATCH …/{id} | Reword before confirm | Standing | Ownership | Length | Confirmed goal → 409 | AI failure |
| EP-C07 DELETE …/{id} | Goal discontinued; roadmap archived; focus reassigned or null | Standing | Ownership | — | History/progress retained; archived evidence still reusable | — |

## 17.3 Roadmap

| Endpoint | H | AuthN | AuthZ | V | B | X |
|-|-|-|-|-|-|-|
| EP-R01 POST /roadmaps/generate | 202 → job succeeded → draft v1 | Standing | Gate (`roadmap_generator` off → 403); other user's goal → 403 `OWNERSHIP_REQUIRED` | `level_confirmed=false`; level mismatch; missing key header | Incomplete profile; goal unconfirmed; 4th roadmap → `ROADMAP_LIMIT_REACHED`; goal already has roadmap; duplicate idempotency key returns same job | AI timeout; AI validation failure leaves no roadmap row; provider fallback model recorded |
| EP-R02 GET /roadmaps | Filter by status; focus flag | Standing | Only own | Bad enum | — | — |
| EP-R03 GET /roadmaps/{id} | Draft, locked, `version=` variants; level outline only for other levels | Standing | Other user's → 404 | Bad version | Retired items flagged | — |
| EP-R04 POST …/revision | New draft version; previous version unchanged | Standing | Gate; ownership | Empty instruction; neither field | Locked → `ROADMAP_LOCKED`; no draft; stale version | AI failure; injected instruction text not obeyed as system instruction |
| EP-R05 POST …/lock | Draft → locked; first locked becomes Focus; second keeps Focus | Standing | Gate; ownership | Missing `version_no` | Not open draft; stale version; stale draft without ack; double lock | — |
| EP-R06 GET …/versions | Immutable history | Standing | Ownership | — | Versions never mutated | — |
| EP-R07 GET …/versions/{n} | Specific version | Standing | Ownership | Non-int | Unknown version → 404 | — |
| EP-R08 POST …/merges | `user_request` and `level_change` → proposal job | Standing | Gate | `ai_proposal` origin rejected; level_change without level | Not locked; open proposal; same level; **locked roadmap unchanged until accept** | AI failure |
| EP-R09 GET …/merges | Includes `ai_proposal` items | Standing | Ownership | Bad status | — | — |
| EP-R10 GET …/merges/{id} | Operations, size impact, plan impact | Standing | Ownership | — | `materially_large` flag at threshold | — |
| EP-R11 POST …/accept | New version; completed plan days identical before/after; future days reconciled; evidence preserved | Standing | Gate; ownership | Missing base version | Large expansion without ack; stale base; not pending; **Technology Update never auto-applies** | Failure mid-transaction → full rollback |
| EP-R12 POST …/reject | Roadmap unchanged | Standing | Ownership | — | Not pending | — |
| EP-R13 POST …/merges/undo | Previous roadmap + previous future plan restored; completed history intact | Standing | Ownership | — | Before learning → OK; after first quiz start on post-merge day → `UNDO_NOT_AVAILABLE`; second undo → 409; none to undo | — |
| EP-R14 POST …/focus | Switch; old plan state/progress intact; existing plan resumes | Standing | Ownership | — | Not locked; archived; missing plan + hours flags correct | — |
| EP-R15 POST …/archive | Archived; focus auto-reassigned/null; evidence reusable | Standing | Ownership | — | Already archived; level change does **not** archive | — |

## 17.4 Learning, Quiz, Practice Review

| Endpoint | H | AuthN | AuthZ | V | B | X |
|-|-|-|-|-|-|-|
| EP-L01 GET /learning/daily-plan | Focus default; `roadmap_id` override; paged days | Standing | Other user's plan → 404 | Bad uuid | No plan; no focus | — |
| EP-L02 POST /learning/daily-plans | Plan created; hours saved to profile | Standing | Gate (`daily_plan`) | Hours missing/out of range | Roadmap not locked; plan exists; retired topics excluded | — |
| EP-L03 POST …/rebuild | Future days re-sequenced; completed days and roadmap unchanged | Standing | Ownership; gate | Bad hours | Archived roadmap; in-progress day kept | — |
| EP-L04 GET /learning/today | `ready`; resume after missed days (no skip); `preparing`; `no_focus_roadmap`; `no_daily_plan`; `plan_completed` | Standing | Global OFF still shows existing content | — | Next incomplete day advances only after quiz submit | AI generation failure → `preparing` then retryable failure |
| EP-L05 GET /learning/topics | Filters work | Standing | Only own roadmap topics | Bad enum | — | — |
| EP-L06 GET /learning/topics/{id} | Detail | Standing | Foreign topic → 404 | Bad uuid | — | — |
| EP-L07 GET /learning/resources | Attribution links | Standing | Foreign topic → 404 | Missing `topic_id` | — | — |
| EP-Q01 POST /quiz/generate | New attempt; existing attempt returned; shared quiz reused; 20 MCQ + 5–10 FR | Standing | Gate (`quiz_practice`); foreign plan item | Bad uuid | Day not available; shared content hidden by reports triggers regeneration | AI timeout/validation failure; quiz not partially stored |
| EP-Q02 GET /quiz/{id} | Resume after app closed; no answer keys; no expiry | Standing | Foreign attempt → 404 | — | Saved answers returned | — |
| EP-Q03 POST …/start | Started; idempotent | Standing | Gate | — | Submitted attempt → 409; closes Undo window | — |
| EP-Q04 PATCH …/answers | Autosave MCQ, text, I don't know | Standing | Ownership | Bad option; over length; mixed fields; >40 answers | Not started; already submitted; foreign question | Network retry safe (idempotent) |
| EP-Q05 POST …/submit | MCQ graded from key; next plan day unlocked regardless of score; review job started | Standing | Gate; ownership | Zero responses; unanswered without confirm | Double submit (idempotent); junk answers flagged non-evidence; no evidence from a bare "complete" | AI review failure → attempt still submitted, review retryable |
| EP-Q06 GET …/result | Score, correct answers, explanations, progress change | Standing | Ownership | — | Before submit → 409; pending review state | — |
| EP-Q07 POST …/retry | Attempt 2 with new MCQs; both attempts retained; improvement can lift progress | Standing | Gate | — | Before submit; second retry → 409 | AI failure |
| EP-PR01 GET /practice-review | List by attempt | Standing | Foreign attempt → 404 | Missing param | — | — |
| EP-PR02 GET …/feedback | Rubric dimensions; Bangla, English, mixed answers reviewed | Standing | Foreign → 404 | — | Junk → `not_evidence`; no "Job Ready" wording | — |
| EP-PR03 POST …/review | Failed review re-run | Standing | Gate (`ai_practice_review`) | — | Already reviewed → 200 no re-run; raw text expired → 410 | AI failure/validation failure |

## 17.5 Progress, Mentor, Technology Update, Feedback, Jobs, Admin, Health

| Endpoint | H | AuthN | AuthZ | V | B | X |
|-|-|-|-|-|-|-|
| EP-G01 GET /progress | States, weak areas, shared-skill evidence across roadmaps | Standing | Only own; global OFF still readable | Bad enum | Lower-level Proficient not auto-Proficient at higher level; no "Job Ready" anywhere | — |
| EP-G02 GET /progress/skills/{id} | Detail with reason | Standing | Own data only | Bad uuid | No raw answer text | — |
| EP-G03 GET /progress/history | Filtered/paged | Standing | Own only | Bad dates | State changes explained | — |
| EP-G04 (internal) | Evidence recorded from quiz/review | — | **No HTTP route exists** (route probe → 404) | Junk rejected | Single 90% score never alone flips to Proficient; "I studied this" never evidence | — |
| EP-M01 POST /mentor/conversations | Focus and topic context | Standing | Gate (`ai_mentor`); foreign topic | Bad type | No focus roadmap | — |
| EP-M02 GET /mentor/conversations | Own list | Standing | Other users' never visible | — | — | — |
| EP-M03 POST /mentor/messages | Bangla in → Bangla out; English → English; mixed → mixed; duplicate `client_message_id` returns same reply | Standing | Gate; foreign conversation → 404 | Empty; >4000 chars | "I studied this" → context only; distress → `safety_mode`; out-of-scope redirected; no employment promises | Timeout → user message saved, retryable; **cross-user context leakage test**; system-prompt extraction attempt refused |
| EP-M04 GET /mentor/history | Paged messages | Standing | Foreign conversation → 404; admin cannot read | Missing id | Messages >90 days not returned | — |
| EP-T01 GET /technology-updates | Update with source, fetch time, release status, action timing | Standing | Feature OFF (default) → 403; global OFF → 403 | Bad cursor | `no_important_changes`; `temporarily_unavailable`; one per local day; duplicates suppressed; inactive >7 days not generated | Source fetch failure never yields stale "today" update |
| EP-T02 GET …/{id} | Own delivered update | Standing | Foreign → 404 | — | — | — |
| EP-T03 POST …/view | Marked viewed; idempotent | Standing | Feature gate | — | — | — |
| EP-F01 POST /ratings | Rating saved/upserted in `user_ratings` | Standing | Foreign target → 404 | Score 0/6; long comment | Quiz question or mentor reply → `TARGET_NOT_RATABLE` | — |
| EP-F02 POST /reports | Report recorded in `content_reports` | Standing | Foreign target → 404 | Bad enum | Duplicate → 409; N independent reports hide shared item via `trg_content_reports_threshold`; one user cannot hide it | — |
| EP-J01 GET /jobs/{id} | Each status and `result_ref` | Standing | Foreign job → 404 | Bad uuid | Failed job retryable; no partial writes | — |
| EP-AD01 GET /admin/users | Search/filter/page | Standing | Non-admin → 403 `ADMIN_REQUIRED`; USER with spoofed role claim fails server check | Bad status | — | — |
| EP-AD02 GET /admin/users/{id} | Aggregate counts only; **no mentor text or raw answers** | Standing | Non-admin → 403 | Bad uuid | — | — |
| EP-AD03 PATCH /admin/users/{id} | Suspend then reactivate; data intact; audit entry written | Standing | Non-admin → 403 | Missing reason | Admin target → `CANNOT_MODIFY_ADMIN`; unchanged status → 409; suspended user can still delete account | — |
| EP-AD04 GET /admin/features | List | Standing | Non-admin → 403 | — | — | — |
| EP-AD05 PATCH /admin/features | Toggle; existing data kept; new generation blocked | Standing | Non-admin → 403 | Unknown key | Roadmap Generator OFF → locked roadmap viewable, generation 403 | — |
| EP-AD06 PATCH …/users/{id}/features | Enable `technology_update` for one user; `null` removes override | Standing | Non-admin → 403 | Unknown key | User ON + global OFF = no access; suspension beats override | — |
| EP-AD07 GET /admin/audit-logs | Filtered, paged, immutable | Standing | Non-admin → 403 | Bad dates | Every admin write appears | — |
| EP-AD08 GET /admin/usage | Counts and aggregate cost | Standing | Non-admin → 403 | Bad range | No user content returned | — |
| EP-H01 GET /health | 200 ok; 503 when DB down | — | — | — | No secrets in body | — |

## 17.6 Cross-cutting test suites

| Suite | Cases |
|-|-|
| RLS / isolation | For every user-owned table across all 50 tables, user B cannot read or write user A's rows through any endpoint (expect 404) and not via direct Supabase client queries (`ADR-019`). |
| Access matrix | Cross product of system status × global flag × user flag for each feature key; confirms the §3 evaluation order. |
| Idempotency | Replay every H-IDEM endpoint; same key/body returns same result, same key/different body returns 409. |
| Contract | Responses validated against OpenAPI schemas generated from §15; no undocumented fields. |
| AI language | Bangla, English, and mixed prompts through roadmap, quiz review, and mentor; language-behavior assertions. |
| Prompt injection | Malicious text in `goal_text`, profile fields, quiz answers, mentor messages, and fetched pages must not change system behavior (PRD §44). |
| Forbidden claims | Scan AI outputs for "Job Ready" and guaranteed-employment phrasing (PRD §36). |
| Provider fallback | Force primary provider quota/rate-limit/outage; confirm an approved fallback is used, `fallback_used` is recorded, no client-visible contract change, and `AI_BUDGET_EXHAUSTED` is returned only when no approved fallback exists (PRD v1.4.1 §47). |
| Failure atomicity | Kill AI/provider mid-job; confirm no partial writes and unchanged roadmap/plan/quiz/progress state (PRD §48). |
| Performance | Standard < 300 ms, complex < 1 s, mentor message < 10 s target, with 100 concurrent users. |

---

# 18. API Workflow Documentation

## 18.1 Registration Flow

```text
Client (PWA)
  │ POST /auth/register  {email|phone, password, confirm_password, privacy_consent}
  ▼
AuthController → AuthService
  │  validate (password match, +880 normalization, policy) ── fail → 422 details[], nothing created
  │  RateLimitGuard (per contact, per IP in Redis)
  ▼
SupabaseAuthAdapter.signUp  ──►  Supabase Auth (unverified identity)
  │
  ├─ email  → Supabase email code
  └─ phone  → SmsAdapter → Bangladesh SMS provider (OTP)
  ▼
users + user_auth_providers rows (unverified)            → 201 RegistrationPendingDTO

Client → POST /auth/verify-email | /auth/verify-phone {contact, code}
  ▼
AuthService.verify → SupabaseAuthAdapter.verify
  ▼
Verified → create user_profiles + user_preferences (empty) → issue session → 200 AuthSessionDTO (next_step: profile_setup)
  ▼
Client → PATCH /profile … (profile completion only required before roadmap generation)
```

## 18.2 Roadmap Generation (draft → lock)

```text
Client → POST /roadmaps/generate  (H-IDEM, confirmed goal + confirmed level)
  ▼
RoadmapController → AccessGuard (status, role, global+user feature, ownership)
  ▼
RoadmapService: check profile complete, goal confirmed, <3 roadmaps, no roadmap for goal
  │  insert queued job in public.ai_requests ───────────────► 202 JobAcceptedDTO
  ▼ (PostgresJobQueueConsumer via FOR UPDATE SKIP LOCKED)
RoadmapDraftService → ContextBuilder (profile, skills, evidence summaries)
  ▼
AI Gateway → Prompt Manager → Model Router → Provider Adapter (Vercel AI SDK) → AI Provider
  │            (shared career knowledge + fresh web research where needed)
  ▼
Output Validator + RoadmapValidator (schema, DAG acyclicity, product rules, source grounding)
  │  fail → job failed, retryable, NOTHING written
  ▼
Transaction: roadmaps + roadmap_versions(v1, draft) + roadmap_items + ai_generations + ai_requests(succeeded)
  ▼
Client polls GET /jobs/{id} → succeeded → GET /roadmaps/{id}
  ▼  (user reviews; optional POST /roadmaps/{id}/revision → new immutable draft version)
POST /roadmaps/{id}/lock {version_no} → locked (Focus if none) → next_step: confirm_learning_hours
  ▼
POST /learning/daily-plans {roadmap_id, hours_per_day} → Daily Plan
```

## 18.3 Mentor Conversation

```text
Client → POST /mentor/messages {conversation_id, content, client_message_id}
  ▼
MentorController → AccessGuard (ai_mentor feature, conversation ownership)
  ▼
MentorService: dedupe by client_message_id; persist user message
  ▼
ContextBuilder: caller's profile + Focus Roadmap/current topic + conversation SUMMARY
  │   (never full history, never other users; user text and web text marked untrusted)
  ▼
AI Gateway → Model Router → Provider Adapter (Vercel AI SDK) → AI Provider   (budget + timeout from config)
  ▼
Output Validator (scope, language behavior, no guarantees, no "Job Ready", no system-prompt leakage)
  ▼
Persist assistant message + usage/cost (ai_requests, ai_generations); update summary every 20 turns
  ▼
201 MessageResponseDTO   (distress → safety_mode: safe redirecting reply)
  timeout/provider error → user message kept, 504/502 retryable
```

## 18.4 Focus Switching, Merge, Accept and Undo (highest-risk flow)

```text
User requests change or Career Level move
  ▼
POST /roadmaps/{id}/merges (H-IDEM) ───────────────────────► 202 job (public.ai_requests)
  ▼ AI Gateway + RoadmapValidator + soft size guardrail
roadmap_merges + roadmap_merge_items (status: proposed)       ◄── AI may also create origin=ai_proposal
  ▼
GET /roadmaps/{id}/merges/{mid}: operations + size_impact + daily_plan_impact
  ├─ POST …/reject ──► rejected, roadmap unchanged
  └─ POST …/accept {base_version_no, acknowledge_large_expansion?}
        ▼ single transaction
        snapshot previous version pointer + previous future-incomplete plan days (undo_snapshot)
        new immutable roadmap_versions row; roadmaps.current_version_id → new
        DailyPlanReconciler: completed days untouched; future incomplete days rebuilt (reconciled_by_merge_id)
        evidence + skill_progress untouched
        ▼
        undo_available = true
        ├─ POST …/merges/undo (before post-merge learning) ──► restore previous version + previous future plan
        └─ first quiz start on post-merge plan day (trg_quiz_attempts_close_undo) ──► undo window closed
                                                                                      (further change = new merge)

Focus switching:
POST /roadmaps/{id}/focus
  ▼ roadmap must be locked and not archived
previous Focus plan, evidence, progress stay as-is
  ├─ target has Daily Plan → resume it
  └─ none → response daily_plan.state=missing
         ├─ profile has hours → client POST /learning/daily-plans
         └─ requires_learning_hours=true → client asks user, then POST /learning/daily-plans
```

---

# 19. Endpoint-to-PRD Traceability

| PRD v1.4.1 area | Endpoints |
|-|-|
| §7 access control, §51 admin | EP-A13, EP-AD01–AD08 |
| §8–§12 authentication, verification, linking | EP-A01–A12 |
| §13 account deletion | EP-X01, EP-X02 |
| §14 profile, timezone, hours, skills | EP-P01–P05 |
| §15 dynamic career goals | EP-C01–C07 |
| §16, §22 multiple roadmaps, Focus, archive | EP-R02, R14, R15, EP-C07 |
| §17 shared skills / aliases | EP-P02, EP-P05, EP-G01 |
| §18 career levels | EP-C05, EP-R01, EP-R08 |
| §19–§21 roadmap structure, draft, lock, merge, undo | EP-R01, R03–R13 |
| §23 shared career knowledge, §24 quality feedback | EP-R01, EP-F01, EP-F02 |
| §27 Daily Plan | EP-L01–L03 |
| §28 Today | EP-L04–L07 |
| §29–§33 quiz, AI Practice Review, retry, lifecycle | EP-Q01–Q07, EP-PR01–PR03 |
| §34–§36 progress, job readiness exclusion | EP-G01–G04 |
| §37 mentor | EP-M01–M04 |
| §38–§46 technology updates | EP-T01–T03 (+ hourly timezone-aware background job) |
| §47–§48 AI provider policy, cost, failure, Preparing state | §13.6, EP-J01, AI error codes |
| §52 retention | §10, EP-M04, EP-PR02/PR03 |
| §60 per-feature acceptance | §17 test matrix |

---

# 20. Final API Implementation Readiness Assessment

| Audience | Ready? | v1.5.1 Assessment |
|-|-|-|
| **Frontend** | **SPECIFIED / NOT EXECUTED** | Every screen flow in PRD §62 and UI/UX Spec v2.0.2 has endpoints, DTOs, enums, state rules, async polling (`EP-J01`), and error codes. `learning_preference` values (`reading`, `hands_on`, `visual`, `mixed`) are locked in `ck_user_preferences_learning`. |
| **Backend** | **SPECIFIED / NOT EXECUTED** | Controllers and services map 1:1 to all **50 tables** in `DMS v1.2.2` (`000`–`020`). All 13 prior gaps (`G1`–`G13`) are closed in §21. Configurable thresholds are seeded in `public.system_configurations`. |
| **QA** | **SPECIFIED / NOT EXECUTED** | §17 gives per-endpoint happy/authN/authZ/validation/business/external cases plus cross-cutting suites, traceable to PRD §60 acceptance criteria, backed by 204 database assertions in DMS v1.2.2. |
| **Security** | **SPECIFIED / NOT EXECUTED** | Access evaluation order (§3), AZ profiles (§13.2), suspension carve-outs, `ADR-019` backend-mediated profile writes, universal RLS across all 50 tables, admin audit logging, absence of any admin route to private content, internal-only evidence, 24h Redis idempotency, and AI-security rules are explicit and testable. |

**Overall:** Specification corrections supplied; implementation and runtime acceptance pending.

---

 # 21. Storage/contract DDD / DMS Gap Register (`G1`–`G13`)

The following13 storage/infrastructure contracts are specified; behavior and runtime acceptance remain R32. Their source definitions appear in **DMS v1.2.2 (`000`–`020`)** and **SAD v1.1.1 (`ADR-016`–`ADR-020`)**:

| ID | Needed by | Original Gap | Resolution in DMS v1.2.2 & SAD v1.1.1 | Status |
|-|-|-|-|-|
| **G1** | EP-F01, EP-F02 | Ratings store, reports store, and a "hidden" flag/threshold support on shared quiz/topic content. | Created `public.user_ratings`, `public.content_reports`, and auto-hide trigger `trg_content_reports_threshold` (`020_gaps_and_alignment.sql`); `hidden_at` columns in `006`/`007`. | **STORAGE/CONTRACT SPECIFIED; EXECUTION PENDING** |
| **G2** | EP-X01, EP-X02 | Account-deletion request record (status, timestamps, provider-deletion status). | Created `public.account_deletion_requests` with `user_id ON DELETE SET NULL` tombstone support (`020_gaps_and_alignment.sql`, `ADR-020`). | **STORAGE/CONTRACT SPECIFIED; EXECUTION PENDING** |
| **G3** | EP-P05 | User-specific skill alias interpretation store. | Created `public.user_skill_aliases` (`020_gaps_and_alignment.sql`) + atomic profile sync and level-confirmed progress rule (`ADR-019`). | **STORAGE/CONTRACT SPECIFIED; EXECUTION PENDING** |
| **G4** | EP-J01, async endpoints | Job lifecycle on `ai_requests` (status, kind, result reference, error code, retryable). | Implemented on `public.ai_requests` (`010_ai_operations.sql`) polled via `FOR UPDATE SKIP LOCKED` (`ADR-017`). | **STORAGE/CONTRACT SPECIFIED; EXECUTION PENDING** |
| **G5** | AccessGuard, EP-AD03 | Confirm `users.status` (active/suspended), suspended timestamp and reason. | Implemented on `public.users` (`002_identity.sql`). | **STORAGE/CONTRACT SPECIFIED; EXECUTION PENDING** |
| **G6** | EP-P01–P04, EP-R14 | Confirm columns: timezone, preferred daily hours, existing-skills-none flag, learning preference, Focus flag on `roadmaps`. | Implemented on `public.user_profiles`, `public.user_preferences` (`003`), and `public.roadmaps.is_focus` (`005`). | **STORAGE/CONTRACT SPECIFIED; EXECUTION PENDING** |
| **G7** | EP-R11, EP-R13 | Merge undo snapshot (previous version pointer, previous future-plan state), undo-window-closed marker. | Implemented on `public.roadmap_merges` (`undo_snapshot`, `undo_window_closed_at`), `daily_plan_items.reconciled_by_merge_id`, and `trg_quiz_attempts_close_undo` (`005`, `006`, `016`). | **STORAGE/CONTRACT SPECIFIED; EXECUTION PENDING** |
| **G8** | EP-Q01, EP-Q04–Q07, EP-PR | Quiz attempt number / retry linkage, "I don't know" flag on answers, raw-response expiry timestamp (90 days), review status and `evidence_eligible`. | Implemented on `public.quiz_attempts`, `public.quiz_answers`, and `public.practice_reviews` (`007_assessment.sql`). | **STORAGE/CONTRACT SPECIFIED; EXECUTION PENDING** |
| **G9** | EP-A01–A09 | Where OTP counters, resend cooldowns, lockout counters and SMS delivery logs live and their retention. | Stored in **Redis** ephemeral TTL keys per `ADR-017`. | **STORAGE/CONTRACT SPECIFIED; EXECUTION PENDING** |
| **G10** | H-IDEM | Idempotency key storage (24 h TTL). | Stored in **Redis** (24 h TTL) + DB unique index `uq_ai_requests_idempotency` (`010`) per `ADR-017`. | **STORAGE/CONTRACT SPECIFIED; EXECUTION PENDING** |
| **G11** | EP-T01 | `users.last_active_at` for the 7-day eligibility rule (PRD §39). | Implemented on `public.users.last_active_at` with partial index `idx_users_last_active` (`002`, `014`). | **STORAGE/CONTRACT SPECIFIED; EXECUTION PENDING** |
| **G12** | EP-AD08 | Aggregate usage views/queries. | Implemented via `private.admin_usage_summary(p_from, p_to)` in `015_functions.sql`. | **STORAGE/CONTRACT SPECIFIED; EXECUTION PENDING** |
| **G13** | AI Gateway, EP-AD08 | Provider and model traceability on `ai_generations` / `ai_requests`, provider on `ai_models`, provider-neutral usage units, and per-feature / per-provider cost aggregation. | Implemented on `public.ai_models`, `public.ai_requests`, and `public.ai_generations` (`010_ai_operations.sql`). | **STORAGE/CONTRACT SPECIFIED; EXECUTION PENDING** |

---

# 22. Assumptions, Change Summary and Final Statement

## 22.1 Confirmed design rules

| ID | Rule |
|-|-|
| A1 | When a roadmap is locked and the user has no Focus Roadmap, it becomes Focus automatically (PRD §62 "Select or Retain Focus"). |
| A2 | Draft roadmaps count toward the 3 active-roadmap limit (`enforce_active_roadmap_limit()`); archived ones do not. |
| A3 | `learning_preference` is allowlisted to `reading`, `hands_on`, `visual`, `mixed` (`ck_user_preferences_learning`). |
| A4 | Only one open merge proposal per roadmap at a time (`uq_roadmap_merges_one_open`). |
| A5 | `privacy_consent` is required at registration. |
| A6 | HTTP statuses: validation 422, malformed 400, lockout 423, business-state 409, expired code 410. |
| A7 | Technology Update endpoints are gated on read (`technology_update` feature is access-controlled), unlike other features whose existing data stays readable when disabled. |
| A8 | Daily Plan creation is deterministic scheduling from roadmap effort estimates (no AI call), so it is synchronous. |

## 22.2 Change summary (v1.5.1)

**Added & Aligned:** Resolved all 13 database and infrastructure gaps (`G1`–`G13` in §21) via `DMS v1.2.2` (`020_gaps_and_alignment.sql`) and `SAD v1.1.1` (`ADR-016`–`ADR-020`); locked `EP-P05` atomic profile/progress synchronization (`ADR-019`); locked `EP-X02` deletion tombstone & scoped receipt completion rule (`ADR-020`); locked `EP-M03` synchronous JSON default with opt-in SSE (`ADR-018`).

**Preserved:** REST + `/api/v1`; NestJS modular monolith; TypeScript; Supabase Auth with JWT; PostgreSQL 16+ with Universal RLS; AI Gateway on the Vercel AI SDK; RBAC + permission + ownership checks; all 82 catalog entries (81 HTTP routes + internal EP-G04) and DTO schemas.

## 22.3 Final statement

API Specification Document v1.5.1 is the complete, scoped specification endpoint implementation contract for the AI Career Intelligence Mentor backend, reference-aligned; execution pending with PRD v1.4.1, SAD v1.1.1, DDD v1.2.2, DIS v1.1.1, DMS v1.2.2, AI SD v1.1.1, and UI/UX Specification v2.0.2.

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

## Accepted R07 implementation contract

ProfileResponseDTO and EP-P05 add required progress_initialization enum('deferred_until_level_confirmation','initialized','unchanged'). ProfileSkillDTO.learning_state may show self-reported 'learning' without an unkeyed skill_progress row; career_level context remains absent until confirmed. EP-C05 initializes confirmed level rows in the same confirmation transaction with nonempty state_reason. EP-P02/P05 synchronize all distinct currently confirmed levels. No arbitrary Junior or Focus-first fallback.

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

## Accepted R18 implementation contract

Before navigating, retain a short-lived verification draft in sessionStorage:
{channel, normalized_identifier, contact_masked, expires_at, context}.
Use the entered normalized email/+880 phone for verify/resend; contact_masked
is display only. Navigate /verify?channel=<channel>, with no contact in the URL.
Never store password, OTP, JWT or refresh token in this draft. On reload restore
it until expiry; if absent/expired ask the user to re-enter the identifier using
the existing Input component. Clear on verified/expired/cancelled sign-out.
Apply the same no-PII-in-URL pattern to /reset-password; do not pass identifier
in the query string or analytics. Use a fresh user-entered identifier if recovery
draft state is unavailable.

## Accepted R17 implementation contract

After 202 remain on the existing clarification screen:
/onboarding/clarify?goalId=<confirmed-goal-id>&jobId=<job-id>.
Render AILoadingState and poll EP-J01 using retry_after_seconds. The URL stores
only resource IDs, never goal text/token. On succeeded, validate result_ref.type
and navigate replace to /roadmaps/<result_ref.id>/draft. On failed show the
documented error/retry action while retaining the confirmed goal. Reload resumes
the same job; it must not issue EP-R01 automatically again. Missing/foreign jobs
use the API's unavailable state, not a guessed roadmap route.

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

## Accepted R29 implementation contract

The following are complete required-property consuming schemas. Null is explicit; arrays may be empty. UUID/ISO strings carry OpenAPI formats; counts are nonnegative integers. State-change history requires nonempty reason and changed states; self-report initialization may have null source IDs. EP-G02 returns at most the selected level when filtered and all available rows otherwise; do not fabricate progress.

```typescript
type CareerLevel = 'junior' | 'mid' | 'senior';
type LearningState = 'not_started' | 'learning' | 'practicing' | 'proficient';
interface RoleOptionDTO {
  canonical_role_id: string; name: string; rationale: string | null;
}
interface UnresolvedSkillDTO {
  input: string;
  candidates: Array<{skill_id: string; name: string}>;
}
interface SkillProgressDetailDTO {
  skill_id: string;
  name: string;
  levels: Array<{
    career_level: CareerLevel;
    learning_state: LearningState;
    state_reason: string | null;
    last_evidence_at: string | null;
    evidence_summary: {
      count: number; quiz_attempts: number; practice_reviews: number;
      retry_improved: boolean | null;
    };
    roadmap_requirements: Array<{roadmap_id: string; required_depth: string | null}>;
  }>;
}
interface ProgressHistoryItemDTO {
  id: string; occurred_at: string; skill_id: string; career_level: CareerLevel;
  event: 'state_change' | 'evidence_added';
  from_state: LearningState | null; to_state: LearningState | null;
  reason: string | null;
  source: 'quiz_attempt' | 'practice_review' | null;
  source_id: string | null;
  source_attempt_id: string | null;
}
```

Examples (all outer success envelopes remain unchanged):
RoleOptionDTO normal={"canonical_role_id":"11111111-1111-4111-8111-111111111111","name":"Backend Development","rationale":"Matches goal"}; nullable rationale=null; empty alternative_roles=[] is valid.
UnresolvedSkillDTO normal={"input":"node","candidates":[{"skill_id":"22222222-2222-4222-8222-222222222222","name":"Node.js"}]}; no-match={"input":"unknown","candidates":[]}.
SkillProgressDetailDTO no-evidence={"skill_id":"22222222-2222-4222-8222-222222222222","name":"Node.js","levels":[{"career_level":"mid","learning_state":"learning","state_reason":"Self-reported skill","last_evidence_at":null,"evidence_summary":{"count":0,"quiz_attempts":0,"practice_reviews":0,"retry_improved":null},"roadmap_requirements":[]}]}; empty levels=[] is valid.
ProgressHistoryItemDTO self-report={"id":"33333333-3333-4333-8333-333333333333","occurred_at":"2026-10-19T00:00:00Z","skill_id":"22222222-2222-4222-8222-222222222222","career_level":"mid","event":"state_change","from_state":"not_started","to_state":"learning","reason":"Self-reported skill","source":null,"source_id":null,"source_attempt_id":null}.
For practice_review sources derive source_attempt_id from practice_reviews.attempt_id; quiz_attempt uses its own attempt ID. Never assume review ID is an attempt ID or reveal raw text. Empty history data=[] with normal PageMetaDTO is valid.

## Accepted R30 implementation contract

from/to are inclusive UTC calendar dates; require from<=to. Default to the last
30 UTC dates including today (an operational default, not a new retention rule).
Keep existing totals/by_feature/by_provider. Add series={group_by,buckets}:
day buckets use YYYY-MM-DD UTC and fill zero dates; feature/provider buckets
use their existing aggregate keys. Default group_by=day. Counts/costs only;
no private text. Document the available source-retention window for AI metrics.

UsageSummaryDTO retains range/users/counts/ai and adds required series={group_by:'day'|'feature'|'provider',buckets:UsageBucketDTO[]}. Bucket={key:string,requests:int,estimated_cost_usd:number,failures:int|null,fallbacks_used:int|null,input_units:int|null,output_units:int|null}; day keys are ISO UTC dates with all numeric fields; feature/provider keys use existing aggregates and null unavailable extra dimensions. ai.by_day contains day,requests,failures,fallbacks_used,input_units,output_units,estimated_cost_usd. Backend maps selected ai array to series. Validate range <=366 inclusive UTC dates to bound work; return422 on invalid range. AI source history is only available within retained request window and must be labelled accordingly; do not imply permanent metrics from raw logs.
Example empty day bucket={"key":"2026-10-19","requests":0,"estimated_cost_usd":0,"failures":0,"fallbacks_used":0,"input_units":0,"output_units":0}; zero is valid, not unavailable.

## Accepted R34 implementation contract

Independent capabilities: ratingTarget?:{type:RatingTarget,id:UUID}; reportTarget?:{type:ReportTarget,id:UUID}. Render only supplied permitted capabilities after visibility verification.
Draft rating=roadmap_draft/roadmap_versions.id; draft/locked report=roadmap_content/roadmaps.id.
Merge rating=roadmap_merge/roadmap_merges.id. Topic rating AND report=topic_content/topics.id.
Quiz question report=quiz_question/quiz_questions.id only. Practice review report=practice_review/practice_reviews.id only.
Technology rating=technology_update/technology_updates.id only; mentor neither.
EP-F01/F02 validate owner/delivery/exposure; polymorphic IDs are not proof of access. Report enums must never be inferred from rating enums. Roadmap-content reports retain the chosen roadmap ID, not a version UUID. A hidden shared question/topic must still be reportable when the caller's stored attempt/roadmap shows prior exposure. Duplicate report=>409.

## Accepted N01 implementation contract

Dashboard Screen13 is an optional EP-T01 consumer only after effective technology access is true. Disabled accounts make no preview request; errors/pending outcomes remain local to the card.

## Accepted R16 implementation contract

Every screen inherits component responsive/keyboard behavior (§2), global auth/HTTP handling (§6), privacy-filtered telemetry (§7) and §4 query invalidation. Lists show labelled first-load skeletons; refresh keeps known data/filters. Empty filtered lists offer Clear filters. Failed mutations preserve server state and local edits.

| Screen | Required local behavior |
|---|---|
|14 Career Profile|No goals→explanation + Create goal to /onboarding/goal. Add goal uses same route/server cap. Discontinue confirms affected roadmap, then refreshes goals/roadmaps/Focus; failures preserve edits.|
|19 Progress|No evidence→explain quiz practice; no goal→Create goal; no filter match→Clear filters. Accessible EP-G02 drawer; source_attempt_id opens /quiz/{id}; null/expired sources show retained derived history without invented content.|
|23 Admin usage|API defaults for dates/selector; use C05 series; zero counts valid; no matching audit activity has an empty state. Range errors inline; retry aggregate-only.|
|24 Admin users|Search/status calls EP-AD01; reset cursor on changes; Clear filters on empty. Drawer EP-AD02. Confirm reason before EP-AD03, prevent repeat submission; reload list/detail/access on success; CANNOT_MODIFY_ADMIN preserves state.|
|25 Admin features|EP-AD04 global list; existing user search + EP-AD02 for user. Pessimistic toggles; success EP-AD05/06 reloads access. Override choices enabled/disabled/inherit(null); rejected save restores server value.|

Admin screens explicitly use AZ-ADMIN. Wide admin tables use labelled horizontally scrollable regions; inherit44px targets/focus/keyboard and responsive shell. No user search string, identifier or reason is telemetry. These are local states within existing screens, not additional routes.

## Accepted R28 implementation contract

Inventory:82 catalog entries,81 HTTP operations including GET /health,1 internal-only EP-G04. No POST /progress/evidence exists. Twelve UI service groups are not endpoint/controller counts; do not add endpoints to satisfy an old headline.

## Evidence scope and readiness (R21)

Evidence dimensions are separate: SPECIFIED; STATICALLY CHECKED (named method/evidence); IMPLEMENTED (repository/commit); EXECUTED (command/environment/result); ACCEPTED (review gate).
This correction pack provides specifications and finite static checks, not implemented software or a production certificate. Tests are defined, not passed. R32 remains NOT EXECUTED for database fresh install, rollback/reapply, pgTAP, deletion/RLS/retention/concurrency, API/UI/AI contracts, performance and PITR. C01 product scope remains frozen. Existing numerical latency/RPO/RTO and quality values are targets until measured. Agent review is not owner sign-off.

# END OF DOCUMENT
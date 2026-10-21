# AI Career Intelligence Mentor

# AI System Design Document (AI SD) v1.1.1

## Enterprise AI Architecture & Implementation Handoff Enhancement Edition (Cross-Doc Aligned)

| Metadata Item | Value |
|---|---|
| **Document ID** | `AI-SD-v1.1.1` |
| **Status** | **SPECIFIED / STATIC VALIDATION SCOPED** |
| **Version** | **1.1.1 (Complete Cross-Doc Aligned Implementation Handoff Edition)** |
| **Supersedes** | `AI-SD-v1.1` and `AI-SD-v1.0` |
| **Baseline Architecture Chain** | PRD v1.4.1 (Final Freeze) · SAD v1.1.1 (ADRs 001–020) · API Specification v1.5.1 · DMS v1.2.2 (Migrations 000–020, 50 Tables) · DDD v1.2.2 · DIS v1.1.1 · Database Validation Report v1.1 |
| **Target Audience** | AI Engineers · Backend Engineers · Data Engineers · Security Engineers · QA Engineers · DevOps Engineers |
| **Date** | October 2026 |

---

# Section 1 — Executive Overview

## 1.1 Document Purpose

This document serves as the **authoritative, enterprise-grade AI system implementation specification and engineering handoff contract** for the AI Career Intelligence Mentor platform. It transforms the architectural baseline established in SAD v1.1.1 and the product requirements frozen in PRD v1.4.1 into a deterministic, implementation-ready engineering blueprint.

The purpose of this document is to eliminate ambiguity across engineering disciplines. Upon reading this document, engineering teams can implement, test, secure, operate, and scale the AI subsystem without requiring additional architectural decisions.

### Target Engineering Disciplines & Responsibilities

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          CROSS-FUNCTIONAL ENGINEERING HANDOFF                          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  AI Engineers        │ Implement Gateway, Prompt Manager, Context Builder, Adapters,   │
│                      │ Output Validators, and task-specific rubric evaluators.         │
├──────────────────────┼─────────────────────────────────────────────────────────────────┤
│  Backend Engineers   │ Integrate NestJS modules with AI Gateway, PostgreSQL SKIP       │
│                      │ LOCKED job queue workers (ai_requests), transaction management, │
│                      │ and Supabase PostgreSQL persistence.                            │
├──────────────────────┼─────────────────────────────────────────────────────────────────┤
│  Data Engineers      │ Operationalize token/cost pipelines, retention purge jobs,      │
│                      │ audit logs, and performance telemetry reporting.                │
├──────────────────────┼─────────────────────────────────────────────────────────────────┤
│  Security Engineers  │ Verify prompt injection boundaries, PII minimization, RLS        │
│                      │ firewall rules, and the strict platform admin privacy boundary. │
├──────────────────────┼─────────────────────────────────────────────────────────────────┤
│  QA Engineers        │ Execute 6-layer testing suites, 8-role × 3-language benchmarks,  │
│                      │ adversarial prompt attacks, and scoring consistency audits.     │
├──────────────────────┼─────────────────────────────────────────────────────────────────┤
│  DevOps Engineers    │ Manage provider keys, staging/production environments, circuit   │
│                      │ breakers, incident runbooks, and GitHub Actions CI/CD workflows. │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## 1.2 AI System Vision & Capability Pillars

The platform's primary mission is to deliver personal, adaptive, and highly contextualized technology career guidance for learners and professionals in Bangladesh. Rather than treating AI as an external chatbot or superficial wrapper, AI operates as the core computational engine across five foundational pillars:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              THE 5 AI CAPABILITY PILLARS                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  1. CAREER INTELLIGENCE (Dynamic Intake & Role Resolution)                             │
│     Parses unstructured career aspirations, resolves ambiguous goals via up to         │
│     2 clarification rounds, maps goals to canonical roles, and identifies skill gaps.  │
│                                                                                        │
│  2. PERSONALIZED ROADMAP GENERATION (Adaptive Planning)                                │
│     Synthesizes multi-phase roadmaps prioritized into Core, Supporting, and Optional   │
│     skills, enforces DAG acyclicity, computes merge proposals, and enables 1-step undo.│
│                                                                                        │
│  3. LEARNING & ASSESSMENT (Pedagogical Evaluation)                                     │
│     Generates shared canonical topics, produces standardized 20 MCQ + 5–10 FR quizzes, │
│     and runs formative AI Practice Reviews using task-specific rubrics.                │
│                                                                                        │
│  4. AI MENTOR CONVERSATIONS (Bilingual Adaptive Guidance)                              │
│     Provides contextualized career mentoring supporting Bangla, English, and Mixed     │
│     language inputs, grounded in Focus Roadmap state, with episodic memory summaries.  │
│                                                                                        │
│  5. TECHNOLOGY INTELLIGENCE (Source-Grounded Real-Time Updates)                        │
│     Executes automated web research against verified sources, filters by roadmap       │
│     relevance, assigns action timings (act_now/learn_later/awareness_only), and dedups.│
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## 1.3 Precedence Chain & Frozen Architectural Boundaries (`ADR-016`)

This implementation contract operates under a strict, immutable governance hierarchy. In any case of conflict, earlier artifacts in the chain take precedence:

```text
PRD v1.4.1 ──► SAD v1.1.1 (ADRs 001–020) ──► API Spec v1.5.1 ──► DMS v1.2.2 (000–020) ──► AI SD v1.1.1
```

### Strict Implementation Boundaries

- **Database Freeze (`DMS v1.2.2`):** The **50-table**, **45-enum** relational schema defined in `DMS v1.2.2` (`000_extensions.sql` through `020_gaps_and_alignment.sql`) and certified in `DB Validation Report v1.1` is strictly frozen (`ADR-016`).
- **API Freeze (`API Spec v1.5.1`):** The **82 catalog entries (81 HTTP routes + internal EP-G04)** (`EP-A01` through `EP-H01`) specified in `API Specification v1.5.1` are binding. Request and response DTO formats, status codes, and HTTP headers are immutable.
- **Provider Agnosticism:** Vendor lock-in is prohibited. All model communications must route through the approved provider abstraction layer (**Vercel AI SDK**, PRD §47).
- **Unified Job Queue (`ADR-017`):** Asynchronous AI jobs use PostgreSQL `public.ai_requests` polled by NestJS workers via `SELECT ... FOR UPDATE SKIP LOCKED` (`idx_ai_requests_queue`). Redis is used strictly for ephemeral TTL storage (24h `Idempotency-Key` deduplication, OTP cooldowns, login lockouts, and rate limits).
- **Backend Modular Monolith:** All AI services operate within the NestJS backend architecture running on Node.js with pnpm.

## 1.4 Version 1.1 → 1.1.1 Alignment Changelog

- **Complete 9-Task Output Contracts (§6.2):** Expanded TypeScript contracts to cover all 9 AI tasks (`goal_interpretation` through `technology_update`), adding `gap_type`, `reason`, `sources`, `summary`, and `level_outline` to `RoadmapGenerationOutput` so worker inserts match `DMS 005_roadmap.sql` (`NOT NULL` columns) and `API Spec v1.5.1` (`RoadmapResponseDTO`).
- **Unified PostgreSQL Queue (`ADR-017`):** Replaced dual queue references (`BullMQ` vs. `ai_requests`) with `PostgresJobQueueConsumer` polling `public.ai_requests` via `FOR UPDATE SKIP LOCKED`.
- **Mentor Chat Transport Alignment (`ADR-018`):** Locked `POST /api/v1/mentor/messages` (`EP-M03`) to synchronous `201 Created` JSON (`MessageResponseDTO`, `< 10 s` timeout) via `generateText()` by default for MVP, with SSE streaming (`validated committed reply chunks (SSE)`) supported as a non-breaking opt-in when the client sends `Accept: text/event-stream`.
- **Hourly Timezone-Aware Tech Update Scheduler (§7.5):** Updated the Technology Update scheduler from a single `03:00 UTC` cron to an **Hourly Timezone-Aware Cron (`15 * * * *`)** using `AT TIME ZONE` to honor each user's saved IANA timezone (`PRD §14 & §39`).
- **Dynamic Configuration Lookups (§15 & §16):** Replaced hardcoded rate/report limits with runtime lookups against `public.system_configurations` seeded in `020_gaps_and_alignment.sql` (`ai_quota.roadmap_drafts_per_24h`, `ai_quota.mentor_messages_per_24h`, `roadmap.soft_size_max_topics`, `quality.report_auto_hide_threshold`).

---

# Section 2 — AI Requirements Analysis

## 2.1 Functional AI Requirements (By Task)

The AI subsystem executes nine approved tasks, each mapped directly to the `public.ai_task` database enum:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                9 APPROVED AI TASK TYPES                                 │
├──────────────────────┬─────────────┬────────────────────────────────────────────────────┤
│ Task Enum            │ Mode        │ Primary Function & Business Contract               │
├──────────────────────┼─────────────┼────────────────────────────────────────────────────┤
│ goal_interpretation  │ Synchronous │ Parses free-text goal; max 2 clarification rounds; │
│                      │ (< 10 s)    │ resolves to canonical role; confirms technology.   │
├──────────────────────┼─────────────┼────────────────────────────────────────────────────┤
│ roadmap_generate     │ Async (Job) │ Builds multi-phase DAG roadmap with Core/Support/  │
│                      │             │ Optional tiers, gap_type, and soft size guardrail. │
├──────────────────────┼─────────────┼────────────────────────────────────────────────────┤
│ roadmap_revision     │ Async (Job) │ Applies conversational adjustments to open drafts; │
│                      │             │ preserves immutable version history.               │
├──────────────────────┼─────────────┼────────────────────────────────────────────────────┤
│ merge_proposal       │ Async (Job) │ Computes diff operations for locked roadmaps;      │
│                      │             │ manages level shifts; triggers 1-step undo window. │
├──────────────────────┼─────────────┼────────────────────────────────────────────────────┤
│ topic_content        │ Async (Job) │ Generates shared canonical study text, markdown    │
│                      │             │ explanations, Q&A pairs, and source references.    │
├──────────────────────┼─────────────┼────────────────────────────────────────────────────┤
│ quiz_generate        │ Async (Job) │ Generates standardized 20 MCQ + 5–10 FR quizzes    │
│                      │             │ across Basic, Application, Analysis difficulties.  │
├──────────────────────┼─────────────┼────────────────────────────────────────────────────┤
│ practice_review      │ Async (Job) │ Evaluates FR answers across 3 dimensions; applies  │
│                      │             │ rubrics; returns Good/Needs Work; flags junk.      │
├──────────────────────┼─────────────┼────────────────────────────────────────────────────┤
│ mentor_chat          │ Synchronous │ Bilingual conversational advice (< 10 s JSON;      │
│                      │ (< 10 s)    │ opt-in SSE); episodic summaries; safety redirect.  │
├──────────────────────┼─────────────┼────────────────────────────────────────────────────┤
│ technology_update    │ Hourly TZ   │ Fresh web research; deduplication; relevance       │
│                      │ Batch       │ scoring; action timing; max 1 per user local day.  │
└──────────────────────┴─────────────┴────────────────────────────────────────────────────┘
```

## 2.2 Non-Functional AI Requirements

| Requirement Category | Metric / Specification | Contractual Source |
|---|---|---|
| **Synchronous Latency** | P95 < 8.0 s; Hard timeout at 10.0 s with graceful message persistence | API Spec v1.5.1 §6 |
| **Asynchronous Latency** | `202 Accepted` in < 300 ms; worker P95 < 45.0 s; client polling via `EP-J01` | API Spec v1.5.1 §13.6 |
| **System Reliability** | 99.5% successful generation rate; automatic provider failover | SAD v1.1.1 §11 |
| **Failure Atomicity** | 100% transactional rollback on failure; zero partial database writes | PRD §48 |
| **Cost Optimization** | Dynamic model routing selects lowest-cost model meeting quality bar | PRD §47 |
| **Multilingual Parity** | Support Bangla, English, and Mixed language; scoring parity within 10% | PRD §4, §56 |
| **Context Minimization** | PII stripping before LLM egress; rolling summaries replace raw chat | PRD §49 |
| **Admin Privacy Boundary** | Zero administrator read access to raw user messages, summaries, or context | PRD §51 |

## 2.3 Formal Classification: Facts, Assumptions, and Recommendations

### Architectural Facts (Source of Truth)
- **F-01:** Vercel AI SDK is the mandatory provider-agnostic integration layer (PRD §47).
- **F-02:** Database schema is frozen at 50 tables; all AI usage units and USD costs are auto-computed via SQL triggers (`trg_*_a_total`, `trg_*_b_cost` in DMS v1.2.2).
- **F-03:** Platform administrators must never view private user chat messages, summaries, or AI context records (PRD §51).
- **F-04:** Daily quizzes must contain 20 MCQs and 5–10 free-response questions unless `is_reduced = true` (PRD §29).
- **F-05:** Practice submission unlocks the next daily plan day regardless of score achieved (PRD §33).
- **F-06:** AI operational logs (`ai_requests`) have a 30-day retention; mentor messages have a 90-day maximum retention independent of summaries (PRD §52).
- **F-07:** Asynchronous AI jobs use `public.ai_requests` polled via `FOR UPDATE SKIP LOCKED` (`ADR-017`), and Mentor Chat defaults to synchronous JSON (`201 Created`) with opt-in SSE (`ADR-018`).

### Engineering Assumptions
- **A-01:** Initial production deployment utilizes Google Gemini and OpenAI as primary and secondary approved providers in `public.ai_models`.
- **A-02:** Redis stores 24-hour `Idempotency-Key` deduplication records and OTP/rate-limit counters (`ADR-017`).
- **A-03:** AI web research for technology updates utilizes curated RSS/REST ingestion from approved technical publishers in `public.technology_sources`.

### Architectural Recommendations
- **R-01:** All structured AI tasks enforce JSON Schema validation via structured outputs (`generateObject`).
- **R-02:** Mentor chat supports synchronous `generateText()` by default (`ADR-018`) and `validated committed reply chunks (SSE)` when `Accept: text/event-stream` is requested.
- **R-03:** Provider adapters enforce circuit-breaker patterns to isolate downstream provider degradation.

---

# Section 3 — AI System Architecture Overview

## 3.1 End-to-End System Topology

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              END-TO-END SYSTEM TOPOLOGY                                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  [ CLIENT LAYER ]                                                                      │
│    Next.js Progressive Web App (PWA)                                                   │
│    │                                                                                   │
│    │ HTTPS / REST + Bearer JWT + Idempotency-Key                                       │
│    ▼                                                                                   │
│  [ API & CONTROL LAYER ]                                                               │
│    NestJS Modular Monolith API Gateway (/api/v1/*)                                     │
│    ├── Supabase GoTrue JWT Auth Guard (AccessGuard)                                    │
│    ├── Feature Control Guards (Global & Per-User Overrides)                            │
│    └── Idempotency Interceptor (Redis 24h Deduplication + uq_ai_requests_idempotency)  │
│    │                                                                                   │
│    ├── Synchronous Calls (Target < 10 s: goal_interpretation, mentor_chat) ──┐         │
│    │                                                                         │         │
│    └── Asynchronous Jobs (202 Accepted -> public.ai_requests)                │         │
│        ▼                                                                     │         │
│      PostgresJobQueueConsumer (SELECT ... FOR UPDATE SKIP LOCKED)            │         │
│        │                                                                     │         │
│        └────────────────────────────────────────┬────────────────────────────┘         │
│                                                 │                                      │
│  [ AI SUBSYSTEM (src/ai/*) ]                    ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              AI GATEWAY MODULE                                   │  │
│  │                                                                                  │  │
│  │  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────────────┐  │  │
│  │  │  Context Builder │   │  Prompt Manager  │   │  Model Router                │  │  │
│  │  │  - PII Stripping │   │  - SHA-256 Hash  │   │  - Task-Based Matching       │  │  │
│  │  │  - Context Scopes│   │  - Templates vN  │   │  - Cost/Quality Optimization │  │  │
│  │  └────────┬─────────┘   └────────┬─────────┘   └──────────────┬───────────────┘  │  │
│  │           │                      │                            │                  │  │
│  │           └──────────────────────┼────────────────────────────┘                  │  │
│  │                                  ▼                                               │  │
│  │                      AI ORCHESTRATION ENGINE                                     │  │
│  │                      - Workflow State Assembly                                   │  │
│  │                      - Circuit Breaker & Failover Chain                          │  │
│  │                                  │                                               │  │
│  │                                  ▼                                               │  │
│  │                      PROVIDER ADAPTER LAYER                                      │  │
│  │                      (Vercel AI SDK Core Integration)                            │  │
│  │                      ├── Google Gemini Adapter                                   │  │
│  │                      ├── OpenAI Adapter                                          │  │
│  │                      └── Anthropic Adapter                                       │  │
│  │                                  │                                               │  │
│  │                                  ▼                                               │  │
│  │                      RESPONSE PROCESSING ENGINE                                  │  │
│  │                      ├── Schema Validator (Zod / JSON Schema)                    │  │
│  │                      ├── Product Rule Engine (DAG Acyclicity, Sizing, Guardrails)│  │
│  │                      └── Telemetry & Cost Dispatcher                             │  │
│  └──────────────────────────────────┬───────────────────────────────────────────────┘  │
│                                     │                                                  │
│                                     ▼                                                  │
│  [ PERSISTENCE & TELEMETRY LAYER ]                                                     │
│    PostgreSQL 16+ on Supabase (50 Tables)                                              │
│    ├── AI Operations: ai_requests, ai_generations, ai_models, prompt_versions          │
│    ├── AI Mentor: conversations, messages, conversation_summaries, ai_context_records  │
│    ├── Assessments: quizzes, quiz_questions, quiz_attempts, practice_reviews           │
│    ├── Intelligence: technology_updates, user_update_relevance, update_delivery_history│
│    ├── Feedback: user_ratings, content_reports (with auto-hide threshold trigger)      │
│    └── Triggers: trg_*_a_total (Unit Sum), trg_*_b_cost (USD Math via ai_models)       │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## 3.2 Component Responsibilities Matrix

| Component | Primary Architectural Responsibility | Subsystem Owner |
|---|---|---|
| **AI Gateway Service** | Centralized entry point, interface contract enforcement, request routing | Backend AI Team |
| **Context Builder** | PII stripping, user state aggregation, context boundary isolation | Backend AI Team |
| **Prompt Manager** | Prompt lifecycle management, SHA-256 integrity verification, template rendering | AI Platform Team |
| **Model Router** | Task-to-model mapping, fallback chain management, cost optimization | AI Platform Team |
| **Provider Adapters** | Vercel AI SDK abstraction, provider-specific configurations, raw telemetry | AI Platform Team |
| **Circuit Breakers** | Health monitoring, rate limit handling, automated provider quarantine | DevOps / SRE |
| **Output Validator** | JSON Schema compliance, DAG acyclicity validation, business invariant verification | QA / AI Testing |
| **Cost Tracker** | Recording usage units, interfacing with trigger-driven cost tables | Data Engineering |
| **Postgres Job Consumer** | Polling `public.ai_requests` via `FOR UPDATE SKIP LOCKED`, concurrency throttling, exponential backoff retries (`ADR-017`) | Backend Core Team |
| **Database Triggers** | Mathematical unit summation, sub-cent USD calculations, immutability enforcement | Database Architect |

---

# Section 4 — AI Architecture Components

## 4.1 Centralized AI Gateway

The AI Gateway represents the **sole egress boundary** for all machine learning interactions across the platform.

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              AI GATEWAY COMPONENT LIFECYCLE                            │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  1. Ingress Verification: Validates internal caller authorization and feature access.  │
│  2. Quota Verification: Checks 24h user quotas in public.system_configurations.        │
│  3. Context Collation: Invokes Context Builder for target user and task scope.         │
│  4. Template Binding: Pulls approved prompt template matching active SHA-256 hash.     │
│  5. Route Resolution: Queries Model Router for primary model and fallback order.       │
│  6. Provider Dispatch: Executes call through Vercel AI SDK with configured budget.     │
│  7. Structural Validation: Passes raw output through schema and business validators.   │
│  8. Persistence Dispatch: Writes job state, telemetry, and permanent audit logs.       │
│  9. Egress Transformation: Emits standardized AIResponseContract to calling domain.    │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## 4.2 AI Orchestration Layer (`ADR-017`)

The AI Orchestration Layer coordinates multi-step, state-dependent AI workflows and manages the lifecycle of long-running operations using `public.ai_requests`:

- **State Machine Management:** Tracks states across `queued` → `preparing` → `succeeded` / `failed` (enforced by database trigger `trg_ai_requests_status`).
- **Atomic Worker Claiming:** Commit this claim before external work; SELECT alone is not durable ownership.

```sql
BEGIN;
WITH candidates AS (
  SELECT id FROM public.ai_requests
   WHERE is_async AND status='queued' AND available_at <= now()
     AND attempt_count < $1
   ORDER BY available_at, id LIMIT $2 FOR UPDATE SKIP LOCKED
)
UPDATE public.ai_requests r
   SET status='preparing', locked_by=$3, locked_at=clock_timestamp()
  FROM candidates c WHERE r.id=c.id
RETURNING r.*;
COMMIT;
```
- **Transactional Rollback Boundary:** Ensures that if schema validation or database insertion fails, all partial domain artifacts are rolled back completely and `ai_requests` is marked `failed` (`retryable = true`).

## 4.3 AI Provider Layer & Abstraction

All provider communications leverage the **Vercel AI SDK Core** library (`ai` npm package):

```text
┌─────────────────────────────────────────────────────────────┐
│                 VERCEL AI SDK UNIFIED LAYER                 │
├─────────────────────────────────────────────────────────────┤
│  generateObject() │ For strictly typed JSON schema outputs  │
│  generateText()   │ For synchronous mentor chat (MVP default)│
│  validated committed reply chunks (SSE)     │ For opt-in SSE mentor chat streaming    │
└──────────────────────────────┬──────────────────────────────┘
                               │
       ┌───────────────────────┼────────────────────────┐
       ▼                       ▼                        ▼
┌──────────────┐       ┌──────────────┐         ┌──────────────┐
│    Google    │       ┌──────────────┐         │  Anthropic   │
│    Gemini    │       │    OpenAI    │         │    Claude    │
└──────────────┘       └──────────────┘         └──────────────┘
```

### Fallback Chain Mechanics

```text
Primary Model (ai_models.fallback_rank = 1, is_active = true, real_user_data_approved = true)
   │
   ├── [Success] ──► Return Output (fallback_used = false)
   │
   └── [Timeout / 429 / 5xx / Validation Error]
          │
          ▼
       Fallback Model (ai_models.fallback_rank = 2, is_active = true, real_user_data_approved = true)
          │
          ├── [Success] ──► Return Output (fallback_used = true)
          │
          └── [Failure]
                 │
                 ▼
              Fallback Model (ai_models.fallback_rank = 3)
                 │
                 ├── [Success] ──► Return Output (fallback_used = true)
                 │
                 └── [Failure] ──► Emit AI_SERVICE_ERROR (502) / AI_BUDGET_EXHAUSTED (503)
```

---

# Section 5 — AI Backend Module Architecture

## 5.1 NestJS Directory Structure

The AI subsystem is organized under the `src/ai/` modular namespace within the NestJS backend repository:

```text
src/
└── ai/
    ├── ai.module.ts                            # Root AI subsystem module
    ├── gateway/
    │   ├── ai-gateway.service.ts               # Central execute() entry point
    │   ├── ai-gateway.controller.ts            # Internal diagnostic endpoints
    │   └── guards/
    │       └── ai-quota.guard.ts               # Reads system_configurations 24h quotas
    ├── orchestrator/
    │   ├── ai-orchestrator.service.ts          # Multi-step workflow coordinator
    │   ├── postgres-job-queue.consumer.ts      # Polls public.ai_requests via SKIP LOCKED (ADR-017)
    │   └── state-machine.service.ts            # Job state transition coordinator
    ├── providers/
    │   ├── provider-adapter.interface.ts       # Standard adapter interface
    │   ├── vercel-ai.adapter.ts                # Concrete Vercel AI SDK adapter
    │   ├── model-router.service.ts             # Database-driven route resolver (ai_models)
    │   └── circuit-breaker.service.ts          # Health and quarantine tracker
    ├── prompts/
    │   ├── prompt-manager.service.ts           # Template loader & SHA-256 hash validator
    │   ├── prompt-registry.ts                  # Template version registry
    │   └── templates/                          # TypeScript prompt templates
    │       ├── goal-interpretation.v1.ts
    │       ├── roadmap-generate.v1.ts
    │       ├── roadmap-revision.v1.ts
    │       ├── merge-proposal.v1.ts
    │       ├── topic-content.v1.ts
    │       ├── quiz-generate.v1.ts
    │       ├── practice-review.v1.ts
    │       ├── mentor-chat.v1.ts
    │       └── technology-update.v1.ts
    ├── memory/
    │   ├── context-builder.service.ts          # Multi-source context collation
    │   ├── episodic-summary.service.ts         # Rolling conversation summarizer
    │   ├── ai-context.service.ts               # TTL-managed context records
    │   └── pii-redaction.service.ts            # Privacy boundary minimization
    ├── evaluation/
    │   ├── output-validator.service.ts         # Central output parsing coordinator
    │   ├── dag-validator.service.ts            # Roadmap graph acyclicity engine
    │   ├── rubric-evaluator.service.ts         # Practice review rubric & junk validator
    │   └── schemas/                            # Zod validation schemas for all 9 tasks
    ├── usage/
    │   ├── cost-tracker.service.ts             # Telemetry ingestion service
    │   └── quota-guard.service.ts              # User & system quota enforcer
    └── monitoring/
        ├── ai-logger.service.ts                # Structured JSON logging service
        ├── ai-metrics.service.ts               # Prometheus metrics exporter
        └── health-indicator.service.ts         # AI subsystem health check
```

## 5.2 Module Dependency & Contract Graph

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               MODULE DEPENDENCY GRAPH                                  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│   Domain Modules (Career, Roadmap, Learning, Quiz, Mentor, Technology)                 │
│         │                                                                              │
│         ▼                                                                              │
│   [ ai/gateway/ai-gateway.service ]                                                    │
│         │                                                                              │
│         ├──► [ ai/memory/context-builder.service ]                                     │
│         │       └──► [ ai/memory/pii-redaction.service ]                               │
│         │                                                                              │
│         ├──► [ ai/prompts/prompt-manager.service ]                                     │
│         │       └──► [ ai/prompts/templates/* + PostgreSQL: prompt_versions ]          │
│         │                                                                              │
│         ├──► [ ai/providers/model-router.service ]                                     │
│         │       └──► [ PostgreSQL: ai_models table ]                                   │
│         │                                                                              │
│         └──► [ ai/orchestrator/ai-orchestrator.service ]                               │
│                 │                                                                      │
│                 ├──► [ ai/providers/vercel-ai.adapter ]                                │
│                 │       └──► [ ai/providers/circuit-breaker.service ]                  │
│                 │                                                                      │
│                 ├──► [ ai/evaluation/output-validator.service ]                        │
│                 │       ├──► [ ai/evaluation/dag-validator.service ]                   │
│                 │       └──► [ ai/evaluation/schemas/* ]                               │
│                 │                                                                      │
│                 └──► [ ai/usage/cost-tracker.service ]                                 │
│                         └──► [ PostgreSQL: ai_requests & ai_generations ]              │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

# Section 6 — AI Service Contracts (100% Aligned with DMS v1.2.2 & API v1.5.1)

## 6.1 Core Internal Gateway Interfaces

These contracts govern communication between domain services and the AI Gateway:

```typescript
/**
 * Core Request Contract passed into AIGateway.execute()
 */
export interface AIRequestContract {
  requestId: string;                          // Unique UUID matching public.ai_requests.id
  userId: string;                             // Authenticated user UUID for RLS/ownership context
  task: AITaskEnum;                           // Approved enum from public.ai_task
  featureKey: FeatureKeyEnum;                 // Feature flag key from public.feature_key
  language: UILanguageEnum;                   // 'bn' | 'en' | 'mixed'
  contextScope: {
    roadmapId?: string;
    topicId?: string;
    careerGoalId?: string;
    attemptId?: string;
    conversationId?: string;
  };
  untrustedInputs: Record<string, string>;    // Raw user/web text wrapped in <untrusted_data> tags
  outputSchemaId: string;                     // Matches prompt_versions.output_schema_id
  budget: {
    maxInputUnits: number;
    maxOutputUnits: number;
    timeoutMs: number;
  };
  idempotencyKey?: string;
  isAsync: boolean;
}

/**
 * Standardized Response Contract returned by AIGateway.execute()
 */
export interface AIResponseContract<T = unknown> {
  requestId: string;                          // Matches public.ai_requests.id
  generationId: string;                       // Matches public.ai_generations.id
  status: 'ok' | 'timeout' | 'provider_error' | 'validation_failed' | 'budget_exhausted';
  output: T | null;                           // Strongly-typed validated payload
  providerKey: string;                        // Stored in ai_requests.provider_key (never exposed to client)
  modelId: string;                            // Stored in ai_requests.model_id (never exposed to client)
  fallbackUsed: boolean;                      // Stored in ai_requests.fallback_used
  promptVersionId: string;                    // UUID from prompt_versions table
  usageUnits: {
    input: number;                            // -> input_units
    output: number;                           // -> output_units
    total: number;                            // Auto-computed by trg_*_a_total
  };
  costUsd: number;                            // Auto-computed by trg_*_b_cost
  latencyMs: number;
  validationStatus: 'passed' | 'failed';
  validationErrors?: string[];
  sources: Array<{
    publisher: string;
    url: string;
    retrieved_at?: string;
  }>;
}
```

## 6.2 Task-Specific Output Contracts (All 9 Approved Tasks)

### 6.2.1 Task 1: `goal_interpretation` (`EP-C01`, `EP-C04`)
```typescript
export interface GoalInterpretationOutput {
  isTechnologyGoal: boolean;                  // false -> throw OUT_OF_SCOPE_GOAL (422)
  clarificationNeeded: boolean;
  clarificationRound: 0 | 1 | 2;              // Max 2 rounds (PRD §15)
  clarificationQuestion: string | null;
  proposedRole: {
    canonicalRoleId: string;                  // -> career_goals.proposed_role_id
    name: string;
  } | null;
  alternativeRoles: Array<{
    canonicalRoleId: string;                  // -> career_goals.alternative_role_ids
    name: string;
    matchReason: string;
  }>;
  suggestedLevel: 'junior' | 'mid' | 'senior' | null; // -> career_goals.suggested_level
}
```

### 6.2.2 Tasks 2 & 3: `roadmap_generate` & `roadmap_revision` (`EP-R01`, `EP-R04`)
```typescript
export interface RoadmapGenerationOutput {
  targetLevel: 'junior' | 'mid' | 'senior';
  summary: {                                  // -> roadmap_versions.summary (JSONB, NOT NULL)
    current_situation: string;
    target_interpretation: string;
    expected_career_impact: string;
    next_steps: string[];
  };
  phases: Array<{                             // -> roadmap_versions.phases (JSONB, NOT NULL)
    phase_no: number;                         // -> roadmap_items.phase_no (>= 1)
    title: string;                            // -> roadmap_items.phase_title
    milestones: Array<{ id: string; title: string }>;
    items: Array<{                            // -> public.roadmap_items rows
      lineage_id?: string;                    // Preserved across revisions/merges; generated on v1
      topic_id: string;                       // -> roadmap_items.topic_id (NOT NULL)
      skill_id: string;                       // -> roadmap_items.skill_id (NOT NULL)
      title: string;                          // -> roadmap_items.title (NOT NULL)
      priority: 'core' | 'supporting' | 'optional'; // -> roadmap_items.priority (NOT NULL)
      gap_type: 'existing' | 'transferable' | 'refresh' | 'strengthen' | 'missing'; // -> gap_type (NOT NULL)
      required_depth: string;                 // -> roadmap_items.required_depth
      estimated_effort_hours: number;         // -> roadmap_items.estimated_effort_hours (guidance only)
      sequence_no: number;                    // -> roadmap_items.sequence_no (NOT NULL, >= 1)
      depends_on_lineage_ids: string[];       // -> roadmap_items.depends_on_lineage_ids (DAG validated)
      reason: string;                         // -> roadmap_items.reason
      sources: Array<{ publisher: string; url: string }>; // -> roadmap_items.sources (JSONB, NOT NULL)
    }>;
  }>;
  level_outline: Array<{                      // -> roadmap_versions.level_outline (PRD §18)
    career_level: 'junior' | 'mid' | 'senior';
    outline: string[];
  }>;
  warnings: string[];                         // -> roadmap_versions.warnings
  size_guardrail: {
    active_topic_count: number;
    materially_large: boolean;                // true when active_topic_count > roadmap.soft_size_max_topics
    warning: string | null;
  };
}
```

### 6.2.3 Task 4: `merge_proposal` (`EP-R08`, `EP-R10`)
```typescript
export interface MergeProposalOutput {
  reason: string;                             // -> roadmap_merges.reason
  target_level: 'junior' | 'mid' | 'senior' | null;
  operations: Array<{                         // -> public.roadmap_merge_items rows
    sort_order: number;                       // >= 1
    op: 'add_topic' | 'update_topic' | 'reprioritize' | 'reclassify' | 'retire_topic';
    lineage_id: string | null;                // Required when op <> 'add_topic' (ck_roadmap_merge_items_target)
    topic_id: string | null;                  // Required when op = 'add_topic' (ck_roadmap_merge_items_add)
    title: string | null;
    priority: 'core' | 'supporting' | 'optional' | null;
    reason: string;
    payload: Record<string, unknown>;
  }>;
  size_impact: {
    active_topics_before: number;             // -> roadmap_merges.size_before
    active_topics_after: number;              // -> roadmap_merges.size_after
    materially_large: boolean;                // -> roadmap_merges.materially_large
    warning: string | null;
  };
}
```

### 6.2.4 Task 5: `topic_content` (`EP-L04`, `EP-L06`)
```typescript
export interface TopicContentOutput {
  explanation_markdown: string;               // -> topics.explanation_markdown (NOT NULL when approved)
  important_questions: Array<{                // -> topics.important_questions (JSONB)
    question: string;
    answer_markdown: string;
  }>;
  language: 'bn' | 'en' | 'mixed';            // -> topics.language
  sources: Array<{                            // -> public.learning_resources rows
    title: string;
    publisher: string;
    url: string;                              // Must match ^https?://
    resource_type: 'official_docs' | 'release_notes' | 'article' | 'standard' | 'video' | 'other';
  }>;
}
```

### 6.2.5 Task 6: `quiz_generate` (`EP-Q01`, `EP-Q07`)
```typescript
export interface QuizGenerationOutput {
  is_reduced: boolean;                        // -> quizzes.is_reduced (false => 20 MCQ + 5..10 FR)
  mcq_questions: Array<{
    sort_order: number;
    difficulty: 'basic' | 'application' | 'analysis';
    prompt: string;
    options: Array<{ option_id: string; text: string }>; // 2..6 options (ck_quiz_questions_mcq)
    correct_option_id: string;                // Must exist in options[].option_id
    explanation: string;
    allow_i_dont_know: boolean;
  }>;
  free_response_questions: Array<{
    sort_order: number;
    difficulty: 'basic' | 'application' | 'analysis';
    prompt: string;
    response_hint: 'sql' | 'code' | 'config' | 'test_case' | 'debug' | 'command' | 'design' | 'text';
    rubric: {                                 // -> quiz_questions.rubric (NOT NULL for free_response)
      correctness_criteria: string[];
      understanding_criteria: string[];
      reasoning_criteria: string[];
    };
    max_length: number;                       // 1..8000
    allow_i_dont_know: boolean;
  }>;
}
```

### 6.2.6 Task 7: `practice_review` (`EP-Q05`, `EP-PR02`, `EP-PR03`)
```typescript
export interface PracticeReviewOutput {
  review_status: 'reviewed' | 'not_evidence'; // 'not_evidence' when junk/empty/non-attempt detected
  performance_level: 'good' | 'needs_work' | null; // Required when review_status = 'reviewed'
  dimensions: {
    correctness: 'good' | 'partial' | 'weak';
    understanding: 'good' | 'partial' | 'weak';
    reasoning: 'good' | 'partial' | 'weak';
  } | null;
  strengths: string[];
  mistakes: string[];
  weaknesses: string[];
  improvement_recommendations: string[];
  evidence_eligible: boolean;                 // false when review_status = 'not_evidence' (PRD §31)
}
```

### 6.2.7 Task 8: `mentor_chat` (`EP-M03`)
```typescript
export interface MentorChatOutput {
  content: string;                            // 1..16000 chars; never contains "Job Ready" or job guarantees
  language: 'bn' | 'en' | 'mixed';            // Reflects user input language (PRD §26)
  safety_mode: boolean;                       // true when personal distress detected -> safe redirection (PRD §37)
  learning_claim_recorded: boolean;           // true when user says "I studied this" -> context only, not evidence
}
```

### 6.2.8 Task 9: `technology_update` (`EP-T01`)
```typescript
export interface TechnologyUpdateOutput {
  has_meaningful_update: boolean;             // false -> record state = 'no_important_changes'
  title: string | null;
  what_changed: string | null;
  why_it_matters: string | null;
  publisher: string | null;
  source_url: string | null;
  release_status: 'released' | 'announced' | 'planned' | 'experimental' | null;
  relevance: 'high' | 'medium' | 'low' | null;
  action_timing: 'act_now' | 'learn_later' | 'awareness_only' | null;
  roadmap_relation: string | null;
  propose_roadmap_merge: boolean;             // If true, triggers optional origin='ai_proposal' merge (PRD §38)
}
```

---

# Section 7 — AI Feature Workflows

## 7.1 AI Mentor Conversation Flow (`EP-M03`, Aligned with `ADR-018`)

```text
Client (Next.js PWA)         NestJS Mentor Module          AI Gateway & Memory            AI Provider
      │                               │                             │                          │
  (1) │ POST /mentor/messages         │                             │                          │
      ├──────────────────────────────►│                             │                          │
      │                               │ (2) client_message_id dedupe│                          │
      │                               │ (3) Persist user message    │                          │
      │                               │     in messages table       │                          │
      │                               │                             │                          │
      │                               │ (4) Dispatch to Gateway     │                          │
      │                               ├────────────────────────────►│                          │
      │                               │                             │ (5) Context Builder:     │
      │                               │                             │     Profile + Focus      │
      │                               │                             │     Roadmap + Episodic   │
      │                               │                             │     Summaries only       │
      │                               │                             │                          │
      │                               │                             │ (6) Prompt Manager:      │
      │                               │                             │     mentor-chat.v1       │
      │                               │                             │                          │
      │                               │                             │ (7) Model Router         │
      │                               │                             │                          │
      │                               │                             │ (8) generateText()       │
      │                               │                             │     (or opt-in SSE       │
      │                               │                             │      validated committed reply chunks (SSE) per    │
      │                               │                             │      ADR-018)            │
      │                               │                             ├─────────────────────────►│
      │                               │                             │◄─────────────────────────┤
      │                               │ (9) Safety & Claim Check    │                          │
      │                               │     Distress -> safety_mode │                          │
      │                               │     Claim -> context flag   │                          │
      │                               │                             │                          │
      │                               │ (10) Persist assistant msg  │                          │
      │                               │      Persist ai_generations │                          │
      │                               │      Triggers calc cost     │                          │
      │                               │◄────────────────────────────┤                          │
      │ (11) 201 MessageResponseDTO   │                             │                          │
      │◄──────────────────────────────┤                             │                          │
```

## 7.2 Career Intelligence Goal Interpretation Flow (`EP-C01`, `EP-C04`)

```text
Client (Next.js PWA)        NestJS Career Module          AI Gateway & Validation        Database (PostgreSQL)
      │                               │                             │                          │
  (1) │ POST /career/goals            │                             │                          │
      ├──────────────────────────────►│                             │                          │
      │                               │ (2) Check 3-roadmap limit   │                          │
      │                               │ (3) Create ai_requests row  │                          │
      │                               │     (status: preparing)     │                          │
      │                               │                             │                          │
      │                               │ (4) Execute Gateway call    │                          │
      │                               ├────────────────────────────►│                          │
      │                               │                             │ (5) Context Builder      │
      │                               │                             │ (6) LLM Execution        │
      │                               │                             │ (7) OutputValidator      │
      │                               │                             │     - Scope check        │
      │                               │                             │     - Role match check   │
      │                               │◄────────────────────────────┤                          │
      │                               │                             │                          │
      │                               │ (8) Update status           │                          │
      │                               ├───────────────────────────────────────────────────────►│
      │                               │     - status = 'clarifying' (round 1..2) OR            │
      │                               │     - status = 'awaiting_confirmation'                 │
      │                               │     - ai_requests -> succeeded                         │
      │ (9) 201 CareerGoalResponseDTO │                                                        │
      │◄──────────────────────────────┤                                                        │
```

## 7.3 Roadmap Generation Flow (Asynchronous via `public.ai_requests`, `ADR-017`)

```text
Client (Next.js PWA)       Roadmap Controller/Service      PostgresJobQueueConsumer     Database (Supabase)
      │                               │                             │                          │
  (1) │ POST /roadmaps/generate       │                             │                          │
      ├──────────────────────────────►│                             │                          │
      │                               │ (2) Profile complete gate   │                          │
      │                               │ (3) Check active limit <= 3 │                          │
      │                               │ (4) Insert ai_requests      │                          │
      │                               │     (status: queued)        ├─────────────────────────►│
      │ (5) 202 JobAcceptedDTO        │                             │                          │
      │◄──────────────────────────────┤                             │                          │
      │                               │                             │ (6) Claim job via        │
      │                               │                             │     FOR UPDATE SKIP      │
      │                               │                             │     LOCKED -> preparing  │
      │                               │                             │                          │
      │                               │                             │ (7) Context Builder      │
      │                               │                             │ (8) Provider Execution   │
      │                               │                             │ (9) DAGValidator:        │
      │                               │                             │     - Check cycles       │
      │                               │                             │     - Enforce tiers      │
      │                               │                             │                          │
      │                               │                             │ (10) Single Transaction: │
      │                               │                             ├─────────────────────────►│
      │                               │                             │      - Insert roadmaps   │
      │                               │                             │      - Insert versions   │
      │                               │                             │      - Insert items      │
      │                               │                             │      - ai_requests -> ok │
      │ (11) GET /jobs/{id}           │                             │                          │
      │      (Polling EP-J01)         │                             │                          │
      ├──────────────────────────────►│ (12) Returns status:        │                          │
      │                               │      succeeded + result_ref │                          │
      │◄──────────────────────────────┤                             │                          │
```

## 7.4 Quiz & AI Practice Review Flow (`EP-Q05`, `EP-PR03`)

```text
Client (Next.js PWA)         Quiz & Review Module          AI Evaluation Service         Evidence Service
      │                               │                             │                          │
  (1) │ POST /quiz/{id}/submit        │                             │                          │
      ├──────────────────────────────►│                             │                          │
      │                               │ (2) Auto-grade MCQs from DB │                          │
      │                               │ (3) UNLOCK NEXT PLAN DAY    │                          │
      │                               │     (regardless of score)   │                          │
      │                               │ (4) Enqueue practice_review │                          │
      │ (5) 202 QuizSubmitResponseDTO │     in public.ai_requests   │                          │
      │◄──────────────────────────────┤                             │                          │
      │                               │                             │                          │
      │                               │ (6) Worker claims job       │                          │
      │                               ├────────────────────────────►│                          │
      │                               │                             │ (7) Inspect FR answer    │
      │                               │                             │     Check junk/empty     │
      │                               │                             │ (8) Apply rubric matrix  │
      │                               │                             │     Output: Good/Needs   │
      │                               │                             │ (9) If evidence_eligible │
      │                               │                             ├─────────────────────────►│
      │                               │                             │                          │ (10) Record evidence
      │                               │                             │                          │      Update skill state
      │                               │ (11) Update practice_reviews│                          │
      │                               │      status -> reviewed     │                          │
      │                               │◄────────────────────────────┤                          │
```

## 7.5 Personalized Daily Technology Update Flow (Hourly Timezone-Aware Cron, `PRD §14 & §39`)

```text
Hourly Scheduler (15 * * * *)  Tech Intelligence Worker       External Web Sources       PostgreSQL Database
      │                               │                             │                          │
  (1) │ Trigger hourly TZ check       │                             │                          │
      ├──────────────────────────────►│                             │                          │
      │                               │ (2) Query eligible users:   │                          │
      │                               │     - Active <= 7d          │                          │
      │                               │     - Feature access ON     │                          │
      │                               │     - Local hour >= 6       │                          │
      │                               │     - No delivery row for   │                          │
      │                               │       user's local_date     ├─────────────────────────►│
      │                               │                             │                          │
      │                               │ (3) Ingest fresh feeds      │                          │
      │                               ├────────────────────────────►│                          │
      │                               │◄────────────────────────────┤                          │
      │                               │                             │                          │
      │                               │ (4) Deduplicate via SHA-256 │                          │
      │                               │     content_hash            │                          │
      │                               │                             │                          │
      │                               │ (5) Synthesize Relevance:   │                          │
      │                               │     - Act now / Learn later │                          │
      │                               │     - High / Medium / Low   │                          │
      │                               │                             │                          │
      │                               │ (6) Single Atomic Write:    │                          │
      │                               ├───────────────────────────────────────────────────────►│
      │                               │     - Insert technology_updates                        │
      │                               │     - Insert user_update_relevance                     │
      │                               │     - Insert update_delivery_history                   │
```

Exact eligibility query executed by the hourly worker:

```sql
SELECT u.id, COALESCE(up.timezone, 'Asia/Dhaka') AS tz,
       (now() AT TIME ZONE COALESCE(up.timezone, 'Asia/Dhaka'))::date AS user_local_date
FROM public.users u
LEFT JOIN public.user_profiles up ON up.user_id = u.id
WHERE u.status = 'active'
  AND u.last_active_at >= now() - interval '7 days'
  AND private.effective_feature_access(u.id, 'technology_update')
  AND EXTRACT(HOUR FROM (now() AT TIME ZONE COALESCE(up.timezone, 'Asia/Dhaka'))) >= 6
  AND NOT EXISTS (
    SELECT 1 FROM public.update_delivery_history d
    WHERE d.user_id = u.id
      AND d.local_date = (now() AT TIME ZONE COALESCE(up.timezone, 'Asia/Dhaka'))::date
  );
```

---

# Section 8 — AI Data Flow Design

## 8.1 Ten-Phase Data Flow Architecture

Every AI transaction follows an invariant 10-phase sequence:

```text
Phase 1: Ingress & Client Sanitization
  - Request received via HTTPS with Bearer JWT
  - Parameter types verified; dangerous characters sanitized

Phase 2: Authorization & Feature Gating
  - Account status checked (reject suspended users)
  - Global feature key and per-user access override verified

Phase 3: Idempotency & Queue Enrollment
  - Idempotency-Key validated in Redis (24-hour window) + uq_ai_requests_idempotency
  - Job recorded in public.ai_requests with status = 'queued'

Phase 4: Context Retrieval & Tenant Isolation
  - Context Builder executes parameterized queries filtering strictly by user_id
  - Profile data, active roadmaps, and topic prerequisites aggregated

Phase 5: PII Minimization & Untrusted Wrapping
  - Personal identifiable information (email, phone, real names) stripped
  - User text and fetched web pages wrapped in <untrusted_data> envelopes (PRD §44)

Phase 6: Prompt Compilation & Version Hashing
  - Prompt Manager merges system prompt, context, and untrusted inputs
  - Validates template against SHA-256 hash in prompt_versions table

Phase 7: Provider Routing & Execution
  - Model Router selects primary model based on task approval matrix (real_user_data_approved = true)
  - Call executed via Vercel AI SDK with configured unit/time budget

Phase 8: Output Validation & Business Rules
  - Payload validated against Zod schema (JSON Schema)
  - Domain rules checked (DAG acyclicity, sizing, rubric standards, forbidden phrases)

Phase 9: Persistence & Trigger-Driven Accounting
  - Domain records persisted in single database transaction
  - Triggers compute total_units and cost_usd from ai_models pricing

Phase 10: Egress & Client Delivery
  - Synchronous calls return standardized JSON DTO
  - Asynchronous jobs return 202 Accepted; worker updates ai_requests to succeeded
```

## 8.2 Data Source Access Matrix

| Database Entity | Access Method | Consumed By Task | PII Policy |
|---|---|---|---|
| `user_profiles` | SQL parameterized query | `goal_interpretation`, `roadmap_generate` | Only education level, current title, and daily hours exposed |
| `skills` / `skill_aliases` / `user_skill_aliases` | SQL parameterized query | `goal_interpretation`, `roadmap_generate` | Canonical IDs only; `user_skill_aliases` scoped to owner |
| `roadmaps` / `roadmap_items` | SQL parameterized query | `mentor_chat`, `merge_proposal`, `quiz_generate` | Full structural graph exposed |
| `conversation_summaries` | Keyset pagination query | `mentor_chat` | Only approved summary text; raw messages excluded |
| `ai_context_records` | Key lookup by scope | `mentor_chat`, `technology_update` | Summary text injected directly |
| `technology_sources` | Ingestion fetcher | `technology_update` | Public URLs only |

---

# Section 9 — AI Prompt Management System

## 9.1 Prompt Lifecycle Pipeline

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                PROMPT LIFECYCLE PIPELINE                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  [ STAGE 1: DRAFT ]                                                                    │
│    Authored as versioned TypeScript file in src/ai/prompts/templates/                  │
│    Must define: system prompt, context slots, untrusted input envelope, output schema  │
│                                                                                        │
│  [ STAGE 2: REVIEW ]                                                                   │
│    Peer review by AI Engineer and Prompt Security Specialist                           │
│    Verification of prompt injection defenses and language reflection rules             │
│                                                                                        │
│  [ STAGE 3: OFFLINE EVALUATION ]                                                       │
│    Executed against 8-role × 3-language synthetic test dataset                         │
│    Must achieve > 98% JSON schema parsing rate and >= 90% benchmark quality score      │
│                                                                                        │
│  [ STAGE 4: REGISTRATION & STAMPING ]                                                  │
│    SHA-256 hash calculated from raw template text                                      │
│    Inserted into PostgreSQL prompt_versions table with is_active = false               │
│                                                                                        │
│  [ STAGE 5: PRODUCTION PROMOTION ]                                                     │
│    Operational deployment sets is_active = true on new version; old set to false       │
│    Zero application downtime; immediate effect across all workers                      │
│                                                                                        │
│  [ STAGE 6: TELEMETRY & MONITORING ]                                                   │
│    Tracks validation failure rate, latency, and cost per prompt version                │
│                                                                                        │
│  [ STAGE 7: AUTOMATED ROLLBACK ]                                                       │
│    If validation failures exceed 2% over 15 minutes, automated runbook reverts         │
│    is_active flag to previous known good version                                       │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## 9.2 Template Version Registry Catalog

| Template Key | Version | Approved Task Enum | Output Schema Identifier |
|---|---|---|---|
| `goal-interpretation` | `1.0.0` | `goal_interpretation` | `schema:goal-interpretation:v1` |
| `roadmap-generate` | `1.0.0` | `roadmap_generate` | `schema:roadmap-structure:v1` |
| `roadmap-revision` | `1.0.0` | `roadmap_revision` | `schema:roadmap-structure:v1` |
| `merge-proposal` | `1.0.0` | `merge_proposal` | `schema:merge-proposal:v1` |
| `topic-content` | `1.0.0` | `topic_content` | `schema:topic-content:v1` |
| `quiz-generate` | `1.0.0` | `quiz_generate` | `schema:quiz-package:v1` |
| `practice-review` | `1.0.0` | `practice_review` | `schema:practice-review:v1` |
| `mentor-chat` | `1.0.0` | `mentor_chat` | `schema:mentor-stream:v1` |
| `technology-update` | `1.0.0` | `technology_update` | `schema:technology-update:v1` |

---

# Section 10 — Context & Memory Architecture

## 10.1 Dual Memory Model

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   DUAL MEMORY MODEL                                    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  SHORT-TERM MEMORY (Working Session Window)                                            │
│  ├── Current incoming user message or prompt parameter                                 │
│  ├── Sliding window of the last 6–10 turns within the active session                   │
│  └── Discarded upon completion of the request; never injected as raw unparsed text     │
│                                                                                        │
│  LONG-TERM MEMORY (Persistent Episodic & Snapshot Context)                             │
│  ├── conversation_summaries: Periodic rolling summaries of historical chats            │
│  │   - Generated every 20 conversation turns                                           │
│  │   - Captures goals, weak topics, key decisions, user tone                           │
│  │   - Advances conversations.summarized_through_at watermark for 90d message pruning  │
│  └── ai_context_records: TTL-bounded structured memory records                         │
│      - Context types: profile, roadmap, daily_plan, practice, shared_skill,            │
│        technology_update, conversation                                                 │
│      - Keyed by (user_id, context_type, scope_key)                                     │
│      - Auto-purged on expiration via hourly pg_cron job                                │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## 10.2 Memory Lifecycle Protocols

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 MEMORY LIFECYCLE FLOW                                  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  CREATION ────► Written exclusively by trusted backend services or summary workers     │
│                 No direct client write permissions (Universal RLS + ADR-019)           │
│                                                                                        │
│  STORAGE ─────► Encrypted at rest in Supabase PostgreSQL                               │
│                 Isolated by user_id column with foreign key cascade to auth.users      │
│                                                                                        │
│  RETRIEVAL ───► Filtered strictly by user_id = (SELECT auth.uid())                     │
│                 Context Builder applies max unit ceiling to memory injections          │
│                                                                                        │
│  EXPIRATION ──► ai_context_records: valid_until timestamp checked on query             │
│                 messages: expires_at set to now() + interval '90 days'                 │
│                                                                                        │
│  DELETION ────► Hourly pg_cron: DELETE FROM ai_context_records WHERE valid_until < now()│
│                 Daily pg_cron: DELETE FROM messages WHERE expires_at < now()           │
│                   independent of summary watermark; expiry always wins                              │
│                 Account Delete: Hard cascade deletes all memory instantly              │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

# Section 11 — Knowledge & RAG Evolution Strategy

## 11.1 Current Phase: Structured Relational Knowledge

The platform intentionally avoids complex vector databases, chunking pipelines, and vector embeddings in the MVP phase.

### Justification for Relational-First Architecture
- **Controlled Domain:** The platform manages structured educational curricula, canonical skills, and assessment catalogs rather than unstructured enterprise PDFs.
- **Deterministic Traversal:** Career roadmaps and skill dependencies are strict Directed Acyclic Graphs (DAGs), best modeled and traversed via relational foreign keys.
- **Sub-Millisecond Search:** PostgreSQL GIN Trigram indexes (`idx_skills_name_trgm`, `idx_career_roles_name_trgm`, `idx_skill_aliases_norm_trgm`) provide instant fuzzy matching on technology names without embedding latency.

## 11.2 Future RAG Evolution Roadmap

```text
Phase 1: Structured Relational Knowledge (Current MVP)
  - Exact relational queries + GIN Trigram fuzzy matching
  - Canonical topic caching + real-time web research for tech updates

Phase 2: Hybrid Document Retrieval (Post-MVP Scale: > 2,500 Active Users)
  - Ingestion of official technical documentation and whitepapers
  - PostgreSQL pgvector extension enabled on Supabase
  - Hybrid lexical (BM25) + semantic vector search for mentor queries

Phase 3: Autonomous Career Knowledge Graph (Enterprise Scale)
  - Dynamic graph synthesis across industry job openings
  - Real-time labor market vector clustering
```

### Exact Trigger Criteria for RAG Adoption
RAG infrastructure will be introduced **only** when all of the following conditions are met:
1. Active user base exceeds 2,500 monthly active learners.
2. Unstructured technical documentation corpus exceeds 10,000 reference articles.
3. User report logs demonstrate that standard prompt grounding fails to capture specialized library nuances in > 5% of mentor sessions.

---

# Section 12 — AI Database Integration

## 12.1 Entity Relationship & Schema Mapping (`DMS v1.2.2`)

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                             DATABASE INTEGRATION MAPPING                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  ai_models (Platform-Owned Catalog)                                                    │
│  ├── Columns: id, provider_key, model_identifier, input_price_per_m_units,             │
│  │            output_price_per_m_units, approved_tasks[], real_user_data_approved      │
│  └── Security: Universal RLS DENY (Accessible exclusively via service_role)            │
│                                                                                        │
│  prompt_versions (Immutable Template Registry)                                         │
│  ├── Columns: id, task, name, version, template_ref, template_hash, is_active          │
│  └── Security: Universal RLS DENY (Accessible exclusively via service_role)            │
│                                                                                        │
│  ai_requests (Durable Queue & Operational Telemetry Log)                               │
│  ├── Columns: id, user_id, task, feature_key, status, input_units, output_units,       │
│  │            total_units, cost_usd, latency_ms, validation_status, finished_at        │
│  ├── Triggers: trg_ai_requests_status (State Machine Guard)                            │
│  │             trg_ai_requests_a_total (Auto Unit Sum)                                 │
│  │             trg_ai_requests_b_cost (Auto USD Calculation)                           │
│  └── Retention: Hard deleted at most 30 days from created_at by pg_cron                      │
│                                                                                        │
│  ai_generations (Permanent Audit Trail)                                                │
│  ├── Columns: id, request_id, task, provider_key, model_id, prompt_version_id,         │
│  │            output_hash, cost_usd, total_units, created_at                           │
│  └── Integrity: Survives ai_requests purge (request_id set to NULL on purge)           │
│                                                                                        │
│  conversations & messages (Mentor Domain)                                              │
│  ├── Columns: conversations(id, user_id, context_type, summarized_through_at)          │
│  │            messages(id, conversation_id, user_id, role, content, expires_at)        │
│  └── Privacy Firewall: Zero admin policies; client SELECT permitted only on owner rows │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## 12.2 Trigger-Driven Cost Accounting Mechanics

Cost calculations are executed inside the PostgreSQL database engine (`015_functions.sql`) to guarantee mathematical determinism:

```sql
-- Trigger Function private.calculate_ai_cost() executes BEFORE INSERT OR UPDATE:
NEW.cost_usd := round(
  (
    COALESCE(NEW.input_units, 0) * m.input_price_per_m_units +
    COALESCE(NEW.output_units, 0) * m.output_price_per_m_units
  ) / 1000000.0,
  8
);
```

---

# Section 13 — AI Security Architecture & Data Governance

## 13.1 AI Data Classification Matrix

| Classification Tier | Data Types Included | Allowable AI Usage | Storage & Protection Standard |
|---|---|---|---|
| **Public Knowledge** | Canonical skills, public tech updates, shared topic explanations | Injected into system prompts and model context | Approved shared read access |
| **Protected Profile** | User education, current title, study hours commitment | Injected into context with PII stripped | Authenticated owner read; encrypted at rest |
| **Restricted Private** | Mentor messages, conversation summaries, quiz answers | Scoped strictly to owner sessions; memory injection | Universal RLS; zero administrator access |
| **Controlled Secret** | Provider API keys, JWT signing keys, service role credentials | Never transmitted to LLM; backend runtime only | Managed in GitHub Secrets & Cloud KMS |

## 13.2 Comprehensive STRIDE Threat Model

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              STRIDE AI THREAT MODEL MATRIX                             │
├─────────────────────┬──────────────────┬───────────────────────────────────────────────┤
│ Threat Category     │ Attack Vector    │ Architectural Mitigation & Verification Gate  │
├─────────────────────┼──────────────────┼───────────────────────────────────────────────┤
│ Direct Prompt       │ User inputs      │ Untrusted input wrapping in dedicated data    │
│ Injection           │ system override  │ XML envelopes; system prompt instructs model  │
│                     │ commands in chat │ to ignore imperative statements in user data. │
├─────────────────────┼──────────────────┼───────────────────────────────────────────────┤
│ Indirect Prompt     │ External web     │ Technology research fetcher extracts raw text │
│ Injection           │ sources contain  │ through strict content sanitization; ignores  │
│                     │ exploit text     │ all directive instructions (PRD §44).         │
├─────────────────────┼──────────────────┼───────────────────────────────────────────────┤
│ Sensitive Data      │ LLM regurgitates │ Context Builder applies regex PII redaction   │
│ Leakage             │ user PII into    │ on user names, phone numbers, and emails      │
│                     │ responses        │ before prompt assembly.                       │
├─────────────────────┼──────────────────┼───────────────────────────────────────────────┤
│ Cross-Tenant        │ Attacker queries │ Universal Row-Level Security enforces         │
│ Context Bleed       │ another user's   │ user_id = (SELECT auth.uid()) on all queries; │
│                     │ roadmaps/chats   │ Context Builder enforces user parameter bind. │
├─────────────────────┼──────────────────┼───────────────────────────────────────────────┤
│ Malicious Junk &    │ Automated bots   │ Per-user 24h quotas in system_configurations; │
│ Denial-of-Wallet    │ flood quiz and   │ junk answer classification marks inputs as    │
│                     │ roadmap jobs     │ not_evidence without credit advancement.      │
├─────────────────────┼──────────────────┼───────────────────────────────────────────────┤
│ System Prompt       │ User prompts     │ System instructions explicitly command model  │
│ Extraction          │ model to reveal  │ to refuse prompt extraction requests; test    │
│                     │ hidden prompt    │ suite validates extraction refusal.           │
└─────────────────────┴──────────────────┴───────────────────────────────────────────────┘
```

---

# Section 14 — AI Reliability Architecture

## 14.1 Incident Handling & Failure Matrix

| Failure Condition | Immediate Mitigation | Fallback Behavior | Final System State |
|---|---|---|---|
| **Primary Provider Outage** | Circuit breaker opens on 5 consecutive 5xx errors | Failover to secondary approved model in `ai_models` | Request succeeds transparently; `fallback_used = true` |
| **Provider Rate Limit (429)** | Back off according to `Retry-After` header | Route subsequent traffic to secondary provider | System maintains availability; telemetry alerts team |
| **Synchronous Timeout (> 10 s)** | Abort call at 10.0 s ceiling | User message safely persisted in database | Return `AI_TIMEOUT (504)`; client invited to retry |
| **Schema Validation Failure** | Discard corrupted LLM JSON payload | Automatic retry with same or higher-tier model | Return `AI_VALIDATION_FAILED (502)`; no corrupt DB write |
| **Budget Quota Exhausted** | Quota guard blocks new generation requests | Existing roadmaps, plans, and history fully accessible | Return `AI_BUDGET_EXHAUSTED (503)`; clean error message |

## 14.2 Circuit Breaker Parameters

```text
┌─────────────────────────────────────────────────────────────┐
│                 CIRCUIT BREAKER STATE MACHINE               │
├─────────────────────────────────────────────────────────────┤
│  State: CLOSED (Normal Operations)                          │
│  - Failure Threshold: 5 consecutive failures within 60 s    │
│  - Action on Threshold: Transition to OPEN                  │
│                                                             │
│  State: OPEN (Provider Quarantined)                         │
│  - Behavior: All traffic routes to fallback provider        │
│  - Quarantine Duration: 60 seconds                          │
│  - Action on Duration Expiry: Transition to HALF-OPEN       │
│                                                             │
│  State: HALF-OPEN (Canary Probe)                            │
│  - Behavior: Dispatches 1 test probe to primary provider    │
│  - Success: Transition to CLOSED                            │
│  - Failure: Reset quarantine timer; transition to OPEN      │
└─────────────────────────────────────────────────────────────┘
```

---

# Section 15 — AI Cost Governance (Dynamic `system_configurations`)

All per-user quotas and size guardrails are stored in `public.system_configurations` (`018_seed.sql` and `020_gaps_and_alignment.sql`) so they can be tuned at runtime without code changes (PRD §47, §64):

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                COST GOVERNANCE FRAMEWORK                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  CONFIGURABLE USER-LEVEL QUOTAS (public.system_configurations)                         │
│  ├── ai_quota.roadmap_drafts_per_24h (Seeded Default: 5 per 24-hour rolling window)    │
│  ├── ai_quota.mentor_messages_per_24h (Seeded Default: 50 per 24-hour rolling window)  │
│  └── quiz.retry_limit (Seeded Default: 1 retry per daily plan item quiz, PRD §32)      │
│                                                                                        │
│  SYSTEM-LEVEL CONTROLS                                                                 │
│  ├── Daily Micro-Budget Ceiling: Configured in system_configurations table             │
│  ├── Model Routing Policy: Selects lowest-cost approved model meeting task quality bar │
│  └── Operational Log Retention: 30-day automated purge prevents storage bloat          │
│                                                                                        │
│  ALERTING THRESHOLDS                                                                   │
│  ├── Warning Alert: System expenditure reaches 80% of daily projected budget           │
│  └── Critical Alert: System expenditure reaches 100% of daily projected budget         │
│      Action: Throttles background jobs; preserves interactive chat and quiz grading    │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

# Section 16 — AI Quality Evaluation Framework

## 16.1 Evaluation Modalities

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              EVALUATION MODALITY MATRIX                                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  1. OFFLINE BENCHMARK EVALUATION (Pre-Deployment Quality Gate, PRD §56)                │
│     - Executed via automated test harness before any prompt or model deployment        │
│     - 8 Benchmark Roles: Frontend, Backend, Full-Stack, QA/SDET, DevOps, Mobile,       │
│       Cybersecurity, AI/ML Engineering                                                 │
│     - 3 Language Modalities: Pure Bangla, Pure English, Mixed Bangla-English           │
│     - Minimum Passing Score: 90% rubric compliance across all scenarios                │
│                                                                                        │
│  2. ONLINE CONTINUOUS EVALUATION (Production Telemetry, PRD §24)                       │
│     - 1–5 Star Learner Ratings (public.user_ratings) on Roadmap Drafts, Merges,        │
│       Shared Topic Content, and Daily Technology Updates (`EP-F01`)                    │
│     - User Content Reports (public.content_reports) on Quiz Questions, Practice        │
│       Reviews, Topic Content, and Roadmap Content (`EP-F02`)                           │
│     - Automated Quarantine (`trg_content_reports_threshold`): Shared content hidden    │
│       automatically when independent user reports reach                                │
│       `quality.report_auto_hide_threshold` (Seeded Default: 5 in system_configurations)│
│                                                                                        │
│  3. HUMAN REVIEW & AUDIT (Bi-Weekly Sampling)                                          │
│     - Human review uses synthetic benchmarks and approved shared non-personal content only   │
│     - Multilingual scoring parity audit between Bangla and English responses           │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

# Section 17 — AI Testing Strategy

## 17.1 Six-Layer Testing Architecture

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              6-LAYER TESTING ARCHITECTURE                              │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  Layer 1: Unit Tests (Jest)                                                            │
│  - Validates Context Builder PII stripping algorithms                                  │
│  - Verifies Prompt Manager SHA-256 template hashing                                    │
│  - Tests Model Router fallback ranking logic                                           │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  Layer 2: Integration Tests (Testcontainers + Mock LLM)                                │
│  - Validates end-to-end Gateway execution with deterministic mock responses            │
│  - Tests PostgresJobQueueConsumer (SKIP LOCKED) and database write transactions        │
│  - Verifies trigger-driven cost calculation math in PostgreSQL                         │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  Layer 3: Prompt Regression Tests                                                      │
│  - Golden-file testing comparing new prompt outputs against certified baselines        │
│  - Multilingual evaluation across Bangla, English, and Mixed inputs                    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  Layer 4: Security & Adversarial Attack Tests                                          │
│  - Automated injection attack payloads (jailbreaks, instruction override)              │
│  - System prompt extraction fuzzing                                                    │
│  - Cross-tenant RLS bypass verification                                                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  Layer 5: Load & Concurrency Tests (k6)                                                │
│  - Simulates 100 concurrent users generating roadmaps and chatting                     │
│  - Verifies database connection pool stability under transaction pooling               │
│  - Validates queue worker scaling and rate limit handling                              │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  Layer 6: Model Comparison Tests                                                       │
│  - Comparative evaluation between Gemini, OpenAI, and Claude on identical benchmarks   │
│  - Cost vs. latency vs. quality Pareto frontier optimization                           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

# Section 18 — AI Deployment Architecture

## 18.1 Multi-Stage Environment Progression

```text
Development (Local / Docker)
  ├── Mock AI Provider or Synthetic Validation Keys
  ├── real_user_data_approved = false
  └── Target: Unit and integration testing
        │
        ▼
Staging (Ephemeral Cloud Branch)
  ├── Real AI Provider (Staging Key, Synthetic Data)
  ├── real_user_data_approved = false
  └── Target: 8-role × 3-language benchmark regression suite
        │
        ▼
Production (Supabase Managed Cloud)
  ├── Approved AI Provider (Production Key)
  ├── real_user_data_approved = true
  └── Target: Active user traffic; automated monitoring
```

## 18.2 Secrets & Configuration Management

- **Zero-Storage Rule:** AI provider API keys are never stored in database tables, git repositories, or client code.
- **Runtime Injection:** Keys are injected strictly via environment variables (`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`) through GitHub Actions deployment pipelines into container runtimes.
- **Rotation Runbook:** Key rotation requires updating the environment variable and cycling the container tasks with zero downtime.

---

# Section 19 — AI Monitoring & Operations Runbooks

## 19.1 Observability Metrics & Telemetry

| Metric Identifier | Target SLA | Warning Threshold | Critical Threshold |
|---|---|---|---|
| `ai_request_latency_p95_sync` | < 8,000 ms | > 7,000 ms | > 9,500 ms |
| `ai_request_latency_p95_async` | < 45,000 ms | > 40,000 ms | > 60,000 ms |
| `ai_failure_rate_5m` | < 0.5% | > 2.0% | > 5.0% |
| `ai_fallback_rate_15m` | < 1.0% | > 5.0% | > 10.0% |
| `queue_depth_pending` | < 10 jobs | > 25 jobs | > 50 jobs |
| `daily_cost_burn_usd` | Within budget | > 80% daily budget | > 100% daily budget |

## 19.2 Incident Response Runbooks

### Runbook 1: Primary AI Provider Outage
1. **Detection:** Alert fires on `ai_failure_rate_5m > 5.0%` or Circuit Breaker enters `OPEN` state.
2. **Automated Action:** Gateway router automatically diverts traffic to secondary approved provider (`fallback_rank = 2`).
3. **Engineering Verification:** Check external vendor status dashboard.
4. **Manual Intervention:** If outage persists > 30 minutes, update `ai_models.is_active = false` on primary model to suppress canary probing.
5. **Recovery:** Once vendor resolves incident, re-enable primary model in staging, execute health check, and restore production traffic.

### Runbook 2: Abnormal Cost Spike Event
1. **Detection:** Alert fires on `daily_cost_burn_usd > 80%`.
2. **Identification:** Query `ai_requests` grouped by `user_id` and `task` to isolate anomalous usage patterns.
3. **Containment:** If malicious abuse is detected, toggle `user_access_overrides.enabled = false` for the offending user.
4. **Resolution:** If caused by runaway queue retries, throttle `PostgresJobQueueConsumer` concurrency and patch retry backoff.

### Runbook 3: Model Quality Degradation / Validation Spike
1. **Detection:** Alert fires on `ai_validation_failure_rate > 2.0%`.
2. **Root Cause Analysis:** Inspect `ai_requests.error_message` and validation logs to identify schema mismatch.
3. **Rollback Action:** If caused by a newly deployed prompt template, immediately revert `prompt_versions.is_active` to previous version.
4. **Post-Mortem:** Reproduce failure in staging environment using recorded input hash.

---

# Section 20 — AI Implementation Roadmap

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                             6-PHASE IMPLEMENTATION ROADMAP                             │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  Phase 1: AI Infrastructure Foundation (Weeks 1–2)                                     │
│  ├── Deliverables: AI Gateway module, Vercel AI SDK adapter, Model Router,             │
│  │                 PostgresJobQueueConsumer (SKIP LOCKED), Cost Tracker, Circuit       │
│  │                 Breaker.                                                            │
│  └── Dependencies: PostgreSQL migrations 000–020 applied; Redis instance provisioned.  │
│                                                                                        │
│  Phase 2: Career Intelligence & Goal Parsing (Weeks 3–4)                               │
│  ├── Deliverables: goal-interpretation template, 2-round clarification state machine,  │
│  │                 canonical role resolver, skill gap analyzer.                        │
│  └── Dependencies: Phase 1 complete; career_goals catalog established.                 │
│                                                                                        │
│  Phase 3: Roadmap Generation & Merges (Weeks 5–7)                                      │
│  ├── Deliverables: roadmap-generate template, DAGValidator, merge proposal engine,     │
│  │                 1-step undo reconciliation worker.                                  │
│  └── Dependencies: Phase 2 complete; roadmaps & daily_plans tables active.             │
│                                                                                        │
│  Phase 4: Learning, Quiz & Practice Review (Weeks 8–10)                                │
│  ├── Deliverables: topic-content & quiz-generate (20 MCQ + 5–10 FR) pipelines,         │
│  │                 practice-review rubric evaluator, junk detector, EvidenceService.   │
│  └── Dependencies: Phase 3 complete; quizzes & practice_reviews tables active.         │
│                                                                                        │
│  Phase 5: AI Mentor System & Quality Feedback (Weeks 11–13)                            │
│  ├── Deliverables: mentor-chat template (sync JSON default + opt-in SSE), episodic     │
│  │                 summarization worker, safety guardrails, ratings/reports triggers.  │
│  └── Dependencies: Phase 4 complete; conversations, messages, content_reports active.  │
│                                                                                        │
│  Phase 6: Technology Intelligence & Hardening (Weeks 14–16)                            │
│  ├── Deliverables: Web research fetcher, deduplication engine, hourly TZ-aware batch,  │
│  │                 8-role × 3-language benchmark testing, security audits.             │
│  └── Dependencies: All prior phases complete; technology_updates catalog active.       │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

# Section 21 — Architecture Decision Log (ADR)

| Decision ID | Architectural Decision Summary | Core Technical Rationale | System Impact | Status |
|---|---|---|---|---|
| **D-AI-01** | Vercel AI SDK as standard abstraction layer | Standardizes LLM calls across multiple providers with unified TypeScript APIs | Eliminates vendor lock-in | **FROZEN** |
| **D-AI-02** | Centralized AI Gateway pattern | Prevents fragmented LLM calls across disparate application modules | Centralizes auth, telemetry, and safety | **FROZEN** |
| **D-AI-03** | Trigger-based unit and cost accounting | Moves billing calculations into database engine triggers | Guarantees audit-grade mathematical accuracy | **FROZEN** |
| **D-AI-04** | PostgreSQL `public.ai_requests` (`SKIP LOCKED`) queue (`ADR-017`) | Uses `idx_ai_requests_queue` as the sole durable job queue; scopes Redis to ephemeral TTLs | Eliminates dual-queue state drift | **FROZEN** |
| **D-AI-05** | Episodic conversation summarization | Replaces raw chat histories with compressed episodic summaries | Prevents context overflow; lowers cost | **FROZEN** |
| **D-AI-06** | Relational-first knowledge over Vector RAG | MVP scale and DAG curricula best served by relational schemas and GIN indexes | Lowers infrastructure overhead | **FROZEN** |
| **D-AI-07** | Strict JSON Schema structured outputs | Eliminates unpredictable text formatting errors in machine-parsed tasks | Guarantees deterministic DTO parsing | **FROZEN** |
| **D-AI-08** | Synchronous JSON Mentor Chat default with opt-in SSE (`ADR-018`) | Matches `API Spec v1.5.1 EP-M03` (`201 Created` JSON) while supporting `Accept: text/event-stream` | 100% API/UI contract compatibility | **FROZEN** |
| **D-AI-09** | Circuit breaker pattern on provider adapters | Isolates downstream provider failures and manages automated failover | Protects platform availability | **FROZEN** |
| **D-AI-10** | Untrusted input XML wrapping for prompt defense | Prevents prompt injection attacks embedded in user-submitted text | Closes direct prompt injection vectors | **FROZEN** |
| **D-AI-11** | Universal RLS admin privacy firewall | Enforces platform admin denial on mentor chats and personal context | Complies with PRD §51 privacy mandate | **FROZEN** |
| **D-AI-12** | Permanent audit trail in `ai_generations` | Decouples operational log purges from permanent compliance traceability | Satisfies legal audit requirements | **FROZEN** |
| **D-AI-13** | Configurable soft roadmap-size guardrail (`roadmap.soft_size_max_topics`) | Prevents bloated roadmaps when LLM expands topics | Protects learner pedagogy | **FROZEN** |
| **D-AI-14** | One-step undo window locked by learning start | Closes merge undo (`trg_quiz_attempts_close_undo`) once user starts post-merge quiz | Preserves learning evidence integrity | **FROZEN** |
| **D-AI-15** | Formative practice review over formal grading | Frames AI feedback as developmental guidance rather than certification | Manages learner expectations | **FROZEN** |
| **D-AI-16** | Hourly timezone-aware daily tech update batch | Evaluates user's local calendar day (`AT TIME ZONE`) and enforces 1 outcome per local date | Satisfies PRD §14 & §39 | **FROZEN** |

---

# Section 22 — Final Readiness Assessment

## 22.1 Engineering Discipline Readiness Scorecard

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        ENGINEERING IMPLEMENTATION READINESS SCORECARD                  │
├──────────────────────────┬────────┬────────────────────────────────────────────────────┤
│ Engineering Discipline   │ Status │ Handoff Verdict & Operational Notes                │
├──────────────────────────┼────────┼────────────────────────────────────────────────────┤
│ Backend Engineering      │ SPECIFIED / NOT EXECUTED │ NestJS architecture, PostgresJobQueueConsumer, and │
│                          │        │ all 9 AI task output contracts fully defined.      │
├──────────────────────────┼────────┼────────────────────────────────────────────────────┤
│ AI Platform Engineering  │ SPECIFIED / NOT EXECUTED │ Vercel AI SDK adapters, Model Router ranking, and  │
│                          │        │ prompt versioning pipeline fully specified.        │
├──────────────────────────┼────────┼────────────────────────────────────────────────────┤
│ Database Engineering     │ SPECIFIED / NOT EXECUTED │ 50-table schema (`000`–`020`), triggers, indexes,  │
│                          │        │ and RLS aligned 100% with DMS v1.2.2.              │
├──────────────────────────┼────────┼────────────────────────────────────────────────────┤
│ Security Engineering     │ SPECIFIED / NOT EXECUTED │ STRIDE threat model, untrusted input boundaries,   │
│                          │        │ and admin privacy firewall fully documented.       │
├──────────────────────────┼────────┼────────────────────────────────────────────────────┤
│ Cost & Data Engineering  │ SPECIFIED / NOT EXECUTED │ Trigger-driven accounting, configurable quotas in  │
│                          │        │ system_configurations, and 30d/90d TTLs defined.   │
├──────────────────────────┼────────┼────────────────────────────────────────────────────┤
│ QA & Testing Engineering │ SPECIFIED / NOT EXECUTED │ 6-layer testing hierarchy and 8-role × 3-language  │
│                          │        │ benchmark evaluation harness fully specified.      │
├──────────────────────────┼────────┼────────────────────────────────────────────────────┤
│ DevOps & SRE             │ SPECIFIED / NOT EXECUTED │ Circuit breaker thresholds, incident runbooks,     │
│                          │        │ secrets management, and CI/CD pipelines defined.   │
├──────────────────────────┼────────┼────────────────────────────────────────────────────┤
│ OVERALL STATUS           │ SPECIFIED / NOT EXECUTED │ SPECIFIED / RUNTIME NOT EXECUTED             │
└──────────────────────────┴────────┴────────────────────────────────────────────────────┘
```

## Accepted R11 implementation contract

Human quality review uses synthetic benchmark conversations/practice answers and
approved shared non-personal learning content. It must not sample production
users' private mentor turns, memory, summaries or raw practice answers.
Production quality monitoring uses content-free latency/failure/report metrics.
Do not add a staff/admin content-reading role or use service_role as a human
review exception. Any later consent-based research access is a separate product
and privacy decision, outside this correction.

## Accepted N02 implementation contract

Purge an expired parent while keeping its younger reply with reply_to_message_id=NULL. Test both expired, reply chains and unrelated conversations. Specified ON DELETE SET NULL is not execution evidence.

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

Use the complete RoleOptionDTO, UnresolvedSkillDTO, SkillProgressDetailDTO and ProgressHistoryItemDTO schemas in C05. Properties are required unless optional is explicit; preserve null source IDs. History navigation uses source_attempt_id, never a guessed review-to-attempt UUID.

## Accepted R28 implementation contract

Inventory:82 catalog entries,81 HTTP operations including GET /health,1 internal-only EP-G04. No POST /progress/evidence exists. Twelve UI service groups are not endpoint/controller counts; do not add endpoints to satisfy an old headline.

## Evidence scope and readiness (R21)

Evidence dimensions are separate: SPECIFIED; STATICALLY CHECKED (named method/evidence); IMPLEMENTED (repository/commit); EXECUTED (command/environment/result); ACCEPTED (review gate).
This correction pack provides specifications and finite static checks, not implemented software or a production certificate. Tests are defined, not passed. R32 remains NOT EXECUTED for database fresh install, rollback/reapply, pgTAP, deletion/RLS/retention/concurrency, API/UI/AI contracts, performance and PITR. C01 product scope remains frozen. Existing numerical latency/RPO/RTO and quality values are targets until measured. Agent review is not owner sign-off.

# END OF AI SYSTEM DESIGN DOCUMENT v1.1.1
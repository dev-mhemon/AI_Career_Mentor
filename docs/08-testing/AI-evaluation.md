# AI Quality, Benchmark & Security Evaluation Framework

Derived from [PRD §44 / §47 / §51 / §56](../01-product/PRD.md), [AI System Design §13–§17](../02-architecture/AI-System-Design.md), and `R11`.

## 1. Execution Status Distinction

- **SPECIFIED:** 8 benchmark career roles × 3 language modalities (`bn`, `en`, `mixed`), >=98% structured JSON schema parsing pass rate, >=90% benchmark rubric compliance, and zero PII/prompt-injection/cross-tenant failures.
- **EXECUTED (M04-02 Offline Deterministic Synthetic Gate):** Verified offline via `SyntheticProviderAdapter`, `AiGatewayService`, `OutputValidatorService`, `ContextBuilderService`, `PromptManagerService`, `ModelRouterService`, `CircuitBreakerService`, and `QuotaGuardService` unit/integration suites (`backend/src/ai/*.spec.ts`). Zero live external provider API keys required or called.
- **PENDING (Staging / Production Live Gate):** Live multi-provider (`Gemini`, `OpenAI`, `Claude`) staging regression runs across all 24 scenarios and bi-weekly synthetic benchmark human sampling remain gated on staging credentials and subsequent domain feature modules.

## 2. 8-Role × 3-Language Synthetic Benchmark Matrix (24 Scenarios)

Per `PRD §56` and `C08 §16.1`, every prompt or model revision MUST be evaluated across all 8 benchmark roles and 3 language modalities (24 synthetic cells; benchmarks never restrict user-chosen roles):

| # | Benchmark Role | Bangla (`bn`) | English (`en`) | Mixed Bangla-English (`mixed`) |
|---|---|---|---|---|
| 1 | Frontend Development | `BM-01-BN` | `BM-01-EN` | `BM-01-MX` |
| 2 | Backend Development | `BM-02-BN` | `BM-02-EN` | `BM-02-MX` |
| 3 | Full-Stack Development | `BM-03-BN` | `BM-03-EN` | `BM-03-MX` |
| 4 | QA Automation / SDET | `BM-04-BN` | `BM-04-EN` | `BM-04-MX` |
| 5 | DevOps | `BM-05-BN` | `BM-05-EN` | `BM-05-MX` |
| 6 | Mobile Development | `BM-06-BN` | `BM-06-EN` | `BM-06-MX` |
| 7 | Cybersecurity | `BM-07-BN` | `BM-07-EN` | `BM-07-MX` |
| 8 | AI / Machine Learning Engineering | `BM-08-BN` | `BM-08-EN` | `BM-08-MX` |

## 3. Quality, Structural & Pedagogical Rubric Criteria

| Dimension | Minimum Threshold | Enforcement Mechanism |
|---|---|---|
| Structural & Schema Validity | `>= 98%` (100% deterministic fail-closed) | `OutputValidatorService` per C08 §6.2 schemas; discards malformed JSON and emits `502 AI_VALIDATION_FAILED` |
| Benchmark Rubric Compliance | `>= 90%` across 24 cells | Pedagogical ordering, roadmap DAG acyclicity (`depends_on_lineage_ids`), standard quiz shape (`20 MCQ + 5..10 FR`), evidence eligibility isolation (`not_evidence => evidence_eligible = false`) |
| Language Reflection (`bn`/`en`/`mixed`) | Parity across all 3 modalities | Prompt templates preserve user language; no untranslated fallback regressions on Bangla/Mixed inputs |
| Non-Guarantee Guardrail | `0` job-guarantee claims | `OutputValidatorService` rejects `"Job Ready"` / guaranteed employment phrasing in `mentor_chat` |

## 4. Security, Privacy & Governance Criteria (`PRD §44, §47, §51`, `R11`)

1. **Prompt Injection Isolation (`PRD §44`):** Untrusted user inputs and retrieved web snippets are stripped of closing tag breakouts (`</untrusted_data>`) and wrapped in `<untrusted_data index="N" treat_as="data_only">` XML envelopes with explicit system-prompt precedence directives.
2. **PII & Secret Redaction (`C08 §13.2`):** `ContextBuilderService` strips email addresses, Bangladesh (`+880`/`01...`) and international phone numbers, 10/13/17-digit NIDs, Bearer/JWT/API tokens, and URL userinfo/secret query parameters prior to provider invocation.
3. **Real-User Data Approval Gate (`PRD §47`):** `ModelRouterService` strictly enforces `ai_models.real_user_data_approved = true` whenever `mode === 'real_user'`; unapproved/free-tier models are permitted solely in explicit `mode === 'synthetic'` testing.
4. **Template Integrity (`C08 §9`):** `PromptManagerService` performs constant-time SHA-256 verification against `public.prompt_versions.template_hash` and fails closed (`502 AI_SERVICE_ERROR`) on any mismatch.
5. **No Production Human Content Sampling (`R11` / `PRD §51`):** Human quality audits sample solely synthetic benchmarks and approved shared non-personal content; private `messages`, `quiz_answers`, and `input_payload` are never logged or sampled.

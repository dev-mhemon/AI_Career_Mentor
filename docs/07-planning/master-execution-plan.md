# Master software development execution plan

DOC-02 v0.1 - 2026-10-24 (Asia/Dhaka) - **Draft / proposed for review**.

This is the active development planning document. It proposes work; it does not approve implementation, installation, provider use, commits, pushes, PRs, database operations or deployment. The [DOC-02 record](current-phase/documentation-alignment/DOC-02.md) identifies this local documentation delivery and checks. Use the [shared workflow](../00-governance/agent-workflow.md) for each separately authorized task.

M01-01 progress, 2026-10-24: owner authorized **documentation only**; [current record](current-phase/M01-01.md) delivers five scoped Draft/review-pending documents from fetched main `5a71a5b8196a619ae0960b212fe71e74d79e0fb6`. M01-02 inputs are prepared, pending design review and separate implementation authorization. No M01 code/task M01-02–10 or milestone completion is claimed. DOC-02's branch/SHA/worktree below are its preserved preparation checkpoint, not today's checkout instructions.

## 1. Identity, authority and agreed scope

Repository: dev-mhemon/AI_Career_Mentor; root D:/AI Career Mentor; branch docs/doc-01-agent-workflow; base and full HEAD 74e2f2c8975751d9c1545917ed7fa81be50d4400. Entry: no staged changes, 11 modified tracked documents and two untracked Markdown documents inherited from DOC-01. Continue on that branch to preserve the sequential handoff; no reset, switch, stash, stage or commit. HEAD alone does not identify the edited worktree; see DOC-02 for inherited paths and fingerprints.

DOC-01's external content review resolved its reported findings. It did not independently execute local verifiers or establish owner/release acceptance. DOC-01 and the audit retain dated observations: their statements that DOC-02 is unstarted or this plan is historical describe that earlier checkpoint. This plan and START-HERE now supply current planning status.

Authority follows the [source register](../00-governance/source-of-truth.md), including adopted correction appendices:

| ID | Authority and inspected sections relevant to this plan |
|---|---|
| C01 | [PRD](../01-product/PRD.md) §3–14 scope/access/Auth/profile; §15–24 goals/skills/roadmaps; §25–49 AI/learning/progress/mentor/updates; §50–56 admin/privacy/quality; §58–60 non-goals/acceptance |
| C02 | [SAD](../02-architecture/SAD.md) §4–12 architecture/security/jobs/operations; §14 ADR-001–020; accepted R10–15/R24–27/R31 |
| C03 | [DDD](../03-domain/DDD.md) §4 domains, §5 security, §6 retention; R07–13/R19–21/R25 meaning and evidence limits |
| C04 | [DIS](../04-database/DIS.md) §2/8–10 migration/seed/lifecycle procedures; R05/R14/R19–23/E01 gates |
| C05 | [API](../05-api/API-Specification.md) §3–4/13 conventions, §14 catalog, §15 DTOs, §16 errors, §17 tests, §18–19 workflows/traceability; R07/R12–18/R24–31/R34–35 |
| C06 | [DMS](../04-database/DMS.md) §6/12.3 exact SQL, §13 tests, §14 table/API matrix, §15–18 deletion/rollback/recovery; R05–09/R14/R23/R25–27/R35/E01 |
| C07 | [Validation report](../04-database/validation-report.md) §12–17 verification/performance/provisioning; R21/R23/E01 evidence limits |
| C08 | [AI system design](../02-architecture/AI-System-Design.md) §2–10 tasks/gateway/workflows/memory, §13–19 privacy/evaluation/operations; R11–15/R17/R24–29 |
| C09 | [UI/UX](../01-product/UIUX-Specification.md) §2–8 components, screens, API/cache/error/accessibility/telemetry; R16–18/R29–30/R34/N01 |

C01 owns scope, C02 architecture, C03 domain meaning, C05 HTTP/DTOs, C06 exact SQL, C04 procedures, C08 AI and C09 UX. D001 in [foundation decisions](current-phase/foundation/DECISIONS.md) requires Supabase Auth AND primary PostgreSQL, without legacy replay/data transfer. Retain TypeORM DataSource/EntityManager transactions, synchronize=false and migrationsRun=false. The approved npm/Vitest exception supersedes older pnpm/Jest examples only in that scope. No framework migration is planned.

Agreed MVP: Bangla-first responsive PWA for technology careers; email/BD-phone/password/Google/Facebook access; profiles and explicit beginner None; dynamic goals and confirmed Junior/Mid/Senior levels; up to three active independent roadmaps, one locked Focus; shared skills/knowledge; draft/revision/lock/merge/undo/archive; sequential Daily Plans/Today; MCQ/free-response practice/review; level-scoped progress; contextual mentor; fresh personalized daily technology updates; ratings/reports; deletion; admin/access and AI usage/failure controls. C01 §6/60 governs completeness, not diagram ideas.

C01 §4/36/58–59 exclusions remain: no invitation/admin registration approval, non-tech planning, formal assessment/certification, project generation/evaluation, Job Ready claims, code execution sandbox, manual locked-roadmap editor, course/CMS product, job-market/resume/interview tools, native apps, offline learning, push or full English UI. RAG/vector infrastructure is future conditional work (C08 §11), not an MVP prerequisite. Mentor SSE is optional (ADR-018/R15); JSON is required. R33 retains optional/deferred disposition; no additional R33 scope is inferred.

## 2. Baseline and evidence boundary

SPECIFIED = named contract; IMPLEMENTED = observed source behavior; EXECUTED = command/environment/result at an identified source/worktree; ACCEPTED = explicit named review/owner gate. Static checks, runtime execution and acceptance differ.

| Classification | Inspected observation | Limit |
|---|---|---|
| Delivered foundation | JWT/live identity bootstrap/application mapping; transaction connection manager; status/admin/feature guards; profile/preferences/settings/aliases; goal read/confirmation; completeness and HTTP errors | backend/src/app.module.ts, auth, profile and common contain these; source presence is not full feature acceptance |
| Preserved invariants | OAuth next_step, nullable RoleOptionDTO rationale, optional education/explicit None, deferred level initialization/stronger evidence, transactional goal feature recheck, successful foreground activity, tenant/admin ownership | Existing unit/HTTP regression scope; preserve during later work |
| Partial | Frontend SDK Auth/sync/callback/dashboard, limited health | actions.ts uses six-character signup minimum, identifier in verify URL and sync/me-to-dashboard. C05 A01 requires configured policy (example minimum eight); C09 R18 forbids identifier URL. Client discards me metadata. Findings do not amend requirements |
| Remaining | Canonical A01–A09/A11–A12, full phone/social/link/contact/recovery; Redis controls; deletion/retention worker; AI/jobs/scheduler; wider career/roadmap/learning/quiz/progress/mentor/technology/feedback/admin and UI | Backend has Auth/Profile controllers plus health; no AI SDK/Redis integration in inspected manifests. Future modules/tests below are planned, not scaffolding |
| Unaccepted | Provider/Auth, deletion/RLS faults, purge/recovery, load/connection budget, PITR/security/production and owner release gates | R32 in_progress / partially_executed; R33 optional_deferred |

Reuse historical [endpoint coverage](current-phase/alignment/endpoint-coverage.json) and [screen coverage](current-phase/alignment/screen-coverage.json): 82 catalog entries = 81 specified HTTP operations (including unversioned GET /health) + internal-only EP-G04. Nine foundation entries, one partial health, 71 Planned HTTP entries and one Planned internal entry. Transitional POST /auth/sync is outside that catalog; no POST /progress/evidence exists. Five of 25 screens are partial and 20 Planned. Component, screen and operation counts are different.

Historical [validation](current-phase/alignment/validation.json), 2026-10-21, has base 4dffb54835f62f806accbb883a2cf6557c30bcdf and delivery checkpoint 1fdc6c98c87fe959ba976e767199892999dd598f. Individual tested identities: DB lifecycle 3857af82390fb3eb953929fda67cf6e54009e9d4; later backend HTTP/workflow d2c63c15b2b187e50acff3952924ddcd5263f7b6; frontend lint/unit/build fac739aef5c52a64c7c35d945250ae5c19b083b5; frontend HTTP 1fdc6c98c87fe959ba976e767199892999dd598f. Lifecycle reports 185 original pgTAP assertions per run, separate 27 boundaries/concurrency and 19 additional in-migration assertions, not 204 pgTAP tests. Failed upstream pull/local image adaptation remain limitations. No old result becomes today's runtime PASS.

DOC-02 executes read-only baseline/alignment/link/diff/content checks only, recorded separately. Protected package: 179 entries, 21 forward/21 rollback/eight original suites; frozen C01–C09/manifests remain unchanged. CI config uses npm/Vitest lint/test/build and disposable DB/HTTP checks, Node 24.19.0 / CLI 2.121.0. YAML is not execution; documentation-branch push filters omit this branch. No current application/DB/remote/provider PASS is asserted.

## 3. Development method

Specifications and approved scoped decisions govern behavior. Clarify affected API/DTO/SQL/security contracts before dependent coding; prepare only useful documentation increments. Prefer small vertical slices with observable behavior, allowing bounded infrastructure enablers without a UI. Preserve strict TypeScript, established frameworks and npm/Vitest.

Use test-first work where business rules, ownership, suspension, state transitions, security, concurrency and regressions benefit. Avoid tests that mirror trivial edits. Develop synthetic AI fixtures, task rubrics, adversarial cases and explicit failure criteria with each AI capability. Evaluate grounding, relevance, correctness, multilingual quality and scoring consistency; schema validity alone is insufficient. C08 §16 quality numbers remain targets until a named method/dataset/prompt/model run measures them. This process reduces risk; it cannot eliminate hallucinations or regressions.

Use a separate review step, actual appropriate verification and durable shared-workflow handoff. Record failures and tested source/worktree identity. Reviewer/owner acceptance differs from CI PASS. Sequential Codex/Antigravity handoffs remain default; no additional agents are authorized here.

## 4. Overall milestone roadmap

All new milestones are Proposed. M00 is an observed checkpoint to consume, not rebuild. Each milestone inherits §7 cross-cutting gates. Entry requires task authorization and named prerequisites; exit requires scoped integration evidence/review, not automatic release acceptance. Required documents mean the incremental deliverables in §6, not all nine before any coding.

### M00 - Preserve and consume delivered foundation

- Outcome/areas: retain storage/Auth/access/transactions/profile and verification assets; backend/frontend/Supabase/tooling.
- Sources: C02 ADR-005/006/016/019/020; C05 A10/A13/P01–05/C03/C05; C06 §2–15; D001/npm/Vitest decisions.
- Entry/dependencies/documents: observed checkout/hash checks; existing audit/registers/runbook/evidence. No new schema baseline.
- Exit/gates: protected bytes and foundation regressions preserved; affected behavior freshly checked by each new slice. Historical execution remains scoped, R32 open.
- Decisions: no verified reason to rebuild foundation; installed-catalog/release acceptance still needs authorized evidence.

### M01 - Canonical email access and session boundary (recommended first)

- Outcome: email signup -> code verification -> password login -> general dashboard/profile entry; canonical refresh/logout; suspended sessions reach account shell. Full Auth remains M02, deletion M03.
- Sources: C01 §7–9/53; C02 ADR-006/011/017/R31; C05 §14.1 A01/A02/A04–07/A13, §15.2/17.1/R18/R24/R31; C09 Screens02–04/07/13/22/§6.
- Entry/dependencies/areas: M00 plus task authorization; backend Auth/common/config, frontend Auth/client/session/forms/routes, Redis enabler. Live email needs approved configuration; mocks/synthetic development can start independently.
- Documents: M01-01 thin Auth contracts/rules/QA/backend map; frontend map with UI work. Detailed tasks in §5.
- Exit/gates: M01-01–10 reviewed and executed for claimed scope; shared limits, no unverified session/contact URL, basic access without complete profile, real destinations. Provider delivery evidence is separate; not a public MVP/deletion acceptance.
- Decisions: owner priority pending; session persistence/adapter boundaries are constrained engineering choices resolved in M01-01.

### M02 - Complete required Auth and identity lifecycle

- Outcome: BD +880 phone/password/local SMS, Google/Facebook, verified contact/add/link, email+phone forgot/reset-password with old-session revocation; Screens05–06 and Auth settings.
- Sources: C01 §8–12/53/60; C02 ADR-009/R31; C05 A01–A12/§17.1/R18/R31; C09 Screens02–06/22.
- Entry/dependencies/areas: M01 shared limits/session boundary; backend adapters/Auth, frontend recovery/callback/settings. Split phone send/verify, recovery, social routing, linking and contact into separate authorized tasks.
- Documents: extend specified/implemented OpenAPI, identity mapping, architecture/QA; verify provider capability against contracts before adapter coding.
- Exit/gates: actual configured SMS/email/OAuth tests; wrong/expired/replayed codes, lockout/resend/outage; no merge on unverified metadata; conflict-safe authenticated linking; Facebook missing verified contact and OAuth next_step routing; session revocation and no identifier reset URL. Preserve A10/A13 source.
- Decisions: SMS selection/terms/cost/log retention and provider configuration block live tests only; email recovery/synthetic adapter work can proceed. Email-only does not satisfy full MVP Auth.

### M03 - Deletion, privacy and retention operations

- Outcome: explicit re-authenticated deletion, scoped receipt/status, atomic local tombstone and bounded provider outbox; private text expires on reads and is physically purged with monitored recovery. Suspended users retain deletion access.
- Sources: C01 §7/13/52; C02 ADR-020; C03 §5/R08–09; C04 §9; C05 X01/X02/R05/R06/R14/R35; C06 §15/R05–09/R35; C08 R11/N02; C09 Screen22/§6.
- Entry/dependencies/areas: M01 Redis/session; M02 re-auth/contact for full integration. Account/maintenance worker and settings. Receipt/outbox/retention synthetic development may start on M01.
- Documents: QA deletion/fault matrix, exact DTO/DB/schema map, worker boundaries and recovery notes; existing frozen SQL reused.
- Exit/gates: AZ-SUSP, dedicated receipt signature/audience/expiry, null-owner status, 401/404/network does not mean success; faults before/during cascade/before commit; local completion independent of provider acknowledgement; minimal encrypted refs, finite retries/deadline; raw answers/messages at most 90d and operations at most 30d, read cutoffs, measured purge-lag/outage/oldest-text alerts. No admin private-content access.
- Decisions: signing/encryption owner and provider deletion capabilities/terms; applicable safeguards before real-user AI acceptance, no indefinite provider-failure hold on local deletion.

### M04 - AI gateway, durable jobs and replay controls

- Outcome: task-approved provider abstraction, validation/provenance/quotas/fallback, owned durable jobs/polling and safe H-IDEM replay.
- Sources: C01 §25–26/44/47–49/56; C02 ADR-008/014/017/R12–14/R26; C05 §13/15.12/J01; C06 §6.9/12.3/R13/R14; C03 R12; C08 §3–6/9/13–19.
- Entry/dependencies/areas: M00/M01 Redis; backend AI/platform/workers and typed job client. M03+task/model/data approval gates real-user processing, not synthetic work.
- Documents: backend/DTO/DB maps, OpenAPI J01 (internal AI stays internal), initial AI-evaluation/QA; public configuration only with real consumers.
- Exit/gates: atomic validated producer envelope/request; committed SKIP LOCKED claim before external call; heartbeat/fence/reaper, bounded attempts/deadline; owner/version/access recheck; atomic artifact/result/status and input clearing. Redis 24h user/key/method/route/body binding, ambiguous-crash and acknowledged-loss barrier fail closed; PING does not establish state survival. No payload in client/admin/logs; no exactly-once billing. Synthetic privacy/injection/failure/initial benchmarks.
- Decisions: approved task/model/data tiers before live use; engineering review for Redis loss epoch/recovery and connection budget. New durable replay storage needs separate schema review.

### M05 - Profile, goals and canonical knowledge

- Outcome: complete beginner-safe onboarding; dynamic tech-role goals, at most 2 clarifications, confirmed role/level; list/edit/discontinue/catalog. Preserve existing profile/alias/confirmation.
- Sources: C01 §3/14–18/23; C03 career/R07; C05 P01–05/C01–07/§15.3–4/R07/R29; C08 §6.2.1/7.2; C09 Screens07–11/14.
- Entry/dependencies/areas: M01 profile entry/M04 synchronous goal task; backend profile/career/catalog, frontend onboarding/career. Profile/skills/preferences UI can use existing endpoints before live AI.
- Documents: rule/test index, OpenAPI/DTO mapping, role/skill provenance and goal rubric/UI architecture.
- Exit/gates: out-of-scope/ambiguous goals, 2-round and 3-active boundaries/races; no guessed role/level; nullable rationale; private alias interpretation, 100-skill cap, explicit None/no artificial skills, stronger level evidence; generation-off reads/transaction rechecks. Full discontinue/replacement roadmap effects integrate M09.
- Decisions: uncertain mapping requires clarification/validation, never automatic global truth; M04 provider gate applies.

### M06 - Draft, revision, lock and initial Focus

- Outcome: generate/review/revise/lock an owned roadmap; list/version/archive basics and one locked Focus/up to 3 active roadmaps. Complete plan switching is M07; merge/undo M09.
- Sources: C01 §16/19–23; C05 R01–07/R14–15/§17.3/R12–14/R17; C06 roadmap constraints; C08 roadmap tasks; C09 Screens11–12/15/R17.
- Entry/dependencies/areas: M04 jobs/replay, M05 confirmed goal/profile; roadmap/AI backend and draft/view UI.
- Documents: state/version/owner/size contracts, mapping/OpenAPI/QA and grounded benchmark cases.
- Exit/gates: one open draft, DAG/source validity, profile/confirmed level, stale input/version, explicit lock/no silent edits, cap/Focus races. R17 stays on clarification after 202, reload polls same job, validates result_ref then navigates without automatic re-generation. Archive/history preserved; M07 before full Focus plan claim.
- Decisions: reviewed soft-size default/task model; no invented hard topic cap or guaranteed timeline.

### M07 - Daily Plans, shared topic content and Today

- Outcome: confirm hours/create/rebuild roadmap-owned sequential plans; Focus switching resumes each plan; Today shows next incomplete day/explanation/resources/questions/practice entry.
- Sources: C01 §16/23/27–30; C05 L01–07/R14/R12–14; C06 learning; C08 topic_content; C09 Screens13/16–17.
- Entry/dependencies/areas: M06 locked roadmap/M04 content jobs; learning/Focus backend, Today/plan/dashboard frontend.
- Documents: sequence/rebuild/start-activity contracts, content version/provenance rubric, UI cache/recovery map and QA.
- Exit/gates: missing hours prompt/saveback, no calendar skipping, non-Focus plans, resume existing plan, rebuild never edits roadmap/completed days, feature-off reads, shared-content dedup/version, Preparing/failure preserves state. Practice integrates M08; start-activity boundary consumed by M09.
- Decisions: task-approved shared-content quality, no offline-course expansion.

### M08 - Quiz, AI Practice Review and evidence-based progress

- Outcome: generate/start/autosave/resume/submit/retry, answer-key MCQ grading, structured free-response review, explainable skill/level progress/history.
- Sources: C01 §29–36/52; C03 assessment/progress; C05 Q01–07/PR01–03/G01–04/R07/R29; C06 evidence/retention; C08 §6.2.6–7/7.4/16–17; C09 Screens18–19.
- Entry/dependencies/areas: M07 topic/plan/version, M04 review jobs; M03 before real-user responses; quiz/review/progress backend and practice/history UI.
- Documents: visibility/submission/retry/evidence contracts, rubric/junk/scoring-parity fixtures, expiry mapping, QA/AI-evaluation.
- Exit/gates: standard 20 MCQ+5–10 free-response, justified smaller-topic exception; difficulty is separate from career level; no early answer-key leak/arbitrary expiry; autosave races/resume, one retry retains both evidence sets; submission unlocks next day regardless score. Expired raw text safe; no click-only evidence/single 90% Proficient rule/Job Ready. G04 internal; reasons/stronger evidence/null sources preserved.
- Decisions: scoring consistency/model quality needs actual evaluation beyond schema validation.

### M09 - Merge, level change, reconciliation and undo

- Outcome: user/optional AI proposals reviewed/accepted/rejected; replacement/discontinue archives correctly; one eligible undo restores previous roadmap and future incomplete plan.
- Sources: C01 §18/21–22; C05 R08–13/C07/§18.4; C06 merge/plan triggers; C08 merge task; C09 §5/Screen15.
- Entry/dependencies/areas: M06 versions, M07 real plan/history, M08 start/evidence integration; roadmap/learning/progress backend and diff/undo UI.
- Documents: atomic reconciliation snapshots, replay/version/undo eligibility, evidence mapping and race/failure QA.
- Exit/gates: explicit accept, no silent change; add/update/reprioritize/retire retains evidence/completed days; future incomplete days only; last-merge undo before post-merge learning; accept/start/undo races/stale-version/rollback; no cross-level Proficient copy or same-goal level-change archive; expansion warning.
- Decisions: snapshot/transaction choice must fit C06; needed schema defect needs forward review. Never accept merge early without actual plan reconciliation.

### M10 - Contextual mentor and bounded memory

- Outcome: owned conversations/history, multilingual contextual career guidance, safe distress/out-of-scope behavior; summaries never extend raw retention.
- Sources: C01 §26/37/49/52; C05 M01–04/R08/R11/R15; C06 mentor; C08 §7.1/10/13/16; C09 Screen20.
- Entry/dependencies/areas: M04 gateway, M05/M07/M08 for full profile/Focus/topic/practice context; M03 before private chat; mentor/memory backend and UI. Synthetic safety work can start earlier.
- Documents: scoped memory/PII/expiry contracts, synthetic safety/adversarial/language fixtures, UI recovery/QA.
- Exit/gates: synchronous 201 JSON default; client_message_id replay, owner-only context; no admin/private sampling, "I studied" evidence or job guarantee; raw expiry despite summarizer failure; parent-purge/younger-reply chains. Optional SSE emits validated committed chunks only; EOF does not mean completed/no automatic new-ID repost.
- Decisions: task/data approval; SSE priority does not block required JSON or force R33 completion.

### M11 - Personalized daily technology intelligence

- Outcome: enabled eligible users get stored fresh/relevant local-date outcomes independently of opening app; view/source/fetch/delivery work.
- Sources: C01 §38–46; C03 R25; C05 T01–03/R24–25/N01; C06 technology/R25; C08 §7.5; C09 Screen21/optional Screen13 preview.
- Entry/dependencies/areas: M04 research/gateway, M05 goal/timezone, M06 Focus/M07 learning context; incorporate M08 evidence when available; fetch/scheduler/technology backend and UI.
- Documents: trust/freshness rubric, pinned-session/date/timezone protocol and connection budget, outage/race QA/recovery.
- Exit/gates: default OFF; active/global/user/last 7 days eligibility; R24 server activity, no refresh/read renewal; pinned session lock per user/captured date, release finally, discard on session loss; recheck date/timezone/access, unique committed outcome, no fake reservation row/stale-model today. Dedup/no-change/unavailable/pending distinct; hourly best effort is not a fixed-time guarantee; tech reads require access.
- Decisions: approved research/model/terms and scheduler capacity; optional N01 preview never blocks core dashboard.

### M12 - Quality feedback and shared-content safety

- Outcome: authorized target-specific ratings/reports, independent-user threshold hiding and safely evaluated regeneration.
- Sources: C01 §24/32; C05 F01–02/R27/R34; C06 threshold; C08 §16; C09 feedback capabilities.
- Entry/dependencies/areas: M06 draft/roadmap, M07 topics, M08 question/review exposure, M09 merge targets and M11 updates for full integration; feedback/visibility backend and producer UI. Start each target when its producer exists, before wider rollout.
- Documents: exact target-ID/owner/visibility/exposure map, threshold race QA and regeneration evaluation.
- Exit/gates: rating draft/version/merge/topic/technology only; report roadmap/topic/question/review; hidden content reportable with prior exposure; duplicate 409; READ COMMITTED advisory statement before INSERT snapshot, threshold/rollback races; no staff private sampling, target enums/IDs never interchangeable.
- Decisions: validated R26 operational thresholds; no new product policy inferred.

### M13 - Admin, feature controls and usage operations

- Outcome: server-authorized suspend/reactivate, global/per-user access/default-OFF tech enablement, content-free audit/usage series; Screens23–25.
- Sources: C01 §7/50–51; C05 AD01–08/R10/R16/R26/R30; C06 access/admin/audit; C09 Screens23–25.
- Entry/dependencies/areas: M00/M01 access/session; M04 actual metrics. Control API/UI may start on M01 and must integrate before live pilot; full regression uses later producers.
- Documents: admin bootstrap/ownership operating notes, exact DTO/maps, query-window/privacy QA; no CMS/budget-management UI.
- Exit/gates: no JWT-role trust/admin ownership bypass; CANNOT_MODIFY_ADMIN, audited/reasoned writes, inherit(null), global OFF priority, suspension exceptions, existing-data reads except tech; counts/cost-only inclusive UTC series, zero fill, 366-day bound and retained-window label; no private content/telemetry.
- Decisions: named production admin/access owner; routine query/UI choices within contracts need no new product decision.

### M14 - Complete UX, operational qualification and release acceptance

- Outcome: integrated Bangla PWA across 25 screens/29 component contracts, error/recovery/access states, complete C05 EP-H01 health behavior and performance/security/recovery evidence; explicitly accepted release candidate.
- Sources: C01 §54–56/60; C02 §9–12; C04 §10; C05 EP-H01/§17; C06 §17–20/R23/E01; C07 §12–17; C08 §16–19; C09 §2–8/R16.
- Entry/dependencies/areas: M01–M13 integration; app/DB/CI/operations. Accessibility/error/recovery/localization are required per slice; operational design starts early.
- Documents: full QA/AI evaluations, actual maps and deployment/ownership/rollout/rollback/PITR/security plan. No deployment authorized here.
- Exit/gates: §7 R32 sub-gates with exact revision/environment/artifacts; mainstream browsers, 360/768/1024+ layouts/slow networks, practical WCAG 2.1 AA/keyboard/focus/labels/contrast/reduced motion, privacy telemetry, PWA manifest without offline/push. Complete unversioned /health exposes contract version/time and real database/queue checks, returns 503 on dependency failure, and leaks no provider details/secrets. Provider/data approvals and operational recovery; remote CI identity and reviewer/owner release acceptance separate.
- Decisions: destination, access/security/backup/monitor/on-call owners and explicit release authorization; R33 optional/deferred.

### Dependency/readiness review

This graph describes integration dependencies; task-level independent work may start sooner within authorization.

| ID | Integration predecessors | Additional gate / independently ready work |
|---|---|---|
| M00 | none | Existing checkpoint, not new foundation build |
| M01 | M00 | Owner authorizes first bounded task; synthetic email before live approval |
| M02 | M01 | SMS/social approval blocks live tests, not email recovery/fixtures |
| M03 | M01, M02 | Receipt/outbox/retention can begin with synthetic re-auth after M01 |
| M04 | M00, M01 | M03+provider/data approval before real-user AI; mocks/queue earlier |
| M05 | M01, M04 | Existing profile UI can precede live goal AI |
| M06 | M04, M05 | M07 needed for full Focus plan behavior |
| M07 | M06 | Practice integration M08; no claim of completed quiz here |
| M08 | M04, M07 | M03 before real private submissions |
| M09 | M06, M07, M08 | Real plan/evidence/start integration before merge/undo acceptance |
| M10 | M04, M05, M07, M08 | Synthetic safety earlier; M03 before private chat |
| M11 | M04, M05, M06, M07 | Scheduler/research fixtures before live provider approval |
| M12 | M06, M07, M08, M09, M11 | Incremental target safety with each producer, not postponed until M11 |
| M13 | M00, M01, M04 | Controls earlier on M01; usage after M04 |
| M14 | M01–M13 | Full required scope, privacy/feedback/admin and owner gates |

No cycle: all integration predecessors have lower IDs. M04's real-user gate depends on M03; M03 does not depend on AI jobs (deletion outbox uses account_deletion_requests). M06 lock can precede plan generation; M07 provides it; M09 completes merge/undo. M05 UI need not wait for full phone/social. M14 preparations start early, final acceptance waits for all. Logical independence does not authorize concurrent writers.

## 5. Detailed first milestone: M01 (conditionally proposed)

Owner selection/implementation authorization remains pending. M01 has direct C01 §7–9/53 and C05 §14.1 dependencies, removes email SDK/sync bypass of canonical limit/error contracts, and supports deterministic synthetic checks without choosing an SMS/AI provider. Alternatives: prioritize M03 privacy before live pilot, M13 access controls, or M04 synthetic AI/jobs for a demo. None removes full Auth/privacy/release requirements. Planning proceeds without requiring a priority answer.

Already delivered: JWT/live mapping, A10/A13, P01–05, C03/C05, guards/errors/transactions. New M01: email portions of A01/A02/A04/A05, A06/A07, canonical frontend integration, R18 verification transport and real landing destinations. Phone, email/phone recovery, full OAuth/contact/linking remain M02; deletion M03. Preserve existing phone/social behavior without calling it accepted.

### Common task contract and commands

Each task begins by comparing actual shell/root/branch/HEAD/index/worktree with the handoff, reading root/scoped AGENTS and affected authority. Frontend coding requires frontend/AGENTS and installed Next.js guidance. Preserve DOC-01/DOC-02 work; no overlapping writers. Target areas below are proposals for future task authorization. Future adapters/tests/routes are explicitly planned, not existing. Frozen core/baseline/SQL/original tests/hashes and unrelated modules are excluded throughout. Dependency/lockfile/script/CI/schema changes require explicit future scope; this plan changes none.

All tasks deliver a bounded diff plus one current shared-workflow record: changed paths, contract decisions, permitted synthetic fixtures, checks/exits, tested identity/artifacts, unresolved cases and next-ready task. Separate sequential review resolves findings; owner acceptance stays separate. Extend meaningful existing Vitest tests; no framework change or trivial mirrored tests.

The following commands exist; they are future task checks, NOT executed by DOC-02. Use npm.cmd in PowerShell, npm in working Git Bash; resolve installed tooling at intake. Capture each command's exit separately.

| Key | Existing commands and limits |
|---|---|
| V-DOC | python scripts/foundation/verify-baseline.py; python scripts/alignment/verify.py; git diff --check; git diff --cached --check |
| V-B | npm.cmd --prefix backend run lint; npm.cmd --prefix backend test; npm.cmd --prefix backend run build |
| V-F | npm.cmd --prefix frontend run lint; npm.cmd --prefix frontend test; node scripts/foundation/local.mjs frontend-build (prepared authorized config required). Direct npm.cmd --prefix frontend run build also exists |
| V-HTTP | node scripts/foundation/local.mjs backend-e2e; node scripts/foundation/application-check.mjs; node scripts/foundation/frontend-check.mjs. Only after separately authorized positive disposable-project identification/setup; helpers start apps and application checks create synthetic DB data |
| V-NEW | Planned, NOT yet implemented: canonical Auth HTTP cases, multi-instance Redis races/outage, browser draft/session routing. Add narrowly to existing tests/helpers or reviewed harness, then execute. No dedicated current command claimed |

Existing backend E2E covers health; foundation HTTP/form helpers alone cannot prove new Auth. Service/reset commands are not documentation checks. No new browser tooling is installed here; a future need requires justified authorized scope. V-HTTP never targets shared/hosted DBs.

### M01-01 - Resolve email/session contract increment

Progress: documentation deliverables authored and checked in the [M01-01 record](current-phase/M01-01.md), **Draft / review pending**. [Architecture](../02-architecture/backend-architecture.md), [rules](../03-domain/business-rules.md), [OpenAPI](../05-api/openapi.yaml), [mapping](../05-api/DTO-DB-mapping.md), [QA](../08-testing/QA-plan.md) distinguish implementation/proposal/evidence. Provider/pending-row/session findings ES-01–06 remain in [open issues](../00-governance/open-issues.md#m01-01-contract-findings). Owner acceptance and review of M01-02 inputs remain open; the task's bounded documentation delivery does not complete M01.

- Goal/dependencies: first task after owner priority/authorization; M00 and current docs. Resolve adapter/session handoff before dependent coding.
- Sources/invariants: C01 §7–9; C05 §13/14.1/15.2/16/17.1/R18/R24/R31; C06 §6.1–2; C09 Screens02–04/07/13/22/§6. Incomplete profile never blocks dashboard; OAuth's third next_step remains in shared types.
- Targets/exclusions: maintained architecture/domain/API/testing docs/current record; read source/public templates. No app/provider/schema edits.
- Deliverables: thin backend Auth/session map, linked rule/QA slice, OpenAPI increment with specified/planned vs implemented scope, relevant DTO/DB map. Define canonical token -> existing SSR cookie/session handling, confidentiality/rotation/revocation, email code capability and unverified app-row lifecycle.
- Acceptance/failure/security: exact status/field/error matrix, no invented wire field. Resolve EP-A01's unverified application-row requirement against current confirmed-contact bootstrap. Address anti-enumeration and provider/app partial-failure recovery; unsupported provider capability is a finding, not permission to edit frozen contracts.
- Verification/handoff: V-DOC/source-reference review; record engineering choices and dependency scope. M01-02 ready after policy/session inputs reviewed; do not require all nine documents.

### M01-02 - Shared Auth abuse-control enabler

Progress, 2026-10-24: owner separately authorized bounded implementation, dependency/service tests and local/CI Redis configuration after reporting M01-01 reviewed/merged. [M01-02 record](current-phase/M01-02.md) tracks the local helper delivery and fresh execution evidence. No canonical endpoint/provider integration or M01 acceptance is implied; historical M01-01 readiness statements above describe their original checkpoint. R32 remains open / partially executed.

- Goal/dependencies: M01-01; common R31 email send/verify/login protection.
- Sources/invariants: C02 ADR-017/R31; C05 §3/R31. auth:v1, HMAC contact/IP key parts, atomic count+first expiry and compare/consume across all instances.
- Targets/exclusions: backend Auth/common/config/tests, public template/register with real consumers. Redis client dependency only if explicitly authorized; no durable Redis job queue, SQL or service action implied.
- Deliverables: reusable TTL/policy/error boundary, deterministic clock/failure fixtures and later integration setup requirements.
- Acceptance/failure/security: 6-digit/provider-supported 10min challenge, 5 failures, one-time consume; resend 60s, 3/contact/15min, 10/IP/15min; login 5/identifier+IP/15min, 15min lockout; no blanket shared-IP user lock. Redis outage fails send/verification attempts closed with retryable 503. No raw contacts/secrets in keys/logs; authoritative retryAfterSeconds/Retry-After.
- Verification/handoff: V-B/V-DOC; planned V-NEW Redis race/expiry/outage on authorized prepared service. M01-03/04/05 ready after policy review/unit evidence; execute actual multi-instance cases before M01-10 acceptance.

### M01-03 - Email registration and resend

- Goal/dependencies: M01-01/02; email portions of A01/A04.
- Sources/invariants: C01 §7–9; C05 A01/A04/§15.2/17.1/R31; C06 identity. No invite/approval/session before required verification.
- Targets/exclusions: backend Auth controller/service/DTO/planned adapter/tests; contract maps. Phone/OAuth/frontend/SQL excluded.
- Deliverables: 201 RegistrationPendingDTO/masked expiry/resend metadata, provider-error mapping and recoverable unverified-row handling.
- Acceptance/failure/security: exactly-one-contact full DTO validation retained; normalized email, consent, configured password/confirmation policy; mismatch creates nothing. Duplicate contracts, anti-enumerating resend, cooldown/limits/provider failures never verify account or leak provider details.
- Verification/handoff: V-B/V-DOC; planned canonical registration/resend HTTP under V-NEW/V-HTTP after authorized setup. Mock and actual permitted synthetic delivery evidence distinguished. M01-04 consumes this challenge flow.

### M01-04 - Email verification establishes mapped session

- Goal/dependencies: M01-02/03; signup A02; authenticated secondary-contact mode remains M02.
- Sources/invariants: C05 A02/AuthSessionDTO/§17.1/R31; C01 §9; live Auth identity validation, C06 identity/profile transaction rules.
- Targets/exclusions: backend Auth adapter/service/controller/DTO/tests; no contact linking, profile-completeness access requirement or new schema field.
- Deliverables: one-time verification -> canonical session/user/completeness/next_step, established user/profile/preference transaction mapping.
- Acceptance/failure/security: wrong/expired/replayed/non6digit/exhausted codes get specified errors; never verified provisioning from unverified session/JWT contact metadata. Live subject match, concurrent provisioning uniqueness and recoverable provider/DB partial failure; preserve suspension.
- Verification/handoff: V-B/V-DOC, planned verification/replay/concurrency HTTP via authorized V-HTTP. Record external non-atomic recovery limits. M01-07 ready when DTOs stabilize.

### M01-05 - Email/password login

- Goal/dependencies: M01-02/04; email A05 with verified mapping.
- Sources/invariants: C01 §7–8/53; C05 A05/§16.1/17.1/R24/R31; guards/transactions.
- Targets/exclusions: backend Auth/service/controller/adapter/tests/maps; phone/recovery/social/schema excluded.
- Deliverables: AuthSessionDTO/errors, monotonic/coalesced server activity on actual authentication.
- Acceptance/failure/security: unknown/wrong password INVALID_CREDENTIALS; unverified 403, threshold 423/retry metadata. Suspended login allowed, all feature flags false/normal access denied; no complete-profile requirement or metadata-derived role/status/contact trust.
- Verification/handoff: V-B/V-DOC; planned cross-instance lockout/outage/suspended/no-profile HTTP cases. M01-06/08 consume reviewed session contract.

### M01-06 - Refresh and logout

- Goal/dependencies: M01-01/05; A06/A07 and cookie/session synchronization.
- Sources/invariants: C05 A06/A07/AZ-SUSP/§17.1; C09 §6; R24 refresh does not renew meaningful activity.
- Targets/exclusions: backend Auth adapter/service/controller/tests and frontend interface contract; no password-reset/deletion claims.
- Deliverables: rotated refresh response, revoked/expired failures, idempotent current-session logout including suspended users, cookie cleanup contract.
- Acceptance/failure/security: no session from revoked refresh, missing-token 401, safe expiry; no token logs/URLs/draft. Repeated logout per contract; at most one client refresh per 401, no loop. Record actual provider JWT revocation semantics; no unsupported immediate cryptographic invalidation claim.
- Verification/handoff: V-B/V-DOC, planned rotation/replay/logout HTTP. M01-08 ready after SSR rotation/cleanup review.

### M01-07 - Registration/verification UI and R18 draft

- Goal/dependencies: M01-03/04; canonical email Screens03–04; remove identifier URLs while preserving existing phone flow until M02 migration.
- Sources/invariants: C09 Screens03–04/R18/§6–7; C05 DTO/errors/R18; frontend scoped guidance.
- Targets/exclusions: frontend actions/client/register/verify/forms/routes/tests; planned draft helper if useful. No future recovery/OAuth route or backend placeholder.
- Deliverables: canonical email calls, field errors/input preservation, server countdown, draft {channel,normalized_identifier,contact_masked,expires_at,context}; /verify?channel only. Apply no-URL-PII pattern to existing phone path without claiming full phone completion.
- Acceptance/failure/security: no PII URL/history/telemetry; expiry min(challenge,10min), reload restore, fresh/expired tab re-enters identifier, resend updates expiry; clear verified/expired/cancelled sign-out. Password/code/JWT/refresh never in draft. Provider/network/duplicate submit safe; install session through M01-01 contract.
- Verification/handoff: V-F/V-DOC; meaningful existing form/actions/client tests; planned browser reload/fresh-tab/expiry/network checks. Record viewport/browser identity and transitional phone boundaries for M02.

### M01-08 - Login/session client and account-state routing

- Goal/dependencies: M01-05/06; M01-09 destination before integration acceptance. Canonical login/logout, complete me metadata/status routing.
- Sources/invariants: C05 A05–07/A13/§4/16; C09 Screens02/13/22/§6; C01 §7; preserve A10 next_step shared contract, full callback/contact flow M02.
- Targets/exclusions: frontend login/actions/client/session/proxy/dashboard, planned specified /settings account shell/tests; architecture/QA increment. No deletion API stub/private admin route.
- Deliverables: preserve effective_access/profile_complete/focus/can_delete metadata; single refresh then sign-out on failure; suspended settings notice/working logout; real profile_setup/app_home destination. Settings partial until M02/M03: no nonfunctional confirmation or deletion-complete claim.
- Acceptance/failure/security: no completeness gate on dashboard/frontend replacement for backend guards; no open redirect/token/raw-provider-error leakage. Failures preserve state; existing phone/OAuth retained as transitional. Full suspended deletion required at M03 before release.
- Verification/handoff: V-F/V-DOC; metadata/401/no-loop/suspension/navigation tests; authorized HTTP and planned browser session checks. Record OAuth callback gap for M02; do not discard add_verified_contact type.

### M01-09 - Real profile-setup destination using existing APIs

- Goal/dependencies: M01-01 and existing P01/P02; independently ready before full phone/social/AI; Screen07 before M01-08 integration.
- Sources/invariants: C09 Screen07/§6; C05 P01/P02/§15.3; C01 §7/14/R07. Education optional/Skip-to-dashboard.
- Targets/exclusions: planned frontend /onboarding/profile screen, form/client/tests; backend read-only. Skills/preferences/goals remain M05, no invented API or empty route placeholder.
- Deliverables: actual fetch/save/error/skip for current role/education/experience, preserve stored profile values.
- Acceptance/failure/security: no artificial skills/Junior fallback/mandatory education; failed load/save preserves input; accessible labels/focus/keyboard. No complete-onboarding claim; later-step navigation enabled only when real destinations exist, working Skip/basic access remains. Full Screen08–11 integration is M05.
- Verification/handoff: V-F/V-DOC; focused fetch/save/validation/skip tests and planned browser checks. Handoff interim Screen07 navigation limitation explicitly, not full C09 acceptance.

### M01-10 - Integration, separate review and handoff

- Goal/dependencies: M01-01–09; prove bounded email/session slice and preserve foundation, not complete Auth/MVP.
- Sources/invariants: C05 §17.1/17.6, C09 §6–8, shared workflow and task sources above.
- Targets/exclusions: affected tests/helpers/coverage/current record with explicit future authorization; no protected suites/opportunistic fixes/service/deploy/CI changes implied.
- Deliverables: synthetic email end-to-end/failure matrix, implemented operation/screen inventory updates, separate review findings/resolution, exact evidence/handoff. One current record, no empty future task catalogue.
- Acceptance/failure/security: signup -> invalid/expired/replayed/valid verify -> login -> basic access -> refresh -> logout; multi-instance Redis/outage/provider partial failure; suspended/foreign/missing-token; contact identifiers must not appear in URLs or telemetry. Passwords, verification codes and tokens must never be stored in the verification draft. Retain normalized_identifier in the sessionStorage draft only as required for verify/resend by C09/C05 R18: expiry is min(challenge expiry,10min); resend updates expiry from the server; reload restores the draft until expiry; absent/expired draft requires identifier re-entry; clear on verified/expired/cancelled sign-out. Preserve None/completeness/stronger evidence/A10/rationale/goal-feature/activity/error regressions. Real email delivery and provider approval recorded separately from mocks.
- Verification/handoff: V-DOC/V-B/V-F; V-HTTP only with authorized disposable identity; planned V-NEW checks must first exist then run. Schema-free slice need not run destructive lifecycle without a justified separately authorized risk. Reviewer accepts bounded evidence, owner accepts separately. Next candidates: M02 email recovery/phone contract, M03 receipt design, M04 synthetic gateway or M13 controls according to owner priority; full release still pending.

## 6. Nine standalone documentation dependencies

At DOC-02 preparation, all nine exact paths below were rechecked absent; embedded equivalents existed. M01-01 now authors five scoped Draft increments; four remain Planned. These are incremental derived documents, not independent policy authorities. The implementing slice author maintains affected content; a separate reviewer checks it, and the owner resolves product/provider/production policy.

| Planned path | Existing embedded authority | First need / smallest useful content | Acceptance / maintenance |
|---|---|---|---|
| docs/02-architecture/frontend-architecture.md | C02 §3–4, C09 §2–8, actual actions/client/proxy/routes | M01-07/08: SSR session/cookie, routing/status, API/cache and draft boundaries; expand M05–M14 | Separate current/transitional/planned; source/tests linked; frontend slice author/reviewer updates boundary changes |
| docs/02-architecture/backend-architecture.md | C02 §4–8/ADR-017/019, C08 §5, app/Auth/Profile/transaction source | M01-01 thin actual Auth/access/adapter/transaction map; M03 workers/M04 AI/jobs added when real | No empty future-module tree; backend author/reviewer reconciles actual source with authority |
| docs/03-domain/business-rules.md | C01/C03/C05 rules/corrections, helpers/guards/tests | M01-01 Auth rule links; M05 None/alias/level, later lifecycle/evidence | Rule -> authority -> code/test index, no copied duplicate policy; domain author/reviewer updates |
| docs/04-database/DB-schema-map.md | C06 §6/12.3/14, C03 §4, SQL manifests | M03 schema-dependent deletion map; M01 can link C06 directly; M04 jobs/later domains | Specified vs installed/version/checksum observations separate; no installed claim without execution; DB/backend author/reviewer, forward review for defects |
| docs/05-api/openapi.yaml | C05 §13–17/corrections, controllers/DTOs, endpoint inventory | M01-01 contract increment; specified/planned vs implemented status explicit; expand per operation | OpenAPI3.0, exact errors/auth/nullability; no invented runtime route/internal G04/AI HTTP endpoint; API author/reviewer. Automated schema checker is planned until present |
| docs/05-api/DTO-DB-mapping.md | C05 DTO/DB clauses, C06 §14, actual service SQL | M01-01 identity/profile fields; M03 receipt/outbox/M04 envelope | Conversion/nullability/owner/transaction/retention links and source identity; no independent DDL; API/DB author/reviewer |
| docs/08-testing/QA-plan.md | C05 §17, C07 §12–17, C09 §8, tests/helpers/coverage/metadata | M01-01 minimal email/session acceptance/commands/evidence; expand each milestone, full M14 matrix | Existing/planned checks and task/integration/provider/release gates distinct; identity/results/unresolved cases, no total-count readiness; verifier/reviewer maintains |
| docs/08-testing/AI-evaluation.md | C01 §25/47/56, C08 §13/16–17/R11, C05 tasks | M04 before AI acceptance: synthetic 8-role x 3-language coverage, task rubric/failure criteria/prompt/model/provider provenance; extend M05–M12 | Actual grounding/correctness/relevance/language/consistency/adversarial results and methods; no private production samples; AI author/reviewer plus owner data/provider approval |
| docs/09-operations/deployment.md | C02 §9/11–12, C06 §17–20/R23, C08 §18–19, runbook/config | M03/M04 recovery notes can live initially in task/runbook; standalone M13 before live-pilot planning, complete M14 | Actual destination/access/admin/secrets/backup/monitor/on-call owners, rollout/rollback, Redis-loss/worker/scheduler/purge recovery and measured PITR/security; operations author/reviewer plus owner release approval |

M01-01 has authored the five useful email/session contract/rule/QA/backend increments above as Draft/review pending; §6 describes their future extension responsibilities. The other four standalone documents remain Planned. UI map accompanies UI; schema map accompanies schema-dependent work; AI evaluation precedes AI acceptance; production documentation precedes live operations. OpenAPI specified scope never implies implemented routes. Reuse endpoint/screen inventories instead of duplicate trackers. Config names follow real public consumers, never private runtime inspection. No placeholders are created.

## 7. Traceability and acceptance

Every mapping below is a requirement-to-plan link, not a claim of new implementation/execution.

| Required capability / invariant | Source | Milestone/task | Verification / evidence gate |
|---|---|---|---|
| Signup/code/login/session/recovery/linking | C01 §8–12/53/60; C05 A01–13/§17.1/R18/R31; C09 Screens02–06/22 | M01-01–10, M02 | Canonical HTTP/browser journeys, Redis races/outage; actual selected email/SMS/OAuth tests separately |
| Basic access/system-global-user/owner/suspension exceptions | C01 §7; C02 §8/R10; C05 §13.2/A06/A13/X01–02 | M00 preserved; M01-05/06/08/10, M03/M13/all domains | Missing/expired token, suspended/foreign/admin, guard-to-write flag race; existing-data reads and special tech-read restriction |
| Profile None/alias privacy/stronger level evidence | C01 §14/17–18; C03 R07; C05 P/C05/R07/R29 | M01-09, M05/M08/M09 | Completeness/None/levels/idempotent alias; no fabricated skills/Junior/rationale |
| Goals/shared knowledge/roadmaps/Focus | C01 §15–23; C05 C/R; C08 §6–7 | M05/M06/M07/M09 | Clarification/cap/owner/version races; grounded canonical mapping, job navigation and plan preservation |
| Draft/lock/merge/level/undo/history | C01 §18/21–22; C05 §18.4; C09 §5 | M06/M09 | Explicit accept, no silent edits; snapshots/rollback/accept-start-undo races |
| Daily Plan/Today/shared content | C01 §27–30; C05 L; C09 Screens16–17 | M07/M08 | Hours/missed-day sequence/rebuild/Focus resume/content version/Preparing recovery |
| Practice/review/evidence progress | C01 §29–36; C05 Q/PR/G/§17/R29 | M08 | Key secrecy, autosave/resume/retry/submit unlock, rubric/junk/language parity/reasons/null source/history; no Job Ready |
| Mentor/context/memory/safety/dedup | C01 §26/37/49/52; C08 §7/10/13; C05 M/R08/R11/R15 | M10 | Synthetic multilingual/adversarial/context/retry/expiry/safety; optional SSE separately |
| Fresh daily updates/timezone/activity | C01 §38–46; C03 R25; C05 T/R24–25/N01 | M11 | Source/fetch identity, dedup/no-change/outage/pending; session/date/timezone races and pinned connections |
| Ratings/reports/threshold | C01 §24/32; C05 F/R27/R34; C06 R27 | M12 per producer | Visibility/exposure/ID/duplicate 409; two-session threshold/rollback and regeneration review |
| Admin/aggregate usage | C01 §50–51; C05 AD/R16/R30; C09 Screens23–25 | M13 | Server role/audit/override/inherit, UTC zero-fill/window labels/bounds; private read/telemetry denied |
| Privacy/deletion/raw90d/ops30d/provider cleanup | C01 §13/44/52; C03/C06 R05–09/R35; C08 R11 | M03/all private producers/M14 | API/direct read cutoff, cascade fault/receipt/outbox, encrypted finite retry, physical purge lag/outage recovery/alerts |
| Replay/limits/jobs/concurrency | C02 ADR-017/R12–14/R26/R31; C05 §13; C06/C08 corrections | M01-02/M04/M06–M12 | Atomic counter/replay/Redis-loss barrier/fence/deadline/stale input/domain uniqueness races |
| UX/error/recovery/accessibility/PWA/telemetry | C01 §4/54; C05 §4/16; C09 §2/6–8/R16–18 | Every UI task/M14 | Field/retry/refresh/input preservation; keyboard/screen-reader/focus/contrast/mobile/browser/slow network; no private telemetry |
| AI approval/quality/cost/provenance | C01 §25/47/56; C08 §13–19; C05 §15.12 | M04–M12/M14 | Task synthetic benchmark/rubric/prompt/model/provider identity, grounding/parity/failure/cost/latency/fallback, explicit data approval |
| Health/dependency status | C05 EP-H01; C02 §12 | M14 (M04 queue prerequisite) | Real DB/queue failure gives 503; version/time fields; public response contains no secrets/provider details |
| Frozen schema/RLS/recovery/release evidence | D001; C04 §9–10; C06 §13/16–20/R23/E01; C07 §12–17 | M00/M03/M04/M14 | Hashes; authorized installed/lifecycle/fault tests; measured load/connection/restore; exact artifacts/owner gate |

### Four different completion gates

1. Task: bounded diff/contracts reviewed; relevant actual checks/failures at exact source/worktree; handoff and unresolved cases. No artificial test requirement for trivial prose.
2. Milestone: producer/consumer and failure integration verified; planned tests now exist and actually run, security/privacy/AI quality cover the claimed outcome. Mocks cannot establish external delivery.
3. Provider: configured email/SMS/OAuth/AI/research tested with permitted synthetic data, contract/reliability/cost/terms reviewed; private credentials stay private. AI real-user approval is explicit per task/model/tier including fallback; availability/subscription is not approval.
4. Release: required C01 §60/C09 scope and R32 evidence/operating ownership, exact candidate/remote artifacts, reviewer and explicit owner release decision. Green CI or document-content review is not owner acceptance. Commit/push/deploy need separate authorization.

### R32 residual sub-gates

Historical R32 remains in_progress / partially_executed. Labels below organize remaining evidence, not replace/close its original record.

| Planning sub-gate | Historical boundary | Remaining evidence / milestone |
|---|---|---|
| R32-DB |21 forward/reverse/reapply,185 original assertions/run,27 boundaries/concurrency at earlier identities | M14 authorized disposable release-version lifecycle/installed catalog/privilege/E01; originals frozen, forward corrections reviewed separately |
| R32-AUTH | Mapping/guards/limited SDK UI, not complete provider Auth | M01/M02 canonical flows, shared limits/session/link/recovery and selected providers; M03 suspended deletion |
| R32-PRIVACY | Limited historical cascade/RLS, not full faults/purge | M03/private producers deletion/RLS/admin denial/receipt/outbox faults; read cutoff, measured physical lag/oldest-text alerts and outage recovery |
| R32-APP-UX-AI | Foundation HTTP/forms at older SHAs | M04–M13 complete contracts/jobs/UI/task evaluations; M14 browser/accessibility/slow-network/security |
| R32-CAPACITY | Numerical targets specified, unmeasured here | M04/M11/M14 realistic 50–100-user workload/query plans, worker/scheduler/pool budget, actual API/AI latency/failure recovery; no invented SLA PASS |
| R32-RECOVERY | PITR/RPO<5min/RTO<30min targets | M14 restored-version/checksum identification, timestamp sentinels/data loss/recovery time, safe restore drill; read-only restored-version smoke, no replay019/020 on post020 |
| R32-PRODUCTION | No fresh destination/security/remote/release evidence | M13/M14 named owners, provider/secrets/access/backup/monitor/incident approvals, exact run/artifact/release acceptance |

R33 stays optional_deferred as current metadata records. Do not make it a required-MVP release gate or invent its contents without a separately sourced decision.

## 8. Risks, decisions and plan maintenance

| Decision / risk | Responsibility | Work blocked / next resolution |
|---|---|---|
| First milestone priority | Owner, M01 proposed | Implementation commitment only; planning complete without a choice |
| SMS/AI/research providers/task-model data terms | Owner/provider-security review under C01 §10/47; engineers compare capabilities/cost/reliability | Live affected integrations/real-user AI; permitted synthetic fixtures/adapter work continue |
| Email code/session capability mismatch | Engineer validates in M01-01; owner resolves true policy exception | Dependent delivery/session integration if unsupported; retain C05, record conflict instead of adopting SDK/six-character behavior |
| Production destination/admin/access/backup/security/on-call | Owner names operators; engineers prepare concrete plan | Live pilot/release/restore acceptance; source planning unaffected |
| Redis acknowledged loss/provider interruptions | Engineering R14/R31 design, operations recovery owner | Replay availability/live evidence until recovery demonstrated; no silent durable schema or exactly-once billing claim |
| Worker/scheduler connections/purge ceilings | Engineering R08/R13/R25/R26 measurements + operations owner | Live jobs/privacy/R32 gates; not permission to replace queue with BullMQ |
| Frozen example/count/path discrepancy | Agent records both sources and approved correction/alias; owner resolves new policy | Only dependent contract/schema work, never protected rewrite or historical-result relabel |
| Benchmark validity/private review | AI author + separate reviewer; owner data approval | AI acceptance; prepare synthetic 8-role x 3-language fixtures, never staff production-private sampling |
| R32 acceptance/R33 disposition | Reviewer/owner | Release sign-off remains open; R33 does not block unrelated work |

Routine file/helper/UI/test choices and valid configured defaults within approved contracts are authorized-agent engineering choices. Product/retention expansion, real-data provider approval, changed HTTP semantics, frozen SQL corrections and production/release ownership require explicit policy/review decisions.

On a defect: record authoritative sections, actual source identity and impact; apply an existing approved scoped correction if relevant. Otherwise propose the smallest correction in open issues/current record, block only dependent behavior and continue independent work. Never edit frozen core/SQL/hash bytes to match code. Applied SQL needs separately reviewed forward migration; current baseline verifier enforces exactly21 migrations, so a future approved addition also needs explicitly scoped verifier/manifest extension preserving original equality checks, never weakening them.

The slice author updates affected milestone/task readiness and derived API/schema/rule/evidence links with correction provenance; separate review checks dependencies/acyclicity/consumer readiness. Preserve old results and identify new runs separately. Reassess provider approval on model/tier/term changes. One current task record via START-HERE, no duplicate trackers/empty task files, invented percentages or completion dates.

## Appendix A - Historical alignment checklist (verbatim body)

Everything below is historical alignment-task provenance. Its installation/commit/push/PR wording applied only to that earlier task, not current authorization. The complete checklist body is retained without changing its decisions.


Base/start: live phase1-restart `4dffb54835f62f806accbb883a2cf6557c30bcdf`; known foundation merge matches live base. Branch chore/repository-alignment; preserve unrelated work (initial tracked/untracked status clean). Master task authorizes execution without another plan approval; no merge/deploy.

1. Read all nine complete attachments and master prompt; identify content/versions; verify baseline; copy exact bytes; record manifest and checkout byte policy.
2. Restructure governance/current-phase evidence/ADR; retire superseded docs and proven obsolete Compose, root example, four TypeORM migration files/runner/scripts, tracked build cache; retain connection manager, SQL, lockfiles, history.
3. Shared AGENTS/context/hand-off; source authority/planned paths; actual setup/readme/runbook. Record tooling limitations and conflicts.
4. Focused F1 completeness, F2 feature/ownership transaction checks, F3 successful explicit activity, F4 field error/client metadata corrections, meaningful unit and real HTTP tests. Preserve delivered OAuth/role rationale corrections. Correct existing WhatsApp-first assumptions; defer broader Auth implementation.
5. Locked installation; fresh checkout validation; lint/unit/build/E2E/HTTP; immutable hashes; maintained links; workflow syntax; DB lifecycle/boundary/concurrency in dedicated disposable project only. Record exact commands/exit/status/head/base separately and keep failed evidence.
6. Inventory each initial tracked file, focused Conventional Commits, push branch, inspect base/head diff and open PR into phase1-restart when API permitted. Report blockers truthfully. Main promotion waits for reviewed alignment merge.

Current evidence and final handoff live in current-phase/alignment; original foundation records are historical. No future modules/docs are fabricated. Full Auth/deletion/AI/worker/admin/UI and production performance/PITR/security/owner acceptance remain later milestones.

# DOC-02 — Master software development execution plan

## Task / delivery / owner acceptance

- Goal: overall agreed-MVP milestone/dependency/document/verification roadmap and executable proposed first remaining milestone, with maintained navigation and reviewable local diff.
- Date: 2026-10-24, Asia/Dhaka. Status: local DOC-02 documentation delivery complete and verified; reviewable diff left uncommitted. Plan is **Draft / proposed for review**; owner priority/implementation/release acceptance pending.
- Allowed scope: master plan, this one current task record, START-HERE and minimal context-map/open-issues navigation/status consistency. No features/bug fixes/scaffolding, dependencies/lockfiles, tools installation, scripts/CI, frozen sources/hashes/SQL/original suites, runtime/credential inspection, services/DB operations, global settings, stage/commit/push/PR/merge/deploy. No additional agents launched.
- Deliverables: [active proposed plan](../../master-execution-plan.md), [START-HERE](../../../00-governance/START-HERE.md), this record. [DOC-01](DOC-01.md) and its old fingerprint/results remain unchanged historical evidence.

## Root / shell / branch / base / full HEAD

Repository public-origin projection: dev-mhemon/AI_Career_Mentor (raw URL not printed). Root D:/AI Career Mentor. Branch docs/doc-01-agent-workflow; base/full HEAD 74e2f2c8975751d9c1545917ed7fa81be50d4400. Expected historical base equals observed HEAD; no checkout/reset performed.

Actual successful runner: Windows PowerShell Desktop5.1.26100.9711. Explicit installed Git Bash paths were found, but direct shell selection failed with Bash/Service/CreateInstance/E_ACCESSDENIED (exit1); launching C:/Program Files/Git/bin/bash.exe via PowerShell failed CreateFileMapping Win32 error5 (exit1). Used PowerShell fallback, without settings changes/escalation. Native python.exe resolved to Python314 installation; python --version returned3.14.7. No launcher assumed; WindowsApps python3 was not used. UTF-8 pipe output was set locally when writing/reviewing Unicode content.

Entry index: no staged changes. Eleven modified tracked documents and two untracked Markdown files listed below. Continue on inherited documentation branch because this is sequential DOC-01→DOC-02 work; no clean checkout manufactured and no unrelated work overwritten. DOC-01 external content review resolved its findings but did not independently rerun local checks or establish owner acceptance.

### Entry content identity and inherited changes

Each SHA-256 below identifies raw entry file bytes. Aggregate entry fingerprint e0c6066f69e97f266f962659185ac3d28a30ff0ed34ace8d1d77ae356b1327bc = SHA-256 over sorted repository-relative path + NUL + ASCII individual SHA-256 + NUL for all13 entries. This differs intentionally from DOC-01's old raw-content fingerprint method; that record is not recalculated or relabelled. Entry snapshot was captured before edits in a temporary file outside the repository; durable hashes are retained here.

| Entry path | State | Entry SHA-256 |
|---|---|---|
| AGENTS.md | modified tracked | 71df9065024923d345e6a12b9b03fbd9307790ef62101f39d94125bfac52232a |
| README.md | modified tracked | 35cd3fd03e95133dcc7f53fe6e4a6e447f2b2397cf2294420f19d633ca9677f1 |
| docs/00-governance/START-HERE.md | modified tracked | 5b557b097cfec9804bc758845728092633e5e1ca3cdef08f921d7ab875999b2b |
| docs/00-governance/agent-workflow.md | untracked | 27b46ef985ff488798248e05101bdd1a6579dbecf6e23f1236387da62d58bbfa |
| docs/00-governance/config-register.md | modified tracked | d5aded82c4f99f77a085667ce2099fb78c6fbc8a6cdc3caf1ca300e862285c3d |
| docs/00-governance/context-map.md | modified tracked | b9afa94776386894f17b2bed22c86d735c39d7263a70101ad5271087a4603599 |
| docs/00-governance/open-issues.md | modified tracked | 014385dddd9167a6e142361a60039fde85a496ebd66bb0449a3a7a31755527fd |
| docs/00-governance/source-of-truth.md | modified tracked | b4b46b24ebc3f688efd5e52ebc2d79ba205ffc6c68b9f9cd5d9a3e73f3be02b3 |
| docs/06-decisions/ADR/0001-technology-version-selection.md | modified tracked | 2269168ec62f8b5035ac1552f49e55769522ae6e735285ee83b98aa5eac21e41 |
| docs/07-planning/current-phase/documentation-alignment/DOC-01.md | untracked | 18e52b2c86c25c023ed3b7cb6e64c7142a4dc4bec6f41a46f523f6e97ea56f8c |
| docs/07-planning/master-execution-plan.md | modified tracked | be186ebf62de530485efd9cee773207f771e9c9859770623b55803d212d55b90 |
| docs/07-planning/phase-1-audit.md | modified tracked | 2f8abdb0308e9fa4664deefbfe909afc07b1bf48eba57d13ab80e210084e56c2 |
| docs/09-operations/runbook.md | modified tracked | 2d38d99f8364cd4bc525a36a846f7158c22b3f7bb0723a608a51b30682eac043 |

## DOC-02 delta and decisions

| Changed since entry | Purpose |
|---|---|
| docs/07-planning/master-execution-plan.md | Active Draft overall roadmap M00–M14; conditional M01 with 10 bounded tasks; document dependencies/traceability/acceptance/R32/risks; original historical checklist body retained verbatim |
| docs/00-governance/START-HERE.md | Current DOC-02 record/active proposed plan, historical DOC-01 and pending implementation/acceptance |
| docs/00-governance/context-map.md | Current documentation row points to DOC-02/plan |
| docs/00-governance/open-issues.md | Current planning identity and conditional M01 recommendation; owner priority still open |
| This new, untracked DOC-02.md | Entry/delta/source/check identity and concrete handoff |

Other nine inherited files remain byte-identical to entry, including untracked agent-workflow.md and DOC-01.md. No application/protected/dependency/script/CI change. Original plan checklist body from “Base/start” through its final paragraph is text-identical, including its old authorization language, now explicitly historical. No obsolete install/push permission appears active.

Planning choices: consume foundation rather than rebuild it; M01 email/session is Proposed for source/dependency value and synthetic verification independent of SMS choice. Full Auth M02, deletion/retention M03, AI/jobs M04, profile/goals M05, draft/lock M06, Daily Plan/Today M07, practice/progress M08, merge/undo M09, mentor M10, technology M11, feedback M12, admin M13, integrated UX/operations/release M14. Gate real-user AI on privacy/provider approval without blocking synthetic enablers. Merge acceptance waits for real plan/start/evidence integration; deletion outbox does not depend on AI jobs, avoiding a privacy/AI cycle. Review added M09 as a prerequisite for complete merge-feedback integration and explicit M14 completion of EP-H01 health checks. Feedback begins per producer before broader rollout; controls/operational design can begin early. Sequential execution remains default.

First milestone includes actual minimal profile/account landing destinations because canonical next_step must not point to absent routes. It explicitly remains partial onboarding/settings until M02/M03/M05 and cannot establish public-MVP acceptance. All future files/tests are planned. Nine absent standalone docs are assigned incremental owners/content/acceptance in plan §6; none authored as placeholders here.

## Sources actually inspected

- Root AGENTS.md and frontend/AGENTS.md; START-HERE, source-of-truth, workflow/template, context map, open issues, config register, full current phase audit and DOC-01 record/follow-up; original master checklist. No further scoped AGENTS found by repository inventory outside excluded dependencies/baseline.
- All nine C01–C09 reviewed in bounded passes: heading/scope inventory across each; deeper C01 §3–24/27–48/50–60; C02 §4/7–14 and correction contracts; C03 identity/career/§5–6/R07–13/R19–21/R25; C04 migration/seed/lifecycle/readiness/correction gates; C05 global/catalog/Auth/account/DTO/error/test/traceability and R18/R29–31/R34; C06 identity/profile SQL, table matrix/deletion/recovery/replay/outbox/operational corrections; C07 §12–18/R31/R30; C08 tasks/gateway/privacy/evaluation/deployment/roadmap and accepted corrections; C09 screens/error/telemetry/handoff/R16–18/R34/N01. Authority links/versions are in plan §1/source register. Review does not claim full independent SQL audit or acceptance.
- Relevant decisions: embedded C02 ADRs001–020, standalone technology-version decision, foundation DECISIONS/D001/npm-Vitest exception. Historical permission/path prose is not fresh authorization.
- Actual source: backend app/Auth module/controllers, live Auth service/strategy, access guard/policy, transaction manager, profile controller/service/DTO/completeness, HTTP/config/health; frontend Auth actions/callback/client/proxy/form/session source and existing tests. Bounded test/source searches cover meaningful current regressions, not a test run.
- Package scripts/dependencies/lockfile presence, backend/test health E2E, unit/form/client test inventory, scripts/foundation local/application/frontend helpers and database/boundary/concurrency entry points, both CI YAMLs, baseline/alignment verifier source. No private .env/runtime/status/log/key files read.
- Historical endpoint/screen coverage, validation.json and selected check/lifecycle/TAP-summary metadata:82 catalog/81HTTP/1internal;9 foundation+1partial+72planned entries;25 screens/5partial; R32 in_progress/partially_executed/accepted=false; R33 optional_deferred. Individual tested SHAs/results are in plan §2 and dated audit. Original TAP plans sum185, boundary plan27; protected SQL counts21/21/8.
- Nine standalone paths revalidated absent via rg file inventory excluding dependencies/.git/.local/protected package; embedded equivalents mapped, no full standalone equivalent located. Existing seed018/020 is not a missing seed-folder blocker.

## Commands / results / tested identity / artifacts

All checks below target this branch/base plus the identified uncommitted documentation worktree, not a new commit. Persistent artifact: this record and linked plan; tool outputs provide execution transcript. Fresh checks are documentation-only. Application source is unchanged at HEAD; that fact does not establish fresh application PASS.

| Command / review | Exit / result | Scope / artifact |
|---|---|---|
| PowerShell shell/version/location and explicit Git Bash path probes |0 | Actual runner/root; Bash failures retained above |
| git rev-parse --show-toplevel; git branch --show-current; git rev-parse HEAD; git status --short; git diff --stat; git diff --cached --stat |0 | Entry root/branch/full HEAD/11tracked+2untracked/index empty |
| Get-Command python,python3,py; python --version |0 | Native Python3.14.7 selected; aliases not assumed executable |
| Python entry snapshot/hash and public-origin projection/file inventory |0 |13 raw entry hashes above; safe origin projection; no credential values |
| python scripts/foundation/verify-baseline.py (entry) |0 | PASS179; SQL21/21/8 byte-identical |
| python scripts/alignment/verify.py (entry) |0 | Nine upload/index hashes, baseline/SQL and19 maintained link sources PASS |
| python scripts/foundation/verify-baseline.py (final) |0 | PASS179;21 forward/21 rollback/eight original suites byte-identical; verifier unchanged |
| python scripts/alignment/verify.py (final) |0 | Nine upload/index hashes, baseline/SQL and20 maintained Markdown link sources PASS, including new untracked DOC-02 |
| git diff --check; git diff --cached --check (each captured) |0 each | Tracked whitespace clean, index empty; Git reports expected LF-to-CRLF checkout warnings, no settings changed |
| python -X utf8 - (inline scope/hash/history/encoding/privacy/graph/task review) |0 | Exactly four inherited files changed plus this new file; other nine entry hashes match; HEAD/branch/index unchanged; historical checklist text exact; all five DOC-02 files UTF-8/newline/whitespace/private-pattern checks clean;15 milestone nodes/10 complete task fields and acyclic dependency graph |
| Bounded full plan/new-record/navigation/diff and source-reference review |0 | Read all DOC-02 content including untracked record, review relevant tracked diff and inherited scope; added missing M09 merge-feedback prerequisite and explicit EP-H01 completion, corrected C06 reference to its actual R13/R14 plus C03 R12 |

### Failed attempts and limitations

Git Bash startup failed twice (exit1), followed by PowerShell fallback. A broad rg argument used a Windows literal wildcard and reported invalid path (rg exit2 inside an aggregate inspection whose final command returned0); rerun using directory plus -g '*test*' succeeded (exit0). Oversized source reads were truncated; narrowed reads/projections were used for relevant sections/metadata. No verifier result was inferred from truncated output.

One oversized plan-write command exceeded Windows process-command length (CreateProcess error206; no process/write). Bounded writes succeeded. An initial navigation script failed its paragraph assertion (exit1) before navigation mutations because the PowerShell stdin encoding replaced Unicode literals; review also found substituted punctuation in the new plan. Explicit UTF-8/escaped characters and targeted paragraph matching corrected these DOC-02 changes before final verification. Historical checklist body was retained from the pre-edit snapshot. No inherited/protected source was rewritten to fix tooling.

Not run by design: installs, app lint/unit/build/E2E/HTTP/browser, services/DB/catalog/reset/lifecycle, provider/network/remote CI/artifact checks, actual Antigravity loading, security/ACL/PITR/load tests. These are future authorized gates, not DOC-02 blockers. No provider terms/pricing/approval or release readiness claimed.

## Final review / unresolved decisions / next action

Final review completed. Review includes new/untracked files separately from ordinary git diff, full DOC-02 content/nav, whitespace/links/source references, private-value heuristics, preserved entry hashes/protected boundaries and roadmap dependency/coverage/task readiness.

Original DOC-02 delivery non-self content fingerprint (historical; current follow-up fingerprint below): 302c306542ae4a230317e4cfccbf7919779749eaa2f87c8e1e73e36f7c99e047. SHA-256 over the four changed inherited paths in the DOC-02 delta table, sorted, appending UTF-8 relative path + NUL + raw current bytes + NUL. Excludes this self-describing record; its full content is separately checked. The inherited nine unchanged paths remain identified by entry hashes above. This identifies local documentation, not a new commit/runtime run. DOC-01's own fingerprint and results are not rewritten.

Final worktree: same branch/full HEAD,11 modified tracked documents and three untracked Markdown files, no staged changes. New DOC-02 deliverable is this untracked record. Inherited untracked deliverables also remain: docs/00-governance/agent-workflow.md and docs/07-planning/current-phase/documentation-alignment/DOC-01.md. Review all three separately because ordinary git diff omits them. Only this record is newly created by DOC-02.

Plan review covered overall C01 scope/non-goals; all API service families including internal-only G04 and public health;25 screen/29 component contract completion; required cross-cutting invariants; incremental documentation rather than duplicate authorities; task readiness/existing versus planned commands; provider/privacy/release gates; dependency nodes/cycles. No unsupported implementation/acceptance claim found in the completed delivery. This local review is not external document review or owner sign-off. Protected-file verification passes; no material DOC-02 blocker remains.

Open owner decisions: first milestone priority; SMS/AI/research provider/model/tier/data handling; production/access/admin/backup/security/on-call ownership; R32/release acceptance. Routine helper/UI/test/adapter choices within contracts can be resolved by the separately authorized agent. No material blocker to completing DOC-02 documentation.

Next bounded proposal: authorize **M01-01**, or reprioritize an explicit alternative. Inputs: plan §5, C01 §7–9/C05 Auth+R18/R24/R31/C06 identity/C09 affected screens, actual Auth/client source and shared workflow. Deliverables: thin email/session/backend/rule/QA/OpenAPI/DTO mapping increment, decisions on SSR session handoff/unverified provisioning/partial failure, a reviewed current task record and read-only doc checks. No feature/provider/service/SQL action in this first contract task. Acceptance: exact status/error/field/security matrix with planned versus implemented scope, unresolved capability conflicts isolated, and M01-02 readiness criteria met. Owner review of DOC-02 is separate; no implementation begins from this delivery alone.

## Documentation review follow-up — M01-10 verification draft

Date: 2026-10-24 (Asia/Dhaka). Owner scope: resolve the M01-10 review finding, inspect related criteria, update this record/fingerprint and execute read-only documentation checks. Status: follow-up correction complete and locally verified; reviewable diff remains uncommitted. Plan remains Draft/proposed; no feature implementation or owner/release acceptance follows.

Entry: D:/AI Career Mentor, docs/doc-01-agent-workflow, base/full HEAD 74e2f2c8975751d9c1545917ed7fa81be50d4400; no staged changes,11 modified tracked documents and three untracked Markdown files inherited from DOC-01/DOC-02. Continued on that branch to preserve the existing sequential work; no switch/stash/reset/stage/commit/push. Entry non-self fingerprint matched the original delivery value above. Historical DOC-01 bytes/results/fingerprint and the original DOC-02 evidence remain preserved.

Sources: root AGENTS, START-HERE/source register/context map/shared workflow; M01-07/M01-10 and related plan draft/identifier/token/URL/telemetry criteria; C09 accepted R18 contracts at lines725–740 and telemetry §7.2; C05 accepted R18 at lines2294–2305, EP-A01–A04 and §15.2 RegistrationPendingDTO/VerifyCodeRequestDTO/ResendVerificationDTO. Existing baseline/alignment verifier source inspected before execution.

Finding: M01-10's blanket “no PII URL/draft/telemetry” contradicted M01-07 and C09/C05 R18 by prohibiting the normalized_identifier explicitly required in the verification draft. It could incorrectly prevent verification/resend from using the normalized contact; contact_masked is display-only.

Resolution: only M01-10's acceptance/security sentence changes in the plan. Contact identifiers are excluded from URLs/telemetry; passwords, verification codes and tokens are excluded from the draft. The required normalized_identifier stays in the sessionStorage draft for verify/resend under existing R18 expiry min(challenge expiry,10min), server-updated resend expiry, reload-until-expiry, identifier re-entry if absent/expired, and cleanup on verified/expired/cancelled sign-out. No new expiry duration/privacy policy. M01-07 already states the correct draft fields/expiry/cleanup; M01-06 bans tokens in drafts, not contact identifiers; remaining related criteria contain no equivalent contradiction and need no edit.

Exact follow-up changed files: docs/07-planning/master-execution-plan.md and this already-untracked DOC-02.md. No new files. The other12 inherited changed/untracked files and historical checklist body must remain byte-identical to follow-up entry; source/SQL/dependencies/CI/scripts remain outside scope.

Execution: PowerShell Desktop5.1.26100.9711; explicit installed Git Bash launcher retried and failed CreateFileMapping Win32 error5 (exit1), so PowerShell fallback used without settings/escalation. Native Python executable resolved before checks; no service/runtime/credential inspection. An oversized inspection output was truncated, then relevant source/criteria were reread in bounded output; no check result inferred from truncation.

Current follow-up non-self content fingerprint: 39fa5ce85077ddc4534695080d918afe9f8e25da72c87de61168d04a47700d81. Same four paths/method as the original delivery: sorted UTF-8 relative path + NUL + raw current bytes + NUL, SHA-256. Excludes this self-describing record, whose complete appended delta is separately reviewed. This is local documentation identity, not a new commit/runtime test result.

| Follow-up command / review | Exit / result | Scope / tested identity / artifact |
|---|---|---|
| git rev-parse --show-toplevel; git branch --show-current; git rev-parse HEAD; git status --short; git diff --cached --stat |0 | Entry identity/status above; index empty |
| Explicit Git Bash launcher probe |1 | CreateFileMapping Win32 error5; PowerShell fallback, no settings changed |
| Get-Command python; python --version |0 | Native Python3.14.7 confirmed |
| python scripts/foundation/verify-baseline.py |0 |179 reviewed entries;21 forward/21 rollback/eight original suites byte-identical |
| python scripts/alignment/verify.py |0 | Nine exact upload/index hashes, historical equality, baseline/SQL and20 maintained Markdown link sources PASS |
| git diff --check |0 | Tracked whitespace clean; existing LF-to-CRLF checkout warnings only |
| git diff --cached --check |0 | Staged whitespace clean; index empty |
| python -X utf8 - (inline entry/delta/hash/encoding/privacy review) |0 | Exactly two authorized files changed; all other12 inherited files byte-identical; one-line M01-10 plan change, M01-07 and historical checklist unchanged; old/current fingerprints verified; complete changed-record delta reviewed separately from git diff; whole-file whitespace/UTF-8/private-value checks PASS; branch/HEAD/index unchanged |

Not run: application tests/builds, services, databases, provider/remote CI or release operations; unnecessary for this documentation correction. No application/protected specification/SQL/dependency/CI/script change, no stage/commit/push. Next action: review this bounded correction; the existing proposed M01-01 task still needs its separate implementation-scope authorization. No additional policy decision is needed to resolve this finding.

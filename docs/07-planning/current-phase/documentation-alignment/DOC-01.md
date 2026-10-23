# DOC-01 — Shared guidance and execution workflow

## Task and delivery state

- Goal: align maintained guidance with the actual repository and give Codex/Google Antigravity one context/execution/verification/handoff procedure.
- Owner scope: documentation edits, a dedicated branch, read-only inventory/source/evidence inspection and relevant documentation verifiers; leave a reviewable local diff.
- Exclusions: feature/code/dependency/CI changes, protected source/SQL/hash edits, global settings, tools installation, database/service actions, commit/push/PR/merge/deploy.
- Status: DOC-01 local documentation delivery complete and verified; reviewable diff left uncommitted. Owner review/acceptance and release acceptance remain separate.
- Date: 2026-10-23, Asia/Dhaka.
- Repository: dev-mhemon/AI_Career_Mentor; root D:/AI Career Mentor.
- Initial source: clean main, full HEAD 74e2f2c8975751d9c1545917ed7fa81be50d4400.
- Task branch: docs/doc-01-agent-workflow from that source; HEAD remains the same. Changes below are uncommitted documentation work, not a new tested commit.
- Owner changes: none reported by initial Git status; no existing work was discarded. Empty local documentation directories were included in inventory.
- Current entry points: [START-HERE](../../../00-governance/START-HERE.md), [shared workflow](../../../00-governance/agent-workflow.md), [source authority](../../../00-governance/source-of-truth.md), [phase audit](../../phase-1-audit.md).

## Sources and inspected instructions

Root AGENTS and frontend/AGENTS were read; no additional scoped AGENTS were found in the inspected maintained docs/source/tooling areas. Repository GEMINI.md, .cursorrules and .github/copilot-instructions.md were absent; no Markdown bootstrap/rules were found in the inspected .agent/.agents/.codex/.gemini areas. Known user-global .codex/AGENTS.md and .gemini/GEMINI.md were absent. This is a scoped instruction check, not proof that every possible agent configuration is absent. No global setting or credential store was inspected or changed.

Reviewed C01 §7/14/47/56/61; C02 §3/4/9/10/14, D001 and evidence scope; C03 domains/security/readiness; C04 seed/lifecycle/freeze procedures; C05 Auth/Profile/goal contracts, R07/R18/R24 and test matrix; C06 layout/SQL/table matrix/seeds/operations; C07 assertions/performance/evidence scope; C08 provider/evaluation/deployment and C09 screens/R18/readiness. Versions/provenance remain in the unchanged [source manifest](../../../00-governance/source-manifest.json).

Implementation references: backend modules/controllers/services/guards/completeness/errors; frontend Auth actions/callback/client/dashboard; public .env.example names; package scripts/manifests; foundation process/local helpers; Supabase public config; both CI definitions; historical coverage, validation and inventory metadata. No standalone previous inventory-audit file was found; its relevant findings were reproduced from filesystem/content rather than assigned an invented report path.

## Current observations versus historical claims

| Item | Revalidated observation | Limit / provenance |
|---|---|---|
| Local integration | Git history includes 64171e8c alignment merge, 83aa7c2b main promotion, 114afc91 tooling implementation and 74e2f2c8 tooling merge | Local commit history, not live remote/CI acceptance |
| Implemented scope | Supabase Auth/user mapping, access policy, Profile/preferences/settings/alias, goal read/confirm, limited health and transitional frontend | Source inspection; no fresh behavior tests |
| Protected content | Nine active core sources and 179-entry reviewed package; 21 forward/21 rollback/eight original suites | Existing verifiers passed initially; final results below |
| Original test totals | Original suites define 185 pgTAP assertions, separate boundary suite defines 27; historical lifecycle/concurrency execution is recorded | 19 in-migration catalog assertions are separate; no DB execution for DOC-01 |
| Historical execution | Alignment validation has base 4dffb54835f62f806accbb883a2cf6557c30bcdf; individual tested SHAs differ | [Audit](../../phase-1-audit.md) maps 3857af82, d2c63c15, fac739ae and 1fdc6c98 to the actual records |
| Toolchain | npm/Vitest; Node >=24; Next.js manifest 16.3.8; native Windows process helper | npm/Vitest exception has prior owner provenance; version observation does not approve arbitrary upgrades |
| Agent execution | Actual runner Windows PowerShell; explicit Git Bash 5.3.15; native Python 3.14.7 available | Codex PATH lookup exit0; Antigravity lookup exit1. Installation/discovery/rule loading for Antigravity remains unverified |
| Acceptance | R32 in_progress / partially_executed; R33 optional/deferred | No owner/release sign-off or complete MVP claim |

The Windows runbook's setup PASS text lacks exact tested identity. Historical alignment records contain failed image-pull and adapted-image context; they are preserved, not reused as current-HEAD or independent clean-CI proof. Some historical metadata lacks a tested SHA; no identity is fabricated for it.

## Findings addressed and files changed

| File | Change / reason |
|---|---|
| AGENTS.md | Concise shared pointers, current branch/task discipline, risk-based verification and protected scope |
| README.md | Replace obsolete alignment branch/promotion direction; link canonical workflow/current record |
| docs/00-governance/START-HERE.md | Current checkpoint, practical task reading route, implementation boundary and discovery limits; established Bangla retained |
| docs/00-governance/source-of-truth.md | Normative/exception/derived/code/evidence separation and conflict resolution; adoption and frozen manifest preserved |
| docs/00-governance/context-map.md | Task-specific sources/tests; no blanket requirement to reread all nine for small work |
| docs/00-governance/open-issues.md | Separate resolved historical claims, deferred work, actual gaps and owner decisions |
| docs/00-governance/config-register.md | Consumer/visibility mapping, PYTHON_BIN/NPM_CLI_JS/PYTHONUTF8 and supported tooling names; no private values |
| docs/00-governance/agent-workflow.md | One canonical workflow, compact task template, coordination and portability/privacy procedure |
| docs/07-planning/phase-1-audit.md | Actual code boundary, historical source/evidence identity and remaining gates |
| docs/07-planning/master-execution-plan.md | Short historical disposition/current pointer only; original alignment checklist retained |
| docs/09-operations/runbook.md | Agent/documentation-check pointer; scope Windows PASS narrative as unattributed historical evidence |
| docs/06-decisions/ADR/0001-technology-version-selection.md | Preserve original 16.3.7/verification wording; add observed 16.3.8/current-scope note and normalize inherited trailing whitespace |
| This DOC-01 record | Revalidated inventory, check/handoff evidence and bounded next task |

Historical foundation/alignment reports, archives and raw evidence were not edited. Their stale branch/permission/CI prose is scoped by maintained pointers. Historical inventory discrepancy remains explicitly recorded: FINAL_REPORT says keep314/update23 while detailed JSON and INVENTORY give keep313/update24 out of 471.

## Revalidated 27-document inventory and priorities

The original expected set remains 18 present / nine absent standalone documents. The new workflow and this task record are additional deliverables, outside that original denominator. All nine core documents and all six governance files exist at expected paths; planning has two existing files and operations has the runbook. Content existence is not completeness or approval.

Originally incomplete config-register and phase audit are refreshed within DOC-01. The master execution plan intentionally remains an incomplete active-development plan with a historical disposition; DOC-02 prepares that plan. No percentage or future completion date is assigned.

| Absent standalone document | Information already available | When needed / smallest action |
|---|---|---|
| docs/02-architecture/frontend-architecture.md | C02 §3/4, C09, actual frontend source | During the next relevant UI slice: extract actual route/session/component/API boundaries; keep future PWA separate |
| docs/02-architecture/backend-architecture.md | C02 §4, C08 §5, backend modules/transaction manager | Before a slice changes backend boundaries: thin actual-module/access/data/worker map |
| docs/03-domain/business-rules.md | C01/C03/C05 rules and accepted corrections | Before the next relevant slice: link only relevant rule-to-code/test references; do not rewrite policy |
| docs/04-database/DB-schema-map.md | C06 §14 complete table/API matrix; C03 §4 | During schema-dependent implementation: link existing matrix; add installed/version-bound observations only if actually inspected |
| docs/05-api/openapi.yaml | C05 endpoint/DTO/error contracts | During the next HTTP-contract implementation: document implemented operations with explicit scope; keep specified-only/internal entries separate |
| docs/05-api/DTO-DB-mapping.md | C05 DB clauses, C06 matrix, service SQL | During relevant HTTP/DB work: extract field/conversion/ownership/transaction links |
| docs/08-testing/QA-plan.md | C05 §17, C07 §12–17, C09 §8, tests/helpers/coverage | Before the next relevant slice: minimal linked acceptance/check/evidence matrix; planning can initially link these inputs |
| docs/08-testing/AI-evaluation.md | C01 §56; C08 §16/17 | Before AI acceptance: synthetic eight-role/three-language fixtures, rubric, prompt/model identities and actual results |
| docs/09-operations/deployment.md | C02 §9, C06 §17/18, C08 §18 target plans | Before release: actual destination, access ownership, rollout/rollback, restore/security evidence and sign-off |

No full standalone equivalent of those nine was found elsewhere. docs/api, docs/testing and docs/prompts are empty local directories without README/.gitkeep markers; docs/08-testing is absent locally too. No expected document was misplaced and no expected document was an empty placeholder. Root .aiignore remains absent intentionally; no universal ignore behavior is asserted.

Archive equivalent is docs/99-archive, with README and the historical v1.7 frontend plan; no root 99-archive is needed. supabase/seed is absent, but reference/configuration seeds are embedded in migrations018/020; separate seed files are not a functionality requirement. Existing backend/frontend/Supabase/tooling layout remains intact.

## Verification record

The command table below preserves the original DOC-01 delivery results; follow-up reruns are recorded in the separate follow-up section below.

Environment: explicit Git Bash launched by the Windows PowerShell runner, native Python 3.14.7. Command examples below use Bash syntax and the available python executable. Initial checks ran on clean source HEAD; final checks assess the uncommitted documentation worktree at the same HEAD. This record is the evidence summary; historical artifacts remain linked above.

| Check / command | Exit / result | Scope / artifact |
|---|---|---|
| git rev-parse --show-toplevel; git branch --show-current; git rev-parse HEAD; git --no-optional-locks status --short --branch | 0 initially | Root/source/clean state; initial inspection and this identity section |
| git switch -c docs/doc-01-agent-workflow | 0 | Authorized dedicated branch; no commit |
| python scripts/foundation/verify-baseline.py | 0 before and after edits | PASS179; SQL21/21/8; verifier unchanged |
| python scripts/alignment/verify.py | 0 before and after edits | Nine exact upload/index hashes; baseline/SQL; maintained link sources increased from17 to19, including both new documents |
| git diff --check; git diff --cached --check | 0 each | Tracked whitespace checks; staged diff empty |
| git diff --no-ext-diff -- selected paths; git diff --cached --no-ext-diff -- selected paths | 0 each | All11 tracked documentation diffs reviewed in bounded groups; staged content empty |
| python -X utf8 -u - (inline new-file/source/reference review) | 0 | Both new files read in full; credential-safe origin projection matched repository; original TAP plans sum185 and boundary plan27; Next.js lock selects16.3.8 |
| python -X utf8 -u - (inline allowed-file/privacy/fingerprint review) | 0 | Exactly11 tracked changes plus2 new Markdown files; zero staged files; no paths outside the13-file allowlist; private-value heuristic scan found no matches |
| python -X utf8 -u - (whole-file Markdown whitespace review) | 1 initially; 0 after correction | Found inherited trailing spaces on ADR lines19/31 and an extra final blank line; normalized only that mutable ADR, retained its historical wording and reran the same assertions |

Manual review covered the full diff and both untracked files, source/test links, agent-instruction conflicts, planned-versus-implemented scope and changed-content privacy. The existing link verifier includes new untracked Markdown under maintained folders. No protected baseline/core/SQL/test, application, dependency/lockfile, script, manifest, archive/evidence or CI file changed.

Uncommitted documentation fingerprint, excluding this self-describing record: cbfae50d3822c99a269fa584ab1d3de28f79331020729cc05bfdb54f2bfa0f01. Method: SHA-256 over the other12 changed paths listed above, sorted by repository-relative path; append UTF-8 path, NUL, raw file bytes, NUL for each. This is the latest fingerprint including the documentation-only follow-up; its entry fingerprint is preserved below. It identifies documentation worktree content, not a committed source SHA or behavior-test result. This record's final text is separately included in link/diff/privacy checks.

Failures/limitations: baseline/alignment verifiers and Git diff checks passed throughout; the additional whole-file whitespace review failed once and passed after the narrow ADR correction above. No assertion or verifier was weakened. A read-only PowerShell text-capture attempt included oversized object metadata and could not be parsed; rereading plain strings in smaller batches succeeded before edits. Antigravity command lookup exit1 is a capability-discovery limit, not a DOC-01 implementation blocker.

Not run by design: dependency installation, application lint/unit/build/E2E/HTTP, workflow execution, services, live database/catalog/lifecycle checks, remote GitHub CI/artifacts, actual Antigravity session loading and Windows ACL audit. No private configuration, logs, credentials or process-environment dump was used.

## Documentation-only follow-up

Owner scope: remove the fixed current-task pointer and task-specific operating assumptions from the shared workflow; clarify the DOC-02 planning handoff; rerun documentation checks and update this record/fingerprint. DOC-02 and feature implementation remain unstarted.

Entry context: existing docs/doc-01-agent-workflow worktree at source HEAD 74e2f2c8975751d9c1545917ed7fa81be50d4400, with 11 modified tracked documents, two untracked documents and no staged changes. The entry fingerprint matched the previous recorded value 40964aa98fca8dec84c96f1a4977f0d2e3eba033c94f491128cb5a6a07934439. The existing DOC-01 work was preserved; no branch switch or new branch was needed.

Only docs/00-governance/agent-workflow.md and this record are edited by the follow-up. The workflow now resolves the current task through START-HERE, uses environment-neutral interpreter/delegation rules and links here for historical machine observations. The Agent execution row and original verification/limitation evidence above remain intact. DOC-01's restriction on additional agents required separate authorization; no additional agents were launched for either delivery.

The DOC-02 handoff below now requires an overall agreed-scope milestone/dependency/acceptance map, with the first remaining implementation milestone detailed into executable tasks and delivered foundation work separated from remaining work. Unresolved priority/provider/release decisions stay explicit. This is handoff clarification only; no plan milestones/tasks have been authored by this follow-up.

Follow-up verification status: local follow-up complete and verified; no material blocker. Checks assess this uncommitted documentation worktree at the same source HEAD, not a new committed revision.

| Follow-up command / review | Exit / result | Scope |
|---|---|---|
| python scripts/foundation/verify-baseline.py | 0 | 179 reviewed entries and integrated21 forward/21 rollback/eight original suites remain byte-identical |
| python scripts/alignment/verify.py | 0 | Nine core upload/index hashes, protected baseline/SQL and19 maintained Markdown link sources PASS |
| git diff --check; git diff --cached --check | 0 each | Tracked whitespace checks; index unchanged and empty of staged changes |
| python -X utf8 -u - (inline scope/new-file/privacy/fingerprint and full-delta review) | 0 | Only workflow/this record changed since entry; other11 existing DOC-01 files byte-preserved; same13-path worktree, no additional files; both existing untracked files reviewed |

The inline review checked UTF-8/newlines/trailing whitespace, private-value heuristics, source/branch/index boundaries and the exact follow-up delta, and recalculated the documented fingerprint. The original machine-observation and failure evidence remains historical and unchanged. No verifier/assertion was weakened. An orchestration snapshot lookup was retried before shell checks; no verifier ran or failed in that attempt.

Not run: application tests/builds, dependency installation, services, database/SQL operations, CI execution, remote checks or DOC-02. No code, protected source, dependency, SQL, CI, script, manifest, global setting, commit or push was changed by this follow-up.

## Unresolved decisions and blockers

See [open issues](../../../00-governance/open-issues.md). Owner selection of the next implementation slice, approved SMS/AI provider/data handling, production destination/operational ownership and R32/release sign-off remain decisions for affected work. None authorizes guessing policy or blocks independent documentation alignment.

The frontend R18/query-identifier and OAuth routing gaps, full Auth/deletion/AI/workers/UI and security/performance/PITR evidence remain future implementation gates. Existing CI push filters do not include this documentation branch pattern; DOC-01 does not change YAML, push or claim remote runs.

Material DOC-01 blocker: none. Maintained entry points, one shared workflow, current task/evidence record, explicit missing decisions and bounded next task are delivered; relevant documentation checks and protected-source verification pass. No new tool, global bootstrap or provider configuration was required. This does not establish full implementation, fresh application execution or release acceptance.

## Next bounded task — DOC-02 (not started)

Goal: prepare master-execution-plan.md for the agreed overall project scope through high-level milestones, dependencies and acceptance gates, then detail the first remaining implementation milestone into bounded executable tasks. Do not restrict the master plan to the delivered foundation or a single slice; respect adopted C01 scope/non-goals and explicit owner decisions.

Inputs: this record, current phase audit/open issues/config/context/source authority, original protected C01–C09 contracts, actual code/test/coverage boundaries and owner priorities. Read only relevant sections as dependencies require.

Deliverables: update docs/07-planning/master-execution-plan.md and create one current DOC-02 record. Map the agreed overall scope to high-level milestones with authoritative inputs, dependencies, required documentation and acceptance gates. Clearly separate delivered foundation work and its historical evidence from remaining implementation and unaccepted gates. Detail the first remaining implementation milestone into tasks with a goal, allowed scope/source references, deliverables, dependencies, verification commands and observable acceptance criteria. Preserve/link historical alignment provenance; do not implement those tasks.

Dependencies: owner priorities and selection/order of the first remaining implementation milestone for an executable commitment. If unresolved, document source-based candidates and mark selection pending instead of silently choosing policy. Keep provider/data-handling approvals, production destination/ownership and release/acceptance decisions explicit as dependencies or gates; do not invent their resolution or block independent planning.

Acceptance: the master plan covers the agreed overall scope at milestone level, identifies dependencies and acceptance gates, distinguishes delivered foundation from remaining work, and details the first remaining implementation milestone into bounded executable tasks. Preserve the distinction between requirement, approved exception, implementation, execution and acceptance. Keep unresolved priorities/provider/release decisions visible, identify which missing documents are needed when, and do not require all nine new files before planning. No feature/SQL/core-source/dependency/CI changes, invented completion percentages, calendar promises or historical PASS promoted to current PASS. Re-run documentation verifiers and leave the authorized delivery form.

DOC-01 does not begin DOC-02 or grant commit/push/PR/deployment permission.

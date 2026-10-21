# Repository alignment — চূড়ান্ত পর্যালোচনা

Repository: dev-mhemon/AI_Career_Mentor। Base/start live phase1-restart `4dffb54835f62f806accbb883a2cf6557c30bcdf`; এর পরে remote commit নেই। Branch `chore/repository-alignment`। Implementation checkpoint `1fdc6c98c87fe959ba976e767199892999dd598f`; পরের delivery commit শুধু report/evidence। [PR #2](https://github.com/dev-mhemon/AI_Career_Mentor/pull/2) খোলা, target phase1-restart। Final delivered SHA Git branch/PR head ও final owner summary-তে পাওয়া যাবে; self-referential report commit hash বানানো হয়নি।

নয়টি সম্পূর্ণ আপলোড title/ID/version দিয়ে শনাক্ত করে exact bytes-এ adopt হয়েছে। সব নয়টি historical baseline-এর corresponding file-এর সঙ্গে byte-identical; source/schema delta নেই। Subject authority: C01 product, C02 architecture, C03 domain, C05 HTTP, C06 exact SQL, C04 procedures, C08 AI, C09 UX; C07 scoped validation expectations। Adoption release acceptance নয়।

| ID / version | Uploaded file → active destination | Bytes | SHA-256 |
|---|---|---:|---|
| C01 / 1.4.1 | `C01_PRD.md` → `docs/01-product/PRD.md` | 72643 | `f440954c9a11e3df5b5b46fe97484ba2a247e4fca34a357fae441146d5fa12dc` |
| C02 / 1.1.1 | `C02_SAD.md` → `docs/02-architecture/SAD.md` | 43432 | `3ec734f5870fda2b8ab68f751759041c2580a4a117ef9f96d582509e16c842a4` |
| C03 / 1.2.2 | `C03_DDD.md` → `docs/03-domain/DDD.md` | 64012 | `8126ff486c9089ece6bc4fa31c2563a7580d105b194faa921752618263960a27` |
| C04 / 1.1.1 | `C04_DIS.md` → `docs/04-database/DIS.md` | 66659 | `0063c43318aa3fd390bd6f7b0f154fe0a998b79e6fd3f71942516db7f8fa3e5f` |
| C05 / 1.5.1 | `C05_API.md` → `docs/05-api/API-Specification.md` | 195279 | `0c5482798362b578c1312e3fc99f6bd9c9af261566e740c86048c036f7adbe25` |
| C06 / 1.2.2 | `C06_DMS.md` → `docs/04-database/DMS.md` | 227913 | `68829ec73f0bd85e3b2bd3fbba8086885e5322284ebbe9ee6d5442f460da28bb` |
| C07 / 1.1 | `C07_Validation.md` → `docs/04-database/validation-report.md` | 66814 | `fc46774c64b954ab5a33d8542372e45e81488b62a19e62659526126b3628662f` |
| C08 / 1.1.1 | `C08_AI_System_Design.md` → `docs/02-architecture/AI-System-Design.md` | 145873 | `218235a2bf62adb2e84b18069af4884e4191ba43b1074f2010383d0732d2ac12` |
| C09 / 2.0.2 | `C09_UI_UX.md` → `docs/01-product/UIUX-Specification.md` | 97899 | `a5dc92c2db4b6899e764c8b5a7de6757a6855593df31200e398a386b1c2752c7` |

`.gitattributes` source-specific -text preserves CRLF/encoding after actual fresh Git checkout. Immutable input files retain their original trailing whitespace/EOF; only those nine paths declare corresponding whitespace semantics. Other source still passes normal diff whitespace checks. Original baseline bytes/expected hashes/verifier and applied SQL/test bytes are unchanged.

[Complete inventory](file-inventory.json) covers all471original files:314keep,23update,115move,1archive,18delete। History/evidence moved byte-for-byte; root AGENTS/common guidance updated; old active v1.1 docs/plans and obsolete runtime entry points deleted after reference inspection। npm lockfiles/frameworks/transaction manager retained; no applied migration/seed replay, database/volume deletion or future modules created। [Inherited references](inherited-references.json) and context-map classify immutable historical/toolkit aliases separately from maintained working links.

Actual information architecture (present; nested app/source/evidence files retained):

```text
AGENTS.md, README.md, .gitignore, .gitattributes
.github/workflows/{ci.yml,database-ci.yml}
frontend/                   existing Next source + scoped framework guidance
backend/                    existing Nest source + focused corrections
scripts/{foundation,alignment}/
docs/
  00-governance/             START-HERE, source register/manifest, context/glossary/issues/config
  01-product/               PRD, UIUX-Specification
  02-architecture/          SAD, AI-System-Design
  03-domain/                DDD
  04-database/              DMS, DIS, validation-report
  05-api/                   API-Specification
  06-decisions/ADR/         retained technology decision
  07-planning/              execution plan, phase-1 audit, current-phase/{foundation,alignment}
  09-operations/            development runbook
  99-archive/               labelled useful historical frontend plan
planning/reviewed-baseline/  unchanged original package
supabase/{config.toml,migrations,rollbacks,tests}/
```

Planned and absent: frontend/backend architecture notes, business-rule index, DB schema map, OpenAPI/DTO mapping, QA/AI evaluation plans, deployment guide; seeds only if separately justified। Their scope/prerequisites/milestones are in [source register](../../../00-governance/source-of-truth.md); no fabricated contents/empty placeholders.

Shared Codex/Antigravity guidance is root AGENTS + START-HERE/context/handoff convention। Existing frontend generated framework rules retained। Antigravity is not installed; automatic discovery/settings syntax/ignore enforcement is not verified. Operator must load common rules explicitly; no inert `.aiignore` or conflicting rulebook is represented as security enforcement.

[Audit](../../phase-1-audit.md) gives F1–F4 sources, corrections/regression coverage, all82endpoint entries and all25screens with honest implementation status। Optional education/None/confirmed goal, transaction-time roadmap access, coalesced successful activity with rollback, nested error details/request IDs/retry headers corrected। Delivered OAuth next_step and nullable RoleOptionDTO rationale preserved। SMS consistency corrected; full provider/Auth/R18privacy routing remains explicit backlog。

| বর্তমান local validation | Result / scope |
|---|---|
| baseline and upload/index bytes | PASS179entries;21forward/21rollback/8suite;9active hashes |
| Backend | lint/build PASS;46unit;1E2E |
| Frontend | lint/build PASS;38unit |
| Actual Auth + HTTP + database |24scenario groups PASS, including injected activity persistence rollback |
| Database lifecycle |21fresh/185TAP/21down/21reapply/185TAP;27boundaries and separate-session concurrency PASS |
| Fresh checkout | frozen install, checkout-byte verification, builds, own generated configuration/startup, real HTTP PASS |
| Workflow / maintained links / diff | actionlint1.7.7, maintained local Markdown navigation, git diff --check PASS |

Review-copy terminal progress whitespace normalization is listed in [copy transformations](evidence-copy-transformations.json); original workspace logs remain intact. Exact commands/exit codes/start/finish/implementation/checked-out/base SHAs are retained in [evidence](evidence) and [validation.json](validation.json)। DB and initial app checks ran at3857af82;24HTTP cases atd2c63c15; final38frontend tests/build atfac739ae; stronger frontend content smoke at1fdc6c98। Only affected checks were rerun after subsequent changes; unchanged SQL lifecycle is not relabelled as run on later heads.

Initial upstream PostgreSQL pull failed due VFS no-space; failure log retained। Trusted crane release checksum and full upstream image digest/layers validation PASS, then flattened local image preserved runtime/health metadata। Auth binary unchanged; only exact loopback CLI health probe uses direct local BusyBox wget to avoid injected egress proxy403। This local image adaptation is labelled in image provenance; GitHub runners pull upstream registry images and reject onboarding-customized/digestless images. Fresh checkout local PASS uses this declared same-machine Docker cache and does not claim independent clean CI by itself.

Foundation merge commit has verified push CI success: [run39626684725](https://github.com/dev-mhemon/AI_Career_Mentor/actions/runs/39626684725)। Alignment checkpoint d2c63c15 has separate successful push [appCI](https://github.com/dev-mhemon/AI_Career_Mentor/actions/runs/39648223741) and [DBfoundationCI](https://github.com/dev-mhemon/AI_Career_Mentor/actions/runs/39648224347)。 Final delivered head gets its own new runs after this report commit; final PR body/checks and artifacts carry that observed outcome and exact merge-checkout/head/base distinction. Earlier success is not used as final-head evidence.

Initial ordinary GitHub REST calls returned Forbidden; later PR creation/run-list operations succeeded. Branch push and PR#2 are confirmed; no fabricated blocker/URL remains. Configuration draft includes api.github.com in addition to existing font domains; draft persistence itself is not runtime network enforcement/publication evidence.

Remaining Phase1/release gates are in the audit: full Auth/local SMS/social/linking/deletion, Redis/idempotency, workers/scheduler/AI/admin/full UI/PWA, privacy routing, provider approvals, full security/fault matrix, purge timing, performance and PITR/restore. R32 **in_progress/partially_executed**; R33 **optional/deferred**; owner/release acceptance pending. No merge or deploy. Main promotion waits for the owner's reviewed merge of PR#2 into phase1-restart, then fresh live divergence/CI inspection.

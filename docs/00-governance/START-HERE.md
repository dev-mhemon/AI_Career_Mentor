# শুরু করুন

এই repository-তে Phase 1 Supabase foundation এবং Windows tooling changes merge হয়েছে; পূর্ণ MVP এখনও তৈরি হয়নি। DOC-01 inspection শুরু হয়েছে clean main, HEAD 74e2f2c8975751d9c1545917ed7fa81be50d4400 থেকে। এটি recorded checkpoint, স্থায়ীভাবে checkout করার নির্দেশ নয়। প্রত্যেক নতুন task-এ actual Git state যাচাই করুন।

Current task / handoff status: this page selects the [M01-03 authority proof record](../07-planning/current-phase/M01-03.md#provider-and-challenge-authority-proof--2026-10-27) as the latest authorized proof and review handoff on dedicated branch `task/m01-03-provider-authority-proof` from verified base `6d0b8b5f1b07a2db1c0c38b59fce1d763ba3e7f8` (PR #11). PR #9 merged the M01-03 slice into `main`, PR #10 merged its post-merge documentation reconciliation, and PR #11 closed the post-PR #10 handoff. Synthetic authority boundary characterization tests and a proposed disposable proof matrix have been delivered locally; live provider proofs remain UNKNOWN and production `provider.ready()` remains fail-closed at 503 until positively identified disposable target verification and owner decisions on direct-call bypass and A04 timing parity are completed. Neither [M01-04](../07-planning/master-execution-plan.md#m01-04---email-verification-establishes-mapped-session) nor live activation is authorized. The [M01-01 record](../07-planning/current-phase/M01-01.md) and [M01-02 record](../07-planning/current-phase/M01-02.md) are historical. The [DOC-03 record](../07-planning/current-phase/documentation-alignment/DOC-03.md#post-merge-reconciliation--2026-10-26) preserves its original audit and later post-merge addendum as historical evidence; it is not the current-status authority.

The [master execution plan](../07-planning/master-execution-plan.md) remains **Draft / proposed for review** for remaining development. Its older branch and SHA observations, [DOC-01](../07-planning/current-phase/documentation-alignment/DOC-01.md) / [DOC-02](../07-planning/current-phase/documentation-alignment/DOC-02.md) and earlier M01-02 pending statements are dated evidence, not checkout instructions. The scoped derived inputs remain [backend architecture](../02-architecture/backend-architecture.md), [rule index](../03-domain/business-rules.md), [OpenAPI](../05-api/openapi.yaml), [DTO/DB mapping](../05-api/DTO-DB-mapping.md) and [QA plan](../08-testing/QA-plan.md).

নতুন agent-এর পড়ার পথ:

1. Root [AGENTS.md](../../AGENTS.md), applicable scoped instructions এবং এই পৃষ্ঠা।
2. [Source authority](source-of-truth.md), [shared workflow](agent-workflow.md) ও বর্তমান task record।
3. [Context map](context-map.md) থেকে task-এর প্রয়োজনীয় specification sections, source ও tests; ছোট কাজের জন্য নয়টি specification পুরোটা বাধ্যতামূলক নয়।
4. [Current phase audit](../07-planning/phase-1-audit.md), [open issues](open-issues.md) ও task dependencies।
5. Environment কাজ হলে [configuration register](config-register.md) ও [runbook](../09-operations/runbook.md)। Secret/runtime files দিয়ে context সংগ্রহ করবেন না।

বর্তমান source inspection-এ Auth/user mapping, access guards, profile/preferences/settings, alias interpretation, goal read/confirmation ও সীমিত health route আছে। Frontend Auth flow transitional; পূর্ণ Auth API, AI/workers, application workflows ও সম্পূর্ণ UI/PWA বাকি। Exact boundaries ও historical evidence identity audit-এ আছে। R32 in_progress / partially_executed; R33 optional/deferred।

নয়টি adopted specification-এর active copy numbered docs folders-এ আছে। [Manifest](source-manifest.json) exact bytes, version ও provenance দেয়। planning/reviewed-baseline/ immutable historical package; স্বাধীন editable authority নয়। Adopted SQL history frozen; নতুন applied-schema correction forward migration দিয়ে review করতে হবে।

Codex ও Antigravity একই repository guidance এবং workflow ব্যবহার করবে। Automatic discovery/loading যাচাই ছাড়া কোনো agent rules পড়েছে এমন দাবি নয়। প্রয়োজন হলে operator root AGENTS, এই পৃষ্ঠা, workflow ও task record খুলে দেবেন; duplicate agent rulebook তৈরি করবেন না। DOC-01-এ Codex executable PATH-এ পাওয়া গেছে, Antigravity lookup সফল হয়নি; এটি Antigravity installation অনুপস্থিতির প্রমাণ নয়। Global settings পরিবর্তন বা .aiignore enforcement-এর দাবি করা হয়নি।

Historical foundation/alignment reports তাদের নিজস্ব source/time-এর evidence; পুরোনো PASS বর্তমান HEAD-এর fresh PASS নয়। আগের task-এর commit/push/PR অনুমতি নতুন task-এ প্রযোজ্য নয়। বর্তমান owner scope, unresolved decisions এবং explicit acceptance gates অনুসরণ করুন।

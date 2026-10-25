# শুরু করুন

এই repository-তে Phase 1 Supabase foundation এবং Windows tooling changes merge হয়েছে; পূর্ণ MVP এখনও তৈরি হয়নি। DOC-01 inspection শুরু হয়েছে clean main, HEAD 74e2f2c8975751d9c1545917ed7fa81be50d4400 থেকে। এটি recorded checkpoint, স্থায়ীভাবে checkout করার নির্দেশ নয়। প্রত্যেক নতুন task-এ actual Git state যাচাই করুন।

Current authorized task: [M01-03 email registration/resend handoff](../07-planning/current-phase/M01-03.md). At the verified `origin/main` tip `bbca74ff45cb0a21631edb416fd4b19859fe64d0`, documentation PR #8 is merged after M01-02 PR #7. The M01-03 local worktree contains shared request validation, trusted proxy/client-IP handling and A01/A04 controller/service/adapter boundaries. Both routes fail closed in production until the provider, delivery and direct-bypass guarantees in the handoff are proven; synthetic HTTP results are not live email acceptance or owner sign-off. The [M01-01 record](../07-planning/current-phase/M01-01.md) and [M01-02 record](../07-planning/current-phase/M01-02.md) are historical; their scoped review, execution and Draft-design boundaries remain intact. The owner's original untracked DOC-03 file is preserved in the primary checkout, outside this isolated task worktree.

The [master execution plan](../07-planning/master-execution-plan.md) remains **Draft / proposed for review** for remaining development. The inherited documentation preparation used fetched main `f45947e84f035500856c6a3bb9b27e46ae5bebb9`. The owner now explicitly requires the existing feature branch at observed HEAD `3294c60c65ed9beddd02121899bce40170e588de`; future tasks must verify their own actual revision. This clarification supersedes the former documentation-branch expectation without rewriting its historical evidence. [DOC-01](../07-planning/current-phase/documentation-alignment/DOC-01.md) / [DOC-02](../07-planning/current-phase/documentation-alignment/DOC-02.md) and earlier M01-02 pending statements retain their dated evidence; the post-merge addendum supersedes their current-delivery status only. The scoped derived inputs remain [backend architecture](../02-architecture/backend-architecture.md), [rule index](../03-domain/business-rules.md), [OpenAPI](../05-api/openapi.yaml), [DTO/DB mapping](../05-api/DTO-DB-mapping.md) and [QA plan](../08-testing/QA-plan.md).

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

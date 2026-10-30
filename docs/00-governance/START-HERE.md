# শুরু করুন

এই repository-তে Phase 1 Supabase foundation এবং Windows tooling changes merge হয়েছে; পূর্ণ MVP এখনও তৈরি হয়নি। DOC-01 inspection শুরু হয়েছে clean main, HEAD 74e2f2c8975751d9c1545917ed7fa81be50d4400 থেকে। এটি recorded checkpoint, স্থায়ীভাবে checkout করার নির্দেশ নয়। প্রত্যেক নতুন task-এ actual Git state যাচাই করুন।

Current task / handoff status: M01-04 implemented on dedicated branch `feat/m01-04-verify-email-s1-otp` (base clean `main` `08c6da6e1cb59cee0aa32eac733401a529dd2065`, PR #16 merged). M01-04 activates Candidate S1 Redis OTP Secret Store (`AUTH_OTP_HMAC_SECRET`, effective `expiresInSeconds`, HMAC-SHA256 digest, `timingSafeEqual`, R31 5 attempts lockout, fail closed on Redis outage), Option 2B `EmailRegistrationProvider` (fail closed when transport unconfigured, GoTrue Admin `createUser({ email_confirm: false })`, Failure Boundary 2 recovery where `public.users.verified_contact = false` allows resend), EP-A02 `POST /api/v1/auth/verify-email` (DTO validation, canonical `public.users` check without `auth.users` fallback, S1 OTP verification, GoTrue admin confirm, serialized TypeORM transaction with `rowCount === 1` guard, default profile/preference initialization, magiclink session exchange and approval via `SessionApprovalService`), and frontend `/verify` `verifyOtpAction` integration (routing `profile_setup` to `/dashboard?next_step=profile_setup`). See [M01-04 current-phase task record](../07-planning/current-phase/M01-04.md). All backend and frontend test files pass; `node scripts/foundation/application-check.mjs` (25/25 foundation checks), baseline/alignment verifiers, lint, typecheck, build, and `git diff --check` all exit 0. Committed and pushed to PR #17 (branch `feat/m01-04-verify-email-s1-otp`). Ready for owner review and PR merge.

Historical: The [foundation backend HTTP CI repair handoff](../07-planning/current-phase/M01-03.md#foundation-backend-http-ci-repair--2026-10-30) and sync verification fixes were committed and pushed in commit 719d526 to PR #16; PR #16 was merged into `main` (`08c6da6e1cb59cee0aa32eac733401a529dd2065`).

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

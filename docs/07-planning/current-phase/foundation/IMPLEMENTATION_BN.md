# Phase 1 foundation বাস্তবায়ন প্রতিবেদন

`phase1-restart`-এর `37a785c84be7f5ba8a4d0b528a810623765140cc` commit থেকে তৈরি `feature/phase1-foundation` branch-এ কাজ হয়েছে। User অনুমোদিত finalization-এ implementation commit করা হচ্ছে; push/PR/remote CI-এর প্রকৃত ফল পৃথক exportable finalization record-এ থাকবে। merge/deploy করা হবে না। `planning/reviewed-baseline/START_HERE_BN.md` আছে। Applicable AGENTS.md, manifests, C01–C09-এর নয়টি নথি, reviewed handoff/review/status ও owner execution evidence পড়েই implementation হয়েছে। Root AGENTS-এর পুরোনো plan-approval/Phase 0/spec নির্দেশনার সঙ্গে বর্তমান নির্দেশনার সংঘাত ও npm/Vitest toolchain decision `DECISIONS.md`-তে লেখা আছে।

## পরিবর্তন

- `supabase/migrations/000..020`: reviewed ২১টি forward byte-identical; ২১টি down শুধু `supabase/rollbacks`; আটটি মূল pgTAP suite অপরিবর্তিত। আলাদা নতুন boundary suite আছে। Baseline-এর ১৭৯টি manifest entry এবং integrated SQL-এর size/SHA-256 মিলে গেছে।
- `database-ci.yml` এবং `scripts/foundation/`: pinned tooling, dedicated disposable project, readiness wait, private runtime configuration, manifest verification, fresh reset → test → reverse → reapply → post-reapply-test harness ও পৃথক evidence। পুরোনো PostgreSQL 15 এবং onboarding Supabase project অপরিবর্তিত।
- Backend: `public.users.id = auth.users.id`; live verified Auth identity থেকে atomic/idempotent provisioning; profile/preferences/provider mapping; metadata থেকে role/contact verification নয়। ES256/JWKS, issuer/audience/expiry/UUID যাচাই; database status/role/feature guard; owner-scoped SQL। সাধারণ request missing account তৈরি করে না। Suspended account bootstrap/me ব্যবহার করতে পারে, feature access false থাকে।
- Profile/alias/goal foundation: canonical/validated/user-scoped alias resolution, uncertain candidates, None, learning settings, user-scoped atomic interpretation, max-three confirmation ও deferred level-scoped progress। Confirmed level ছাড়া কোনো Junior fallback নেই; শক্তিশালী progress/evidence অক্ষত থাকে। UUID normalize করায় case ভিন্ন হলেও skill duplicate হয় না।
- Canonical `/api/v1`, unversioned `/health`, response/error envelope ও request ID। Existing UI-এর জন্য transitional `/auth/sync` রাখা হয়েছে; এটিকে C05 catalog route দাবি করা হয়নি। Frontend canonical response ও lowercase account status বোঝে এবং suspended dashboard আটকে দেয়।
- ORM synchronization/startup migrations বন্ধ; legacy CLI runner connection-এর আগেই ব্যর্থ হয়। Accepted D001 ব্যবহার হয়েছে; পুরোনো data transfer বা migration replay হয়নি।

Final review: `FINAL_REVIEW_BN.md`।

## পরীক্ষার ফল

সব নিচের PASS স্থানীয় execution থেকে; prepared workflow-কে remote CI pass বলা হয়নি। Commands, timestamps, exit codes, raw TAP ও hashes `evidence/`-তে আছে।

| পরীক্ষা | ফল |
|---|---|
| Baseline ও integrated SQL hash | PASS: ১৭৯ entry; ২১ forward / ২১ down / ৮ suite |
| Supabase readiness | PASS: PostgreSQL, Auth, Kong health; REST/JWKS HTTP readiness |
| Native Supabase CLI reset/test | PASS: ২১ migration; ৮ file, ১৮৫ assertion |
| Rollback/reapply | PASS: ২১ down; public app tables শূন্য; ২১ forward reapply |
| Post-reapply native CLI + emitted TAP | PASS: আবার ৮ file, ১৮৫ assertion; zero failure/skip/TODO |
| নতুন boundary suite | PASS: ২৭ assertion—active/suspended/feature-off RLS, private input/read/size, configuration bounds, unsummarized expiry, live reply SET NULL, old unfinished request, deletion success ও injected-failure rollback |
| Report concurrency | PASS: আলাদা দুই READ COMMITTED connection, lock contention দেখা হয়েছে, INSERT-এর আগে advisory lock; threshold=2, duplicate rejection ও rollback |
| Backend lint / unit / build | PASS / ২৫ test PASS / PASS |
| Backend existing E2E | PASS: ১ test |
| বাস্তব Auth + compiled backend HTTP | PASS: ২০টি scenario group; mapping, status, ownership/admin privacy boundary, invalid JWT/provider, contact metadata, alias/progress/goal limits ও deleted identity |
| Frontend lint / unit / build | PASS / ৩২ test PASS / PASS |
| Frontend production HTTP | PASS: login/register/verify 200; dashboard unauthenticated redirect |
| Fresh worktree setup | PASS: ignored credentials/dependencies ছাড়া নতুন directory-তে দুই `npm ci` ও build; বর্তমান backend source refresh করেও build PASS |
| Workflow actionlint 1.7.7 | PASS |
| Legacy TypeORM CLI | প্রত্যাশিত nonzero exit: database connection-এর আগে disabled error |
| Remote GitHub Actions | চালানো যায়নি: Actions permissions API `Forbidden`; run/artifact URL নেই |

প্রথম application run-এ ignored পুরোনো `.env`-এর JWKS URL অন্য local project-এ যাচ্ছিল, তাই bootstrap 401 হয়েছিল। Saved runtime helper এখন URL স্পষ্টভাবে override করে; final HTTP checks PASS। নতুন test fixture-এ ভুল job-status enum ও ভুল plan count ঠিক হয়েছে; half-hour validator-এর library behavior-ও actual HTTP test-এ ধরা পড়ে সংশোধিত হয়েছে। এগুলো reviewed SQL পরিবর্তন করে চাপা দেওয়া হয়নি; প্রথম ব্যর্থ boundary log retained আছে। কোনো reviewed migration defect পাওয়া যায়নি।

## Hash / provenance

- Catalog lock: `d58d790e02ce3ab178141e9dea4bd760f3cad4c56ce6df8b2360f6fd8e898c78`।
- Source ZIP SHA-256: `a65b36a6072e1b6bc20f716f0cf5867ef7fbdf82180eb58d8a5e25363f7ff0b3`।
- C01 SHA-256: `f440954c9a11e3df5b5b46fe97484ba2a247e4fca34a357fae441146d5fa12dc`।
- C06 SHA-256: `68829ec73f0bd85e3b2bd3fbba8086885e5322284ebbe9ee6d5442f460da28bb`।
- নয়টি document এবং সব SQL-এর সম্পূর্ণ hash `evidence/baseline-hashes.json`-তে; local execution-এর base commit ও worktree hashes পৃথক provenance file-এ। Manifest/lockfile ও reviewed baseline অপরিবর্তিত। Node 24.19.0, npm 11.9.0, Supabase CLI 2.121.0, PostgreSQL 17.11 ব্যবহার হয়েছে।

## Runtime configuration

মান প্রকাশ না করে প্রয়োজনীয় নাম: backend `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`; `PORT` এবং optional `SUPABASE_JWKS_URL`। Frontend-এর যাচাই করা exact নাম `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`। Public key হয় anon-role JWT অথবা `sb_publishable_…`; user bearer token আলাদা ES256 JWT। Service-role/secret key frontend-এ যায় না। Credentials/signing keys Git ও displayed logs-এর বাইরে private environment directory-তে আছে।

পুনরায় শুরু ও যাচাই: `STARTUP.md`; এই cloud-এ `bash scripts/foundation/cloud.sh start`, তারপর backend build/start এবং frontend build/start wrappers ব্যবহার করতে হবে। Shell-এর পুরোনো exports বা আগে থেকে চলা process-এর ওপর নির্ভরতা নেই।

## খোলা gate ও পরবর্তী ক্রম

১. Review করে implementation commit/push-এর পরে সেই exact commit-এ GitHub Actions চালিয়ে artifact যাচাই করতে হবে; এখানে API access নেই।
২. Canonical password/OTP/refresh/identity linking ও deletion API/worker/provider outbox, Redis lockout/rate limits এবং পূর্ণ profile/account UI করতে হবে। OAuth success-এর real Google/Facebook provider integration এখনো externally validated নয়; foundation-এর mismatch/live-identity logic পরীক্ষিত।
৩. Generation/worker/scheduler features-এর সঙ্গে transaction-time feature/ownership checks, retention scheduling, full deletion fault/retry matrix ও বাকি application/security/provider checks করতে হবে। Guard policy unit tests generation endpoints-এর runtime evidence নয়।
৪. Production-scale performance, PITR/restore drill, security review ও owner sign-off বাকি। সব ৮১ route, AI provider, worker, scheduler বা পূর্ণ UI বাস্তবায়িত বলা হচ্ছে না।

`R32.status=in_progress`, `runtime_status=partially_executed`; named gates `runtime-status.json`-তে। R33 `pending`, `optional_deferred`। Reviewed original issue records অক্ষত। SPECIFIED / STATICALLY_CHECKED / IMPLEMENTED / EXECUTED / ACCEPTED এক করা হয়নি। Development foundation স্থানীয়ভাবে ব্যবহারযোগ্য; publication/production acceptance প্রস্তুত ঘোষণা করা হচ্ছে না।

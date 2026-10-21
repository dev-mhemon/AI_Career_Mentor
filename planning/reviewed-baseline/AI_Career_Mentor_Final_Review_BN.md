# AI Career Mentor — Final Fixing Review ও Implementation Handoff

তারিখ: ২০ অক্টোবর ২০২৬ (Asia/Dhaka)  
Review source: `AI_Career_Mentor_Final_Review_20261020-205703.zip`  
Accepted correction checkpoint examined: **B10 / X02–X03**; owner acceptance আলাদা।

## 1. সিদ্ধান্ত

**নির্ধারিত documentation corrections-এর final bytes এবং চালানো local database checks এই review-এ মিলে গেছে। এই baseline ধরে Phase 1 implementation পুনরায় শুরু করা যায়।** Application বা production release validation সম্পন্ন হয়নি।

কোনো uploaded document-এর source mismatch পাইনি। Uploaded source দিয়ে আগের finite static verifier আবার চালিয়ে **72/72 pass** পেয়েছি। আলাদাভাবে hash, SQL/event sequence ও TAP logs মিলিয়ে **81/81 artifact-consistency checks pass** হয়েছে। এগুলো 153টি product test নয়; দুটি review method-এর আলাদা সংখ্যা। Reviewer environment-এ নতুন database চালানো হয়নি।

Owner-provided runner evidence-এ 21 forward migrations, 8 pgTAP suites, 21 reverse migrations এবং 21 forward reapply-সহ 74 successful execution events আছে। আটটি TAP log-এ **185/185 assertion pass; zero SKIP/TODO**। আলাদা Supabase CLI reset এবং 185-assertion PASS chat-এ সরবরাহ করা হয়েছে; তার raw log ZIP-এ নেই।

এই verdict পরিচিত fixes/source/evidence-এর scoped review। সব design decision, security edge case, scalability বা পুরো application-এর correctness-এর সার্টিফিকেট নয়।

## 2. কীসের সঙ্গে কী মিলিয়েছি

নয়টি uploaded file-এর প্রতিটি SHA-256 নিম্নের চারটি source-এর সঙ্গে মিলেছে: corrected release-এর final hash map; `current-static.json`; `source-manifest.json`; এবং actual DB `result.json`। C01 মূল frozen baseline-এর সঙ্গেও byte-identical।

| Document | Source identity | Implementation-এ ব্যবহার |
|---|---|---|
| C01 | ৪টি comparison-এ exact match | Frozen product requirements; byte-identical reference। |
| C02 | ৪টি comparison-এ exact match | Architecture/ADRs ও fresh Supabase storage strategy। |
| C03 | ৪টি comparison-এ exact match | Domain model; physical schema-র ক্ষেত্রে C06 অনুসরণ করবে। |
| C04 | ৪টি comparison-এ exact match | Database integration, index inventory ও access/connection contract। |
| C05 | ৪টি comparison-এ exact match | ৮২ catalog entry / ৮১ HTTP route-এর implementation contract। |
| C06 | ৪টি comparison-এ exact match | Authoritative physical SQL; ২১ forward, ২১ rollback ও ৮ existing test suite। |
| C07 | ৪টি comparison-এ exact match | Validation plan ও acceptance gates; current executions এই report/evidence-এ আলাদা। |
| C08 | ৪টি comparison-এ exact match | AI orchestration/worker contracts; full application typecheck/worker tests বাকি। |
| C09 | ৪টি comparison-এ exact match | UI behavior ও state contracts; running UI verification বাকি। |

Final catalog lock:

```text
d58d790e02ce3ab178141e9dea4bd760f3cad4c56ce6df8b2360f6fd8e898c78
```

Uploaded ZIP SHA-256:

```text
a65b36a6072e1b6bc20f716f0cf5867ef7fbdf82180eb58d8a5e25363f7ff0b3
```

পূর্ণ comparisons ও finite-check results: `review/review-checks.json`। এই report কোনো original journal/receipt নতুন করে sign করে না; owner approval তৈরি করে না। User PC-এর সম্পূর্ণ scripts/catalog/journal history review ZIP-এ ছিল না। Expected release-এর tool/source lock reviewer-side copy দিয়ে যাচাই হয়েছে।

## 3. Database evidence-এর ফল ও সীমা

| অংশ | ফল | কী প্রমাণ হয়েছে |
|---|---|---|
| Fresh `000–020` | 21 successful events | DMS-এর corrected SQL chain এই target-এ install হয়েছে। |
| pgTAP | 8 suites, 185 assertions | নিচের named cases পাস। |
| Reverse chain | 21 successful events | Down SQL চলেছে; empty-public-table postcondition পাস। |
| Reapply | 21 successful events | Rollback-এর পরে একই chain আবার install হয়েছে। |
| Supabase CLI path | Owner console PASS | CLI দিয়ে reset/8-suite execution হয়েছে; raw CI/CLI artifact এখানে নেই। |

| Suite | Assertions | ফল |
|---|---:|---|
| `001_schema.test.sql` | 110 | PASS |
| `002_constraints.test.sql` | 12 | PASS |
| `003_rls_security.test.sql` | 16 | PASS |
| `004_trigger_behavior.test.sql` | 11 | PASS |
| `005_ai_usage.test.sql` | 10 | PASS |
| `006_roadmap_integrity.test.sql` | 6 | PASS |
| `007_retention.test.sql` | 9 | PASS |
| `008_gaps.test.sql` | 11 | PASS |
| **মোট** | **185** | **PASS** |

Final source inventory: **50 tables; 45 enums; 103 secondary indexes; 22 private functions (10 SECURITY DEFINER + 12 SECURITY INVOKER); 68 triggers**। Source inventory দিয়ে এই সংখ্যা আবার মিলিয়েছি; 001 schema log-এ 50 tables, 45 enums, all-table RLS, leading FK coverage এবং 103 indexes-এর actual assertions পাস আছে। প্রতিটি function body বা trigger edge case আলাদাভাবে পরীক্ষিত এমন দাবি নয়।

X02-তে `idx_quiz_attempts_user_status(user_id,status)` unfiltered হয়েছে। X03-তে `idx_account_deletion_requests_user(user_id) WHERE user_id IS NOT NULL` যোগ হয়েছে। 019 gate, final schema FK query ও E01 exemptions দুর্বল না করেই current finite checks এবং DB gates পাস। Final count **99 before 020 + 4 in 020 = 103**।

আরও কিছু বাস্তব behavior দেখা গেছে: 007 suite summary না থাকলেও expired chat purge করে; old/recent request retention cases পাস; 008 suite-এ Auth user cascade deletion-এর completed tombstone থাকে; sequential পঞ্চম independent report shared topic hide করে। এগুলো সংশ্লিষ্ট full concurrency/failure matrix-এর বিকল্প নয়।

Evidence-এর সীমা:

1. প্রথম forward pass ও reapply একই `forward-*.sql/.log` filename ব্যবহার করে। ফলে 74 event record থাকলেও **53 distinct SQL/log pairs** আছে; প্রথম forward logs reapply overwrite করেছে। দুই event sequence ও hashes আছে, দুটি স্বাধীন first/reapply log archive নেই।
2. Runner pgTAP চালিয়েছে rollback-এর আগে। Reapply-এর পরে ওই runner নিজে pgTAP দ্বিতীয়বার চালায়নি। পরের CLI test একটি আলাদা fresh reset-এর পরে হয়েছে; সেটিকে post-reapply test বলে label করা যাবে না।
3. Raw CLI transcript, actual CLI-directory file hashes/migration-history export এবং repository commit/CI run URL ZIP-এ নেই। Console PASS গ্রহণ করেছি owner-supplied evidence হিসেবে।
4. Migration process success সব error branch runtime-এ execute করেছে এমন প্রমাণ নয়। Performance, restore ও provider behavior পরীক্ষা হয়নি।

এই সীমাগুলো বর্তমান local pass বাতিল করে না; ভবিষ্যৎ CI runner-এ `first-forward/`, `rollback/`, `reapply/`, `post-reapply-tests/` আলাদা evidence রাখলে audit শক্ত হবে। Existing hash-locked patcher script hand-edit করার প্রয়োজন নেই। নতুন application repository-র validation harness-এ এই improvement করুন।

## 4. Issue অনুযায়ী assessed status

মূল 39টি tracked entry এবং X01–X03 মিলিয়ে এখানে 42টি disposition আছে। Live state snapshot-এ 41টি row: **38 patched, 1 closed prerequisite, 1 pending optional, 1 blocked runtime gate**। X01 একটি fixture correction; তার standalone live-state row নেই, তবে catalog/static check ও 006 execution-এ evidence আছে। এটি কোনো হারিয়ে যাওয়া mandatory product feature নয়।

`Specification verified` মানে expected correction final source-এ আছে ও finite check পাস; feature implemented বা full runtime accepted নয়। নিচের scope দেখে issue review করুন।

| ID | বিষয় | সংশ্লিষ্ট documents | এই review-এ ফল / যা বাকি |
|---|---|---|---|
| V00 | নয়টি source file-এর পরিচয় ও hashes | C07, C01, C02, C03, C04, C05, C06, C08, C09 | Hash identity verified — C01 baseline-এর সঙ্গে byte-identical; বাকি আটটি corrected release-এর সঙ্গে exact match। |
| R01 | Fresh Supabase restart strategy | C02, C04, C06, C07 | Strategy + local DB verified — Fresh install/rollback-reapply পাস; পুরোনো DB transfer N/A। Repository/CI adoption বাকি। |
| R02 | আটটি AI-generation FK index | C06, C02, C03, C04, C07 | Local DB gate verified — 019 ও schema suite-এর FK coverage/count gate পাস; performance benchmark নয়। |
| R03 | AIResponseContract TypeScript syntax | C08 | Static syntax verified — C08-এর TypeScript blocks parse; application compiler/typecheck বাকি। |
| R04 | ১১টি অসম্পূর্ণ rollback body | C06, C04, C07 | Rollback/reapply verified — ২১টি reverse event ও ২১টি reapply event পাস; প্রথম forward logs আলাদা রাখা হয়নি। |
| R05 | Account deletion-এর atomic completion | C06, C05, C02, C03, C04, C07, C09 | Successful cascade path verified — 008 suite-এ Auth user deletion-এর পরে completed tombstone থাকে; failure injection/retry বাকি। |
| R06 | DeletionReceipt; 401-কে completion না ধরা | C02, C05, C09, C03, C06, C07 | Specification verified — Receipt scope, expiry, polling ও 401 boundary API integration-এ পরীক্ষা করতে হবে। |
| R07 | Level confirmation-এর আগে progress deferred রাখা | C05, C02, C03, C09, C06, C07 | Specification verified — Alias storage suite পাস হলেও pre-confirmation progress deferral-এর service flow বাকি। |
| R08 | Summary ছাড়াও মেয়াদোত্তীর্ণ raw chat purge | C06, C03, C04, C05, C08, C02, C07, C09 | Selected retention cases verified — 007-তে summarized ও unsummarized expired message purge পাস; boundary/read-cutoff/purge SLO বাকি। |
| R09 | AI request retention-এর creation clock | C06, C03, C05, C08, C02, C04, C07 | Selected retention cases verified — 007-তে old request purge/recent request preservation পাস; stale queued/unfinished boundary বাকি। |
| R10 | Active-account ও technology-access gates | C06, C02, C03, C04, C05, C07, C09 | Basic RLS cases verified — 003-তে cross-user isolation, write denial ও suspended admin case পাস; নতুন পূর্ণ gate matrix বাকি। |
| R11 | Human QA-তে অনুমোদিত data scope | C08, C02, C05, C07, C09 | Specification verified — Production chat sampling নিষেধ ও অনুমোদিত QA scope আছে; provider/egress evidence বাকি। |
| R12 | Durable, private ও bounded AI input | C06, C02, C03, C04, C05, C07, C08 | DDL + specification verified — Column/constraints/grants install হয়েছে; payload size ও unauthorized read-এর dedicated boundary tests বাকি। |
| R13 | Queue claim, lease, fencing ও recovery | C08, C02, C03, C04, C05, C06, C07 | Specification + basic state tests — 005-এর state transitions পাস; দুই worker, lease expiry ও stale commit fencing পরীক্ষা হয়নি। |
| R14 | Idempotency cache-loss policy | C02, C04, C05, C06, C07, C08 | Specification verified — Redis loss/TTL/method-route-body collision-এর বাস্তব tests বাকি। |
| R15 | SSE wire/lifecycle contract | C02, C05, C08, C09 | Specification verified — SSE framing-এর running endpoint, disconnect ও client lifecycle tests বাকি। |
| R16 | পাঁচটি screen-এর local state/actions | C09, C05 | Specification verified — Actual UI states, keyboard, reload ও retry tests বাকি। |
| R17 | 202 response-এর পরে result ID পর্যন্ত অপেক্ষা | C09, C05, C08 | Specification verified — Actual 202 job polling এবং successful result navigation tests বাকি। |
| R18 | Verify/resend-এর normalized identifier | C09, C05 | Specification verified — Actual verify/resend/reload flow বাকি। |
| R19 | DDD বনাম DMS physical authority | C03, C04 | Document alignment verified — Physical SQL authority C06; DDD পূর্ণ schema copy নয়। |
| R20 | Function security classification | C03, C04, C07 | Inventory/security declarations verified — ২২ private function = ১০ DEFINER + ১২ INVOKER; পুরো privilege abuse matrix নয়। |
| R21 | Evidence অনুযায়ী validation claims | C04, C06, C07, C02, C03, C05, C08, C09 | Scoped claims verified — Frozen docs static snapshot; নতুন DB evidence sidecar-এ যুক্ত করতে হবে। |
| R22 | Operational/performance scripts-এর executable source | C06, C04, C07 | Executable source present — ৩টি extra script extract হয়েছে; representative load/EXPLAIN/upgrade benchmark চালানো হয়নি। |
| R23 | Version-aware PITR/restore checks | C06, C04, C07 | Restore specification verified — Actual backup/restore/PITR drill ও measured RPO/RTO বাকি। |
| R24 | Meaningful activity-এর event rule | C05, C02, C08, C09 | Specification verified — Successful meaningful events ও excluded background activity-এর service tests বাকি। |
| R25 | Scheduler concurrency ও local-date contract | C02, C03, C05, C06, C07, C08, C09 | Specification verified — Concurrent/date-change/session-loss scheduler tests বাকি। |
| R26 | Runtime configuration bounds | C06, C02, C03, C04, C05, C07, C08 | DDL + specification verified — Bounds constraint install হয়েছে; invalid config ও exact-limit cases বাকি। |
| R27 | Report threshold-এর concurrency protocol | C06, C02, C04, C05, C07, C08 | Sequential threshold verified — 008-তে পঞ্চম independent report-এ hide পাস; concurrent sessions-এর lock protocol বাকি। |
| R28 | API catalog/HTTP route count | C04, C05, C08, C09, C02, C07 | Static inventory verified — ৮২ catalog entry / ৮১ HTTP route; এতগুলো route implemented হয়েছে এমন দাবি নয়। |
| R29 | চারটি নির্দিষ্ট DTO contract | C05, C08, C09 | Specification verified — DTO nullability/required fields-এর actual OpenAPI/client/compiler agreement বাকি। |
| R30 | UTC day grouping ও zero-filled series | C06, C05, C07, C09 | Function installed; contract static — by_day/UTC definition আছে; empty days, timezone ও range boundary output tests বাকি। |
| R31 | Auth/SMS counters ও TTL | C02, C04, C05, C07, C08 | Specification verified — Auth counter expiry, SMS delivery metadata, resend/lockout tests বাকি। |
| R32 | Runtime ও CI acceptance evidence | C07, C02, C04, C05, C06, C08, C09 | Partially executed; remains open — Local DB runs পাস; CI/new DB boundary/application/provider/operational gates বাকি। |
| R33 | ঐচ্ছিক PRD editorial provenance | C01, C02 | Optional/deferred — C01 edit হয়নি; pending state-কে mandatory blocker হিসেবে ধরতে হবে না। |
| R34 | Rating ও report-এর পৃথক capabilities/targets | C09, C05 | Specification verified — Rating ও report props/capabilities পৃথক; actual target/context UI tests বাকি। |
| R35 | User deletion-এর পরেও provider cleanup retry input | C06, C05, C02, C03, C07, C08, C09 | DDL + specification verified — Provider cleanup outbox/expiry constraints install হয়েছে; retained input, retry/deadline ও provider acknowledgement tests বাকি। |
| N01 | Dashboard preview fetch/access mapping | C09, C05 | Specification verified — Running dashboard preview fetch/feature-gate tests বাকি। |
| N02 | Reply FK-তে ON DELETE SET NULL | C06, C03, C07, C08 | FK definition installed — ON DELETE SET NULL source/DDL আছে; expired parent + live child dedicated behavior test বাকি। |
| E01 | Constraint অনুযায়ী FK-index exceptions | C06, C04, C07 | Unchanged gate passed — Final FK coverage gate পাস; পাঁচটি named exception অপরিবর্তিত। |
| X01 | Uniqueness probe-এর উপযুক্ত fixture | C06 | Fixture path verified — 006-এর uniqueness probe সঠিক fixture দিয়ে চলে; product behavior পরিবর্তন নয়। |
| X02 | Quiz-attempt user FK-এর all-state index | C06, C04 | Local FK coverage verified — Unfiltered (user_id,status) index আছে; 019 ও final FK query পাস। |
| X03 | Account-deletion user FK-এর non-null index | C02, C03, C04, C06, C07 | Local FK coverage verified — Nullable user FK-তে IS NOT NULL index আছে; final 103-index/FK query পাস। |

## 5. Status bookkeeping-এর যে পরিবর্তন দরকার

Uploaded `issue_state.json`-এর phase এখনো `documentation_patched_static_checks_scoped_runtime_unexecuted`; R32 `blocked_environment/not_run`; X02/X03-সহ patched issues runtime `not_run`। Patcher static application-এর সময় এগুলো লিখেছিল; পরের DB runner সেগুলো update করে না। তাই নতুন execution evidence পাওয়ার পর **live summary stale**। এটি SQL-এর নতুন defect নয়।

সঠিক current assessment:

| Field / area | Current assessment |
|---|---|
| Documentation | Applied; exact source/static checks verified; product/owner acceptance আলাদা। |
| Local existing DB suite | Executed PASS; 185 assertions। |
| Rollback/reapply | Executed PASS within documented scope। |
| Local CLI suite | Owner console reports PASS; raw CI artifact pending। |
| R32 aggregate | Partially executed; remaining gates open। |
| R33 | Optional/deferred; mandatory blocker নয়। |
| Application / CI / production | Not established by this ZIP। |

`review/reviewed-status.json`-এ এই assessment দেওয়া আছে। Original live state-এর copy অপরিবর্তিত `evidence/issue-state.owner-original.json`-এ রাখা হয়েছে। এই handoff original PC বা issue state সরাসরি edit করেনি। নতুন implementation agent live state reconcile করলে existing allowed status ব্যবহার করবে (R32-এর coarse status `in_progress`, runtime `partially_executed`), named scope/evidence যোগ করবে এবং R32 open রাখবে। R33-এর operational status pending থাকলেও disposition `optional_deferred` লিখবে। নতুন unsupported status enum উদ্ভাবন করবে না।

Original static reports বা frozen docs-এ `not_run` তাদের preparation-time scope বোঝায়। সেগুলোকে silently runtime-pass report বানাবেন না। Current evidence ledger-এ নতুন run যোগ করুন। পরের documentation patch/rollback state summary আবার static অবস্থায় ফেরাতে পারে; evidence append করে reconcile করুন।

Legacy `scripts/check_workspace.py` expected issue count 39 hardcode করে, কিন্তু corrected release plan-এ X02/X03-সহ 41 row। এটি পুরোনো helper; current Node verifier-এর বিকল্প হিসেবে ব্যবহার করবেন না। নতুন repository-তে প্রয়োজন হলে source-driven count/status helper লিখুন। User PC-তে ওই legacy helper execute করে failure যাচাই করা হয়নি।

## 6. R32-এর বাকি কাজ: implementation backlog

| ক্রম | কাজ / issue | Done বলার জন্য evidence | কখন |
|---:|---|---|---|
| 1 | CI baseline — R01/R02/R04/X02/X03 | Exact commit/source manifest; pinned environment; `supabase db reset`, 001–008 pgTAP logs; CI URL/artifact। | Repository foundation; production DB freeze-এর আগে বাধ্যতামূলক। |
| 2 | RLS/input/config — R10/R12/R26 | Active/suspended/feature-off cases; queue payload read denial; exact/over-size inputs; invalid config rejection। | DB test foundation; protected feature exposure-এর আগে। |
| 3 | Retention/reply — R08/R09/N02 | Expired parent/live reply SET NULL; expiry read cutoff; creation-clock queued/unfinished boundary; current rows preserved। | DB tests প্রথমে; পরে actual purge job timing। |
| 4 | Local deletion — R05/R35 | Cascade failure/transaction rollback; retained cleanup input, hard expiry and null-user tombstone behavior। | DB + deletion service। |
| 5 | Report concurrency — R27 | Separate DB sessions; required pre-insert transaction lock; threshold crossing ঠিক এক committed state-এ। | Transaction-capable repository implementation। |
| 6 | Auth/profile foundation — R07/R24/R31 | JWT/account mapping; server guards; pre-confirmation deferral; event and resend/expiry boundaries। | Phase 1 core services। |
| 7 | Workers/scheduler — R13/R25 | Two-worker collision, heartbeat/expiry, stale fence rejection, retry limits; timezone/date/session loss। | Worker/scheduler implementation। |
| 8 | API/cache/deletion receipt — R06/R14/R15/R29/R30 | Actual app typecheck, OpenAPI/client parity; receipt/401/expiry; Redis failure; SSE; UTC output boundaries। | Running backend。 |
| 9 | UI — R16/R17/R18/R34/N01 | Actual reload/retry/202 navigation; feedback targets; preview gates; accessibility। | Running frontend。 |
| 10 | Provider/privacy — R11/R35 | Approved synthetic/shared QA corpus; egress policy; provider retry after local deletion। | Provider integration。 |
| 11 | Performance/recovery — R22/R23 | Representative EXPLAIN/load, measured purge SLO, actual restore/PITR RPO/RTO evidence। | Representative staging/recovery environment。 |

বর্তমান 185 tests আবার অকারণে বাড়তি বার চালালেই এই gaps বন্ধ হবে না। নতুন executable cases ও সংশ্লিষ্ট implementation দরকার। New DB cases আলাদা files-এ যোগ করুন; approved 001–008 বা তাদের expected results বদলে failure আড়াল করবেন না।

## 7. এখন implementation কীভাবে শুরু করবেন

1. এই reviewed `docs/`-কে implementation reference হিসেবে নিন। C01 frozen product scope; API/C06 authority ও precedence chain মেনে কাজ হবে। Parent repository-র AGENTS.md, package manifests ও existing code আগে পড়ুন।
2. পুরোনো Phase 1 code reusable scaffolding কি না inspect করুন। **পুরোনো চার TypeORM migrations নতুন Supabase-এ replay নয়; পুরোনো users schema-র ওপরে DMS overlay নয়।** Automatic ORM schema synchronization বন্ধ থাকবে। Existing library/driver থাকা মানেই সব ফেলে দিতে হবে এমন সিদ্ধান্ত নয়; documented repository/transaction contract বাস্তবায়ন করুন।
3. Supabase হবে **Auth এবং primary application PostgreSQL storage**। `auth.users` ও `public.users` mapping physical DMS অনুযায়ী করুন; backend writes/AccessGuard এবং server-only credentials-এর contract মানুন। Backend setup সফল হয়েছে ধরে নেবেন না—এই ZIP-এ backend code নেই।
4. `supabase/migrations`-এ 21 reviewed forwards; rollback SQL শুধু `supabase/rollbacks`-এ; tests `supabase/tests/database`-এ। Pack-এ SQL hand-edit করা হয়নি—C06 থেকে deterministically materialize হয়েছে। Adopt করা target-এ migration history/checksums version control-এ freeze করুন; পরের schema change reviewed forward migration-এ করুন।
5. Actual repository config নিয়ে local/CI environment বানান। Existing validation project's config এই upload-এ ছিল না; এই pack কোনো hosted project link বা production deployment তৈরি করে না। Tested CLI 2.121.0/server 17.11 previous owner output-এ দেখা; run-specific version capture CI-তে রাখুন।
6. প্রথম delivery সীমিত রাখুন: repository reconciliation + database CI + Auth/user mapping + account/access guards + smoke/contract tests। তারপর profile/goal/worker/API/UI milestones dependency অনুযায়ী চলবে।
7. প্রতি milestone-এ source/commit, command, environment, timestamp, exit status, assertion count, logs এবং remaining gates লিখুন। `ACCEPTED` কেবল বাস্তব reviewer/owner decision হলে।

Copy করার জন্য সম্পূর্ণ English task: `IMPLEMENT_PHASE1_RESTART_PROMPT.md`। Agent-কে নিজের actual application repository-তে সেই prompt দিন। Baseline read-only review এবং migration integration করতে Codex বাধ্যতামূলক নয়; সক্ষম coding agent বা developer একই workflow নিতে পারে।

## 8. Readiness verdict-এর সীমা

এখন বলা যায়: **expected documentation patches applied; exact source identified; named local DB checks passed; implementation restart baseline available**।

এখন বলা যাবে না: সব docs 100% implementation complete; 81 endpoints implemented; সব RLS/concurrency edge safe; CI accepted; production-ready। 90টি weighted criterion নতুন করে evidence অনুযায়ী score করা হয়নি। Test count বা patched issue count থেকে শতাংশ বানানো হয়নি।

Owner acceptance record ZIP-এ নেই। এই report একটি technical review recommendation; চূড়ান্ত owner approval নয়। Documentation execution শেষ করার জন্য পুরো application আগে তৈরি করা দরকার নেই; নতুন application-dependent tests তার implementation milestone-এ সম্পন্ন হবে।

## Appendix: Final document hashes

| ID | File | SHA-256 |
|---|---|---|
| C01 | `C01_PRD.md` | `f440954c9a11e3df5b5b46fe97484ba2a247e4fca34a357fae441146d5fa12dc` |
| C02 | `C02_SAD.md` | `3ec734f5870fda2b8ab68f751759041c2580a4a117ef9f96d582509e16c842a4` |
| C03 | `C03_DDD.md` | `8126ff486c9089ece6bc4fa31c2563a7580d105b194faa921752618263960a27` |
| C04 | `C04_DIS.md` | `0063c43318aa3fd390bd6f7b0f154fe0a998b79e6fd3f71942516db7f8fa3e5f` |
| C05 | `C05_API.md` | `0c5482798362b578c1312e3fc99f6bd9c9af261566e740c86048c036f7adbe25` |
| C06 | `C06_DMS.md` | `68829ec73f0bd85e3b2bd3fbba8086885e5322284ebbe9ee6d5442f460da28bb` |
| C07 | `C07_Validation.md` | `fc46774c64b954ab5a33d8542372e45e81488b62a19e62659526126b3628662f` |
| C08 | `C08_AI_System_Design.md` | `218235a2bf62adb2e84b18069af4884e4191ba43b1074f2010383d0732d2ac12` |
| C09 | `C09_UI_UX.md` | `a5dc92c2db4b6899e764c8b5a7de6757a6855593df31200e398a386b1c2752c7` |

Review bundle input অপরিবর্তিত রাখা হয়েছে। এই handoff-এর `review/package-manifest.json` সব delivered file-এর SHA-256 দেয় (manifest নিজেকে বাদ দিয়ে)। `evidence/` owner-provided execution record; `review/` reviewer-side assessment। কোনোটিই cryptographic third-party runtime attestation নয়।

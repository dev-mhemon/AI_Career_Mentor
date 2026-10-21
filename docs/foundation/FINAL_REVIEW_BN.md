# Foundation finalization review

এই review শুধু বিদ্যমান foundation delivery চূড়ান্ত করছে; নতুন application feature যোগ করছে না। `feature/phase1-foundation`-এর base হলো `phase1-restart` commit `37a785c84be7f5ba8a4d0b528a810623765140cc`। User এই branch commit/push এবং `phase1-restart`-এ PR অনুমোদন করেছেন; merge/deploy অনুমোদিত নয়। Root AGENTS-এর পুরোনো `develop` PR target-এর বদলে এই explicit target অনুসৃত হচ্ছে।

Tracked additions/modifications/deletions এবং সব untracked implementation file পর্যালোচিত। Reviewed migration/rollback/test copies manifest দিয়ে byte-for-byte পরীক্ষা হয়েছে; নতুন boundary SQL, backend, frontend, scripts/workflow এবং saved evidence/status আলাদা করে দেখা হয়েছে। Finalization artifact-এ file inventory ও secret-exclusion verification থাকবে।

## Review findings

- **FIXED — progress initialization:** বৈধ `not_started` row-তে initializer-এর একই `state_reason` থাকলে reviewed trigger promotion প্রত্যাখ্যান করত। Initializer এখন পুরোনো reason অনুযায়ী ভিন্ন nonempty reason দেয়। Actual HTTP regression test-এ এমন fixture থেকে goal confirmation এবং stronger evidence preservation পরীক্ষিত। Reviewed SQL অপরিবর্তিত।
- **FIXED — provisioning collision:** reviewed unique contact/provider constraint conflict আগে generic 500 দিত। এখন কেবল নির্দিষ্ট identity constraints-এর `23505` sanitized `409 IDENTITY_LINK_CONFLICT` দেয়। Actual HTTP test-এ দুই UUID mapping বজায় থাকে; cross-account merge হয় না।
- **VERIFIED — Auth/status:** JWT signature/issuer/audience/expiry/UUID যাচাইয়ের পরে explicit bootstrap live Supabase user পড়ে। Metadata role/contact বিশ্বাস করা হয় না। Existing suspension/admin assignment bootstrap বদলায় না। সাধারণ missing mapping fail-closed; শুধু `auth/me` ও bootstrap-এর সীমিত exception আছে। ভবিষ্যৎ logout/deletion endpoint এই delivery-তে নেই।
- **VERIFIED — ownership/privacy:** path lookup user ID দিয়ে scoped; foreign goal-এ admin-ও 404 পায়। Admin role DB থেকে আসে। Private mentor/chat/context-এর admin API নেই; reviewed RLS suite-এর privacy checks অপরিবর্তিত।
- **VERIFIED — transaction:** সব mediated writes transaction এবং user lock-এর মধ্যে; write transaction account row lock/status পুনরায় পরীক্ষা করে। Alias/profile/progress এবং goal confirmation atomic। ভবিষ্যৎ generation endpoints-এ transaction-time feature integration এখনো named pending gate।
- **VERIFIED — `/auth/sync`:** এটি authenticated transitional bootstrap adapter, public বা general status bypass নয়; C05 catalog-এর অতিরিক্ত completed endpoint হিসেবে গণনা করা হচ্ছে না। Response envelope এবং canonical `/api/v1` client বিদ্যমান UI-এর সঙ্গে মেলে।
- **FIXED — staged whitespace:** Next build progress log-এর CR/trailing whitespace clean text copy করা হয়েছে; original local artifact ও দুই hash আলাদা metadata-তে আছে। Raw TAP অপরিবর্তিত।
- **FIXED — evidence hygiene:** private-log/signing-key ignore rules এবং command log redaction যোগ হয়েছে। Frontend HTTP artifact-এ explicit passed/failed status আছে।
- **FIXED — clean-runner provenance:** workflow registry থেকে upstream PostgreSQL/Auth images pull করে; runtime images-এ registry digest ও onboarding customization label পরীক্ষা করে। Generic CI path কোনো `/workspace/.mentor-tools`, cloud wrapper বা private onboarding file চালায় না। Local negative test customized cached image প্রত্যাখ্যান করেছে; এটি real GitHub execution নয়।
- **FIXED — PR SHA evidence:** PR target `phase1-restart` trigger আছে। Checkout depth 2 রাখায় merge commit ও head parent পাওয়া যায়। CI artifact-এ implementation head, actual checked-out/tested SHA, GitHub event SHA, run URL ও image digests থাকে; artifact URL job summary-তে লেখা হয়। GitHub conclusions/run/artifact links push-এর পরে পৃথক finalization record-এ সংগ্রহ করতে হবে।

## Evidence boundaries

`evidence/database/` পূর্বের স্থানীয় 21/185/21/21/185, 27 boundary assertion এবং separate-session concurrency run সংরক্ষণ করে। SQL ও database harness-এর execution path বদলায়নি; এই unchanged lifecycle বারবার চালিয়ে নতুন verdict বানানো হয়নি। `evidence/finalization/`-এ affected lint/unit/build/E2E/HTTP regression ফল আছে। Final real HTTP/Auth scenario group সংখ্যা **20**। Frontend application source অপরিবর্তিত; পূর্বের 32 tests/lint/build evidence প্রযোজ্য, HTTP recorder change পুনরায় পরীক্ষিত।

পুরোনো local evidence-এর `committed=false`/worktree snapshots ঐ execution-এর provenance; সেগুলোকে committed remote CI হিসেবে ব্যাখ্যা করা যাবে না। বর্তমান commit, push/PR failure অথবা success, tested SHA/run conclusion/artifact URL আলাদা exportable finalization record-এ থাকবে। `/actions/permissions` Forbidden অন্য operation-এর ফলের প্রমাণ নয়; ordinary push/PR/API calls আলাদাভাবে চেষ্টা করা হবে।

R32 `status=in_progress`, `runtime_status=partially_executed`; R33 optional/deferred। Owner/release acceptance, পূর্ণ Auth/provider/deletion/worker/scheduler, production security/performance/PITR gates pending। কোনো merge/deploy নয়।

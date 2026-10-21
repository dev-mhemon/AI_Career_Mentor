# Reviewed baseline ব্যবহার

প্রথমে `AI_Career_Mentor_Final_Review_BN.md` পড়ুন। Documents ও SQL-এর original bytes এই pack-এ আছে; original handoff autopatcher/catalog/tools এখানে নেই। এটি আগের fixing toolkit-এর replacement নয়—implementation reference ও evidence handoff।

1. এই folder actual application repository-র পাশে রাখুন; পুরো folder project-এর ওপরে extract/overwrite করবেন না।
2. Phase 1-এর কাজ করানো agent/developer-কে `IMPLEMENT_PHASE1_RESTART_PROMPT.md` দিন এবং actual repository access দিন।
3. সে প্রথমে সব docs/context পড়বে, তারপর review/evidence, তারপর বিদ্যমান code inspect করে foundation integration করবে।
4. `supabase/`-এ 21 forward, 21 rollback, 8 existing test file আছে। `scripts/db/`-এ 3 extra source আছে। Repo-র Supabase config/CI/backend এখানে তৈরি বা execute হয়নি।
5. `evidence/` original uploaded runtime records; `review/` latest assessed status। Live PC-এর state file এই pack বদলায়নি।
6. R32 open রাখুন। Local DB success-এর পরে fresh development শুরু করা যায়; CI freeze ও release gates তাদের নির্দিষ্ট সময়ে পূরণ করতে হবে।

এই pack কোনো database reset বা installation command স্বয়ংক্রিয়ভাবে চালায় না। Existing tests-এর নতুন source/correction বা actual repository integration ছাড়া অকারণে পুনরাবৃত্তি প্রয়োজন নেই।

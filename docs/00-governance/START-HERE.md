# শুরু করুন

বর্তমান কাজ: Phase 1 restart-এর repository alignment। Integration base `phase1-restart` = `4dffb54835f62f806accbb883a2cf6557c30bcdf` (foundation PR #1 merge)। Remote fetch-এ এর পরে কোনো commit পাওয়া যায়নি; `main` থেকে কাজ শুরু হয়নি।

পড়ার ক্রম: [source authority](source-of-truth.md), [context map](context-map.md), [open issues](open-issues.md), [execution plan](../07-planning/master-execution-plan.md), [current audit](../07-planning/phase-1-audit.md), [runbook](../09-operations/runbook.md)। নয়টি supplied specification-এর সম্পূর্ণ অপরিবর্তিত active copy নির্ধারিত numbered folder-এ আছে। [Manifest](source-manifest.json) exact bytes, SHA-256, version ও provenance দেয়।

`planning/reviewed-baseline/` historical immutable evidence package; independent editable active specification নয়। বর্তমান আপলোডের নয়টিই baseline-এর corresponding source-এর সঙ্গে byte-identical—প্রতিটির comparison করা হয়েছে। Applied SQL rewrite বা নতুন schema migration প্রয়োজন হয়নি।

Codex: root/scoped AGENTS.md পড়ুন। Antigravity এই environment-এ installed নয়; automatic AGENTS discovery/adapter syntax যাচাই হয়নি। Antigravity session-এ operator প্রথমে root AGENTS.md ও এই পৃষ্ঠা context হিসেবে পড়াবেন। আলাদা rulebook/অযাচাইকৃত adapter বা `.aiignore` তৈরি করা হয়নি। `.aiignore` কোন tool সম্মান করে এমন দাবি নেই। Authoritative docs/SQL/evidence access থেকে আড়াল করবেন না।

Owner task এই restructuring, সীমিত existing-behavior corrections, commit/push/PR অনুমোদন করেছে। পুরোনো Phase 0, v1.1 precedence, approval pause এবং develop-target নির্দেশনা superseded; security/privacy/framework guidance retained। কোনো merge/deploy নয়।

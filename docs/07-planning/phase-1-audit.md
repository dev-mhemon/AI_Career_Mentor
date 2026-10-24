# Phase 1 implementation and evidence audit

Current documentation delta (M01-01, 2026-10-24): [record](current-phase/M01-01.md) re-inspects Auth/Profile/common/frontend/public configuration at fetched main `5a71a5b8196a619ae0960b212fe71e74d79e0fb6`. Five email/session documents are now Draft/review pending; four of the former nine missing standalone documents remain Planned (23/27 now present at this local delivery). No application behavior changes. DOC-01/DOC-02 records/fingerprints remain unchanged. See [current findings](../00-governance/open-issues.md#m01-01-contract-findings); the observations/evidence below retain their historical scope.

## Observation scope

DOC-01 inspected clean main at 74e2f2c8975751d9c1545917ed7fa81be50d4400, then created docs/doc-01-agent-workflow from that source. See the [current DOC-01 record](current-phase/documentation-alignment/DOC-01.md) for the final uncommitted documentation worktree and actual checks. This is a recorded observation, not a standing instruction to reset/switch to that commit.

Local history contains alignment merge 64171e8c, main promotion 83aa7c2b and Windows/Next tooling merge 74e2f2c8 (implementation 114afc91). Earlier reports using base 4dffb54835f62f806accbb883a2cf6557c30bcdf and pending promotion remain historical. No remote fetch, current CI artifact validation or live service check is implied.

## Verified source boundaries

| Area | Observed implementation | Boundary |
|---|---|---|
| Storage/Auth | Supabase Auth plus primary PostgreSQL; TypeORM DataSource/EntityManager transactions retained | app.module.ts has no entities/migrations and disables synchronize/migrationsRun; no legacy replay |
| Auth/access | JWT strategy, application user mapping, status/admin/feature/ownership guards; OAuth session bootstrap and current user | Canonical Auth A01–A09/A11–A12/account flows are not complete; sync is a compatibility adapter |
| Profile/career | Profile read/patch, preferences, learning settings, alias interpretation and goal read/confirmation | No complete career creation/clarification/edit/discontinue/catalog implementation |
| HTTP/client | /api/v1 contracts, request IDs, validation/error mapping; unversioned /health | Health reports limited status/connection state, not full C05 version/time/queue checks |
| Frontend | Existing SDK-based login/register/verify, callback, guarded dashboard and API client | Transitional UI; callback uses sync/me then dashboard, not end-to-end backend next_step routing; verification still puts contact identifiers in query parameters |
| Tooling | npm lockfiles, Vitest, Node >=24; Windows Python/npm helper; Next.js manifest 16.3.8 | Version/CI files describe configured tools, not fresh execution at this source |

Sources: [backend module](../../backend/src/app.module.ts), [Auth module](../../backend/src/auth/auth.module.ts), [controllers](../../backend/src/auth/controllers/auth.controller.ts), [Profile source](../../backend/src/profile), [transaction manager](../../backend/src/auth/services/database.service.ts), [frontend callback](../../frontend/src/app/auth/callback/route.ts), [Auth actions](../../frontend/src/lib/auth/actions.ts), [process helper](../../scripts/foundation/process.mjs), [package manifest](../../frontend/package.json).

### Preserved alignment corrections

| Finding | Authority | Implemented source behavior | Existing regression scope, not rerun by DOC-01 |
|---|---|---|---|
| F1 completeness | C01 §7/14; C05 §14.3/15.3, R07 | Shared helper; education optional; explicit None valid; confirmed active goal required; basic access not completeness-gated | Required fields, None/no education, confirmed goal, Auth/Profile parity |
| F2 goal confirmation | C05 §3/13.2/EP-C01/EP-C05; C09 Screen11 | roadmap_generator guard and transaction recheck; ownership/status enforced; existing reads unaffected | Revocation, overrides, foreign/admin ownership and denied mutations |
| F3 activity | C01 §39; C05 R24 | Server-time coalesced monotonic activity in successful explicit write transaction; bootstrap retained | Passive reads/failure/rollback and successful/coalesced updates |
| F4 errors | C05 §4/15.1/16; C09 §6 | Field/code/message details, malformed-ID/validation handling, request IDs and client retry metadata | Nested details, safe 500, 401/422/429, malformed body and HTTP behavior |

OAuth next_step and nullable RoleOptionDTO rationale remain in backend source. Stronger progress evidence and level-specific initialization remain explicit invariants; no synthetic Junior fallback is authorized. See [context map](../00-governance/context-map.md) for source/test selection.

## Inventory and unmet implementation

The historical [82-entry catalog coverage](current-phase/alignment/endpoint-coverage.json) has nine foundation entries, one partial health entry, 71 Planned entries and one internal-only Planned entry. It is not 82 implemented HTTP routes. Transitional POST /auth/sync is outside that catalog. The [25-screen coverage](current-phase/alignment/screen-coverage.json) records five partial transitional screens and 20 Planned screens; source inspection remains consistent with that boundary. These maps are derived records, not acceptance.

Remaining implementation includes full canonical Auth/local SMS/social/linking/contact/recovery; shared Redis limits/lockout/idempotency and refresh integration; deletion receipt/outbox/worker/failure handling; broader career, roadmap, daily-plan, quiz/practice/progress/mentor/technology/feedback/jobs/admin workflows; AI gateway/prompts/providers/privacy/evaluation, leases/fencing/scheduler; full Bangla UI/accessibility/PWA and R17/R18 flows. SMS naming consistency does not certify a configured Bangladesh provider.

At DOC-01 the original 27-document inventory was 18 present / nine absent standalone files; embedded equivalents and priorities remain in DOC-01. M01-01's current delta is above; historical inventory evidence is not rewritten.

## Historical executed evidence, not current-HEAD PASS

The [alignment validation record](current-phase/alignment/validation.json) was recorded on 2026-10-21 with base 4dffb54835f62f806accbb883a2cf6557c30bcdf and delivery implementation checkpoint 1fdc6c98c87fe959ba976e767199892999dd598f. Individual checks have different identities:

| Recorded check scope | Recorded checked-out/tested SHA | Metadata pointer |
|---|---|---|
| Baseline/backend checks and database lifecycle | 3857af82390fb3eb953929fda67cf6e54009e9d4 | [Database lifecycle](current-phase/alignment/evidence/checks/database-lifecycle.json); validation.checks |
| Later backend HTTP cases and workflow validation | d2c63c15b2b187e50acff3952924ddcd5263f7b6 | validation.checks labels backend-http/workflow-validation |
| Later frontend lint/unit/build | fac739aef5c52a64c7c35d945250ae5c19b083b5 | validation.checks labels frontend-lint/frontend-unit/frontend-build |
| Frontend content HTTP smoke | 1fdc6c98c87fe959ba976e767199892999dd598f | validation.checks label frontend-http |

Recorded lifecycle results describe 21 fresh migrations, 185 original pgTAP assertions per run, reverse/reapply, a separate 27-assertion boundary suite and concurrency cases. The 19 in-migration catalog assertions are separate from the original 185 pgTAP total. These are finite historical results, not all R32 gates. Metadata lacking a tested identity must not be assigned one by inference. The initial upstream-image pull failure remains recorded; later local adaptation/provenance is not clean upstream-runner equivalence.

The Windows runbook's setup PASS narrative supplies no exact tested SHA/artifact; preserve it as an unattributed historical setup claim, not proof at merge 74e2f2c8 or today's worktree. Foundation running-service snapshots and historical GitHub failures also are not current health/access evidence.

DOC-01 freshly executes only documentation/protected-source checks, recorded in its task record. It does not rerun application/DB behavior, install tools, inspect private runtime data or establish current remote CI.

## Remaining acceptance gates

R32 remains **in_progress / partially_executed**; R33 **optional/deferred**. Full Auth/provider approval, deletion/RLS fault matrices, purge timing/recovery, performance/connection budget, PITR/restore, production destination/secrets/security and owner release acceptance remain open. No local PASS count or source adoption closes them.

Follow [source authority](../00-governance/source-of-truth.md), [open issues](../00-governance/open-issues.md), the [shared workflow](../00-governance/agent-workflow.md) and [runbook](../09-operations/runbook.md). The [master plan](master-execution-plan.md) is the active proposed MVP plan with M01-01 documentation progress; implementation and acceptance require their own authorized gates.

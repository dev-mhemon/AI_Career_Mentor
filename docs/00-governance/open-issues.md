# Open issues and decisions

Use [START-HERE](START-HERE.md) for the current maintenance task. Latest merged implementation is [M01-02](../07-planning/current-phase/M01-02.md#post-merge-status-and-evidence-2026-10-25): bounded shared Auth abuse-control helper/tests, merged through PR #7 with separate successful PR/main application and database CI. Scoped owner acceptance does not cover endpoint/provider/session integration, all derived Draft designs or production readiness. M01-01, DOC-01 and DOC-02 remain historical records. The [master plan](../07-planning/master-execution-plan.md) proposes remaining work; M01-03 is the next candidate and requires separate authorization. Requirements remain governed by the [source register](source-of-truth.md); the [phase audit](../07-planning/phase-1-audit.md) preserves its dated observation scope.

## M01-01 contract findings

Inspected source `5a71a5b8196a619ae0960b212fe71e74d79e0fb6`; proposals are review inputs, not accepted exceptions. Details/evidence: [architecture](../02-architecture/backend-architecture.md), [mapping](../05-api/DTO-DB-mapping.md), [QA](../08-testing/QA-plan.md).

| ID / conflict and evidence | Impact | Smallest proposed resolution / decision boundary |
|---|---|---|
| ES-01 — C05 A01 requires unverified users/provider rows at signup. Current JWT/live-user bootstrap has no A01, copies only confirmed contacts and creates all four rows together. C06 allows null contacts/false verification/null verified_at, requires real auth.users UUID | Timing not implemented; trusted pre-session reconciliation cannot rely on public signup duplicate responses | Pending users with confirmed contacts null + unverified provider contact, profiles at A02, existing locks/uniqueness. Establish supported server-only trusted identity lookup in future adapter/config scope; otherwise owner exception required for A01 timing. No schema edit |
| ES-02 — C01 §9/C05 A01/R31 versus tracked config: confirmations false, OTP3600s, resend1s, password minimum6; no signup code template/approved SMTP proof/Redis consumer | Current configuration cannot demonstrate no unverified session or 600s/code/limits. Public direct provider endpoints may bypass backend-only counters | Future authorized configuration aligns supported controls/code template; demonstrate provider-side or supported ingress/hook enforcement for direct calls. No new provider or settings chosen here; synthetic R31 enabler independent, live acceptance blocked |
| ES-03 — SDK can refresh during reads/setSession; current proxy bypasses canonical A07, signOut is global; SSR default httpOnly false and cache-header argument dropped | Token/cookie rotation, local logout and no shared auth cache unproven; local comments overstate privacy | Proposed canonical bridge + request-scoped SSR cookie persistence, single refresh owner, local scope and cache-header propagation; pinned-version tests before dependent acceptance |
| ES-04 — C05 A06 invalidates current session; provider revokes refresh but existing JWT remains cryptographically valid; current strategy checks no provider session revocation | Cannot claim immediate normal-route denial from logout alone | Verify supported signed-session validation against pinned provider; preserve authenticated repeat logout. If unsupported, owner review of explicit JWT lifetime window or separately authorized session-control design; no schema/denylist invented |
| ES-05 — C05 §15.1 optional retryAfterSeconds integer versus current common/http null when absent | Existing A10/A13 formatter differs from canonical ErrorDTO | Canonical OpenAPI follows C05; observed sync variant/gaps explicit. Future bounded formatter alignment or reviewed exception; no frozen-source change |
| ES-06 — C05 A02 AZ-PUB with optional JWT versus C09 Screen04 secondary-contact AZ-USER | Added-contact status policy needs reconciliation in M02, outside signup implementation | Preserve C05 optional bearer in contract; apply adopted user/status constraints when secondary-contact mode is designed, record any required owner clarification. No email-only narrowing of shared DTO |

M01-02 policy/error inputs have been implemented and reviewed within the merged helper/test scope. ES-01/02/04 still block dependent provider/session acceptance; the shared helper does not resolve provider bypass, delivery configuration, pending-row recovery or session revocation. Historical M01-01 proposals above remain review inputs rather than accepted policy exceptions.

## Verified resolutions and historical claims

- Local Git history includes alignment merge 64171e8c, main promotion 83aa7c2b and Windows/Next tooling merge 74e2f2c8. The former pending promotion/PR#2-open statements describe historical delivery, not the current checkout. No live remote/CI claim is inferred from that history.
- Approved toolchain exception: actual npm lockfiles/Vitest are retained instead of SAD §3/ADR-004 and AI SD pnpm/Jest examples. See historical foundation decisions and the version-note addendum; DOC-01 changes no dependency.
- Frozen sources saying DMS never executed or runtime NOT EXECUTED describe the supplied correction package. Later historical execution records establish only their named scopes/SHAs. Preserve both provenance and frozen bytes; do not close R32 from a test total or an old PASS.
- C05 §14.3 example contradicts its populated learning_preference. Follow normative completeness: education optional, explicit None valid, confirmed active goal required; basic access stays available (C01 §7/14). Preserve the documented inconsistency rather than editing the frozen example.
- EP-C05 inherits roadmap_generator from EP-C01/C09 Screen11: guard plus transaction recheck; existing profile/goal reads have no generation gate. F1–F4, OAuth next_step and nullable RoleOptionDTO rationale remain scoped source behavior, not complete feature acceptance.
- Alignment FINAL_REPORT_BN.md reports keep314/update23; file-inventory.json and INVENTORY_BN.md give keep313/update24. The 471-file JSON inventory is the detailed historical record. This summary discrepancy is recorded here; historical evidence is not rewritten.
- Earlier GitHub Forbidden/network-draft statements are historical, not a demonstrated current blocker. DOC-01 does not recheck remote CI, authentication, permissions or network-setting enforcement.

## Open implementation and validation gates

| Finding | State / impact | Decision or evidence needed |
|---|---|---|
| Full Auth/account/local SMS/social/linking/recovery | Deferred implementation; frontend SDK/sync path is transitional | Provider selection/configuration, canonical contracts, privacy/rate-limit/integration evidence |
| R18 contact identifier in verification query; OAuth callback goes directly to dashboard | Actual frontend gaps; backend next_step is not end-to-end routing evidence | Implement existing C05/C09 contracts in an authorized slice; no new policy invented |
| Redis shared Auth abuse controls | Bounded M01-02 helper/tests merged; existing endpoints do not invoke it | M01-03+ endpoint/provider integration, trusted IP normalization, direct-provider bypass controls and external-effect/session recovery evidence |
| Generic Redis idempotency/loss recovery; deletion receipt/outbox/worker; AI/worker/scheduler; broader UI/PWA | Specified, not delivered by M01-02 | Separately authorized implementation, fault/security tests and relevant dependencies; R14 is not implemented by R31 helper completion |
| R32 | in_progress / partially_executed; owner/release acceptance pending | Remaining Auth/provider, deletion/RLS fault, purge/recovery, load/connection-budget, PITR/security/production and acceptance gates |
| R33 | optional/deferred | Owner may revisit; not a DOC-01 blocker |
| Numerical SLA/quality and schema-family/assertion prose | Targets or scoped historical claims | Named methods and version-bound measurements; C06 exact SQL/hash gates govern physical objects |
| Agent discovery/ignore behavior | Codex PATH lookup succeeds; Antigravity lookup does not; actual Antigravity loading is unverified | Operator must explicitly load shared guidance when discovery is unknown; no installation-absence or universal .aiignore claim |
| Former nine missing standalone documents | M01-01 authors five email/session Drafts; four remain Planned | Source register/master plan track extension timing; no placeholders or full-project completion claim |

## Owner decisions that remain genuinely open

1. Authorize the next bounded implementation slice and its observable acceptance boundary. M01-01/M01-02 are merged; M01-03 is the next candidate. Their prior authorization does not authorize that next slice or complete the M01 milestone.
2. Approve concrete SMS/AI providers/models and applicable real-user-data handling before dependent integrations; a provider being available is not approval.
3. Decide production destination/access ownership and approve operational/security/backup/restore arrangements before release.
4. Record explicit acceptance of applicable R32 gates and eventual release. Agent checks do not supply owner sign-off.

These are dependencies for affected future work, not blockers for the authorized documentation maintenance selected through START-HERE. New conflicts must identify source sections, actual behavior, impact and the missing decision using the shared workflow.

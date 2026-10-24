# Open issues and decisions

Current DOC-02 source/worktree and planning observations are in [DOC-02](../07-planning/current-phase/documentation-alignment/DOC-02.md); [DOC-01](../07-planning/current-phase/documentation-alignment/DOC-01.md) retains its historical inspection/checks. The [active master plan](../07-planning/master-execution-plan.md) is Draft/proposed; M01 email/session is conditional, not implementation authorization. Requirements come from the [source register](source-of-truth.md); current boundaries are in the [phase audit](../07-planning/phase-1-audit.md). A deferred implementation is not automatically a blocker for documentation work.

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
| Redis shared limits/idempotency; deletion receipt/outbox/worker; AI/worker/scheduler; broader UI/PWA | Specified, not delivered | Bounded implementation, fault/security tests and relevant dependencies |
| R32 | in_progress / partially_executed; owner/release acceptance pending | Remaining Auth/provider, deletion/RLS fault, purge/recovery, load/connection-budget, PITR/security/production and acceptance gates |
| R33 | optional/deferred | Owner may revisit; not a DOC-01 blocker |
| Numerical SLA/quality and schema-family/assertion prose | Targets or scoped historical claims | Named methods and version-bound measurements; C06 exact SQL/hash gates govern physical objects |
| Agent discovery/ignore behavior | Codex PATH lookup succeeds; Antigravity lookup does not; actual Antigravity loading is unverified | Operator must explicitly load shared guidance when discovery is unknown; no installation-absence or universal .aiignore claim |
| Nine missing standalone documents | Planned with embedded equivalents | Timing and smallest deliverables in DOC-01; do not make placeholders |

## Owner decisions that remain genuinely open

1. Select/prioritize the next implementation slice and its observable acceptance boundary. DOC-02 proposes M01 canonical email/session tasks and alternatives; owner selection and separate implementation authorization remain pending.
2. Approve concrete SMS/AI providers/models and applicable real-user-data handling before dependent integrations; a provider being available is not approval.
3. Decide production destination/access ownership and approve operational/security/backup/restore arrangements before release.
4. Record explicit acceptance of applicable R32 gates and eventual release. Agent checks do not supply owner sign-off.

These are dependencies for affected future work, not reasons to block independent DOC-01 guidance and verification. New conflicts must identify source sections, actual behavior, impact and the missing decision using the shared workflow.

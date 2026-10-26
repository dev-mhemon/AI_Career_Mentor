# AI Career Mentor

Bangla-first technology-career mentoring application. Current implementation includes the Phase 1 Supabase foundation and gated Auth slices; the complete MVP is specified, not delivered. Start at [START-HERE](docs/00-governance/START-HERE.md) for the current task and handoff, then use the [source register](docs/00-governance/source-of-truth.md), [context map](docs/00-governance/context-map.md), [shared workflow](docs/00-governance/agent-workflow.md) and [dated phase audit](docs/07-planning/phase-1-audit.md).

Node >=24, npm >=10, Python3, Docker Engine and Supabase CLI **2.121.0** are required. Keep the two npm lockfiles. Supabase supplies Auth and the primary PostgreSQL database; ORM schema sync/startup migrations remain disabled. Historical TypeORM migrations and standalone PostgreSQL Compose are retired; no legacy data transfer is needed (D001).

```bash
bash scripts/foundation/install.sh
python3 scripts/alignment/verify.py
node scripts/foundation/local.mjs start
npm --prefix backend run build
node scripts/foundation/local.mjs backend
# Another terminal, same checkout:
node scripts/foundation/local.mjs frontend-build
node scripts/foundation/local.mjs frontend
```

Ports: Supabase API 56321, PostgreSQL 56322, backend 3200, frontend 3201. Configuration is generated under ignored/private `.local/foundation/`; app templates list required names without secret values. See the [runbook](docs/09-operations/runbook.md) for prerequisites, validation, restart and troubleshooting. Do not copy another task's private configuration or assume old services still run.

```bash
bash scripts/foundation/check-apps.sh
python3 scripts/foundation/verify-baseline.py
# Fresh lifecycle validation is destructive only to the identified disposable project:
node scripts/foundation/database-check.mjs --disposable
node scripts/foundation/local.mjs stop
```

Shared agent rules: [AGENTS.md](AGENTS.md) and the [single execution/handoff workflow](docs/00-governance/agent-workflow.md). Use [START-HERE](docs/00-governance/START-HERE.md) for the current maintenance task and handoff. Latest merged implementation: [M01-03 email registration/resend slice](docs/07-planning/current-phase/M01-03.md#post-merge-status-and-evidence-2026-10-26), PR #9. Its A01/A04 routes and synthetic tests are delivered, but the production provider remains 503-gated; live delivery, A02 and full session integration remain unverified or absent. [M01-04](docs/07-planning/master-execution-plan.md#m01-04---email-verification-establishes-mapped-session) is a proposed next task requiring separate authorization. DOC-01/DOC-02 and alignment records retain historical evidence. R32 remains in progress/partially executed; R33 is optional/deferred. Merge and CI success do not establish production readiness or approve all derived Draft designs.

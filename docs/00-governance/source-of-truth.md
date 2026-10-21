# Active source register

Status vocabulary: Planned = absent future deliverable; Draft = authored, review pending; Approved/Adopted = adopted for implementation by this owner task; Historical = retained evidence, no current authority. Adoption never means runtime/release acceptance.

| ID/version | Path | Status | Authority | Provenance |
|---|---|---|---|---|
| C01 1.4.1 | [PRD.md](../../docs/01-product/PRD.md) | Approved/Adopted | Product scope/invariants | Exact upload; source-manifest.json; baseline-equal |
| C02 1.1.1 | [SAD.md](../../docs/02-architecture/SAD.md) | Approved/Adopted | Architecture and embedded ADRs 001–020 | Exact upload; source-manifest.json; baseline-equal |
| C03 1.2.2 | [DDD.md](../../docs/03-domain/DDD.md) | Approved/Adopted | Domain meaning; C06 owns exact DDL | Exact upload; source-manifest.json; baseline-equal |
| C04 1.1.1 | [DIS.md](../../docs/04-database/DIS.md) | Approved/Adopted | Database implementation procedures | Exact upload; source-manifest.json; baseline-equal |
| C05 1.5.1 | [API-Specification.md](../../docs/05-api/API-Specification.md) | Approved/Adopted | HTTP/DTO/error contracts | Exact upload; source-manifest.json; baseline-equal |
| C06 1.2.2 | [DMS.md](../../docs/04-database/DMS.md) | Approved/Adopted | Exact physical SQL and adopted history | Exact upload; source-manifest.json; baseline-equal |
| C07 1.1 | [validation-report.md](../../docs/04-database/validation-report.md) | Approved/Adopted | Validation expectations and scoped historical claims | Exact upload; source-manifest.json; baseline-equal |
| C08 1.1.1 | [AI-System-Design.md](../../docs/02-architecture/AI-System-Design.md) | Approved/Adopted | AI behavior and orchestration | Exact upload; source-manifest.json; baseline-equal |
| C09 2.0.2 | [UIUX-Specification.md](../../docs/01-product/UIUX-Specification.md) | Approved/Adopted | Screens/interactions and frontend states | Exact upload; source-manifest.json; baseline-equal |

Use subject-specific authority, rather than treating diagrams as permission to expand scope. C01 invariants override downstream behavior. C06 controls physical objects when DDD/DIS shorthand differs. C05 owns endpoint keys and DTOs. Accepted correction appendices refine older examples; contradictory residual prose is tracked in open-issues.md.

| Supporting source | Status / scope |
|---|---|
| `docs/00-governance/*` | Adopted task governance, not duplicate product requirements |
| `docs/06-decisions/ADR/0001-technology-version-selection.md` | Historical toolchain decision; retained compatibility rationale, old verification claims belong to their run |
| `docs/07-planning/current-phase/foundation/` | Historical implementation/evidence/status; bytes retained, former paths aliased |
| `planning/reviewed-baseline/` | Historical immutable package, 179 original manifest entries |
| `supabase/migrations`, `supabase/rollbacks`, `supabase/tests/database` | Adopted executable history; same historical SQL hashes |
| `docs/07-planning/current-phase/alignment/` | Draft execution/delivery evidence; acceptance pending |
| `docs/99-archive/` | Historical only; no active authority |

Future deliverables are registered below, intentionally absent. No blank files or fictional contracts are created.

| Planned path | Status | Intended scope / prerequisites / milestone |
|---|---|---|
| `docs/02-architecture/frontend-architecture.md` | Planned | Actual component/cache/PWA architecture; implemented screens and ADR review; frontend milestone |
| `docs/02-architecture/backend-architecture.md` | Planned | Actual module/worker boundaries; service implementation/review; backend milestone |
| `docs/03-domain/business-rules.md` | Planned | Indexed links to C01/C03 rules, no duplicates; domain implementation traceability milestone |
| `docs/04-database/DB-schema-map.md` | Planned | Installed-catalog mapping; reviewed forward versions; next schema milestone |
| `docs/05-api/openapi.yaml` | Planned | Exact implemented DTO/operations, no invented routes; HTTP contract milestone |
| `docs/05-api/DTO-DB-mapping.md` | Planned | Links to C05/C06 plus executable mappings; broader API milestone |
| `docs/08-testing/QA-plan.md` | Planned | Full MVP acceptance matrix; named implementations/owner gates; QA milestone |
| `docs/08-testing/AI-evaluation.md` | Planned | Synthetic 8-role/3-language benchmark and approved models; AI milestone |
| `docs/09-operations/deployment.md` | Planned | Destination, credentials, backup/security/rollback approval; release milestone |
| `supabase/seed/` | Planned only if needed | Separate future fixture purpose/execution review; adopted 018/020 seeds stay in place |

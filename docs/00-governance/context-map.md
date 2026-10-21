# Context map and historical aliases

| Task area | Read | Existing implementation |
|---|---|---|
| Profile/None/completeness | C01 §7/14, C05 §14.3/15.3, R07 | backend/src/profile; shared completeness helper |
| Goal confirmation/access | C05 §3/13.2/14.4 EP-C05 | profile controller/service; auth guards/policy; transaction manager |
| Activity | C01 §39, C05 accepted R24 | existing bootstrap and successful explicit mutations only |
| Errors/client | C05 §4/15.1/16, C09 §6 | common/http.ts; frontend/src/lib/api/client.ts |
| SQL/lifecycle | C06, C04, D001 | executable supabase layout; scripts/foundation |
| UI/provider backlog | C09 screens, C08 | register/audit; do not create future features |

Filename aliases: `C01_PRD.md` → `docs/01-product/PRD.md`; `C02_SAD.md` → `docs/02-architecture/SAD.md`; `C03_DDD.md` → `docs/03-domain/DDD.md`; `C04_DIS.md` → `docs/04-database/DIS.md`; `C05_API.md` → `docs/05-api/API-Specification.md`; `C06_DMS.md` → `docs/04-database/DMS.md`; `C07_Validation.md` → `docs/04-database/validation-report.md`; `C08_AI_System_Design.md` → `docs/02-architecture/AI-System-Design.md`; `C09_UI_UX.md` → `docs/01-product/UIUX-Specification.md`. Long `AI_Career_Intelligence_Mentor_*_v*.md` and numbered 01..09 names inside sources refer to the same logical IDs; exact provenance is in source-manifest.json.

Historical `docs/foundation/*` → `docs/07-planning/current-phase/foundation/*`. Historical `scripts/db/*`, `scripts/extract-db.mjs`, `generated-db/*`, `inputs/legacy_phase1/OWNER_CONFIRMATION.json` refer to fixing-toolkit context, not executable entry points in this repository. Use scripts/foundation and the preserved package; no toolkit contents invented. Historical `docs/product/*`, `docs/architecture/*`, old Phase 1 plans are superseded by active copies and current execution plan. `database/docker-compose.yml` (never present here) and root docker-compose.yml are retired scaffold references, not Supabase commands.

Local link validation covers maintained governance/README/runbook/ADR navigation. Immutable specifications and historical raw evidence retain inherited references; missing toolkit paths and future Planned paths are classified exceptions, not links silently repaired in supplied bytes. External links are not a deterministic validation dependency.

# Shared project guidance — Codex and Antigravity

Start at [START-HERE](docs/00-governance/START-HERE.md), then read the source register and task context. Explicit owner instructions define the authorized task; record conflicts with older guidance. Current scope: Phase 1 restart foundation and repository alignment; broader MVP implementation remains planned.

- Use existing isolated checkouts. Do not create a worktree unless requested or needed to preserve unrelated work. Concurrent agents use separate branches/worktrees and provide the handoff below.
- Read relevant adopted sections before changes. C01 owns product scope, C02 architecture, C03 domain meaning, C05 HTTP/DTOs, C06 exact SQL, C04 procedures, C08 AI, C09 UX. See the register for conflicts and history.
- Preserve every byte in `planning/reviewed-baseline/`, adopted `supabase/migrations/`, `supabase/rollbacks/` and original eight `supabase/tests/database/` suites. Never weaken their verifier. Applied SQL changes require a separately reviewed forward migration.
- Supabase supplies Auth AND primary PostgreSQL storage (D001). No legacy TypeORM migration replay. Retain the transactional TypeORM connection manager; `synchronize=false`, `migrationsRun=false`.
- Node >=24, npm locked installs, existing Vitest. Run `bash scripts/foundation/install.sh`; use [runbook](docs/09-operations/runbook.md) for services/E2E. Run both app lint/tests/builds, baseline and alignment verifiers, affected HTTP/regressions and workflow checks. Report failures/skips/unrun checks separately.
- Preserve OAuth `next_step`, RoleOptionDTO nullable rationale, beginner None, stronger evidence, tenant isolation, suspension exceptions and existing-data reads under generation-off.
- Never log/commit credentials, private signing keys, JWTs, raw private practice/chat content or process environments. Only configured approved providers may receive real user data. `.gitignore`/permissions protect local configuration; an AI ignore file is not a security boundary.
- Use `chore/repository-alignment` → PR into `phase1-restart`; eventual reviewed `phase1-restart` → `main`. Focused Conventional Commits. No force push, merge, deployment, shared DB reset or volume deletion. Use destructive harness only with positively identified disposable project safeguards.
- Keep strict TypeScript, meaningful tests and clear names. Avoid speculative modules, future routes or placeholders. Preserve framework-specific scoped frontend instructions. Codex skills/settings are not automatically available in Antigravity.

Handoff: task, branch/base/head SHA; source sections; changed files; decisions; commands/exit codes/tested SHA/artifacts; blockers; next action. Use the current-phase report, not a historical running-service snapshot. Distinguish Specified, Implemented, Executed, Accepted; owner sign-off is separate.

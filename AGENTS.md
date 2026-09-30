# AGENTS.md — AI Career Intelligence Mentor MVP

This file is the always-on rulebook for every AI agent working in this repository.
Read it fully at the start of every session. If anything here conflicts with a
chat instruction, stop and ask before proceeding.

## 1. Project

**AI Career Intelligence Mentor MVP** — a web application built as a monorepo:

| Area       | Path         | Stack                                  |
| ---------- | ------------ | -------------------------------------- |
| Frontend   | `frontend/`  | Next.js, TypeScript, ESLint, Prettier  |
| Backend    | `backend/`   | NestJS, TypeScript, ESLint, Prettier   |
| Database   | `database/`  | PostgreSQL (Docker for development)    |
| Docs       | `docs/`      | Markdown, source of truth for the build |

## 2. Source of truth and priority

The specification documents live in `docs/`. When they disagree, the higher item wins.

1. **PRD v1.1** — `docs/product/PRD-v1.1.md` (what to build and why)
2. **SAD v1.1** — `docs/architecture/SAD-v1.1.md` (how it is structured)
3. **UI/UX Specification v1.1** — `docs/product/UIUX-Specification-v1.1.md` (how it looks and behaves)
4. **Development Implementation Plan v1.1** — `docs/planning/Development-Implementation-Plan-v1.1.md` (phase order and tasks)

Rules for using them:

- Read the relevant document(s) before starting any task. Do not work from memory or assumption.
- If two documents conflict, follow the higher-priority one and **report the conflict** in your summary. Never resolve it silently.
- If a document is silent or ambiguous on something you need, **ask**. Do not invent requirements.
- Cite the document and section you relied on when you make a non-obvious decision.

## 3. Current phase

**Active phase: Phase 0 — Project Foundation** *(update this line at the start of each phase)*

- Work only on tasks belonging to the active phase in the Implementation Plan.
- Do not begin, stub, or "prepare" work for later phases.
- A phase is complete only when its exit criteria in the Implementation Plan are met and verified (see section 7).

## 4. Scope discipline (no scope expansion)

- Implement exactly what the current task asks. Nothing more.
- Do not add features, screens, endpoints, libraries, or abstractions that were not requested.
- Do not refactor unrelated code while doing a task.
- If you notice something worth improving, note it in your summary under "Suggestions" instead of doing it.
- Placeholders are allowed only where the task explicitly asks for them, and must be clearly marked `TODO(phase-N)`.

## 5. Architectural changes require approval

**Ask before** any of the following, and wait for an explicit yes:

- Adding, removing, or replacing a framework, major dependency, or database
- Changing folder structure, module boundaries, or API style
- Changing data models or infrastructure in a way the SAD does not describe
- Changing the Git workflow or CI tooling

When asking, state: what you propose, why, the alternatives, and which document it deviates from.
Once approved, record it as `docs/decisions/NNNN-short-title.md` (a short ADR).

## 6. Working method

1. **Plan first.** For any task larger than a trivial edit, produce an implementation plan
   (task list + files to be touched + verification steps) and **stop for approval** before changing files.
2. **Small, verifiable steps.** Prefer many small commits over one large one.
3. **Verify before claiming done.** Run the checks in section 7 and report real output, not assumptions.
4. **Report clearly.** End every task with: what changed, what was verified, what was *not* done,
   any document conflicts, and any suggestions.

## 7. Testing and validation

Every change must include or preserve validation. Before saying a task is done, run and pass:

- `lint` — no errors
- `test` — all tests pass (add tests for any new logic, even in early phases)
- `build` — both `frontend` and `backend` build successfully
- Clean-clone check: setup instructions in `README.md` work from a fresh checkout

If a check cannot be run, say so explicitly and explain why. Never mark it as passed.

Testing notes and strategy live in `docs/testing/`.

## 8. Security and secrets

- **Never commit secrets**: no API keys, passwords, tokens, or real connection strings.
- All configuration goes through environment variables. Keep `.env.example` current with
  every variable the app reads, using placeholder values only.
- `.env` and `.env.*` (except `.env.example`) must stay in `.gitignore`.
- Do not paste secrets into logs, docs, tests, or commit messages.

## 9. Git workflow

- Branches: `main` (stable) ← `develop` (integration) ← `feature/<short-description>`.
- Never commit directly to `main` or `develop`. Work on a feature branch and open a PR into `develop`.
- Commit messages use Conventional Commits, e.g. `chore: scaffold backend with NestJS`,
  `ci: add lint, test, build workflow`, `docs: add ADR for package manager`.
- Keep PRs focused on one concern. Do not push or merge unless asked.
- Do not gitignore the `.agents/` folder.

## 10. Code standards

- TypeScript strict mode in both `frontend/` and `backend/`.
- ESLint and Prettier configs must pass with zero errors; do not disable rules to silence them
  without asking.
- Prefer clear names and small modules over cleverness.
- Comment the "why", not the "what".
- Keep environment access in a single config layer per app; do not read `process.env` throughout the code.

## 11. Repository layout

```
frontend/            Next.js app
backend/             NestJS app
database/            Postgres Docker config, init/migration placeholders
docs/
  product/           PRD, UI/UX specification
  architecture/      SAD, diagrams
  planning/          Development Implementation Plan
  api/               API documentation
  prompts/           Prompt files for AI agents
  decisions/         Architecture decision records (ADRs)
  testing/           Test strategy and notes
.github/workflows/   CI pipeline
AGENTS.md            This file
README.md            Setup and development guide
.env.example         Environment variable template
```

## 12. Phase 0 boundaries

Phase 0 delivers the **foundation only**.

**In scope:** repo structure, frontend and backend scaffolds with lint/format/env config,
PostgreSQL via Docker with a connection placeholder, `.env.example`, Git workflow documentation,
CI pipeline (install, lint, test, build), `AGENTS.md`, `README.md`.

**Out of scope (do not build):** authentication, AI features, UI screens beyond the default scaffold,
business logic, real database schemas or migrations, third-party API integrations.

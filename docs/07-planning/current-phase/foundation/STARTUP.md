# Reproduce the foundation locally

Run from the repository root. Require Node >=24, npm, Python 3, a working Docker daemon and Supabase CLI **2.121.0** on PATH (or set `SUPABASE_BIN` to its executable). Use a session-capable PostgreSQL connection for the backend, not an HTTP SDK or transaction-pooler connection.

```bash
bash scripts/foundation/install.sh
node scripts/foundation/local.mjs start
npm --prefix backend run build
node scripts/foundation/local.mjs backend
# In another terminal:
node scripts/foundation/local.mjs frontend-build
node scripts/foundation/local.mjs frontend
```

`start` creates the dedicated ignored `.local/foundation/` project, copies the verified migration chain, generates private ES256 signing keys, starts only required Supabase services and waits for Auth/JWKS/REST readiness. Supabase itself enforces database/container health. Ports: API 56321, PostgreSQL 56322, mail 56324, backend 3200, frontend 3201. It refuses another project ID or changed existing migration bytes. Re-running start preserves this project's database/history; it does not reset it.

The helper writes actual CLI status and application runtime JSON with directory mode 0700/files 0600. Every app startup/build reads those files and supplies the configuration, overriding stale ignored app `.env` values, including the JWKS URL. It never prints credentials. Do not copy status/private logs into Git or evidence artifacts. Frontend receives only the public project URL and anon key. Backend-only service credentials are used solely by disposable Auth fixture tests.

Backend required names: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`; `PORT` defaults to 3200; optional `SUPABASE_JWKS_URL` defaults to `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`. Accepted public key formats: legacy JWT with `role=anon`, or `sb_publishable_…`. Bearer **user access tokens** must be ES256 JWTs with `kid`, valid signature/expiry, matching issuer, audience `authenticated` and a UUID subject. The anon API key is not a user access token. Service-role/`sb_secret_` API keys must never be configured as public keys.

Frontend exact names (inspected in existing SDK/client code): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`. The first two feed Supabase; API base must include `/api/v1`; site URL supplies auth redirects. Legacy anon JWT and `sb_publishable_…` formats are supported by the installed Supabase SDK. Build and startup must use the same frontend configuration because `NEXT_PUBLIC_*` values are bundled at build time.

```bash
# DESTRUCTIVE ONLY TO THE DEDICATED DISPOSABLE FOUNDATION PROJECT:
node scripts/foundation/database-check.mjs --disposable
npm --prefix backend run lint
npm --prefix backend test
npm --prefix backend run build
node scripts/foundation/local.mjs backend-e2e
node scripts/foundation/application-check.mjs
npm --prefix frontend run lint
npm --prefix frontend test
node scripts/foundation/local.mjs frontend-build
node scripts/foundation/frontend-check.mjs
python3 scripts/foundation/verify-baseline.py
# Stop only this stack; preserve its data by default:
node scripts/foundation/local.mjs stop
```

The database harness checks local project ID and host/port before fresh reset, retains first-forward/native TAP/raw TAP, reverse, reapply/history and post-reapply TAP separately, then runs extra boundary and separate-connection concurrency tests. It fails on missing plans, wrong assertion counts, TAP failures, skipped assertions or TODO assertions. It clears only approved migration metadata after all downs succeeded and public application tables are empty. Do not point it at a hosted or shared database. Artifacts include timestamps, commands, exit codes, tool version, source/worktree hashes and full raw TAP.

## This cloud environment

Here the isolated project lives outside the checkout at `/workspace/.mentor-foundation/`. Saved configuration is in `scripts/foundation/cloud.sh`, so temporary shell exports are unnecessary:

```bash
bash scripts/foundation/cloud.sh start
bash scripts/foundation/cloud.sh database-check
npm --prefix backend run build
bash scripts/foundation/cloud.sh backend-e2e
bash scripts/foundation/cloud.sh application-check
bash scripts/foundation/cloud.sh backend
# Separate terminal:
bash scripts/foundation/cloud.sh frontend-build
bash scripts/foundation/cloud.sh frontend-check
bash scripts/foundation/cloud.sh frontend
```

The cloud's Docker VFS/proxy constraints were handled during onboarding by environment-owned `/workspace/.mentor-tools/prepare-postgres-vfs.py` and `prepare-auth-healthcheck.sh`. The first caches a verified flattened official PostgreSQL image to avoid VFS layer expansion. The second preserves the GoTrue binary and uses a direct loopback wget health check because the environment injects an HTTP proxy. These preloaded images have passed normal Supabase health gates; no health-check bypass is used. Their provenance remains in the environment-owned onboarding directory. Standard overlay Docker/Actions runners use the upstream CLI images directly. If this cloud image cache is lost, re-run the onboarding image preparation helpers before `cloud.sh start`.

The old PostgreSQL 15 container and the earlier onboarding Supabase stack are separate and untouched. Root `database/docker-compose.yml` is historical scaffolding, not the Phase 1 application database.

## Remaining gates

Local SQL, Auth and HTTP checks can run here. Remote GitHub Actions execution/artifact verification on the committed implementation remains pending (GitHub API Forbidden). Hosted email/WhatsApp/social-provider flows, full deletion API/worker/provider outbox, full application routes/UI, scheduler retention invocation, performance/PITR/restore, production security review and owner sign-off are separate implementation/acceptance gates. R32 stays partially executed; R33 is optional/deferred. The environment can develop and test this foundation, but release/publication readiness has not been established.


## Clean GitHub runner and SHA evidence

The workflow pulls upstream `docker.io/supabase/postgres:17.11.0.004` and `docker.io/supabase/gotrue:v2.197.0` directly, then the pinned Supabase CLI starts the remaining upstream services. CI rejects images with onboarding customization labels or missing registry digests. `cloud.sh` and environment-owned image preparation helpers are never invoked in CI. A successful local run using the customized VFS cache is not proof of a successful clean GitHub run.

The PR trigger includes `phase1-restart`. Checkout depth 2 preserves the PR merge parents. `artifacts/ci/checkout.json` and `images.json` identify the implementation head SHA separately from the actual checked-out/tested merge SHA, event SHA, run URL and upstream image digests. The upload step writes its artifact URL to the job summary. The ordinary push/PR workflow and actual run conclusions are recorded separately during finalization.

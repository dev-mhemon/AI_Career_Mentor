# Development runbook

This is a local foundation runbook, not a production deployment guide. Start at the repository root. Required: Node >=24 (tested 24.19.0), npm (11.9.0), Python3, Docker daemon, Supabase CLI **2.121.0**. Official CLI installation: install the exact supabase npm dev tool in a separate tools directory or use the official release binary; put it on PATH or set SUPABASE_BIN to its executable. Use a writable npm cache. Do not replace application lockfiles.

```bash
bash scripts/foundation/install.sh
python3 scripts/alignment/verify.py
node scripts/foundation/local.mjs start
npm --prefix backend run build
node scripts/foundation/local.mjs backend
# Separate terminal, same checkout:
node scripts/foundation/local.mjs frontend-build
node scripts/foundation/local.mjs frontend
```

The start helper generates ES256 keys and runtime JSON under `.local/foundation/` (directory0700/files0600), verifies all original SQL hashes and matching project ID, and refuses differing existing migrations. Start is repeatable and does not reset the database. Auth/JWKS/REST readiness is checked; backend health and frontend HTTP checks must also execute. Optional tool variables: SUPABASE_BIN, SUPABASE_HOME (writable CLI state), MENTOR_LOCAL_DIR (dedicated project). Never copy private status/signing/log files into evidence or Git.

Validate backend `/health` database status and use `node scripts/foundation/application-check.mjs` for real Auth/HTTP/DB cases. Validate frontend with `node scripts/foundation/frontend-check.mjs`. Do not present loopback URLs as user-facing cloud previews. Commands for independent checks:

```bash
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
python3 scripts/alignment/verify.py
```

Only on the positively identified disposable local project: `node scripts/foundation/database-check.mjs --disposable`. It executes reset/fresh TAP, reverse21/reapply21/post-reapply TAP, boundary and separate-session concurrency checks. Never run on development/shared/hosted DBs. Stop only this project with `node scripts/foundation/local.mjs stop`; preserve volumes. Backend migration entry points were removed; adopted SQL and embedded018/020 seeds stay in executable Supabase layout.

Troubleshooting: missing runtime JSON means start did not finish; inspect only the matching private log locally with redaction. Wrong JWKS/issuer indicates mismatched runtime configuration, not a reason to disable JWT checks. Google font build errors require allowed fonts.googleapis.com/fonts.gstatic.com and configured proxy/CA. Docker pulls require registry/CA/network verification; constrained VFS cloud local results are separate from clean GitHub-runner results. No cloud-only helper is a CI dependency. Do not change storage drivers, disable health/TLS/checksum checks or use fake font outputs to claim PASS.

CI pins CLI/Node, uses fresh checkout-owned disposable project and upstream registry-backed images. PR merge checkout SHA, implementation head and base are recorded separately. Inspect artifact run/commit identity before reusing evidence. Historical files under current-phase/foundation are not current health checks.

Future H-IDEM service policy (C05 R14): acknowledged Redis key loss fails mutations closed until TTL-preserving recovery or24h loss boundary. Not yet implemented; no generic replay guarantee. Deployment destination, cloud secrets, purge scheduling/SLAs, provider privacy, PITR and owner release sign-off remain pending.

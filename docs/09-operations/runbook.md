# Development runbook

For agent task intake and evidence use the [shared workflow](../00-governance/agent-workflow.md) and [current DOC-01 record](../07-planning/current-phase/documentation-alignment/DOC-01.md). Prefer explicit Git Bash for Windows agent terminal commands after confirming the actual runner; the native Windows PowerShell service instructions below remain supported. Documentation-only work runs read-only verifiers/link/diff checks, not the installation/service/database lifecycle commands on this page.

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

## Windows PowerShell

Tested locally with Node 24.19.0, npm 11.17.0, Python 3.14.7,
Supabase CLI 2.121.0 and Docker Desktop.

Run from the repository root. Install backend/frontend dependencies with
`npm.cmd --prefix backend ci` and `npm.cmd --prefix frontend ci` on a fresh
checkout. Keep the committed lockfiles.

Configure tool paths in each new terminal:

```powershell
# An existing prepared checkout may have saved nonsecret tool paths.
if (Test-Path -LiteralPath '.\.local\windows-tools.json') {
    $tools = Get-Content -LiteralPath '.\.local\windows-tools.json' -Raw |
        ConvertFrom-Json
    $env:SUPABASE_BIN = $tools.SUPABASE_BIN
    $env:NPM_CLI_JS = $tools.NPM_CLI_JS
    $env:MENTOR_LOCAL_DIR = $tools.MENTOR_LOCAL_DIR
}

$env:PYTHON_BIN = (Get-Command python.exe -ErrorAction Stop).Source
$env:PYTHONUTF8 = '1'

# Fresh checkouts need the pinned native Supabase executable installed.
# Set SUPABASE_BIN explicitly if it is not on PATH.
if (-not $env:SUPABASE_BIN) {
    $env:SUPABASE_BIN = (
        Get-Command supabase.exe -ErrorAction Stop
    ).Source
}

if ((& $env:SUPABASE_BIN --version).Trim() -ne '2.121.0') {
    throw 'Supabase CLI 2.121.0 is required.'
}

python scripts/alignment/verify.py
if ($LASTEXITCODE -ne 0) { throw 'Alignment verification failed.' }

node scripts/foundation/local.mjs start
if ($LASTEXITCODE -ne 0) { throw 'Supabase startup failed.' }
```

Saved paths are machine-specific. Reconfigure them after moving the checkout,
removing the npm cache or reinstalling tools. Never commit `.local/`.

Build and start the backend:

```powershell
npm.cmd --prefix backend run build
if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
node scripts/foundation/local.mjs backend
```

In another terminal, load the tool configuration above, then run:

```powershell
node scripts/foundation/local.mjs frontend-build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
node scripts/foundation/local.mjs frontend
```

Keep both application terminals open. Backend: `http://127.0.0.1:3200/health`;
frontend: `http://127.0.0.1:3201/login`; local email:
`http://127.0.0.1:56324`. Health should report `status=ok` and
`database=connected`. Closing an application terminal stops that application.

Foundation scripts execute npm through Node on Windows and select Python
through PYTHON_BIN. NPM_CLI_JS can override the installed npm CLI JavaScript
path. The helpers do not require Bash for these commands.

Git attributes preserve reviewed SQL bytes and enforce LF for backend
TypeScript. A hash mismatch must be investigated; do not update manifests
or weaken verification to accommodate checkout conversion.

Historical setup claim: local database lifecycle and application checks were
reported passing on the Windows working tree during that setup. This paragraph
has no exact tested SHA/artifact identity; it is not fresh evidence at the current
HEAD. See the [audit's evidence boundaries](../07-planning/phase-1-audit.md).
These results do not establish remote CI success for a later commit or production
readiness. Broader R32 gates remain open. Keep private runtime configuration and
logs out of Git.

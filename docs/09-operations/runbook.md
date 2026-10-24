# Development runbook

For agent task intake, the current maintenance task and evidence, use [START-HERE](../00-governance/START-HERE.md) and the [shared workflow](../00-governance/agent-workflow.md). Latest merged implementation is the [M01-02 shared Auth abuse-control enabler](../07-planning/current-phase/M01-02.md#post-merge-status-and-evidence-2026-10-25), PR #7. Its helper/tests are delivered; endpoint/provider/session integration and generic R14 idempotency remain incomplete. Separate successful PR-head/main CI is recorded in that addendum, not evidence of local service health or production readiness. Prefer explicit Git Bash for Windows agent terminal commands after confirming the actual runner; native Windows PowerShell service instructions below remain supported. Documentation-only work runs read-only verifiers/link/diff checks, not the installation/service/database lifecycle commands on this page.

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

## Disposable Auth Redis tests (M01-02)

The shared enabler uses Redis 7+ as ephemeral storage only. Its independent test service is separate from Supabase and uses no persistent volume. From Git Bash at the repository root:

```bash
docker compose -p mentor-m01-02-auth-test -f backend/compose.auth-test.yml config --quiet
docker compose -p mentor-m01-02-auth-test -f backend/compose.auth-test.yml up -d --wait
AUTH_ABUSE_TEST_REDIS_URL=redis://127.0.0.1:56379 AUTH_ABUSE_TEST_DISPOSABLE=yes npm --prefix backend run test:redis
docker compose -p mentor-m01-02-auth-test -f backend/compose.auth-test.yml down
```

Port 56379 is loopback-only; resolve a collision by selecting another dedicated disposable port in a local Compose override and matching the test URL. Do not reuse or flush a shared Redis instance. Tests use random synthetic contacts/HMAC secrets, real independent clients, short configured expiries and selected fixture-owned PEXPIRE operations; they never call FLUSHDB/FLUSHALL or touch Supabase. CI starts a fresh Redis service for the backend job and runs the same focused suite. Local workflow/schema checks do not establish a completed GitHub run.

Configure the server-only variables in the [configuration register](../00-governance/config-register.md) consistently across all application instances. Use a single standalone Redis authority with `noeviction`, protected network access and credentials/TLS as appropriate to the deployment; Cluster multi-slot scripts are not supported. HMAC secret rotation changes the keyspace and resets effective limits, so it requires a coordinated operational decision. No production settings are changed by M01-02. R14 generic idempotency/loss-epoch recovery is outside this helper.

An atomic policy fingerprint in each HMAC namespace rejects mismatched R31 settings with retryable 503. Its TTL intentionally refreshes to the longest configured state lifetime on accepted-policy operations; this is separate from fixed counter/challenge expiries. Coordinate a policy change after old-policy traffic stops and that marker/state expires, or separately review a migration. Connection timeout and outage retry settings do not change the R31 fingerprint. Configurable defaults remain operating choices, with safe rollout rather than mixed limits on active state.

For the currently supported policy change procedure, stop new helper operations on every old-policy instance and drain outstanding provider callbacks before starting the quiet interval. Keep all Auth helper traffic quiescent for the longest **old** configured lifetime: OTP validity, resend cooldown, send window, login failure window or login lockout. An old-policy completion is also an operation and restarts that interval, so merely stopping new inbound requests is insufficient. Then start every participating instance with identical new settings, the same HMAC secret and the same Redis authority. This deliberately permits bounded Auth unavailability during a policy change; R31 does not promise a zero-downtime rolling migration. Unrelated application routes are not changed by this procedure.

Do not shorten/delete the live policy marker, rotate the HMAC secret or introduce a fresh namespace to skip that interval: active quotas, lockouts, consumed challenges or ownership state could be bypassed or interpreted under mixed limits. A no-wait change needs a separately reviewed migration/reconciliation design covering all live state and in-flight operations; this enabler does not implement such a migration. No production cutover is executed by these instructions.

`AuthAbuseControlModule` exports the helper and is imported by `AuthModule`; existing endpoints do not call it. Configuration is validated at startup when supplied. If entirely absent, existing routes continue to boot and any helper operation fails closed with retryable SERVICE_UNAVAILABLE 503. The client connects lazily, uses bounded connection/command waits, suppresses sensitive driver error payloads, has no offline queue/automatic replay, and destroys its socket on module shutdown. Main enables shutdown hooks. Every caller must supply a trusted client IP (never an arbitrary forwarded header), a validated normalized contact, and the same R31 policy/secret. IPv6 zone identifiers are rejected with a value-free error before URL canonicalization.

Future M01-03/04/05 callers must reserve send quota **before** provider delivery, including for unknown contacts. A provider delivery failure never refunds send quota. Create challenge metadata only for the corresponding provider challenge and cap validity by the provider-supported lifetime; six-digit validation stays in memory. Verification atomically reserves the current opaque generation before calling the provider, then compares ownership/generation and consumes once before returning success. No generation is added to the wire DTO. A replacement challenge invalidates older in-flight completion. The helper stores only opaque generations/operation owners, failure counts and consumed flags, with TTLs; OTPs and OTP digests remain outside Redis.

Login provider calls are serialized per identifier+IP. Confirmed failed credentials increment a first-failure fixed window; the fifth default failure starts a separate 15-minute lock. Successful login clears that pair's failures. Other identifiers at that IP and the same identifier at other IPs remain independent. Parallel callers for an occupied pair/challenge receive retryable 503 with remaining reservation time. Unexpected provider exceptions leave the reservation quarantined until expiry: a possibly successful external operation must not be repeated automatically. Adapters must classify ordinary wrong-code/credential outcomes as false; later endpoints remain responsible for provider-specific error translation, session establishment, user state, anti-enumeration and partial-failure reconciliation. No provider/session atomicity is claimed.

A provider callback can outlive a reservation. Redis ownership checks reject its late completion and preserve a newer reservation, but cannot cancel or undo a provider-side effect. Before M01-03+ establishes sessions, its provider adapter must define cancellation/fencing or reconciliation for interruption and provider-success/Redis-failure cases, and withhold the session until the helper reaches a successful terminal result. The real Redis suite covers late helper completion; it does not certify external-provider cancellation or session atomicity.

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

# Configuration register

Names and consumers below were checked against public templates and source during [DOC-01](../07-planning/current-phase/documentation-alignment/DOC-01.md). No private runtime values, credential stores or process environments were read. Use the [runbook](../09-operations/runbook.md) for authorized setup; this register is not proof that a provider or service is configured.

| Consumer / source | Names | Visibility and purpose |
|---|---|---|
| [Backend validation](../../backend/src/config.ts), app.module.ts; [public template](../../backend/.env.example) | SUPABASE_URL, SUPABASE_ANON_KEY, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME | Required server runtime variables. DB credentials are server-only; the anon/publishable key itself is public, never a service-role secret. |
| Backend main/strategy | PORT, SUPABASE_JWKS_URL | Optional server configuration; PORT defaults to 3200 and JWKS must match the Auth issuer. |
| [Frontend public template](../../frontend/.env.example), Supabase clients/API client/Auth actions | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SITE_URL | Public/build-visible values. API URL includes /api/v1; site URL controls callbacks. Never put a service-role key or other secret here. |
| [Local harness](../../scripts/foundation/local.mjs) | MENTOR_LOCAL_DIR, SUPABASE_BIN, SUPABASE_HOME | Local/server tooling only. Default project directory .local/foundation; pinned CLI 2.121.0; CLI state is separate from app configuration. |
| Local harness / image provenance | SUPABASE_INTERNAL_IMAGE_REGISTRY | Tooling override, default docker.io. CI validates upstream registry-backed images; do not invent equivalent provenance for adapted local images. |
| [Process helper](../../scripts/foundation/process.mjs) | PYTHON_BIN | Interpreter override. Native Windows fallback is python; other platforms use python3. Use an executable actually available to the task. |
| Process helper on Windows | NPM_CLI_JS | Optional installed npm-cli.js override. Otherwise resolves from Node's installation; npm is invoked through Node without requiring Bash inside the helper. |
| Windows runbook / Python | PYTHONUTF8 | Interpreter encoding option used by the documented PowerShell workflow, not an application secret or business setting. |
| CI / evidence helpers | MENTOR_LOCAL_DIR, FOUNDATION_ARTIFACTS | Checkout-owned disposable project and evidence destination; current workflows pin Node 24.19.0 and Supabase CLI 2.121.0. |

The local helper generates private runtime configuration and ES256 keys; it supplies generated app configuration when launching the apps rather than trusting stale ignored .env values. Never copy status JSON, signing keys, runtime backend/frontend JSON or private logs into documentation or Git. The ignored .local/windows-tools.json can retain operator-specific nonsecret tool paths; do not commit its contents or machine-specific absolute paths. Global exports/settings are unnecessary.

Public anon/publishable keys are distinct from user access JWTs. Document variable names, scope and consumers, not credentials or real runtime values. POSIX mode requests in a helper do not constitute an audit of Windows ACLs. Use actual filesystem permissions and .gitignore; no universal AI-ignore enforcement is claimed.

Network dependencies described by the current tooling include GitHub Git/REST/artifacts, npm, official Supabase/Docker registries and Google Fonts build hosts. This is an inventory, not evidence that a network allowlist or proxy setting is enforced. Do not disable TLS, checksum, health or image checks.

Future AI/Redis/provider/deletion configuration is not required by the limited foundation and is not fabricated here. Add names and scope with their implemented consumers and approved decisions. SQL business defaults remain owned by C06/R26.

# Configuration register

Runtime values are generated privately by `scripts/foundation/local.mjs`; never commit status.json, signing keys or credentials. Use [runbook](../09-operations/runbook.md).

| Consumer | Names / scope |
|---|---|
| Backend required | SUPABASE_URL, SUPABASE_ANON_KEY, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME |
| Backend optional | PORT (3200 default), SUPABASE_JWKS_URL (matching Auth JWKS endpoint) |
| Frontend build/runtime public | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL (includes /api/v1), NEXT_PUBLIC_SITE_URL |
| Local harness | MENTOR_LOCAL_DIR (default .local/foundation), SUPABASE_BIN (2.121.0), SUPABASE_HOME; no global exports required |
| CI | MENTOR_LOCAL_DIR checkout-owned .local/foundation; FOUNDATION_ARTIFACTS; upstream image registry docker.io |

Public anon/publishable keys are distinct from user ES256 access JWTs. Never put service-role/secret keys in frontend variables. Helper overrides stale ignored .env values. Future AI/Redis/provider/deletion keys are not required for this limited foundation and are not fabricated.

Network destinations: GitHub Git/REST/actions artifacts, npm registry, official Supabase/Docker image registries; fonts.googleapis.com/fonts.gstatic.com for current Next font build. TLS/checksum/image verification remains enabled. Operational defaults/configuration SQL belong to C06/R26; no duplicated business limits here.

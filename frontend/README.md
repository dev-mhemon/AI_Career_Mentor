# Next.js frontend

Next 16.3.7 / React 19 / Node >=24 with the existing npm lockfile and Vitest. Read [root setup](../README.md), scoped AGENTS.md and installed Next documentation before framework changes.

```bash
# Repository root
npm ci --prefix frontend
node scripts/foundation/local.mjs start
node scripts/foundation/local.mjs frontend-build
node scripts/foundation/local.mjs frontend
npm --prefix frontend run lint
npm --prefix frontend test
node scripts/foundation/frontend-check.mjs
```

Helper supplies NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL and NEXT_PUBLIC_SITE_URL at build and startup. Public variables are bundled during build; rebuild after changing them. Backend-only keys never enter the client.

Existing landing/login/register/verify/dashboard and OAuth callback are transitional foundation screens, not all 25 specified screens. Full Bangladesh local SMS, provider verification, password recovery and account deletion remain future gates. Google Fonts access is required by the existing layout. Auth metadata is not trusted as authorization. Typed API errors preserve field details, request IDs and retry metadata while hiding raw server/network diagnostics.

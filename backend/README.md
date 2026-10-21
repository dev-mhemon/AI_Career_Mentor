# NestJS backend

Read [root setup](../README.md) and [runbook](../docs/09-operations/runbook.md). Node >=24 and npm locked dependencies are required.

```bash
# From repository root
npm ci --prefix backend
node scripts/foundation/local.mjs start
npm --prefix backend run build
node scripts/foundation/local.mjs backend
```

`GET /health` is unversioned. Application API prefix is `/api/v1`. Implemented routes: auth/me, oauth/session, transitional auth/sync; profile get/patch/preferences/settings/alias; career goal get/confirm. C05's other routes are planned. Existing goal confirmation remains housed with profile functionality; no empty future module has been created merely to match a diagram.

DataSource is a transactional PostgreSQL connection manager. Every application transaction assumes service_role, locks the owner, rechecks account status and preserves ownership. Goal confirmation additionally rechecks roadmap_generator access inside its write transaction. No legacy migration runner, ORM entities, schema synchronization or startup migrations.

```bash
npm --prefix backend run lint
npm --prefix backend test
npm --prefix backend run build
node scripts/foundation/local.mjs backend-e2e
node scripts/foundation/application-check.mjs
```

Runtime helper reads private backend.json and overrides stale .env values. Session-capable DB connection required. See backend/.env.example for names; never put server/service credentials in frontend config. Full Auth provider/rate-limit/deletion/AI/admin implementation remains backlog.

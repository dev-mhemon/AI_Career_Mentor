# Deployment, Operations & Release Acceptance Plan (`M14-D`)

**Status:** Draft / review pending (authored `M14-D`, 2026-11-25). Derived from [PRD §54–56/§60 (C01)](../01-product/PRD.md), [SAD §9–12 (C02)](../02-architecture/SAD.md), [DIS §8–10 (C04)](../04-database/DIS.md), [API Specification `EP-H01` / §17 (C05)](../05-api/API-Specification.md), [DMS §17–20 / `R22` / `R23` / `E01` (C06)](../04-database/DMS.md), and [runbook.md](runbook.md).

> [!IMPORTANT]
> **NO PRODUCTION DEPLOYMENT IS AUTHORIZED BY THIS DOCUMENT.** Live infrastructure provisioning, cloud secret creation, provider activation, staging cutover, and production release each require explicit separate owner authorization and signed `R32` sub-gate evidence.

---

## 1. Environment Topology

| Environment | Purpose | Data & Provider Policy | Auth / Redis / DB Isolation |
|---|---|---|---|
| **Local (`local`)** | Developer workstation & disposable CI verification ([runbook.md](runbook.md)) | Synthetic fixtures only; Mailpit email/SMS fallback; `SyntheticProviderAdapter` default | Loopback Supabase CLI `2.121.0`, disposable Redis Compose (`56379`) |
| **Development (`dev`)** | Shared integration testing of merged `main` | Synthetic accounts & approved non-production keys only | Dedicated dev Supabase project, dedicated dev Redis (`noeviction`) |
| **Staging (`staging`)** | Pre-release `R32` qualification (capacity, PITR drill, 24-cell AI sweep, multi-provider smoke) | Permitted synthetic test cohort; approved staging provider keys | Production-parity Supabase project + direct/session pool + dedicated Redis (`noeviction`) |
| **Production (`production`)** | Live Bangladesh learner & platform admin traffic | Real user data strictly restricted to explicitly approved `real_user_data_approved = true` AI models & approved Auth/SMS/Email providers (`PRD §10/§47`) | Isolated production Supabase PostgreSQL + PITR, dedicated production Redis (`noeviction`, TLS, auth), isolated secrets store |

---

## 2. Named Operational Ownership Matrix (Pre-Release Gate `R32-PRODUCTION`)

No live pilot or production launch may proceed until each role below has a named individual/team recorded and accepted by the project owner:

| Ownership Domain | Scope & Responsibilities | Current Status |
|---|---|---|
| **Destination Infrastructure Owner** | Hosting platform selection (frontend Next.js runtime, backend NestJS API + worker processes, TLS/ingress, DNS, CDN) | **Pending owner assignment** |
| **Database & Cloud Access Owner** | Supabase project administration, PostgreSQL connection pooling (`PgBouncer` transaction pool for API + dedicated direct/session pool for `R25` scheduler), least-privilege IAM, `enable_manual_linking = true` | **Pending owner assignment** |
| **Secrets & Signing Keys Owner** | Server-only secret store provisioning ([config-register.md](../00-governance/config-register.md)), `AUTH_HMAC_SECRET`, `DELETION_RECEIPT_SECRET`, `PROVIDER_CLEANUP_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, AI/SMS/Email provider keys, rotation schedule | **Pending owner assignment** |
| **Platform Admin Bootstrap & Rotation Owner** | Out-of-band execution of [admin_bootstrap.sql](../../supabase/seeds/admin_bootstrap.sql), manual SQL password/email rotation, and `admin_audit_logs` governance | **Pending owner assignment** |
| **Backup & PITR Recovery Owner** | Continuous WAL archiving verification, scheduled PITR drills (`RPO < 5 min`, `RTO < 30 min`), restore evidence sign-off | **Pending owner assignment** |
| **Monitoring & Alerting Owner** | `EP-H01` `/health` probes, `ai_requests` queue depth/failure/budget alerts, `R08`/`R09` purge lag alerts, `R35` provider cleanup outbox backlog alerts, Redis availability alerts | **Pending owner assignment** |
| **On-Call Incident Response Owner** | P1/P2 triage, Redis `R14` epoch recovery fencing, feature-flag kill-switch (`EP-AD05`), provider failover/rollback execution | **Pending owner assignment** |

---

## 3. Health Gating (`EP-H01` `GET /health`), Rollout & Rollback

### 3.1 Canonical `EP-H01` Readiness & Liveness Contract
- **Endpoint:** Unversioned `GET /health` (outside `/api/v1`, public, zero `R24` user activity writes, zero secret/provider/SQL error leakage).
- **Contract Payload (`HealthResponseDTO`):**
  ```json
  {
    "status": "ok",
    "version": "1.5.1",
    "time": "2026-11-25T15:00:00.000Z",
    "checks": {
      "database": "ok",
      "queue": "ok"
    }
  }
  ```
- **Probe Behavior ([backend-architecture.md](../02-architecture/backend-architecture.md)):**
  - Executes bounded (`<= 2,000ms`) single-flight coalesced `SELECT 1` (`checks.database`) and `public.ai_requests` accessibility + `PostgresJobQueueConsumer.isReady()` (active polling loop + registered handlers + post-probe recheck) check (`checks.queue`).
  - Returns HTTP `200` only when both `database === 'ok'` and `queue === 'ok'`.
  - Returns HTTP `503 Service Unavailable` with `status: 'unavailable'` and the failing component marked `'error'` when either dependency fails, times out, or the consumer stops mid-probe.
  - Orchestrators MUST gate ingress traffic readiness on `GET /health` returning `200`, and MUST configure probe intervals `>= 10s` with timeout `>= 3s`.

### 3.2 Standard Rollout Procedure
1. **Pre-Flight Gate:** Confirm exact release candidate Git SHA, green CI across backend/frontend/alignment/baseline verifiers, and zero unreviewed SQL edits (`verify-baseline.py` exit `0`).
2. **Database Forward Migrations (If Any):** Review and apply only approved forward migrations (`synchronize = false`, `migrationsRun = false` in TypeORM). Never edit applied `000`–`027` migrations.
3. **Config & Secrets Verification:** Verify all required environment variables in [config-register.md](../00-governance/config-register.md) are present and consistent across every backend instance (especially `R31` auth abuse settings and `IDEMPOTENCY_REDIS_EPOCH`).
4. **Canary / Rolling Deploy:** Deploy backend + worker image, confirm `GET /health` returns `200` (`checks.database = 'ok'`, `checks.queue = 'ok'`), then deploy frontend Next.js build and verify `/manifest.webmanifest` and `/login` return `200`.
5. **Post-Deploy Smoke:** Verify public `GET /health`, synthetic authenticated `EP-A13 /api/v1/auth/me`, and zero spike in `5xx` or `AI_VALIDATION_FAILED` logs.

### 3.3 Rollback Procedure
1. **Application Rollback:** Re-point ingress / redeploy previous verified backend & frontend artifacts immediately; re-verify `GET /health` `200`.
2. **Feature Kill-Switch (`EP-AD05`):** If an individual AI workflow degrades without requiring full rollback, a platform admin disables the affected `feature_key` globally via `PATCH /api/v1/admin/features` (`PRD §7` — preserves existing learner data and read access except `technology_update`).
3. **Schema Rollback Boundary:** Never execute destructive down-migrations on production without an approved backup/PITR plan. All schema changes must remain backward-compatible during rolling deploys (`C04 §8`).

---

## 4. Platform Admin Bootstrap & Credential Rotation (`supabase/seeds/admin_bootstrap.sql`)

- **Out-of-Band Provisioning Only:** Platform administrators are never created via learner self-registration. Operators execute [admin_bootstrap.sql](../../supabase/seeds/admin_bootstrap.sql) directly via privileged SQL with an operator-supplied `app.admin_bootstrap_password` session variable (`SET LOCAL app.admin_bootstrap_password = '...';`).
- **Pre-Registration Hijack Guard:** The script fails closed if any pre-existing non-admin row exists in `auth.users` for the target email, preventing account takeover via pre-registration.
- **Rotation & Revocation Scope:** The script includes documented SQL blocks for password rotation and consistent email rotation across `auth.users`, `auth.identities`, `public.users`, and `public.user_auth_providers`, revoking `private.approved_auth_sessions`, `auth.refresh_tokens`, and `auth.sessions`.
  - Revoking `private.approved_auth_sessions` immediately invalidates all NestJS backend API calls (`AccessGuard`).
  - Direct stateless PostgREST/Storage JWTs remain valid until `exp` unless the Supabase JWT secret is rotated.

---

## 5. Redis Operational Policies (`R14` Idempotency Epoch & `R31` Auth Abuse Controls)

Both subsystems require a single standalone Redis 7+ authority configured with `maxmemory-policy noeviction`, TLS, authentication, and private network access (Redis Cluster multi-slot scripts are unsupported). Exact step-by-step procedures live in [runbook.md](runbook.md):

1. **`R14` Idempotency Loss-Epoch Barrier (`IdempotencyService`):**
   - Never auto-seed `idempotency:epoch` in serving instances (`IDEMPOTENCY_BOOTSTRAP_ON_INIT` must stay unset/`false` in steady state; use only for brand-new zero-traffic provisioning).
   - **Mandatory Pre-Restore Traffic Fence:** **Before** any restored Redis snapshot/RDB/AOF accepts application connections, operators MUST fence and drain all application traffic first (suspending ingress and scaling down or rolling serving instances to a rotated `IDEMPOTENCY_REDIS_EPOCH = E_new`) OR restore into an isolated non-routed Redis instance and delete `idempotency:epoch` prior to exposing it (matching [runbook.md](runbook.md)).
   - After pre-restore fencing: confirm termination of all pre-loss in-flight handlers (or enforce an active DB write fence) -> verify every serving instance is reloaded with `IDEMPOTENCY_REDIS_EPOCH = E_new` -> reconcile open replay records with original responses/deadlines or wait the full `IDEMPOTENCY_TTL_SECONDS` (`86,400s` default) before calling `acknowledgeEpoch(E_new)` and reopening ingress.
2. **`R31` Auth Abuse Policy Fingerprint (`AuthAbuseControlModule`):**
   - Mismatched `R31` settings across instances fail closed with retryable `503`.
   - Policy changes require stopping old-policy Auth helper operations and waiting the longest old configured lifetime (OTP validity, resend cooldown, send window, login failure window, or lockout) before starting all instances with identical new settings. Never delete the live policy marker or rotate `AUTH_HMAC_SECRET` to bypass the quiet window.

---

## 6. Workers, Schedulers & Retention / Cleanup SLAs

| Background Process | Authority & Tables | Connection / Concurrency Budget | Operational SLA & Alert Threshold |
|---|---|---|---|
| **Durable AI Job Worker (`PostgresJobQueueConsumer` + `JobReaperService`)** | `R12`, `R13`, `public.ai_requests`, `public.ai_generations` | Uses pooled `DataSource`; `FOR UPDATE SKIP LOCKED` claim; 30s heartbeat; 120s lease; 1h max job age; max 5 attempts | Alert on `queued` age `> 5 min`, `preparing` expired lease spikes, or `GET /health` `checks.queue === 'error'` |
| **`R25` Daily Technology Update Scheduler (`TechnologyUpdateSchedulerService`)** | `R25`, `public.update_delivery_history`, `public.technology_updates` | Dedicated direct/session `pg.Pool` (`TECH_UPDATE_DIRECT_DATABASE_URL` / `DATABASE_DIRECT_URL`), capped strictly at `TECH_UPDATE_CONCURRENCY <= 2` pinned connections | Runs after 06:00 learner local time; aborts cleanly on advisory lock loss (`pg_locks` `objsubid = 2`) or timezone/midnight drift |
| **`R08`/`R09` Physical Retention Purge (`PrivacyRetentionService`)** | `R08`, `R09`, `private.cleanup_expired_retention()` | Scheduled batch execution (minimum daily; recommended every 6h) | Raw quiz text & mentor messages `<= 90d`, AI operational logs & context records `<= 30d`; alert if purge lag `> 24h` or oldest expired row exceeds window |
| **`R35` Provider Cleanup Outbox (`ProviderCleanupService`)** | `R35`, `public.account_deletion_requests` | AEAD `aes-256-gcm` encrypted outbox; exponential backoff `2^attempts * 60s` capped at 24h | Scrubs expired encrypted cleanup payloads after 30 days; alert on failed cleanup attempts exceeding 24h |

---

## 7. PostgreSQL Autovacuum Tuning (`C06 §20`)

Apply the adopted per-table autovacuum overrides from [DMS §20](../04-database/DMS.md) on staging and production PostgreSQL databases to prevent dead-tuple bloat on high-churn queue and message tables:

```sql
ALTER TABLE public.ai_requests
  SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);

ALTER TABLE public.messages
  SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);

ALTER TABLE public.quiz_answers
  SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);

ALTER TABLE public.ai_context_records
  SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
```

---

## 8. PITR Disaster Recovery Drill & Read-Only Catalog Smoke (`R23`, `R32-RECOVERY`)

- **Recovery Targets (`C06 §18` / `R23`):** `RPO < 5 minutes`, `RTO < 30 minutes`.
- **Mandatory Safety Prohibition:** **NEVER** replay `019_tests.sql` or `020_gaps_and_alignment.sql` DDL against a post-`020` restored database. Verify restored databases strictly via read-only catalog checks and recorded migration checksums.
- **Drill Steps:**
  1. **Sentinel Sequence Recording (Pre-Cutoff):** On the staging/disposable source DB, insert a monotonic timestamped sequence of synthetic sentinel rows (`sentinel_seq`, `committed_at_utc`) at regular intervals (e.g., every 30s) leading up to simulated loss/cutoff, recording the latest source sentinel committed before cutoff (`S_source_max`, `T_source_max`).
  2. **Isolated PITR Restore:** Restore the PITR backup into an isolated recovery project targeting `T_target`, recording restore start `T_start` and recovery-ready `T_ready` (`RTO = T_ready - T_start`, target `< 30 min`).
  3. **Read-Only Catalog & RPO Sentinel Verification (`C06 §18` / `R23`):** Query expected catalog counts (`50` public tables, `45` public enums, `>= 22` private functions including `022`–`024` session approval helpers), verify recorded migration checksums, and query the latest recovered sentinel (`S_recovered_max`, `T_recovered_max`) to calculate observed `RPO = T_source_max - T_recovered_max` (target `< 5 min`):
     ```sql
     SELECT
       (SELECT count(*) FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS public_tables,
       (SELECT count(*) FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'public' AND t.typtype = 'e') AS public_enums,
       (SELECT count(*) FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'private') AS private_functions;
     ```
  4. **Isolated Non-Production Recovery Smoke (`EP-H01` Safety Isolation):** Before booting any backend instance against the restored recovery DB to verify `GET /health`, operators MUST apply strict non-production isolation so queued `public.ai_requests` rows from the restored DB can NEVER replay against shared Redis or live external AI/email/SMS providers:
     - Point `AUTH_REDIS_URL` / `IDEMPOTENCY_REDIS_URL` to a dedicated disposable/isolated Redis instance (NEVER shared staging/production Redis).
     - Set `AI_EXECUTION_MODE=synthetic`, `TECH_UPDATE_SCHEDULER_ENABLED=false`, `TECH_UPDATE_SOURCE_MODE=synthetic`, and omit all live AI (`GEMINI_API_KEY`), email (`RESEND_API_KEY`), and SMS (`TEXTBEE_API_KEY`) credentials.
     - Verify `GET /health` returns `200` (`status: 'ok'`, `checks: { database: 'ok', queue: 'ok' }`) under isolated synthetic mode (or run with worker polling disabled to confirm `checks.database: 'ok'` and fail-closed `checks.queue: 'error'` `503`), then tear down the isolated smoke instance and archive redacted RPO/RTO/checksum evidence under the release record.

---

## 9. Disposable Capacity & Query-Plan Qualification (`R22`, `R32-CAPACITY`)

Execute **only** on a positively identified disposable/staging PostgreSQL instance with background workers disabled (`SET LOCAL session_replication_role = replica` during seed load per [DMS §19 / `R22`](../04-database/DMS.md)):

- **Minimum Synthetic Load Profile (`50`–`100` concurrent-scale cohort):** `100` users, `300` roadmaps, `12,000` roadmap items, `60,000` daily plan items, `210,000` messages, `100,000` AI requests, `5,000` skill progress rows, plus queued async rows.
- **Required `EXPLAIN (ANALYZE, FORMAT JSON)` Latency Budgets:**
  - `<= 5 ms`: active roadmaps lookup, version items lookup, today open item lookup, `EP-J01` job poll, `FOR UPDATE SKIP LOCKED` queue claim.
  - `<= 10 ms`: skill progress by state, mentor message keyset pagination.
  - `<= 300 ms`: 30-day feature usage aggregation.
  - `<= 1,000 ms`: `private.admin_usage_summary(p_from, p_to)` (`EP-AD08`).
- **Connection Budget Verification:** Measure active pooled API connections + worker connections + `<= 2` pinned `R25` scheduler connections against the target Supabase tier connection ceiling. Never claim `R32-CAPACITY` `EXECUTED` from unit tests alone.

---

## 10. `E01` Approved 5-FK Exception Register (`C06` / `DMS.md`)

All 5 nullable admin-actor foreign keys referencing `public.admin_users(user_id)` retain `ON DELETE RESTRICT` rather than `ON DELETE SET NULL` to preserve administrative accountability trails (`E01` scoped exception, recorded in [DMS](../04-database/DMS.md) and [DB-schema-map.md](../04-database/DB-schema-map.md)):

| # | Table | Constraint Name | Column | Delete Rule | Operational Consequence |
|---|---|---|---|---|---|
| 1 | `public.users` | `fk_users_suspended_by` | `suspended_by` | `RESTRICT` | Admin account with historical suspension records cannot be hard-deleted without governance review |
| 2 | `public.admin_users` | `admin_users_created_by_fkey` | `created_by` | `RESTRICT` | Preserves admin-provisioning chain of custody |
| 3 | `public.system_configurations` | `system_configurations_updated_by_fkey` | `updated_by` | `RESTRICT` | Preserves config mutation attribution |
| 4 | `public.feature_controls` | `feature_controls_updated_by_fkey` | `updated_by` | `RESTRICT` | Preserves global feature-control attribution |
| 5 | `public.user_access_overrides` | `user_access_overrides_updated_by_fkey` | `updated_by` | `RESTRICT` | Preserves per-user override attribution |

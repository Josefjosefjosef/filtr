# CJ/FORPSI — Cloudflare staging runbook (commands documented only)

Do **not** run against production. Requires explicit operator GO per phase. No live IMAP/CJ/feed fetch until S4 connector GO.

Binding contract: `scripts/iu-cj-affiliate-phase2-staging-worker-bindings-lib.mjs` (`DB`, `BANNER_ASSETS`, `ENVIRONMENT=staging`, `IU_CJ_STAGING_ONLY=1`).

---

## S0 — Environment check

| Step | Command (local, read-only) | Expected |
|------|---------------------------|----------|
| Wrangler login | `wrangler whoami` | Account name, no error; GHA S0 matches `577868e9aac9c289e9323100f68fad16` from table or `--json` |
| List D1 | `wrangler d1 list` | No duplicate `iu-cj-email-ingest-staging` unless intentional |
| List R2 | `wrangler r2 bucket list` | No public ACL on staging bucket names |
| Repo audit | `node scripts/iu-cj-affiliate-phase2-staging-isolation-v1-selftest.mjs` | `IU_CJ_STAGING_ISOLATION_V1_SELFTEST: OK` |
| GHA bootstrap token | GitHub secret `CLOUDFLARE_CJ_STAGING_API_TOKEN` (staging-only; D1/R2/Workers Scripts Edit) | Used only by `cj-affiliate-staging-bootstrap.yml` on `workflow_dispatch` |

Rollback: none (read-only).

Post-deploy `/health` on `*.workers.dev` can return **404 for a few seconds** while the route propagates. Bootstrap synthetic step uses bounded retry (404/502/503 only; 401/403 fail closed).

---

## S1 — Staging D1

| Step | Command | Expected | Checkpoint |
|------|---------|----------|------------|
| Create DB | `wrangler d1 create iu-cj-email-ingest-staging` | JSON with `database_id` | Copy ID, **not** prod ID |
| Update wrangler | Set `database_id` under `[env.staging.d1_databases]` in `cloudflare/cj-email-ingest-d1-worker/wrangler.toml` | Placeholder replaced | Commit in repo after GO |
| Apply migrations (staging only) | `cd cloudflare/cj-email-ingest-d1-worker` then `wrangler d1 migrations apply iu-cj-email-ingest-staging --env staging --remote` | All migrations OK | Row counts via `wrangler d1 execute ... --command "SELECT name FROM sqlite_master"` |
| Verify prod untouched | `wrangler d1 list` | Prod DB name unchanged | STOP if prod ID in wrangler |

Rollback: drop staging D1 only (`wrangler d1 delete iu-cj-email-ingest-staging`); never delete prod.

---

## S2 — Private R2 (banner assets)

| Step | Command | Expected |
|------|---------|----------|
| Create bucket | `wrangler r2 bucket create iu-cj-banner-assets-staging` | Bucket created |
| Confirm private | No public access policy / no r2.dev publish | Objects not world-readable |
| Binding | `[env.staging.r2_buckets]` `BANNER_ASSETS` in wrangler | Matches worker code |

Rollback: delete staging bucket after emptying (operator GO).

---

## S3 — Staging Worker deploy

| Step | Command | Expected |
|------|---------|----------|
| Secret | `wrangler secret put IU_CJ_D1_WORKER_INGEST_TOKEN --env staging` | Prompt only in terminal, not in repo |
| Deploy | `wrangler deploy --env staging` | Worker URL `*.workers.dev` or staging route |
| Health | `curl -sS "$STAGING_URL/health"` | `{"ok":true,"d1Binding":"present",...}` no secrets |
| Fail-closed | POST ingest without token | 401/403 |

Rollback: `wrangler delete iu-cj-email-ingest-d1-staging` (staging name only); revoke token.

---

## S4 — Connectors (one at a time)

Prerequisites: `IU_CJ_LIVE_INGEST_APPROVED=1`, offline flags cleared per connector, staging secrets set.

| Connector | Enable flags | Verify |
|-----------|--------------|--------|
| FORPSI IMAP | `IU_FORPSI_IMAP_CONNECT_APPROVED=1` | Audit JSONL `email_ingest`, no `publishable: true` |
| CJ API | `IU_CJ_CJ_API_HTTP_EXECUTE=1` | 401/429 classified; GraphQL `res.json.data` |
| Link Search / banners | PAT + execute flags | R2 object keys under `staging/banners/` |
| Product feeds | `IU_CJ_APPROVED_FEED_HTTP_EXECUTE=1` | Registry-only URLs; import audit counts |

Burn-in: manual `workflow_dispatch` on `cj-affiliate-offline-import-dispatch.yml` with staging env vars; monitor `staging-ops-monitor-lib` snapshot.

Rollback: set `IU_CJ_*_OFFLINE=1`, revoke PAT/IMAP, disable dispatch schedules (must remain absent until GO).

---

## 24/7 readiness (not activated here)

- **Scheduler:** Cloudflare cron or GHA `schedule` only after burn-in GO; until then `staging-scheduler-contract-lib` must report `cronArmed: false`.
- **Single-flight:** unattended lock file / D1 lock row.
- **Retry:** 429/5xx backoff in unattended cycle lib.

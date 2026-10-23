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
| CJ PAT (after operator GO) | Cloudflare Dashboard → Workers → `iu-cj-email-ingest-d1-staging` → Settings → Variables → Encrypt → name **`CJ_API_PAT`** | Value never in repo, chat, or CI logs; not the same as `CLOUDFLARE_CJ_STAGING_API_TOKEN` |
| CJ PAT (CLI alternative) | `cd cloudflare/cj-email-ingest-d1-worker` then `wrangler secret put CJ_API_PAT --env staging` | Paste at prompt only; terminal history risk — prefer Dashboard |
| Publisher IDs | Worker vars (non-secret): `IU_CJ_PUBLISHER_CID`, `IU_CJ_WEBSITE_PID` in `wrangler.toml` `[env.staging].vars` | Staging deploy applies **7667828** / **101883843**; Publisher CID ≠ advertiser CID |
| Deploy | `wrangler deploy --env staging` | Worker URL `*.workers.dev` or staging route |
| Health | `curl -sS "$STAGING_URL/health"` | `{"ok":true,"d1Binding":"present",...}` no secrets |
| Fail-closed | POST ingest without token | 401/403 |

Rollback: `wrangler delete iu-cj-email-ingest-d1-staging` (staging name only); revoke token.

### GitHub Actions ingest token (probe workflow only)

| Store | Name | Worker binding name |
|-------|------|---------------------|
| Cloudflare Worker secret (staging) | *(value in operator vault only)* | `IU_CJ_D1_WORKER_INGEST_TOKEN` |
| GitHub Actions secret (repo) | `IU_CJ_STAGING_D1_WORKER_INGEST_TOKEN` | Same **value** as Worker secret |

- Never commit, log, or paste the token in chat/CI output.
- Do **not** rotate `CJ_API_PAT` when fixing GitHub ↔ Worker ingest sync.
- If the original value is lost: operator generates a new random token, sets **both** stores in one maintenance window, then verifies `POST /v1/staging/cj-api/readiness` with Bearer auth (no CJ HTTP).
- Staging email ingest and bootstrap may use the same Worker secret; changing it without updating all consumers breaks authorized ingest until aligned.

---

## S4 — Connectors (one at a time)

Prerequisites: `IU_CJ_LIVE_INGEST_APPROVED=1`, offline flags cleared per connector, staging secrets set.

| Connector | Enable flags | Verify |
|-----------|--------------|--------|
| FORPSI IMAP | `IU_FORPSI_IMAP_CONNECT_APPROVED=1` | Audit JSONL `email_ingest`, no `publishable: true` |
| CJ API | `CJ_STAGING_ARCHIVE_ONLY=1` (default on staging) + secrets `CJ_API_PAT` + vars CID/PID; GO flags `IU_CJ_STAGING_CJ_API_PROBE_APPROVED=1`, `IU_CJ_CJ_API_HTTP_EXECUTE=1`, `IU_CJ_STAGING_CJ_API_PROBE_EXECUTE=1` | GET `/v1/staging/cj-api/readiness` (ingest token); POST `/v1/staging/cj-api/probe` blocked until all GO flags; 401/429 fail-closed |
| Link Search / banners | PAT + execute flags | R2 object keys under `staging/banners/` |
| Product feeds | `IU_CJ_APPROVED_FEED_HTTP_EXECUTE=1` | Registry-only URLs; import audit counts |

Burn-in: manual `workflow_dispatch` on `cj-affiliate-offline-import-dispatch.yml` with staging env vars; monitor `staging-ops-monitor-lib` snapshot.

### First CJ API probe (plan only — do not run until operator GO)

1. Confirm Worker secret **`CJ_API_PAT`** exists (Dashboard → Variables; never print value).
2. Set non-secret vars **`IU_CJ_PUBLISHER_CID`**, **`IU_CJ_WEBSITE_PID`** on staging Worker.
3. `curl -sS -H "Authorization: Bearer $INGEST_TOKEN" "$STAGING_URL/v1/staging/cj-api/readiness"` — expect `mayExecuteHttp:false`, `hasPatSecret:true` after PAT set.
4. Only after written GO: set `IU_CJ_STAGING_CJ_API_PROBE_APPROVED=1`, `IU_CJ_CJ_API_HTTP_EXECUTE=1`, `IU_CJ_STAGING_CJ_API_PROBE_EXECUTE=1` (Worker vars), redeploy staging.
5. POST `/v1/staging/cj-api/probe` with ingest token — max `IU_CJ_CJ_API_MAX_REQUESTS_PER_PROBE` (default 1); archive metadata to staging D1 only; `publishable` must stay false.
6. On 401/403/429/5xx or identity mismatch: STOP, revoke execute flags, audit without PAT.

### One-shot probe lock keys (allowlist)

| Key | Meaning |
|-----|---------|
| `link_search_coupon_v1` | First live probe (consumed after HTTP 400 run; **do not reset**) |
| `link_search_coupon_v2` | Next authorized probe only — selected via workflow input `probe_lock_key` (never auto) |

Worker var: `IU_CJ_STAGING_PROBE_LOCK_KEY` (default / disarm reset = `link_search_coupon_v1`). Unknown or empty values are fail-closed (no HTTP, no D1 insert).

### MANUAL_DISARM — ruční obnovení GO OFF (nouzové vypnutí)

Use when GHA `disarm-failsafe` is cancelled, skipped, or the Actions runner dies mid-arm.

1. From `cloudflare/cj-email-ingest-d1-worker` with staging CF token:
   `npx wrangler@4 deploy --env staging --keep-vars --var "IU_CJ_STAGING_CJ_API_PROBE_APPROVED:0" --var "IU_CJ_CJ_API_HTTP_EXECUTE:0" --var "IU_CJ_STAGING_CJ_API_PROBE_EXECUTE:0" --var "IU_CJ_STAGING_PROBE_LOCK_KEY:link_search_coupon_v1"`
2. Verify: `curl -fsS "$STAGING_URL/health"` → `cjLiveApiRequestsAllowed=false`, `publishable=false`.
3. Verify: `GET /v1/staging/cj-api/readiness` with ingest Bearer → `mayExecuteHttp=false`.
4. If disarm cannot be confirmed: mark future live probe **CJ_DISARM_FAILSAFE=BLOCKED** (kritický) — not SAFE — until manual recovery succeeds. Do not arm again.

Disarm job in `cj-affiliate-staging-cj-api-probe-once.yml` uses `if: always()` so probe success, HTTP 4xx/5xx, timeout, or validation failure still attempt GO OFF.

Rollback: set `IU_CJ_*_OFFLINE=1`, revoke PAT/IMAP, disable dispatch schedules (must remain absent until GO).

---

## 24/7 readiness (not activated here)

- **Scheduler:** Cloudflare cron or GHA `schedule` only after burn-in GO; until then `staging-scheduler-contract-lib` must report `cronArmed: false`.
- **Single-flight:** unattended lock file / D1 lock row.
- **Retry:** 429/5xx backoff in unattended cycle lib.

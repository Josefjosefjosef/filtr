# CJ / FORPSI Phase 2 — isolated staging plan (no production activation)

Companion to `CJ-PHASE2-OFFLINE-SERVER-RUNBOOK.md`. This document defines **how** to stand up a **staging-only** pipeline for coupons, product cards, and CJ graphic banners. It does **not** authorize live IMAP, live CJ HTTP, production D1, production cron, or public publishing.

## Hard gates (must remain until explicit operator GO)

| Switch / flag | Staging default | Production default |
|---------------|-----------------|-------------------|
| `PRODUCTION_SIGNING_ENABLED` | `false` | `false` |
| `ARCHIVE_TRUSTED_PUBLICATION_ADAPTER_ENABLED` | `false` | `false` |
| `ADS_PUBLIC_DELIVERY_ENABLED` | `false` | `false` |
| `ADS_SAFE_MODE` | `true` | `true` |
| `IU_CJ_EMAIL_INGEST_OFFLINE` | `1` (until staging burn-in GO) | `1` |
| `IU_CJ_UNATTENDED_IMPORT_OFFLINE` | `1` | `1` |
| `IU_FORPSI_IMAP_CONNECT_APPROVED` | unset / `0` | unset / `0` |
| `IU_CJ_CJ_API_HTTP_EXECUTE` | unset / `0` | unset / `0` |
| `IU_CJ_APPROVED_FEED_HTTP_EXECUTE` | unset / `0` | unset / `0` |
| GitHub Actions `schedule` on ingest workflows | **none** | **none** |

Publication rule: unknown or conflicting permission ⇒ `publishable: false` (fail-closed).

## Architecture (shared for all three content kinds)

```text
FORPSI IMAP ──┐
CJ API (PAT) ─┼─► normalize (coupon | product | banner) ─► validate ─► permission gates ─► archive (private) ─► publication gate (off)
Link Search ──┤
Approved feeds┘
```

## Staging infrastructure target

| Component | Staging name / binding | Production |
|-----------|------------------------|------------|
| Worker | `iu-cj-email-ingest-d1-staging` (`cloudflare/cj-email-ingest-d1-worker/wrangler.toml`) | separate worker name; **do not reuse** |
| D1 | `iu-cj-email-ingest-staging` (placeholder ID in wrangler; create real staging DB in CF dashboard) | production D1 **blocked** |
| R2 | private bucket for banner binaries (non-public ACL); bind in wrangler `[r2_buckets]` when created | same pattern, isolated bucket |
| Ingest token | `IU_CJ_D1_WORKER_INGEST_TOKEN` via `wrangler secret put` | separate secret |
| Queues / cron | optional later; start with `workflow_dispatch` + manual Worker triggers only | no prod cron |

## Offline code modules (repo, no Cloudflare GO)

| Module | Purpose |
|--------|---------|
| `iu-cj-affiliate-phase2-approved-product-feed-http-import-lib.mjs` | Mock-first approved feed HTTP import (SSRF, redirects, dedupe, audit) |
| `iu-cj-affiliate-phase2-banner-staging-r2-lib.mjs` | In-memory R2 stand-in + banner archive metadata |
| `iu-cj-affiliate-phase2-staging-env-guard-lib.mjs` | Wrangler staging naming / D1 isolation audit |
| `iu-cj-affiliate-phase2-staging-scheduler-contract-lib.mjs` | Assert CJ workflows have no `schedule` cron |
| `iu-cj-affiliate-phase2-staging-ops-monitor-lib.mjs` | Audit JSONL ops snapshot (redacted) |

Selftests: `*-selftest.mjs` above + `iu-cj-affiliate-phase2-staging-isolation-v1-selftest.mjs` (orchestrated in offline full-stack).

## Phase S0 — staging account prep (no live calls)

1. Create **staging** D1 database; replace placeholder `database_id` in wrangler; run migrations **only** against staging D1 (`wrangler d1 migrations apply … --env staging` or local miniflare).
2. Create **private** R2 bucket for banner assets; configure Worker binding; deny public `r2.dev` exposure.
3. Store secrets in CF / GitHub **staging** environments only: `IU_CJ_PAT`, `IU_FORPSI_IMAP_*`, `IU_CJ_PUBLISHER_CID`, `IU_CJ_WEBSITE_PID`, ingest token.
4. Deploy Worker to staging route (e.g. `*.workers.dev` or staging subdomain); **no** production DNS.
5. Run offline selftests from CI or laptop against mocks (no network):

   ```text
   node scripts/iu-cj-affiliate-phase2-offline-full-stack-v1-selftest.mjs
   node scripts/iu-cj-affiliate-phase2-banner-permission-selftest.mjs
   node scripts/iu-cj-affiliate-phase2-banner-negative-v1-selftest.mjs
   ```

## Phase S1 — dry-run wiring (still offline)

1. GitHub Actions: `cj-affiliate-offline-import-dispatch.yml` and `cj-affiliate-email-ingest.yml` — keep **`workflow_dispatch` only**; set repo secrets for staging environment; leave `IU_CJ_*_OFFLINE=1` and `IU_CJ_GITHUB_INGEST_DRY_RUN=1`.
2. Point staging Worker URL + token in env for unattended runner **dry-run** path only.
3. Verify audit JSONL and lock files under unattended cycle; confirm every record ends `publishable: false`.

## Phase S2 — staging live connectors (requires **separate** GO per connector)

Each arm is independent; enable one at a time after S0–S1 pass.

| Arm | Enable flags | Validation |
|-----|--------------|------------|
| FORPSI IMAP TLS | `IU_FORPSI_IMAP_CONNECT_APPROVED=1`, unset email offline | UID/UIDVALIDITY dedupe; MIME attachment limits; spoof quarantine selftests |
| CJ API GraphQL | `IU_CJ_CJ_API_ENABLED=1`, `IU_CJ_CJ_API_HTTP_EXECUTE=1` | 401/403/429/5xx classification; empty catalog; PID/CID checks |
| CJ Link Search (banners) | same PAT arm + registry builders | permission 56/56; asset security; no HTML/JS creatives |
| Approved product feeds | `IU_CJ_APPROVED_FEED_HTTP_EXECUTE=1` + registry row | SSRF/private IP; redirect cap; parse-only then archive |

**Never** write staging rows to public Pages data or `assets/iu-affiliate-phase2-offers-v1.js` without publication GO.

## Phase S3 — burn-in (staging only)

1. Run manual dispatch cycles on a fixed schedule (human-triggered) for 7–14 days.
2. Monitor: rate limits, lock contention, zero-feed alerts, banner withdrawal/expiry jobs.
3. Single-flight + retry/backoff: use existing unattended lock; extend with Worker cron **only on staging** after stability review.

## Phase S4 — production cutover (out of scope here)

Requires explicit checklist in offline runbook § Live activation + separate security review. Includes: production D1 migrations GO, production Worker deploy, optional cron, and **two-key** publication (`PRODUCTION_SIGNING_ENABLED` + trusted adapter).

## Readiness matrix (audit snapshot)

| Area | Status | Blocker / next step |
|------|--------|---------------------|
| FORPSI adapter (code) | **READY** | Staging IMAP secrets + `IU_FORPSI_IMAP_CONNECT_APPROVED=1` GO |
| CJ API adapter (code) | **READY** | PAT + `IU_CJ_CJ_API_HTTP_EXECUTE=1` GO |
| Product feeds (registry + gates) | **PARTIAL** | Live HTTP import path; staging feed URLs in registry |
| CJ banners (registry + security) | **READY** (offline) | Staging R2 + Link Search execute GO |
| D1 (staging) | **PARTIAL** | Create real staging DB ID; apply migrations to staging only |
| R2 (banner storage) | **PARTIAL** | Create private bucket + wrangler binding |
| Scheduler | **BLOCKED** | No cron until S3 burn-in |
| Monitoring | **PARTIAL** | GHA + Worker logs; add alerts on 429/403/zero-import |
| Secrets | **BLOCKED** | Operator must provision staging secrets (not in repo) |
| Publication gate | **READY** | Fail-closed; all ingest forces `publishable: false` |

## What remains for safe 24/7 automatic ingest (all three kinds)

1. Provision **isolated** staging D1 + R2 + Worker deploy with real IDs and secrets.
2. Complete **S2** connector GOs one-by-one; prove end-to-end archive with `publishable: false`.
3. Implement/arm **live approved-feed HTTP import** (registry exists; fetch path not production-armed).
4. Staging burn-in with manual dispatch; then staging-only Worker cron with monitoring.
5. Production: separate migration deploy, publication two-key GO, and only then optional public delivery (`ADS_PUBLIC_DELIVERY_ENABLED`).

## Emergency stop (staging or prod)

Revoke PAT/IMAP, set all `IU_CJ_*_OFFLINE=1`, disable any cron, delete Worker triggers, confirm `ADS_PUBLIC_DELIVERY_ENABLED=false` and signing/trusted adapter off.

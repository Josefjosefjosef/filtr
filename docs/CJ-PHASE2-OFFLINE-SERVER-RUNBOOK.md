# CJ Phase 2 — offline server runbook (NOT activated)

Planning and offline verification only. **No production cron, live IMAP, live CJ HTTP, D1 migrations on production, signing, or trusted adapter** without explicit operator GO.

Mailbox target (future): `affiliate@infouzel.cz` (FORPSI IMAP). Publisher CID `7991692`, Website PID `101883843` (identity checks only — not proof of live linkage).

## Audit matrix (main @ post #12123 / #12124)

| Area | Status | Notes |
|------|--------|--------|
| FORPSI mock IMAP/MIME ingest | **HOTOVO** | `iu-cj-affiliate-phase2-forpsi-*`, fixtures, prompt/spoof quarantine |
| GitHub Actions offline ingest | **HOTOVO** | `iu-cj-affiliate-phase2-github-actions-ingest-*`, multi-gate live block |
| Mock D1 + CJ ingest worker (staging) | **HOTOVO** | `cloudflare/cj-email-ingest-d1-worker`, local/wrangler selftests |
| Normalization / central offer model | **HOTOVO** | v29 registry, conflict v19, identity keys |
| Deduplication / UID completion | **HOTOVO** | D1 completed UIDs, content hash, lifecycle hooks |
| Conflicting sources | **HOTOVO** | Fail-closed reconcile; no weaker overwrite |
| Partner permission / publication gates | **HOTOVO** | `banner-permission-lib`, `publication-gates`, archive negative tests |
| Production safety switches | **HOTOVO** | `PRODUCTION_SIGNING_ENABLED=false`, `ADS_PUBLIC_DELIVERY_ENABLED=false`, trusted adapter off |
| Unattended lock + audit JSONL | **HOTOVO** | `unattended-import-cycle-lib-v1` |
| Approved product feed registry (offline) | **HOTOVO** | `iu-cj-affiliate-phase2-approved-product-feed-lib.mjs` + fixture |
| CJ GraphQL response parsing | **HOTOVO** | `parseShoppingProductsGraphqlResponse` (`res.json.data`, not legacy `res.data`) |
| SSRF / private IP feed & landing guards | **HOTOVO** | `offer-landing-lib`, approved feed URL audit |
| Variant identity (`309152_1` vs `309152_2`) | **HOTOVO** | `offer-landing-selftest` |
| Live FORPSI IMAP TLS connect | **ČÁSTEČNĚ** | Adapter ready; blocked until secrets + `IU_FORPSI_IMAP_CONNECT_APPROVED=1` |
| Live CJ API HTTP execute | **ČÁSTEČNĚ** | `cj-api-adapter`; requires PAT + `IU_CJ_CJ_API_HTTP_EXECUTE=1` |
| Live approved feed HTTP import | **CHYBÍ** | Registry + gates only; fetch/import path not armed |
| Production D1 worker deploy + remote migrations | **BLOKOVÁNO** | Staging wrangler only; operator GO required |
| Production cron / 24×7 scheduler | **BLOKOVÁNO** | Workflows are `workflow_dispatch` only in this phase |
| Public offer publish from ingest | **BLOKOVÁNO** | All pipelines force `publishable: false` |

## Offline stack (run locally or CI)

```text
node scripts/iu-cj-affiliate-phase2-offline-full-stack-v1-selftest.mjs
```

Orchestrates FORPSI mock ingest, GitHub Actions pipeline, unattended cycle, publication/security negatives, catalog GraphQL, landing/variant guards, approved feed registry audit.

## GitHub Actions (offline)

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `cj-affiliate-offline-import-dispatch.yml` | `workflow_dispatch` | Full-stack selftest + unattended runner |
| `cj-affiliate-email-ingest.yml` | `workflow_dispatch` | Mock email ingest runner (+ optional FORPSI mock cycle) |

**No `schedule` cron** until explicit production GO.

## Live activation checklist (requires explicit GO)

1. Secrets (never in repo): `IU_CJ_PAT`, `IU_CJ_PUBLISHER_CID`, `IU_CJ_WEBSITE_PID`, `IU_FORPSI_IMAP_USER`, `IU_FORPSI_IMAP_SECRET`, `IU_CJ_D1_WORKER_INGEST_TOKEN`.
2. Multi-gate live ingest: `IU_CJ_LIVE_INGEST_APPROVED=1`, `IU_FORPSI_IMAP_CONNECT_APPROVED=1`, `IU_CJ_D1_BACKEND=worker`, worker URL + token; unset offline/dry-run flags.
3. CJ API (optional arm): `IU_CJ_CJ_API_ENABLED=1`, `IU_CJ_CJ_API_HTTP_EXECUTE=1`.
4. Approved feeds (optional arm): `IU_CJ_APPROVED_FEED_HTTP_EXECUTE=1` + registry entries updated per partner.
5. Scheduler: add cron only after staging burn-in; monitor lock contention and 401/403/429/ zero-feed alerts.
6. Publication: separate GO for `PRODUCTION_SIGNING_ENABLED` and `ARCHIVE_TRUSTED_PUBLICATION_ADAPTER_ENABLED`.
7. Rollback: disable workflows schedule, revoke PAT/IMAP, set `IU_CJ_*_OFFLINE=1`, keep `ADS_PUBLIC_DELIVERY_ENABLED=false`.

## Emergency stop

Set: `IU_CJ_EMAIL_INGEST_OFFLINE=1`, `IU_CJ_UNATTENDED_IMPORT_OFFLINE=1`, disable workflow schedules, revoke secrets, confirm `PRODUCTION_SIGNING_ENABLED=false` and trusted adapter disabled.

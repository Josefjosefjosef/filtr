# InfoUzel Analytics Architecture

## Purpose

Own, serverless, privacy-conservative analytics for InfoUzel.cz.

- No Google Analytics / GTM / Meta Pixel / Clarity / Hotjar / Plausible / Matomo Cloud
- No user profiles, no fingerprinting, no long-lived user IDs
- No IP stored in the analytics database
- No full User-Agent stored
- No private module content (Silver, notes, calendar, finance, documents, Datovka, Bakaláři, health insurer)
- Aggregate statistics only
- Dynamic advertising measurement (campaign / placement / section / slot_type) without fixed banner slots

## Hosting reality

| Layer | Technology |
|-------|------------|
| Source | GitHub (`Josefjosefjosef/filtr`) |
| CI/CD | GitHub Actions |
| Website hosting | **GitHub Pages** |
| Analytics backend | **Cloudflare Workers** |
| Aggregate DB (source of truth) | **Cloudflare D1** (`iu-analytics`, binding `DB`) |
| Public response cache | HTTP `Cache-Control` on `GET /v1/public/stats` (~60s) only |
| Admin / ads APIs | `Cache-Control: no-store` |

Cloudflare Cache API and Workers KV are **not** used as durable aggregate stores.  
Cache-as-database and KV-as-database fallbacks were removed after cutover.

### D1 cutover

- Previous probe/test aggregates lived only in ephemeral Cache API colos.
- Those values are **not** migrated into D1 (not reliable historical truth).
- D1 starts clean from the production cutover deploy that first reports `storageMode: "d1"`.
- Days are stored as **UTC** calendar dates (`YYYY-MM-DD`). Public dashboard uses the same day keys (no local TZ rewrite in v1).

## Data flow

```
Frontend (assets/iu-analytics-client.js)
  → Consent Guard (assets/iu-consent.js; default denied)
  → Analytics Guard (client allowlist + no PII keys)
  → Cloudflare Worker POST /v1/ingest
  → Privacy Guard (server allowlist, crawler reject, forbidden keys)
  → Anti Fraud Guard (burst heuristics; no IP persistence)
  → Aggregation → Cloudflare D1 (atomic UPSERT counters)
  → GET /v1/public/stats (optional short HTTP cache) → public dashboard
  → GET /v1/admin/overview + /v1/ads/report → admin / advertiser reports (no-store)
```

## Schema & migrations

Versioned SQL: `cloudflare/iu-analytics/migrations/0001_init.sql`

Tables (aggregate only):

- `daily_traffic` — visits / page_views / public_section_views / private_tools_opens / pwa_installs by day + device
- `daily_sections` — public section views
- `daily_ads` — dynamic campaign/placement/section/slot/device counters + valid/suspicious clicks
- `daily_performance` — anonymous metric sums
- `daily_errors` — allowlisted error_code counts
- `ingest_audit` — accepted / rejected / suspicious counts
- `campaign_meta` — optional advertiser labels (admin only; never on public page)
- `storage_meta` — cutover markers

Indexes cover day ranges, campaign/placement/section filters, and section popularity.

## Health & D1 failure mode

`GET /health` returns `storageMode: "d1"` and `ok: true` only after a live `SELECT 1` against the bound D1 database.

If the D1 binding is missing or unreachable:

- health → `503`, `storageMode: "unavailable"`
- ingest / public / admin → `503` (no silent Cache fallback as a database)

## APIs

| API | Path | Auth | Cache |
|-----|------|------|-------|
| Health | `GET /health` | none | none |
| Ingest | `POST /v1/ingest` | none (consent client-side; server validates) | no-store |
| Public stats | `GET /v1/public/stats` | none | public, ~60s HTTP only |
| Admin overview | `GET /v1/admin/overview` | Bearer `ADMIN_TOKEN` | no-store |
| Ad reporting | `GET /v1/ads/report` | Bearer `ADMIN_TOKEN` | no-store |

### Test ad campaigns

Campaign IDs matching the prefix `test_` / `test-` / `test.` (e.g. `test_verify_c1`) are **verification-only**.

- Default `GET /v1/ads/report` (no `campaign_id`) **excludes** them from rows and business totals.
- Explicit `campaign_id=test_…` still returns that verification campaign for audit.
- `include_test=1` includes all campaigns (including test prefixes) in an unfiltered report.
- Public stats never expose ad campaigns.

### CTR

`ctr = valid_clicks / impressions` as a **ratio** in `[0, 1]` (four decimal places).  
UI may display it as a percentage by multiplying by 100. Division by zero → `0`.

## Allowlisted events

`page_view`, `public_section_view`, `private_tools_total_open`, `pwa_install`, `ad_impression`, `ad_click`, `performance_metric`, `technical_error`

### PWA install metric (`pwa_install`)

Anonymous aggregate of recorded PWA install signals:

- Chromium / supporting browsers: `appinstalled`
- iOS / platforms without install event: first recorded launch in `display-mode: standalone` (or compatible standalone fallback)
- Client sets local once-marker (`iu_pwa_install_counted_v1`) only after successful ingest ACK
- Does **not** increment visits, page_views, public sections, or private tools
- No fingerprint, persistent device ID, IP storage, or personal content

Ad fields only: `campaign_id`, `placement_id`, `section_id`, `slot_type`, `device_category`, `day`

## Dynamic ads model

Tables are keyed by free-form `campaign_id` + `placement_id` (+ section/slot/device/day).  
Adding a new placement does **not** require schema or architecture changes.

## Privacy & legal posture

- Consent voluntary, informed, withdrawable; not a condition of using the site
- Default: analytics denied
- Revocation immediately stops client emit (`iuAnalyticsTeardown`) and clears the outbound queue
- IP may exist transiently in Cloudflare edge logs (infrastructure), but is **never written to D1**
- Public dashboard never shows campaign commercial detail
- Audits section shows honest “Čeká na dokončení.” until real audits exist
- Admin token: Worker secret + optional browser `sessionStorage` only (never localStorage / URL / repo)

## Deploy

```text
cloudflare/iu-analytics/
.github/workflows/deploy-iu-analytics.yml
```

Required secret: `CLOUDFLARE_API_TOKEN` with **Account → D1 → Edit** and **Workers Scripts → Edit**.  
Account API tokens that cannot call User `/memberships` require `account_id` in `wrangler.toml` (and `CLOUDFLARE_ACCOUNT_ID` in CI).  
Optional override: `CLOUDFLARE_D1_API_TOKEN`.  
Optional: `IU_ANALYTICS_ADMIN_TOKEN` → Worker secret `ADMIN_TOKEN`.

Deploy steps: create/list D1 `iu-analytics` → apply migrations → deploy Worker → probe `storageMode=d1` + ingest roundtrip.

## Frontend surfaces

- Public: `/projects/statistiky/`
- Admin: `/projects/statistiky/admin/`
- InfoCentrum tile: Statistiky a transparentnost
- Client: `/assets/iu-analytics-client.js` (after consent module)
- Client flush prefers `navigator.sendBeacon`; if it returns `false` or throws, falls back to `fetch` so events are not silently dropped
- Worker CORS echoes a concrete `Access-Control-Allow-Origin` and sets `Access-Control-Allow-Credentials: true` (required for `sendBeacon` + `application/json` preflight)
- Service Worker must not intercept cross-origin Analytics ingest (`sw.js` passthrough) so the Worker receives the page User-Agent (crawler guard)

## Guards & tests

- `scripts/iu-analytics-privacy-guard.mjs` — static + behavioral privacy contracts
- `scripts/iu-analytics-consent-e2e.mjs` — production consent grant/revoke E2E (Playwright)
- Worker unit tests: `cloudflare/iu-analytics/test/*.test.ts` (privacy + D1 store mock)

## Out of scope (protected)

Does not modify the info-events aggregator (`projects/data/info_events/**`, `scripts/iu-info-events-*`, `assets/iu-prehled*`, `assets/iu-info-system*`, PR #7617).

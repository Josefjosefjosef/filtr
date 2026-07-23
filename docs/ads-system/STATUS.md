# InfoUzel Ads — implementation STATUS

**Current stage:** Etapa 1 **DONE** · Etapa 2 **DONE** (#7684) · Etapa 3 **DONE** (#7687) · Etapa 4 **DONE** (#7689) · Etapa 5 **DONE** (#7690) · Etapa 6 **DONE** (#7693) · Etapa 7 **DONE** (#7695) · Etapa 8 in progress (admin ops)  
**Safe mode:** ON · Public delivery: OFF · Admin API default: OFF · Client API default: OFF  

## Etapa 1 closeout

| Item | Value |
|------|-------|
| PR | [#7680](https://github.com/Josefjosefjosef/filtr/pull/7680) **MERGED** |
| Merge commit | `4cb14e47b9c822b18be254af67bef9a5d04e67c3` |
| Smoke | `29971819226` SUCCESS |
| Deploy (main push) | `29974385373` SUCCESS |
| Data Bot pause | **not needed** (auto-merge completed; bots left active) |

### Production proof

- D1 `iu-ads` · `storageMode=d1` · `schemaVersion=0002`
- R2: `iu-ads-creatives` + `iu-ads-documents` bound (`r2.ready=true`)
- `privateDocumentsPublicUrl=false`
- `safeMode=true` · `publicDeliveryEnabled=false`
- `/v1/objects/get` HMAC active (`access_denied`, not public URL)
- `/v1/public/ads/delivery` → empty fail-closed
- Analytics healthy · PR #7617 OID unchanged · `stash@{0}` preserved

Report: `docs/ads-system/ETAPA-1-REPORT.md`

## Etapa 2 closeout

- PR [#7684](https://github.com/Josefjosefjosef/filtr/pull/7684) **MERGED** (auth/RBAC/audit) — `0211570590`
- Schema `0003`: admin auth/session/lockout tunables

## Etapa 3 closeout — business + documents

- PR [#7687](https://github.com/Josefjosefjosef/filtr/pull/7687) **MERGED** — `a863f7921f`
- Migration `0004_business_documents.sql`: indexes + `system_settings` only (tables already in `0001`); `schemaVersion` → `0004`
- RBAC extended: `documents.*`, `rights.*`, `complaints.*`, `exports.*`, `finance.read`; `sales` gets `invoices.write`; `read_only` gets all new `*.read`
- New modules: `admin-clients.ts`, `admin-inquiries.ts` (+ inquiry→order convert), `admin-orders.ts`, `admin-contracts.ts`, `admin-invoices.ts`, `admin-documents.ts`, `admin-rights.ts`, `admin-complaints.ts`, `admin-exports.ts` (stub jobs, `status: "queued"`), `admin-finance.ts`, `visibility.ts`
- Documents: upload validated via `r2-security.ts` into `DOCUMENTS` bucket; access always a short-lived signed path (`visibility.ts` → `signed-access.ts`) — **never** a permanent public R2 URL, including `visibility: "public"`
- Tests: 71 passing across 10 files

## Etapa 4 closeout — campaigns/placements/creatives

- PR [#7689](https://github.com/Josefjosefjosef/filtr/pull/7689) **MERGED** — `ba8c970adf`
- Migration `0005_campaigns_placements.sql`: indexes + `placement_types` seed (4 catalog entries) + `system_settings` only (tables already in `0001`); `schemaVersion` → `0005`
- New: `campaign-state.ts` (status state machine + `campaign_status_events`), `collision.ts` (exclusive-reservation overlap detection), `url-safety.ts` (rejects `javascript:`/`data:`/unsafe schemes for `target_url`)
- RBAC extended: `ads_manager` gains `campaigns.activate` (gate for approved/scheduled/active transitions); `sales` still lacks `campaigns.write`, so it cannot transition or activate any campaign
- New modules: `admin-campaigns.ts` (CRUD + `POST /v1/admin/campaigns/:id/transition`, blocks entry to `active` without a `rights_confirmations` row → `409`), `admin-placements.ts` (placement-types catalog + per-campaign placements), `admin-reservations.ts` (collision-checked reservations, `409 reservation_collision`), `admin-creatives.ts` (upload via `r2-security.ts` into `CREATIVES`, approve/reject, signed `/access`), `admin-preview.ts` (`POST /v1/admin/preview`, zero DB side-effects, `published:false`)
- Tests: 123 passing (was 71) across 17 files
- Not yet done: UI, delivery/serving pipeline (public delivery stays OFF), pacing/billing/analytics tie-in (later etapy)

## Etapa 5 closeout — public delivery engine

- PR [#7690](https://github.com/Josefjosefjosef/filtr/pull/7690) **MERGED** — `d4341b0547`
- Migration `0006_public_delivery.sql`: indexes + `system_settings` only (tables already in `0001`); `schemaVersion` → `0006`
- New: `delivery-engine.ts` (`selectPublicAds` — real selection: active campaign/placement + approved creative, device/section filters, exclusive-placement dedupe, signed never-permanent `cdn_url`, allowlist-only shape), `scheduler.ts` (`runAutoScheduler` — auto `scheduled→active`/`active→ended` by `start_at`/`end_at`, fail-closed on missing rights confirmation, callable from the delivery path)
- Wired: `GET /v1/public/ads/delivery` now calls the real engine only when `isPublicDeliveryActive(flags)` is true (unchanged: `ADS_PUBLIC_DELIVERY_ENABLED=true` **and** `ADS_SAFE_MODE=false`); every other path still returns `emptyPublicDelivery` (fail-closed, `{"ads":[],"enabled":false,"safeMode":true}` with current wrangler defaults)
- New `system_settings`: `EMERGENCY_PAUSE_ALL` (kill-switch → `ads:[]` regardless of flags, fail-closed if unreadable), `PUBLIC_DELIVERY_CACHE_TTL_SECONDS` (signed creative URL TTL), `ADS_LABEL_DEFAULT` (fallback disclosure label)
- **Wrangler defaults unchanged**: `ADS_SAFE_MODE=true`, `ADS_PUBLIC_DELIVERY_ENABLED=false`, `ADS_ADMIN_API_ENABLED=false`, `ADS_CLIENT_API_ENABLED=false` — this PR ships the engine with production delivery still fully OFF
- Tests: 34 new (7 `test/scheduler.test.ts` + 22 `test/delivery-engine.test.ts` + 5 `test/public-delivery-route.test.ts`) → 157 passing total (was 123)

### Known gap — frontend inject not yet wired (kap. 1/9)

`selectPublicAds`/`GET /v1/public/ads/delivery` exist and are fail-closed, but **no public-site client
exists yet** that calls this endpoint and injects a component (checked: no `assets/iu-ads*.js`, no
reference to `/v1/public/ads/delivery` or `infouzel-ads` anywhere under `assets/` or `projects/`).
Since `ADS_PUBLIC_DELIVERY_ENABLED=false` in production, this has **zero user-facing impact today**
(no ads are shown either way). A separate tiny PR (`feat/ads-system-etapa-5b-frontend-inject`) is the
right vehicle for this — it touches `assets/`/`projects/index.html`, which are exactly the paths the
after-merge STOP-SHIP guard flags for extra scrutiny, and the full UI smoke suite (`layout-guard` +
dozens of Playwright guards) has a materially higher flake/duration profile than the Worker-only
changes shipped so far. Gap remains **deferred**.

## Etapa 6 closeout — measurement/reporting

- PR [#7693](https://github.com/Josefjosefjosef/filtr/pull/7693) **MERGED** (replaced stuck #7692) — `34949264a8`
- Migration `0007_measurement_settings.sql`: `system_settings` only (no new tables — impression/click
  aggregates remain exclusively on the Analytics Worker's `daily_ads`, never mirrored into `iu-ads`);
  `schemaVersion` → `0007`
- New: `analytics-client.ts` (`fetchAdsReport`), `admin-stats.ts` (`GET /v1/admin/stats/summary`,
  `GET /v1/admin/stats/campaigns/:id`) — RBAC `stats.read`; allowlist rebuild; test campaigns excluded
- **Production proof (post-merge Deploy IU Ads SUCCESS):** `schemaVersion=0007`, `safeMode=true`,
  `publicDeliveryEnabled=false`, `clientApiEnabled=false`
- Tests: 19 new → 176 passing total (was 157)
- **Wrangler defaults unchanged** (fail-closed); `ANALYTICS_ADMIN_REPORT_URL` ships empty

## Etapa 7 closeout — client codes + portal

- PR [#7695](https://github.com/Josefjosefjosef/filtr/pull/7695) **MERGED** — `f909f7b7d40a46068d1e03f64baa5c0decce5c0d`
- Migration `0008_client_codes.sql`: `client_login_attempts` table (not in `0001`) + indexes on
  existing `client_access_codes` / `client_code_campaigns` / `client_sessions` + client session/lockout
  tunables; `schemaVersion` → `0008`. No analytics tables.
- New: `admin-codes.ts` (issue/list/regen/revoke — hash-only SHA-256+`ADS_CODE_PEPPER`, plaintext
  once at issue/regen, scope via `client_code_campaigns`, audit redacted), `client-auth.ts` (code →
  RO session, brute-force prefix lockout, uniform errors, cookie HMAC `ADS_CLIENT_SESSION_SECRET`),
  `client-report.ts` (scoped JSON report + CSV export stub; `client_visible` documents only;
  analytics allowlist join when configured)
- RBAC: `ads_manager` gains `codes.read`/`codes.write` (matrix kap. 36)
- Wired: `/v1/admin/codes*`, `/v1/client/auth/*`, `/v1/client/report`, `/v1/client/report/export`;
  health `schemaVersion: "0008"` + existing `clientApiEnabled` flag
- **Production proof (post-merge Deploy IU Ads SUCCESS):** `schemaVersion=0008`, `safeMode=true`,
  `publicDeliveryEnabled=false`, `adminApiEnabled=false`, `clientApiEnabled=false`
- Tests: 12 new in `test/client-portal.test.ts` (+ rbac assertion) → **189** passing total (was 176)
- **Wrangler defaults unchanged**: `ADS_CLIENT_API_ENABLED=false` (and safe/public/admin flags still
  fail-closed) — client portal ships dark until secrets + flag flipped out-of-band

### Known gap — client portal frontend UI (kap. 36–38 UI)

Worker API for codes + RO portal report exists and is fail-closed, but **no InfoCentrum / client
portal HTML/JS** is included (explicit Worker-only preference, same pattern as Etapa 5
frontend inject gap). PDF export and `client_report_snapshots` persistence (38.13) are also deferred.
A later UI PR can consume these endpoints once `ADS_CLIENT_API_ENABLED` is enabled in a non-prod
environment.

## Etapa 8 — admin ops (kap. 5, 6, 16–19) — in progress

- Migration `0009_admin_ops.sql`: alert indexes + tunables only (`alerts` already in `0001`);
  `schemaVersion` → `0009`
- New: `admin-nav.ts`, `admin-dashboard.ts`, `admin-search.ts`, `admin-calendar.ts`,
  `admin-alerts.ts`, `admin-list-filters.ts`; minimal Worker shell `GET /admin`
- RBAC: `alerts.read` / `alerts.write` (main_admin/ads_manager/sales write; read_only read)
- List filter consistency: `q` on campaigns/documents/invoices; `status`/`from`/`to` on reservations
- **Wrangler defaults unchanged** (SAFE_MODE / public / admin / client all fail-closed)
- Tests: 14 new in `test/admin-ops.test.ts` (+ rbac/isolation) → **205** passing
- Cron for alert generate deferred to Etapa 9 (`POST /v1/admin/alerts/generate` is on-demand)

### Known gap — public-site admin UI (kap. 5/6 UI)

Worker APIs + minimal `/admin` shell ship in this etapa. Full InfoUzel public-site admin HTML/JS
(under `assets/` / `projects/index.html`) is **deferred** — same STOP-SHIP / UI-smoke risk pattern
as E5 inject and E7 portal UI.

## Stage checklist

| Etapa | Stav |
|-------|------|
| 0 | done |
| 1 | **done** (#7680 → `4cb14e47b9`) |
| 2 | **done** (#7684 → `0211570590`) — auth/RBAC/audit |
| 3 | **done** (#7687 → `a863f7921f`) — business/documents |
| 4 | **done** (#7689 → `ba8c970adf`) — campaigns/placements/creatives |
| 5 | **done** (#7690 → `d4341b0547`) — public delivery engine (flags still OFF; frontend inject gap documented above) |
| 6 | **done** (#7693 → `34949264a8`) — measurement/reporting (prod `schemaVersion=0007`) |
| 7 | **done** (#7695 → `f909f7b7d4`) — client codes + portal API (prod `schemaVersion=0008`) |
| 8 | in progress — admin ops APIs (nav/dashboard/search/calendar/alerts) |
| 9 | pending — backup/security/E2E closeout (do **not** flip production ads ON) |

## Guards

- PR #7617 OID `9be3e372…` OPEN unchanged
- `stash@{0}` `iu-v3-wip-unrelated-cnb` preserved
- Data Bot workflows remain **active**

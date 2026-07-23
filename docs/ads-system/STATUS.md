# InfoUzel Ads — implementation STATUS

**Current stage:** Etapa 1 **DONE** · Etapa 2 **DONE** (#7684 merged) · Etapa 3 **DONE** (#7687 merged) · Etapa 4 **DONE** (#7689 merged) · Etapa 5 in progress (public delivery engine)  
**Safe mode:** ON · Public delivery: OFF · Admin API default: OFF  

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

## Etapa 5 — public delivery engine (in progress)

- Migration `0006_public_delivery.sql`: indexes + `system_settings` only (tables already in `0001`); `schemaVersion` → `0006`
- New: `delivery-engine.ts` (`selectPublicAds` — real selection: active campaign/placement + approved creative, device/section filters, exclusive-placement dedupe, signed never-permanent `cdn_url`, allowlist-only shape), `scheduler.ts` (`runAutoScheduler` — auto `scheduled→active`/`active→ended` by `start_at`/`end_at`, fail-closed on missing rights confirmation, callable from the delivery path)
- Wired: `GET /v1/public/ads/delivery` now calls the real engine only when `isPublicDeliveryActive(flags)` is true (unchanged: `ADS_PUBLIC_DELIVERY_ENABLED=true` **and** `ADS_SAFE_MODE=false`); every other path still returns `emptyPublicDelivery` (fail-closed, `{"ads":[],"enabled":false,"safeMode":true}` with current wrangler defaults)
- New `system_settings`: `EMERGENCY_PAUSE_ALL` (kill-switch → `ads:[]` regardless of flags, fail-closed if unreadable), `PUBLIC_DELIVERY_CACHE_TTL_SECONDS` (signed creative URL TTL), `ADS_LABEL_DEFAULT` (fallback disclosure label)
- **Wrangler defaults unchanged**: `ADS_SAFE_MODE=true`, `ADS_PUBLIC_DELIVERY_ENABLED=false`, `ADS_ADMIN_API_ENABLED=false`, `ADS_CLIENT_API_ENABLED=false` — this PR ships the engine with production delivery still fully OFF
- Tests: 34 new (7 `test/scheduler.test.ts` + 22 `test/delivery-engine.test.ts` + 5 `test/public-delivery-route.test.ts`) → 157 passing total (was 123)
- Not yet done: frontend inject (kap. 1 "bez prázdných boxů" UI wiring), Cron Trigger for the scheduler (currently request-driven only), impression/click limits enforcement, personalized ads (explicitly out of scope — `PERSONALIZED_ADS=NO` unchanged)

## Stage checklist

| Etapa | Stav |
|-------|------|
| 0 | done |
| 1 | **done** (#7680 → `4cb14e47b9`) |
| 2 | **done** (#7684 → `0211570590`) — auth/RBAC/audit |
| 3 | **done** (#7687 → `a863f7921f`) — business/documents |
| 4 | **done** (#7689 → `ba8c970adf`) — campaigns/placements/creatives |
| 5 | in progress — public delivery engine (flags still OFF) |
| 6–9 | pending |

## Guards

- PR #7617 OID `9be3e372…` OPEN unchanged
- `stash@{0}` `iu-v3-wip-unrelated-cnb` preserved
- Data Bot workflows remain **active**

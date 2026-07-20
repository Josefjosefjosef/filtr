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
| Website hosting | **GitHub Pages** (existing production) |
| Analytics backend | **Cloudflare Workers** |
| Aggregate DB | **Cloudflare D1** |
| Public stats cache | Cloudflare Cache / `Cache-Control` on `/v1/public/stats` |

The product site remains on GitHub Pages. Cloudflare Pages is not required for this phase; Workers+D1 provide the serverless analytics backend that scales independently.

## Data flow

```
Frontend (assets/iu-analytics-client.js)
  → Consent Guard (assets/iu-consent.js; default denied)
  → Analytics Guard (client allowlist + no PII keys)
  → Cloudflare Worker POST /v1/ingest
  → Privacy Guard (server allowlist, crawler reject, forbidden keys)
  → Anti Fraud Guard (burst heuristics; no IP persistence)
  → Aggregation → Cloudflare D1
  → GET /v1/public/stats → public dashboard
  → GET /v1/admin/overview + /v1/ads/report → admin / advertiser reports
```

## APIs

| API | Path | Auth | Cache |
|-----|------|------|-------|
| Health | `GET /health` | none | none |
| Ingest | `POST /v1/ingest` | none (consent enforced client-side; server validates payload) | no-store |
| Public stats | `GET /v1/public/stats` | none | public, ~300s |
| Admin overview | `GET /v1/admin/overview` | Bearer `ADMIN_TOKEN` | no-store |
| Ad reporting | `GET /v1/ads/report` | Bearer `ADMIN_TOKEN` | no-store |

## Allowlisted events

`page_view`, `public_section_view`, `private_tools_total_open`, `ad_impression`, `ad_click`, `performance_metric`, `technical_error`

Ad fields only: `campaign_id`, `placement_id`, `section_id`, `slot_type`, `device_category`, `day`

## Dynamic ads model

Tables are keyed by free-form `campaign_id` + `placement_id` (+ section/slot/device/day).  
Adding a new placement does **not** require schema or architecture changes.  
Supported slot_type vocabulary includes banner, sponsored_article, native, video, partner_box, recommended, affiliate, premium_partnership, other.

## Privacy & legal posture

- Consent voluntary, informed, withdrawable; not a condition of using the site
- Default: analytics denied
- Revocation immediately stops client emit (`iuAnalyticsTeardown`)
- IP may exist transiently in Cloudflare edge logs (infrastructure), but is **never written to D1**
- Any future IP-hash anti-abuse mechanism must be separate, disabled, and legally reviewed first
- Public dashboard never shows campaign commercial detail
- Audits section shows honest “Čeká na dokončení.” until real audits exist

## Scale target

Worker + D1 aggregate upserts are designed for 100k–1M daily visits without architecture change. Horizontal scaling is Cloudflare’s; write path is O(1) upserts per event type.

## Deploy

```text
cloudflare/iu-analytics/
.github/workflows/deploy-iu-analytics.yml
```

Secrets: `CLOUDFLARE_API_TOKEN`, worker secret `ADMIN_TOKEN`.

## Frontend surfaces

- Public: `/projects/statistiky/`
- Admin: `/projects/statistiky/admin/`
- InfoCentrum tile: Statistiky a transparentnost
- Consent layer / privacy settings link to public stats
- Client: `/assets/iu-analytics-client.js` (loaded after consent module)

## Guards

- `scripts/iu-analytics-privacy-guard.mjs` — static + behavioral privacy contracts
- Worker unit tests: `cloudflare/iu-analytics/test/privacy.test.ts`

## Out of scope (protected)

Does not modify the info-events aggregator (`projects/data/info_events/**`, `scripts/iu-info-events-*`, `assets/iu-prehled*`, `assets/iu-info-system*`).

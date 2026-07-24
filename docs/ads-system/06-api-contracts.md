# API contracts — InfoUzel Ads

Base Worker: `infouzel-ads` (Cloudflare Worker).  
Všechny mutující/admin/client endpointy: `Cache-Control: no-store`.

## Surface separation (kap. 40)

| Surface | Prefix | Auth | Mutace |
|---------|--------|------|--------|
| Health | `/health` | none | no |
| Public Ad Delivery | `/v1/public/ads/*` | none (context params only) | no |
| Admin Auth | `/v1/admin/auth/*` | credentials / session | limited |
| Admin API | `/v1/admin/*` | admin session + RBAC | yes |
| Client Auth | `/v1/client/auth/*` | access code | limited |
| Client Report | `/v1/client/*` | client RO session | no (read-only) |
| Analytics | `infouzel-analytics` | stávající | ingest only |

**Cross-reject:** client token na Admin = fail; admin session jako client code = fail.

## Public Ad Delivery (allowlist response)

```json
{
  "ads": [
    {
      "campaign_id": "string",
      "placement_id": "string",
      "section_id": "string",
      "slot_type": "string",
      "device_category": "pc|mobile|tablet",
      "label": "Reklama|Inzerce|Sponzorováno|Placený obsah|Komerční sdělení",
      "creative": {
        "format": "image",
        "width": 0,
        "height": 0,
        "cdn_url": "https://..."
      },
      "target_url": "https://...",
      "anchor": "string"
    }
  ]
}
```

Zakázaná pole ve Public response: price*, contact*, email, phone, document*, client_code*, internal_*, ico, dic, invoice*.

Prázdný výsledek = `{"ads":[]}` — frontend **nevkládá** box.

Query parametry (Etapa 5): `?device=pc|mobile|tablet` (bez platné hodnoty → `ads:[]`, žádný 400) a volitelně
`?section=<section_id>`. Umístění bez `section_id` (globální — header/sidebar) se vrací nezávisle na
`section`; umístění se zadaným `section_id` se vrací jen při shodě.

## Client Report (read-only)

Vrací pouze kampaně ve scope `client_code_campaigns` + dokumenty s `visibility` ∈
{`client_visible`,`public`}. Nikdy: price*, email, phone, `note_internal`, `code_hash`/`access_code`,
`r2_key`, ico/dic.

## Etapa 7 — Client codes + portal (kap. 36–38)

### Admin codes

Gate: `ADS_ADMIN_API_ENABLED` + admin session secrets (stejné jako Etapa 2–6) + RBAC
`codes.read`/`codes.write` (`main_admin`/`ads_manager`; `read_only` jen read; `sales` nemá).
Pro issue/regen také `ADS_CODE_PEPPER`. Hash: deterministické SHA-256(pepper\|code) — plaintext
jen v response issue/regen, nikdy v DB ani audit.

| Route | Method | Perm | Notes |
|-------|--------|------|-------|
| `/v1/admin/codes` | GET | `codes.read` | Filtr `?client_id=`, `?status=active\|revoked\|expired`; bez plaintext |
| `/v1/admin/codes` | POST | `codes.write` | Body: `client_id`, `campaign_ids[]`, volitelně `expires_at`; response `{code, access_code}` (plaintext jednou) |
| `/v1/admin/codes/:id` | GET | `codes.read` | Metadata + `campaign_ids` |
| `/v1/admin/codes/:id/regen` | POST | `codes.write` | Revokuje starý kód (+ sessions), vydá nový plaintext jednou |
| `/v1/admin/codes/:id/revoke` | POST | `codes.write` | `status=revoked`, revokuje sessions; `409 already_revoked` |

### Client auth

Gate: `ADS_CLIENT_API_ENABLED` **and** `ADS_CLIENT_SESSION_SECRET` + `ADS_CODE_PEPPER`
(`503 auth_not_configured` / `client_api_disabled`). `safeMode` **neblokuje** client surface
(stejně jako Admin — safeMode jen Public Delivery). Cookie: `HttpOnly; Secure; SameSite=Strict`,
HMAC `ADS_CLIENT_SESSION_SECRET` (oddělený od admin secret → cross-token reject).

| Route | Method | Auth | Notes |
|-------|--------|------|-------|
| `/v1/client/auth/login` | POST | access code | Uniform `invalid_credentials`; brute-force lockout (`client_login_attempts`, prefix bucket); body `access_code` |
| `/v1/client/auth/logout` | POST | client session | Revokuje session, clear cookie |
| `/v1/client/auth/me` | GET | client session | `client_id` + `campaign_ids` scope |

**Cross-reject:** client cookie na `/v1/admin/*` = fail; admin cookie jako client session = fail;
admin token jako `access_code` = `invalid_credentials`.

### Client report

| Route | Method | Auth | Notes |
|-------|--------|------|-------|
| `/v1/client/report` | GET | client session | JSON report: scoped campaigns (client-visible fields), placements, creatives (bez `r2_key`), `client_visible`/`public` documents, analytics stats (allowlist) pokud nakonfigurováno; filtr `?campaign_id=` mimo scope → `403` |
| `/v1/client/report/export` | GET | client session | `?format=json\|csv` (PDF → `501 pdf_export_deferred`); respektuje `client_export_enabled` |

Snapshot persistence (`client_report_snapshots`, 38.13) a PDF export jsou **deferred** (Worker vrací
`snapshot.persisted=false`). Frontend client portal UI není v tomto PR — viz STATUS gap.

## Admin API

CRUD dle RBAC pro všechny entity z DB modelu. Každá mutace → `audit_logs`.

## Etapa 2 — Admin auth/users/roles/audit

Gate: `ADS_ADMIN_API_ENABLED` (feature flag) **and** `ADS_SESSION_SECRET` + `ADS_PASSWORD_PEPPER` present.
`safeMode` does **not** gate this surface (it only gates Public Ad Delivery) — see `03-security-threat-model.md`.
Missing secrets while the flag is on → `503 {"error":"auth_not_configured"}`.

| Route | Method | Auth | Perm | Notes |
|-------|--------|------|------|-------|
| `/v1/admin/auth/login` | POST | none (credentials) | — | Uniform `invalid_credentials`; brute-force lockout (`admin_login_attempts`) |
| `/v1/admin/auth/logout` | POST | session cookie | — | Revokes session, clears cookie |
| `/v1/admin/auth/me` | GET | session cookie | — | Returns user + roles |
| `/v1/admin/auth/password-reset/request` | POST | none | — | Always `{"ok":true}` (no enumeration); token delivery channel deferred |
| `/v1/admin/auth/password-reset/confirm` | POST | reset token | — | Consumes token once, revokes existing sessions |
| `/v1/admin/auth/password/change` | POST | session cookie | — | Requires current password |
| `/v1/admin/users` | GET/POST | session cookie | `users.read`/`users.write` | main_admin only |
| `/v1/admin/users/:id` | GET/PATCH | session cookie | `users.read`/`users.write` | main_admin only |
| `/v1/admin/users/:id/roles` | PUT | session cookie | `users.write` | Replaces role assignment set |
| `/v1/admin/roles` | GET | session cookie | `users.read` | Hardcoded role/permission catalog |
| `/v1/admin/audit` | GET | session cookie | `audit.read` | Filters: `object_type`, `object_id`, `actor_user_id`, `limit`, `offset` |
| `/v1/admin/audit/:id` | GET | session cookie | `audit.read` | Single entry |

Session cookie: `HttpOnly`, `Secure`, `SameSite=Strict`, HMAC-signed (`ADS_SESSION_SECRET`), name from
`system_settings.ADMIN_SESSION_COOKIE_NAME` (default `iu_ads_admin_session`).

## Etapa 3 — Business + documents

Gate: stejné jako Etapa 2 (`ADS_ADMIN_API_ENABLED` + `ADS_SESSION_SECRET`/`ADS_PASSWORD_PEPPER`).
Každá mutace → `audit_logs` (redigováno přes `audit.ts`). Session+RBAC guard: `requireAdminPermission` (`admin-auth.ts`).

| Route | Method | Perm | Notes |
|-------|--------|------|-------|
| `/v1/admin/clients` | GET/POST | `clients.read`/`clients.write` | Vyhledávání `?q=` na `company_name` |
| `/v1/admin/clients/:id` | GET/PATCH | `clients.read`/`clients.write` | GET vrací i `contacts[]` |
| `/v1/admin/clients/:id/contacts` | POST | `clients.write` | `is_primary` přepíná ostatní kontakty na false |
| `/v1/admin/clients/:id/contacts/:contactId` | PATCH/DELETE | `clients.write` | |
| `/v1/admin/inquiries` | GET/POST | `inquiries.read`/`inquiries.write` | Filtry: `status`, `client_id` |
| `/v1/admin/inquiries/:id` | GET/PATCH | `inquiries.read`/`inquiries.write` | Nelze PATCH po `converted` |
| `/v1/admin/inquiries/:id/convert` | POST | `inquiries.write` **and** `orders.write` | Vytvoří `orders` (status `draft`), poptávku označí `converted`; 409 pokud už converted, 400 pokud chybí `client_id` |
| `/v1/admin/orders` | GET/POST | `orders.read`/`orders.write` | |
| `/v1/admin/orders/:id` | GET/PATCH | `orders.read`/`orders.write` | |
| `/v1/admin/contracts` | GET/POST | `contracts.read`/`contracts.write` | `legal_verified` je samostatný flag — status sám o sobě nikdy neznačí právní finalitu |
| `/v1/admin/contracts/:id` | GET/PATCH | `contracts.read`/`contracts.write` | |
| `/v1/admin/invoices` | GET/POST | `invoices.read`/`invoices.write` | Etapa 3: `sales` nyní má i `invoices.write` |
| `/v1/admin/invoices/:id` | GET/PATCH | `invoices.read`/`invoices.write` | Částky jako `*_cents` integer |
| `/v1/admin/documents` | GET/POST | `documents.read`/`documents.write` | POST = JSON upload (`content_base64`), validace přes `r2-security.ts`; response **nikdy** neobsahuje `r2_key` |
| `/v1/admin/documents/:id` | GET/PATCH | `documents.read`/`documents.write` | PATCH: title/visibility/status/retention/client_can_download |
| `/v1/admin/documents/:id/access` | GET | `documents.read` | Vrací krátkodobou signed cestu (`/v1/objects/get?...`) — **nikdy** trvalou public R2 URL, i pro `visibility: public`; zapisuje `object_access_audit` |
| `/v1/admin/rights` | GET/POST | `rights.read`/`rights.write` | Autorská práva ke kampani (kap. 30) |
| `/v1/admin/rights/:id` | GET | `rights.read` | |
| `/v1/admin/complaints` | GET/POST | `complaints.read`/`complaints.write` | |
| `/v1/admin/complaints/:id` | GET/PATCH | `complaints.read`/`complaints.write` | |
| `/v1/admin/exports` | GET/POST | `exports.read`/`exports.write` | POST vytvoří job se `status: "queued"` (stub — reálné generování PDF/CSV/JSON je pozdější etapa) |
| `/v1/admin/exports/:id` | GET | `exports.read` | |
| `/v1/admin/finance/summary` | GET | `finance.read` | Agregace z `invoices` (`invoiced_cents`/`paid_cents`/`outstanding_cents` po měně); filtry `client_id`, `from`, `to` |

Dokument `visibility` (`internal_only`\|`client_visible`\|`public`) řídí jen **kdo** může vidět metadata/žádat o přístup —
vždy jde o krátkodobý signed přístup (`visibility.ts` → `signed-access.ts`), nikdy o permanentní public URL (viz `08-r2-plan.md`).

## Etapa 4 — Campaigns/placements/creatives

Gate: stejné jako Etapa 2/3 (`ADS_ADMIN_API_ENABLED` + `ADS_SESSION_SECRET`/`ADS_PASSWORD_PEPPER`). Public delivery
zůstává vypnuté (`ADS_PUBLIC_DELIVERY_ENABLED=false`) — tato etapa nepřipojuje žádný veřejný výstup.

| Route | Method | Perm | Notes |
|-------|--------|------|-------|
| `/v1/admin/campaigns` | GET/POST | `campaigns.read`/`campaigns.write` | POST vytvoří `status: "draft"`; `evidence_code` auto-generován pokud chybí; `target_url` validován přes `url-safety.ts` |
| `/v1/admin/campaigns/:id` | GET/PATCH | `campaigns.read`/`campaigns.write` | PATCH nikdy neumí měnit `status` (`use_transition_endpoint`) |
| `/v1/admin/campaigns/:id/transition` | POST | `campaigns.write` (+ `campaigns.activate` pro approved/scheduled/active) | State machine (`campaign-state.ts`); 409 `invalid_transition` mimo graf; 403 `campaigns_activate_required`; 409 `rights_confirmation_required` při vstupu do `active` bez `rights_confirmations`; zapisuje `campaign_status_events` |
| `/v1/admin/placement-types` | GET/POST | `placements.read`/`placements.write` | Katalog typů umístění (kap. 10) |
| `/v1/admin/placement-types/:id` | GET/PATCH | `placements.read`/`placements.write` | |
| `/v1/admin/campaigns/:id/placements` | GET/POST | `placements.read`/`placements.write` | Umístění konkrétní kampaně (`campaign_placements`) |
| `/v1/admin/campaigns/:id/placements/:placementId` | PATCH | `placements.write` | status/priority/window update |
| `/v1/admin/reservations` | GET/POST | `placements.read`/`placements.write` | POST kontroluje kolizi (`collision.ts`) proti `placement_types.collision_mode`; `exclusive` overlap → `409 reservation_collision` |
| `/v1/admin/reservations/:id` | GET | `placements.read` | |
| `/v1/admin/reservations/:id/cancel` | POST | `placements.write` | Uvolní okno (status → `cancelled`) |
| `/v1/admin/creatives` | GET/POST | `creatives.read`/`creatives.write` | POST = JSON upload (`content_base64`), validace přes `r2-security.ts` (purpose `creative`); response **nikdy** neobsahuje `r2_key`; `review_status` vždy začíná `pending` |
| `/v1/admin/creatives/:id` | GET | `creatives.read` | |
| `/v1/admin/creatives/:id/access` | GET | `creatives.read` | Krátkodobá signed cesta (`/v1/objects/get?bucket=CREATIVES&...`) — nikdy trvalá public R2 URL; zapisuje `object_access_audit` |
| `/v1/admin/creatives/:id/approve` | POST | `creatives.write` | Jen z `pending`; jinak `409 already_reviewed` |
| `/v1/admin/creatives/:id/reject` | POST | `creatives.write` | Jen z `pending`; volitelný `reason` |
| `/v1/admin/preview` | POST | `campaigns.read` | Náhled umístění/kreativy bez publikace (`published: false`); **žádný** DB zápis (žádný `audit_logs`/`object_access_audit` řádek) — kap. 21 |

`campaigns.activate` (kap. 4/7/13): drží ho `main_admin` a `ads_manager`; `sales` nemá ani `campaigns.write`, takže
nemůže kampaň posunout do žádného stavu — aktivace vyžaduje schválení mimo obchodní roli.

## Etapa 5 — Public delivery engine

Gate: `isPublicDeliveryActive(flags)` (`ADS_PUBLIC_DELIVERY_ENABLED=true` **and** `ADS_SAFE_MODE=false`) —
wrangler defaults keep both fail-closed (`ADS_SAFE_MODE=true`, `ADS_PUBLIC_DELIVERY_ENABLED=false`), so
this stage ships the real engine **without** flipping either production flag.

`delivery-engine.ts` (`selectPublicAds`) implements kap. 1,8,9,14,43:

- Selects `campaign_placements.status='active'` joined to an `campaigns.status='active'` campaign and an
  approved (`creatives.review_status='approved'`) creative matching the requested `device_category`
  (or `universal`); unapproved/rejected creatives are never delivered.
- Re-checks the `start_at`/`end_at` window on both the campaign and the placement in application code
  as defense-in-depth on top of the status field.
- `EMERGENCY_PAUSE_ALL` (`system_settings`, kap. 14) forces `ads:[]` whenever `'true'`, independent of
  the feature flags; if the setting can't be read, delivery fails closed (treated as paused).
- `collision_mode='exclusive'` placement types keep only the lowest-`priority` candidate per
  placement/device/section (kap. 11 semantics reapplied at delivery time); `shared` types may serve
  every eligible match.
- Every `creative.cdn_url` is a short-lived signed `/v1/objects/get` Worker path (`signed-access.ts`),
  TTL from `PUBLIC_DELIVERY_CACHE_TTL_SECONDS` (`system_settings`) — **never** a permanent public R2
  URL, matching `08-r2-plan.md` even once a creative is `approved`.
- `label` falls back to `ADS_LABEL_DEFAULT` (`system_settings`) when a campaign's `label_type` is empty.

`scheduler.ts` (`runAutoScheduler`, kap. 14) runs once per delivery request (best-effort — its errors
never block or widen delivery):

- `scheduled` → `active` once `start_at <= now`, but only if a `rights_confirmations` row already
  exists for the campaign (same fail-closed gate `admin-campaigns.ts` enforces manually, kap. 30) and
  the transition is legal in `campaign-state.ts`'s graph; otherwise the campaign is skipped, not forced.
- `active` → `ended` once `end_at <= now`.
- Every transition writes a `campaign_status_events` row (`actor_user_id: null`, `reason: "auto_start"`
  or `"auto_end"`) and an `audit_logs` entry, exactly like a manual transition.

## Etapa 0 scaffold

Implementováno pouze:

- `GET /health` — service meta + feature flags (safe mode)
- `GET /v1/public/ads/delivery` — pokud flag off → `{"ads":[],"enabled":false}` (fail-closed)
- Admin/Client routes → `503` nebo `404` dokud flag off (ne unikají data)

## Etapa 6 — Measurement/reporting (Analytics join)

Gate: stejné jako Etapa 2–5 (`ADS_ADMIN_API_ENABLED` + `ADS_SESSION_SECRET`/`ADS_PASSWORD_PEPPER`) +
RBAC `stats.read` (`main_admin`/`ads_manager`/`read_only`; `sales` nemá `stats.read`, viz `rbac.ts`).
Tato etapa nepřidává žádnou tabulku do `iu-ads` — agregáty zůstávají výhradně na Analytics Workeru
(`daily_ads`); `iu-ads` je jen read-only klient jeho existujícího `/v1/ads/report`.

| Route | Method | Perm | Notes |
|-------|--------|------|-------|
| `/v1/admin/stats/summary` | GET | `stats.read` | Filtry: `from`, `to`, `campaign_id`, `placement_id`, `section_id`, `slot_type`, `device_category`; test kampaně (`STATS_TEST_CAMPAIGN_PREFIX`, default `test`) vždy vyloučeny z `rows`/`totals`, i pokud by je Analytics omylem vrátil |
| `/v1/admin/stats/campaigns/:id` | GET | `stats.read` | Kombinuje `campaigns` metadata (`campaign_id`/`evidence_code`/`title`/`status` — **žádná cena**) s allowlistovaným Analytics reportem pro dané `campaign_id`; test kampaň (i podle `:id`) → `404` (fail-closed, nikoli přepínatelné přes parametr) |

`analytics-client.ts` (`fetchAdsReport`) volá Analytics Worker `GET /v1/ads/report` server-side,
autentizováno `ANALYTICS_ADMIN_TOKEN` (samostatný Worker secret — nikdy sdílený s Ads Admin API
auth ani s Analytics' vlastním `ADMIN_TOKEN` use-casem, viz `secrets.contract.md`). Base URL je
`system_settings.ANALYTICS_ADMIN_REPORT_URL` (výchozí prázdné → fail-closed). Chybějící konfigurace,
nedostupný upstream, non-2xx odpověď nebo neplatný JSON → vždy `503` (`stats_not_configured` /
`stats_upstream_unreachable` / `stats_upstream_error`), nikdy částečný/neallowlistovaný výstup —
každý řádek i souhrn je znovu sestaven pole po poli z explicitního allowlistu
(`day`, `campaign_id`, `placement_id`, `section_id`, `slot_type`, `device_category`, `impressions`,
`clicks`, `valid_clicks`, `suspicious_clicks`, `ctr`), takže neočekávané pole z Analytics (vč.
případného PII) nikdy neprojde na admin klienta.

## Etapa 8 — Admin ops (kap. 5, 6, 16–19)

Gate: stejné jako Etapa 2–7 (`ADS_ADMIN_API_ENABLED` + session secrets). Schema `0009`
(indexes + alert tunables only; `alerts` table already in `0001`). Minimal Worker shell:
`GET /admin` (ungated HTML docs only — live API still requires admin gate).

| Route | Method | Perm | Notes |
|-------|--------|------|-------|
| `/v1/admin/nav` | GET | session | Role-filtered menu contract (kap. 5); `dashboard`/`search` always; other items require matching `*.read` |
| `/v1/admin/dashboard` | GET | session | Role-scoped widgets only (omit if role lacks read): `campaigns_by_status`, `open_inquiries`, `open_orders`, `reservations_upcoming`, `unpaid_invoices`, `open_alerts`, `recent_audit` — counts/aggregates, no PII dumps |
| `/v1/admin/search?q=` | GET | session | Cross-entity search (clients/campaigns/invoices/documents metadata) role-scoped; **never** `code_hash`/`password_hash`/`access_code`/`r2_key`/secrets; `q` min 2 / max 120 |
| `/v1/admin/calendar?from=&to=` | GET | `campaigns.read` **or** `placements.read` | Timeline: campaign windows + reservations; exclusive collisions flagged via `collision.ts`; ISO `from`/`to` required |
| `/v1/admin/alerts` | GET | `alerts.read` | Filtry: `status`, `alert_type`, `limit`, `offset` |
| `/v1/admin/alerts/:id` | GET | `alerts.read` | Single alert |
| `/v1/admin/alerts/:id/ack` | POST | `alerts.write` | `new` → `read`; `409 already_resolved` |
| `/v1/admin/alerts/:id/resolve` | POST | `alerts.write` | → `resolved` + `resolved_at`; `409 already_resolved` |
| `/v1/admin/alerts/generate` | POST | `alerts.write` | Best-effort seed: `campaign_ending_soon`, `rights_missing`; also wired to Worker Cron `0 */6 * * *` (`cron: wired_etapa_9`) |

### List filters (kap. 17) — consistent query params

Shared helpers: `admin-list-filters.ts` (`clampLimit`/`clampOffset`/`likeContains`/`parseCommonListFilters`).

| List | Filters |
|------|---------|
| `/v1/admin/clients` | `q`, `limit`, `offset` |
| `/v1/admin/campaigns` | `status`, `client_id`, `q` (title/evidence_code/id), `limit`, `offset` |
| `/v1/admin/inquiries` / `orders` / `contracts` / `invoices` | `status`, `client_id`, (`q` on invoices), `limit`, `offset` |
| `/v1/admin/documents` | `client_id`, `campaign_id`, `doc_type`, `visibility`, `q`, `limit`, `offset` |
| `/v1/admin/reservations` | `placement_id`, `campaign_id`, `status`, `from`, `to`, `limit` |
| `/v1/admin/creatives` | `client_id`, `campaign_id`, `review_status`, `limit` |
| `/v1/admin/alerts` | `status`, `alert_type`, `limit`, `offset` |

## Etapa 9 — Backup / security closeout (kap. 14, 34)

Gate: Admin API + session + RBAC `backups.read`/`backups.write` (**main_admin only**). Schema `0010`
(indexes + retention / emergency-pause / alert-cron tunables; `backup_manifests` already in `0001`).

| Route | Method | Perm | Notes |
|-------|--------|------|-------|
| `/v1/admin/backups` | GET | `backups.read` | List manifests |
| `/v1/admin/backups` | POST | `backups.write` | Redacted inventory + SHA-256 manifest; optional encrypted R2 if `BACKUPS`+key bound; else `manifest_only` |
| `/v1/admin/backups/:id` | GET | `backups.read` | Metadata only |
| `/v1/admin/backups/:id/drill` | POST | `backups.write` | Hash round-trip restore drill; `409` on fail |
| `/v1/admin/backups/prune` | POST | `backups.write` | Delete D1 manifests past `BACKUP_RETENTION_DAYS` |

**Wrangler defaults unchanged** (safeMode ON, public/admin/client OFF). Cron triggers alert generate only.

**Deferred UI:** public-site admin UI; E5 inject; E7 portal UI. Kap. 35 remains `deferred_by_spec`. Production ads ON = human operator later.

## Open questions resolved

- Analytics report zůstává na Analytics Worker (`/v1/ads/report`).
- Ads Admin stats (Etapa 6) volá Analytics admin report server-side s odděleným secretem, nikoli z prohlížeče klienta.

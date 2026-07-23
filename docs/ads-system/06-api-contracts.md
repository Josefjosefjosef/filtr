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

Vrací pouze `client_visible` pole kampaní ve scope kódu + povolené dokumenty.  
Kap. 38.1–38.14 — implementace Etapa 7; kontrakt rezervován zde.

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

## Open questions resolved

- Analytics report zůstává na Analytics Worker (`/v1/ads/report`).
- Ads Admin stats (Etapa 6) volá Analytics admin report server-side s odděleným secretem, nikoli z prohlížeče klienta.

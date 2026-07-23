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

## Etapa 0 scaffold

Implementováno pouze:

- `GET /health` — service meta + feature flags (safe mode)
- `GET /v1/public/ads/delivery` — pokud flag off → `{"ads":[],"enabled":false}` (fail-closed)
- Admin/Client routes → `503` nebo `404` dokud flag off (ne unikají data)

## Open questions resolved

- Analytics report zůstává na Analytics Worker (`/v1/ads/report`).
- Ads Admin stats (Etapa 6) volá Analytics admin report server-side s odděleným secretem, nikoli z prohlížeče klienta.

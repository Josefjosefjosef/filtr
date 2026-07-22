# Database model — D1 `iu-ads`

Canonical migration: `cloudflare/iu-ads/migrations/0001_init.sql`  
Schema mirror: `cloudflare/iu-ads/schema.sql`

## Entity overview

| Entita | Tabulka | Kapitoly |
|--------|---------|----------|
| Interní uživatel | `admin_users` | 3,4 |
| Role / oprávnění | `admin_roles`, `admin_user_roles` | 4 |
| Relace | `admin_sessions` | 3 |
| Reset hesla | `admin_password_resets` | 3 |
| Login pokusy | `admin_login_attempts` | 3 |
| Klient | `clients` | 15 |
| Kontakt | `client_contacts` | 15 |
| Poptávka | `inquiries` | 26 |
| Objednávka | `orders` | 27 |
| Smlouva | `contracts` | 28 |
| Faktura | `invoices` | 29 |
| Kampaň | `campaigns` | 7,13 |
| Stavové přechody | `campaign_status_events` | 13 |
| Typ umístění (katalog) | `placement_types` | 10 |
| Umístění kampaně | `campaign_placements` | 10,11 |
| Rezervace | `placement_reservations` | 11 |
| Kreativa | `creatives` | 12 |
| Práva | `rights_confirmations` | 30 |
| Dokument | `documents` | 22 |
| Klientský kód | `client_access_codes` | 36 |
| Scope kódu→kampaně | `client_code_campaigns` | 36 |
| Klientská relace | `client_sessions` | 37 |
| Upozornění | `alerts` | 19 |
| Reklamace | `complaints` | 31 |
| Audit | `audit_logs` | 23 |
| Export job | `export_jobs` | 24 |
| Report snapshot | `client_report_snapshots` | 38.13 |
| Feature / legal flags | `system_settings` | 33 |
| Backup manifest | `backup_manifests` | 34 |

## ID pravidla

- `campaign_id` — interní technické ID (sdílené s Analytics).
- `evidence_code` — evidenční označení (např. `NOVAK-2026-001`), ≠ přístupový kód.
- `client_access_code` — zobrazit jednou; uložit `code_hash` (SHA-256 + pepper).
- `placement_id` — technické ID instance / typu dle kontraktu Public Delivery.

## Stavy kampaně (CHECK)

`draft`, `awaiting_assets`, `awaiting_legal`, `awaiting_tech`, `awaiting_approval`, `approved`, `scheduled`, `active`, `paused`, `ended`, `cancelled`, `archived`

## Migrace

Dopředné verzované SQL. `IF NOT EXISTS`. Bez destruktivních DROP v 0001.  
Opakované spuštění musí být bezpečné (idempotentní create + indexy).

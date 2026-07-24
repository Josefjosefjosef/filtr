# Backup & restore — InfoUzel Ads

## Scope denní zálohy (kap. 34)

Klienti, kampaně, dokumenty meta, statistiky (export z Analytics agregátů odděleně), audit, objednávky, smlouvy, faktury, reklamace, nastavení, metadata kreativ, klientská oprávnění (hashe, ne plaintext kódy).

## Požadavky

- Šifrování at-rest (záloha) — AES-256-GCM když je nastaven `ADS_BACKUP_ENCRYPTION_KEY` + R2 `BACKUPS`
- Oddělení od produkce (`iu-ads-backups`) — binding `BACKUPS` je committed v `wrangler.toml`; Deploy IU Ads `ensure_bucket` vytváří bucket; šifrování stále vyžaduje secret `ADS_BACKUP_ENCRYPTION_KEY`
- Verzování + retenční politika — `BACKUP_RETENTION_DAYS` (default `30`) + `POST /v1/admin/backups/prune`
- Pravidelný restore drill (Etapa 9) — `POST /v1/admin/backups/:id/drill` + unit round-trip
- Žádná plaintext hesla ani klientské kódy — `backup.ts` redakce + `assertNoForbiddenBackupKeys`

## Etapa 9 — Worker implementace

### D1

- Tabulka `backup_manifests` (od `0001`)
- Migrace `0010_backup_security.sql`: indexy + `BACKUP_RETENTION_DAYS`, `BACKUP_MANIFEST_ONLY_OK`, `ALERT_CRON_ENABLED`; `schemaVersion=0010`

### Admin API (gate: `ADS_ADMIN_API_ENABLED` + session + RBAC `backups.*`, **main_admin only**)

| Route | Method | Notes |
|-------|--------|-------|
| `/v1/admin/backups` | GET | List manifests |
| `/v1/admin/backups` | POST | Build redacted inventory (table counts + settings sample), SHA-256, insert manifest; if `env.BACKUPS` + `ADS_BACKUP_ENCRYPTION_KEY` → encrypt + R2 put (`status=stored`), else `status=manifest_only` |
| `/v1/admin/backups/:id` | GET | Manifest metadata (no ciphertext) |
| `/v1/admin/backups/:id/drill` | POST | Re-hash inventory vs `content_hash`; `409` on mismatch/leaks |
| `/v1/admin/backups/prune` | POST | Delete D1 manifests older than retention |

### Automated proof

- `test/backup-security.test.ts` — redaction, hash round-trip, AES-GCM, retention, privacy defaults, wrangler fail-closed
- `test/backup-security-admin.test.ts` — RBAC deny for non-admin, create+drill, prune, alerts cron

## Operator runbook — full Cloudflare restore (not automated in CI)

1. **D1 export (prod):**  
   `npx wrangler d1 export iu-ads --remote --output=%TEMP%\iu-ads-d1-export.sql`
2. **R2 creatives/documents:** Cloudflare dashboard → R2 → bucket → copy objects to cold storage / second account; never make documents public.
3. **Encrypted inventory:** Deploy ensures `iu-ads-backups` + `BACKUPS` binding; put `ADS_BACKUP_ENCRYPTION_KEY` via `npx wrangler secret put`, then `POST /v1/admin/backups` with Admin API enabled. Without the key, manifests stay `manifest_only`.
4. **Restore drill (staging):** import SQL into a **non-prod** D1 database; verify `SCHEMA_VERSION`, spot-check campaign/client counts; run Worker against staging; confirm `/health` + admin login; **do not** flip `ADS_SAFE_MODE` / public delivery on prod as part of drill.
5. **Retention:** `POST /v1/admin/backups/prune` (or cron/operator schedule); purge aged R2 objects manually if using `iu-ads-backups`.

## Etapa 0/1 základ (historie)

- Tabulka `backup_manifests`
- Dokumentovaný runbook
- CI hook placeholder → nahrazeno Etapou 9 Worker + tests

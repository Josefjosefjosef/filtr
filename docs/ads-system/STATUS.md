# InfoUzel Ads — implementation STATUS

**Current stage:** Etapa 1 (infra + R2) — in progress  
**Etapa 0:** MERGED (#7668 → `a31ea9e958`)  
**PR #7674:** MERGED (`b5e15ff40c`) health probe retries  
**Safe mode:** ON · Public delivery: OFF · Admin API: OFF · Client API: OFF  
**Prod health (Etapa 0 baseline):** `ok=true` `storageMode=d1` `safeMode=true`

## Stage checklist

| Etapa | Stav |
|-------|------|
| 0 Audit + architektura + migrační základ | done (#7668) |
| 1 Infra/data (D1 remote, R2, deploy prod) | in_progress |
| 2 Auth / users / roles / audit | pending |
| 3 Obchod + dokumenty | pending |
| 4 Kampaně / umístění / kreativy | pending |
| 5 Public engine | pending |
| 6 Měření / reporty | pending |
| 7 Klientské kódy + portál | pending |
| 8 Admin UI dokončení | pending |
| 9 Backup / security / closeout | pending |

## Etapa 1 focus

- Prefer `CLOUDFLARE_ADS_API_TOKEN` (R2+D1+Workers Scripts Edit)
- R2 buckets: `iu-ads-creatives`, `iu-ads-documents`
- Private docs via signed Worker access only
- Migration `0002_r2_access_audit.sql`
- Keep SAFE_MODE / publicDeliveryEnabled=false

## Guards

- PR #7617 OID must remain unchanged by ads work
- `stash@{0}` `iu-v3-wip-unrelated-cnb` preserved
- Analytics health unchanged

Chapter matrix: [01-traceability-matrix.md](./01-traceability-matrix.md)

# InfoUzel Ads — implementation STATUS

**Current stage:** Etapa 0 (foundation) — MERGED (#7668 → `a31ea9e958`) · Etapa 1 next  
**Baseline main (start):** `150f6b7763241768a481b5ba312ab8b380ea9c59`  
**Safe mode:** ON · Public delivery: OFF · Admin API: OFF · Client API: OFF  
**Prod health:** `https://infouzel-ads.josef-zmrhal.workers.dev/health` → `ok=true` `storageMode=d1` `safeMode=true`

## Stage checklist

| Etapa | Stav |
|-------|------|
| 0 Audit + architektura + migrační základ | done (#7668) |
| 1 Infra/data (D1 remote, R2, deploy prod) | pending |
| 2 Auth / users / roles / audit | pending |
| 3 Obchod + dokumenty | pending |
| 4 Kampaně / umístění / kreativy | pending |
| 5 Public engine | pending |
| 6 Měření / reporty | pending |
| 7 Klientské kódy + portál | pending |
| 8 Admin UI dokončení | pending |
| 9 Backup / security / closeout | pending |

## Etapa 0 artefakty

- `docs/ads-system/*` — audit, matrix 1–48, architecture, security, isolation, API, R2, backup, tests
- `cloudflare/iu-ads/` — Worker scaffold, migration 0001, fail-closed flags, isolation tests
- `.github/workflows/deploy-iu-ads.yml` — deploy + D1 ensure + health gate
- `scripts/iu-ads-isolation-guard.mjs`

## Guards (re-check each stage)

- PR #7617 OID must remain unchanged by ads work
- `stash@{0}` `iu-v3-wip-unrelated-cnb` preserved
- Analytics health unchanged; no rewrite of `cloudflare/iu-analytics` in Etapa 0

Chapter matrix detail: [01-traceability-matrix.md](./01-traceability-matrix.md)

# InfoUzel Ads — implementation STATUS

**Current stage:** Etapa 1 (infra + R2) — **blocked on R2 token** · PR #7680  
**Etapa 0:** MERGED (#7668 → `a31ea9e958`)  
**PR #7674:** MERGED (`b5e15ff40c`)  
**Safe mode:** ON · Public delivery: OFF  

## R2 blocker (ověřeno 2026-07-22)

Deploy run `29955044596` (branch Etapa 1):
- `TOKEN_SOURCE=CLOUDFLARE_API_TOKEN_FALLBACK` (secret `CLOUDFLARE_ADS_API_TOKEN` neexistuje)
- D1 migrace `0002_r2_access_audit.sql` applied ✅
- R2 list → Cloudflare API `Authentication error [code: 10000]`
- `LIKELY_MISSING_PERMISSION=Account.Workers_R2_Storage.Edit`

**Jediný manuální krok:** vytvořit GitHub secret `CLOUDFLARE_ADS_API_TOKEN` dle `cloudflare/iu-ads/secrets.contract.md`, pak spustit **Deploy IU Ads**.

## Stage checklist

| Etapa | Stav |
|-------|------|
| 0 | done (#7668) |
| 1 | code ready (#7680), waiting on R2 token |
| 2–9 | pending |

## Guards

- PR #7617 OID `9be3e372…` unchanged
- `stash@{0}` `iu-v3-wip-unrelated-cnb` preserved

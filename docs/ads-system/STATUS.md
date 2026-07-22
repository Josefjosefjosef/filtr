# InfoUzel Ads — implementation STATUS

**Current stage:** Etapa 1 (infra + R2) — **blocked: R2 not enabled on account (10042)** · PR #7680  
**Etapa 0:** MERGED (#7668 → `a31ea9e958`)  
**PR #7674:** MERGED (`b5e15ff40c`)  
**Safe mode:** ON · Public delivery: OFF  

## R2 verification (2026-07-22)

Deploy run `29960523944` (with `CLOUDFLARE_ADS_API_TOKEN`):
- `TOKEN_SOURCE=CLOUDFLARE_ADS_API_TOKEN` ✅
- D1 list/migrate ✅ (`0002` applied)
- R2 list ❌ — `Please enable R2 through the Cloudflare Dashboard. [code: 10042]`
- Token permissions are OK; **account is not entitled / R2 not activated**

**Jediný manuální krok:** Cloudflare Dashboard → **R2** → Activate / Purchase R2 (free tier stačí) pro účet `577868e9aac9c289e9323100f68fad16`. Pak napsat „R2 aktivováno“.

## Stage checklist

| Etapa | Stav |
|-------|------|
| 0 | done (#7668) |
| 1 | code ready (#7680); waiting on R2 account activation |
| 2–9 | pending |

## Guards

- PR #7617 OID `9be3e372…` unchanged
- `stash@{0}` `iu-v3-wip-unrelated-cnb` preserved

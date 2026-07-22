# InfoUzel Ads — implementation STATUS

**Current stage:** Etapa 1 COMPLETE (infra + R2) — awaiting merge #7680 after GREEN CI  
**Etapa 0:** MERGED (#7668 → `a31ea9e958`)  
**PR #7674:** MERGED (`b5e15ff40c`)  
**Safe mode:** ON · Public delivery: OFF  

## Etapa 1 production proof (2026-07-22)

Deploy run `29962508435` SUCCESS:
- `TOKEN_SOURCE=CLOUDFLARE_ADS_API_TOKEN`
- D1 `iu-ads` OK · schema `0002`
- R2 buckets: `iu-ads-creatives`, `iu-ads-documents` (no r2.dev / no public domain)
- Bindings: `CREATIVES` + `DOCUMENTS`
- `ADS_R2_SIGNING_SECRET` PUT_OK (generated or from GitHub secret)
- Health: `r2.ready=true`, `privateDocumentsPublicUrl=false`, `safeMode=true`, `publicDeliveryEnabled=false`
- `/v1/objects/get` → HMAC gate active (`access_denied` not `signing_not_configured`)
- `/v1/public/ads/delivery` → `{"ads":[],"enabled":false,"safeMode":true}`

## Stage checklist

| Etapa | Stav |
|-------|------|
| 0 | done |
| 1 | prod verified; merge #7680 when CI green |
| 2–9 | next |

## Guards

- PR #7617 OID `9be3e372…` unchanged
- `stash@{0}` `iu-v3-wip-unrelated-cnb` preserved

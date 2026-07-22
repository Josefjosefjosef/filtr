# InfoUzel Ads — implementation STATUS

**Current stage:** Etapa 1 (infra + R2) — R2 active, buckets created, Worker bindings live · PR #7680  
**Etapa 0:** MERGED (#7668 → `a31ea9e958`)  
**PR #7674:** MERGED (`b5e15ff40c`)  
**Safe mode:** ON · Public delivery: OFF  

## R2 verification (2026-07-22/23)

Deploy run `29962267170`:
- `TOKEN_SOURCE=CLOUDFLARE_ADS_API_TOKEN` ✅
- D1 list/migrate ✅
- R2 list/create ✅ — `iu-ads-creatives`, `iu-ads-documents` (10042 gone)
- Worker deploy ✅ — bindings `CREATIVES` + `DOCUMENTS`
- Health probe ❌ once (edge race: old schema `0001` without `r2`); live now:

```
schemaVersion=0002
r2.ready=true creativesBound=true documentsBound=true
privateDocumentsPublicUrl=false
safeMode=true publicDeliveryEnabled=false
```

Optional: GitHub secret `ADS_R2_SIGNING_SECRET` for live `/v1/objects/get` (unit tests cover HMAC).

## Stage checklist

| Etapa | Stav |
|-------|------|
| 0 | done (#7668) |
| 1 | code + prod R2 ready; merge #7680 pending GREEN re-deploy |
| 2–9 | pending |

## Guards

- PR #7617 OID `9be3e372…` unchanged
- `stash@{0}` `iu-v3-wip-unrelated-cnb` preserved

# InfoUzel Ads — implementation STATUS

**Current stage:** Etapa 1 **DONE** · Etapa 2 in progress (PR #7684)  
**Safe mode:** ON · Public delivery: OFF · Admin API default: OFF  

## Etapa 1 closeout

| Item | Value |
|------|-------|
| PR | [#7680](https://github.com/Josefjosefjosef/filtr/pull/7680) **MERGED** |
| Merge commit | `4cb14e47b9c822b18be254af67bef9a5d04e67c3` |
| Smoke | `29971819226` SUCCESS |
| Deploy (main push) | `29974385373` SUCCESS |
| Data Bot pause | **not needed** (auto-merge completed; bots left active) |

### Production proof

- D1 `iu-ads` · `storageMode=d1` · `schemaVersion=0002`
- R2: `iu-ads-creatives` + `iu-ads-documents` bound (`r2.ready=true`)
- `privateDocumentsPublicUrl=false`
- `safeMode=true` · `publicDeliveryEnabled=false`
- `/v1/objects/get` HMAC active (`access_denied`, not public URL)
- `/v1/public/ads/delivery` → empty fail-closed
- Analytics healthy · PR #7617 OID unchanged · `stash@{0}` preserved

Report: `docs/ads-system/ETAPA-1-REPORT.md`

## Stage checklist

| Etapa | Stav |
|-------|------|
| 0 | done |
| 1 | **done** (#7680 → `4cb14e47b9`) |
| 2 | in progress (#7684) — auth/RBAC/audit |
| 3–9 | pending |

## Guards

- PR #7617 OID `9be3e372…` OPEN unchanged
- `stash@{0}` `iu-v3-wip-unrelated-cnb` preserved
- Data Bot workflows remain **active**

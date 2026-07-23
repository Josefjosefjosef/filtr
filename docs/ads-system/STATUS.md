# InfoUzel Ads — implementation STATUS

**Current stage:** Etapa 1 **DONE** · Etapa 2 **DONE** (#7684 merged) · Etapa 3 in progress (business + documents)  
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

## Etapa 2 closeout

- PR [#7684](https://github.com/Josefjosefjosef/filtr/pull/7684) **MERGED** (auth/RBAC/audit) — `0211570590`
- Schema `0003`: admin auth/session/lockout tunables

## Etapa 3 — business + documents (in progress)

- Migration `0004_business_documents.sql`: indexes + `system_settings` only (tables already in `0001`); `schemaVersion` → `0004`
- RBAC extended: `documents.*`, `rights.*`, `complaints.*`, `exports.*`, `finance.read`; `sales` gets `invoices.write`; `read_only` gets all new `*.read`
- New modules: `admin-clients.ts`, `admin-inquiries.ts` (+ inquiry→order convert), `admin-orders.ts`, `admin-contracts.ts`, `admin-invoices.ts`, `admin-documents.ts`, `admin-rights.ts`, `admin-complaints.ts`, `admin-exports.ts` (stub jobs, `status: "queued"`), `admin-finance.ts`, `visibility.ts`
- Documents: upload validated via `r2-security.ts` into `DOCUMENTS` bucket; access always a short-lived signed path (`visibility.ts` → `signed-access.ts`) — **never** a permanent public R2 URL, including `visibility: "public"`
- Tests: 71 passing (was 44) across 10 files
- Not yet done: UI, real export generation (stub only), client-portal visibility consumption (Etapa 7)

## Stage checklist

| Etapa | Stav |
|-------|------|
| 0 | done |
| 1 | **done** (#7680 → `4cb14e47b9`) |
| 2 | **done** (#7684 → `0211570590`) — auth/RBAC/audit |
| 3 | in progress — business/documents |
| 4–9 | pending |

## Guards

- PR #7617 OID `9be3e372…` OPEN unchanged
- `stash@{0}` `iu-v3-wip-unrelated-cnb` preserved
- Data Bot workflows remain **active**

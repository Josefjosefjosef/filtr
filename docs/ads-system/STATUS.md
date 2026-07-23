# InfoUzel Ads — implementation STATUS

**Current stage:** Etapa 2 (auth/users/roles/audit) implemented on `feat/ads-system-etapa-2-auth` — PR open, awaiting GREEN CI + merge  
**Etapa 1:** COMPLETE (infra + R2) — awaiting merge #7680 after GREEN CI  
**Etapa 0:** MERGED (#7668 → `a31ea9e958`)  
**PR #7674:** MERGED (`b5e15ff40c`)  
**Safe mode:** ON · Public delivery: OFF · Admin API: OFF (`ADS_ADMIN_API_ENABLED=false` default)

## Etapa 2 implementation (2026-07-23)

- Migration `0003_admin_auth.sql`: session/reset/user-role indexes + `system_settings` tunables
  (`ADMIN_SESSION_TTL_SECONDS`, lockout/reset/password-policy knobs). `SCHEMA_VERSION` → `0003`.
- New modules: `password.ts` (PBKDF2+pepper), `session.ts` (HMAC-signed HttpOnly/Secure/SameSite=Strict
  cookie), `rbac.ts` (hardcoded role→permission map), `audit.ts` (redaction), `admin-auth.ts`,
  `admin-users.ts`, `admin-audit.ts`.
- Routes: `/v1/admin/auth/{login,logout,me,password-reset/request,password-reset/confirm,password/change}`,
  `/v1/admin/users` (GET/POST), `/v1/admin/users/:id` (GET/PATCH), `/v1/admin/users/:id/roles` (PUT),
  `/v1/admin/roles` (GET), `/v1/admin/audit` (GET), `/v1/admin/audit/:id` (GET).
- Gate fixed: Admin API is blocked by `ADS_ADMIN_API_ENABLED` and missing secrets
  (`503 auth_not_configured`) — **not** by `safeMode` (safeMode only gates Public Ad Delivery).
- Client routes (`/v1/client/*`) unchanged — still `503` until Etapa 7.
- Tests: 44 total (31 new for Etapa 2) — `npm test` green in `cloudflare/iu-ads`.
- Known gap (documented, not blocking): password-reset token delivery (email/SMS) is out of Etapa 2
  scope — request endpoint creates a hashed, time-limited token row but never returns the raw token.  

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
| 2 | implemented + tested on `feat/ads-system-etapa-2-auth`; PR open, not yet merged/deployed |
| 3–9 | next |

## Guards

- PR #7617 OID `9be3e372…` unchanged
- `stash@{0}` `iu-v3-wip-unrelated-cnb` preserved

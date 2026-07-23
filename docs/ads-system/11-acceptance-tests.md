# Acceptance tests catalog (kap. 45)

Každý test má být dohledatelný z `01-traceability-matrix.json`.

## Etapa 0 (povinné teď)

| ID | Test | Gate |
|----|------|------|
| E0-T1 | Unit: feature flags default fail-closed | `npm test` in `cloudflare/iu-ads` |
| E0-T2 | Unit: public response strip forbidden keys | vitest |
| E0-T3 | Unit: schema isolation — no `daily_traffic` in ads SQL | vitest / guard |
| E0-T4 | Docs matrix obsahuje kapitoly 1–48 + goal | JSON parse |
| E0-T5 | PR #7617 OID nezměněn reklamním PR | gh pr view |
| E0-T6 | stash@{0} zachován | git stash list |

## Etapa 2 (implemented now)

| ID | Test | Gate |
|----|------|------|
| E2-T1 | Unit: PBKDF2+pepper hash/verify round-trip, wrong password/pepper rejected | `test/auth-crypto.test.ts` |
| E2-T2 | Unit: server-side password strength policy | `test/auth-crypto.test.ts` |
| E2-T3 | Unit: HMAC session token sign/verify, expiry, bad signature, tamper rejection | `test/session.test.ts` |
| E2-T4 | Unit: session cookie is HttpOnly+Secure+SameSite=Strict; logout cookie Max-Age=0 | `test/session.test.ts` |
| E2-T5 | Unit: brute-force lockout after N consecutive failures, auto-unlock after window, reset on success | `test/bruteforce.test.ts` |
| E2-T6 | Unit: RBAC hardcoded map matches `07-roles-permissions.md` (main_admin full, ads_manager/sales scoped, read_only read-only, unknown role denied) | `test/rbac.test.ts` |
| E2-T7 | Unit: audit redaction strips password/token/session/code_hash from before/after JSON | `test/audit.test.ts` |
| E2-T8 | Admin API gate: `ADS_ADMIN_API_ENABLED=false` → `503`; secrets missing → `503 auth_not_configured`; safeMode alone never blocks admin routes | manual/health + `index.ts` review |

## Pozdější etapy (katalog)

Auth/hash/brute-force/session; RBAC; client code hash/once/expire/regen/isolation; no empty box; collision; auto start/stop; limits; creative MIME; dangerous URL; audit no secrets; client report full; PDF/CSV/JSON export; mobile/tablet/PC; privacy/analytics/repo/layout guards; produkční E2E.

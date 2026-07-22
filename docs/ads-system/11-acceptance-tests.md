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

## Pozdější etapy (katalog)

Auth/hash/brute-force/session; RBAC; client code hash/once/expire/regen/isolation; no empty box; collision; auto start/stop; limits; creative MIME; dangerous URL; audit no secrets; client report full; PDF/CSV/JSON export; mobile/tablet/PC; privacy/analytics/repo/layout guards; produkční E2E.

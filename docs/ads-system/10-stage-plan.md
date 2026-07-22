# Stage plan — InfoUzel Ads (0–9)

Každá etapa: větev z čistého `main` → PR → GREEN CI → merge → deploy (pokud bezpečné) → produkční ověření → re-check PR #7617 + stash.

| Etapa | Název | Výstup |
|-------|-------|--------|
| 0 | Audit + architektura + migrační základ | Docs, matrix, schema 0001, Worker health fail-closed, testy izolace |
| 1 | Infra/data | D1 remote, R2 bindings, secrets contract, health prod, deploy workflow |
| 2 | Auth/users/roles/audit | Sessions, RBAC, password reset, audit API |
| 3 | Obchod + dokumenty | Clients…invoices, documents, visibility |
| 4 | Kampaně/umístění/kreativy | State machine, rezervace, kolize, upload |
| 5 | Public engine | Delivery API + frontend inject bez prázdných boxů |
| 6 | Měření/reporty | Napojení Analytics, interní stats |
| 7 | Klientské kódy + portál | Full report 38.x |
| 8 | Admin UI dokončení | Menu, dashboard, filtry, kalendář, alerts |
| 9 | Backup/security/E2E closeout | Restore drill, pen test, matrix 100% |

Kapitola 35 (budoucí rozšíření) není součástí povinného v1 scope — explicitně `deferred_by_spec`.

## Safe mode

Produkční aktivní reklama až po splnění checklistu kap. 14 pokynů (auth, audit, approvals, URL, privacy, auto-end, emergency pause).

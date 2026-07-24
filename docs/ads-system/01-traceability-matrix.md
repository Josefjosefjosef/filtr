# Traceability matrix — lidský přehled

Zdroj pravdy: [`01-traceability-matrix.json`](./01-traceability-matrix.json)

- Kapitoly **1–48** + **goal** jsou všechny přítomné v JSON matici.
- Stav `done` = Worker/API evidence complete for that chapter (UI may still be deferred elsewhere).
- Stav `in_progress` = partial (often Worker done, public-site UI gap).
- Stav `planned` = not started / UI-only remaining.
- Stav `deferred_by_spec` = kap. 35 (budoucí rozšíření, není povinné v1).
- Stav `active_guard` = kap. 46 (procesní ochrana agregátoru).
- **goal** stays `in_progress` until UI gaps closed **and** operator enables production ads (Etapa 9 does **not** flip ads ON).

Po každé etapě aktualizovat `status` v JSON a tento přehled.

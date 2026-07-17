# Cleanup a záměrně zachované věci

## Provedený cleanup (bezpečný)

- Inventář PR: uzavření stale skupiny C (před startem této větve).
- Žádné agresivní mazání runtime / pipeline kódu.
- Diagnostika: bezpečný VERSION_JSON probe (ne produkční app změna).
- Dokumentace baseline + freeze + integrační mapa.

## Záměrně ZACHOVÁNO (pro migraci / rollback / audit)

| Oblast | Proč |
|--------|------|
| `article_feed_chunks/*` + legacy `articles.json` čtecí cesty | Dual-read / audit agregátoru |
| Durable SW caches `iu-feed-offline-v1`, `iu-img-offline-v1` | Offline kompatibilita napříč deployi |
| `__IU_GUARD_PAUSE_BG_PRELOAD` hook | Jen test; default produkce nepoužívá |
| localStorage/IDB klíče notes/tasks/calendar/invoices | Local-first + export/import |
| `iu-user-data-backup-core.js` schema | Migrace dat |
| Data Bot workflows + open PR #7550/#7551 | Kontinuita feedu |
| Agregátor guard skripty | Regrese při rebuild |
| Historické `docs/*` reporty | Audit trail |

## NO-GO cleanup

- Mazání „starého“ feed loaderu bez náhrady
- Přejmenování storage keys
- Wipe durable caches jako default
- Odstranění export/import UI

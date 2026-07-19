# Přehled dne — architektura V2

## Oddělení vrstev

- **Backend** (`scripts/iu-info-events-refresh.mjs` + lib/v2): fetch zdrojů, validace, normalizace, deduplikace, chronologie, monitoring, atomické publikování datasetů.
- **Frontend** (`assets/iu-info-system-core-v1.js`, `iu-prehled-dne-ui-v1.js`): local-first, načítá pouze připravené datasety z `projects/data/info_events/`. **Nikdy** nevolá zdrojové weby.

## Datasety

| Soubor | Účel |
|--------|------|
| `manifest.json` | Atomický pointer generace + mapa datasetů |
| `feed.json` | Hlavní agregovaný feed (kompatibilita) |
| `lanes/{id}.json` | Skupinové datasety (doprava, počasí, …) |
| `metadata.json` | Skupiny konektorů, personalizační dimenze, chronologie |
| `source_registry.json` | Registr zdrojů + lane/connectorType/periodicity |
| `monitoring.json` | Monitoring běhu |
| `feed.prev.json` | Rollback snapshot předchozího feedu |

## Chronologie

Každá položka: `publishedAtSource`, `firstSeenByInfoUzel`, `lastUpdatedBySource`, `lastProcessedAt`, `sortAt`.

Řazení „Nejnovější“ používá `sortAt` = čas zdroje, jinak čas prvního zachycení InfoUzlem.

## Skupiny a periodicita

Nezávislé lane skupiny v `metadata.connectorGroups`. Výpadek jedné skupiny neblokuje ostatní (izolace v refresh). Volitelně `IU_INFO_EVENTS_GROUP=<lane>`.

Preferované konektory: API → Open Data → RSS/Atom → XML/JSON → HTML.

## Regionální adaptér

Konfigurovatelný HTML/RSS adaptér (`metadata.regionalAdapter`) — nové kraje/města přidáváme konfigurací v registru, ne kopií skriptů.

## Personalizace (V3)

- Preference: `localStorage` klíč `iu.infoEvents.prefs.v1` (local-first).
- UI: chip filtry pro témata, lane skupiny, orgType, region level, zdroj, časové okno, aktivní/nové/nepřečtené/uložené.
- Oblíbené: zdroje, lane skupiny, regiony — ovlivňují řazení (boost) a filtr „Jen oblíbené“.
- Monitoring V3: `datasetAges`, `alerts` (stale / structure), `outageHistory`.
- Bez redakčního výběru: chronologie + originální odkazy beze změny.

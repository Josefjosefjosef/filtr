# Registr zdrojů

Soubor: `projects/data/info_events/source_registry.json`

Každý aktivní zdroj má: legalStatus, technicalStatus, periodicityMin, lastAuditAt, productionApproved, productionActive, monitoring, connectorStatus=`PRODUCTION_ACTIVE`, a konektor (`feedUrl` / `feedUrls` / `htmlListUrl` / `capIndexUrl`).

Pending schválené zdroje mají `productionActive: false` + povinné `connectorStatus` (`TECHNICALLY_BLOCKED` | `NO_STABLE_ITEM_SOURCE` | `LEGALLY_BLOCKED` | `REQUIRES_MANUAL_LEGAL_REVIEW` | `REJECTED`) a `blocker`.

Refresh: `node scripts/iu-info-events-refresh.mjs` (cron `*/30` přes `.github/workflows/update-info-events.yml`).

Pravidla konektorů:

- do feedu smí jen **konkrétní URL položky** (článek / TZ / CAP dokument), nikdy homepage ani listing root;
- aktivní produkční zdroj musí mít konektor;
- ČHMÚ: CAP XML z `opendata.chmi.cz` (konkrétní bulletin soubor);
- regionální kraje: sdílený HTML adaptér + `htmlPathInclude`;
- výpadek jednoho zdroje neblokuje refresh ostatních;
- deduplikace: canonical URL + `groupKey` (UI zobrazí `_clusterLinks`).

Komerční média jsou v `deactivatedCommercialMedia` (mimo Přehled dne).

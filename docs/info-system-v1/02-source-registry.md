# Registr zdrojů

Soubor: `projects/data/info_events/source_registry.json`

Každý aktivní zdroj má: legalStatus, technicalStatus, periodicityMin, lastAuditAt, productionApproved, productionActive, monitoring, a konektor (`feedUrl` / `feedUrls` a/nebo `htmlListUrl`).

Refresh: `node scripts/iu-info-events-refresh.mjs` (cron `*/30` přes `.github/workflows/update-info-events.yml`).

Pravidla konektorů:

- do feedu smí jen **konkrétní URL položky** (článek / TZ / dokument), nikdy homepage ani listing root;
- aktivní produkční zdroj musí mít konektor;
- schválené zdroje bez stabilního konektoru zůstávají v registru s `productionActive: false`;
- deduplikace: URL + `groupKey` (UI zobrazí `_clusterLinks` pro více originálů).

Komerční média jsou v `deactivatedCommercialMedia` (mimo Přehled dne).

Historie staré RSS agregace zůstává v `projects/data/source_registry.json` a article pipeline pro audit/rollback; UI Přehledu dne je nepoužívá.

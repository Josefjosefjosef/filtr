# Registr zdrojů

Soubor: `projects/data/info_events/source_registry.json`

**Právní whitelist (povinný):** `projects/data/info_events/legal_source_registry.json`  
Dokumentace: `docs/info-system-v1/12-legal-whitelist-audit.md`

Každý aktivní zdroj má: legalStatus, technicalStatus, periodicityMin, lastAuditAt, productionApproved, productionActive, monitoring, connectorStatus=`PRODUCTION_ACTIVE`, a konektor (`feedUrl` / `feedUrls` / `htmlListUrl` / `capIndexUrl`).

Pending schválené zdroje mají `productionActive: false` + povinné `connectorStatus` (`TECHNICALLY_BLOCKED` | `NO_STABLE_ITEM_SOURCE` | `LEGALLY_BLOCKED` | `REQUIRES_MANUAL_LEGAL_REVIEW` | `REJECTED`) a `blocker`.

Produkční ingest (`iu-info-events-refresh.mjs`) navíc vyžaduje záznam v právním registru se stavem `APPROVED_*`, **HTTPS `licenseUrl`**, externí evidence, `fieldAllowlist`, platný `reauditDue` a flagy komerčního použití, reklamy, automatizace, ukládání, zobrazení, úprav, normalizace a kombinování (phase-2 hard gate).

Veřejný přehled schválených zdrojů: `/zdroje-a-licence/` (kanonická URL).

**Veřejný sanitizovaný registr (allowlist):** `projects/data/info_events/legal_source_registry.public.json`  
Generování: `node scripts/iu-legal-registry-public-build.mjs`  
Guard: `node scripts/iu-zdroje-licence-registry-guard-v1.mjs`

Datový tok:

1. Authoritative: `legal_source_registry.json` (+ `source_registry.json` pro konektory)
2. Build vygeneruje public JSON (pouze allowlisted pole) a vloží snapshot do stránky
3. Frontend načte `/projects/data/info_events/legal_source_registry.public.json`
4. Při výpadku zobrazí embedovaný snapshot (ne ruční druhý seznam)
5. Interní pole (`legalNotes`, evidence, flags, …) se na veřejnost nepublikují

`lastVerified` ve veřejném výpisu = datum `lastReviewedAt` z authoritative registru (ne „dnes“ při každém GET).

Refresh: `node scripts/iu-info-events-refresh.mjs` (cron `*/30` přes `.github/workflows/update-info-events.yml`).

Pravidla konektorů:

- do feedu smí jen **konkrétní URL položky** (článek / TZ / CAP dokument), nikdy homepage ani listing root;
- aktivní produkční zdroj musí mít konektor;
- ČHMÚ: CAP XML z `opendata.chmi.cz` (konkrétní bulletin soubor);
- regionální kraje: sdílený HTML adaptér + `htmlPathInclude`;
- výpadek jednoho zdroje neblokuje refresh ostatních;
- deduplikace: canonical URL + `groupKey` (UI zobrazí `_clusterLinks`).

Komerční média jsou v `deactivatedCommercialMedia` a v právním registru jako `REJECTED` (mimo Přehled dne).

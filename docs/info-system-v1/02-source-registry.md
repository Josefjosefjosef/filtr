# Registr zdrojů

Soubor: `projects/data/info_events/source_registry.json`

Každý aktivní zdroj má: legalStatus, technicalStatus, periodicityMin, lastAuditAt, productionApproved, productionActive, monitoring.

Komerční média jsou v `deactivatedCommercialMedia` s důvodem deaktivace z UI Přehledu dne.

Historie staré RSS agregace zůstává v `projects/data/source_registry.json` a article pipeline pro audit/rollback; UI Přehledu dne je nepoužívá.

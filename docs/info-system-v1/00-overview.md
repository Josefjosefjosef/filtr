# InfoUzel — informační systém v1 (Přehled dne)

## Stav

- Společná datová vrstva: `projects/data/info_events/`
- UI: `assets/iu-prehled-dne-ui-v1.js` + `assets/iu-prehled-dne-v1.css`
- Core: `assets/iu-info-system-core-v1.js`
- Výchozí režim: **cutover** (HomeCards komerčních médií skryty)
- Paralelní režim: `?iuInfoSystem=parallel`
- Vypnutí: `?iuInfoSystem=off`

## Princip

InfoUzel zobrazuje jen čas, název, skutečný zdroj, místo, stav, důležitost a odkaz na originál. Bez fotek, perexů a převzatého obsahu.

## Rollback

1. `?iuInfoSystem=off` nebo `window.__IU_INFO_SYSTEM_CUTOVER__ = false`
2. Git revert PR / návrat na tag `pre-aggregator-stable-20260717`
3. Historická auditní data v `projects/data/` a docs zůstávají

## Cílová architektura (stav)

- Datová stabilizace (#7614) a UI V6 (#7615) **nejsou** dokončením cílové Postgres/API/SSE architektury.
- Rozdílový audit: [`10-differential-audit-target-architecture.md`](./10-differential-audit-target-architecture.md)
- Fázovaná dodávka: [`11-phased-delivery-roadmap.md`](./11-phased-delivery-roadmap.md)
- Verdikt Fáze 0: `PHASE_0_AUDIT_ONLY_NOT_FULL_ARCHITECTURE`

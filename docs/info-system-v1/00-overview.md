# InfoUzel — informační systém v1 (Přehled dne)

## Stav

- Společná datová vrstva: `projects/data/info_events/`
- UI: `assets/iu-prehled-dne-ui-v1.js` + `assets/iu-prehled-dne-v1.css`
- Core: `assets/iu-info-system-core-v1.js`
- Výchozí režim: **cutover** (legacy mediální HomeCards skryty)
- **2026-07-29:** současné mediální zdroje strukturálně odstraněny (registry + articles data);
  univerzální engine zachován; deny-list `config/removed_media_deny_list.json`
- Paralelní režim: `?iuInfoSystem=parallel`
- Vypnutí legacy UI: `?iuInfoSystem=off` (neobnovuje media sync)

## Princip

InfoUzel zobrazuje jen čas, název, skutečný zdroj, místo, stav, důležitost a odkaz na originál. Bez fotek, perexů a převzatého obsahu.

Produkční zdroje musí projít právním whitelistem (`legal_source_registry.json`) — viz `12-legal-whitelist-audit.md`.

## Rollback

1. `?iuInfoSystem=off` nebo `window.__IU_INFO_SYSTEM_CUTOVER__ = false`
2. Git revert PR / návrat na tag `pre-aggregator-stable-20260717`
3. Historická auditní data v `projects/data/` a docs zůstávají

## Cílová architektura (stav)

- Datová stabilizace (#7614) a UI V6 (#7615) **nejsou** dokončením cílové Postgres/API/SSE architektury.
- Rozdílový audit: [`10-differential-audit-target-architecture.md`](./10-differential-audit-target-architecture.md)
- Fázovaná dodávka: [`11-phased-delivery-roadmap.md`](./11-phased-delivery-roadmap.md)
- Verdikt Fáze 0: `PHASE_0_AUDIT_ONLY_NOT_FULL_ARCHITECTURE`

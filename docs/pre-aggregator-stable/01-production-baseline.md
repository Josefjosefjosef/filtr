# Produkční baseline před stabilizací

## Pre-stabilization production SHA (AUTHORITATIVE)

```
1e47ac46d93147035730314716641f71b330fffd
```

| Pole | Hodnota |
|------|---------|
| Merge PR | `#7529` (PWA offline menu/articles/tasks v4) |
| Pages deployment run | `29552693903` (GREEN) |
| Produkční URL | https://infouzel.cz/projects/ |
| Build artifact | `app.1e47ac46.js` |
| `projects/version.json` | `pwa-offline-menu-articles-v4-20260716` (`builtAt` 2026-07-16T21:55:00Z) |
| SW `CACHE_VERSION` | `2026-07-16-pwa-offline-menu-articles-v4` |
| Durable caches | `iu-feed-offline-v1`, `iu-img-offline-v1` |
| Lokální `main` | = `origin/main` = tento SHA (před stabilizační větví) |

## Co baseline NENÍ

- **Není** výsledný stabilizační tag.
- Tag `pre-aggregator-stable-YYYYMMDD` se vytváří až nad **post-stabilization** SHA po GREEN CI + merge + deploy + produkčním ověření.

## Moduly pokryté baseline smoke (reference)

- Feed / article entrypoints + load-more parity
- Quicktools / custom buttons (toggle-safe guards)
- PWA offline resilience (SW v4 warm, durable feed/img)
- Layout guard + silver stack
- Local-first: notes / tasks / calendar backup keys
- Info panel / CNB / nameday surfaces (existující CI guards)

## Diagnostická poznámka (neprodukční)

Při ověření produkce PowerShell spadl na `ArgumentOutOfRangeException` při `VERSION_JSON` preview (`Substring` délka z původního řetězce vs. zkrácený po `-replace`). Deployment ani shoda produkce×main tím nebyly ovlivněny. Oprava: `scripts/iu-prod-version-json-safe-probe-v1.mjs` + `scripts/iu-prod-verify-safe.ps1`.

# PWA + cross-browser ochrana

## PWA v4 (produkční baseline)

- Build: `pwa-offline-menu-articles-v4-20260716`
- SW: wipe versioned caches on activate; keep `iu-feed-offline-v1` / `iu-img-offline-v1`
- Warm shell **po** `clients.claim()` bez `await` / bez blokujícího `event.waitUntil(warm…)`
- Per-URL warm timeout 4s, concurrency 4

## Scénáře (musí PASS před tagem)

| ID | Scénář | Primární důkaz |
|----|--------|----------------|
| P1 | Install / controller present | PWA offline resilience guard |
| P2 | Online shell + CSS | layout + quicktools |
| P3 | Offline feed last-good | PWA offline resilience |
| P4 | Offline menu/tools/tasks surfaces | PWA offline resilience |
| P5 | Update deploy without half-filled CSS | SW v4 + smoke |
| P6 | Feature detection fallbacks (`serviceWorker`, `caches`) | cross-browser feature guard |

## Cross-browser

- Chromium: CI smoke + layout-guard
- Feature matrix: `npm run iu-pre-aggregator-cross-browser-feature-guard` (static + Chromium/Firefox/WebKit runtime probes)
- Full WebKit acceptance: `npm run iu-pre-aggregator-webkit-acceptance` (layout, nav, storage, export/import, offline/online)
- Firefox: Playwright runtime probe in feature guard
- Physical Safari macOS / iOS / iPadOS PWA: not available in this environment — documented recommendation before aggregator cutover (see `09-webkit-safari-databot-verify.md`)

## Post-tag verification (2026-07-17)

- Playwright WebKit binary installed; full WebKit acceptance **PASS**
- Feature guard WebKit probe **PASS** (no longer SKIP)
- Physical Safari/iOS: documented NOT_RUN + recommendation

## Safe prod version probe

Nikdy nepoužívat:
```powershell
($vj -replace '\s+',' ').Substring(0, [Math]::Min(120, $vj.Length))  # BUG: length z originálu
```
Použít: `npm run iu-prod-version-json-safe-probe` nebo `scripts/iu-prod-verify-safe.ps1`.

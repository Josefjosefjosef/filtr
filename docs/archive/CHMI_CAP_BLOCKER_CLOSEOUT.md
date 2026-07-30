# CHMI CAP blocker closeout (console / xbrowser / missing validTo)

## Console (`consoleErrorCount: 3` vs „konzole bez chyb“)

Original offline proof counted raw `page.on('console')` where `type === 'error'`.
On live offline that yields **3** messages, all:

`Failed to load resource: net::ERR_INTERNET_DISCONNECTED`

Sources (intentional offline):
1. `ads.infouzel.cz/v1/public/ads/delivery`
2. `api.open-meteo.com/...&models=gfs_seamless`
3. `api.open-meteo.com/...` (fallback forecast without models)

Classification: **expectedOfflineNetworkFailure**, not application bugs.
Guard: `npm run iu-console-classify-offline-guard` reports:
- `rawConsoleErrorCount`
- `unexpectedConsoleErrors` (must be 0)
- `expectedOfflineNetworkFailures`

## Firefox / WebKit timeouts

Root cause: local static server is HTTP-only, but `upgrade-insecure-requests`
rewrites asset URLs to `https://127.0.0.1:<port>/...`. WebKit hangs on SSL connect
(„waiting for fonts to load…“ / `page.goto` timeout).

Fix in `iu-pre-aggregator-cross-browser-feature-guard-v1.mjs`:
route `https://127.0.0.1:PORT/**` → `route.fetch(httpUrl)` + `fulfill`.

Result after fix: Chromium 1/1, Firefox 3/3, WebKit 3/3 PASS.

## Eight `nezaraditelne` without validTo

Forensic against official CAP XML:

| ID | Event | Category |
|---|---|---|
| ab04efa… | Riziko požárů (onset 30.7.) | **C** sibling has expires → filled |
| 53c98f… | Vysoké riziko požárů | **C** sibling has expires → filled |
| 60ca960… | Riziko požárů (onset 1.8.) | **A** no sibling expires |
| 402e32… | Smog O3 | **A** expires absent for event |
| b347b01… | Výhled jevů | **A** expires absent for event |
| 724203… / b68d8e… | Stav sucha | **A** CAP70 has no expires |
| cb192cd… | Hydrologické sucho | **A** CAP70 has no expires |

Fix: `resolveExpiresFromSiblingInfos` — unanimous expires from same
`event+onset+severity` info blocks only. Never invent times.

Fixture: `scripts/fixtures/chmi-cap-v2/alert-sibling-expires.xml`

# Cloudflare — skutečný HTTP 301 pro legacy `/projects/*` (zóna `infouzel.cz`)

GitHub Pages **neumí** serverový 301. Trvalé přesměrování zajišťuje Worker
`infouzel-site-redirects` (automatický deploy z `.github/workflows/deploy-iu-site-redirects.yml`)
nebo ruční **Redirect Rules** níže.

## Co Worker / pravidla dělají

| Vstup | Výstup |
|---|---|
| `/projects/` | `301` → `/` (+ query) |
| `/projects/statistiky/` | `301` → `/statistiky/` |
| `/projects/zdroje-a-licence/` | `301` → `/zdroje-a-licence/` |
| `/projects/<path>` | `301` → `/<path>` |
| `/projects/icons/...` | `301` → `/icons/...` |
| `/projects/manifest.json` | `301` → `/manifest.json` |
| `/projects/data/*` | **bez redirectu** (passthrough origin) |
| `/projects/version.json` | **bez redirectu** |

## Ověření (PowerShell / curl)

```text
curl.exe -sI "https://infouzel.cz/projects/"
curl.exe -sI "https://infouzel.cz/projects/?view=saved"
curl.exe -sI "https://infouzel.cz/projects/statistiky/"
curl.exe -sI "https://infouzel.cz/projects/data/_probe.txt"
```

Očekávání: HTML cesty `HTTP/1.1 301` + `Location: https://infouzel.cz/...`; data zůstane `200`.

## Ruční alternativa — Cloudflare Redirect Rules

Pokud Worker nelze nasadit (chybí token / route oprávnění):

1. Otevři [Cloudflare Dashboard](https://dash.cloudflare.com) → zóna **infouzel.cz**.
2. **Rules** → **Redirect Rules** → **Create rule**.
3. Rule name: `IU legacy /projects HTML to root`.
4. If incoming requests match… **Custom filter expression**:

```text
(http.host eq "infouzel.cz" or http.host eq "www.infouzel.cz")
and starts_with(http.request.uri.path, "/projects")
and not starts_with(http.request.uri.path, "/projects/data/")
and http.request.uri.path ne "/projects/version.json"
```

5. Then… **Dynamic** redirect:
   - Expression: `concat("https://infouzel.cz", regex_replace(http.request.uri.path, "^/projects", ""), if(http.request.uri.query ne "", concat("?", http.request.uri.query), ""))`
   - Status: **301**
6. Place rule **above** unrelated rules; ensure it does **not** match `/projects/data/*`.
7. Deploy → ověř `curl -sI` výše.

### Loop guard

- Nikdy nepřesměrovávej `/` zpět na `/projects/`.
- Nikdy nepřesměrovávej `/projects/data/*`.
- Po aktivaci Workeru i Redirect Rules současně zkontroluj, že vznikne jen **jeden** 301 hop.

## Inventář oprávněných `/projects/data/*` (zachováno)

| Cesta | Účel | Kdo | Veřejně v UI? | Proč nemigrovat teď |
|---|---|---|---|---|
| `/projects/data/*.json` | feedy článků/videí/počasí | app.js, SW, CI | nepřímo | stabilní kontrakt |
| `/projects/data/article_feed_chunks/*` | chunked články | chunk loader | nepřímo | SW/cache klíče |
| `/projects/data/info_panel_*` | info panel | desktop/mobile panel | nepřímo | watchdog + CI |
| `/projects/data/_probe.txt` | health probe | SW/CI/watchdog | ne | monitorování |
| `/projects/version.json` | PWA deploy probe | inline boot, connectivity | ne | cold-start recovery |

Repo složka `projects/` zůstává zdroj pravdy; deploy jen kopíruje shell/PWA na kořen.

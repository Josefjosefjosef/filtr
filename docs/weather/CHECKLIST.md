# infoUzel.cz – Weather Checklist

Single source of truth for the `Počasí` (weather) section, including the related Media embed mechanism used by Weather History.

## Stav sekce Počasí

| Feature | Stav | Soubor + řádek | PR | Poznámka |
|---------|------|----------------|----|---------|
| Weather History HTML | OK | `projects/index.html:775` | #299 | Sekce `iuWeatherHistory` + karta + `PlayerHost` existují |
| Weather History CSS (CLS=0 thumbnail) | OK | `assets/app.css:4798-4806` | #300 | Thumbnail má `aspect-ratio: 16 / 9` + pevnou šířku |
| Dataset `weather_history_videos.json` (valid + min 1) | OK | `projects/data/weather_history_videos.json` | #299 | JSON validní, `items` neprázdné |
| Dataset path only in `projects/data/` | OK | `assets/app.js:6563` | #299 | Loader fetchuje `projects/data/weather_history_videos.json` |
| Deterministický denní výběr | OK | `assets/app.js:6574-6581` | #299 | Hash `iuDayKeyLocal()` → index |
| Půlnoční rotace | OK | `assets/app.js:6695-6718` | #299 | `iuMsToNextMidnightLocal()` + re-render |
| Fallback když dataset/video chybí | OK | `assets/app.js:6593-6597` + `projects/index.html:805-807` | #299 | Karta se skryje, zobrazí se fallback text |
| Autoplay param `weatherHistoryPlay=1` (jen Počasí) | OK | `assets/app.js:6668-6674` | #299 | Init běží jen když `section === "pocasi"` |
| Autoplay čistí URL (idempotentní) | OK | `assets/app.js:6708-6711` + `6747-6750` | #300 | `history.replaceState(...?section=pocasi)` po autoplay |
| Zákaz `window.open` pro Weather History | OK | `assets/app.js:6653` + `8067-8073` + `8209-8215` | #300 | `noExternalOpen` → `data-iu-no-external-open="1"` → fallback bez nového tabu |
| Bez duplicitního init/render | OK | `assets/app.js:10322-10306` (grep) | #300 | `iuInitWeatherHistory()` se volá v aktivaci sekce Počasí; init guard `__iu_weatherHistoryInit` |
| SEO evergreen blok v HTML (TEXT–VIDEO–TEXT) | OK | `projects/index.html:805` | #300 | `iuWeatherHistorySeo` pod player host (bez iframe) |
| Auto-collector sources allowlist (RSS) | OK | `projects/data/weather_history_sources.json` | #299 | Reálné RSS zdroje + filtry + limity |
| Auto-collector build script | OK | `scripts/build_weather_history.py` | #299 | RSS→filter→oEmbed→safe merge + NO UPDATE |
| Auto-collector workflow (commit jen při změně) | OK | `.github/workflows/update-weather-history.yml:44-50` | #299 | `git diff --quiet` gate; commit message obsahuje `[skip ci]` |
| Auto-collector max 500 items | OK | `scripts/build_weather_history.py` (config clamp) | #299 | `max_total_items` clamp na 500 + deterministický trim |
| Gate artefakty mimo repo (helper) | OK | `tools/ps/iu-gate-helpers.ps1:9-17` | #301 | `Iu-MoveGateArtifacts` přesune `gate-*.png` + transcript |
| PS anti-stuck helper (správné `-or`) | OK | `tools/ps/iu-gate-helpers.ps1:21` | #301 | `if( (Test-Path A) -or (Test-Path B) )` |

## PR reference (Počasí / Weather History)

- **#299**: Weather History auto-collector + legal-safe auto SEO (dataset + workflow)
- **#300**: Weather consolidation (history + SEO + stability hotfix)
- **#301**: PS gate helpers (anti-stuck)
- **#298**: Weather History daily YouTube history card (initial feature)
- **#297–#291**: Weather UI stability/mobile/layout fixes (see `git log --merges --grep weather`)

## Poznámky k údržbě

- Pokud se přidají nové Weather body, doplň do tabulky nový řádek: **Feature / Stav / Soubor+řádek / PR / Poznámka**.
- Řádky v tabulce jsou vedené jako `soubor:řádek` podle aktuálního stavu na `main`.


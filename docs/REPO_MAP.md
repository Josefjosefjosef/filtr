# infoUzel.cz – REPO MAP (filtr)

## Jediný zdroj dat
- Autoritativní výstupy pro web jsou pouze:
  - `projects/data/articles.json`
  - `projects/data/videos.json`
  - `projects/data/weather.json`
  - `projects/data/namedays.json`
  - `projects/data/feed_health.json`
  - `projects/data/_probe.txt` (diagnostika)

Frontend NESMÍ číst z `data/` ani `filtr/data/` (tyto legacy cesty jsou odstraněné / nepoužívané).

## Frontend (GitHub Pages)
- `projects/index.html` – vstupní stránka webu (produkční)
- `assets/app.js` – hlavní logika klienta (načítá výhradně `/projects/data/*`)
- `assets/app.css` – stylování
- `sw.js` – service worker (pokud je používán)

## Workflows (GitHub Actions)
- `update-articles.yml` – generuje/aktualizuje články do `projects/data/*`
- `update-weather.yml` – aktualizuje `projects/data/weather.json`
- `update-namedays.yml` – aktualizuje `projects/data/namedays.json`
- `ci-data-freshness.yml` – kontrola čerstvosti `projects/data/*`
- `ci-heartbeat.yml` – heartbeat dostupnosti
- `ci-workflow-lint.yml` – lint workflow
- `repo-guard.yml` – hlídání konzistence repa
- `pages.yml` / `pages-build-deployment` – deploy GitHub Pages

### Pravidlo: žádné kolize push
Workflows, které commitují data, sdílí concurrency group:
`data-writers-${{ github.ref }}`

## Scripts
- `scripts/` – generátory a pomocné skripty pipeline (výstupy míří do `projects/data/`)

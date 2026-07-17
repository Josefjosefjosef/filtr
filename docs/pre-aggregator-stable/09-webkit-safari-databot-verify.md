# WebKit / Safari + Data Bot ověření (doplněk po tagu)

**Stabilizační tag (neměnit):** `pre-aggregator-stable-20260717` → commit `5647bb3fe365a12feb4bb4d2830c6957de73c853` (annotated tag object `18f2e6c…`)
**Ověření UTC:** WebKit `2026-07-17T11:04:35Z` · Data Bot closeout `2026-07-17T12:44:42Z` · Docs verify `2026-07-17T12:47:15Z`

## 1) Prostředí WebKit / Safari

| Položka | Hodnota |
|---------|---------|
| Engine | **Playwright WebKit 26.0** (`webkit-win64` / Playwright v2248) |
| Host OS | Windows 10 (`win32`) |
| Fyzické Safari macOS | **NOT_RUN** — není macOS host |
| Fyzické iOS / iPadOS PWA | **NOT_RUN** — není fyzické Apple zařízení |
| Simulace | Playwright WebKit (nejbližší dostupný WebKit runtime) |

**Omezení:** Tento běh **nenahrazuje** test na skutečném Safari (macOS) ani na fyzickém iPhone/iPad. Před veřejnou změnou agregátoru doporučen fyzický iOS/iPadOS PWA smoke (install, offline shell, local-first data).

## 2) Výsledek Playwright WebKit acceptance

Příkaz: `npm run iu-pre-aggregator-webkit-acceptance`  
Report: `%TEMP%\iu-webkit-acceptance-*.json`  
**RESULT=PASS**

Pokryté kontroly:

- načtení hlavní stránky (mobile / tablet / desktop)
- layout (overflowX=0)
- viewport + topbar + bottom nav
- safe-area env (host reportuje `0px` — bez fyzického notche)
- scroll + návrat na scroll pozici
- localStorage + IndexedDB
- export ↔ import roundtrip (`iu-user-data-backup-core`)
- overlay / focus path
- online shell (SW + caches)
- online → offline (shell + local-first marker)
- offline reopen: WebKit internal error na nové navigaci offline (dokumentováno); data zachována na existující session
- offline → online + zachování local-first markeru

Cross-browser feature guard po instalaci binary: Chromium + Firefox + **WebKit PASS** (už ne SKIP).

### Safari / iOS

| Cíl | Stav |
|-----|------|
| Safari macOS | NOT_RUN |
| Safari iOS / iPadOS | NOT_RUN |
| Instalovaná PWA iOS/iPadOS | NOT_RUN |

## 3) Data Bot run `29574367532`

| Položka | Hodnota |
|---------|---------|
| URL | https://github.com/Josefjosefjosef/filtr/actions/runs/29574367532 |
| status | `completed` |
| conclusion | `success` |
| event | `workflow_dispatch` (ověření po resume) |
| createdAt | `2026-07-17T10:42:32Z` |
| updatedAt | `2026-07-17T12:44:42Z` |
| Jobs | pipeline_gate, cancel_concurrency_zombies, ingest, aggregate, article_data_release, pipeline_operational_closeout — všechny `success` |
| Closeout | `PIPELINE_OVERALL_STATUS=PIPELINE_SUCCESS` · `PIPELINE_ALERT_LEVEL=GREEN` · `PIPELINE_OPERATIONAL_CLOSEOUT=PASS` |

Data PR z běhu: **#7561** (`automation/update-articles-data`) — auto-merge enabled; wait-for-merge v běhu skončil soft-timeoutem po ~13 min (`[CLOSEOUT] WARN: timeout waiting for merge`) protože required `smoke` ještě běžel. To **není** selhání ingest/aggregate/publish; Pages catch-up je přes cron `pages-publish-from-main-data` po merge.

Souběžné `update-articles` během ověřovacího běhu: **žádné duplicitní** — další run `29581381056` startoval až po closeoutu (`2026-07-17T12:45:08Z`).

## 4) Znovu aktivované workflow (po resume `2026-07-17T10:42:06Z`)

Všechny níže **active** (ověřeno `gh workflow list`):

- `Update articles data` (`update-articles.yml`)
- `Update articles fast pool` (`update-articles-fast-pool.yml`)
- `Update videos data`
- `Update info panel snapshot`
- `Articles watchdog cron fallback`
- `Articles nightly full rebuild`
- související CI: `CI - Articles watchdog`, `Deploy articles watchdog`, `Pages publish from main data`, `Pages deploy after data PR merge`

Watchdog: cron fallback běží (nejnovější run in_progress / concurrency canceluje starší overlapping běhy — očekávané).
Fast-pool: po resume opakovaně `success`.

## 5) Doporučení před cutover agregátoru

1. Fyzický Safari (macOS) smoke: feed, overlay, export/import.
2. Fyzický iOS/iPadOS: Add to Home Screen PWA, offline → online, local-first notes/tasks.
3. Ověřit safe-area na zařízení s notch / home indicator.

## 6) Navazující ověřovací PR

Docs + testovací skript WebKit acceptance (bez změny runtime aplikace). Stabilizační tag zůstává na `5647bb3f…`.

## 7) Čistý pracovní strom

Po merge ověřovacího PR: `git status --short` musí být prázdný na follow-up větvi; tag a stabilizační commit nedotčeny.

# System Map – infoUzel.cz

Živá dokumentace systému pro repozitář `C:\projects\filtr` (infoUzel.cz).  
Cíl: před každým zásahem rychle ověřit aktuální stav, neduplikovat logiku a udržet stabilitu (CLS, cache, SW, data pipeline).

## Aktuální stav (snapshot)

- **Repo**: `C:\projects\filtr`
- **Branch**: `docs/system-map`
- **Updated**: 2026-02-10

## Obsah

- [`01-repo-structure.md`](./01-repo-structure.md): struktura složek + účel
- [`02-runtime-architecture.md`](./02-runtime-architecture.md): runtime v prohlížeči (entrypointy, init, render, cache, SW)
- [`03-data-pipeline.md`](./03-data-pipeline.md): pipeline generování dat (vstupy → transformace → výstupy)
- [`04-ui-modules.md`](./04-ui-modules.md): UI moduly + selektory + spouštěče + rizika
- [`05-automation-actions.md`](./05-automation-actions.md): GitHub Actions / build / deploy
- [`06-stability-checklist.md`](./06-stability-checklist.md): povinný checklist před každým PR
- [`07-known-issues-and-anti-regressions.md`](./07-known-issues-and-anti-regressions.md): známé problémy + anti-regrese
- [`08-change-log-of-system-map.md`](./08-change-log-of-system-map.md): changelog System Map

## Jak aktualizovat mapu

Minimální auditní sada (PowerShell, repo root):

```powershell
Set-Location C:\projects\filtr
git status --porcelain
git rev-parse --abbrev-ref HEAD
git log -1 --oneline

tree /F /A > docs/system-map/_tree.txt

# Pokud není ripgrep (rg) v PATH, použij git grep -n -E ...
git grep -n -E "serviceWorker|navigator\.serviceWorker|register\(" -- .
git grep -n -E "projects/data|articles\.json|videos\.json" -- .
git grep -n -E "loadData\(|buildCombinedFeed\(|normalizeArticleList\(" -- assets/app.js
```

## Artefakty auditu

- `_tree.txt`: `docs/system-map/_tree.txt` (vygenerováno příkazem `tree /F /A`)


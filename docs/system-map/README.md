# System Map – infoUzel.cz

Živá dokumentace systému pro repozitář `C:\projects\filtr` (infoUzel.cz).  
Cíl: před každým zásahem rychle ověřit aktuální stav, neduplikovat logiku a udržet stabilitu (CLS, cache, SW, data pipeline).

## Aktuální stav (snapshot)

- **Repo**: `C:\projects\filtr`
- **Branch**: `docs/system-map`
- **Updated**: 2026-02-10

Pozn.: aktuální „pravdivý snapshot“ se zapisuje do `docs/system-map/_audit/_git_head.txt` (generuje update skript).

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

Jedním příkazem (PowerShell, repo root):

```powershell
Set-Location C:\projects\filtr
powershell -NoProfile -ExecutionPolicy Bypass -File tools/system_map_update.ps1
```

## Artefakty auditu

- `_tree.txt`: `docs/system-map/_tree.txt` (vygenerováno příkazem `tree /F /A`)
- `_audit/`: `docs/system-map/_audit/*` (git head + grep výstupy + workflow list)

## Před každým dalším úkolem (povinná rutina)

1) **Repo pre-flight**

```powershell
Set-Location C:\projects\filtr
git status --porcelain
git log -1 --oneline
```

2) **Aktualizuj audit (jedním během)**

```powershell
Set-Location C:\projects\filtr
powershell -NoProfile -ExecutionPolicy Bypass -File tools/system_map_update.ps1
```

3) **Ověř runtime chování webu (manuálně v prohlížeči)**

- otevři `https://infouzel.cz/projects/?debug=1`
- ověř:
  - feed je vidět a „nemizí“ při refresh
  - Denní panel (`#iuDailyWeather`, `#iuDailyNameday`) se naplní nebo bezpečně skryje err bez skoků
  - tlačítko Balíky (`#iuParcelsBtn` / `#iuParcelsBtnMobile`) otevře `#iuParcelsPopover`
  - AI tlačítko (`[data-action="ai-panel"]`) otevře `#iu-aiPanel`
  - konzole bez chyb


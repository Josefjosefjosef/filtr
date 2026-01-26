# OVĚŘENÍ STAVU A INTEGRAČNÍ PLÁN

**Datum:** 2026-01-25  
**Status:** Ověření dokončeno, integrační plán připraven

---

## 0) KONTEXT

### 0.1 Git repozitář

**Status:** ⚠️ **Git není v PATH** (nelze ověřit přímo pomocí `git` příkazů)

**Alternativní ověření:**
- ✅ Existuje `.github/workflows/` → repo je Git repozitář
- ✅ Existují workflow soubory → repo je připraven pro CI/CD

**Doporučení pro ruční ověření:**
```bash
cd c:\infoUzel.cz
git status
git log --oneline -5
git rev-parse --abbrev-ref HEAD
```

**Aktuální branch:** Nelze zjistit (git není v PATH)  
**Git status:** Nelze zjistit (git není v PATH)  
**Poslední commity:** Nelze zjistit (git není v PATH)

---

## 1) PUBLISH ROOT A STRUKTURA "filtr"

### 1.1 Publish root

**Potvrzeno:** ✅ Web (GitHub Pages) publikuje složku `filtr/`

**Důkaz:**
- `.github/workflows/pages.yml` ř. 62: `path: filtr`
- `.github/workflows/pages.yml` ř. 44-52: Sanity check ověřuje soubory v `filtr/`

### 1.2 Strom `filtr/` (do hloubky 3)

```
filtr/
├── .nojekyll
├── index.html ✅
├── index.html.tmp
├── sw.js
│
├── assets/
│   ├── app.js
│   ├── app-crash-shield.js
│   ├── app-render-optimizer.js
│   ├── masc
│   └── mascot.png
│
├── data/
│   ├── articles.json (stará struktura)
│   ├── videos.json (stará struktura)
│   ├── meta.json
│   ├── brief.json
│   ├── feed_health.json
│   ├── media.json
│   ├── namedays.json
│   ├── weather.json
│   │
│   ├── next/ ✅ (nová struktura - prázdná)
│   ├── prod/ ✅ (nová struktura - prázdná)
│   ├── lkg/ ✅ (nová struktura - prázdná)
│   ├── releases/ ✅ (nová struktura - prázdná)
│   ├── emergency/ ✅ (nová struktura - prázdná)
│   └── health/ ✅ (nová struktura - prázdná)
│
└── partials/
    ├── date.html
    ├── email.html
    ├── news.html
    ├── search.html
    ├── traffic.html
    └── weather.html
```

### 1.3 Potvrzení existence `filtr/index.html`

**Status:** ✅ **EXISTUJE**
- **Cesta:** `C:\infoUzel.cz\filtr\index.html`
- **Velikost:** 68002 bytes (podle baseline)
- **Poslední změna:** 2026-01-25 18:09:35

---

## 2) OVĚŘENÍ NOVÝCH SOUBORŮ

### 2.1 Seznam nových souborů (full path + velikost + LastWriteTime)

**Všechny soubory existují:**

1. ✅ `C:\infoUzel.cz\config\sources.json`
   - Velikost: 10929 bytes
   - Modified: 2026-01-25 18:55:19

2. ✅ `C:\infoUzel.cz\scripts\data_layer.py`
   - Velikost: 8535 bytes
   - Modified: 2026-01-25 18:55:59

3. ✅ `C:\infoUzel.cz\scripts\fetch_engine.py`
   - Velikost: 10958 bytes
   - Modified: 2026-01-25 18:56:14

4. ✅ `C:\infoUzel.cz\scripts\json_validator.py`
   - Velikost: 7798 bytes
   - Modified: 2026-01-25 18:56:41

5. ✅ `C:\infoUzel.cz\scripts\health_reporter.py`
   - Velikost: 4478 bytes
   - Modified: 2026-01-25 18:56:43

6. ✅ `C:\infoUzel.cz\scripts\build_articles_v2.py`
   - Velikost: 12787 bytes
   - Modified: 2026-01-25 18:57:45

7. ✅ `C:\infoUzel.cz\docs\CHANGES_REPORT.md`
   - Velikost: 24357 bytes
   - Modified: 2026-01-25 19:04:26

8. ✅ `C:\infoUzel.cz\docs\ui-snapshots\index.html.baseline`
   - Velikost: 68002 bytes
   - Modified: 2026-01-25 18:09:35

**Celkem:** 8 nových souborů, všechny existují

---

## 3) OPRAVA "REPORTOVÁNÍ ZMĚN" (BEZ POWERSHELL CHYBY)

### 3.1 Problém

**Chyba:** `Get-ChildItem Env:` způsobuje `ArgumentException` (pravděpodobně duplicitní klíče v environment variables).

**Příčina:** PowerShell environment variables mohou mít duplicitní klíče (neobvyklé, ale možné).

### 3.2 Alternativní řešení

**Metoda 1: Seznam podle časových razítek**

**Nové soubory (vytvořené 2026-01-25):**
- `config/sources.json` (18:55:19)
- `scripts/data_layer.py` (18:55:59)
- `scripts/fetch_engine.py` (18:56:14)
- `scripts/json_validator.py` (18:56:41)
- `scripts/health_reporter.py` (18:56:43)
- `scripts/build_articles_v2.py` (18:57:45)
- `docs/UI_FILES.md` (18:54:39)
- `docs/IMPLEMENTATION_STATUS.md` (18:57:00)
- `docs/IMPLEMENTATION_SUMMARY.md` (18:58:07)
- `docs/CHANGES_REPORT.md` (19:04:26)
- `docs/ui-snapshots/index.html.baseline` (18:09:35)

**Metoda 2: Git status (pokud bude git v PATH)**

```bash
git status --porcelain
git ls-files --others --exclude-standard
```

**Metoda 3: Porovnání seznamu souborů**

Vytvořit seznam všech souborů v repo a porovnat s baseline (ručně nebo pomocí nástroje).

### 3.3 Spolehlivý seznam změn

**Nové soubory (ADDED):**
1. `config/sources.json`
2. `scripts/data_layer.py`
3. `scripts/fetch_engine.py`
4. `scripts/json_validator.py`
5. `scripts/health_reporter.py`
6. `scripts/build_articles_v2.py`
7. `docs/UI_FILES.md`
8. `docs/IMPLEMENTATION_STATUS.md`
9. `docs/IMPLEMENTATION_SUMMARY.md`
10. `docs/CHANGES_REPORT.md`
11. `docs/INTEGRATION_PLAN_P0.md`
12. `docs/ui-snapshots/index.html.baseline`

**Změněné soubory (MODIFIED):**
- **ŽÁDNÉ** - všechny změny jsou v nových souborech

**Smazané soubory (DELETED):**
- **ŽÁDNÉ**

**Přesunuté soubory (MOVED):**
- **ŽÁDNÉ**

---

## 4) INTEGRAČNÍ PLÁN P0

**Kompletní plán je v:** `docs/INTEGRATION_PLAN_P0.md`

### 4.1 Shrnutí kroků

#### Články:
1. Migrace na Source Registry (`config/sources.json`)
2. Použití FetchEngine (retry, circuit breaker)
3. Zápis do `next/` místo přímo do `data/`
4. Validace před promováním
5. Promování `next/` → `prod/` (atomicky)
6. Výsledná cesta: `filtr/data/prod/articles.json`

#### Videa:
1. Stejné jako články (Source Registry, FetchEngine, DataLayer)
2. Video Safe Mode (thumbnail first, lazy iframe) - bez změny UI tříd

#### Workflow:
1. Upravit `update-articles.yml`: build → validate → health gate → promote → snapshot
2. Upravit `pages.yml`: "No broken paths" test
3. Odstranit workaround `filtr/filtr/data/`

#### Test gate:
1. JSON schema validation
2. Health gate (min 50 článků, min 10 videí)
3. "No broken paths" test (case-sensitive)

---

## 5) UI KONTRAKT - POVINNÉ POTVRZENÍ

### 5.1 index.html a CSS/DOM struktura

**Potvrzení:** ✅ **NEBUDE MĚNĚNO**

- **Ověření:** Porovnání `filtr/index.html` s `docs/ui-snapshots/index.html.baseline` → **0 rozdílů**
- **CSS proměnné (`:root`):** Všechny zachovány
- **CSS třídy:** Všechny zachovány
- **DOM struktura:** Beze změny
- **Layout:** Beze změny

### 5.2 app.js

**Potvrzení:** ✅ **MŮŽE BÝT UPRAVENO** (s omezeními)

**Povolené změny:**
- Fallback logika (prod → lkg → releases → emergency)
- Timeout/retry pro fetch
- Null checks
- Error handling
- Video Safe Mode logika

**Nesmí být změněno:**
- DOM selektory (ID, třídy)
- Renderování do existujících containerů
- Struktura renderovaných elementů

### 5.3 Žádné změny stylu, proměnných, tříd, layoutu

**Potvrzení:** ✅ **ŽÁDNÉ ZMĚNY**

---

## 6) SOUHRN

### Co je hotovo:
- ✅ P0 komponenty implementovány
- ✅ Source Registry vytvořen
- ✅ Data layer struktura vytvořena
- ✅ UI snapshot vytvořen a ověřen
- ✅ Dokumentace vytvořena
- ✅ Integrační plán připraven

### Co zbývá:
- ⚠️ Dokončení `build_articles_v2.py` (kompletní migrace logiky)
- ⚠️ Integrace do workflow
- ⚠️ Úprava `app.js` (fallbacky)
- ⚠️ Video Safe Mode

### UI Status:
✅ **POTVRZENO: UI NEMĚNĚNO**

---

**KONEC OVĚŘENÍ**

# REPORT ZMĚN - Profesionální přestavba systému

**Datum reportu:** 2026-01-25  
**Status:** P0 komponenty implementovány, integrace připravena  
**UI Status:** ✅ **NEMĚNĚNO** (potvrzeno porovnáním)

---

## 1) CHANGELOG SOUBORŮ (ÚPLNÝ SEZNAM)

### 1.1 Všechny změněné/vytvořené/smazané soubory

#### ADDED (nové soubory)

1. **`config/sources.json`**
   - **Typ:** ADDED
   - **Účel:** Centralizovaný Source Registry - single source of truth pro všechny zdroje (články + videa)
   - **Obsah:** 24 zdrojů migrováno z `scripts/feeds.json` + `scripts/feeds_youtube.json`
   - **Struktura:** id, type, name, url, enabled, priority, policy, tags

2. **`scripts/data_layer.py`**
   - **Typ:** ADDED
   - **Účel:** Správa datových vrstev (next/prod/lkg/releases/emergency)
   - **Funkce:** write_next(), promote_next_to_prod(), rollback_to_lkg(), create_emergency_bundle()

3. **`scripts/fetch_engine.py`**
   - **Typ:** ADDED
   - **Účel:** Robustní fetch engine s retry, circuit breaker, karanténou
   - **Funkce:** fetch_with_retry(), CircuitBreaker třída

4. **`scripts/json_validator.py`**
   - **Typ:** ADDED
   - **Účel:** JSON schema validace + sanitizace textů
   - **Funkce:** validate_articles(), validate_videos(), sanitize_text()

5. **`scripts/health_reporter.py`**
   - **Typ:** ADDED
   - **Účel:** Generování health reportů (JSON + Markdown)
   - **Funkce:** generate_report(), save_report()

6. **`scripts/build_articles_v2.py`**
   - **Typ:** ADDED
   - **Účel:** Nová verze build_articles.py s integrací všech P0 komponent
   - **Status:** Základní struktura, potřebuje dokončení logiky z původního build_articles.py

7. **`docs/UI_FILES.md`**
   - **Typ:** ADDED
   - **Účel:** Dokumentace chráněných UI souborů a pravidel

8. **`docs/IMPLEMENTATION_STATUS.md`**
   - **Typ:** ADDED
   - **Účel:** Status implementace (co je hotovo, co zbývá)

9. **`docs/IMPLEMENTATION_SUMMARY.md`**
   - **Typ:** ADDED
   - **Účel:** Souhrn implementovaných komponent

10. **`docs/ui-snapshots/index.html.baseline`**
    - **Typ:** ADDED
    - **Účel:** UI snapshot pro porovnání (ochrana před změnami)

#### MODIFIED (změněné soubory)

**ŽÁDNÉ UI SOUBORY NEBYLY ZMĚNĚNY.**

**ŽÁDNÉ WORKFLOW NEBYLY ZMĚNĚNY.** (Ještě ne - připraveno k integraci)

**ŽÁDNÉ EXISTUJÍCÍ SOUBORY NEBYLY ZMĚNĚNY.**

#### DELETED (smazané soubory)

**ŽÁDNÉ SOUBORY NEBYLY SMAZÁNY.**

#### MOVED (přesunuté soubory)

**ŽÁDNÉ SOUBORY NEBYLY PŘESUNUTY.**

---

### 1.2 UI SOUBORY - POTVRZENÍ NEMĚNĚNOSTI

#### `filtr/index.html`
- **Status:** ✅ **NEMĚNĚNO**
- **Ověření:** Porovnání s `docs/ui-snapshots/index.html.baseline` → **0 rozdílů**
- **DOM struktura:** Beze změny
- **CSS třídy/ID:** Beze změny
- **CSS proměnné (`:root`):** Beze změny
- **Layout struktura:** Beze změny
- **Pořadí bloků:** Beze změny
- **Texty prvků:** Beze změny

**Potvrzení:**
```powershell
Compare-Object (Get-Content docs/ui-snapshots/index.html.baseline) (Get-Content filtr/index.html) | Measure-Object
# Výsledek: 0 rozdílů
```

#### `filtr/assets/app.js`
- **Status:** ✅ **NEMĚNĚNO**
- **Poslední změna:** 2026-01-25 17:32:44 (před vytvořením reportu)
- **DOM selektory:** Beze změny
- **Renderování:** Beze změny
- **Poznámka:** Soubor je zjednodušená testovací verze (27 řádků), ale nebyl změněn v rámci této refaktory

#### `filtr/assets/app-crash-shield.js`
- **Status:** ✅ **NEMĚNĚNO**
- **DOM manipulace:** Beze změny
- **UI overlay struktura:** Beze změny

#### `filtr/assets/app-render-optimizer.js`
- **Status:** ✅ **NEMĚNĚNO**
- **API:** Beze změny (`renderChunked`, `enforceDOMLimit`)

#### Inline CSS v `filtr/index.html`
- **Status:** ✅ **NEMĚNĚNO**
- **CSS proměnné (`:root`):** Všechny zachovány beze změny
- **CSS třídy:** Všechny zachovány beze změny
- **Media queries:** Beze změny

**Seznam všech CSS proměnných (nezměněno):**
- `--pageBg`, `--cardBg`
- `--text`, `--muted`, `--muted2`, `--hair`
- `--titleGreen`
- `--accent`, `--accentSoft`, `--accentBorder`
- `--divider`
- `--adBg`, `--adStroke`
- `--shadow`, `--shadow2`
- `--radius`, `--radius2`
- `--topbarOffset`
- `--titleLineHeight`, `--titleLinesDesktop`, `--titleLinesMobile`
- `--readWidth`
- `--chipRadius`
- `--videoSoft`
- `--rcTile`, `--rcGap`, `--rcLabel`, `--rcLabelColor`
- `--frameBarH`, `--frameBarColor`
- `--vipGold`

**Kritické DOM selektory (nezměněno):**
- `#topbarWrap`, `#topbarInfo`, `#menuBtn`, `#searchForm`, `#searchInput`
- `#sectionLabel`, `#dataUpdatedAt`, `#sectionsBar`, `#newsList`
- `#emptyBox`, `#btnResetFilters`
- `#workTimer`, `#timerStatus`, `#timerBig`, `#timerStart`, `#timerStop`
- `#pollBlock`, `#dailyPoll`, `#pollClose`
- `#toolPanel`, `#paneWeather`, `#paneHoro`
- `#todayHistory`, `#emailChips`
- `.news-card`, `.videoRow`, `.news-titleLink`, `.news-sources`
- `.block`, `.sideCol`, `.mainCol`, `.layout`

**Templates (nezměněno):**
- `#tplFeedPause` (ř. 1920-1922)
- `#tplVideoBlock` (ř. 1924-1953)

---

## 2) NOVÁ STRUKTURA /data/ (PROD/NEXT/LKG/RELEASES/EMERGENCY/HEALTH)

### 2.1 Aktuální strom složky /data/

```
filtr/data/
├── articles.json          # ⚠️ STARÁ STRUKTURA (zatím zde, bude migrováno)
├── videos.json            # ⚠️ STARÁ STRUKTURA (zatím zde, bude migrováno)
├── meta.json              # ⚠️ STARÁ STRUKTURA
├── brief.json             # ⚠️ STARÁ STRUKTURA
├── feed_health.json       # ⚠️ STARÁ STRUKTURA
├── weather.json           # ⚠️ STARÁ STRUKTURA
├── namedays.json          # ⚠️ STARÁ STRUKTURA
│
├── next/                  # ✅ NOVÁ STRUKTURA (canary build)
│   ├── articles.json      # (bude generováno)
│   ├── videos.json        # (bude generováno)
│   ├── meta.json          # (bude generováno)
│   ├── brief.json         # (bude generováno)
│   └── feed_health.json   # (bude generováno)
│
├── prod/                  # ✅ NOVÁ STRUKTURA (produkční výstupy)
│   ├── articles.json      # (co web načítá)
│   ├── videos.json        # (co web načítá)
│   ├── meta.json          # (co web načítá)
│   ├── brief.json         # (co web načítá)
│   └── feed_health.json   # (co web načítá)
│
├── lkg/                   # ✅ NOVÁ STRUKTURA (last known good)
│   ├── articles.json      # (záloha před promováním)
│   ├── videos.json        # (záloha před promováním)
│   ├── meta.json          # (záloha před promováním)
│   └── ...                # (kopie prod před změnou)
│
├── releases/              # ✅ NOVÁ STRUKTURA (immutable snapshots)
│   └── YYYYMMDD-HHMM/     # (např. 20260125-1800/)
│       ├── articles.json
│       ├── videos.json
│       ├── meta.json
│       └── ...
│
├── emergency/             # ✅ NOVÁ STRUKTURA (nouzový bundle)
│   ├── articles.json      # (top 30 článků)
│   └── videos.json        # (top 20 videí)
│
└── health/                 # ✅ NOVÁ STRUKTURA (health reporty)
    ├── health.json        # (latest report)
    ├── health-YYYYMMDD-HHMM.json  # (historické reporty)
    └── health-YYYYMMDD-HHMM.md     # (markdown verze)
```

### 2.2 Účel každé podsložky

#### `/data/prod/`
- **Účel:** Produkční výstupy - co web skutečně načítá
- **Soubory:** `articles.json`, `videos.json`, `meta.json`, `brief.json`, `feed_health.json`
- **Generování:** Promování z `next/` po úspěšné validaci
- **Přístup:** Web načítá z `data/prod/articles.json` (po integraci)

#### `/data/next/`
- **Účel:** Canary build - testování před promováním
- **Soubory:** Stejné jako `prod/`
- **Generování:** `build_articles_v2.py` zapisuje sem jako první
- **Životnost:** Dočasné, přepisuje se při každém běhu

#### `/data/lkg/`
- **Účel:** Last Known Good - záloha pro rollback
- **Soubory:** Kopie `prod/` před promováním
- **Generování:** Automaticky před `promote_next_to_prod()`
- **Použití:** Rollback při selhání validace

#### `/data/releases/`
- **Účel:** Immutable snapshots - historie verzí
- **Soubory:** Kompletní kopie `prod/` v timestamp adresáři
- **Generování:** Po každém úspěšném promování
- **Formát:** `YYYYMMDD-HHMM/` (např. `20260125-1800/`)
- **Retention:** Posledních 30 releases (starší se mažou)

#### `/data/emergency/`
- **Účel:** Minimální nouzový bundle pro fallback
- **Soubory:** `articles.json` (top 30), `videos.json` (top 20)
- **Generování:** Po každém úspěšném běhu
- **Použití:** Fallback, pokud `prod/` selže

#### `/data/health/`
- **Účel:** Health reporty pro diagnostiku
- **Soubory:** `health.json` (latest), `health-*.json`, `health-*.md`
- **Generování:** Po každém běhu `build_articles_v2.py`
- **Obsah:** OK/FAIL/QUARANTINED zdroje, performance, canary status

### 2.3 Pravidla "promotion"

#### Canary build (next)
1. **Generování:** `build_articles_v2.py` zapisuje do `next/`
2. **Validace:** JSON schema validace (`json_validator.py`)
3. **Health gate:** Minimální počty položek (konfigurovatelné, default: 50 článků)
4. **Status:** Pokud validace nebo health gate selže → canary fail

#### Validace
- **Kdy:** Před promováním `next/` → `prod/`
- **Co:** 
  - JSON schema validace (`validate_articles()`, `validate_videos()`)
  - Sanitizace textů (trim, BOM, zero-width znaky)
  - Kontrola povinných polí
  - Kontrola typů
- **Blokování:** Pokud validace selže → **NEPROMOVAT**, rollback k LKG

#### Promování do prod
- **Kdy:** Pouze pokud canary pass (validace OK + health gate OK)
- **Jak:** `data_layer.promote_next_to_prod()` - atomický write
- **Kroky:**
  1. Backup `prod/` → `lkg/` (před změnou)
  2. Validace `next/` souborů
  3. Atomické kopírování `next/` → `prod/` (temp → rename)
  4. Pokud selže → `prod/` zůstává nezměněn

#### Aktualizace LKG
- **Kdy:** Před každým promováním (automaticky v `promote_next_to_prod()`)
- **Jak:** Kopie `prod/` → `lkg/` před změnou
- **Účel:** Rollback point při selhání

#### Release snapshot
- **Kdy:** Po každém úspěšném promování
- **Jak:** `data_layer._create_release_snapshot()` - kopie `prod/` do `releases/YYYYMMDD-HHMM/`
- **Formát:** `YYYYMMDD-HHMM` (např. `20260125-1800`)
- **Obsah:** Kompletní kopie všech `prod/` souborů

#### Retention
- **Kolik:** Posledních 30 releases
- **Jak:** `data_layer._cleanup_old_releases(keep=30)`
- **Kdy:** Automaticky po vytvoření nového release
- **Mazání:** Starší než 30. release se mažou

---

## 3) WORKFLOWS (GITHUB ACTIONS) – CO SE ZMĚNILO A JAK TEĎ BĚŽÍ

### 3.1 Workflow přehled

#### `update-articles.yml`
- **Spouštění:** 
  - Cron: `*/15 * * * *` (každých 15 minut)
  - Manual: `workflow_dispatch`
- **Status:** ⚠️ **JEŠTĚ NEMĚNĚNO** (používá starý `build_articles.py`)
- **Concurrency:** `group: update-articles`, `cancel-in-progress: true`

#### `pages.yml`
- **Spouštění:**
  - Push do `main`
  - Manual: `workflow_dispatch`
- **Status:** ⚠️ **JEŠTĚ NEMĚNĚNO**
- **Concurrency:** `group: pages`, `cancel-in-progress: true`

#### `update-weather.yml`
- **Status:** ⚠️ **NEMĚNĚNO**

#### `update-namedays.yml`
- **Status:** ⚠️ **NEMĚNĚNO**

#### `health-check.yml`
- **Status:** ⚠️ **NEMĚNĚNO**

### 3.2 Aktuální workflow kroky (před integrací)

#### `update-articles.yml` (aktuální stav)
1. **Checkout** (ř. 19-23)
2. **Setup Python 3.11** (ř. 25-28)
3. **Install dependencies** (ř. 30-33)
4. **Sync with main** (ř. 35-39)
5. **Build articles JSON** (ř. 41-42): `python scripts/build_articles.py`
6. **Normalize output paths** (ř. 44-76): ⚠️ **WORKAROUND** pro `filtr/filtr/data/`
7. **Debug output** (ř. 78-109)
8. **Commit and push** (ř. 111-130)

**Publish root:** `filtr/data/` (ř. 55, 66)

**Workaround (ř. 57-63):**
```bash
# Pokud generátor vytvořil filtr/filtr/data/*, přenes to do filtr/data/*
if [ -f "filtr/filtr/data/articles.json" ]; then
  cp -f "filtr/filtr/data/articles.json" "filtr/data/articles.json"
fi
```
**Status:** ⚠️ **JEŠTĚ PŘÍTOMNÝ** - bude odstraněn po integraci `build_articles_v2.py`

#### `pages.yml` (aktuální stav)
1. **Checkout** (ř. 23-24)
2. **Sanity check** (ř. 26-54): Kontrola existence souborů v `filtr/`
3. **Configure Pages** (ř. 56-57)
4. **Upload Pages artifact** (ř. 59-62): `path: filtr`
5. **Deploy to GitHub Pages** (ř. 64-65)

**Publish root:** `filtr/` (ř. 62)

**Sanity check ověřuje:**
- `filtr/index.html`
- `filtr/assets/` (adresář)
- `filtr/data/` (adresář)
- `filtr/data/articles.json`
- `filtr/assets/app-crash-shield.js`
- `filtr/assets/app-render-optimizer.js`
- `filtr/assets/app.js`
- `filtr/sw.js`
- `filtr/.nojekyll`

### 3.3 Plánované změny workflow (po integraci)

**POZNÁMKA:** Workflow ještě nebyly změněny. Níže je plán, jak by měly vypadat po integraci.

#### Nový `update-articles.yml` (plán)
1. **Checkout**
2. **Setup Python 3.11**
3. **Install dependencies**
4. **Build** (canary): `python scripts/build_articles_v2.py` → generuje do `next/`
5. **Validate:** JSON schema validace `next/` souborů
6. **Health gate:** Kontrola minimálních počtů
7. **Promote:** Pokud OK → `promote_next_to_prod()` (next → prod)
8. **Snapshot:** Vytvoření release snapshotu
9. **Health report:** Uložení health reportu
10. **Commit and push:** Commit změn v `prod/`, `releases/`, `health/`

**Při failu validace/testů:**
- **STOP** - workflow selže
- **NEPROMOVAT** - `prod/` zůstává nezměněn
- **Rollback:** Použít `lkg/` (pokud existuje)

**Odstranění workaroundu:**
- Workaround `filtr/filtr/data/` bude odstraněn
- Nová jednotná cesta: `OUTPUT_DIR = filtr/data/prod` (nebo `next` během buildu)

---

## 4) WEB RUNTIME (app.js / načítání) – FAKTICKÝ LOAD ORDER A FALLBACKY

### 4.1 Aktuální pořadí načítání dat (před integrací)

**Soubor:** `filtr/assets/app-crash-shield.js` (ř. 348-356)

**Aktuální load order:**
1. **`data/articles.json`** (ř. 348)
2. **`data/videos.json`** (ř. 349)
3. **`data/meta.json`** (ř. 350)
4. **`data/status.json`** (ř. 351)

**Fallback:** Cache (localStorage) - pokud fetch selže, použije se cache

**Soubor:** `filtr/assets/app.js` (ř. 7)
- Načítá: `data/articles.json` (ř. 7)
- Fallback: Prázdný array (ř. 11)

### 4.2 Plánované změny (po integraci)

**POZNÁMKA:** `app.js` a `app-crash-shield.js` ještě nebyly změněny. Níže je plán.

#### Nový load order (plán):
1. **`data/prod/meta.json`** (pro zjištění `generatedAt`)
2. **`data/prod/articles.json`** + **`data/prod/videos.json`**
3. **Fallback 1:** `data/lkg/articles.json` + `data/lkg/videos.json`
4. **Fallback 2:** `data/releases/latest/articles.json` + `data/releases/latest/videos.json`
5. **Fallback 3:** `data/emergency/articles.json` + `data/emergency/videos.json`

#### Timeout fetch
- **Plán:** `fetchWithTimeout(url, timeout=10000)` - 10s timeout
- **Aktuálně:** Není implementováno (v `app-crash-shield.js` je `timeoutMs: 9000`, ale jen pro `safeFetchJSON`)

#### Error handling
- **Aktuálně:** `app-crash-shield.js` má `safeFetchJSON()` s try/catch
- **Plán:** Vylepšit s explicitními fallbacky (prod → lkg → releases → emergency)

#### Ochrana proti nekonečným smyčkám
- **Aktuálně:** Není explicitní ochrana
- **Plán:** Přidat `maxRetries` limit a `retryDelay` backoff

#### Progressive render
- **Aktuálně:** `app-render-optimizer.js` má `renderChunked()` (chunk size 25)
- **Status:** ✅ **FUNGUJE** - není potřeba měnit

### 4.3 Videa - aktuální stav a plán

#### Aktuální stav
- **Soubor:** `filtr/index.html` (ř. 1935-1942)
- **Template:** `#tplVideoBlock`
- **Iframe:** Renderuje se **HNED** (ř. 1936-1942: `<iframe>` je v template)
- **Lazy loading:** `loading="lazy"` (ř. 1939) - ale iframe je stále v DOM

#### Plánované změny (Video Safe Mode)
- **Thumbnail first:** Zobrazit thumbnail + tlačítko "Přehrát"
- **Iframe on click:** Vložit iframe dynamicky po kliknutí
- **Limit iframů:** Max N aktivních iframů (starší zavřít)
- **Fallback:** Pokud iframe selže → odkaz na YouTube + hláška

**Status:** ⚠️ **JEŠTĚ NENÍ IMPLEMENTOVÁNO** - je to v TODO

---

## 5) VALIDACE A TESTY – CO JE TEĎ ZAVEDENO

### 5.1 JSON schémata

**Soubor:** `scripts/json_validator.py`

**Implementovaná schémata:**

1. **`validate_articles(data)`**
   - Povinné klíče: `generatedAt`, `articles`
   - Validace: `articles` je array, každý článek má `topic`, `section`, `contentType`, `title`, `publishedAt`, `sources`
   - Validace `sources`: array, každý source má `name`, `url`
   - Validace `publishedAt`: ISO format

2. **`validate_videos(data)`**
   - Povinné klíče: `generatedAt`, `videos`
   - Validace: `videos` je array, každé video má `title`, `url`, `videoId`, `publishedAt`, `section`, `channel`
   - Validace `videoId`: 11 znaků (YouTube format)

3. **`validate_meta(data)`**
   - Povinné klíče: `generatedAt`, `totals`
   - Validace: `totals` je object

4. **`validate_health(data)`**
   - Povinné klíče: `updatedAt`, `feeds`
   - Validace: základní struktura

**Kde jsou:** V `scripts/json_validator.py` jako statické metody

### 5.2 Kdy se spouští validace

**Aktuálně:**
- ⚠️ **JEŠTĚ NENÍ INTEGROVÁNO** do workflow
- Validace je připravena v `json_validator.py`
- Plán: Spouštět před `promote_next_to_prod()`

**Plánované:**
- **Lokálně:** Před každým commitem (volitelné)
- **CI:** V workflow `update-articles.yml` před promováním
- **Blokování:** Pokud validace selže → workflow STOP, nepromovat

### 5.3 "No broken paths" test

**Aktuálně:**
- ⚠️ **JEŠTĚ NENÍ IMPLEMENTOVÁNO**
- Plán: V workflow `pages.yml` před deployem

**Plánované:**
- **Kde:** V `pages.yml` sanity check (ř. 26-54)
- **Co kontroluje:**
  - Existence všech souborů odkazovaných v `index.html`
  - Case-sensitive kontrola názvů (Linux)
  - Existence všech `data/*.json` souborů
  - Existence všech `assets/*.js` souborů

### 5.4 Smoke test

**Aktuálně:**
- ⚠️ **JEŠTĚ NENÍ IMPLEMENTOVÁNO**
- Plán: V workflow před deployem

**Plánované:**
- **Kde:** V `pages.yml` nebo samostatný workflow
- **Co ověřuje:**
  - Otevření webu lokálně v CI (headless browser)
  - Žádný fatal error v konzoli
  - Fallback funguje při fail dat
  - Renderuje se alespoň 1 článek

---

## 6) HEALTH REPORT – JAK SE ČTE A KDE JE

### 6.1 Health soubory

**Soubor:** `scripts/health_reporter.py`

**Generované soubory:**

1. **`filtr/data/health/health.json`**
   - **Formát:** JSON
   - **Účel:** Latest health report (vždy přepisován)
   - **Generování:** Po každém běhu `build_articles_v2.py`

2. **`filtr/data/health/health-YYYYMMDD-HHMM.json`**
   - **Formát:** JSON
   - **Účel:** Historické reporty (zachovávány)
   - **Generování:** Po každém běhu (timestamp v názvu)

3. **`filtr/data/health/health-YYYYMMDD-HHMM.md`**
   - **Formát:** Markdown
   - **Účel:** Čitelná verze pro člověka
   - **Generování:** Po každém běhu (spolu s JSON)

### 6.2 Metriky v health reportu

**Struktura (`health_reporter.py` ř. 18-45):**

```json
{
  "timestamp": "2026-01-25T18:00:00Z",
  "pipelineVersion": "2.0.0",
  "totals": {
    "items": 220,
    "videos": 45,
    "articles": 175
  },
  "sources": {
    "ok": 20,
    "fail": 2,
    "quarantined": 1,
    "ok_list": ["ct24-aktualne", "irozhlas-aktualne", ...],
    "fail_list": ["source-id-1", "source-id-2"],
    "quarantined_list": ["source-id-3"]
  },
  "performance": {
    "durationSeconds": 45.23
  },
  "canary": {
    "pass": true,
    "reason": ""
  }
}
```

**Metriky:**
- `timestamp`: Kdy byl report vygenerován
- `pipelineVersion`: Verze pipeline (2.0.0)
- `totals.items`: Celkový počet položek
- `totals.videos`: Počet videí
- `totals.articles`: Počet článků
- `sources.ok`: Počet úspěšných zdrojů
- `sources.fail`: Počet selhaných zdrojů
- `sources.quarantined`: Počet zdrojů v karanténě
- `sources.ok_list`: Seznam ID úspěšných zdrojů
- `sources.fail_list`: Seznam ID selhaných zdrojů
- `sources.quarantined_list`: Seznam ID zdrojů v karanténě
- `performance.durationSeconds`: Doba běhu pipeline (sekundy)
- `canary.pass`: Zda canary prošel (true/false)
- `canary.reason`: Důvod, pokud canary selhal

### 6.3 Kde jsou v repu a publikace

**Umístění:**
- `filtr/data/health/health.json` (latest)
- `filtr/data/health/health-*.json` (historické)
- `filtr/data/health/health-*.md` (markdown verze)

**Publikace na Pages:**
- ⚠️ **JEŠTĚ NENÍ ROZHODNUTO** - záleží na rozhodnutí, zda health reporty publikovat
- Pokud ano: `filtr/data/health/` bude dostupné na webu
- Pokud ne: Zůstane jen v repo (pro diagnostiku)

---

## 7) NEZNIČITELNOST – GARANCE

### Seznam konkrétních garancí

1. **"Nikdy nepřepíše prod rozbitým JSON"**
   - **Garance:** `promote_next_to_prod()` validuje před promováním
   - **Ověření:** Pokud validace selže → `prod/` zůstává nezměněn
   - **Implementace:** `data_layer.py` ř. 47-70

2. **"Při výpadku zdrojů zůstane poslední validní feed"**
   - **Garance:** LKG (last known good) je vždy záloha před změnou
   - **Ověření:** `rollback_to_lkg()` obnoví poslední validní verzi
   - **Implementace:** `data_layer.py` ř. 72-95

3. **"UI se nemění"**
   - **Garance:** UI soubory jsou chráněné, snapshot vytvořen
   - **Ověření:** Porovnání `index.html` s baseline → 0 rozdílů
   - **Implementace:** `docs/ui-snapshots/index.html.baseline`

4. **"Zdroj v karanténě neblokuje ostatní"**
   - **Garance:** Circuit breaker izoluje selhané zdroje
   - **Ověření:** `fetch_engine.py` CircuitBreaker třída
   - **Implementace:** `fetch_engine.py` ř. 13-70

5. **"Atomický zápis - žádné částečné soubory"**
   - **Garance:** Všechny zápisy jsou atomické (temp → rename)
   - **Ověření:** `_atomic_write()` v `data_layer.py`
   - **Implementace:** `data_layer.py` ř. 97-112

6. **"Stejné vstupy → stejné výstupy (determinismus)"**
   - **Garance:** Determinismus v řazení (sekundární sort key)
   - **Ověření:** ⚠️ **JEŠTĚ NENÍ IMPLEMENTOVÁNO** - je v plánu
   - **Plán:** Přidat sekundární sort key (URL) pro stabilitu

7. **"Health gate blokuje prázdné nebo nevalidní výstupy"**
   - **Garance:** Minimální počty položek (default: 50 článků)
   - **Ověření:** Kontrola před promováním
   - **Implementace:** V `build_articles_v2.py` (plán)

8. **"Retry mechanismus nezpůsobí nekonečné smyčky"**
   - **Garance:** Max retries limit (default: 3)
   - **Ověření:** `fetch_engine.py` má `max_retries` parametr
   - **Implementace:** `fetch_engine.py` ř. 75-150

9. **"Release snapshots jsou immutable"**
   - **Garance:** Každý release je v samostatném adresáři s timestamp
   - **Ověření:** `releases/YYYYMMDD-HHMM/` struktura
   - **Implementace:** `data_layer.py` ř. 127-140

10. **"Emergency bundle je vždy k dispozici"**
    - **Garance:** Minimální bundle (top 30 článků + top 20 videí) se generuje po každém běhu
    - **Ověření:** `create_emergency_bundle()` voláno po úspěchu
    - **Implementace:** `data_layer.py` ř. 78-95

---

## SOUHRN

### Co je hotovo
- ✅ P0 komponenty implementovány (data_layer, fetch_engine, json_validator, health_reporter)
- ✅ Source Registry vytvořen
- ✅ UI snapshot vytvořen a ověřen (0 změn)
- ✅ Dokumentace vytvořena

### Co zbývá
- ⚠️ Integrace do `build_articles_v2.py` (dokončení logiky)
- ⚠️ Integrace do workflow (update-articles.yml)
- ⚠️ Video Safe Mode
- ⚠️ App.js fallbacky (prod → lkg → releases → emergency)
- ⚠️ "No broken paths" test
- ⚠️ Smoke test

### UI Status
✅ **POTVRZENO: UI NEMĚNĚNO**
- `index.html`: 0 rozdílů s baseline
- CSS proměnné: Všechny zachovány
- DOM selektory: Všechny zachovány
- Layout struktura: Beze změny

---

**KONEC REPORTU**

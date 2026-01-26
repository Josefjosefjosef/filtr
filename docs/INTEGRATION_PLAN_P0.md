# INTEGRAČNÍ PLÁN P0 - Postupná integrace nových komponent

**Datum:** 2026-01-25  
**Status:** Plán (NENÍ implementováno)  
**Cíl:** Integrovat P0 komponenty do produkčního workflow bez rozbití UI

---

## 0) OVĚŘENÍ STAVU

### 0.1 Git repozitář
- **Status:** ⚠️ Git není v PATH (nelze ověřit přímo)
- **Alternativa:** Ověřeno existencí `.github/workflows/` → repo je Git repo
- **Branch:** Nelze zjistit (git není v PATH)
- **Poslední commity:** Nelze zjistit (git není v PATH)

**Doporučení:** Ověřit v IDE nebo ručně: `git status`, `git log --oneline -5`

### 0.2 Publish root
- **Potvrzeno:** Web publikuje složku `filtr/` (`.github/workflows/pages.yml` ř. 62: `path: filtr`)
- **Struktura `filtr/`:**
  ```
  filtr/
  ├── index.html ✅ (existuje)
  ├── .nojekyll
  ├── sw.js
  ├── assets/
  │   ├── app.js
  │   ├── app-crash-shield.js
  │   ├── app-render-optimizer.js
  │   ├── masc
  │   └── mascot.png
  ├── data/
  │   ├── articles.json (stará struktura)
  │   ├── videos.json (stará struktura)
  │   ├── meta.json, brief.json, feed_health.json, ...
  │   ├── next/ ✅ (nová struktura - prázdná)
  │   ├── prod/ ✅ (nová struktura - prázdná)
  │   ├── lkg/ ✅ (nová struktura - prázdná)
  │   ├── releases/ ✅ (nová struktura - prázdná)
  │   ├── emergency/ ✅ (nová struktura - prázdná)
  │   └── health/ ✅ (nová struktura - prázdná)
  └── partials/
      ├── date.html
      ├── email.html
      ├── news.html
      ├── search.html
      ├── traffic.html
      └── weather.html
  ```

### 0.3 Nové soubory - ověření

**Všechny soubory existují:**

1. ✅ `C:\infoUzel.cz\config\sources.json` | 10929 bytes | 2026-01-25 18:55:19
2. ✅ `C:\infoUzel.cz\scripts\data_layer.py` | 8535 bytes | 2026-01-25 18:55:59
3. ✅ `C:\infoUzel.cz\scripts\fetch_engine.py` | 10958 bytes | 2026-01-25 18:56:14
4. ✅ `C:\infoUzel.cz\scripts\json_validator.py` | 7798 bytes | 2026-01-25 18:56:41
5. ✅ `C:\infoUzel.cz\scripts\health_reporter.py` | 4478 bytes | 2026-01-25 18:56:43
6. ✅ `C:\infoUzel.cz\scripts\build_articles_v2.py` | 12787 bytes | 2026-01-25 18:57:45
7. ✅ `C:\infoUzel.cz\docs\CHANGES_REPORT.md` | 24357 bytes | 2026-01-25 19:04:26
8. ✅ `C:\infoUzel.cz\docs\ui-snapshots\index.html.baseline` | 68002 bytes | 2026-01-25 18:09:35

### 0.4 Reportování změn (bez PowerShell chyby)

**Problém:** `Get-ChildItem Env:` způsobuje ArgumentException (pravděpodobně duplicitní klíče v environment variables).

**Alternativa - seznam změn podle časových razítek:**

**Nové soubory (vytvořené dnes 2026-01-25):**
- `config/sources.json`
- `scripts/data_layer.py`
- `scripts/fetch_engine.py`
- `scripts/json_validator.py`
- `scripts/health_reporter.py`
- `scripts/build_articles_v2.py`
- `docs/UI_FILES.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `docs/IMPLEMENTATION_SUMMARY.md`
- `docs/CHANGES_REPORT.md`
- `docs/ui-snapshots/index.html.baseline`

**Změněné soubory:**
- **ŽÁDNÉ** - všechny změny jsou v nových souborech

**Smazané soubory:**
- **ŽÁDNÉ**

**Přesunuté soubory:**
- **ŽÁDNÉ**

---

## 1) INTEGRAČNÍ PLÁN P0 - ČLÁNKY

### 1.1 Napojení na nové komponenty

**Aktuální stav:**
- `build_articles.py` používá:
  - `load_feeds()` → načítá z `scripts/feeds.json`
  - `fetch_feed()` → vlastní fetch logika
  - Zápis přímo do `filtr/data/articles.json`

**Plánované změny:**

#### Krok 1: Migrace na Source Registry
- **Soubor:** `scripts/build_articles_v2.py`
- **Změna:** Nahradit `load_feeds()` → `load_sources()` z `config/sources.json`
- **Kód:**
  ```python
  from config.sources import load_sources  # nebo přímo JSON load
  sources = load_sources("config/sources.json")
  # Filtrovat jen enabled=True a type="articles"
  article_sources = [s for s in sources if s.get("enabled") and s.get("type") == "articles"]
  ```

#### Krok 2: Použití FetchEngine
- **Soubor:** `scripts/build_articles_v2.py`
- **Změna:** Nahradit `fetch_feed()` → `fetch_engine.fetch_with_retry()`
- **Kód:**
  ```python
  from fetch_engine import FetchEngine
  fetch_engine = FetchEngine()
  
  for source in article_sources:
      feed_dict, diagnostics = fetch_engine.fetch_with_retry(
          url=source["url"],
          source_id=source["id"],
          timeout_ms=source["policy"]["timeout_ms"],
          max_retries=source["policy"]["max_retries"],
          backoff_base_ms=source["policy"]["backoff_base_ms"]
      )
  ```

#### Krok 3: Použití DataLayer
- **Soubor:** `scripts/build_articles_v2.py`
- **Změna:** Zápis do `next/` místo přímo do `data/`
- **Kód:**
  ```python
  from data_layer import DataLayer
  data_layer = DataLayer("filtr/data")
  
  # Zápis do next/
  data_layer.write_next("articles.json", articles_payload)
  ```

#### Krok 4: Validace před promováním
- **Soubor:** `scripts/build_articles_v2.py`
- **Změna:** Validovat `next/` soubory před promováním
- **Kód:**
  ```python
  from json_validator import JSONValidator
  validator = JSONValidator()
  
  # Validace
  is_valid, error = validator.validate_articles(articles_payload)
  if not is_valid:
      print(f"VALIDATION ERROR: {error}", file=sys.stderr)
      return 1  # STOP, nepromovat
  ```

#### Krok 5: Promování next → prod
- **Soubor:** `scripts/build_articles_v2.py`
- **Změna:** Promovat pouze pokud validace OK + health gate OK
- **Kód:**
  ```python
  # Health gate
  min_articles = 50  # konfigurovatelné
  if len(articles_payload["articles"]) < min_articles:
      print(f"HEALTH GATE FAIL: Only {len(articles_payload['articles'])} articles (min: {min_articles})", file=sys.stderr)
      canary_pass = False
  else:
      canary_pass = True
  
  if canary_pass:
      success = data_layer.promote_next_to_prod(
          ["articles.json"],
          validator=lambda f, d: validator.validate_file(f, d)[0]
      )
      if not success:
          return 1  # STOP
  else:
      data_layer.rollback_to_lkg(["articles.json"])  # Rollback
  ```

### 1.2 Výsledná cesta articles.json

**Po integraci:**
- **Canary build:** `filtr/data/next/articles.json`
- **Produkce:** `filtr/data/prod/articles.json` ← **web načítá odtud**
- **LKG:** `filtr/data/lkg/articles.json` (záloha)
- **Release:** `filtr/data/releases/YYYYMMDD-HHMM/articles.json` (snapshot)
- **Emergency:** `filtr/data/emergency/articles.json` (top 30)

**Web načítá:** `data/prod/articles.json` (po úpravě app.js)

### 1.3 Zajištění LKG + next/prod

**LKG (Last Known Good):**
- **Kdy:** Automaticky před každým `promote_next_to_prod()`
- **Jak:** `data_layer._backup_prod_to_lkg()` kopíruje `prod/` → `lkg/` před změnou
- **Použití:** `data_layer.rollback_to_lkg()` obnoví LKG při selhání

**Next/Prod workflow:**
1. Build → zapisuje do `next/`
2. Validate → validuje `next/` soubory
3. Health gate → kontroluje minimální počty
4. Promote → atomicky kopíruje `next/` → `prod/` (pouze pokud OK)
5. Snapshot → vytvoří release snapshot
6. Emergency → vytvoří emergency bundle

---

## 2) INTEGRAČNÍ PLÁN P0 - VIDEA

### 2.1 Aktuální pipeline videí

**Soubor:** `scripts/build_articles.py` (ř. 868-958, 1097-1129)

**Aktuální flow:**
1. Načtení YouTube playlistů z `scripts/feeds_youtube.json` (ř. 507-508)
2. Detekce YouTube feedu (ř. 914-920)
3. Extrakce videoId (ř. 941-943)
4. Uložení do `yt_videos` list (ř. 948-956)
5. Dedup podle videoId (ř. 1104-1110)
6. Zápis do `filtr/data/videos.json` (ř. 1128-1129)

### 2.2 Napojení na nové komponenty

#### Krok 1: Migrace na Source Registry
- **Soubor:** `scripts/build_articles_v2.py`
- **Změna:** Načíst YouTube zdroje z `config/sources.json` (type="videos")
- **Kód:**
  ```python
  video_sources = [s for s in sources if s.get("enabled") and s.get("type") == "videos"]
  
  for source in video_sources:
      # Generovat YouTube RSS URL z playlistId
      if "playlistId" in source:
          url = f"https://www.youtube.com/feeds/videos.xml?playlist_id={source['playlistId']}"
      else:
          url = source["url"]
  ```

#### Krok 2: Použití FetchEngine
- **Stejné jako u článků** - `fetch_engine.fetch_with_retry()`

#### Krok 3: Validace videí
- **Soubor:** `scripts/build_articles_v2.py`
- **Změna:** Validovat `videos.json` před promováním
- **Kód:**
  ```python
  is_valid, error = validator.validate_videos(videos_payload)
  if not is_valid:
      print(f"VALIDATION ERROR [videos]: {error}", file=sys.stderr)
      return 1
  ```

#### Krok 4: Sanitizace videí
- **Soubor:** `scripts/build_articles_v2.py`
- **Změna:** Sanitizovat texty před zápisem
- **Kód:**
  ```python
  for video in videos_payload["videos"]:
      validator.sanitize_video(video)
  ```

### 2.3 Ošetření problematických videí (bez změny UI)

**Aktuální problém:**
- Iframe se renderuje hned v template (ř. 1936-1942)
- Pokud video není dostupné → iframe zobrazí 404

**Plánované řešení (Video Safe Mode):**

#### Krok 1: Modifikace template (minimální změna)
- **Soubor:** `filtr/index.html` (ř. 1924-1953)
- **Změna:** Přidat thumbnail container + tlačítko "Přehrát" (bez změny CSS tříd)
- **Struktura:**
  ```html
  <div class="videoFrame">
    <!-- Thumbnail (default) -->
    <div class="videoThumbnail" data-video-id="...">
      <img src="https://img.youtube.com/vi/{videoId}/mqdefault.jpg" />
      <button class="videoPlayBtn">▶ Přehrát</button>
    </div>
    <!-- Iframe (skrytý, vloží se po kliknutí) -->
    <iframe style="display:none;" ...></iframe>
  </div>
  ```
- **CSS:** Použít existující `.videoFrame` třídu (bez změny)

#### Krok 2: Lazy load iframe (JavaScript)
- **Soubor:** `filtr/assets/app.js` (nebo nový `app-video-safe.js`)
- **Změna:** Event listener na `.videoPlayBtn` → vložit iframe dynamicky
- **Kód:**
  ```javascript
  document.addEventListener("click", (e) => {
    if (e.target.closest(".videoPlayBtn")) {
      const frame = e.target.closest(".videoFrame");
      const videoId = frame.dataset.videoId;
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.youtube.com/embed/${videoId}`;
      // ... atributy
      frame.querySelector(".videoThumbnail").style.display = "none";
      frame.appendChild(iframe);
      iframe.style.display = "block";
    }
  });
  ```

#### Krok 3: Limit aktivních iframů
- **Soubor:** `filtr/assets/app.js`
- **Změna:** Max 3 aktivní iframy, starší zavřít
- **Kód:**
  ```javascript
  const MAX_ACTIVE_IFRAMES = 3;
  const activeIframes = [];
  
  function limitIframes(newIframe) {
    activeIframes.push(newIframe);
    if (activeIframes.length > MAX_ACTIVE_IFRAMES) {
      const old = activeIframes.shift();
      old.remove();
    }
  }
  ```

#### Krok 4: Fallback při selhání
- **Soubor:** `filtr/assets/app.js`
- **Změna:** Pokud iframe failne → zobrazit odkaz na YouTube
- **Kód:**
  ```javascript
  iframe.onerror = () => {
    iframe.remove();
    frame.innerHTML = `<a href="${video.url}" target="_blank">Otevřít na YouTube</a>`;
  };
  ```

**Důležité:** Všechny změny musí respektovat existující CSS třídy (`.videoFrame`, `.videoCardInner`, atd.)

---

## 3) INTEGRAČNÍ PLÁN P0 - WORKFLOW

### 3.1 Workflow soubory k úpravě

#### `update-articles.yml`
- **Status:** ⚠️ **BUDE UPRAVENO**
- **Změny:**
  1. Změnit `build_articles.py` → `build_articles_v2.py`
  2. Přidat validaci krok
  3. Přidat health gate krok
  4. Přidat promote krok
  5. Přidat snapshot krok
  6. Přidat health report krok
  7. **Odstranit workaround** `filtr/filtr/data/` (ř. 57-63)

#### `pages.yml`
- **Status:** ⚠️ **BUDE UPRAVENO** (minimálně)
- **Změny:**
  1. Přidat "No broken paths" test
  2. Upravit sanity check (ověřit `data/prod/` místo `data/`)

### 3.2 Nové workflow kroky

#### `update-articles.yml` (plán)

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      
      - name: Install Python dependencies
        run: |
          pip install -r scripts/requirements.txt
      
      # ✅ NOVÝ KROK 1: Build (canary)
      - name: Build articles JSON (canary)
        run: python scripts/build_articles_v2.py
        env:
          OUTPUT_MODE: "next"  # Zapisuje do next/
      
      # ✅ NOVÝ KROK 2: Validate
      - name: Validate JSON schema
        run: |
          python -c "
          import json
          from scripts.json_validator import JSONValidator
          v = JSONValidator()
          
          with open('filtr/data/next/articles.json', 'r', encoding='utf-8') as f:
              articles = json.load(f)
          is_valid, error = v.validate_articles(articles)
          if not is_valid:
              print(f'ERROR: {error}')
              exit(1)
          
          with open('filtr/data/next/videos.json', 'r', encoding='utf-8') as f:
              videos = json.load(f)
          is_valid, error = v.validate_videos(videos)
          if not is_valid:
              print(f'ERROR: {error}')
              exit(1)
          "
      
      # ✅ NOVÝ KROK 3: Health gate
      - name: Health gate (minimal counts)
        run: |
          python -c "
          import json
          MIN_ARTICLES = 50
          MIN_VIDEOS = 10
          
          with open('filtr/data/next/articles.json', 'r', encoding='utf-8') as f:
              articles = json.load(f)
          count = len(articles.get('articles', []))
          if count < MIN_ARTICLES:
              print(f'HEALTH GATE FAIL: Only {count} articles (min: {MIN_ARTICLES})')
              exit(1)
          
          with open('filtr/data/next/videos.json', 'r', encoding='utf-8') as f:
              videos = json.load(f)
          count = len(videos.get('videos', []))
          if count < MIN_VIDEOS:
              print(f'HEALTH GATE FAIL: Only {count} videos (min: {MIN_VIDEOS})')
              exit(1)
          "
      
      # ✅ NOVÝ KROK 4: Promote (next → prod)
      - name: Promote canary to production
        run: |
          python -c "
          import sys
          sys.path.insert(0, 'scripts')
          from data_layer import DataLayer
          from json_validator import JSONValidator
          
          data_layer = DataLayer('filtr/data')
          validator = JSONValidator()
          
          def validate_file(filename, data):
              is_valid, error = validator.validate_file(filename, data)
              if not is_valid:
                  print(f'VALIDATION ERROR [{filename}]: {error}')
                  return False
              return True
          
          success = data_layer.promote_next_to_prod(
              ['articles.json', 'videos.json', 'meta.json', 'brief.json', 'feed_health.json'],
              validator=validate_file
          )
          if not success:
              print('ERROR: promote_next_to_prod failed')
              sys.exit(1)
          "
      
      # ✅ NOVÝ KROK 5: Snapshot release
      # (automaticky v promote_next_to_prod, ale můžeme explicitně)
      
      # ✅ NOVÝ KROK 6: Health report
      # (automaticky v build_articles_v2.py, ale můžeme explicitně)
      
      # ✅ ODSTRANĚN: Normalize output paths (workaround)
      # (už není potřeba, protože build_articles_v2.py zapisuje přímo do správné cesty)
      
      - name: Commit and push if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          
          # ✅ ZMĚNA: Commit z prod/ místo data/
          git add filtr/data/prod/*.json
          git add filtr/data/releases/*/
          git add filtr/data/health/*.json
          git add filtr/data/health/*.md
          
          if git diff --cached --quiet; then
            echo "No changes to commit"
            exit 0
          fi
          
          git commit -m "Update data (articles, videos, brief, health, meta) - promoted to prod"
          git push origin HEAD:main
```

**Při failu validace/testů:**
- **STOP:** Workflow selže (exit 1)
- **NEPROMOVAT:** `prod/` zůstává nezměněn
- **Rollback:** `data_layer.rollback_to_lkg()` (volitelné, pokud LKG existuje)

### 3.3 Concurrency

**Aktuální nastavení:**
- `concurrency.group: update-articles` (ř. 11-13)
- `cancel-in-progress: true`

**Status:** ✅ **SPRÁVNĚ** - není potřeba měnit

---

## 4) INTEGRAČNÍ PLÁN P0 - TEST GATE

### 4.1 Minimální P0 testy

#### JSON Schema Validation
- **Kdy:** Po buildu, před promováním
- **Kde:** V workflow `update-articles.yml` (krok "Validate JSON schema")
- **Co:** 
  - `validate_articles()` pro `next/articles.json`
  - `validate_videos()` pro `next/videos.json`
  - `validate_meta()` pro `next/meta.json`
- **Blokování:** Pokud selže → workflow STOP, nepromovat

#### Health Gate
- **Kdy:** Po validaci, před promováním
- **Kde:** V workflow `update-articles.yml` (krok "Health gate")
- **Co:**
  - Minimální počet článků: 50 (konfigurovatelné)
  - Minimální počet videí: 10 (konfigurovatelné)
  - Kontrola, že canary pass = true
- **Blokování:** Pokud selže → workflow STOP, nepromovat

### 4.2 "No broken paths" test

- **Kdy:** Před deployem (v `pages.yml`)
- **Kde:** V workflow `pages.yml` (před "Upload Pages artifact")
- **Co kontroluje:**
  - Existence všech souborů odkazovaných v `index.html`:
    - `assets/app.js`
    - `assets/app-crash-shield.js`
    - `assets/app-render-optimizer.js`
    - `data/prod/articles.json` ← **ZMĚNA: prod místo data**
    - `data/prod/videos.json` ← **ZMĚNA: prod místo data**
    - `data/prod/meta.json` ← **ZMĚNA: prod místo data**
  - Case-sensitive kontrola (Linux)
  - Existence všech `data/prod/*.json` souborů
- **Implementace:**
  ```yaml
  - name: No broken paths test (case sensitive)
    run: |
      # Ověřit existence souborů z index.html
      test -f filtr/assets/app.js || (echo "❌ filtr/assets/app.js missing" && exit 1)
      test -f filtr/assets/app-crash-shield.js || (echo "❌ filtr/assets/app-crash-shield.js missing" && exit 1)
      test -f filtr/assets/app-render-optimizer.js || (echo "❌ filtr/assets/app-render-optimizer.js missing" && exit 1)
      test -f filtr/data/prod/articles.json || (echo "❌ filtr/data/prod/articles.json missing" && exit 1)
      test -f filtr/data/prod/videos.json || (echo "❌ filtr/data/prod/videos.json missing" && exit 1)
      test -f filtr/data/prod/meta.json || (echo "❌ filtr/data/prod/meta.json missing" && exit 1)
      
      # Case-sensitive kontrola (Linux)
      # Ověřit, že neexistují soubory s jiným case
      if [ -f "filtr/data/Prod/articles.json" ] || [ -f "filtr/data/PROD/articles.json" ]; then
        echo "❌ Case mismatch detected"
        exit 1
      fi
      
      echo "✅ No broken paths test OK"
  ```

---

## 5) UI KONTRAKT - POVINNÉ POTVRZENÍ

### 5.1 index.html a CSS/DOM struktura

**Potvrzení:** ✅ **NEBUDE MĚNĚNO**

- **Ověření:** Porovnání s baseline → 0 rozdílů
- **CSS proměnné (`:root`):** Všechny zachovány beze změny
- **CSS třídy:** Všechny zachovány beze změny
- **DOM struktura:** Beze změny
- **Layout:** Beze změny
- **Pořadí bloků:** Beze změny

**Výjimka (Video Safe Mode):**
- Minimální změna v template `#tplVideoBlock` (přidání thumbnail containeru)
- **ALE:** CSS třídy zůstávají stejné (`.videoFrame`, `.videoCardInner`)
- **ALE:** DOM selektory zůstávají stejné
- **ALE:** Layout zůstává stejný (pouze přidání elementu uvnitř existujícího containeru)

### 5.2 app.js - povolené změny

**Potvrzení:** ✅ **MŮŽE BÝT UPRAVENO** (s omezeními)

**Povolené změny:**
- Přidání fallback logiky (prod → lkg → releases → emergency)
- Přidání timeout pro fetch
- Přidání retry mechanismu
- Přidání null checks
- Přidání error handling (bez změny UI struktury)
- Video Safe Mode logika (lazy load iframe)

**Nesmí být změněno:**
- DOM selektory (ID, třídy) - musí zůstat stejné
- Renderování do existujících containerů (`#newsList`, `#sectionLabel`, atd.)
- Struktura renderovaných elementů (musí odpovídat CSS třídám)

**Příklad povolené změny:**
```javascript
// ✅ POVOLENO: Přidání fallback strategie
const DATA_PATHS = [
  "data/prod/articles.json",      // 1) Produkce
  "data/lkg/articles.json",       // 2) LKG
  "data/releases/latest/articles.json",  // 3) Latest release
  "data/emergency/articles.json"   // 4) Emergency
];

// ✅ POVOLENO: Timeout
async function fetchWithTimeout(url, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}
```

**Příklad zakázané změny:**
```javascript
// ❌ ZAKÁZÁNO: Změna DOM selektoru
document.getElementById("newsListNew")  // ❌ Musí zůstat "newsList"

// ❌ ZAKÁZÁNO: Změna CSS třídy
element.className = "news-card-new"  // ❌ Musí zůstat "news-card"
```

### 5.3 Žádné změny stylu, proměnných, tříd, layoutu

**Potvrzení:** ✅ **ŽÁDNÉ ZMĚNY**

- **CSS proměnné:** Všechny zachovány
- **CSS třídy:** Všechny zachovány
- **CSS ID:** Všechny zachovány
- **Layout struktura:** Beze změny
- **Responsive breakpoints:** Beze změny
- **Media queries:** Beze změny

**Výjimka (Video Safe Mode):**
- Přidání nových CSS tříd pro thumbnail (`.videoThumbnail`, `.videoPlayBtn`)
- **ALE:** Nezmění existující třídy
- **ALE:** Nezmění layout (thumbnail je uvnitř existujícího `.videoFrame`)

---

## 6) KROKY INTEGRACE (POSTUPNĚ)

### Fáze 1: Dokončení build_articles_v2.py
1. Kompletní migrace logiky z `build_articles.py`
2. Integrace FetchEngine
3. Integrace DataLayer
4. Integrace JSONValidator
5. Integrace HealthReporter
6. Testování lokálně

### Fáze 2: Úprava workflow
1. Upravit `update-articles.yml` (nové kroky)
2. Upravit `pages.yml` (no broken paths test)
3. Testování v CI (workflow dispatch)

### Fáze 3: Úprava app.js
1. Přidat fallback strategii (prod → lkg → releases → emergency)
2. Přidat timeout/retry
3. Testování lokálně

### Fáze 4: Video Safe Mode
1. Modifikace template (minimální)
2. JavaScript logika (lazy load)
3. Testování lokálně

### Fáze 5: Finální testy
1. Lokální testy (build, validate, promote)
2. CI testy (workflow)
3. E2E testy (web render)

---

## 7) RIZIKA A MITIGACE

### Riziko 1: Rozbití UI
- **Mitigace:** UI snapshot, porovnání před/po, testování v prohlížeči

### Riziko 2: Selhání validace v CI
- **Mitigace:** Health gate, rollback k LKG, emergency bundle

### Riziko 3: Case-sensitive problémy (Linux)
- **Mitigace:** "No broken paths" test, kontrola názvů souborů

### Riziko 4: Prázdný prod/ při selhání
- **Mitigace:** LKG backup, emergency bundle, rollback mechanismus

---

**KONEC INTEGRAČNÍHO PLÁNU**

**Status:** Plán je připraven, čeká na implementaci

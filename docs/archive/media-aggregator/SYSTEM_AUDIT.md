# SYSTÉMOVÝ AUDIT – infoUzel.cz
**Datum auditu:** 2026-01-25  
**Auditor:** Seniorní systémový auditor datových pipeline a statických webů  
**Cíl:** Rozebrat kompletní systém na jednotlivé operace a ověřit každou zvlášť

---

## A) MAPA SYSTÉMU

### A1) Struktura projektu

```
infoUzel.cz/
├── .github/workflows/          # GitHub Actions
│   ├── update-articles.yml     # Generování článků (cron každých 15 min)
│   ├── pages.yml               # Deploy na GitHub Pages
│   ├── update-weather.yml      # Aktualizace počasí
│   ├── update-namedays.yml     # Aktualizace svátků
│   └── health-check.yml        # Health check
├── scripts/                    # Generátory dat
│   ├── build_articles.py       # ⭐ HLAVNÍ GENERÁTOR (články + videa)
│   ├── feeds.json              # RSS feedy pro články
│   ├── feeds_youtube.json      # YouTube playlisty pro videa
│   ├── validate_json.py        # Validace JSON
│   ├── normalize_articles_json.py
│   ├── make_backup.py
│   └── write_status.py
├── filtr/                      # ⭐ PUBLISH ROOT (deploy na Pages)
│   ├── index.html              # Hlavní HTML
│   ├── assets/
│   │   ├── app.js              # ⚠️ ZJEDNODUŠENÁ VERZE (test)
│   │   ├── app-crash-shield.js # Crash shield + safe data layer
│   │   └── app-render-optimizer.js
│   ├── data/                   # ⭐ GENEROVANÁ DATA (zde končí JSON)
│   │   ├── articles.json       # Články
│   │   ├── videos.json         # Videa
│   │   ├── meta.json
│   │   ├── brief.json
│   │   ├── feed_health.json
│   │   └── weather.json
│   └── partials/               # HTML partials
└── data/                       # ⚠️ DUPLIKÁT? (možná stará struktura)
```

### A2) Produkční tok

```
┌─────────────────────────────────────────────────────────────────┐
│ ZDROJE                                                          │
├─────────────────────────────────────────────────────────────────┤
│ • RSS feedy (feeds.json) → články                              │
│ • YouTube playlisty (feeds_youtube.json) → videa                │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ FETCH (build_articles.py)                                      │
├─────────────────────────────────────────────────────────────────┤
│ • robust_fetch() → HTTP GET s User-Agent, timeout 20s          │
│ • decode_with_fallback() → UTF-8 → CP1250 → Latin-1            │
│ • feedparser.parse() → RSS/XML → dict                           │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ PARSE & NORMALIZE                                               │
├─────────────────────────────────────────────────────────────────┤
│ • Parsing entry: title, link, published_parsed                 │
│ • canonicalize_url() → odstranění UTM parametrů                │
│ • clean_title_basic() → strip prefixů, whitespace               │
│ • infer_section() → detekce sekce (pocasi/doprava/...)         │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ DEDUPE                                                          │
├─────────────────────────────────────────────────────────────────┤
│ • Pre-dedup: (media_norm, url) → set                           │
│ • Clustering: Jaccard podobnost titulků (threshold 0.56)       │
│ • Video: nikdy neslučovat (vždy samostatný cluster)           │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ ENRICH & RANK                                                   │
├─────────────────────────────────────────────────────────────────┤
│ • choose_neutral_title() → pro multi-source clustery           │
│ • Řazení: publishedAt DESC, pak section order                  │
│ • Limit: MAX_OUTPUT_ARTICLES=220, MAX_OUTPUT_VIDEOS=120        │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ OUTPUT JSON                                                     │
├─────────────────────────────────────────────────────────────────┤
│ • articles.json → filtr/data/articles.json                     │
│ • videos.json → filtr/data/videos.json                          │
│ • feed_health.json → diagnostika feedů                          │
│ • meta.json → statistiky                                        │
│ • brief.json → denní přehled                                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ DEPLOY (GitHub Actions)                                        │
├─────────────────────────────────────────────────────────────────┤
│ • update-articles.yml → commit do main                          │
│ • pages.yml → deploy filtr/ → GitHub Pages                      │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ WEB RENDER                                                      │
├─────────────────────────────────────────────────────────────────┤
│ • index.html → načte app.js                                     │
│ • app-crash-shield.js → safe fetch s fallback                  │
│ • fetch("data/articles.json") → render do DOM                  │
└─────────────────────────────────────────────────────────────────┘
```

### A3) Pipeline diagram (textový)

```
┌─────────────┐
│ RSS Feeds   │──┐
│ (feeds.json)│  │
└─────────────┘  │
                 │
┌─────────────┐  │     ┌──────────────┐
│ YouTube     │──┼────→│ build_       │
│ Playlists   │  │     │ articles.py  │
│ (feeds_     │  │     └──────────────┘
│ youtube.json)│ │              │
└─────────────┘  │              │
                 │              ↓
                 │     ┌──────────────┐
                 │     │ FETCH        │
                 │     │ (robust_fetch│
                 │     │ + feedparser)│
                 │     └──────────────┘
                 │              │
                 │              ↓
                 │     ┌──────────────┐
                 │     │ PARSE        │
                 │     │ (title, url, │
                 │     │  date, source)│
                 │     └──────────────┘
                 │              │
                 │              ↓
                 │     ┌──────────────┐
                 │     │ NORMALIZE    │
                 │     │ (canonicalize│
                 │     │  URL, clean  │
                 │     │  title)      │
                 │     └──────────────┘
                 │              │
                 │              ↓
                 │     ┌──────────────┐
                 │     │ DEDUPE      │
                 │     │ (pre-dedup + │
                 │     │  clustering) │
                 │     └──────────────┘
                 │              │
                 │              ↓
                 │     ┌──────────────┐
                 │     │ RANK        │
                 │     │ (by date +   │
                 │     │  section)    │
                 │     └──────────────┘
                 │              │
                 │              ↓
                 │     ┌──────────────┐
                 │     │ OUTPUT JSON  │
                 │     │ filtr/data/  │
                 │     │ • articles   │
                 │     │ • videos     │
                 │     │ • meta       │
                 │     │ • brief      │
                 │     │ • health     │
                 │     └──────────────┘
                 │              │
                 │              ↓
                 │     ┌──────────────┐
                 │     │ GITHUB       │
                 │     │ ACTIONS      │
                 │     │ (commit +    │
                 │     │  deploy)     │
                 │     └──────────────┘
                 │              │
                 │              ↓
                 │     ┌──────────────┐
                 │     │ WEB RENDER   │
                 │     │ (app.js      │
                 │     │  načte JSON) │
                 │     └──────────────┘
```

---

## B) PIPELINE ČLÁNKŮ – OPERACE PO OPERACI

### B1) Definice zdrojů článků

**Účel operace:** Načtení seznamu RSS feedů z `feeds.json` a jejich metadata.

**Implementace:**
- **Soubor:** `scripts/build_articles.py`
- **Řádky:** 412-510 (`load_feeds()`, `load_youtube_feeds()`, `load_all_feeds()`)
- **Soubor definice:** `scripts/feeds.json` (řádky 1-27)

**Vstup:**
- `scripts/feeds.json` (JSON dict: `{ "url": { "topic": "...", "source": "..." } }`)
- `scripts/feeds_youtube.json` (JSON list: `[{ "playlistId": "...", "topic": "...", "channel": "..." }]`)

**Výstup:**
- `feed_items` (list of tuples: `[(url, meta_dict), ...]`)
- Každý tuple obsahuje: `(feed_url, {"topic": str, "source": str, ...})`

**Validace:**
- ✅ Kontrola existence souborů (ř. 503, 507)
- ✅ Parsování JSON s try/except (ř. 413-414, 463-464)
- ⚠️ **SLABINA:** Není validace URL formátu (může být neplatná URL)
- ⚠️ **SLABINA:** Není kontrola duplicit URL v rámci feeds.json
- ⚠️ **SLABINA:** Není kontrola konzistence názvů zdrojů (case, diakritika)

**Logování:**
- ❌ **CHYBÍ:** Žádné logování počtu načtených feedů
- ❌ **CHYBÍ:** Žádné logování duplicit nebo chyb

**Typické chyby:**
1. Neplatná URL → feedparser selže později
2. Duplicitní URL → stejný feed se stáhne 2x
3. Neexistující soubor → ValueError (ř. 443, 467)
4. Neplatný JSON → JSONDecodeError

**Návrhy zpevnění:**
```python
# 1) Validace URL
from urllib.parse import urlparse
def validate_url(url: str) -> bool:
    try:
        p = urlparse(url)
        return bool(p.scheme and p.netloc)
    except:
        return False

# 2) Detekce duplicit
seen_urls = set()
for url, meta in feed_items:
    if url in seen_urls:
        warn(f"Duplicate feed URL: {url}")
    seen_urls.add(url)

# 3) Normalizace názvů zdrojů
def normalize_source_name(name: str) -> str:
    # Sjednotit case, odstranit diakritiku pro porovnání
    return name.strip().lower()
```

**Test plán:**
- Lokálně: `python -c "from scripts.build_articles import load_all_feeds; print(len(load_all_feeds()))"`
- CI: Přidat test do workflow, který ověří, že feeds.json je validní JSON a všechny URL jsou platné

---

### B2) Stažení článků

**Účel operace:** HTTP GET RSS feedu s retry, timeout, encoding fallback.

**Implementace:**
- **Soubor:** `scripts/build_articles.py`
- **Řádky:** 517-662
  - `robust_fetch()` (517-548): HTTP GET
  - `decode_with_fallback()` (551-571): Encoding fallback
  - `is_html_content()` (574-595): Detekce HTML místo XML
  - `fetch_feed()` (598-661): Hlavní funkce

**Vstup:**
- `url` (str): RSS feed URL
- `USER_AGENT` (konstanta): "Mozilla/5.0 (compatible; infoUzelBot/1.0; +https://infouzel.cz)"
- `REQUEST_TIMEOUT_SEC` (konstanta): 20

**Výstup:**
- Tuple: `(feed_dict, diagnostics_dict)`
  - `feed_dict`: feedparser result (nebo `None` při chybě)
  - `diagnostics`: `{httpStatus, contentType, finalUrl, bytes, reason, bozo, bozoException}`

**Validace:**
- ✅ Timeout 20s (ř. 533)
- ✅ User-Agent header (ř. 523)
- ✅ Redirect handling (ř. 534: `allow_redirects=True`)
- ✅ Encoding fallback: UTF-8 → CP1250 → Latin-1 (ř. 559-571)
- ✅ Detekce HTML místo XML (ř. 637-639)
- ⚠️ **SLABINA:** Není retry mechanismus (při 429/500 se to nezopakuje)
- ⚠️ **SLABINA:** Není exponential backoff
- ⚠️ **SLABINA:** Při timeout (status_code=0) není rozlišení mezi timeout a network error

**Logování:**
- ✅ Diagnostika se ukládá do `diagnostics` (ř. 603-611)
- ✅ Report do `feed_health.json` (ř. 1062-1085)
- ⚠️ **SLABINA:** Není console logování během fetchu (jen do JSON)

**Typické chyby:**
1. **403 Forbidden** → `reason="http_403"`, feed se přeskočí
2. **429 Too Many Requests** → `reason="http_429"`, žádný retry
3. **500 Server Error** → `reason="http_500"`, žádný retry
4. **Timeout** → `status_code=0`, `reason=""` (prázdné!)
5. **HTML místo XML** → `reason="not_xml_or_html"`, feed se přeskočí
6. **Bozo parse error** → `bozo=True`, ale může se použít pokud `accepted > 0`

**Návrhy zpevnění:**
```python
# 1) Retry s exponential backoff
import time
def robust_fetch_with_retry(url: str, max_retries=3) -> tuple:
    for attempt in range(max_retries):
        status, final_url, content_type, raw_bytes = robust_fetch(url)
        if status == 200:
            return (status, final_url, content_type, raw_bytes)
        if status == 429:  # Rate limit
            wait = (2 ** attempt) * 2  # 2s, 4s, 8s
            time.sleep(wait)
            continue
        if status >= 500:  # Server error
            wait = (2 ** attempt) * 1  # 1s, 2s, 4s
            time.sleep(wait)
            continue
        # 4xx errors: no retry
        return (status, final_url, content_type, raw_bytes)
    return (0, url, "", b"")

# 2) Lepší logování
print(f"[FETCH] {url} → {status_code} ({len(raw_bytes)} bytes)", file=sys.stderr)
```

**Test plán:**
- Lokálně: Test s neplatnou URL, timeout URL, 403 URL
- CI: Mock HTTP server s různými status codes

---

### B3) Parsing článků

**Účel operace:** Extrakce `title`, `link`, `published_parsed` z feedparser entry.

**Implementace:**
- **Soubor:** `scripts/build_articles.py`
- **Řádky:** 928-978 (hlavní loop přes entries)
  - `parse_dt()` (112-122): Parsování data
  - `canonicalize_url()` (125-140): Normalizace URL
  - `clean_title_basic()` (151-165): Čištění titulku

**Vstup:**
- `entry` (feedparser entry object)
- `source` (str): Název zdroje z meta
- `fallback_topic` (str): Výchozí sekce

**Výstup:**
- `item` dict s klíči:
  - `section`, `contentType`, `title`, `url`, `dt`, `media_raw`, `media_norm`, `tokens`

**Validace:**
- ✅ Kontrola `link` a `title` (ř. 933-934: `if not link or not title: continue`)
- ✅ Fallback pro chybějící `published_parsed` → `datetime.now(timezone.utc)` (ř. 122)
- ✅ Canonicalizace URL (ř. 929)
- ⚠️ **SLABINA:** Není validace, že `link` je platná URL
- ⚠️ **SLABINA:** Není kontrola, že `title` není prázdný po `clean_title_basic()`

**Logování:**
- ❌ **CHYBÍ:** Žádné logování přeskočených entries (chybějící link/title)
- ✅ Počítá se `accepted` (ř. 910, 978)

**Typické chyby:**
1. **Chybějící link** → entry se přeskočí (ř. 933)
2. **Chybějící title** → entry se přeskočí (ř. 933)
3. **Chybějící pubDate** → použije se `datetime.now()` (může být špatně)
4. **Neplatná URL** → `canonicalize_url()` může vrátit původní URL (ř. 140: `except: return url`)

**Návrhy zpevnění:**
```python
# 1) Validace URL po canonicalize
def validate_and_canonicalize(url: str) -> str | None:
    try:
        canonical = canonicalize_url(url)
        p = urlparse(canonical)
        if not p.scheme or not p.netloc:
            return None
        return canonical
    except:
        return None

# 2) Logování přeskočených entries
skipped_count = 0
for entry in entries:
    if not link or not title:
        skipped_count += 1
        continue
# ... po loopu:
if skipped_count > 0:
    print(f"[PARSE] {source}: skipped {skipped_count} entries (missing link/title)", file=sys.stderr)
```

**Test plán:**
- Lokálně: Test s feedem, který má entries bez link/title
- CI: Unit test pro `parse_dt()` s různými vstupy

---

### B4) Normalizace a čištění textů

**Účel operace:** Odstranění HTML entit, whitespace, sjednocení uvozovek, detekce rozpadlých řetězců.

**Implementace:**
- **Soubor:** `scripts/build_articles.py`
- **Řádky:**
  - `clean_title_basic()` (151-165): Základní čištění
  - `normalize_media_name()` (143-148): Normalizace názvu média
  - `canonicalize_url()` (125-140): Odstranění UTM parametrů

**Vstup:**
- `title` (str): Surový titulek z RSS
- `url` (str): Surová URL

**Výstup:**
- `title`: Vyčištěný titulek
- `url`: Canonicalizovaná URL

**Validace:**
- ✅ Strip whitespace (ř. 152: `.strip()`)
- ✅ Odstranění prefixů (ř. 154-155: `TITLE_PREFIX_STRIP`)
- ✅ Odstranění trailing dots/ellipsis (ř. 157-158)
- ✅ Sjednocení whitespace (ř. 159: `re.sub(r"\s+", " ", t)`)
- ✅ Strip quotes (ř. 160: `.strip("""' ")`)
- ✅ Odstranění UTM parametrů z URL (ř. 132-135)
- ⚠️ **SLABINA:** Není odstranění HTML entit (např. `&amp;` → `&`)
- ⚠️ **SLABINA:** Není detekce "smart quotes" (`"` vs `"`)
- ⚠️ **SLABINA:** Není detekce neviditelných znaků (zero-width space, BOM)
- ⚠️ **SLABINA:** Není detekce "rozpadlých URL" (mezery v URL)

**Logování:**
- ❌ **CHYBÍ:** Žádné logování oprav (např. "opravena URL s mezerou")

**Typické chyby:**
1. **HTML entity v titulku** → `&amp;` zůstane jako `&amp;` (ne `&`)
2. **Smart quotes** → `"text"` vs `"text"` (různé znaky)
3. **Mezery v URL** → `https://example.com/ article` (neplatná URL)
4. **BOM na začátku** → `\ufeffTitle` (neviditelný znak)

**Návrhy zpevnění:**
```python
import html
import unicodedata

def clean_title_advanced(title: str) -> str:
    # 1) HTML entity
    t = html.unescape(title)
    
    # 2) Normalizace Unicode (NFKC)
    t = unicodedata.normalize("NFKC", t)
    
    # 3) Odstranění neviditelných znaků
    t = re.sub(r'[\u200b-\u200d\ufeff]', '', t)  # zero-width, BOM
    
    # 4) Smart quotes → normální
    t = t.replace('"', '"').replace('"', '"')
    t = t.replace(''', "'").replace(''', "'")
    
    # 5) Existující clean_title_basic()
    t = clean_title_basic(t)
    
    return t

def fix_broken_url(url: str) -> str:
    # Detekce mezer v URL
    if ' ' in url:
        # Možná oprava: nahradit mezery %20
        url = url.replace(' ', '%20')
        warn(f"Fixed URL with spaces: {url}")
    return url
```

**Test plán:**
- Lokálně: Test s titulky obsahujícími HTML entity, smart quotes, BOM
- CI: Unit testy pro `clean_title_basic()` s edge cases

---

### B5) Deduplikace článků

**Účel operace:** Odstranění duplicitních článků a slučování podobných (clustering).

**Implementace:**
- **Soubor:** `scripts/build_articles.py`
- **Řádky:**
  - Pre-dedup: 1001-1009 (podle `(media_norm, url)`)
  - Clustering: 729-757 (`cluster_items()`)
  - Jaccard podobnost: 182-187 (`jaccard()`)
  - Tokenizace: 168-179 (`tokenize_title()`)

**Vstup:**
- `all_items` (list): Všechny načtené články

**Výstup:**
- `clusters` (list): Seznam Cluster objektů

**Validace:**
- ✅ Pre-dedup podle `(media_norm, url)` (ř. 1005)
- ✅ Clustering podle Jaccard podobnosti (threshold 0.56, ř. 748)
- ✅ Clustering jen v rámci stejné sekce (ř. 745)
- ⚠️ **SLABINA:** Stejný článek s různými UTM parametry → různé URL → duplicita!
- ⚠️ **SLABINA:** Determinismus: pořadí závisí na `sorted(all_items, key=lambda x: x["dt"], reverse=True)` (ř. 1004) → pokud mají stejné `dt`, pořadí není garantované
- ⚠️ **SLABINA:** Jaccard threshold 0.56 je pevně daný, může být příliš nízký/vysoký

**Logování:**
- ❌ **CHYBÍ:** Žádné logování počtu duplicit
- ❌ **CHYBÍ:** Žádné logování počtu clusterů

**Typické chyby:**
1. **Duplicitní URL s UTM** → `canonicalize_url()` by mělo pomoci, ale pokud selže, duplicita zůstane
2. **Stejný článek, různé zdroje** → clustering by měl sloučit, ale pokud Jaccard < 0.56, zůstanou 2 položky
3. **Nedeterministické pořadí** → pokud 2 články mají stejné `dt`, pořadí závisí na Python dict/set order

**Návrhy zpevnění:**
```python
# 1) Lepší dedup: hash titulku + URL
import hashlib
def article_hash(item: dict) -> str:
    title_norm = clean_title_basic(item["title"]).lower()
    url_canon = canonicalize_url(item["url"])
    combined = f"{title_norm}|{url_canon}"
    return hashlib.md5(combined.encode("utf-8")).hexdigest()

seen_hashes = set()
for it in all_items:
    h = article_hash(it)
    if h in seen_hashes:
        continue  # duplicita
    seen_hashes.add(h)

# 2) Determinismus: přidat sekundární sort key
clusters.sort(key=lambda c: (
    c.published_at(),
    c.section,
    c.items[0]["url"]  # sekundární klíč pro stabilitu
), reverse=True)

# 3) Logování
print(f"[DEDUPE] Pre-dedup: {len(all_items)} → {len(deduped_items)}", file=sys.stderr)
print(f"[CLUSTER] {len(deduped_items)} items → {len(clusters)} clusters", file=sys.stderr)
```

**Test plán:**
- Lokálně: Test s duplicitními URL (s/bez UTM)
- CI: Unit test pro clustering s kontrolou determinismu

---

### B6) Ranking / řazení

**Účel operace:** Seřazení článků podle data publikace a sekce.

**Implementace:**
- **Soubor:** `scripts/build_articles.py`
- **Řádky:**
  - 1015-1016: Řazení clusterů
  - 1045: Finální řazení articles

**Vstup:**
- `clusters` (list): Seřazené clustery
- `out_articles` (list): Finální seznam článků

**Výstup:**
- Seřazený seznam podle `publishedAt` DESC

**Validace:**
- ✅ Řazení podle `published_at()` (ř. 1016)
- ✅ Sekundární řazení podle `section` (ř. 1016: `-sec_rank.get(c.section, 999)`)
- ⚠️ **SLABINA:** Při shodných časech není garantované pořadí
- ⚠️ **SLABINA:** Časové zóny: všechny časy jsou UTC (ř. 109, 121), ale není kontrola, že feedparser vrátil UTC

**Logování:**
- ❌ **CHYBÍ:** Žádné logování řazení

**Typické chyby:**
1. **Shodné publishedAt** → pořadí závisí na Python sort stability (může být náhodné)
2. **Časová zóna** → pokud feed vrátí local time, může být špatně

**Návrhy zpevnění:**
```python
# 1) Sekundární sort key pro stabilitu
clusters.sort(key=lambda c: (
    c.published_at(),
    -sec_rank.get(c.section, 999),
    c.items[0]["url"]  # URL jako tie-breaker
), reverse=True)

# 2) Validace časové zóny
def ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        # Naive datetime → assume UTC
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
```

**Test plán:**
- Lokálně: Test s články se shodnými časy
- CI: Unit test pro řazení s kontrolou stability

---

### B7) Generování výstupních JSON pro články

**Účel operace:** Zápis `articles.json` do `filtr/data/`.

**Implementace:**
- **Soubor:** `scripts/build_articles.py`
- **Řádky:** 1050-1059

**Vstup:**
- `final` (list): Seznam článků (max 220)
- `generated_at` (str): ISO timestamp

**Výstup:**
- `filtr/data/articles.json` (JSON soubor)

**Validace:**
- ✅ Vytvoření adresáře (ř. 1055: `os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)`)
- ✅ UTF-8 encoding (ř. 1058: `encoding="utf-8"`)
- ✅ `ensure_ascii=False` (ř. 1059: zachování diakritiky)
- ✅ Indent 2 (ř. 1059: čitelný JSON)
- ⚠️ **SLABINA:** Není validace JSON před zápisem (může být neplatný JSON)
- ⚠️ **SLABINA:** Není kontrola, že `OUTPUT_DIR` je správný (může být jiný adresář)

**Logování:**
- ✅ Console output (ř. 1133: `print(f"=== OUTPUT === wrote {len(final)} items to {OUT_PATH}")`)
- ⚠️ **SLABINA:** Není logování velikosti souboru

**Typické chyby:**
1. **Neplatný JSON** → `json.dump()` může selhat (ale má try/except?)
2. **Špatný OUTPUT_DIR** → soubor se zapíše jinam
3. **Permission error** → nelze zapsat do `filtr/data/`

**Návrhy zpevnění:**
```python
# 1) Validace před zápisem
import json
def validate_json_structure(data: dict) -> bool:
    required_keys = ["generatedAt", "articles"]
    if not all(k in data for k in required_keys):
        return False
    if not isinstance(data["articles"], list):
        return False
    return True

# 2) Atomic write (write to temp, then rename)
import tempfile
import shutil
def atomic_write_json(path: str, data: dict):
    dirname = os.path.dirname(path)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=dirname, delete=False, suffix='.json') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        temp_path = f.name
    shutil.move(temp_path, path)

# 3) Validace OUTPUT_DIR
if not OUTPUT_DIR.endswith("filtr/data"):
    warn(f"WARNING: OUTPUT_DIR={OUTPUT_DIR} does not end with 'filtr/data'")
```

**Test plán:**
- Lokálně: Test zápisu, kontrola že soubor existuje a je validní JSON
- CI: Validace JSON v workflow (přidat `validate_json.py` check)

---

### B8) Napojení článků ve webu (render)

**Účel operace:** Načtení `articles.json` v JavaScriptu a render do DOM.

**Implementace:**
- **Soubor:** `filtr/assets/app.js` (ř. 1-27) ⚠️ **ZJEDNODUŠENÁ VERZE (test)**
- **Soubor:** `filtr/assets/app-crash-shield.js` (ř. 348-356: URL definice)

**Vstup:**
- `data/articles.json` (fetch z webu)

**Výstup:**
- DOM elementy (články renderované do `#newsList`)

**Validace:**
- ✅ Fallback na prázdný array (ř. 11: `json.articles || []`)
- ✅ Kontrola prázdného seznamu (ř. 15-18)
- ⚠️ **SLABINA:** `app.js` je zjednodušená verze (ř. 1-27) → možná není finální implementace
- ⚠️ **SLABINA:** Není kontrola, že JSON má správnou strukturu (`generatedAt`, `articles`)
- ⚠️ **SLABINA:** Není null checks pro nested properties (`article.sources[0].url`)

**Logování:**
- ✅ Console log (ř. 13: `console.log("[infoUzel] render items:", items.length)`)
- ✅ Console warn při prázdném seznamu (ř. 16)

**Typické chyby:**
1. **404 Not Found** → `fetch()` selže, catch blok zobrazí chybu (ř. 24-26)
2. **Neplatný JSON** → `res.json()` selže, catch blok zobrazí chybu
3. **Chybějící `articles` klíč** → fallback na `[]` (ř. 11)
4. **Null/undefined v nested properties** → může způsobit `TypeError`

**Návrhy zpevnění:**
```javascript
// 1) Validace struktury
function validateArticlesJSON(json) {
    if (!json || typeof json !== 'object') return false;
    if (!Array.isArray(json.articles)) return false;
    return true;
}

// 2) Null checks
function safeGetSourceUrl(article) {
    const sources = article?.sources;
    if (!Array.isArray(sources) || sources.length === 0) return null;
    return sources[0]?.url || null;
}

// 3) Try-catch kolem renderu
try {
    renderArticles(items);
} catch (e) {
    console.error("[infoUzel] Render error:", e);
    showErrorUI("Chyba při zobrazování článků");
}
```

**Test plán:**
- Lokálně: Test s neplatným JSON, chybějícím `articles` klíčem
- CI: E2E test načtení stránky a render článků

---

### B9) Cache-busting / obnova dat

**Účel operace:** Zajištění, že web načte nejnovější data (ne cache).

**Implementace:**
- **Soubor:** `filtr/assets/app.js` (ř. 7: `{ cache: "no-store" }`)
- **Soubor:** `filtr/assets/app-crash-shield.js` (ř. 348-356: URL bez query string)

**Vstup:**
- Fetch request s `cache: "no-store"`

**Výstup:**
- Vždy nejnovější data (ne cache)

**Validace:**
- ✅ `cache: "no-store"` v fetch (ř. 7)
- ⚠️ **SLABINA:** Není query string cache-busting (např. `?v=20260125`)
- ⚠️ **SLABINA:** Pokud se `articles.json` nepřepíše (stejný obsah), browser cache může zůstat

**Logování:**
- ❌ **CHYBÍ:** Žádné logování cache hit/miss

**Typické chyby:**
1. **Browser cache** → i s `cache: "no-store"` může být cache (závisí na browser)
2. **Service Worker cache** → pokud je SW, může cacheovat JSON

**Návrhy zpevnění:**
```javascript
// 1) Query string cache-busting
const cacheBuster = new URLSearchParams({ v: Date.now() });
const url = `data/articles.json?${cacheBuster}`;

// 2) Service Worker bypass
if ('serviceWorker' in navigator) {
    // Zkontrolovat, že SW necacheuje JSON
}
```

**Test plán:**
- Lokálně: Test s browser cache disabled/enabled
- CI: E2E test, že se načte nejnovější `generatedAt`

---

## C) PIPELINE VIDEÍ – OPERACE PO OPERACI

### C1) Definice zdrojů videí (kanály, playlisty)

**Účel operace:** Načtení YouTube playlistů z `feeds_youtube.json`.

**Implementace:**
- **Soubor:** `scripts/build_articles.py`
- **Řádky:** 448-498 (`load_youtube_feeds()`)
- **Soubor definice:** `scripts/feeds_youtube.json` (ř. 1-12)

**Vstup:**
- `scripts/feeds_youtube.json` (JSON list)

**Výstup:**
- `out` (list): `[(url, meta_dict), ...]`
- `meta` obsahuje: `topic`, `source`, `type: "youtube"`, `channel`

**Validace:**
- ✅ Kontrola existence souboru (ř. 507)
- ✅ Validace, že data je list (ř. 466-467)
- ✅ Generování URL z `playlistId` (ř. 448-452, 477)
- ⚠️ **SLABINA:** Není validace `playlistId` formátu
- ⚠️ **SLABINA:** Není kontrola duplicit playlistId
- ⚠️ **SLABINA:** Není konzistence názvů kanálů (ČT24 vs CT24)

**Logování:**
- ❌ **CHYBÍ:** Žádné logování počtu playlistů

**Typické chyby:**
1. **Neplatný playlistId** → URL se vygeneruje, ale feed selže
2. **Duplicitní playlistId** → stejný playlist se stáhne 2x
3. **Inkonzistentní názvy** → "ČT24" vs "CT24" → různé kanály v `videos.json`

**Návrhy zpevnění:**
```python
# 1) Validace playlistId (YouTube ID formát: alfanumerické, 34 znaků)
def validate_playlist_id(pid: str) -> bool:
    if not pid or len(pid) != 34:
        return False
    return pid.replace('_', '').replace('-', '').isalnum()

# 2) Normalizace názvů kanálů
def normalize_channel_name(name: str) -> str:
    # Sjednotit diakritiku, case
    return name.strip()

# 3) Detekce duplicit
seen_playlist_ids = set()
for item in data:
    pid = item.get("playlistId", "").strip()
    if pid in seen_playlist_ids:
        warn(f"Duplicate playlistId: {pid}")
    seen_playlist_ids.add(pid)
```

**Test plán:**
- Lokálně: Test s neplatným playlistId, duplicitními playlisty
- CI: Validace `feeds_youtube.json` v workflow

---

### C2) Stažení videí / API / parsing

**Účel operace:** Fetch YouTube RSS feedu a parsování video entries.

**Implementace:**
- **Soubor:** `scripts/build_articles.py`
- **Řádky:** 876-958 (hlavní loop, YouTube detekce 914-920, zpracování 940-958)

**Vstup:**
- YouTube RSS feed URL (ř. 448-452: `https://www.youtube.com/feeds/videos.xml?playlist_id={pid}`)
- `entry` z feedparser

**Výstup:**
- `yt_videos` list s položkami: `{title, url, videoId, publishedAt, section, channel, _dt}`

**Validace:**
- ✅ Detekce YouTube feedu (ř. 914-920: kontrola host)
- ✅ Extrakce `videoId` z URL (ř. 354-387: `youtube_video_id_from_url()`)
- ✅ Kontrola, že `videoId` existuje (ř. 942-943)
- ⚠️ **SLABINA:** Není validace `videoId` formátu (YouTube ID: 11 znaků)
- ⚠️ **SLABINA:** Není retry mechanismus (stejně jako u článků)

**Logování:**
- ✅ Počítá se `accepted` (ř. 957)
- ⚠️ **SLABINA:** Není logování přeskočených videí (chybějící videoId)

**Typické chyby:**
1. **Neplatná YouTube URL** → `youtube_video_id_from_url()` vrátí `""` → video se přeskočí
2. **Chybějící videoId** → video se přeskočí (ř. 942-943)
3. **Neplatný videoId formát** → uloží se, ale embed selže

**Návrhy zpevnění:**
```python
# 1) Validace videoId (YouTube: 11 znaků, alfanumerické + -_)
def validate_youtube_video_id(vid: str) -> bool:
    if not vid or len(vid) != 11:
        return False
    return all(c.isalnum() or c in '-_' for c in vid)

# 2) Logování
if not vid:
    warn(f"[YOUTUBE] Skipped video: cannot extract videoId from {link}")
    continue
if not validate_youtube_video_id(vid):
    warn(f"[YOUTUBE] Invalid videoId format: {vid}")
    continue
```

**Test plán:**
- Lokálně: Test s neplatnou YouTube URL, chybějícím videoId
- CI: Unit test pro `youtube_video_id_from_url()` s různými URL formáty

---

### C3) Normalizace metadat videí

**Účel operace:** Sjednocení formátu `title`, `url`, `publishedAt`, `channel`.

**Implementace:**
- **Soubor:** `scripts/build_articles.py`
- **Řádky:** 948-956 (vytvoření `yt_videos` položky)

**Vstup:**
- `title`, `link`, `dt`, `channel_name` z entry

**Výstup:**
- Normalizovaná položka: `{title, url, videoId, publishedAt, section, channel, _dt}`

**Validace:**
- ✅ `clean_title_basic()` (ř. 949)
- ✅ ISO format timestamp (ř. 952: `.isoformat().replace("+00:00", "Z")`)
- ✅ `stable_section()` (ř. 946)
- ⚠️ **SLABINA:** Není normalizace `channel` názvu (diakritika, case)
- ⚠️ **SLABINA:** Není kontrola, že `channel` není prázdný

**Logování:**
- ❌ **CHYBÍ:** Žádné logování normalizace

**Typické chyby:**
1. **Prázdný channel** → fallback na "YouTube" (ř. 485, 927), ale může být nekonzistentní
2. **Inkonzistentní channel názvy** → "ČT24" vs "CT24" → různé kanály

**Návrhy zpevnění:**
```python
# 1) Normalizace channel názvu
def normalize_channel_name(name: str) -> str:
    if not name or not name.strip():
        return "YouTube"
    # Sjednotit diakritiku, case
    return name.strip()

# 2) Validace před přidáním
channel = normalize_channel_name(channel_name or "")
if not channel or channel == "":
    channel = "YouTube"  # fallback
```

**Test plán:**
- Lokálně: Test s prázdným channel, různými variantami názvu
- CI: Unit test pro normalizaci channel názvů

---

### C4) Deduplikace videí

**Účel operace:** Odstranění duplicitních videí podle `videoId`.

**Implementace:**
- **Soubor:** `scripts/build_articles.py`
- **Řádky:** 1098-1120 (dedup a limit)

**Vstup:**
- `yt_sorted` (seřazené videa podle `_dt` DESC)

**Výstup:**
- `out_vid` (list): Unikátní videa (max 120)

**Validace:**
- ✅ Dedup podle `videoId` (ř. 1104-1110: `seen_vid` set)
- ✅ Limit 120 videí (ř. 1119)
- ✅ Řazení podle `_dt` DESC (ř. 1099-1103)
- ⚠️ **SLABINA:** Není kontrola, že `videoId` není prázdný před přidáním do setu
- ⚠️ **SLABINA:** Pokud 2 videa mají stejný `videoId` ale různé `publishedAt`, použije se první (nejnovější), ale není logování

**Logování:**
- ❌ **CHYBÍ:** Žádné logování počtu duplicit

**Typické chyby:**
1. **Prázdný videoId** → může se přidat do setu jako `""` → duplicita
2. **Stejné video, různé playlisty** → dedup funguje, ale není info, který playlist "vyhrál"

**Návrhy zpevnění:**
```python
# 1) Validace videoId před dedupem
for v in yt_sorted:
    vid = (v.get("videoId") or "").strip()
    if not vid:  # ⚠️ CHYBÍ v aktuálním kódu!
        continue
    if vid in seen_vid:
        # Logování duplicity
        warn(f"[DEDUP] Duplicate videoId: {vid} (skipped)")
        continue
    seen_vid.add(vid)

# 2) Logování
print(f"[VIDEOS] Dedup: {len(yt_sorted)} → {len(out_vid)}", file=sys.stderr)
```

**Test plán:**
- Lokálně: Test s duplicitními videoId
- CI: Unit test pro dedup s edge cases

---

### C5) Generování videos.json

**Účel operace:** Zápis `videos.json` do `filtr/data/`.

**Implementace:**
- **Soubor:** `scripts/build_articles.py`
- **Řádky:** 1122-1129

**Vstup:**
- `out_vid` (list): Seznam videí (max 120)
- `generated_at` (str): ISO timestamp

**Výstup:**
- `filtr/data/videos.json` (JSON soubor)

**Validace:**
- ✅ Vytvoření adresáře (ř. 1127)
- ✅ UTF-8 encoding (ř. 1128)
- ✅ `ensure_ascii=False` (ř. 1129)
- ⚠️ **SLABINA:** Stejné jako u `articles.json` (B7) → není validace JSON, není atomic write

**Logování:**
- ✅ Console output (ř. 1134)

**Typické chyby:**
- Stejné jako B7 (generování JSON)

**Návrhy zpevnění:**
- Stejné jako B7 (atomic write, validace)

**Test plán:**
- Lokálně: Test zápisu, validace JSON
- CI: Validace JSON v workflow

---

### C6) Render videí na webu

**Účel operace:** Načtení `videos.json` a vložení YouTube iframe do DOM.

**Implementace:**
- **Soubor:** `filtr/index.html` (ř. 1924-1953: template `tplVideoBlock`)
- **Soubor:** `filtr/assets/app-crash-shield.js` (ř. 349: `videosUrl`)

**Vstup:**
- `data/videos.json` (fetch z webu)

**Výstup:**
- YouTube iframe v DOM

**Validace:**
- ✅ Lazy loading iframe (ř. 1939: `loading="lazy"`)
- ✅ Security attributes (ř. 1940-1941: `allow`, `referrerpolicy`)
- ⚠️ **SLABINA:** Není kontrola, že `videoId` je platný před vložením do iframe
- ⚠️ **SLABINA:** Není fallback, pokud iframe selže

**Logování:**
- ❌ **CHYBÍ:** Žádné logování renderu videí

**Typické chyby:**
1. **Neplatný videoId** → iframe načte 404 stránku
2. **YouTube blokuje embed** → iframe je prázdný
3. **Příliš mnoho iframe najednou** → výkonové problémy

**Návrhy zpevnění:**
```javascript
// 1) Validace videoId před renderem
function isValidYouTubeId(vid) {
    return vid && vid.length === 11 && /^[a-zA-Z0-9_-]+$/.test(vid);
}

// 2) Lazy load s Intersection Observer
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            loadVideoIframe(entry.target);
            observer.unobserve(entry.target);
        }
    });
});

// 3) Fallback na thumbnail + link
function renderVideoFallback(video) {
    return `<a href="${video.url}" target="_blank">
        <img src="https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg" />
    </a>`;
}
```

**Test plán:**
- Lokálně: Test s neplatným videoId, render velkého počtu videí
- CI: E2E test načtení a render videí

---

### C7) Výkon a zamrzání

**Účel operace:** Zajištění, že render videí nezamrzne stránku.

**Implementace:**
- **Soubor:** `filtr/assets/app-render-optimizer.js` (fallback v `index.html` ř. 2228-2307)
- **Soubor:** `filtr/index.html` (ř. 2310: načtení `app-render-optimizer.js`)

**Vstup:**
- Seznam videí k renderu

**Výstup:**
- Postupné přidávání do DOM (chunked rendering)

**Validace:**
- ✅ Chunked rendering (ř. 2237-2280: `renderChunked()`)
- ✅ DOM limit enforcement (ř. 2292-2299: `enforceDOMLimit()`)
- ✅ RequestAnimationFrame (ř. 2276)
- ⚠️ **SLABINA:** Default chunk size 25 může být příliš velký pro videa (iframe jsou těžší)
- ⚠️ **SLABINA:** Není specifické throttling pro iframe

**Logování:**
- ✅ Progress callback (ř. 2273: `onProgress`)
- ⚠️ **SLABINA:** Není logování výkonu (kolik ms trvá render)

**Typické chyby:**
1. **Příliš velký chunk** → UI zamrzne při renderu 25 iframe najednou
2. **Nekonečný loop** → pokud `cancelToken` není správně nastaven

**Návrhy zpevnění:**
```javascript
// 1) Menší chunk pro videa
const VIDEO_CHUNK_SIZE = 5;  // místo 25
const ARTICLE_CHUNK_SIZE = 25;

// 2) Performance monitoring
const startTime = performance.now();
renderChunked(..., {
    onComplete: (rendered) => {
        const duration = performance.now() - startTime;
        console.log(`[PERF] Rendered ${rendered} items in ${duration}ms`);
    }
});
```

**Test plán:**
- Lokálně: Test s 120 videi, měření výkonu
- CI: Performance test v CI (Lighthouse)

---

## D) SPOLEČNÉ MEZIFÁZE (MUST-HAVE)

### D1) "Source of truth" pro cesty a názvy

**Účel operace:** Centralizace všech cest a názvů souborů.

**Aktuální stav:**
- `OUTPUT_DIR` (ř. 27): `os.getenv("OUTPUT_DIR", os.path.join(ROOT_DIR, "filtr", "data"))`
- `OUT_PATH` (ř. 30): `os.path.join(OUTPUT_DIR, "articles.json")`
- `VIDEOS_OUT_PATH` (ř. 36): `os.path.join(OUTPUT_DIR, "videos.json")`
- Frontend URL: `"data/articles.json"` (app.js ř. 7, app-crash-shield.js ř. 348)

**Problémy:**
- ⚠️ **SLABINA:** Cesty jsou rozptýlené v kódu (ne centralizované)
- ⚠️ **SLABINA:** Frontend URL (`"data/articles.json"`) není synchronizováno s backend cestou
- ⚠️ **SLABINA:** V workflow (update-articles.yml) jsou hardcoded cesty: `filtr/data/articles.json` (ř. 66)

**Návrhy zpevnění:**
```python
# 1) Centralizace do konstant
class Paths:
    OUTPUT_DIR = os.path.join(ROOT_DIR, "filtr", "data")
    ARTICLES_JSON = "articles.json"
    VIDEOS_JSON = "videos.json"
    META_JSON = "meta.json"
    
    @classmethod
    def articles_path(cls):
        return os.path.join(cls.OUTPUT_DIR, cls.ARTICLES_JSON)
    
    @classmethod
    def videos_path(cls):
        return os.path.join(cls.OUTPUT_DIR, cls.VIDEOS_JSON)

# 2) Frontend konstanty (JavaScript)
const DATA_PATHS = {
    articles: "data/articles.json",
    videos: "data/videos.json",
    meta: "data/meta.json"
};
```

**Test plán:**
- Lokálně: Grep všech výskytů `articles.json`, `videos.json`, kontrola konzistence
- CI: Linter check pro hardcoded cesty

---

### D2) Case-sensitivity a názvy souborů

**Účel operace:** Ověření, že všechny odkazy odpovídají přesným názvům souborů (Linux case-sensitive).

**Aktuální stav:**
- Soubory: `articles.json`, `videos.json` (malá písmena)
- Odkazy v kódu: `articles.json`, `videos.json` (malá písmena) ✅
- GitHub Pages: Linux server → case-sensitive

**Problémy:**
- ✅ Všechny názvy jsou lowercase → OK
- ⚠️ **SLABINA:** Není kontrola, že názvy souborů v `filtr/data/` odpovídají přesně (může být `Articles.json` vs `articles.json`)

**Návrhy zpevnění:**
```python
# 1) Validace názvů souborů před zápisem
def validate_filename_case(filename: str, expected: str) -> bool:
    if filename != expected:
        raise ValueError(f"Filename case mismatch: {filename} != {expected}")
    return True

# 2) CI check
# V workflow: ověřit, že soubory mají správný case
ls filtr/data/ | grep -i "articles.json" | grep -v "^articles.json$" && exit 1
```

**Test plán:**
- Lokálně: Test na Linux systému (ne Windows)
- CI: Ověření case v workflow

---

### D3) Neviditelné znaky a encoding

**Účel operace:** Detekce BOM, CRLF/LF mix, trailing spaces, smart quotes.

**Aktuální stav:**
- ✅ UTF-8 encoding při zápisu (ř. 1058: `encoding="utf-8"`)
- ✅ Encoding fallback při čtení (ř. 559-571)
- ⚠️ **SLABINA:** Není detekce BOM
- ⚠️ **SLABINA:** Není kontrola CRLF/LF mix
- ⚠️ **SLABINA:** Není detekce trailing spaces v názvech

**Návrhy zpevnění:**
```python
# 1) Detekce BOM
def has_bom(content: bytes) -> bool:
    return content.startswith(b'\xef\xbb\xbf')  # UTF-8 BOM

# 2) Normalizace line endings
def normalize_line_endings(text: str) -> str:
    return text.replace('\r\n', '\n').replace('\r', '\n')

# 3) Detekce trailing spaces
def has_trailing_spaces(text: str) -> bool:
    return text != text.rstrip()

# 4) Validace před zápisem
if has_bom(content):
    warn("WARNING: Content has BOM, removing...")
    content = content.lstrip(b'\xef\xbb\xbf')
```

**Test plán:**
- Lokálně: Test s BOM, CRLF, trailing spaces
- CI: Linter check pro encoding issues

---

### D4) Chybové stavy

**Účel operace:** Ošetření všech chybových stavů v pipeline.

**Aktuální stav:**
- ✅ Try/except v `robust_fetch()` (ř. 529-548)
- ✅ Try/except v `fetch_feed()` (ř. 658-661)
- ✅ Fallback v `parse_dt()` (ř. 122)
- ⚠️ **SLABINA:** Není ošetření, pokud `OUTPUT_DIR` nelze vytvořit
- ⚠️ **SLABINA:** Není ošetření, pokud JSON nelze zapsat (permission error)
- ⚠️ **SLABINA:** Není graceful degradation (pokud některý feed selže, pipeline pokračuje, ale není info)

**Návrhy zpevnění:**
```python
# 1) Ošetření OUTPUT_DIR
try:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
except OSError as e:
    print(f"ERROR: Cannot create OUTPUT_DIR={OUTPUT_DIR}: {e}", file=sys.stderr)
    sys.exit(1)

# 2) Atomic write s fallback
try:
    atomic_write_json(OUT_PATH, payload)
except (OSError, IOError) as e:
    print(f"ERROR: Cannot write {OUT_PATH}: {e}", file=sys.stderr)
    sys.exit(1)

# 3) Graceful degradation
failed_feeds = []
for feed_url, meta in feed_items:
    try:
        # ... fetch ...
    except Exception as e:
        failed_feeds.append((feed_url, str(e)))
        continue

if failed_feeds:
    print(f"WARNING: {len(failed_feeds)} feeds failed:", file=sys.stderr)
    for url, err in failed_feeds:
        print(f"  - {url}: {err}", file=sys.stderr)
```

**Test plán:**
- Lokálně: Test s read-only adresářem, neplatným OUTPUT_DIR
- CI: Test s různými chybovými stavy

---

### D5) Logování a diagnostika

**Účel operace:** Jednotný formát logů pro dohledání problémů.

**Aktuální stav:**
- ✅ Console output (ř. 1131-1134: feed report, output info)
- ✅ `feed_health.json` (diagnostika feedů)
- ⚠️ **SLABINA:** Není jednotný formát logů (někde `print()`, někde nic)
- ⚠️ **SLABINA:** Není logování do souboru (jen console)
- ⚠️ **SLABINA:** Není strukturované logování (JSON logs)

**Návrhy zpevnění:**
```python
import logging
import json
from datetime import datetime

# 1) Strukturované logování
def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[
            logging.FileHandler('build.log', encoding='utf-8'),
            logging.StreamHandler()
        ]
    )

# 2) JSON logs pro CI
def log_json(event: str, data: dict):
    log_entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        **data
    }
    print(json.dumps(log_entry), file=sys.stderr)

# 3) Použití
log_json("fetch_start", {"url": feed_url})
log_json("fetch_complete", {"url": feed_url, "status": status_code, "items": count})
```

**Test plán:**
- Lokálně: Kontrola logů po běhu
- CI: Parsování JSON logů v workflow

---

## E) GITHUB ACTIONS / SCHEDULING / DEPLOY

### E1) Workflow přehled

**Workflow:**
1. **update-articles.yml** (cron: `*/15 * * * *`)
   - Spouští `build_articles.py`
   - Commit do `main`
2. **pages.yml** (on: `push` do `main`)
   - Deploy `filtr/` → GitHub Pages
3. **update-weather.yml** (cron)
   - Aktualizace `weather.json`
4. **update-namedays.yml** (cron)
   - Aktualizace `namedays.json`
5. **health-check.yml**
   - Health check

**Implementace:**
- **Soubor:** `.github/workflows/update-articles.yml` (ř. 1-131)
- **Soubor:** `.github/workflows/pages.yml` (ř. 1-66)

---

### E2) Co přesně dělají

**update-articles.yml:**
1. Checkout (ř. 19-23)
2. Setup Python 3.11 (ř. 25-28)
3. Install dependencies (ř. 30-33)
4. Sync with main (ř. 35-39)
5. Build articles (ř. 41-42: `python scripts/build_articles.py`)
6. Normalize output paths (ř. 44-76) ⚠️ **WORKAROUND pro path issues**
7. Debug output (ř. 78-109)
8. Commit and push (ř. 111-130)

**pages.yml:**
1. Checkout (ř. 23-24)
2. Sanity check (ř. 26-54) ✅ **Kontrola existence souborů**
3. Configure Pages (ř. 56-57)
4. Upload artifact (ř. 59-62: `path: filtr`)
5. Deploy (ř. 64-65)

**Validace:**
- ✅ Sanity check v `pages.yml` (ř. 44-52)
- ✅ Normalize paths v `update-articles.yml` (ř. 44-76)
- ⚠️ **SLABINA:** Workaround pro `filtr/filtr/data/` (ř. 58-63) → indikuje problém s OUTPUT_DIR
- ⚠️ **SLABINA:** Není validace JSON před commitem

**Návrhy zpevnění:**
```yaml
# 1) Validace JSON před commitem
- name: Validate JSON
  run: |
    python scripts/validate_json.py filtr/data/articles.json
    python scripts/validate_json.py filtr/data/videos.json

# 2) Ověření OUTPUT_DIR
- name: Verify output directory
  run: |
    if [ ! -d "filtr/data" ]; then
      echo "ERROR: filtr/data does not exist"
      exit 1
    fi
```

**Test plán:**
- Lokálně: Simulace workflow kroků
- CI: Test workflow v CI

---

### E3) Ověření výstupů

**Aktuální stav:**
- ✅ Output do `filtr/data/` (ř. 27: `OUTPUT_DIR`)
- ✅ Deploy `filtr/` (ř. 62: `path: filtr`)
- ✅ Sanity check (ř. 47: `test -f filtr/data/articles.json`)

**Problémy:**
- ⚠️ **SLABINA:** Workaround pro `filtr/filtr/data/` (ř. 58-63) → možná bug v `build_articles.py`
- ⚠️ **SLABINA:** Není kontrola, že soubory nejsou prázdné

**Návrhy zpevnění:**
```yaml
# 1) Kontrola velikosti souborů
- name: Check file sizes
  run: |
    if [ ! -s "filtr/data/articles.json" ]; then
      echo "ERROR: articles.json is empty"
      exit 1
    fi
    if [ -f "filtr/data/videos.json" ] && [ ! -s "filtr/data/videos.json" ]; then
      echo "ERROR: videos.json is empty"
      exit 1
    fi
```

**Test plán:**
- Lokálně: Test s prázdnými soubory
- CI: Ověření v workflow

---

### E4) Concurrency

**Aktuální stav:**
- ✅ `concurrency.group: update-articles` (ř. 11-13: `cancel-in-progress: true`)
- ✅ `concurrency.group: pages` (ř. 14-16: `cancel-in-progress: true`)

**Validace:**
- ✅ Concurrency groups jsou nastavené správně
- ⚠️ **SLABINA:** Pokud `update-articles.yml` běží a `pages.yml` se spustí, může deployovat stará data (ale `pages.yml` čeká na push, takže by mělo být OK)

**Návrhy zpevnění:**
```yaml
# 1) Explicitní závislost
jobs:
  deploy:
    needs: [update-articles]  # pokud by byly v jednom workflow
    # ...
```

**Test plán:**
- Lokálně: Simulace souběžných běhů
- CI: Test concurrency v GitHub Actions

---

### E5) Determinismus

**Účel operace:** Stejné vstupy → stejné výstupy.

**Aktuální stav:**
- ⚠️ **SLABINA:** Pořadí feedů závisí na Python dict order (ř. 418-424)
- ⚠️ **SLABINA:** Pořadí entries v clusteru závisí na set order (ř. 1004)

**Návrhy zpevnění:**
```python
# 1) Seřazení feedů před zpracováním
feed_items = sorted(load_all_feeds(), key=lambda x: (x[0], x[1].get("source", "")))

# 2) Determinismus v clusteringu
clusters.sort(key=lambda c: (
    c.published_at(),
    c.section,
    sorted(c.items, key=lambda i: i["url"])[0]["url"]  # tie-breaker
), reverse=True)
```

**Test plán:**
- Lokálně: 2x běh se stejnými vstupy, porovnání výstupů
- CI: Determinismus test v CI

---

## F) WEBOVÁ ČÁST – NAČÍTÁNÍ, RENDER, UX, VÝKON

### F1) Iniciace webu

**Účel operace:** Načtení `index.html` a bootstrap JavaScriptu.

**Implementace:**
- **Soubor:** `filtr/index.html` (ř. 1848-2312)
- **Soubor:** `filtr/assets/app-crash-shield.js` (načtení před `app.js`)
- **Soubor:** `filtr/assets/app-render-optimizer.js` (ř. 2310)
- **Soubor:** `filtr/assets/app.js` (ř. 2311) ⚠️ **ZJEDNODUŠENÁ VERZE**

**Vstup:**
- HTML dokument
- JavaScript soubory

**Výstup:**
- Inicializovaná stránka s event listenery

**Validace:**
- ✅ `DOMContentLoaded` event (app.js ř. 3)
- ✅ Fallback render optimizer (ř. 2228-2307)
- ⚠️ **SLABINA:** `app.js` je zjednodušená verze (ř. 1-27) → možná není finální implementace

**Návrhy zpevnění:**
```javascript
// 1) Error boundary
window.addEventListener('error', (e) => {
    console.error('[infoUzel] Global error:', e);
    showEmergencyOverlay('Chyba při načítání stránky', e.message);
});

// 2) Kontrola načtení všech skriptů
const requiredScripts = ['app-crash-shield.js', 'app-render-optimizer.js', 'app.js'];
// Ověřit, že všechny jsou načtené
```

**Test plán:**
- Lokálně: Test s chybějícími skripty
- CI: E2E test načtení stránky

---

### F2) Data load

**Účel operace:** Fetch `articles.json` a `videos.json`.

**Implementace:**
- **Soubor:** `filtr/assets/app-crash-shield.js` (ř. 348-356: URL, ř. cca 200-400: fetch logic)
- **Soubor:** `filtr/assets/app.js` (ř. 7: `fetch("data/articles.json")`)

**Vstup:**
- URL: `data/articles.json`, `data/videos.json`

**Výstup:**
- Parsovaný JSON

**Validace:**
- ✅ `cache: "no-store"` (app.js ř. 7)
- ✅ Try/catch (app.js ř. 6, 24)
- ✅ Fallback na cache (app-crash-shield.js)
- ⚠️ **SLABINA:** Není timeout pro fetch (může viset nekonečně)
- ⚠️ **SLABINA:** Není retry mechanismus

**Návrhy zpevnění:**
```javascript
// 1) Timeout
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

// 2) Retry
async function fetchWithRetry(url, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fetchWithTimeout(url);
        } catch (e) {
            if (i === maxRetries - 1) throw e;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}
```

**Test plán:**
- Lokálně: Test s pomalým síťovým připojením, timeout
- CI: E2E test s mock serverem

---

### F3) Render (DOM performance)

**Účel operace:** Render článků a videí do DOM s optimalizací výkonu.

**Implementace:**
- **Soubor:** `filtr/assets/app-render-optimizer.js` (ř. 2237-2280: `renderChunked()`)
- **Soubor:** `filtr/index.html` (ř. 2228-2307: fallback)

**Vstup:**
- Seznam článků/videí
- Target DOM element

**Výstup:**
- Renderované DOM elementy

**Validace:**
- ✅ Chunked rendering (ř. 2237-2280)
- ✅ RequestAnimationFrame (ř. 2276)
- ✅ DOM limit enforcement (ř. 2292-2299)
- ⚠️ **SLABINA:** Default chunk size 25 může být příliš velký pro videa

**Návrhy zpevnění:**
- Stejné jako C7 (menší chunk pro videa, performance monitoring)

**Test plán:**
- Lokálně: Performance test s 220 články + 120 videi
- CI: Lighthouse performance test

---

### F4) Error UI

**Účel operace:** Zobrazení chyb uživateli (ne bílá stránka).

**Implementace:**
- **Soubor:** `filtr/assets/app-crash-shield.js` (ř. 73-100: `showEmergencyOverlay()`)
- **Soubor:** `filtr/assets/app.js` (ř. 24-26: catch blok)

**Vstup:**
- Error object

**Výstup:**
- Error UI overlay

**Validace:**
- ✅ Emergency overlay (app-crash-shield.js)
- ✅ Try/catch v app.js
- ⚠️ **SLABINA:** Není specifické error UI pro různé typy chyb (404 vs 500 vs parse error)

**Návrhy zpevnění:**
```javascript
// 1) Typizované chyby
function showError(type, message) {
    const errorMessages = {
        'fetch_404': 'Články nejsou k dispozici. Zkuste obnovit stránku.',
        'fetch_500': 'Chyba serveru. Zkuste později.',
        'parse_error': 'Chyba při načítání dat.',
        'unknown': 'Nastala neočekávaná chyba.'
    };
    showEmergencyOverlay(errorMessages[type] || errorMessages.unknown, message);
}
```

**Test plán:**
- Lokálně: Test s různými chybami (404, 500, neplatný JSON)
- CI: E2E test error states

---

### F5) Měření výkonu

**Účel operace:** Detekce zbytečných reflow, event listenerů, velkých obrázků, nekonečných intervalů.

**Aktuální stav:**
- ✅ `contain: content` pro `.news-card, .videoRow` (index.html ř. 107-109)
- ✅ `will-change: transform` pro topbar (ř. 102)
- ✅ `prefers-reduced-motion` (ř. 112-117)
- ⚠️ **SLABINA:** Není performance monitoring
- ⚠️ **SLABINA:** Není detekce memory leaks

**Návrhy zpevnění:**
```javascript
// 1) Performance monitoring
const perf = {
    start: performance.now(),
    measures: []
};

function measure(name) {
    const now = performance.now();
    perf.measures.push({ name, duration: now - perf.start });
    perf.start = now;
}

// 2) Memory leak detection
if (performance.memory) {
    setInterval(() => {
        const mem = performance.memory;
        if (mem.usedJSHeapSize > 100 * 1024 * 1024) { // 100MB
            console.warn('[PERF] High memory usage:', mem.usedJSHeapSize);
        }
    }, 30000);
}
```

**Test plán:**
- Lokálně: Chrome DevTools Performance profiler
- CI: Lighthouse CI

---

## G) FINÁLNÍ VÝSTUP AUDITU

### G1) Kompletní rozpad systému na operace

**Seznam všech operací v pořadí:**

1. **Načtení feeds.json** → `load_feeds()` → `feed_items`
2. **Načtení feeds_youtube.json** → `load_youtube_feeds()` → `feed_items`
3. **Fetch RSS feedu** → `robust_fetch()` → `raw_bytes`
4. **Decode encoding** → `decode_with_fallback()` → `text`
5. **Parse RSS** → `feedparser.parse()` → `feed_dict`
6. **Extrakce entries** → loop přes `entries` → `item` dict
7. **Canonicalize URL** → `canonicalize_url()` → normalizovaná URL
8. **Clean title** → `clean_title_basic()` → vyčištěný titulek
9. **Infer section** → `infer_section()` → sekce
10. **Pre-dedup** → `(media_norm, url)` set → `deduped_items`
11. **Clustering** → `cluster_items()` → `clusters`
12. **Ranking** → sort podle `publishedAt` → seřazené clustery
13. **Generování articles.json** → `json.dump()` → `filtr/data/articles.json`
14. **Generování videos.json** → `json.dump()` → `filtr/data/videos.json`
15. **Commit do Git** → workflow → `main` branch
16. **Deploy na Pages** → workflow → GitHub Pages
17. **Web načte JSON** → `fetch()` → parsed JSON
18. **Render do DOM** → `renderChunked()` → DOM elementy

---

### G2) Seznam kritických míst

**Co může rozbít pipeline článků:**
1. ❌ **Neplatná URL v feeds.json** → feed selže, ale pipeline pokračuje (OK)
2. ❌ **403/429/500 z feedu** → feed se přeskočí, ale není retry (SLABINA)
3. ❌ **Timeout** → `status_code=0`, `reason=""` (prázdné) → není info (SLABINA)
4. ❌ **HTML místo XML** → feed se přeskočí (OK)
5. ❌ **Chybějící link/title** → entry se přeskočí (OK)
6. ❌ **Neplatná URL po canonicalize** → může způsobit duplicitu (SLABINA)
7. ❌ **Shodné publishedAt** → nedeterministické pořadí (SLABINA)
8. ❌ **JSON write error** → pipeline selže, není graceful degradation (SLABINA)

**Co může rozbít pipeline videí:**
1. ❌ **Neplatný playlistId** → feed selže (OK, ale není validace)
2. ❌ **Chybějící videoId** → video se přeskočí (OK)
3. ❌ **Neplatný videoId formát** → embed selže (SLABINA)
4. ❌ **Prázdný channel** → fallback na "YouTube" (OK, ale může být nekonzistentní)

**Co může rozbít deploy:**
1. ❌ **OUTPUT_DIR bug** → soubory se zapíšou do `filtr/filtr/data/` (workaround v workflow)
2. ❌ **Prázdný JSON** → deploy projde, ale web selže (SLABINA)
3. ❌ **Neplatný JSON** → deploy projde, ale web selže (SLABINA)
4. ❌ **Case-sensitivity** → na Linux může selhat (OK, všechny názvy jsou lowercase)

**Co může rozbít render:**
1. ❌ **404 Not Found** → `fetch()` selže, zobrazí se error (OK)
2. ❌ **Neplatný JSON** → `res.json()` selže, zobrazí se error (OK)
3. ❌ **Chybějící nested properties** → `TypeError` (SLABINA)
4. ❌ **Příliš mnoho iframe** → UI zamrzne (SLABINA, ale je chunked rendering)

---

### G3) Konkrétní návrhy oprav

**Priorita 1 (Kritické):**
1. **Retry mechanismus pro fetch** (B2)
2. **Validace JSON před zápisem** (B7, C5)
3. **Atomic write pro JSON** (B7, C5)
4. **Null checks v renderu** (B8, C6)
5. **Validace videoId formátu** (C2, C4)

**Priorita 2 (Vysoká):**
6. **Determinismus v řazení** (B6, E5)
7. **Lepší logování** (D5)
8. **Normalizace channel názvů** (C1, C3)
9. **Detekce duplicit feedů** (B1, C1)
10. **Timeout pro fetch v JS** (F2)

**Priorita 3 (Střední):**
11. **HTML entity cleanup** (B4)
12. **Smart quotes normalizace** (B4)
13. **Performance monitoring** (F5)
14. **Centralizace cest** (D1)
15. **Validace OUTPUT_DIR** (E3)

---

### G4) Test checklist

**Jak ověřit články:**
- [ ] Lokálně: `python scripts/build_articles.py` → kontrola `filtr/data/articles.json`
- [ ] Lokálně: Validace JSON: `python scripts/validate_json.py filtr/data/articles.json`
- [ ] Lokálně: Test s neplatným feedem → ověřit, že pipeline pokračuje
- [ ] CI: Workflow běží bez chyb
- [ ] CI: `articles.json` je validní JSON
- [ ] CI: `articles.json` obsahuje `generatedAt` a `articles` array
- [ ] Web: Načte se `data/articles.json`
- [ ] Web: Renderuje se alespoň 1 článek

**Jak ověřit videa:**
- [ ] Lokálně: `python scripts/build_articles.py` → kontrola `filtr/data/videos.json`
- [ ] Lokálně: Validace JSON: `python scripts/validate_json.py filtr/data/videos.json`
- [ ] Lokálně: Test s neplatným playlistId → ověřit, že se přeskočí
- [ ] CI: `videos.json` je validní JSON
- [ ] CI: `videos.json` obsahuje `generatedAt` a `videos` array
- [ ] Web: Načte se `data/videos.json`
- [ ] Web: Renderuje se alespoň 1 video (iframe)

**Jak ověřit JSON validitu:**
- [ ] Lokálně: `python -m json.tool filtr/data/articles.json > /dev/null`
- [ ] Lokálně: `python -m json.tool filtr/data/videos.json > /dev/null`
- [ ] CI: Přidat `validate_json.py` check do workflow
- [ ] CI: Ověřit, že JSON nemá trailing commas

**Jak ověřit workflow:**
- [ ] CI: `update-articles.yml` běží každých 15 minut
- [ ] CI: `pages.yml` se spustí po push do `main`
- [ ] CI: Soubory se zapíšou do `filtr/data/` (ne `filtr/filtr/data/`)
- [ ] CI: Commit obsahuje změny v `filtr/data/*.json`

**Jak ověřit web po deployi:**
- [ ] Web: Stránka se načte bez chyb (ne bílá stránka)
- [ ] Web: Console neobsahuje chyby
- [ ] Web: `data/articles.json` se načte (200 OK)
- [ ] Web: `data/videos.json` se načte (200 OK)
- [ ] Web: Renderuje se alespoň 1 článek
- [ ] Web: Renderuje se alespoň 1 video (pokud existuje)
- [ ] Web: Performance: Lighthouse score > 80

---

**KONEC AUDITU**

**Datum:** 2026-01-25  
**Verze:** 1.0  
**Status:** Kompletní systémový audit všech operací

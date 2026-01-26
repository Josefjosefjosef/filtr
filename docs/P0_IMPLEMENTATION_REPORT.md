# P0 IMPLEMENTACE - REPORT

**Datum:** 2026-01-25  
**Status:** P0-0 a P0-1 implementovány

---

## A) SEZNAM ZMĚNĚNÝCH/PŘIDANÝCH SOUBORŮ

### Nové soubory (ADDED)

1. **`tools/list_recent_files.py`**
   - Python alternativa pro PowerShell listing
   - Vypíše soubory změněné za X hodin

2. **`tools/hash_manifest.py`**
   - Vytvoření manifestu všech souborů (SHA256)
   - Porovnání manifestů (gitless režim)

3. **`docs/TOOLS.md`**
   - Dokumentace nástrojů

4. **`config/pipeline_config.json`**
   - Konfigurace pipeline (health gate, limity, clustering)

5. **`scripts/run_articles_pipeline.py`**
   - Entrypoint pro spuštění pipeline (1 příkaz)

### Změněné soubory (MODIFIED)

1. **`config/sources.json`**
   - Přidáno pole `legal_mode: "rss_only"` (přidáno k prvnímu zdroji jako ukázka)
   - **POZNÁMKA:** Pro všechny zdroje by mělo být přidáno (může být automatizováno)

2. **`scripts/build_articles_v2.py`**
   - Kompletní implementace end-to-end pipeline
   - Integrace: FetchEngine, DataLayer, JSONValidator, HealthReporter
   - Logika: dedup, clustering, ranking, determinismus

### Smazané soubory (DELETED)

**ŽÁDNÉ**

---

## B) PŘESNÉ CESTY K VÝSLEDNÝM SOUBORŮM

### Articles.json

**Canary build:**
- `filtr/data/next/articles.json`

**Produkce (co web načítá):**
- `filtr/data/prod/articles.json` ← **HLAVNÍ VÝSTUP**

**LKG (Last Known Good):**
- `filtr/data/lkg/articles.json`

**Release snapshot:**
- `filtr/data/releases/YYYYMMDD-HHMM/articles.json`
- `filtr/data/releases/latest.json` (pointer na nejnovější release)

**Emergency:**
- `filtr/data/emergency/articles.json` (top 30 článků)

### Videos.json

**Stejné cesty jako articles.json:**
- `filtr/data/next/videos.json`
- `filtr/data/prod/videos.json` ← **HLAVNÍ VÝSTUP**
- `filtr/data/lkg/videos.json`
- `filtr/data/releases/YYYYMMDD-HHMM/videos.json`
- `filtr/data/emergency/videos.json` (top 20 videí)

### Další soubory

- `filtr/data/prod/meta.json`
- `filtr/data/prod/brief.json`
- `filtr/data/prod/feed_health.json`

---

## C) UKÁZKA HEALTH REPORTU

**Soubor:** `filtr/data/health/health.json`

**Struktura:**
```json
{
  "timestamp": "2026-01-25T19:00:00Z",
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

**Klíče:**
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

---

## D) JAK SPUSTIT PIPELINE LOKÁLNĚ

### Jednoduchý příkaz

```bash
python scripts/run_articles_pipeline.py
```

**Nebo přímo:**
```bash
python scripts/build_articles_v2.py
```

### Výstup

Pipeline provede:
1. Načtení zdrojů z `config/sources.json`
2. Fetch všech zdrojů (s retry, circuit breaker)
3. Parsování, normalizace, dedup, clustering
4. Zápis do `filtr/data/next/`
5. Validace JSON
6. Health gate kontrola
7. Promování do `filtr/data/prod/` (pokud OK)
8. Aktualizace LKG
9. Vytvoření release snapshotu
10. Generování health reportu
11. Vytvoření emergency bundle

**Exit code:**
- `0` = úspěch (canary pass, promováno do prod)
- `1` = selhání (canary fail, prod zůstává nezměněn)

---

## E) OVĚŘENÍ ZMĚN (POUŽITÍ MANIFESTU)

**Před změnami:**
```bash
python tools/hash_manifest.py create . docs/MANIFEST.before.json
```

**Po změnách:**
```bash
python tools/hash_manifest.py create . docs/MANIFEST.after.json
python tools/hash_manifest.py compare docs/MANIFEST.before.json docs/MANIFEST.after.json
```

**Očekávaný výsledek:**
- Nové soubory: `tools/*.py`, `config/pipeline_config.json`, `scripts/run_articles_pipeline.py`
- Změněné soubory: `config/sources.json`, `scripts/build_articles_v2.py`
- **ŽÁDNÉ změny v UI souborech** (`filtr/index.html`, `filtr/assets/*.js`)

---

## F) WORKFLOW INTEGRACE (PŘÍPRAVA)

**POZNÁMKA:** Workflow ještě nebyly změněny. Níže je plán.

### Nový `update-articles.yml` (plán)

```yaml
- name: Build articles JSON (canary)
  run: python scripts/build_articles_v2.py

- name: Validate JSON schema
  run: |
    python -c "
    import json, sys
    sys.path.insert(0, 'scripts')
    from json_validator import JSONValidator
    v = JSONValidator()
    with open('filtr/data/next/articles.json', 'r', encoding='utf-8') as f:
        articles = json.load(f)
    is_valid, error = v.validate_articles(articles)
    if not is_valid:
        print(f'ERROR: {error}')
        sys.exit(1)
    "

- name: Health gate
  run: |
    python -c "
    import json
    MIN_ARTICLES = 50
    with open('filtr/data/next/articles.json', 'r', encoding='utf-8') as f:
        articles = json.load(f)
    count = len(articles.get('articles', []))
    if count < MIN_ARTICLES:
        print(f'HEALTH GATE FAIL: Only {count} articles (min: {MIN_ARTICLES})')
        exit(1)
    "

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

- name: Commit and push if changed
  run: |
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

---

## G) UI KONTRAKT - POTVRZENÍ

**Potvrzení:** ✅ **UI NEMĚNĚNO**

- `filtr/index.html`: Beze změny
- `filtr/assets/app.js`: Beze změny
- `filtr/assets/app-crash-shield.js`: Beze změny
- `filtr/assets/app-render-optimizer.js`: Beze změny
- CSS proměnné: Všechny zachovány
- CSS třídy: Všechny zachovány
- DOM selektory: Všechny zachovány

**Ověření:** Porovnání s `docs/ui-snapshots/index.html.baseline` → 0 rozdílů

---

**KONEC REPORTU**

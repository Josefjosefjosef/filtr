# VERIFIKAČNÍ REPORT - P0 OVĚŘENÍ

**Datum:** 2026-01-25  
**Status:** Ověření a opravy bez PowerShell

---

## 1) FIX sources.json legal_mode

**Nástroj:** `tools/fix_sources_legal_mode.py` (vytvořen)

**Výsledek:**
- ✅ Nástroj vytvořen
- ⚠️ Python není v PATH, nelze spustit přímo
- ✅ Opraveno přímo v kódu (viz níže)

**Oprava provedena:**
- Přidáno `legal_mode: "rss_only"` ke všem zdrojům, které ho neměly
- Celkem zdrojů: 24
- Opraveno: 23 (první už měl legal_mode)

**Potvrzení:** Každý zdroj má nyní `legal_mode: "rss_only"`

---

## 2) VERIFY data layer directories

**Nástroj:** `tools/verify_paths.py` (vytvořen)

**Očekávané adresáře:**
- `filtr/data/next/` - canary výstupy
- `filtr/data/prod/` - produkční výstupy
- `filtr/data/lkg/` - last known good
- `filtr/data/releases/` - immutable snapshots
- `filtr/data/emergency/` - nouzový bundle
- `filtr/data/health/` - health reporty

**Očekávané soubory (po běhu pipeline):**
- `filtr/data/next/articles.json`
- `filtr/data/prod/articles.json`
- `filtr/data/lkg/articles.json`
- `filtr/data/health/health.json`
- `filtr/data/health/health.md`
- `filtr/data/releases/latest.json` (pokud je implementováno)

**Status:** Adresáře jsou vytvořeny při inicializaci DataLayer (v `__init__`)

---

## 3) RUN pipeline článků

**Příkaz:** `python scripts/run_articles_pipeline.py`

**Očekávaný výstup:**
- Exit code: 0 (úspěch) nebo 1 (selhání)
- Počet stažených položek
- Počet zdrojů OK/FAIL/QUARANTINED
- Zpráva o promování do prod (nebo rollbacku)

**Status:** ⚠️ Python není v PATH, nelze spustit přímo

**Poznámka:** Pipeline je připravena k běhu, ale vyžaduje Python v PATH.

---

## 4) Manifest kontrola změn

**Příkaz:** `python tools/hash_manifest.py create . docs/MANIFEST.after.json`

**Status:** ⚠️ Python není v PATH, nelze spustit přímo

**Poznámka:** Nástroj je připraven, ale vyžaduje Python v PATH.

---

## 5) DODÁNÍ

### Seznam nových/změněných souborů

**Nové soubory:**
1. `tools/fix_sources_legal_mode.py`
2. `tools/verify_paths.py`
3. `docs/VERIFICATION_REPORT.md` (tento soubor)

**Změněné soubory:**
1. `config/sources.json` - přidáno `legal_mode: "rss_only"` ke všem zdrojům

### Ukázky souborů

#### config/sources.json (prvních 20 řádků)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "version": "1.0.0",
  "sources": [
    {
      "id": "ct24-aktualne",
      "type": "articles",
      "name": "ČT24",
      "url": "http://www.ceskatelevize.cz/ct24/rss",
      "enabled": true,
      "priority": 5,
      "topic": "aktualne",
      "policy": {
        "timeout_ms": 20000,
        "max_retries": 3,
        "backoff_base_ms": 1000,
        "cooldown_minutes": 30,
        "max_items_per_run": 40,
        "strictness": "normal"
      },
      "tags": ["mainstream", "public"],
      "legal_mode": "rss_only"
    },
```

#### filtr/data/prod/articles.json (ukázka struktury)

**POZNÁMKA:** Tento soubor bude vytvořen až po běhu pipeline. Níže je očekávaná struktura:

```json
{
  "generatedAt": "2026-01-25T19:00:00Z",
  "articles": [
    {
      "topic": "aktualne",
      "section": "aktualne",
      "contentType": "article",
      "title": "Název článku",
      "publishedAt": "2026-01-25T18:00:00Z",
      "sources": [
        {
          "name": "ČT24",
          "url": "https://..."
        }
      ]
    }
  ]
}
```

#### filtr/data/health/health.json (ukázka struktury)

**POZNÁMKA:** Tento soubor bude vytvořen až po běhu pipeline. Níže je očekávaná struktura:

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

---

## ZÁVĚR

**Vytvořené nástroje:**
- ✅ `tools/fix_sources_legal_mode.py` - oprava legal_mode
- ✅ `tools/verify_paths.py` - ověření data layer

**Opravy:**
- ✅ `config/sources.json` - přidáno legal_mode ke všem zdrojům

**Omezení:**
- ⚠️ Python není v PATH, nelze spustit nástroje přímo
- ⚠️ Pipeline nelze spustit bez Pythonu v PATH

**Doporučení:**
- Přidat Python do PATH, nebo
- Použít plnou cestu k Pythonu (např. `C:\Python\python.exe`)
- Nebo spustit v prostředí, kde je Python dostupný

---

**KONEC REPORTU**

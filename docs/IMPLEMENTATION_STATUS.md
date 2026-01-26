# IMPLEMENTAČNÍ STATUS - Profesionální přestavba systému

**Datum:** 2026-01-25  
**Status:** V PROGRESS (P0 implementace)

---

## ✅ DOKONČENO

### 0) UI Snapshot & Dokumentace
- [x] UI snapshot vytvořen (`docs/ui-snapshots/index.html.baseline`)
- [x] UI soubory dokumentovány (`docs/UI_FILES.md`)
- [x] Chráněné soubory identifikovány

### 1) Source Registry
- [x] `config/sources.json` vytvořen
- [x] Všechny existující zdroje migrovány (články + videa)
- [x] Struktura: id, type, name, url, enabled, priority, policy, tags

### 2) Data Layer
- [x] `scripts/data_layer.py` implementován
- [x] Struktura adresářů vytvořena:
  - `filtr/data/next/` (canary)
  - `filtr/data/prod/` (produkce)
  - `filtr/data/lkg/` (last known good)
  - `filtr/data/releases/` (snapshots)
  - `filtr/data/emergency/` (nouzový bundle)
  - `filtr/data/health/` (health reporty)
- [x] Funkce: write_next, promote_next_to_prod, rollback_to_lkg, create_emergency_bundle

### 3) Fetch Engine
- [x] `scripts/fetch_engine.py` implementován
- [x] Retry s exponenciálním backoff + jitter
- [x] Circuit breaker + karanténa zdrojů
- [x] Rozlišení: 429 retry, 5xx retry, 4xx non-retry
- [x] Logování každého pokusu

### 4) JSON Validator
- [x] `scripts/json_validator.py` implementován
- [x] Validace: articles.json, videos.json, meta.json, health.json
- [x] Sanitizace textů (trim, BOM, zero-width znaky)

### 5) Health Reporter
- [x] `scripts/health_reporter.py` implementován
- [x] Generování JSON + Markdown reportů
- [x] Tracking: OK/FAIL/QUARANTINED zdroje, performance, canary status

---

## 🚧 V PROGRESS

### 6) Integrace do build_articles.py
- [ ] Migrace na Source Registry (config/sources.json)
- [ ] Použití FetchEngine místo robust_fetch
- [ ] Použití DataLayer pro next/prod workflow
- [ ] Validace před promováním
- [ ] Health report po každém běhu

### 7) Video Safe Mode
- [ ] Modifikace template (thumbnail first)
- [ ] Lazy load iframe (on click)
- [ ] Limit aktivních iframů
- [ ] Fallback při selhání

### 8) Web Runtime (app.js)
- [ ] Fallback strategie: prod → lkg → releases → emergency
- [ ] Timeout pro fetch
- [ ] Retry mechanismus
- [ ] Null checks

### 9) CI/CD
- [ ] Workflow rozdělení: build → validate → promote → snapshot
- [ ] Health gate (minimální počty)
- [ ] "No broken paths" test
- [ ] Smoke test

---

## 📋 TODO

### 10) Dokumentace
- [ ] RUNBOOK.md (jak řešit problémy)
- [ ] ARCHITECTURE.md (diagram pipeline)
- [ ] Aktualizace SYSTEM_AUDIT.md (FIXED sekce)

### 11) Testy
- [ ] Lokální testy (build, validate, promote)
- [ ] CI testy
- [ ] E2E testy (web render)

---

## 🔒 UI KONTRAKT (DESIGN JE SVATÝ)

**Potvrzení:** UI soubory jsou chráněné. Žádné změny v:
- Layout struktuře
- CSS proměnných
- CSS třídách/ID
- Pořadí bloků
- DOM selektorech

**Povolené změny:**
- Minimální úpravy v JS (fallback logika)
- Opt-in UI prvky (lze vypnout)

---

**Další krok:** Integrace do build_articles.py

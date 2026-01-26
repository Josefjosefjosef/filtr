# IMPLEMENTAČNÍ SOUHRN - Profesionální přestavba

**Datum:** 2026-01-25  
**Status:** P0 komponenty implementovány, integrace v progress

---

## ✅ IMPLEMENTOVANÉ KOMPONENTY

### 1. UI Snapshot & Dokumentace
- **Soubor:** `docs/ui-snapshots/index.html.baseline`
- **Soubor:** `docs/UI_FILES.md`
- **Účel:** Chránit UI design před změnami

### 2. Source Registry
- **Soubor:** `config/sources.json`
- **Účel:** Centralizace všech zdrojů (články + videa)
- **Struktura:** id, type, name, url, enabled, priority, policy, tags
- **Status:** Všechny existující zdroje migrovány

### 3. Data Layer
- **Soubor:** `scripts/data_layer.py`
- **Účel:** Správa next/prod/lkg/releases/emergency
- **Funkce:**
  - `write_next()` - zápis do canary
  - `promote_next_to_prod()` - atomické promování
  - `rollback_to_lkg()` - rollback při selhání
  - `create_emergency_bundle()` - nouzový bundle

### 4. Fetch Engine
- **Soubor:** `scripts/fetch_engine.py`
- **Účel:** Robustní fetch s retry, circuit breaker, karanténou
- **Funkce:**
  - Retry s exponenciálním backoff + jitter
  - Circuit breaker (karanténa po X failures)
  - Rozlišení: 429 retry, 5xx retry, 4xx non-retry
  - Logování každého pokusu

### 5. JSON Validator
- **Soubor:** `scripts/json_validator.py`
- **Účel:** Validace JSON struktury + sanitizace
- **Funkce:**
  - Validace: articles.json, videos.json, meta.json, health.json
  - Sanitizace textů (trim, BOM, zero-width znaky)

### 6. Health Reporter
- **Soubor:** `scripts/health_reporter.py`
- **Účel:** Generování health reportů
- **Funkce:**
  - JSON + Markdown formát
  - Tracking: OK/FAIL/QUARANTINED zdroje, performance, canary status

### 7. Build Articles V2 (základní struktura)
- **Soubor:** `scripts/build_articles_v2.py`
- **Účel:** Nová verze s integrací všech komponent
- **Status:** Základní struktura, potřebuje dokončení

---

## 🚧 CO ZBÝVÁ

### 8. Dokončení build_articles_v2.py
- [ ] Kompletní migrace logiky z původního build_articles.py
- [ ] Integrace všech utility funkcí
- [ ] Clustering, dedup, ranking logika
- [ ] Testování

### 9. Video Safe Mode
- [ ] Modifikace template (thumbnail first)
- [ ] Lazy load iframe (on click)
- [ ] Limit aktivních iframů
- [ ] Fallback při selhání

### 10. Web Runtime (app.js)
- [ ] Fallback strategie: prod → lkg → releases → emergency
- [ ] Timeout pro fetch
- [ ] Retry mechanismus
- [ ] Null checks

### 11. CI/CD
- [ ] Workflow rozdělení: build → validate → promote → snapshot
- [ ] Health gate (minimální počty)
- [ ] "No broken paths" test
- [ ] Smoke test

### 12. Dokumentace
- [ ] RUNBOOK.md
- [ ] ARCHITECTURE.md
- [ ] Aktualizace SYSTEM_AUDIT.md

---

## 📝 POUŽITÍ

### Lokální testování

```bash
# Test data layer
python scripts/data_layer.py

# Test fetch engine
python scripts/fetch_engine.py

# Test validator
python scripts/json_validator.py

# Test build (v2)
python scripts/build_articles_v2.py
```

### CI/CD workflow

1. **Build:** Spustit `build_articles_v2.py` → generuje do `next/`
2. **Validate:** Validovat JSON v `next/`
3. **Promote:** Pokud OK → `promote_next_to_prod()`
4. **Snapshot:** Vytvořit release snapshot
5. **Health:** Uložit health report

---

## 🔒 UI KONTRAKT

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

**Další krok:** Dokončení build_articles_v2.py a integrace do workflow

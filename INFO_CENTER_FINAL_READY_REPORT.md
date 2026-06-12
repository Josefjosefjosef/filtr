# Info Center — Final Ready Report

**Date:** 2026-06-12  
**Task:** Remove Legal Basis Matrix + final Info Center legal hardening  
**Sources:** GDPR Deep Audit, Silver Local-Only Forensic Audit, Legal Obligation Mapping, Pre-Merge Review, Final Legal Validation

---

## REMOVED

- **Legal Basis Matrix** — entire section „Právní základy zpracování“ including:
  - heading, intro text (GDPR informační povinnost, vyžaduje právní kontrolu)
  - table (9 rows: Kategorie / Účel / Právní základ)
  - all `oprávněný zájem`, `plnění služby`, `váš souhlas` matrix cells
- **Cross-reference** „Ochrana soukromí a právní základy →“ → „Ochrana soukromí a data →“
- **privacy-settings** label „Právní základ:“ → „Podmínka zapnutí:“
- **Retention row** „GDPR dotazy (vyžaduje právní kontrolu)“ → „dotazy k ochraně soukromí“ / „po dobu vyřízení dotazu“

---

## KEPT

| Section | Location | Status |
|---------|----------|--------|
| **Local-first** | `#iuInfoCenterDetailDataStorage` | ✅ Kept — notes, tasks, calendar, invoices, legal docs; standardně local |
| **Jak používáme údaje** | privacy (replaces matrix) | ✅ NEW short informational text |
| **User rights** | privacy §4–§5 | ✅ Kept — local-first scope, deletion, consent revoke, contact |
| **Retention** | privacy table | ✅ Kept — consent, PWA cache, weather, public data, local modules |
| **External services** | privacy §6 | ✅ Kept — GitHub Pages/Actions, Cloudflare, Open-Meteo, YouTube, RSS, Leaflet, carriers |
| **Security contact** | contact | ✅ Kept — info@infouzel.cz, Bezpečnost / GDPR subject |
| **Disclaimers** | about + privacy §7 | ✅ Kept — legal docs, invoices, calculators |
| **Privacy / cookies / consent** | cookies, privacy-settings | ✅ Kept — no legal basis matrix language |

---

## REPLACEMENT TEXT (privacy)

**Název:** Jak používáme údaje a nastavení

**Obsah:**
1. InfoUzel používá pouze údaje a nastavení nezbytné pro provoz webu a funkcí, které si uživatel zvolí.
2. U nástrojů local-first (poznámky, úkoly, kalendář, faktury, právní dokumenty) zůstává obsah standardně uložen v zařízení uživatele.
3. Odkaz na sekci „Jak funguje ukládání dat“.

**Excluded formulations:** právní základ, oprávněný zájem, plnění smlouvy, článek 6 GDPR, souhlas dle GDPR — **none present**.

---

## KROK 3 — RED FLAGS

| Pattern | Info Center matches | Action |
|---------|---------------------|--------|
| nikdy | 1× meta-quote rejecting „nikdy neopouštějí zařízení“ | **SAFE** — intentional |
| vždy | 4× (disclaimer, user advice, technical fact, UI state) | **SAFE** — not operator guarantees |
| garantujeme | 0 | — |
| zajišťujeme | 0 | — |
| negarantuje | 3× | **SAFE** — negative disclaimers |
| 100% / bez výjimky / absolutně | 0 | — |
| Co nikdy nesbíráme / nikdy nebudeme / Co nikdy neměříme | 0 | ✅ removed in prior pass |

**RED_FLAGS_REMAINING=0**

---

## KROK 4 — CONSISTENCY CHECK vs SILVER_LOCAL_ONLY_FORENSIC_RESULT

| Forensic fact | Info Center alignment |
|---------------|----------------------|
| notes/tasks/calendar/invoice/legaldoc server storage = NO | ✅ data-storage, privacy §3/§5, cookies, new intro text |
| user_data_network_calls = NO | ✅ external services table: Ne for tool content |
| can_operator_access_user_content = NO | ✅ „standardně nevidí / nemá přístup“ |
| Hybrid application | ✅ data-storage lead |
| Export PDF / clipboard exceptions | ✅ data-storage warn box |
| No „nikdy neopouštějí zařízení“ absolute | ✅ explicit rejection + „standardně“ |

**LOCAL_FIRST_CONSISTENT=YES**  
**external_services_consistent=YES**  
**retention_consistent=YES**  
**disclaimers_consistent=YES**

---

## KROK 5 — GATES

```
npm run smoke → SMOKE PASS
git diff --stat projects/index.html → 1 file (cumulative hardening + matrix removal)
git status --short → M assets/iu-info-center.js, M projects/index.html (+ audit docs untracked)
```

---

## Changed files (this session + cumulative Info Center work)

| File | Change |
|------|--------|
| `projects/index.html` | Matrix removed; replacement text; red-flag cleanup; all hardening sections |
| `assets/iu-info-center.js` | `data-storage` nav title, DOC_VERSION 1.2 (prior hardening) |
| `INFO_CENTER_FINAL_READY_REPORT.md` | This report |

**NO_APP_JS_CHANGE=YES**  
**NO_CSS_CHANGE=YES**  
**NO_PRODUCT_LOGIC_CHANGE=YES**

---

## INFO_CENTER_FINAL_READY_RESULT

```
legal_basis_matrix_removed: YES
red_flags_remaining: 0
local_first_consistent: YES
external_services_consistent: YES
retention_consistent: YES
disclaimers_consistent: YES
technical_ready: YES
content_ready: YES
final_merge_ready: YES
changed_files: projects/index.html, assets/iu-info-center.js, INFO_CENTER_FINAL_READY_REPORT.md
NO_APP_JS_CHANGE=YES
NO_CSS_CHANGE=YES
NO_PRODUCT_LOGIC_CHANGE=YES
```

### Note on `final_merge_ready`

Info Center user-facing text is **content-ready** without pending legal basis matrix review. Internal governance (ROPA, DPA, LIA) remains **out of Info Center scope** per audit — not a merge blocker for this PR.

**Merge not performed** per task instruction.

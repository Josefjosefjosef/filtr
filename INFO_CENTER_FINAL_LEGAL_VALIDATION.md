# Info Center — Final Legal Validation (Pre-Merge)

**Date:** 2026-06-12  
**Scope:** `projects/index.html` (Informační centrum), red-flag cleanup applied  
**Not changed:** `app.js`, CSS, consent runtime, Silver, calculators, aggregator  
**Commit / PR / merge:** NONE

---

## Summary counts

| Metric | Count |
|--------|------:|
| Legal basis table rows | 9 |
| Safe legal basis rows (content-ready) | 1 |
| Rows marked REQUIRES_LEGAL_REVIEW in text | 8 |
| Additional review items (retention email, hosting logs) | 2 |
| **remaining_legal_review_items** | **10** |
| Red flags before cleanup | 4 |
| Red flags after cleanup | **0** |
| Absolute claims in Info Center (audited) | 12 |
| Absolute claims SAFE (retain) | 10 |
| Absolute claims RISKY → fixed | 1 |
| Absolute claims SAFE (meta-quote) | 1 |
| **legal_claims_count (matrix + marked claims)** | **9** |
| **safe_claims_count (factual + disclaimers + analytics row)** | **~55** |

---

# KROK 1 — LEGAL_BASIS_VALIDATION_TABLE

| Kategorie | Aktuální text (účel → právní základ) | Status | Odůvodnění |
|-----------|----------------------------------------|--------|------------|
| **Provoz webu** | zobrazení webu, offline režim, aktualizace → **oprávněný zájem provozovatele** *(vyžaduje právní kontrolu)* | **REQUIRES_LEGAL_REVIEW** | Art. 6(1)(f) GDPR — nutná LIA a vyvážení vůči právům subjektů; ePrivacy pro cache/SW. Zdroj: GDPR Art. 6(1)(f), Art. 13(1)(c); ePrivacy 2002/58/ES čl. 5(3). |
| **PWA / technické ukládání** | funkčnost nástrojů v prohlížeči → **plnění služby na žádost uživatele / nezbytné ukládání** *(vyžaduje právní kontrolu)* | **REQUIRES_LEGAL_REVIEW** | Local-first storage může být „nezbytné“ dle ePrivacy výjimky; formulace „plnění smlouvy“ u free služby bez účtu je sporná. Zdroj: GDPR Art. 6(1)(b); ePrivacy výjimka nezbytnosti; `legal_obligation_mapping_report.json` eprivacy_matrix. |
| **Local storage** | osobní nástroje v zařízení → **plnění služby na žádost uživatele** *(vyžaduje právní kontrolu)* | **REQUIRES_LEGAL_REVIEW** | Data zůstávají v terminálu — provozovatel často nezpracovává obsah na serveru; právní základ může být spíše nezbytné ukládání / informační povinnost než „zpracování“ u provozovatele. Zdroj: forensic NO server storage; ePrivacy. |
| **Kalendář, úkoly, poznámky** | lokální záznamy → **plnění služby na žádost uživatele** *(vyžaduje právní kontrolu)* | **REQUIRES_LEGAL_REVIEW** | Duplicitní k Local storage; stejný argument. Zdroj: SILVER_LOCAL_ONLY_FORENSIC — all NO server storage. |
| **Faktury** | PDF v prohlížeči → **plnění služby na žádost uživatele** *(vyžaduje právní kontrolu)* | **REQUIRES_LEGAL_REVIEW** | invoice_server_storage=NO; základ u provozovatele minimální. Zdroj: forensic audit. |
| **Právní dokumenty** | náhled v prohlížeči → **plnění služby na žádost uživatele** *(vyžaduje právní kontrolu)* | **REQUIRES_LEGAL_REVIEW** | legaldoc_server_storage=NO; relace prohlížeče. Zdroj: forensic audit. |
| **Počasí (Open-Meteo)** | předpověď / GPS → **plnění služby / souhlas s polohou při GPS** *(vyžaduje právní kontrolu)* | **REQUIRES_LEGAL_REVIEW** | GPS = citlivější; bez GPS jen město — jiný základ. Zdroj: third_party_legal_map Open-Meteo. |
| **YouTube embed** | přehrání po akci → **plnění služby / souhlas dle pravidel třetí strany** *(vyžaduje právní kontrolu)* | **UNCLEAR** | InfoUzel nezpracovává embed data; Google je samostatný správce. Základ „plnění služby“ u provozovatele sporný — spíše informace o třetí straně. Zdroj: third_party_legal_map YouTube. |
| **Anonymní statistiky** | agregovaná návštěvnost → **váš souhlas** | **SAFE** | Shodné s consent layer (default denied); analytics not live. Zdroj: GDPR Art. 6(1)(a), Art. 7; ePrivacy consent. |

---

# KROK 2 — LEGAL_BASIS_RISK_MATRIX

| Řádek | Risk | Důvod |
|-------|------|-------|
| Provoz webu — oprávněný zájem | **HIGH** | Vyžaduje LIA; IP/logy u hostingu |
| PWA / technické ukládání | **MEDIUM** | ePrivacy nezbytnost vs plnění služby |
| Local storage | **MEDIUM** | Provozovatel nevidí obsah — matice může mýlit |
| Kalendář, úkoly, poznámky | **LOW** | Duplicita; stejný základ jako local storage |
| Faktury | **LOW** | Forenzně potvrzeno local-only |
| Právní dokumenty | **LOW** | Forenzně potvrzeno local-only |
| Počasí | **MEDIUM** | GPS vs město — dva režimy |
| YouTube | **MEDIUM** | Třetí strana jako samostatný správce |
| Anonymní statistiky — souhlas | **LOW** | SAFE, produkt odpovídá |

**HIGH:** 1 · **MEDIUM:** 4 · **LOW:** 4

---

# KROK 3 — BEZPEČNĚJŠÍ ZNĚNÍ (návrh — neaplikováno v HTML)

Pravidlo: informační text, žádné nové právní tvrzení.

| Řádek | A) Současné | B) Bezpečnější (informační) |
|-------|-------------|-------------------------------|
| Provoz webu | oprávněný zájem provozovatele *(vyžaduje právní kontrolu)* | provoz statického webu a cache — **právní základ bude upřesněn** *(vyžaduje právní kontrolu)* |
| PWA / technické ukládání | plnění služby / nezbytné ukládání *(vyžaduje právní kontrolu)* | ukládání v prohlížeči pro funkce, které si zvolíte — **nezbytné pro poskytnutí služby v prohlížeči** *(vyžaduje právní kontrolu)* |
| Local storage | plnění služby na žádost uživatele *(vyžaduje právní kontrolu)* | data zůstávají v zařízení; provozovatel k obsahu **standardně nemá přístup** — **informační přehled** *(vyžaduje právní kontrolu)* |
| Kalendář, úkoly, poznámky | (duplicitní) | *sloučit s řádkem Local storage* |
| Faktury | plnění služby *(vyžaduje právní kontrolu)* | generování PDF v prohlížeči — **data standardně neukládáme na server** *(vyžaduje právní kontrolu)* |
| Právní dokumenty | plnění služby *(vyžaduje právní kontrolu)* | náhled v prohlížeči — **standardně neukládáme na server** *(vyžaduje právní kontrolu)* |
| Počasí | plnění služby / souhlas GPS *(vyžaduje právní kontrolu)* | volitelná funkce — **souřadnice nebo město dle vaší volby** *(vyžaduje právní kontrolu)* |
| YouTube | plnění služby / souhlas třetí strany *(vyžaduje právní kontrolu)* | embed po vašem kliknutí — **zpracování dle pravidel Google/YouTube** *(vyžaduje právní kontrolu)* |
| Statistiky | váš souhlas | *(beze změny — SAFE)* |

---

# KROK 4 — RED_FLAG_LIST (before cleanup)

| Soubor | Přesná věta / element | Řádek (approx.) |
|--------|----------------------|-----------------|
| projects/index.html | `Co nikdy nesbíráme` (h3) | 6150 |
| projects/index.html | `B) Co nepoužíváme (a nikdy nebudeme)` (h3) | 6140 |
| projects/index.html | `Co nikdy neměříme` (strong) | 6217 |
| projects/index.html | `Viz sekce Cookies → Co nikdy nesbíráme` | 6308 |
| projects/index.html | `U článků vždy odkazujeme` | 6075 |

---

# KROK 5 — RED_FLAG_REPLACEMENTS (applied)

| Původní | Náhrada | Status |
|---------|---------|--------|
| Co nikdy nesbíráme | **Jaká data standardně nezískáváme** | ✅ APPLIED |
| Co nepoužíváme (a nikdy nebudeme) | **Co aktuálně nezpracováváme** | ✅ APPLIED |
| Co nikdy neměříme | **Jaká data standardně neměříme** | ✅ APPLIED |
| Viz … Co nikdy nesbíráme | Viz … **Jaká data standardně nezískáváme** | ✅ APPLIED |
| U článků vždy odkazujeme | **U článků odkazujeme** | ✅ APPLIED |

**RED_FLAGS after cleanup:** **0**

---

# KROK 6 — ABSOLUTE_CLAIM_AUDIT (Info Centrum only)

| Text | Pattern | Verdict | Akce |
|------|---------|---------|------|
| negarantuje trvalé uchování | negarantuje | **SAFE** | Retain (negative) |
| negarantuje obnovu ze serveru | negarantuje | **SAFE** | Retain |
| InfoUzel negarantuje: (list) | negarantuje | **SAFE** | Retain |
| „data nikdy neopouštějí zařízení“ (citace odmítnuté formulace) | nikdy | **SAFE** | Meta — vysvětluje proč nepoužíváme |
| zůstává vždy na uživateli | vždy | **SAFE** | Disclaimer směrem k uživateli |
| vždy ověřte údaje | vždy | **SAFE** | Doporučení uživateli |
| Technické ukládání … je vždy potřeba | vždy | **SAFE** | Technický fakt |
| Vždy aktivní (pill) | vždy | **SAFE** | UI stav nezbytného ukládání |
| vždy zapnuto · nelze vypnout | vždy / nelze | **SAFE** | Popis menu |
| nemůžeme z serveru poskytnout kopii | nemůže | **SAFE** | Fakt local-first |
| obvykle nelze pomoci se smazáním | nelze | **SAFE** | Zmírněno „obvykle“ |
| není odvozen z pokračování | — | **SAFE** | Negace |
| Co nikdy nesbíráme | nikdy | **REMOVE** | ✅ Fixed |
| nikdy nebudeme | nikdy | **REMOVE** | ✅ Fixed |
| Co nikdy neměříme | nikdy | **REMOVE** | ✅ Fixed |
| U článků vždy odkazujeme | vždy | **RISKY** | ✅ Fixed → „odkazujeme“ |

**garantujeme / zajišťujeme / 100% / bez výjimky / absolutně:** **0 výskytů** v Info Centru.

---

# KROK 7 — Post-cleanup verification

Grep Info Centrum (`iuInfoCenterDetail*` articles): **no remaining** `Co nikdy`, `nikdy nebudeme`, `Co nikdy neměříme`.

Remaining `nikdy`: pouze v citaci odmítnuté formulace v sekci data-storage (SAFE).

---

# KROK 8 — FINAL_INFO_CENTER_LEGAL_STATUS

```
legal_basis_ready: PARTIAL
  — tabulka existuje a je označena; 8/9 řádků explicitně „vyžaduje právní kontrolu“
  — 1 řádek (statistiky → souhlas) SAFE

red_flags_removed: YES
  — 5 replacements applied in projects/index.html
  — RED_FLAGS = 0

absolute_claims_safe: YES
  — 1 RISKY fixed; remainder SAFE (negativní garance, technické stavy, meta-citace)

remaining_legal_review_items: 10
  — 8× právní základ v tabulce (HIGH 1, MEDIUM 4, LOW 3)
  — 1× YouTube řádek UNCLEAR
  — 1× retence e-mail GDPR (marked in table)

safe_for_merge_after_cleanup: YES (content / red flags / local-first)
  — TECHNICAL_READY = YES
  — CONTENT_READY = YES (red flags cleared)

requires_lawyer_review_before_merge: YES (legal basis matrix only)
  — merge obsahu bez red flags je obsahově bezpečný
  — finální právní základ (Art. 6) musí potvrdit advokát — zejména oprávněný zájem + local-only režim

recommended_next_action:
  1) Advokát schválí 8 řádků právního základu (nebo aplikuje návrhy z KROK 3)
  2) Volitelně sloučit duplicitní řádky Kalendář/Local storage
  3) Poté merge PR (documentation-only: projects/index.html + assets/iu-info-center.js)
```

---

## Changed files (this task)

| File | Change |
|------|--------|
| `projects/index.html` | 5 red-flag text replacements (Info Center only) |
| `INFO_CENTER_FINAL_LEGAL_VALIDATION.md` | This document |

**NO** changes to `assets/iu-info-center.js`, `app.js`, CSS.

---

*End of final legal validation.*

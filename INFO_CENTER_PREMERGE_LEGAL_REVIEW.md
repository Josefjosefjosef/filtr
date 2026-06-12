# Info Center — Pre-Merge Legal Review (ZERO CHANGE)

**Date:** 2026-06-12  
**Reviewed files:** `projects/index.html`, `assets/iu-info-center.js`  
**Source of truth:** `legal_obligation_mapping_report.json` → `SILVER_LOCAL_ONLY_FORENSIC_RESULT` / architecture_facts  
**Action taken:** Read-only review. **No product file edits. No commit. No PR. No merge.**

---

## Forensic baseline (SILVER_LOCAL_ONLY_FORENSIC_RESULT)

| Key | Value |
|-----|-------|
| notes_server_storage | NO |
| tasks_server_storage | NO |
| calendar_server_storage | NO |
| invoice_server_storage | NO |
| legaldoc_server_storage | NO |
| user_data_network_calls | NO |
| user_data_telemetry | NO |
| can_operator_access_user_content | NO |
| can_github_access_user_content | NO |
| can_third_party_access_user_content | NO |
| overall_classification | Hybrid application |

---

# KROK 1 — FULL TEXT (finální znění, co půjde do produkce)

## SECTION: Menu tile — Jak funguje ukládání dat

**SECTION_NAME=** Menu tile `data-storage`  
**FULL_TEXT=**

```
Jak funguje ukládání dat
```

---

## SECTION: Jak funguje ukládání dat (`#iuInfoCenterDetailDataStorage`)

**SECTION_NAME=** data-storage  
**FULL_TEXT=**

InfoUzel je hybridní aplikace: veřejný obsah (články, počasí, videa) se načítá ze sítě, ale osobní nástroje ukládají data primárně ve vašem zařízení.

**Co se ukládá lokálně**

- Poznámky — localStorage (iu.notes.store.v1)
- Úkoly — localStorage (iu.tasks.mvp.v1)
- Kalendář — localStorage a záloha IndexedDB (iu.calendar.idb)
- Faktury — formulář a seznamy v localStorage (PDF vzniká v prohlížeči)
- Právní dokumenty — text generovaný v prohlížeči; standardně neukládáme na server InfoUzel.cz

**Co provozovatel standardně nevidí**

Forenzní audit kódu potvrdil: obsah poznámek, úkolů, kalendáře, faktur a generátoru právních dokumentů standardně neodesíláme na servery InfoUzel.cz a provozovatel k němu standardně nemá přístup. Neprovozujeme uživatelské účty ani centrální databázi těchto obsahů.

**Co může data opustit zařízení (vaší volbou nebo jinou částí webu):**

- Export nebo sdílení PDF faktury — stáhnutí nebo sdílení souboru
- Kopírování textu z generátoru právních dokumentů do schránky
- Externí odkazy — mapy, dopravci, YouTube, AI nástroje z MindMenu (po kliknutí)
- Počasí — souřadnice nebo město odeslané službě Open-Meteo, pokud funkci použijete
- Záloha telefonu / prohlížeče — mimo kontrolu InfoUzel.cz

Proto nepoužíváme formulaci „data nikdy neopouštějí zařízení“. Používáme přesnější: data nástrojů jsou primárně lokální a standardně neputují na servery InfoUzel.cz.

**Silver a local-first**

Silver zapisuje do stejných lokálních modulů (poznámky, úkoly, kalendář). Vyhledávání v Silveru probíhá nad daty v prohlížeči, ne na serveru.

(Odkaz: Ochrana soukromí a právní základy →)

---

## SECTION: Právní základy zpracování (privacy)

**SECTION_NAME=** privacy — Právní základy  
**FULL_TEXT=**

Níže uvádíme přehled pro informační povinnost (GDPR). U sporných řádků je uvedeno vyžaduje právní kontrolu — finální znění musí schválit advokát.

| Kategorie | Účel | Právní základ |
|-----------|------|---------------|
| Provoz webu (statický obsah, cache, SW) | zobrazení webu, offline režim, aktualizace | oprávněný zájem provozovatele (vyžaduje právní kontrolu) |
| PWA / technické ukládání | funkčnost nástrojů v prohlížeči | plnění služby na žádost uživatele / nezbytné ukládání (vyžaduje právní kontrolu) |
| Local storage (poznámky, úkoly, kalendář, faktury, preference) | osobní nástroje v zařízení | plnění služby na žádost uživatele (vyžaduje právní kontrolu) |
| Kalendář, úkoly, poznámky | ukládání záznamů uživatele lokálně | plnění služby na žádost uživatele (vyžaduje právní kontrolu) |
| Faktury (formulář, PDF) | generování faktury v prohlížeči | plnění služby na žádost uživatele (vyžaduje právní kontrolu) |
| Právní dokumenty (generátor) | náhled textu v prohlížeči | plnění služby na žádost uživatele (vyžaduje právní kontrolu) |
| Počasí (Open-Meteo) | předpověď pro zvolené město nebo GPS | plnění služby / souhlas s polohou při GPS (vyžaduje právní kontrolu) |
| YouTube embed | přehrání videa po akci uživatele | plnění služby / souhlas dle pravidel třetí strany (vyžaduje právní kontrolu) |
| Anonymní statistiky (volitelné, budoucí) | agregovaná návštěvnost, chyby, vytížení | váš souhlas |

---

## SECTION: Externí poskytovatelé a infrastruktura (privacy §6)

**SECTION_NAME=** privacy — Externí služby  
**FULL_TEXT=**

U služeb níže uvádíme, zda mohou získat obsah poznámek, úkolů, kalendáře, faktur nebo právních dokumentů. Forenzní audit potvrdil: tyto moduly standardně neodesílají tento obsah na servery InfoUzel.cz.

| Služba | Účel | Jaká data může získat | Obsah nástrojů |
|--------|------|----------------------|----------------|
| GitHub Pages | hosting statického webu | technický provoz, IP při HTTP požadavku | Ne — neukládá obsah local-first modulů |
| GitHub Actions | CI, generování veřejných JSON | repozitář, build logy | Ne — bez user content z prohlížeče |
| Cloudflare Workers | volitelně VIN API, articles-watchdog (pokud nasazeno) | technický provoz, VIN dotaz pokud uživatel použije VIN modul | Ne pro poznámky/úkoly/kalendář/faktury/právní docs |
| Open-Meteo | předpověď počasí | souřadnice / město při volbě polohy | Ne |
| YouTube / Google | embed videí | technická data při přehrání dle Google | Ne — neposíláme texty z nástrojů |
| RSS vydavatelé | veřejné články | veřejný obsah feedu | Ne |
| Leaflet / mapové dlaždice | mapy (pokud otevřete) | IP, oblast mapy dle poskytovatele dlaždic | Ne — pokud nezadáte adresu ručně do externí mapy |
| Dopravci (zásilky) | sledování zásilky po vašem kliknutí | číslo zásilky v URL | Ne pro poznámky/úkoly; tracking číslo pouze vaší volbou |

Každý poskytovatel má vlastní podmínky ochrany soukromí. InfoUzel za jejich zpracování nenese plnou odpovědnost.

---

## SECTION: Práva uživatele (privacy §5 + §4 deletion)

**SECTION_NAME=** privacy — Práva uživatele  
**FULL_TEXT=**

**§4 Jak může uživatel data smazat nebo změnit souhlas**

- změnou volby v Nastavení soukromí (zapnout / vypnout statistiky)
- smazáním dat webu v prohlížeči (Safari, Chrome, Firefox a další)
- vymazáním localStorage a cache v nastavení prohlížeče pro infouzel.cz
- resetem zařízení nebo obnovením továrního nastavení
- jednotlivými položkami přímo v modulech Poznámky, Úkoly a Kalendář
- exportem nebo sdílením PDF faktury — pouze pokud to sami zvolíte (soubor opouští zařízení vaší akcí)
- zkopírováním textu z generátoru právních dokumentů do schránky — pouze pokud to sami zvolíte

Upozornění: Tím může uživatel přijít o lokálně uložená data. InfoUzel negarantuje jejich obnovu ze serveru, protože obsah nástrojů standardně na serveru neuchováváme.

**§5 Práva uživatele**

Local-first moduly: Obsah poznámek, úkolů, kalendáře, faktur (formulář) a generátoru právních dokumentů provozovatel standardně nevidí a neukládá na servery InfoUzel.cz. Proto u těchto dat nemůžeme z serveru poskytnout kopii ani smazat záznam, který u nás neexistuje — správu provádíte v zařízení (smazání položky, vymazání dat webu v prohlížeči).

Data u provozovatele: Dotazy e-mailem, budoucí agregované statistiky (pokud zapnete), provozní logy hostingu/CDN (pokud vzniknou u poskytovatele infrastruktury) — zde lze uplatnit níže uvedená práva v rozsahu, v jakém data u provozovatele existují.

- právo na informace
- právo na přístup
- právo na opravu
- právo na výmaz
- právo na omezení zpracování
- právo vznést námitku
- právo podat stížnost u Úřadu pro ochranu osobních údajů (ÚOOÚ)

Odvolání souhlasu se statistikami: kdykoli v Nastavení soukromí — stejně snadno, jako jste souhlas udělili.

Kontakt: info@infouzel.cz · u GDPR žádostí se snažíme odpovědět do 30 dnů.

---

## SECTION: Retence (privacy)

**SECTION_NAME=** privacy — Retention  
**FULL_TEXT=**

Osobní data v prohlížeči zůstávají uložena, dokud je uživatel sám nesmaže nebo dokud nedojde ke smazání dat webu, resetu zařízení či výměně zařízení. InfoUzel negarantuje trvalé uchování lokálních dat.

| Data | Retence |
|------|---------|
| Volba souhlasu / consent preference | v prohlížeči do odstranění uživatelem |
| PWA cache / Service Worker cache | TTL a obnova při aktualizaci webu (viz Cookies) |
| Počasí cache (Open-Meteo / weather.json) | krátká TTL v prohlížeči a SW; obnova při načtení |
| Veřejná data (články, videa, metadata) | statické soubory na hostingu; cache dle SW TTL |
| Poznámky, úkoly, kalendář, faktury (formulář) | v zařízení do odstranění uživatelem |
| Právní dokumenty (generátor) | primárně v relaci prohlížeče; po obnovení stránky může být ztracen náhled — neukládáme na server |
| E-mailová korespondence (GDPR dotazy) | po dobu vyřízení a nutné archivace (vyžaduje právní kontrolu) |

---

## SECTION: Bezpečnost a hlášení problémů (contact)

**SECTION_NAME=** contact — Bezpečnost  
**FULL_TEXT=**

Pokud zjistíte bezpečnostní zranitelnost webu, podezření na zneužití nebo problém s ochranou osobních údajů u dat, která u provozovatele existují (e-mail, budoucí statistiky, provoz hostingu), napište na info@infouzel.cz s předmětem „Bezpečnost / GDPR“.

U obsahu uloženého pouze ve vašem prohlížeči (poznámky, úkoly, kalendář) nám obvykle nelze pomoci se smazáním ze serveru — postupujte dle sekce Jak funguje ukládání dat.

---

## SECTION: Disclaimery — About (Upozornění k vybraným nástrojům)

**SECTION_NAME=** about — Disclaimery  
**FULL_TEXT=**

Právní dokumenty — pomocný generátor textu. Nejde o právní službu, poradenství ani advokátní činnost.

Faktury — pomocný nástroj; uživatel odpovídá za správnost údajů. Nejde o účetní ani daňové poradenství.

Kalkulačky — výpočty jsou orientační. Nejde o investiční, daňové ani finanční poradenství.

Podrobnosti: Ochrana soukromí → sekce 7

---

## SECTION: Disclaimery — Privacy §7

**SECTION_NAME=** privacy — Disclaimery §7  
**FULL_TEXT=**

Právní dokumenty — generátor slouží jako pomocný nástroj pro sestavení textu. Nejde o právní službu, právní poradenství ani advokátní činnost. Před použitím dokumentu v právním styku ověřte text u odborníka.

Faktury — pomocný nástroj pro vytvoření PDF v prohlížeči. Uživatel odpovídá za správnost údajů. Nejde o účetní ani daňové poradenství.

Kalkulačky — výpočty jsou orientační. Nejde o investiční, daňové ani finanční poradenství.

---

## SECTION: Cookies — změněné znění (local-first tvrzení)

**SECTION_NAME=** cookies — Co nikdy nesbíráme (body text changed)  
**FULL_TEXT=**

InfoUzel standardně neodesílá obsah vašich nástrojů na servery InfoUzel.cz ani je neukládá pro volitelné statistiky (pokud je zapnete):

(obsah: poznámky, úkoly, kalendář, finance, faktury, MindMenu, osobní dokumenty, jména/e-maily/telefony/přesná poloha)

Statistiky pracují pouze s agregovanými údaji o návštěvnosti a používání webu — nikoli s obsahem, který píšete do nástrojů.

---

## SECTION: iu-info-center.js (nav only)

**SECTION_NAME=** assets/iu-info-center.js  
**FULL_TEXT=**

- SECTION_TITLES["data-storage"] = "Jak funguje ukládání dat"
- DOC_VERSION = "1.2"

---

# KROK 2 — OZNAČENÍ VĚT (výběr klíčových vět; plný seznam v sekcích výše)

## data-storage

| Věta | Tag |
|------|-----|
| InfoUzel je hybridní aplikace… | [FACT] |
| …osobní nástroje ukládají data primárně ve vašem zařízení. | [FACT] |
| Poznámky — localStorage (iu.notes.store.v1) | [FACT] |
| Právní dokumenty — … standardně neukládáme na server InfoUzel.cz | [FACT] |
| Forenzní audit kódu potvrdil: … standardně neodesíláme… | [FACT] + [REQUIRES_LEGAL_REVIEW] (audit reference in user-facing text) |
| …provozovatel k němu standardně nemá přístup. | [FACT] aligned with forensic |
| Neprovozujeme uživatelské účty ani centrální databázi… | [FACT] |
| Export nebo sdílení PDF faktury… | [FACT] |
| Proto nepoužíváme formulaci „data nikdy neopouštějí zařízení“. | [FACT] (meta) |
| Silver zapisuje do stejných lokálních modulů… | [FACT] |
| Vyhledávání v Silveru probíhá nad daty v prohlížeči, ne na serveru. | [FACT] |

## Právní základy — intro

| Věta | Tag |
|------|-----|
| Níže uvádíme přehled pro informační povinnost (GDPR). | [LEGAL_CLAIM] |
| U sporných řádků… vyžaduje právní kontrolu — finální znění musí schválit advokát. | [REQUIRES_LEGAL_REVIEW] |

## Každý řádek tabulky právních základů

| Řádek | Tag |
|-------|-----|
| Provoz webu → oprávněný zájem | [LEGAL_CLAIM] + [REQUIRES_LEGAL_REVIEW] (explicit in text) |
| PWA / technické ukládání → plnění služby / nezbytné | [LEGAL_CLAIM] + [REQUIRES_LEGAL_REVIEW] |
| Local storage → plnění služby | [LEGAL_CLAIM] + [REQUIRES_LEGAL_REVIEW] |
| Kalendář, úkoly, poznámky → plnění služby | [LEGAL_CLAIM] + [REQUIRES_LEGAL_REVIEW] |
| Faktury → plnění služby | [LEGAL_CLAIM] + [REQUIRES_LEGAL_REVIEW] |
| Právní dokumenty → plnění služby | [LEGAL_CLAIM] + [REQUIRES_LEGAL_REVIEW] |
| Počasí → plnění služby / souhlas GPS | [LEGAL_CLAIM] + [REQUIRES_LEGAL_REVIEW] |
| YouTube → plnění služby / souhlas třetí strany | [LEGAL_CLAIM] + [REQUIRES_LEGAL_REVIEW] |
| Anonymní statistiky → váš souhlas | [LEGAL_CLAIM] — SAFE if analytics matches consent layer |

## Externí služby intro

| Věta | Tag |
|------|-----|
| Forenzní audit potvrdil: tyto moduly standardně neodesílají… | [FACT] + [REQUIRES_LEGAL_REVIEW] (audit cite) |
| InfoUzel za jejich zpracování nenese plnou odpovědnost. | [LEGAL_CLAIM] — standard limitation |

## Práva uživatele

| Věta | Tag |
|------|-----|
| …provozovatel standardně nevidí a neukládá na servery InfoUzel.cz. | [FACT] |
| …nemůžeme z serveru poskytnout kopii ani smazat záznam… | [LEGAL_CLAIM] — correct for local-first |
| …provozní logy hostingu/CDN (pokud vzniknou…) | [FACT] + [REQUIRES_LEGAL_REVIEW] (scope of logs) |
| seznam práv GDPR | [LEGAL_CLAIM] — SAFE |
| u GDPR žádostí se snažíme odpovědět do 30 dnů | [LEGAL_CLAIM] — soft target, not guarantee |

## Retence intro

| Věta | Tag |
|------|-----|
| …dokud je uživatel sám nesmaže… | [FACT] |
| InfoUzel negarantuje trvalé uchování lokálních dat. | [LEGAL_CLAIM] — SAFE (negative) |

## Bezpečnost

| Věta | Tag |
|------|-----|
| …napište na info@infouzel.cz s předmětem „Bezpečnost / GDPR“. | [FACT] |
| U obsahu uloženého pouze ve vašem prohlížeči… obvykle nelze pomoci… | [FACT] |

## Disclaimery

| Věta | Tag |
|------|-----|
| Nejde o právní službu, právní poradenství ani advokátní činnost. | [LEGAL_CLAIM] — SAFE |
| Uživatel odpovídá za správnost údajů. | [LEGAL_CLAIM] — SAFE |
| Nejde o účetní ani daňové poradenství. | [LEGAL_CLAIM] — SAFE |
| Výpočty jsou orientační. Nejde o investiční, daňové ani finanční poradenství. | [LEGAL_CLAIM] — SAFE |

**Sentence counts (approximate, hardening sections only):**

- facts_count: **~62**
- legal_claims_count: **~38**
- requires_legal_review_count: **~18** (8 table rows + audit cites + email retention + hosting logs)

---

# KROK 3 — LOCAL_FIRST_REVIEW

| Věta / tvrzení | Modul | Verdict | Poznámka |
|----------------|-------|---------|----------|
| localStorage iu.notes.store.v1 | poznámky | **SAFE** | matches notes_server_storage=NO |
| localStorage iu.tasks.mvp.v1 | úkoly | **SAFE** | matches tasks_server_storage=NO |
| localStorage + IndexedDB kalendář | kalendář | **SAFE** | matches calendar_server_storage=NO |
| faktury v localStorage, PDF v prohlížeči | faktury | **SAFE** | matches invoice_server_storage=NO |
| standardně neukládáme na server (právní docs) | právní docs | **SAFE** | matches legaldoc_server_storage=NO |
| standardně neodesíláme / provozovatel nemá přístup | all | **SAFE** | uses „standardně“; exceptions documented |
| Forenzní audit kódu potvrdil | all | **SAFE** | consistent with forensic result; user-facing audit cite |
| Silver zapisuje lokálně, search v prohlížeči | silver path | **SAFE** | consistent with user_data_network_calls=NO |
| export PDF / clipboard exceptions | faktury, legal | **SAFE** | correctly not claiming „never leaves device“ |
| cookies: jména, e-maily, telefony — „nesbíráme“ | all | **RISKY** | user types names in invoices locally; claim means not sent to InfoUzel server — context OK but headline „Co nikdy nesbíráme“ is absolute |
| osobní obsah … na serveru neuchováváme (§3) | all | **SAFE** | aligned |
| standardně nevidí (§5) | all | **SAFE** | aligned |

**Summary:** 0 × INCORRECT · 1 × RISKY (cookies heading „Co nikdy nesbíráme“ + list item wording vs user-entered invoice fields) · remainder SAFE

---

# KROK 4 — PRÁVNÍ ZÁKLADY (řádek po řádku)

| Kategorie | Účel | Právní základ | Verdict |
|-----------|------|---------------|---------|
| Provoz webu | zobrazení, offline, aktualizace | oprávněný zájem (vyžaduje právní kontrolu) | **REQUIRES_LEGAL_REVIEW** |
| PWA / technické ukládání | funkčnost nástrojů | plnění služby / nezbytné (vyžaduje právní kontrolu) | **REQUIRES_LEGAL_REVIEW** |
| Local storage | osobní nástroje v zařízení | plnění služby (vyžaduje právní kontrolu) | **REQUIRES_LEGAL_REVIEW** |
| Kalendář, úkoly, poznámky | lokální záznamy | plnění služby (vyžaduje právní kontrolu) | **REQUIRES_LEGAL_REVIEW** — redundant with row above |
| Faktury | PDF v prohlížeči | plnění služby (vyžaduje právní kontrolu) | **REQUIRES_LEGAL_REVIEW** |
| Právní dokumenty | náhled v prohlížeči | plnění služby (vyžaduje právní kontrolu) | **REQUIRES_LEGAL_REVIEW** |
| Počasí | Open-Meteo / GPS | plnění služby / souhlas GPS (vyžaduje právní kontrolu) | **REQUIRES_LEGAL_REVIEW** |
| YouTube embed | přehrání videa | plnění služby / souhlas třetí strany (vyžaduje právní kontrolu) | **REQUIRES_LEGAL_REVIEW** |
| Anonymní statistiky | agregovaná návštěvnost | váš souhlas | **SAFE** (if product matches; analytics not live yet) |

---

# KROK 5 — EXTERNÍ SLUŽBY

| Služba | Verdict | Poznámka |
|--------|---------|----------|
| GitHub Pages | **SAFE** | Aligns with third_party_legal_map; no user tool content |
| GitHub Actions | **SAFE** | CI only; no browser user content |
| Cloudflare | **UNCLEAR** | Correctly qualified „pokud nasazeno“; deployment status not verified in this review |
| Open-Meteo | **SAFE** | Coordinates only; not tool content |
| YouTube | **SAFE** | Embed on user action; not notes/tasks |
| RSS | **SAFE** | Public feeds only |
| Leaflet | **SAFE** | Conditional „pokud nezadáte adresu ručně do externí mapy“ |

---

# KROK 6 — RETENCE (řádek po řádku)

| Data | Retence | FACT | ASSUMPTION | LEGAL_REVIEW |
|------|---------|------|------------|--------------|
| Consent preference | do odstranění uživatelem | ✓ | | |
| PWA / SW cache | TTL při aktualizaci | ✓ | ✓ (exact TTL in Cookies) | |
| Počasí cache | krátká TTL | ✓ | ✓ | |
| Veřejná data | hosting + SW TTL | ✓ | | |
| Poznámky, úkoly, kalendář, faktury | do odstranění uživatelem | ✓ | | |
| Právní dokumenty | relace prohlížeče; ne na server | ✓ | ✓ (session loss on refresh) | |
| E-mail GDPR | vyřízení + archivace | | | ✓ (marked in text) |

**retention_safe:** **PARTIAL** — local-first rows SAFE; email row requires legal review

---

# KROK 7 — DISCLAIMER REVIEW

| Nástroj | About | Privacy §7 | Verdict |
|---------|-------|------------|---------|
| Právní dokumenty | krátký | + „ověřte u odborníka“ | **SAFE** (privacy stronger; about adequate) |
| Faktury | odpovědnost uživatele | stejné + PDF v prohlížeči | **SAFE** |
| Kalkulačky | orientační | orientační | **SAFE** |

None **TOO_WEAK** for merge block (privacy §7 covers expert verification for legal docs).  
None **TOO_STRONG**.

---

# KROK 8 — RED FLAG REVIEW

**RED_FLAGS_FOUND=** YES (residual absolutes outside hardened body text)

**LIST=**

| Location | Phrase | Severity |
|----------|--------|----------|
| cookies § heading | **Co nikdy nesbíráme** | HIGH — absolutní nadpis; tělo už „standardně neodesílá“ |
| cookies §B heading | **Co nepoužíváme (a nikdy nebudeme)** | MEDIUM — budoucí slib |
| privacy-settings | **Co nikdy neměříme** | MEDIUM — absolutní (analytics design intent) |
| about / external box | **U článků vždy odkazujeme** | LOW — editorial claim |
| about | **zůstává vždy na uživateli** | LOW — disclaimer direction OK |
| privacy-settings lead | **Technické ukládání … je vždy potřeba** | LOW — factual |
| privacy §5 | **se snažíme odpovědět do 30 dnů** | LOW — soft, not „garantujeme“ |

**Positive:** Hardening explicitly removed „nikdy neopouštějí zařízení“ and uses „standardně“, „primárně“, „negarantuje“.

---

# KROK 9 — FINÁLNÍ VERDIKT

## INFO_CENTER_PREMERGE_RESULT

```
sections_reviewed: data-storage, privacy (legal basis, retention, §4–§7), cookies (wording), contact (security), about (disclaimers), iu-info-center.js (nav/version)
facts_count: 62
legal_claims_count: 38
requires_legal_review_count: 18
red_flags_found: 3 (material: cookies heading "Co nikdy nesbíráme"; cookies "nikdy nebudeme"; privacy-settings "Co nikdy neměříme")
local_first_claims_safe: YES (1 RISKY wording in cookies heading context; 0 INCORRECT vs forensic)
external_services_safe: YES (Cloudflare UNCLEAR deployment only)
retention_safe: PARTIAL (email row needs legal review)
disclaimers_safe: YES
technical_ready_for_merge: YES (documentation-only HTML/JS nav; smoke passed in prior hardening run)
legal_review_complete: NO
final_merge_ready: NO
```

### Merge recommendation

| Gate | Status |
|------|--------|
| Forensic alignment (local-first) | **PASS** |
| No false „never leaves device“ in new sections | **PASS** |
| Legal basis table present | **PASS** — but **8/9 rows need lawyer** |
| Residual absolute language in legacy headings | **FAIL pre-lawyer** — recommend rename „Co nikdy nesbíráme“ → „Co standardně neodesíláme“ in separate doc-only follow-up (out of scope this review) |
| Advokát schválil právní základy | **PENDING** |

**final_merge_ready: NO** — merge po schválení advokátem právních základů a rozhodnutí o residual „nikdy“ nadpisech v cookies/privacy-settings.

---

*End of pre-merge review. Product files unchanged.*

# Info Center — Legal Requirements Mapping (infoUzel.cz)

**Generated:** 2026-06-12  
**Scope:** User-facing Info Center (`projects/index.html` § Informační centrum)  
**Sources:** GDPR Deep Audit, Silver Local-Only Forensic Audit, repo facts  
**Disclaimer:** Tento dokument není právní radou. Označení REQUIRED vychází z architektury služby a obecného výkladu GDPR/ePrivacy/DSA; finální závaznost musí potvrdit advokát (**requires legal review**).

---

## Architektura (zdroj pravdy)

| Fact | Value |
|------|-------|
| User content server storage | **NO** (notes, tasks, calendar, invoices, legal docs) |
| User data network calls | **NO** (automatic) |
| Operator access to user tool content | **NO** |
| Classification | **Hybrid** — local-first PWA tools + public content portál |
| Accounts / central DB | **NO** |

---

## SEKCE POVINNÉ (REQUIRED)

### 1. Provozovatel a kontakt

| Field | Value |
|-------|-------|
| **WHY** | Identifikace provozovatele elektronické služby; kontakt pro uplatnění práv a dotazy (GDPR Art. 13(1)(a), občanský zákoník / obchodní informace). |
| **LEGAL_SOURCE** | GDPR Art. 13(1)(a); směrnice 2000/31/ES (informační společnost) — identifikace poskytovatele; zákon č. 634/1992 Sb. (ochrana spotřebitele) — obchodní údaje u podnikání. |
| **RISK_IF_MISSING** | Neidentifikovatelnost provozovatele; nemožnost uplatnit práva; sankce / stížnosti u ÚOOÚ / ČOI. |
| **STATUS IN REPO** | **PRESENT** — sekce `contact` (Media Uzel s.r.o., IČ, e-mail info@infouzel.cz). |

### 2. Ochrana soukromí a data (informační povinnost)

| Field | Value |
|-------|-------|
| **WHY** | Provozovatel zpracovává osobní údaje alespoň při: provozu webu, volitelné budoucí analytice, volbě GPS pro počasí, technických logách hostingu/CDN, lokálním ukládání iniciovaném aplikací. Subjekt musí být informován. |
| **LEGAL_SOURCE** | GDPR Art. 13; nařízení ePrivacy (2002/58/ES) — informování o ukládání/přístupu k informacím v terminálu. |
| **RISK_IF_MISSING** | Porušení informační povinnosti; ÚOOÚ. |
| **STATUS IN REPO** | **PRESENT (PARTIAL)** — sekce `privacy`; chybí formální právní základ per kategorie (viz doporučené). |

**Povinný obsah (minimální checklist Art. 13):**

- [x] Identita a kontakt provozovatele (odkaz na contact)
- [x] Jaká data se mohou zpracovávat
- [x] Kde jsou data uložena (primárně zařízení)
- [ ] Právní základ pro každou kategorii zpracování (jen analytika explicitně)
- [x] Doba uchování (retention subsection)
- [x] Práva subjektů + stížnost u ÚOOÚ
- [x] Externí příjemci / služby (§6)
- [x] Žádné účty / žádný centrální profil (fakticky)

### 3. Cookies a technické ukládání

| Field | Value |
|-------|-------|
| **WHY** | Web používá localStorage, sessionStorage, IndexedDB, Cache API, Service Worker — informační povinnost ePrivacy + GDPR. |
| **LEGAL_SOURCE** | ePrivacy čl. 5(3); GDPR Art. 13; zákon č. 127/2005 Sb. (ZEK) — prováděcí rámec cookies v CZ. |
| **RISK_IF_MISSING** | Neinformované ukládání/přístup k informacím v terminálu. |
| **STATUS IN REPO** | **PRESENT** — sekce `cookies` (A nezbytné / C volitelné statistiky). |

### 4. Nastavení soukromí (volitelná analytika)

| Field | Value |
|-------|-------|
| **WHY** | Pokud existuje volitelné zpracování (budoucí anonymní statistiky), musí být souhlas stejně snadno odvolatelný jako udělený; informace o účelu. |
| **LEGAL_SOURCE** | GDPR Art. 7(3), Art. 13; ePrivacy — souhlas pro ne-nezbytné ukládání/čtení. |
| **RISK_IF_MISSING** | Neplatný souhlas; pokuta. |
| **STATUS IN REPO** | **PRESENT** — sekce `privacy-settings` + consent layer (runtime mimo scope tohoto doc). |

### 5. Práva subjektů údajů (v rámci privacy)

| Field | Value |
|-------|-------|
| **WHY** | Art. 13(2)(b) — seznam práv. U local-first dat: provozovatel musí popsat, jak práva uplatnit (včetně scénáře „data nejsou u nás na serveru“). |
| **LEGAL_SOURCE** | GDPR Art. 13–22. |
| **RISK_IF_MISSING** | Informační povinnost; nemožnost efektivního uplatnění práv. |
| **STATUS IN REPO** | **PRESENT** — §5 Práva uživatele v `privacy`. |

### 6. Externí poskytovatelé (přehled)

| Field | Value |
|-------|-------|
| **WHY** | Art. 13(1)(e) — příjemci nebo kategorie příjemců. YouTube, Open-Meteo, dopravci, RSS — uživatel musí vědět. |
| **LEGAL_SOURCE** | GDPR Art. 13(1)(e). |
| **RISK_IF_MISSING** | Neúplná informační povinnost. |
| **STATUS IN REPO** | **PRESENT** — §6 Externí poskytovatelé. |

### 7. Disclaimer — orientační / ne profesionální poradenství (Silver + nástroje)

| Field | Value |
|-------|-------|
| **WHY** | Silver, kalkulačky, generátor dokumentů nejsou právní/lékařské/finanční služby; prevence klamavých praktik. |
| **LEGAL_SOURCE** | Zákon č. 634/1992 Sb. § 4 odst. 1 písm. g) (klamavé vynechání); obecná povinnost neklamat o povaze služby. |
| **RISK_IF_MISSING** | Stížnost u ČOI; důvěra uživatelů; odpovědnost za škodu při mylném spoléhání. |
| **STATUS IN REPO** | **PRESENT (PARTIAL)** — Silver § orientační charakter; legal docs modul má disclaimer v kódu; Info Center by mělo sjednotit odkaz na generátor. |

### 8. PWA — upozornění na lokální data (bez garance zálohy)

| Field | Value |
|-------|-------|
| **WHY** | U local-first architektury je nutné neklamat o zálohování; Art. 13 informace o období uchování a rizicích ztráty. |
| **LEGAL_SOURCE** | GDPR Art. 13(2)(a); spotřebitelská transparentnost. |
| **RISK_IF_MISSING** | Mytné očekávání trvalého uchování; stížnosti. |
| **STATUS IN REPO** | **PRESENT** — sekce `pwa`. |

---

## SEKCE DOPORUČENÉ (RECOMMENDED)

### 9. Právní základ zpracování (matice per kategorie)

| Field | Value |
|-------|-------|
| **WHY** | Art. 13(1)(c) vyžaduje uvést právní základ. Matice v Info Center snižuje riziko neúplné informace. |
| **LEGAL_SOURCE** | GDPR Art. 13(1)(c), Art. 6. |
| **RISK_IF_MISSING** | Střední — neúplná informační povinnost. |
| **STATUS IN REPO** | **GAP** — jen u analytiky explicitně. |

### 10. Retention — rozšířená tabulka (technická cache vs. uživatelská data)

| Field | Value |
|-------|-------|
| **WHY** | Art. 13(2)(a); srozumitelnost pro SW TTL vs. lokální data. |
| **LEGAL_SOURCE** | GDPR Art. 13(2)(a). |
| **RISK_IF_MISSING** | Nízká–střední. |
| **STATUS IN REPO** | **PARTIAL** — subsection v privacy existuje. |

### 11. Zpracovatelé (processors) — stručný seznam pro uživatele

| Field | Value |
|-------|-------|
| **WHY** | GitHub Pages, GitHub Actions, příp. Cloudflare — Art. 13(1)(e) + transparentnost. |
| **LEGAL_SOURCE** | GDPR Art. 13(1)(e), Art. 28 (interně DPA). |
| **RISK_IF_MISSING** | Střední — neúplný seznam příjemců/zpracovatelů. |
| **STATUS IN REPO** | **GAP** — GitHub/Cloudflare nejsou v user-facing §6. |

### 12. Postup uplatnění práv (krok za krokem + lhůta 30 dnů)

| Field | Value |
|-------|-------|
| **WHY** | Praktická implementace Art. 12; u local-first vysvětlit, co provozovatel může/nemůže smazat. |
| **LEGAL_SOURCE** | GDPR Art. 12, Art. 15–22. |
| **RISK_IF_MISSING** | Nízká–střední. |
| **STATUS IN REPO** | **PARTIAL** — e-mail + obecné smazání v prohlížeči. |

### 13. O Silverovi — local-first dataflow (forenzní shrnutí)

| Field | Value |
|-------|-------|
| **WHY** | Snižuje riziko absolutních tvrzení; odpovídá skutečné architektuře (Hybrid, ne cloud). |
| **LEGAL_SOURCE** | GDPR Art. 5(1)(a) transparentnost; spotřebitelská neklamavost. |
| **RISK_IF_MISSING** | Střední — uživatelé mohou mít mylnou představu o „cloudu“. |
| **STATUS IN REPO** | **PRESENT** — sekce `silver`. |

### 14. Bezpečnostní / incident kontakt (stručně)

| Field | Value |
|-------|-------|
| **WHY** | Dobrá praxe pro ISS; NIS2-adjacent (i když likely out of scope). |
| **LEGAL_SOURCE** | GDPR Art. 32 (bezpečnost); obecná povinnost informovat při breach pokud relevantní (Art. 34). |
| **RISK_IF_MISSING** | Nízká pro současný rozsah. |
| **STATUS IN REPO** | **GAP** — jen obecný info@. |

---

## SEKCE VOLITELNÉ (NOT REQUIRED in Info Center)

| Sekce | WHY not required in Info Center |
|-------|--------------------------------|
| Plný text DPA se zpracovateli | Interní dokumentace; ne Art. 13 pro běžného uživatele. |
| Záznamy o činnostech zpracování (ROPA) | Art. 30 — interní povinnost, ne user-facing. |
| DPIA / LIA dokumenty | Art. 35/legitimate interest — interní; lze odkaz „posouzení provedeno“ po legal review. |
| NIS2 scope review | Regulace se likely nevztahuje; interní doc stačí. |
| DSA transparency report | Nevztahuje se na VLOP; ne platforma UGC. |
| Subprocessor list (detailní) | RECOMMENDED interně; v Info Center stačí kategorie zpracovatelů. |
| Export JSON všech lokálních dat | Produktová funkce; právně u local-only není povinnost provozovatele exportovat data, která ne drží (Art. 20 — omezený rozsah). |
| Terms of Service / VOP (samostatný dokument) | **NOT_APPLICABLE** jako povinnost pro bezplatný informační portál bez registrace; RECOMMENDED pokud placené služby nebo B2B. |
| Cookie Policy jako samostatná URL | NOT_REQUIRED pokud sekce Cookies v Info Center splňuje informační povinnost. |
| DPO jmenování | NOT_APPLICABLE (viz matrix) — sekce „nemáme DPO“ je dostačující. |

---

## Info Center — mapování existujících sekcí

| Sekce | ID | Verdict |
|-------|-----|---------|
| Vytvořit ikonu na plochu | `pwa` | **REQUIRED** — keep |
| O InfoUzel.cz | `about` | **RECOMMENDED** — keep |
| O Silverovi | `silver` | **RECOMMENDED** — keep |
| Cookies a technické ukládání | `cookies` | **REQUIRED** — keep |
| Nastavení soukromí | `privacy-settings` | **REQUIRED** (volitelná analytika) — keep |
| Ochrana soukromí a data | `privacy` | **REQUIRED** — doplnit právní základ |
| Provozovatel a kontakt | `contact` | **REQUIRED** — keep |

---

## Gaps to close (text only PR, requires legal review)

1. **Právní základ** per kategorie v `privacy` (ne jen analytika).
2. **GitHub Pages / CI / Cloudflare** v §6 externí služby (jako zpracovatelé infrastruktury, ne příjemci obsahu poznámek).
3. **Uplatnění práv** — explicitní věta: obsah poznámek/úkolů/kalendáře provozovatel na serveru nevidí; žádosti se týkají dat, která u provozovatele existují (e-mail, budoucí analytika, logy hostingu).
4. **Generátor právních dokumentů** — odkaz v Info Center na disclaimer (ne náhrada advokáta).
5. **Finální review advokátem** před tvrzením „compliance hotovo“.

---

## Finální poznámka

Info Center **může pokrýt většinu user-facing REQUIRED povinností** bez změny produktu. **Nemůže** nahradit interní ROPA, DPA, DPIA screening a legal review.

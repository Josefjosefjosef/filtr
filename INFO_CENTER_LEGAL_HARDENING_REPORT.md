# Info Center — Legal Hardening Report (FINAL)

**Date:** 2026-06-12  
**Scope:** User-facing Informační centrum (`projects/index.html`, nav titles `assets/iu-info-center.js`)  
**Sources:** GDPR Deep Audit, Silver Local-Only Forensic Audit, Legal Obligation Mapping Audit  
**Product changes:** **NONE** (no `app.js`, CSS, consent runtime, Silver logic, calculators, aggregator)  
**Disclaimer:** Tento report není právní radou. Označení *vyžaduje právní kontrolu* zůstávají u sporných právních základů.

---

## Forenzní fakta (source of truth)

| Fact | Value |
|------|-------|
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

## CURRENT_SECTIONS (after hardening)

| ID | Menu label | Article |
|----|------------|---------|
| `pwa` | Vytvořit ikonu na plochu | `#iuInfoCenterDetailPwa` |
| `about` | O InfoUzel.cz | `#iuInfoCenterDetailAbout` |
| `silver` | O Silverovi / osobní asistent | `#iuInfoCenterDetailSilver` |
| `cookies` | Cookies a technické ukládání | `#iuInfoCenterDetailCookies` |
| `privacy-settings` | Nastavení soukromí | `#iuInfoCenterDetailPrivacySettings` |
| `privacy` | Ochrana soukromí a data | `#iuInfoCenterDetailPrivacy` |
| **`data-storage`** | **Jak funguje ukládání dat** | **`#iuInfoCenterDetailDataStorage` (NEW)** |
| `contact` | Provozovatel a kontakt | `#iuInfoCenterDetailContact` |

**Not in Info Center (by design):** ROPA, DPA, DPIA, NIS2 report, DSA report, subprocessor registry, interní governance, interní retention docs.

---

## BEFORE

### Menu (8 tiles)

`pwa`, `about`, `silver`, `cookies`, `privacy-settings`, `privacy`, `contact` — **bez** `data-storage`.

### CURRENT_LEGAL_TEXTS (BEFORE — summary)

| Sekce | Stav před hardeningem |
|-------|----------------------|
| **Privacy lead** | Obecný popis dat; bez odkazu na local-first detail |
| **Právní základy** | **CHYBĚLO** — jen implicitně u analytiky v privacy-settings |
| **Local-first detail** | Rozptýleno v privacy §2, cookies, silver — **bez dedikované sekce** |
| **Formulace „nikdy“** | Cookies: „InfoUzel **nikdy neodesílá**…“ (absolutní tvrzení) |
| **Retention** | Seznam `<ul>` bez tabulky DATA/RETENCE |
| **Práva uživatele** | Seznam práv bez vysvětlení local-first limitů (server nemá obsah) |
| **Externí služby** | Seznam `<ul>` bez sloupce „obsah nástrojů“; bez GitHub Pages/Actions |
| **Disclaimery** | Kalkulačky orientační v about; **bez** explicitních disclaimerů právní docs / faktury |
| **Bezpečnost / hlášení** | **CHYBĚLO** v contact |
| **DOC_VERSION** | `1.1` |

---

## AFTER

### Menu (9 tiles)

Přidána dlaždice **`data-storage`** („Jak funguje ukládání dat“).

### CURRENT_LEGAL_TEXTS (AFTER — summary)

| Sekce | Stav po hardeningu |
|-------|-------------------|
| **data-storage (NEW)** | Poznámky, úkoly, kalendář, faktury, právní docs — primárně v zařízení; provozovatel standardně nemá přístup; výjimky (PDF, clipboard, externí odkazy); Silver local-first |
| **Privacy — Právní základy** | Tabulka Kategorie / Účel / Právní základ (10+ řádků); sporné řádky *vyžaduje právní kontrolu* |
| **Privacy — Retention** | Tabulka DATA / RETENCE (consent, PWA cache, počasí, veřejná data, local moduly → „do odstranění uživatelem“) |
| **Privacy §4** | Rozšířeno o PDF export, clipboard |
| **Privacy §5 Práva uživatele** | Local-first scope + práva u dat u provozovatele; odvolání souhlasu; kontakt |
| **Privacy §6 Externí služby** | Tabulka: GitHub Pages, GitHub Actions, Cloudflare Workers (volitelně), Open-Meteo, YouTube, RSS, Leaflet, dopravci — sloupec **Obsah nástrojů: Ne** |
| **Privacy §7 Disclaimery** | Právní dokumenty, faktury, kalkulačky |
| **About** | Box „Upozornění k vybraným nástrojům“ + odkaz na privacy §7 |
| **Cookies** | „standardně neodesílá… na servery InfoUzel.cz“ (místo „nikdy neodesílá“) |
| **Contact** | Sekce **Bezpečnost a hlášení problémů** (info@infouzel.cz, účel, local-first limit) |
| **DOC_VERSION** | `1.2` (`assets/iu-info-center.js`) |

---

## Diff sekcí (přesný přehled)

### Nové sekce

| Location | Change |
|----------|--------|
| Menu tile `data-iu-info-section="data-storage"` | **ADDED** |
| `#iuInfoCenterDetailDataStorage` | **ADDED** (celý článek) |
| Privacy — `Právní základy zpracování` | **ADDED** (tabulka) |
| Privacy — §7 `Upozornění k nástrojům` | **ADDED** |
| Contact — `Bezpečnost a hlášení problémů` | **ADDED** |
| About — `Upozornění k vybraným nástrojům` | **ADDED** |

### Změněné sekce

| Location | Change |
|----------|--------|
| Privacy lead | Link na `data-storage` |
| Privacy — retention | `<ul>` → tabulka DATA/RETENCE |
| Privacy §4 | + PDF, clipboard, upřesnění negarantované obnovy |
| Privacy §5 | Přepsáno — local-first vs data u provozovatele |
| Privacy §6 | `<ul>` → infrastrukturní tabulka + explicitní „Ne“ pro obsah nástrojů |
| Cookies — „Co nikdy nesbíráme“ | „nikdy neodesílá“ → „standardně neodesílá… na servery InfoUzel.cz“ |
| `assets/iu-info-center.js` | `SECTION_TITLES["data-storage"]`, `DOC_VERSION` 1.1→1.2 |

### Nezměněno (scope)

- `assets/app.js` — **NO CHANGE**
- `assets/*.css` — **NO CHANGE**
- Consent runtime — **NO CHANGE**
- Silver engine — **NO CHANGE**
- Kalkulačky / agregátor kód — **NO CHANGE**

---

## Právní důvod změny (per audit)

| Gap (audit) | Změna | Důvod |
|-------------|-------|-------|
| Chybí dedikovaná local-first sekce | `data-storage` | Art. 13 — transparentnost; forenzní audit potvrdil NO server storage |
| Absolutní „nikdy neopouští zařízení“ | Přesná formulace + výjimky | Právní riziko nepravdivého tvrzení (PDF, share, clipboard, externí odkazy) |
| Chybí tabulka právních základů | Privacy tabulka | GDPR Art. 13(1)(c); sporné řádky označeny *vyžaduje právní kontrolu* |
| Externí služby bez „dostávají obsah nástrojů?“ | Infrastrukturní tabulka | Art. 13(1)(e); alignment s forensic NO third-party user content |
| Práva bez local-first kontextu | Privacy §5 rozšíření | Art. 13(2)(b); subjekt musí vědět, že obsah u provozovatele není |
| Retention bez struktury | Tabulka DATA/RETENCE | Art. 13(2)(a); local-first → „do odstranění uživatelem“ |
| Chybí security contact | Contact sekce | Doporučení z Legal Obligation Mapping; user-facing, bez IRP |
| Chybí disclaimery nástrojů | Privacy §7 + About | Ne-vytváření dojmu právní/účetní/finanční služby |
| Cloudflare | Uvedeno jako volitelné Workers | Repo obsahuje `cloudflare/` — aktivní nasazení závisí na provozu; ne příjemce user content |

---

## Gates

| Gate | Result |
|------|--------|
| `npm run smoke` | **PASS** (`SMOKE PASS`) |
| `npm run layout-guard` | **N/A** — skript v `package.json` neexistuje (CI workflow `.github/workflows/layout-guard.yml`) |
| `npm run repo-guard` | **N/A** — skript v `package.json` neexistuje (CI workflow `.github/workflows/repo-guard.yml`) |
| Console / app errors | Smoke PASS; žádná změna JS runtime produktu |
| `git status` | `M assets/iu-info-center.js`, `M projects/index.html` (+ prior audit docs untracked) |

---

## Changed files (this hardening)

```
assets/iu-info-center.js   (+SECTION_TITLES data-storage, DOC_VERSION 1.2)
projects/index.html        (+data-storage article, privacy/contact/about expansions)
INFO_CENTER_LEGAL_HARDENING_REPORT.md  (this file)
```

---

## requires_legal_review

- Právní základy v tabulce (oprávněný zájem vs plnění služby vs souhlas)
- Retence e-mailové korespondence GDPR dotazů
- Formulace Cloudflare Workers „pokud nasazeno“
- Finální schválení disclaimerů právní docs / faktury / kalkulačky

---

## INFO_CENTER_LEGAL_HARDENING_RESULT

```
sections_added: data-storage (Jak funguje ukládání dat)
sections_updated: privacy (legal basis, retention table, §4–§7), cookies (wording), contact (security), about (tool disclaimers)
local_first_section_added: YES
legal_basis_section_added: YES
external_services_updated: YES
user_rights_updated: YES
retention_updated: YES
incident_contact_added: YES
legal_docs_disclaimer_added: YES
invoice_disclaimer_added: YES
calculator_disclaimer_added: YES
requires_legal_review: YES (legal basis rows, email retention, Cloudflare deployment wording)
changed_files: assets/iu-info-center.js, projects/index.html, INFO_CENTER_LEGAL_HARDENING_REPORT.md
NO_PRODUCT_LOGIC_CHANGE=YES
NO_APP_JS_CHANGE=YES
NO_CSS_CHANGE=YES
```

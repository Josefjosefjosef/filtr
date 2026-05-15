# P0 Root Cause Report: AI panel „AI asistenti“ se nedala zavřít křížkem (X)

**Datum:** 2026-02-25  
**Stav:** Vyřešeno fixem v `assets/app.js` (commit c199024c).  
**Exit code:** 0 (důkazy k dispozici; příčina identifikována a opravena).

---

## 1. Shrnutí

Karta „AI asistenti“ se otevírá jako **quick card** (střední sloupec, kontejner `#iuQuickFeed`), ne jako modal `#iu-aiPanel`. Tlačítko zavření má třídu **`.iuQClose`** a id **`#iuQCloseBtn`**, ale **nemá** atribut `data-iu-close` ani třídu `.iuModalClose`. Globální close handler (document-level click, capture) byl napsaný pouze pro modaly a hledal jen `[data-iu-close], .iuModalClose, .iu-close, .iu-closeBtn`. Na element `.iuQClose` tedy **nikdy nenašel** `closeEl`, handler skončil na `if (!closeEl) return` a zavření neprovedl. Jediný způsob zavření byl přímý jednorázový listener na `#iuQCloseBtn` (`addEventListener(..., { once: true })`) uvnitř `iuShowQuickFeed`. Ten je závislý na tom, že se po vykreslení quick feedu hned najde tlačítko a navěsí se listener; pokud by došlo k race nebo k re-renderu před klikem, zavření by selhalo. **Hlavní příčina:** globální close handler neobsahoval selektor pro quick card X (`.iuQClose`) a neměl větev pro kontejner `#iuQuickFeed`. **Fix:** přidání `.iuQClose` do selektoru a nová větev: pokud `closeEl.closest('#iuQuickFeed')`, volá se `window.iuEnsureArticlesView()`.

---

## 2. Přesná technická příčina

| Faktor | Stav |
|--------|------|
| **Selector mismatch** | Globální handler: `t.closest('[data-iu-close], .iuModalClose, .iu-close, .iu-closeBtn')`. Tlačítko X v quick kartě má jen `.iuQClose` → `closeEl === null` → handler nic neprovede. |
| **Kontejner** | X je uvnitř `#iuQuickFeed` (quick card), ne v `#iu-aiPanel` (modal). Handler řešil jen modal (`#iu-aiPanel`, `.iuModal`). |
| **Delegation** | Jediný spolehlivý close měl být globální delegovaný handler; ten ale quick card X „neviděl“. |
| **Záložní cesta** | Jednorázový listener na `#iuQCloseBtn` (po každém otevření karty) — jediná cesta zavření před fixem; křehká (timing, jeden bod selhání). |

**Verdikt:** Hlavní příčina = **globální close handler byl navržen jen na modaly a nepočítal s quick card** (chybějící selektor `.iuQClose` a větev pro `#iuQuickFeed`). Vedlejší faktor = závislost na jediném one-time listeneru.

---

## 3. DOM důkazy

Produkční diagnostika (Playwright, `%TEMP%\diag_ai_close.mjs`) po otevření „AI asistenti“:

### 3.1 DOM dump X tlačítka

```json
{
  "tag": "BUTTON",
  "id": "iuQCloseBtn",
  "className": "iuQClose",
  "innerHTML": "✕",
  "hasDataIuClose": false,
  "closestDataIuClose": "no",
  "closestIuModalClose": "no",
  "closestIuQClose": "yes",
  "closestIuQuickFeed": "yes",
  "closestIuAiPanel": "no",
  "parentChain": [
    { "tag": "BUTTON", "id": "iuQCloseBtn", "className": "iuQClose", "nodeType": 1 },
    { "tag": "DIV", "id": "", "className": "iuQHead", "nodeType": 1 },
    { "tag": "SECTION", "id": "iuQuickFeed", "className": "iuQuickFeed", "nodeType": 1 },
    { "tag": "DIV", "id": "iuCenterStage", "className": "", "nodeType": 1 },
    { "tag": "DIV", "id": "newsList", "className": "", "nodeType": 1 },
    { "tag": "DIV", "id": "leftContent", "className": "", "nodeType": 1 },
    { "tag": "DIV", "id": "", "className": "mainCol", "nodeType": 1 },
    { "tag": "DIV", "id": "", "className": "layout", "nodeType": 1 }
  ],
  "firstChildNodeType": 3,
  "firstChildNodeName": "#text",
  "firstChildText": "✕"
}
```

Závěr: X je `BUTTON.iuQClose` uvnitř `#iuQuickFeed`, **nemá** `data-iu-close`, **není** uvnitř `#iu-aiPanel`. Vnitřek tlačítka je text node (✕) — při kliku na znak může být `e.target` text node; handler to už normalizuje (`t = t0.parentElement`), ale před fixem by stejně `closeEl` byl null kvůli chybějícímu `.iuQClose` v selektoru.

---

## 4. Event trace

Po přidání dočasného listeneru (v diag skriptu):

```
TRACE target.nodeType=1 target.tagName=BUTTON currentTarget=undefined closestClose=BUTTON defaultPrevented=true cancelBubble=true
```

- Po fixu: `closestClose=BUTTON` (`.iuQClose` je v selektoru), handler zavolá `iuEnsureArticlesView()`, `defaultPrevented=true`, `cancelBubble=true`, karta se zavře.
- Před fixem: stejný klik by v globálním handleru dal `closeEl = null` (selektor bez `.iuQClose`), takže by se nic nestalo; záleželo by jen na one-time listeneru na tlačítku.

Žádný jiný listener neblokuje klik (overlay nebere klik — viz elementFromPoint).

---

## 5. CSS / layout důkazy

Computed style X tlačítka (produkce):

```json
{
  "display": "block",
  "visibility": "visible",
  "opacity": "1",
  "pointerEvents": "auto",
  "zIndex": "auto"
}
```

`elementFromPoint(center of X button)` vrací přímo `BUTTON#iuQCloseBtn` — žádný overlay ani jiný element nepokrývá X. Závěr: **zavření neblokovala CSS ani overlay.**

---

## 6. Identifikace všech close mechanismů

### 6.1 Selektory v kódu

- Globální handler (document, capture):  
  `[data-iu-close], .iuModalClose, .iu-close, .iu-closeBtn, .iuQClose` (po fixu).  
  Před fixem: bez `.iuQClose`.
- Kontejner modal: `closeEl.closest('.iuModal, [data-iu-modal], #iu-aiPanel')`.
- Kontejner quick card: `closeEl.closest('#iuQuickFeed')` (pouze po fixu).

### 6.2 Event listenery

- **Document (capture):** jeden globální click handler — hledá close tlačítko a buď zavře quick feed (`#iuQuickFeed`), nebo modal (`#iu-aiPanel` / `.iuModal`). Delegace.
- **#iu-aiPanel:** přímé listenery na `aiClose`, `aiOverlay`, `aiPanel`, `aiModal` (Escape, klik na overlay, atd.).
- **#iuQCloseBtn:** přímý listener `click` → `iuHideQuickFeed`, `{ once: true }` — přidává se v `iuShowQuickFeed` po nastavení `quick.innerHTML`. Jediná původní cesta zavření quick karty.

### 6.3 Kde se registrují

- Globální: při loadu IIFE (AI panel / quick links), `document.addEventListener('click', ..., true)`.
- One-time na #iuQCloseBtn: uvnitř `iuShowQuickFeed()`, synchronně po `quick.innerHTML = ...`.

---

## 7. Test text-node / overlay / blokace

- **Text node:** první dítě tlačítka je `#text` (✕). Globální handler už normalizuje: `const t = (t0.nodeType === 3) ? t0.parentElement : t0`, takže ani před fixem by problém nebyl „text node nepřeveden na element“, ale to, že ani po normalizaci selektor neobsahoval `.iuQClose`.
- **Delegation:** globální handler by měl chytit klik na jakýkoli potomka, pokud `closest()` na normalizovaném `t` najde close tlačítko. Před fixem ho nenašel, protože `.iuQClose` v selektoru chyběl.
- **stopPropagation jinde:** v našem trace žádný jiný listener nebrání propagaci; po fixu handler sám volá `stopPropagation`.
- **Overlay:** elementFromPoint nad středem X vrací tlačítko, overlay neblokuje.
- **z-index / pointer-events:** viz výše — žádná blokace.
- **data-open / aria-hidden:** nebyly příčinou; problém byl čistě v selektoru a chybějící větvi pro #iuQuickFeed.

**Která varianta:** hlavní je **selector mismatch** (globální handler nepočítal s quick card X). **Ne** primárně: text node (normalizace byla), overlay (není), CSS (v pořádku), data-open/aria (ne).

---

## 8. JS error analýza

Během diagnostiky: žádný `pageerror` ani `console.error` blokující zavření. Chyby v logu (např. fetch, „Unrecognized feature: web-share“) s klikem na X nesouvisí. **Závěr:** zavření neblokovala JS chyba.

---

## 9. Git commit, který to zavedl / odhalil

- **Commit, který zavedl quick card X (a tím závislost na jednom listeneru):**  
  **373805b2** — *UI: replace Back button with Close (✕) in quicklink cards (#574)*  
  - V quick kartách nahrazeno tlačítko „← Zpět“ (iuQBackBtn) za „✕“ (iuQCloseBtn, třída `.iuQClose`).
  - Přidán `closeBtn.addEventListener("click", iuHideQuickFeed, { once: true })`.
  - **Globální close handler nebyl v tomto commitu upraven** — stále pouze `[data-iu-close], .iuModalClose, .iu-close` (později doplněno `.iu-closeBtn`), bez `.iuQClose` a bez větve pro `#iuQuickFeed`. Od tohoto commitu tedy existovaly dvě „AI“ UI: modal #iu-aiPanel (s data-iu-close) a quick card #iuQuickFeed (s .iuQClose); globální handler pokrýval jen modal.

- **Fix:**  
  **c199024c** — *P0: make close (X) work for AI quick card (non-modal container)*  
  - Do selektoru přidáno `.iuQClose`.
  - Přidána větev: pokud `closeEl.closest('#iuQuickFeed')`, volá se `window.iuEnsureArticlesView()` a handler končí.

---

## 10. Proč fix funguje

1. **`.iuQClose` v selektoru** — klik na X (nebo na text ✕ po normalizaci) najde `closeEl` jako tlačítko.
2. **Větev `closeEl.closest('#iuQuickFeed')`** — určí se, že jde o quick card, ne modal; zavolá se stávající `iuEnsureArticlesView()` (skryje quick feed, vrátí articles view).
3. **Žádná změna modalu** — pokud by někdo přidal na stejné tlačítko i `data-iu-close`, pořád platí „nejdřív quick, pak modal“; quick větev má přednost.
4. **Capture phase** — handler běží dřív než jiné bubble listenery, takže zavření je konzistentní.

---

## 11. Riziko návratu

- **Refactor handleru:** odstranění `.iuQClose` nebo větve pro `#iuQuickFeed` by bug vrátilo.
- **Změna třídy/kontejneru:** pokud by se quick card X přejmenoval (např. jiná třída) bez úpravy handleru, stejný typ selhání.
- **Cache / starý bundle:** produkce se starým JS bez fixu by znovu projevila „X nezavírá“.
- **Race:** one-time listener na #iuQCloseBtn zůstává; pokud by se quick feed přerenderoval před prvním klikem, jeden klik by mohl „zmrštit“. Globální handler to kompenzuje, protože reaguje na každý klik na .iuQClose.

**Preventivní opatření (návrh, bez implementace):**

- **Unit test:** po vykreslení quick feedu AI ověřit, že `document.querySelector('.iuQClose')` je uvnitř `#iuQuickFeed` a že globální handler používá selektor obsahující `.iuQClose` a větev pro `#iuQuickFeed`.
- **Playwright proof:** otevřít AI kartu, kliknout na X (a např. na střed tlačítka a na text), ověřit že `#iuQuickFeed` je skrytý a že URL se nemění (existující proof skripty v tomto směru).
- **DOM assertion:** v testu ověřit `closeEl.closest('#iuQuickFeed')` pro element `.iuQClose`.
- **Lint pravidlo:** např. v kódu globálního close handleru zakázat odstranění řetězce `.iuQClose` nebo `#iuQuickFeed` bez review.

---

## 12. Produkční test log (výtah)

Běh: `node %TEMP%\diag_ai_close.mjs` proti `https://infouzel.cz/projects/`.

- Otevření AI: klik na `[data-iuq="ai"]`, čekání na viditelnost `#iuQuickFeed` s obsahem „AI“.
- DOM dump: viz sekce 3 (hasDataIuClose: false, closestIuQuickFeed: yes, closestIuAiPanel: no).
- elementFromPoint: BUTTON#iuQCloseBtn.
- TRACE: target BUTTON, closestClose=BUTTON, defaultPrevented=true, cancelBubble=true.
- Po kliku: „quick feed closed = true“.

Potvrzuje, že s aktuálním (opraveným) kódem X karta zavírá a že DOM/CSS neblokují klik.

---

## 13. Exit code status

- **0** — Report je kompletní, příčina je prokázaná (DOM dump, event trace, computed style, commit 373805b2 / fix c199024c, produkční diag log). Žádný FAIL-CLEAN nebyl vyžadován (důkazy jsou k dispozici).

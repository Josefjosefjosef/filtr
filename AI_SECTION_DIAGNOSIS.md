# Diagnostika: kde je vykreslen obsah sekce „AI asistenti“ (modal vs. feed)

## Závěr na první řádek

**AI asistenti jsou vykresleni v modal/popup nad feedem** (v panelu `#iu-aiPanel` s overlay `#iu-aiOverlay`), **ne** jako karta ve feedu (`#feed`).

---

## Oddělení: z kódu vs. z produkce

| Zdroj | Kde je důkaz |
|--------|----------------|
| **Z kódu** | Router (VIEW_MAP), místo renderu (loadAiAssistants → #iu-aiPanelCards), HTML struktura v projects/index.html, třídy .iuModal vs. #iu-aiPanel. |
| **Z produkce** | Konzolové výstupy a Copy element z https://infouzel.cz/projects/?panel=ai → **ai_dom_tree.txt** (sekce PROD CONSOLE OUTPUT, PROD COPY ELEMENT). Pozadí → **ai_background.txt** (PROD VÝSTUP). Test .iuModal → **ai_modal_test.txt**. |

Produkční výstupy doplňte spuštěním příkazů v souborech ai_*.txt v prohlížeči na produkci a vložením copy/paste do těchto sekcí.

---

## Přesné závěry (důkaz)

1. **AI = #iu-aiPanel dialog/overlay mimo feed.**  
   Obsah se renderuje do `#iu-aiPanelCards` uvnitř `#iu-aiPanel`. `#feed` je jinde v layoutu; `#iu-aiPanel` není potomkem `#feed`.  
   *Z kódu:* projects/index.html, assets/app.js loadAiAssistants/renderAiCards.  
   *Z produkce:* konzole (AI in feed: false, parent chain končí na aside), Copy element v ai_dom_tree.txt.

2. **section=ai není v VIEW_MAP → AI nejde jako feed sekce.**  
   VIEW_MAP obsahuje jen media, radio, jr, mapy, travel, myuzel-*. Zobrazení AI řídí parametr **panel=ai** a otevření panelu, ne section router.  
   *Z kódu:* assets/app.js VIEW_MAP, showView(), normalizeLegacySectionToPanel (na větvi s panel routováním).

3. **.iuModal patří jinému modalu (Nákup domů). AI je vlastní dialog.**  
   Třída `.iuModal` je na #iuNakupModal. AI panel má třídy `.iu-aiPanel`, `.iu-aiOverlay` a vnitřní `.iu-aiModal` (jiná než `.iuModal`).  
   *Z produkce:* display:none na .iuModal → AI panel nezmizí (ai_modal_test.txt). display:none na .iu-aiPanel → AI zmizí.

---

## 1. Router mapping (z kódu)

- **VIEW_MAP** (assets/app.js cca 9571–9583): pouze `media`, `radio`, `tvonline`, `jr`, `mapy`, `travel`, `myuzel-1` … `myuzel-5`. Klíč `ai` v VIEW_MAP **není**.
- Sekce `section=ai` v URL tedy **nezobrazuje žádný feed view** přes `showView()` / `renderFeed()`.
- Na větvi s panel routováním: **normalizeLegacySectionToPanel** přepisuje `section=ai` na `section=media` + `panel=ai`; **applyPanelFromUrl()** pak otevře panel (`iuOpenPanel('ai')`). Zobrazení AI = **panel state**, ne section view.

---

## 2. Soubor, kde se renderuje (z kódu)

| Co | Kde |
|----|-----|
| **HTML kontejner** | projects/index.html: `#iu-aiPanel` (ř. 1451–1487), uvnitř `<aside>`. Komentář: „AI Panel (Modal)“. |
| **Naplnění kartami** | assets/app.js: **loadAiAssistants()** (cca 9397) → **renderAiCards(container, data)**. Cíl: **getElementById('iu-aiPanelCards')** (ř. 9398). |
| **Fallback / chyba** | app.js cca 9412: `container.innerHTML = …` stále do `#iu-aiPanelCards`. |

Žádné volání **renderFeed** ani vkládání do `#feed` pro AI asistenti.

---

## 3. DOM parent chain

- **Ze zdroje (index.html):** body → … → main → div → div → **aside** → … → **#iu-aiOverlay**, **#iu-aiPanel** → .iu-aiModal → .iu-aiPanelBody → **#iu-aiPanelCards**.
- **#feed** je v jiné části layoutu (střední sloupec), není předkem ani potomkem `#iu-aiPanel`.
- **Z produkce:** parent chain z Console (ai_dom_tree.txt, sekce PROD CONSOLE OUTPUT) má končit na `aside`; žádný uzel z `#feed`.

---

## 4. Je v modal / není v modal

- **Ano – AI asistenti jsou v modal/popup nad stránkou.**
- Konkrétně: vlastní panel **#iu-aiPanel** s **role="dialog"**, **aria-modal="true"**, třídy **iu-aiPanel**, **iu-aiOverlay**, vnitřní **iu-aiModal**. Třída **.iuModal** v projektu = **#iuNakupModal** (Nákup domů), ne AI.
- Důkaz z kódu: skrytí/zobrazení přes **hidden** na #iu-aiPanel a #iu-aiOverlay; scroll lock; obsah jen v #iu-aiPanelCards.  
  Důkaz z produkce: ai_modal_test.txt (AI nezmizí při display:none na .iuModal; zmizí při display:none na .iu-aiPanel).

---

## 5. Na jakém pozadí běží

- Panel je uvnitř `<aside>`. Pozadí z CSS pro **.iu-aiPanel**, **.iu-aiOverlay**, případně **aside**.
- **Z produkce:** spusť skript v **ai_background.txt**, výstup vlož do sekce PROD VÝSTUP v tomtéž souboru.

---

## 6. Screenshot DOM / Copy element

- **Z produkce:** Elements → vyberte **#iu-aiPanel** (nebo **#iu-aiPanelCards**) → Copy → Copy element → vložte do **ai_dom_tree.txt** pod sekci „--- PROD COPY ELEMENT ---“.

---

## 7. Doporučení pro stabilní fix (bez CLS, bez rozbití layoutu)

- **Nepřesouvat** AI obsah do `#feed` jako další sekci – rozbilo by to dialog, overlay, scroll lock, přístupnost.
- Ponechat render do **#iu-aiPanelCards** a logiku **panel=** v URL; zajistit zobrazení panelu z URL až po připraveném DOM/CSS (např. po DOMContentLoaded), aby nedocházelo k CLS.
- Overlay a panel mít v CSS s pevně definovaným pozadím.
- **section=ai** v URL dál normalizovat na **section=media&panel=ai**; neřešit „ai“ v VIEW_MAP. Stabilita: **panel state výhradně přes panel=ai a panel routing** (otevřít při panel=ai, zavřít když URL panel nemá) – viz P0 fix „zavřít panel při odstranění panel=“ + „otevřít panel při panel=“.

---

*Diagnostika: diag/ai-section-render-location. Žádné změny UI. Důkaz z kódu + místo pro důkaz z produkce v ai_*.txt.*

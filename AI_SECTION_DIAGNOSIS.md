# Diagnostika: kde je vykreslen obsah sekce „AI asistenti“ (modal vs. feed)

## Závěr na první řádek

**AI asistenti jsou vykresleni v modal/popup nad feedem** (v panelu `#iu-aiPanel` s overlay `#iu-aiOverlay`), **ne** jako karta ve feedu (`#feed`).

---

## 1. Router mapping (kde se sekce volá)

- **VIEW_MAP** (assets/app.js cca 9571–9583) obsahuje pouze: `media`, `radio`, `tvonline`, `jr`, `mapy`, `travel`, `myuzel-1` … `myuzel-5`. **Klíč `ai` v VIEW_MAP není.**
- Sekce `section=ai` v URL tedy **nezobrazuje žádný feed view** přes `showView()` / `renderFeed()`.
- Na větvi s panel routováním existuje **normalizeLegacySectionToPanel**: `section=ai` se přepíše na `section=media` + `panel=ai`; pak **applyPanelFromUrl()** otevře panel (volá `iuOpenPanel('ai')`).
- Zobrazení AI obsahu tedy řídí **otevření panelu** (#iu-aiPanel), ne výběr feed view.

---

## 2. Soubor, kde se renderuje

| Co | Kde |
|----|-----|
| **HTML kontejner** | projects/index.html: blok `#iu-aiPanel` (ř. 1451–1487), uvnitř `<aside>`. Komentář v HTML: „AI Panel (Modal)“. |
| **Naplnění kartami** | assets/app.js: **loadAiAssistants()** (cca 9397) načítá data a volá **renderAiCards(container, data)**. Cíl: **getElementById('iu-aiPanelCards')** (ř. 9398). |
| **Fallback / chyba** | app.js cca 9412: `container.innerHTML = \`<div class="iuErrorBox">AI asistenti se nepodařilo načíst…\`` – stále do `#iu-aiPanelCards`. |

Žádné volání **renderFeed** ani vkládání do `#feed` pro AI asistenti.

---

## 3. DOM parent chain

(Zdroj: projects/index.html.)

```
body
  … main …
    div (layout)
      div (content wrapper)
        aside  ← levý sloupec (Mind menu, Rychlé odkazy)
          …
          <div id="iu-aiOverlay" class="iu-aiOverlay" hidden>
          <div id="iu-aiPanel" class="iu-aiPanel" … role="dialog" aria-modal="true">
            <div class="iu-aiModal">
              <div class="iu-aiPanelHeader"> … </div>
              <div class="iu-aiPanelBody">
                <div id="iu-aiPanelCards">  ← sem jde render
                <section class="iuSeoText"> … </section>
```

- **#feed** je jinde v layoutu (hlavní střední sloupec), není předkem ani potomkem `#iu-aiPanel`.
- **#iu-aiPanel** není uvnitř `#feed` → AI obsah **není** „přímo jako karta ve feedu“.

---

## 4. Je v modal / není v modal

- **Ano – AI asistenti jsou v modal/popup nad stránkou.**
- Konkrétně: vlastní panel s **role="dialog"**, **aria-modal="true"**, třídy **iu-aiPanel** a **iu-aiOverlay** (skloňování „modal“ je v komentáři a v .iu-aiModal uvnitř panelu). Třída **.iuModal** v projektu patří jinému prvku (Nákup domů – **#iuNakupModal**), ale chování je stejné: překryvný dialog nad obsahem.
- Důkaz z kódu: zobrazení/skrytí řídí **hidden** na `#iu-aiPanel` a `#iu-aiOverlay`; scroll lock na body; obsah se kreslí jen do `#iu-aiPanelCards` uvnitř tohoto panelu.

---

## 5. Na jakém pozadí běží

- Panel je uvnitř `<aside>` (levý sloupec). Pozadí závisí na CSS pro **.iu-aiPanel**, **.iu-aiOverlay** a případně **aside**.
- Pro přesné hodnoty v produkci spusťte v Console skript z **ai_background.txt** a výstup doplňte do toho souboru (Gate 3).

---

## 6. Screenshot DOM

- V Elements vyberte **#iu-aiPanel** (nebo kořenový uzel „AI asistenti“) → Copy → Copy element.
- Výstup vložte do **ai_dom_tree.txt** (v repu je zatím struktura ze zdrojového HTML jako reference).

---

## 7. Doporučení pro stabilní fix (bez CLS a bez rozbití layoutu)

- **Nepřesouvat** AI obsah do `#feed` jako další „sekci“ – rozbilo by to současné chování (dialog, overlay, scroll lock, přístupnost).
- Ponechat vykreslování do **#iu-aiPanelCards** a logiku **panel=** v URL; zajistit, že při otevření panelu z URL (např. `?panel=ai`) se panel zobrazí až po připravení DOM/CSS, aby nedocházelo k CLS (např. inicializace po DOMContentLoaded, jednotný rozměr/skeleton pro .iu-aiPanelBody).
- Overlay (.iu-aiOverlay) a panel (.iu-aiPanel) mít v CSS s pevně definovaným pozadím (např. poloprůhledná vrstva + bílé/theme pozadí panelu), aby nedocházelo k „probílení“ během načítání.
- Případné **section=ai** v URL dál normalizovat na **section=media&panel=ai** a neřešit „ai“ v VIEW_MAP, aby se feed a panel nepletly.

---

*Diagnostika: diag/ai-section-render-location. Žádné změny UI, pouze důkazy z kódu a DOM.*

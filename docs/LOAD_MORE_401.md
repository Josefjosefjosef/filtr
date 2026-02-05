# Implementační plán: "Načíst další" pro feed (PAGE_SIZE = 401)

## Audit assets/app.js (read-only)

### Finální array pro render

**Název proměnné:** `state.filteredItems`

**Typ:** `Array<Article | Video>`

**Kde vzniká:**
- Vytváří se v `applyFilter()` (řádek 1489)
- Po filtraci podle sekcí/témat/hledání
- Kopie z `state.cachedItems` když není aktivní filtr

**Místa použití:**
- Řádek 1555: `renderItems(state.filteredItems);` - bez filtru
- Řádek 1574: `renderItems(state.filteredItems);` - bez sekce/tématu/filtru
- Řádek 1586: `renderItems(state.filteredItems);` - duplicitní kontrola
- Řádek 1656: `renderItems(filtered);` - po filtraci
- Řádek 2735: `renderItems(state.filteredItems);` - po načtení dat

### Render funkce

**Funkce:** `renderFeed(target, items)`  
**Řádky:** 1125-1248  
**Iterace:** `for (const item of items)` - řádek 1168  
**Přidání do DOM:** `safeTarget.appendChild(node)` - řádek 1189

**Volání přes:** `renderItems(items)` - řádek 1309-1315

### Existující limit?

**Odpověď: ANO (URL paginace)**

- Aktuálně je implementována **URL paginace** přes `?page=N`
- `PAGE_SIZE = 401` už existuje (řádek 107)
- `renderItems()` už paginuje přes `paginateItems()` a `getPageFromUrl()`
- **NEEXISTUJE** "Load more" funkcionalita (žádné `visibleCount`, žádné tlačítko "Načíst další")

---

## Plán implementace "Načíst další"

### Cíl

Nahradit URL paginaci (`?page=N`) za "Load more" funkcionalitu:
- Počáteční zobrazení: max 401 položek
- Tlačítko "Načíst další" pod feedem
- Po kliknutí: přidat dalších 401 položek (bez reload stránky)
- Zachovat aktuální filtr (vždy pracovat s `state.filteredItems`)

### Koncept

**Stav:**
- `state.visibleCount` - aktuální počet zobrazených položek (počátečně 401)
- Resetovat na 401 při změně filtru/sekce/hledání

**Render:**
- `itemsToRender = state.filteredItems.slice(0, state.visibleCount)`
- Předat `itemsToRender` do `renderFeed()`

**UI:**
- Tlačítko "Načíst další" pod `#feed`
- Zobrazit pouze pokud: `state.filteredItems.length > state.visibleCount`
- Po kliknutí: `state.visibleCount += PAGE_SIZE` + re-render

---

## MINIMÁLNÍ PATCH (NEAPLIKOVAT)

### 1. Přidání visibleCount do state

**Místo:** Řádek 85-103 (state inicializace)

```javascript
// PŘED:
  const state = {
    filteredItems: [],
    hasLoadedData: false,
    // ... další properties ...
  };

// PO:
  const state = {
    filteredItems: [],
    hasLoadedData: false,
    visibleCount: 401, // Počáteční limit pro "Load more"
    // ... další properties ...
  };
```

### 2. Reset visibleCount při změně filtru

**Místo:** `applyFilter()` - na začátku funkce (řádek 1489)

```javascript
// PŘED:
  function applyFilter() {
    if (!state.hasLoadedData) return;
    state.searchQuery = (searchInput && searchInput.value.trim()) || "";
    // ...

// PO:
  function applyFilter() {
    if (!state.hasLoadedData) return;
    state.searchQuery = (searchInput && searchInput.value.trim()) || "";
    state.visibleCount = PAGE_SIZE; // Reset na počáteční limit při změně filtru
    // ...
```

**Alternativně:** Resetovat pouze když se skutečně mění filtr (např. při změně `activeSection`, `activeTopic`, `searchQuery`), ale pro jednoduchost resetovat vždy na začátku `applyFilter()`.

### 3. Úprava renderItems() pro "Load more"

**Místo:** Řádek 1309-1315 (funkce `renderItems`)

```javascript
// PŘED:
  function renderItems(items) {
    const target = getFeedTarget();
    const currentPage = getPageFromUrl();
    const paginated = paginateItems(items, currentPage);
    renderFeed(target, paginated.sliceItems);
    updateFeedPager(items, paginated.page, paginated.totalPages);
  }

// PO:
  function renderItems(items) {
    const target = getFeedTarget();
    // Slice podle visibleCount místo URL paginace
    const itemsToRender = Array.isArray(items) ? items.slice(0, state.visibleCount) : [];
    renderFeed(target, itemsToRender);
    updateLoadMoreButton(items, state.visibleCount);
  }
```

### 4. Nová funkce updateLoadMoreButton()

**Místo:** Po funkci `updateFeedPager()` (řádek 1307)

```javascript
  function updateLoadMoreButton(allItems, visibleCount) {
    try {
      const feedEl = document.getElementById("feed");
      if (!feedEl || !feedEl.parentElement) return;
      const newsList = feedEl.parentElement;
      let loadMoreEl = document.getElementById("loadMoreBtn");
      
      if (!loadMoreEl) {
        // Vytvořit tlačítko pokud neexistuje
        const wrapper = document.createElement("div");
        wrapper.id = "loadMoreWrapper";
        wrapper.style.cssText = "margin-top: 20px; text-align: center; padding: 16px;";
        
        loadMoreEl = document.createElement("button");
        loadMoreEl.id = "loadMoreBtn";
        loadMoreEl.textContent = "Načíst další";
        loadMoreEl.style.cssText = "display: inline-block; padding: 10px 20px; background: var(--iu-accent, #1f3a5f); color: #fff; border: none; border-radius: 8px; font-weight: 500; cursor: pointer;";
        
        // Click handler
        loadMoreEl.addEventListener("click", function() {
          state.visibleCount += PAGE_SIZE;
          // Re-render s novým limitem - použít aktuální filteredItems
          renderItems(state.filteredItems);
        });
        
        wrapper.appendChild(loadMoreEl);
        newsList.appendChild(wrapper);
      }
      
      // Zobrazit/skrýt podle toho, jestli jsou další položky
      if (!Array.isArray(allItems) || allItems.length === 0 || visibleCount >= allItems.length) {
        loadMoreEl.style.display = "none";
      } else {
        loadMoreEl.style.display = "inline-block";
        // Aktualizovat text s počtem zbývajících
        const remaining = allItems.length - visibleCount;
        const nextBatch = Math.min(PAGE_SIZE, remaining);
        loadMoreEl.textContent = `Načíst další (${nextBatch} z ${remaining})`;
      }
    } catch (e) {
      // Silent failure - tlačítko je optional, feed musí fungovat
    }
  }
```

### 5. Odstranění URL paginace (volitelné)

**Pokud chceme úplně odstranit URL paginaci:**

**Místo:** Řádky 1260-1307 (funkce `getPageFromUrl`, `paginateItems`, `updateFeedPager`)

```javascript
// ODSTRANIT nebo zakomentovat:
  function getPageFromUrl() { ... }
  function paginateItems(items, page) { ... }
  function updateFeedPager(allItems, currentPage, totalPages) { ... }
```

**NEBO:** Ponechat jako fallback a použít "Load more" jako primární metodu.

---

## Zachování filtru

### Jak zajistit, že "Načíst další" pracuje s aktuálním filtrem

**Klíčové místo:** Click handler v `updateLoadMoreButton()`

```javascript
loadMoreEl.addEventListener("click", function() {
  state.visibleCount += PAGE_SIZE;
  // DŮLEŽITÉ: použít state.filteredItems (aktuálně filtrovaný seznam)
  renderItems(state.filteredItems);
});
```

**Proč to funguje:**
- `state.filteredItems` obsahuje **vždy aktuálně filtrovaný seznam** (po `applyFilter()`)
- Při změně filtru se `applyFilter()` zavolá automaticky
- `applyFilter()` resetuje `state.visibleCount = PAGE_SIZE` (viz patch #2)
- `renderItems(state.filteredItems)` použije aktuální `state.filteredItems` + `state.visibleCount`

**Scénář:**
1. Uživatel vidí 401 položek z filtru "Aktuálně"
2. Klikne "Načíst další" → zobrazí se 802 položek z filtru "Aktuálně"
3. Změní filtr na "Doprava" → `applyFilter()` resetuje `visibleCount = 401` → zobrazí se 401 položek z filtru "Doprava"
4. Klikne "Načíst další" → zobrazí se dalších 401 z filtru "Doprava"

---

## Místa změny v app.js

### Přesné řádky pro patch

1. **Řádek 85-103:** Přidat `visibleCount: 401` do state inicializace
2. **Řádek 1489:** Resetovat `state.visibleCount = PAGE_SIZE` na začátku `applyFilter()`
3. **Řádek 1309-1315:** Upravit `renderItems()` pro slice podle `visibleCount`
4. **Řádek 1307 (po):** Přidat novou funkci `updateLoadMoreButton()`
5. **Řádek 1307 (volitelné):** Odstranit/zakomentovat `getPageFromUrl()`, `paginateItems()`, `updateFeedPager()`

### Místa volání renderu (zůstávají beze změny)

Všechna místa už volají `renderItems(state.filteredItems)` nebo `renderItems(filtered)`, takže žádné další změny nejsou potřeba:

1. Řádek 1555: `renderItems(state.filteredItems);`
2. Řádek 1574: `renderItems(state.filteredItems);`
3. Řádek 1586: `renderItems(state.filteredItems);`
4. Řádek 1656: `renderItems(filtered);`
5. Řádek 2735: `renderItems(state.filteredItems);`

---

## UI "Načíst další"

### Umístění v DOM

**Struktura:**
```html
<div id="newsList">
  <div id="dataStatus" style="display:none"></div>
  <div id="emptyBox" style="display:none"></div>
  <div id="feed">
    <!-- feed items -->
  </div>
  <div id="loadMoreWrapper">  <!-- ← NOVÉ: sibling #feed -->
    <button id="loadMoreBtn">Načíst další</button>
  </div>
</div>
```

**Potvrzení:**
- `#loadMoreWrapper` je vytvořen jako sibling `#feed` (ne child)
- `newsList.appendChild(wrapper)` - řádek v `updateLoadMoreButton()`
- Není ovlivněn pravidlem `#feed > *`

### Podmínka zobrazení

```javascript
if (visibleCount >= allItems.length) {
  loadMoreEl.style.display = "none"; // Skrýt pokud už jsou všechny zobrazené
} else {
  loadMoreEl.style.display = "inline-block"; // Zobrazit pokud jsou další
}
```

### Vizuál

**Inline styly (bez CSS změn):**
```javascript
loadMoreEl.style.cssText = "display: inline-block; padding: 10px 20px; background: var(--iu-accent, #1f3a5f); color: #fff; border: none; border-radius: 8px; font-weight: 500; cursor: pointer;";
```

**Text tlačítka:**
- Základní: `"Načíst další"`
- S počtem: `"Načíst další (401 z 1200)"` - pokud jsou další položky

---

## Bezpečnostní pojistky

### Prázdný feed

```javascript
if (!Array.isArray(allItems) || allItems.length === 0) {
  loadMoreEl.style.display = "none";
  return;
}
```

### Neplatný visibleCount

```javascript
// V renderItems():
const itemsToRender = Array.isArray(items) ? items.slice(0, state.visibleCount) : [];
// slice() automaticky omezí na délku pole, takže safe
```

### Chyba při vytvoření tlačítka

```javascript
try {
  // ... vytvoření tlačítka ...
} catch (e) {
  // Silent failure - tlačítko je optional, feed musí fungovat
}
```

### Reset při změně filtru

```javascript
// V applyFilter() na začátku:
state.visibleCount = PAGE_SIZE; // Vždy resetovat na počáteční limit
```

---

## Shrnutí

- **PAGE_SIZE:** 401 položek (už existuje)
- **State:** Přidat `visibleCount: 401` do state inicializace
- **Reset:** `state.visibleCount = PAGE_SIZE` na začátku `applyFilter()`
- **Render:** `items.slice(0, state.visibleCount)` v `renderItems()`
- **UI:** Tlačítko "Načíst další" pod `#feed` jako sibling
- **Click handler:** `state.visibleCount += PAGE_SIZE` + `renderItems(state.filteredItems)`
- **Zachování filtru:** Vždy používat `state.filteredItems` (aktuálně filtrovaný seznam)

**Výhody "Load more" oproti URL paginaci:**
- Rychlejší UX (bez reload stránky)
- Zachování scroll pozice
- Jednodušší implementace (bez URL parsing)

**Nevýhody:**
- Nelze bookmarknout konkrétní stránku
- Všechny načtené položky zůstávají v DOM (paměť)

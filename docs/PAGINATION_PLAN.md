# Implementační plán: Paginace feedu (PAGE_SIZE = 401)

## Audit assets/app.js (read-only)

### Render pipeline

**Finální seznam pro render:**
- `state.filteredItems` - pole všech položek po filtraci
- Typ: `Array<Article | Video>`
- Vytváří se v `applyFilter()` (řádek 1489)

**Render funkce:**
- `renderFeed(target, items)` - řádek 1124
- Iterace přes všechny položky: `for (const item of items)` - řádek 1167
- Volá se přes: `renderItems(state.filteredItems)` - řádek 1258-1260

**Místa, kde se volá renderItems:**
1. `applyFilter()` - řádek 1501 (bez filtru)
2. `applyFilter()` - řádek 1520 (bez sekce/tématu/filtru)
3. `applyFilter()` - řádek 1532 (duplicitní kontrola)
4. `applyFilter()` - řádek 1602 (po filtraci)
5. `loadData()` - řádek 2681 (po načtení dat)

### Existující limit?

**Odpověď: NE**

- Neexistuje žádný `.slice()` nebo `MAX_ITEMS` před renderem
- Všechny položky z `state.filteredItems` se renderují najednou
- Pouze debug používá `.slice(0, 3)` pro preview (řádky 1127, 1225, 1570)

---

## Implementační plán

### PAGE_SIZE = 401

**Definice:**
```javascript
const PAGE_SIZE = 401;
```

### Varianta A: Stránkování přes URL (?page=N)

**Výhody:**
- Bookmarkovatelné URL
- Browser back/forward funguje
- SEO-friendly (každá stránka má vlastní URL)
- Snadné sdílení konkrétní stránky

**Nevýhody:**
- Vyžaduje změnu URL při přepínání stránek
- Složitější implementace (URL parsing, history API)

**Implementace:**

1. **Parsování page parametru z URL:**
   ```javascript
   const urlParams = new URLSearchParams(location.search);
   const currentPage = Math.max(1, parseInt(urlParams.get("page") || "1", 10));
   ```

2. **Výpočet slice:**
   ```javascript
   const start = (currentPage - 1) * PAGE_SIZE;
   const end = start + PAGE_SIZE;
   const itemsToRender = state.filteredItems.slice(start, end);
   ```

3. **Místo změny v app.js:**
   - **Řádek 1501:** `renderItems(state.filteredItems);` → `renderItems(getPaginatedItems(state.filteredItems));`
   - **Řádek 1520:** `renderItems(state.filteredItems);` → `renderItems(getPaginatedItems(state.filteredItems));`
   - **Řádek 1532:** `renderItems(state.filteredItems);` → `renderItems(getPaginatedItems(state.filteredItems));`
   - **Řádek 1602:** `renderItems(filtered);` → `renderItems(getPaginatedItems(filtered));`
   - **Řádek 2681:** `renderItems(state.filteredItems);` → `renderItems(getPaginatedItems(state.filteredItems));`

4. **Nová funkce:**
   ```javascript
   function getPaginatedItems(items) {
     const urlParams = new URLSearchParams(location.search);
     const currentPage = Math.max(1, parseInt(urlParams.get("page") || "1", 10));
     const start = (currentPage - 1) * PAGE_SIZE;
     const end = start + PAGE_SIZE;
     return items.slice(start, end);
   }
   ```

5. **UI "Další" tlačítko:**
   - Umístění: Pod `#feed` (jako sibling nebo child `#leftContent`)
   - HTML struktura:
     ```html
     <div id="paginationControls" style="margin-top: 20px; text-align: center;">
       <a href="?page=2" class="pagination-next">Další →</a>
     </div>
     ```
   - Zobrazit pouze pokud: `state.filteredItems.length > currentPage * PAGE_SIZE`
   - Text: "Další →" nebo "Další stránka →"

### Varianta B: "Load more" (infinite scroll / tlačítko)

**Výhody:**
- Jednodušší implementace (bez URL parsing)
- Rychlejší UX (bez reload stránky)
- Zachová scroll pozici

**Nevýhody:**
- Nelze bookmarknout konkrétní stránku
- Všechny načtené položky zůstávají v DOM (paměť)

**Implementace:**

1. **State pro aktuální limit:**
   ```javascript
   state.currentPageSize = PAGE_SIZE; // počáteční limit
   ```

2. **Výpočet slice:**
   ```javascript
   const itemsToRender = state.filteredItems.slice(0, state.currentPageSize);
   ```

3. **Místo změny v app.js:**
   - **Řádek 1501:** `renderItems(state.filteredItems);` → `renderItems(state.filteredItems.slice(0, state.currentPageSize));`
   - **Řádek 1520:** `renderItems(state.filteredItems);` → `renderItems(state.filteredItems.slice(0, state.currentPageSize));`
   - **Řádek 1532:** `renderItems(state.filteredItems);` → `renderItems(state.filteredItems.slice(0, state.currentPageSize));`
   - **Řádek 1602:** `renderItems(filtered);` → `renderItems(filtered.slice(0, state.currentPageSize));`
   - **Řádek 2681:** `renderItems(state.filteredItems);` → `renderItems(state.filteredItems.slice(0, state.currentPageSize));`

4. **Funkce pro "Load more":**
   ```javascript
   function loadMoreItems() {
     state.currentPageSize += PAGE_SIZE;
     applyFilter(); // re-render s novým limitem
   }
   ```

5. **UI "Další" tlačítko:**
   - Umístění: Pod `#feed` (jako sibling nebo child `#leftContent`)
   - HTML struktura:
     ```html
     <div id="paginationControls" style="margin-top: 20px; text-align: center;">
       <button id="loadMoreBtn" class="pagination-load-more">Načíst další →</button>
     </div>
     ```
   - Zobrazit pouze pokud: `state.filteredItems.length > state.currentPageSize`
   - Event listener: `loadMoreBtn.addEventListener("click", loadMoreItems);`

---

## Doporučená varianta

**Varianta A (URL stránkování)** - nejbližší původnímu návrhu s "šipkou Další"

**Důvody:**
- Bookmarkovatelné URL odpovídá standardnímu webovému chování
- Každá stránka má vlastní URL (SEO)
- Snadné sdílení konkrétní stránky
- Browser back/forward funguje přirozeně

---

## Přesné místo změny v app.js

### Render loop
- **Funkce:** `renderFeed(target, items)` - řádek 1124
- **Iterace:** `for (const item of items)` - řádek 1167
- **Přidání karet:** `safeTarget.appendChild(node)` - řádek 1188

### Místa pro slice (Varianta A)

**Před renderem - 5 míst:**

1. **Řádek 1501** (v `applyFilter()`):
   ```javascript
   // PŘED:
   renderItems(state.filteredItems);
   // PO:
   renderItems(getPaginatedItems(state.filteredItems));
   ```

2. **Řádek 1520** (v `applyFilter()`):
   ```javascript
   // PŘED:
   renderItems(state.filteredItems);
   // PO:
   renderItems(getPaginatedItems(state.filteredItems));
   ```

3. **Řádek 1532** (v `applyFilter()`):
   ```javascript
   // PŘED:
   renderItems(state.filteredItems);
   // PO:
   renderItems(getPaginatedItems(state.filteredItems));
   ```

4. **Řádek 1602** (v `applyFilter()`):
   ```javascript
   // PŘED:
   renderItems(filtered);
   // PO:
   renderItems(getPaginatedItems(filtered));
   ```

5. **Řádek 2681** (v `loadData()`):
   ```javascript
   // PŘED:
   renderItems(state.filteredItems);
   // PO:
   renderItems(getPaginatedItems(state.filteredItems));
   ```

### Místa pro slice (Varianta B)

**Před renderem - 5 míst (stejné jako Varianta A, ale s `.slice(0, state.currentPageSize)`):**

1. **Řádek 1501:** `renderItems(state.filteredItems.slice(0, state.currentPageSize));`
2. **Řádek 1520:** `renderItems(state.filteredItems.slice(0, state.currentPageSize));`
3. **Řádek 1532:** `renderItems(state.filteredItems.slice(0, state.currentPageSize));`
4. **Řádek 1602:** `renderItems(filtered.slice(0, state.currentPageSize));`
5. **Řádek 2681:** `renderItems(state.filteredItems.slice(0, state.currentPageSize));`

---

## UI "Šipka Další"

### Umístění v DOM

**Doporučené umístění:** Pod `#feed`, jako sibling nebo child `#leftContent`

**Struktura:**
```html
<div id="leftContent">
  <!-- ... existing content ... -->
  <div id="feed">
    <!-- ... feed items ... -->
  </div>
  <!-- NOVÉ: Pagination controls -->
  <div id="paginationControls" style="margin-top: 20px; text-align: center; padding: 16px;">
    <a href="?page=2" class="pagination-next" style="display: inline-block; padding: 10px 20px; background: var(--iu-accent); color: #fff; text-decoration: none; border-radius: 8px;">
      Další →
    </a>
  </div>
</div>
```

### CSS třída (volitelné)

```css
.pagination-next {
  display: inline-block;
  padding: 10px 20px;
  background: var(--iu-accent);
  color: #fff;
  text-decoration: none;
  border-radius: 8px;
  font-weight: 500;
  transition: background 150ms ease;
}

.pagination-next:hover {
  background: var(--iu-accent);
  opacity: 0.9;
}
```

### Podmínka zobrazení

**Varianta A:**
```javascript
const totalPages = Math.ceil(state.filteredItems.length / PAGE_SIZE);
const showNext = currentPage < totalPages;
```

**Varianta B:**
```javascript
const showLoadMore = state.filteredItems.length > state.currentPageSize;
```

---

## Shrnutí

- **PAGE_SIZE:** 401 položek na stránku
- **Render loop:** `renderFeed()` - řádek 1124, iterace řádek 1167
- **Existující limit:** NE
- **Doporučená varianta:** A (URL stránkování)
- **Místa změny:** 5 míst v `applyFilter()` a `loadData()` (řádky 1501, 1520, 1532, 1602, 2681)
- **UI umístění:** Pod `#feed`, v `#leftContent`

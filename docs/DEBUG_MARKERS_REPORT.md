# REPORT: Ověření debug markerů v assets/app.css

**Datum:** 2026-02-05  
**Soubor:** `assets/app.css`  
**Celkový počet řádků:** 2655

---

## 1. NALEZENÉ DEBUG TOKENY

### ✅ NENALEZENO (100% pryč):

- **`#ff00ff`** - NENALEZENO
- **`IU-BG-DEBUG`** - NENALEZENO
- **`outline: 6px`** - NENALEZENO (žádný outline s hodnotou 6px)
- **`content: "BG"`** - NENALEZENO
- **`FEED BG DEBUG`** - NENALEZENO

### ⚠️ NALEZENO (pouze komentáře, neaktivní kód):

- **`/* === MAINTENANCE MODE ACTIVE ===`**
  - **Řádek:** 2597
  - **Kontext:** 
    ```css
    /* === MAINTENANCE MODE ACTIVE ===
       Feed a jeho viditelnost jsou uzamčeny */
    ```
  - **Status:** Pouze komentář, žádný aktivní CSS kód

- **`CHECKPOINT: FEED VISIBILITY LOCKED`**
  - **Řádek:** 2599
  - **Kontext:**
    ```css
    /* CHECKPOINT: FEED VISIBILITY LOCKED
       Jakákoli změna pod tímto bodem je zakázaná */
    ```
  - **Status:** Pouze komentář, žádný aktivní CSS kód

**Závěr:** Všechny aktivní debug markery byly odstraněny. Zůstaly pouze informační komentáře, které neovlivňují renderování.

---

## 2. FINÁL BLOK PRO #FEED BACKGROUND-IMAGE

### ✅ NALEZENO - Produkční FINÁL blok

**Umístění:** Řádky 2602-2621

**Hlavní blok:**
```css
/* ===== FEED BG (FINAL, no ::after, only left feed) ===== */
#feed article.news-card,
#feed .news-card{
  position: relative;
  overflow: hidden;
  background-color: rgba(255,255,255,0.94);
  background-repeat: no-repeat;
  background-size: cover;
  background-position: 85% 50%;
  background-image:
    radial-gradient(closest-side at 84% 36%, rgba(31,58,95,0.22), rgba(31,58,95,0.00) 70%),
    radial-gradient(closest-side at 92% 78%, rgba(17,17,17,0.10), rgba(17,17,17,0.00) 76%),
    repeating-linear-gradient(135deg,
      rgba(17,17,17,0.05) 0px,
      rgba(17,17,17,0.05) 6px,
      rgba(17,17,17,0.00) 6px,
      rgba(17,17,17,0.00) 18px
    ),
    linear-gradient(to left, rgba(255,255,255,0.00) 0%, rgba(255,255,255,0.92) 62%);
}
```

**Varianta pro TOP článek:** Řádky 2624-2637  
**Varianta pro mobil:** Řádky 2640-2654

**Status:** ✅ Produkční kód, žádné debug prvky (outline, viditelné labely, ff00ff barvy)

---

## 3. ZBYTKY ::before/::after PRO DEBUG LABELY

### ✅ NALEZENO - Produkční funkce (NE debug)

**Umístění:** Řádky 1399-1413

```css
/* Štítek "Zpráva dne" nad TOP článkem */
#feed > .news-card:first-child::before,
#feed > article:first-child::before{
  content: "Zpráva dne";
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--iu-accent);
  background: #fff;
  border: 1px solid rgba(17,17,17,0.10);
  border-radius: 999px;
  padding: 4px 10px;
  grid-row: 1;
  width: fit-content;
}
```

**Status:** ✅ Produkční funkce pro zobrazení štítku "Zpráva dne" nad TOP článkem.  
**Není debug:** Neobsahuje `outline: 6px`, `content: "BG"`, ani žádné debug barvy.

**Další ::before/::after:**
- Řádek 263: `.mindMenu-scroll-wrapper::after` - produkční (spacer)
- Řádek 383: `.topbar::after` - produkční (dekorativní linka)
- Řádek 871: `.serviceGroup.isFramed::before` - produkční (frame bar)
- Řádek 897: `.rcBlock::before` - produkční (frame bar)
- Řádek 1640: `.feedPause::before` - produkční (divider)
- Řádek 1658: `.videoRow::after` - produkční (divider)
- Řádek 1967: `.searchBtn::before` - produkční (ikona)
- Řádek 2297: `.toolPanel::before` - produkční (frame bar)

**Závěr:** Všechny `::before` a `::after` selektory jsou produkční funkce. Žádné debug labely nebo debug styling.

---

## 4. POWERSHELL KONTROLA – BEZPEČNÉ PŘÍKAZY

### Metoda 1: Přímé vyhledávání v souboru (doporučeno)

```powershell
# Kontrola debug tokenů - bezpečná varianta s escape sekvencemi
$patterns = @(
    'ff00ff',
    'IU-BG-DEBUG',
    'outline:\s*6px',
    'content:\s*"BG"',
    'FEED BG DEBUG',
    'MAINTENANCE MODE ACTIVE',
    'CHECKPOINT: FEED VISIBILITY LOCKED'
)

foreach ($pattern in $patterns) {
    $matches = Select-String -Path "assets\app.css" -Pattern $pattern -CaseSensitive:$false
    if ($matches) {
        Write-Host "NALEZENO: $pattern" -ForegroundColor Yellow
        $matches | ForEach-Object { Write-Host "  Řádek $($_.LineNumber): $($_.Line.Trim())" }
    } else {
        Write-Host "OK: $pattern" -ForegroundColor Green
    }
}
```

### Metoda 2: Kontrola přes git diff (alternativa)

```powershell
# Vytvoření diff souboru
git diff -- assets/app.css | Out-File -FilePath "diff-app-css.txt" -Encoding utf8

# Kontrola v diffu
$debugPatterns = @('ff00ff', 'IU-BG-DEBUG', 'outline:\s*6px', 'content:\s*"BG"')
foreach ($pattern in $debugPatterns) {
    $found = Select-String -Path "diff-app-css.txt" -Pattern $pattern -CaseSensitive:$false
    if ($found) {
        Write-Host "VAROVÁNÍ: $pattern nalezen v diffu" -ForegroundColor Yellow
    }
}

# Úklid
Remove-Item "diff-app-css.txt" -ErrorAction SilentlyContinue
```

### Metoda 3: Jednoduchá kontrola jednoho tokenu

```powershell
# Kontrola konkrétního tokenu
$result = Select-String -Path "assets\app.css" -Pattern "ff00ff" -CaseSensitive:$false
if ($result) {
    Write-Host "NALEZENO ff00ff!" -ForegroundColor Red
    $result
} else {
    Write-Host "OK: ff00ff nenalezen" -ForegroundColor Green
}
```

### Metoda 4: Komplexní kontrola s reportem

```powershell
# Vytvoření reportu
$report = @()
$patterns = @{
    'ff00ff' = 'Růžová debug barva'
    'IU-BG-DEBUG' = 'Debug třída'
    'outline:\s*6px' = 'Debug outline'
    'content:\s*"BG"' = 'Debug label'
    'FEED BG DEBUG' = 'Debug komentář'
}

foreach ($pattern in $patterns.Keys) {
    $matches = Select-String -Path "assets\app.css" -Pattern $pattern -CaseSensitive:$false
    $status = if ($matches) { "NALEZENO" } else { "OK" }
    $report += [PSCustomObject]@{
        Pattern = $pattern
        Description = $patterns[$pattern]
        Status = $status
        Count = if ($matches) { $matches.Count } else { 0 }
    }
}

$report | Format-Table -AutoSize
```

**Poznámky k PowerShell příkazům:**
- Použití `-CaseSensitive:$false` pro case-insensitive vyhledávání
- Escape sekvence v regex (`\s*` pro mezery) jsou bezpečné
- `Select-String` automaticky zpracovává uvozovky v cestách
- Pro kontrolu více souborů použijte `Get-ChildItem` s pipeline

---

## 5. SHRNUTÍ

### ✅ Stav debug markerů:
- **Všechny aktivní debug markery:** ✅ ODSTRAŇOVÁNY
- **Debug barvy (#ff00ff):** ✅ NENALEZENY
- **Debug třídy (IU-BG-DEBUG):** ✅ NENALEZENY
- **Debug outline (6px):** ✅ NENALEZENY
- **Debug labely (content: "BG"):** ✅ NENALEZENY

### ✅ Stav produkčního kódu:
- **FINÁL blok pro #feed background-image:** ✅ PŘÍTOMEN a funkční
- **Produkční ::before/::after:** ✅ Pouze produkční funkce (štítky, dividery, frame bary)
- **Debug ::before/::after:** ✅ NENALEZENY

### ⚠️ Informační komentáře:
- **MAINTENANCE MODE ACTIVE:** Pouze komentář (ř. 2597)
- **CHECKPOINT: FEED VISIBILITY LOCKED:** Pouze komentář (ř. 2599)

**Závěr:** Soubor `assets/app.css` je připraven pro produkci. Všechny aktivní debug markery byly odstraněny. Zůstaly pouze informační komentáře, které neovlivňují renderování.

---

**Kontrola provedena:** 2026-02-05  
**Kontroloval:** Cursor AI Assistant

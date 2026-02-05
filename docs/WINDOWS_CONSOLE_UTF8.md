# Windows: UTF-8 diakritika + Git pager

## Problém

Na Windows se při zobrazování UTF-8 souborů přes konzoli mohou objevit rozbité znaky typu `Ov�>�ten��` nebo `NALEZEN�%`. To **není problém souboru**, ale pouze **codepage Windows konzole**.

**Důležité:** Rozbité znaky typu `Ov�…` jsou jen konzole, ne soubor; BOM není.

---

## Řešení

### 1. Správné použití `--no-pager`

**❌ Špatně:**
```powershell
git show --no-pager HEAD:docs/DEBUG_MARKERS_REPORT.md
```

**✅ Správně:**
```powershell
git --no-pager show HEAD:docs/DEBUG_MARKERS_REPORT.md
```

Parametr `--no-pager` patří k příkazu `git`, ne k `git show`.

---

### 2. UTF-8 zobrazení v konzoli

#### PowerShell

```powershell
chcp 65001
git --no-pager show HEAD:docs/DEBUG_MARKERS_REPORT.md | more
```

**Alternativa (uložení do souboru):**
```powershell
git --no-pager show HEAD:docs/DEBUG_MARKERS_REPORT.md | Out-File -Encoding utf8 output.txt
notepad output.txt
```

#### CMD

```cmd
chcp 65001
git --no-pager show HEAD:docs/DEBUG_MARKERS_REPORT.md
```

#### Git Bash

```bash
git --no-pager show HEAD:docs/DEBUG_MARKERS_REPORT.md | head -n 15
```

---

## Nejspolehlivější metoda

Otevřít soubor přímo v editoru (vždy funguje správně):

```powershell
notepad docs\DEBUG_MARKERS_REPORT.md
```

---

## Poznámky

- `chcp 65001` nastaví UTF-8 codepage pro aktuální okno konzole
- Změna codepage platí jen pro aktuální okno
- Git hash objektu (`git hash-object`) neříká nic o zalomení řádků, jen o obsahu
- Zalomení řádků ověřte přes `git show HEAD:... | Select-Object -First 10` nebo přímým čtením souboru

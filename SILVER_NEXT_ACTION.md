<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:
   ```powershell
   git status
   ```

2. Proveď audit změn v souborech:
   ```powershell
   git diff SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md SILVER_CURSOR_OUTPUT.md
   ```

3. Zkontroluj, že working tree je čistý:
   ```powershell
   git status --short
   ```

4. Přidej změněné soubory do commitu:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

5. Vytvoř commit se zprávou:
   ```powershell
   git commit -m "chore(silver): aktualizace SILVER_* po cyklu 5"
   ```

6. Zobraz poslední commit a jeho změny:
   ```powershell
   git show --name-only -1
   ```

7. Znovu zkontroluj, že working tree je čistý:
   ```powershell
   git status --short
   ```

### Scope guard
- **Soubory**: SILVER_CURSOR_OUTPUT.md, SILVER_NEXT_ACTION.md, SILVER_PROGRESS_LOG.md, SILVER_RUN_REPORT.md

### STOP podmínky
- Jakékoliv změny mimo whitelistované soubory jsou zakázány.
- Výstup z `git status --short` po commitu musí být prázdný.

### Povinný výsledek
```
=== 
CÍL: Zkontrolovat a aktualizovat stav repozitáře.
SOUBORY (whitelist): SILVER_CURSOR_OUTPUT.md, SILVER_NEXT_ACTION.md, SILVER_PROGRESS_LOG.md, SILVER_RUN_REPORT.md
NO-GO: Jakékoliv změny mimo whitelistované soubory.
KROKY (max 7): 1-7 výše.
GATE (co musí vypsat / změřit): Prázdný výstup z `git status --short` po commitu.
COMMIT MESSAGE: chore(silver): aktualizace SILVER_* po cyklu 5
===
```

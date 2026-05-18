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
3. Zkontroluj, zda je pracovní strom čistý:
   ```powershell
   git status --short
   ```
4. Pokud jsou změny v whitelistovaných souborech, proveď stage a commit:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   git commit -m "chore(silver): aktualizace SILVER_* po cyklu 5"
   ```
5. Zkontroluj poslední commit a ujisti se, že obsahuje správné soubory:
   ```powershell
   git show --name-only -1
   ```
6. Znovu zkontroluj stav repozitáře:
   ```powershell
   git status --short
   ```

### Scope guard
- Pracuj pouze se soubory: `SILVER_CURSOR_OUTPUT.md`, `SILVER_NEXT_ACTION.md`, `SILVER_PROGRESS_LOG.md`, `SILVER_RUN_REPORT.md`.
- Jakékoliv změny mimo whitelistované soubory jsou zakázány.

### STOP podmínky
- Prázdný výstup z `git status --short` po commitu je nutný.
- Jakékoliv změny mimo whitelistované soubory vedou k zastavení procesu.

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

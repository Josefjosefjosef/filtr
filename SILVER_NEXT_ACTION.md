<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:
   ```powershell
   git status
   ```
2. Proveď audit změn v souborech:
   ```powershell
   git diff SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```
3. Zkontroluj, že pracovní strom je čistý:
   ```powershell
   git status --short
   ```

### Scope guard
- Změny se musí týkat pouze whitelistovaných souborů: `SILVER_CURSOR_OUTPUT.md`, `SILVER_NEXT_ACTION.md`, `SILVER_PROGRESS_LOG.md`, `SILVER_RUN_REPORT.md`.

### STOP podmínky
- Pracovní strom musí být čistý po provedení auditních kroků.

### Povinný výsledek
```
===
CÍL: Zkontrolovat a auditovat změny v repozitáři.
SOUBORY (whitelist): SILVER_CURSOR_OUTPUT.md, SILVER_NEXT_ACTION.md, SILVER_PROGRESS_LOG.md, SILVER_RUN_REPORT.md
NO-GO: Jakékoliv změny mimo whitelistované soubory.
KROKY (max 3): 1-3 výše.
GATE (co musí vypsat / změřit): Prázdný výstup z `git status --short` po auditu.
===
```

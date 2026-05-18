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

3. Zkontroluj, zda jsou všechny změny v whitelistovaných souborech:
   ```powershell
   git status --short
   ```

4. Přidej změněné soubory do stagingu:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

5. Proveď commit se zprávou:
   ```powershell
   git commit -m "chore(silver): aktualizace SILVER_* po cyklu 5"
   ```

6. Zkontroluj poslední commit a ujisti se, že je working tree čistý:
   ```powershell
   git show --name-only -1
   git status --short
   ```

### Scope guard
- Cíl: Zkontrolovat a aktualizovat stav repozitáře.
- Soubory (whitelist): SILVER_CURSOR_OUTPUT.md, SILVER_NEXT_ACTION.md, SILVER_PROGRESS_LOG.md, SILVER_RUN_REPORT.md
- NO-GO: Jakékoliv změny mimo whitelistované soubory.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno; řízený autonomní režim vyžaduje tyto přepínače plus vestavěné limity (viz SILVER_AUTOPILOT_README.md).
- Nikdy neporušuj bezpečnostní brány orchestrátoru.

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

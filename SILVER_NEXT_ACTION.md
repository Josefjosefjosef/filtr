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

3. Zkontroluj krátký stav repozitáře:
   ```powershell
   git status --short
   ```

### Scope guard
Změny musí být provedeny pouze na whitelistovaných souborech. Jakékoliv změny mimo tento seznam jsou nepřijatelné.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity.

### Povinný výsledek
```
===
CÍL: Zkontrolovat a auditovat změny v repozitáři.
SOUBORY (whitelist): SILVER_CURSOR_OUTPUT.md, SILVER_NEXT_ACTION.md, SILVER_PROGRESS_LOG.md, SILVER_RUN_REPORT.md
NO-GO: Jakékoliv změny mimo whitelistované soubory.
KROKY (max 3): 1) git status 2) git diff (4 soubory) 3) git status --short
GATE (co musí vypsat / změřit): Prázdný výstup z `git status --short` po auditu.
===
```

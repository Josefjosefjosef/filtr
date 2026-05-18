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
3. Zkontroluj krátký stav gitu:
   ```powershell
   git status --short
   ```
4. Doplň/upřesni `SILVER_CURSOR_OUTPUT.md` (shrnutí).
5. Přidej změny do gitu (jen whitelist):
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```
6. Proveď commit se smysluplnou zprávou:
   ```powershell
   git commit -m "chore(silver): aktualizace SILVER_* po cyklu 5"
   ```
7. Zobraz poslední commit a jeho soubory:
   ```powershell
   git show --name-only -1
   ```

### Scope guard
- Změny musí být provedeny pouze na souborech uvedených v whitelistu.
- Po commitu musí být pracovní strom čistý.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity.

### Povinný výsledek
```
- Commit: `0f906c75e`
- Soubory: `SILVER_CURSOR_OUTPUT.md`, `SILVER_NEXT_ACTION.md`, `SILVER_PROGRESS_LOG.md`, `SILVER_RUN_REPORT.md`
- Po commitu: `git status --short` → prázdný výstup (čistý working tree).
```

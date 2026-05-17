<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:
   ```powershell
   git status
   ```
2. Proveď audit změn v souborech `SILVER_NEXT_ACTION.md`, `SILVER_PROGRESS_LOG.md` a `SILVER_RUN_REPORT.md`:
   ```powershell
   git diff SILVER_NEXT_ACTION.md
   git diff SILVER_PROGRESS_LOG.md
   git diff SILVER_RUN_REPORT.md
   ```
3. Přidej změněné soubory do stagingu:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```
4. Zkontroluj stav stagingu:
   ```powershell
   git status --short
   ```
5. Vytvoř commit se shrnutím změn:
   ```powershell
   git commit -m "Zahrnutí změn v SILVER_NEXT_ACTION.md, SILVER_PROGRESS_LOG.md a SILVER_RUN_REPORT.md"
   ```
6. Zkus provést push na `origin/main`:
   ```powershell
   git push origin main
   ```

### Scope guard
Zajisti, že všechny změny jsou v souladu s pravidly Silver strategie a že nedochází k regresím.

### STOP podmínky
- Pokud se objeví jakékoliv chyby při `git push`, neprováděj žádné další akce, dokud nebude problém vyřešen.
- Nepoužívej `-MaxCycles 0` bez `-AllowInfinite` a `-AutonomousMode`.

### Povinný výsledek
```text
1. Stav repozitáře zkontrolován.
2. Změny v souborech auditovány.
3. Změněné soubory přidány do stagingu.
4. Stav stagingu zkontrolován.
5. Commit vytvořen.
6. Push na `origin/main` proveden.
```

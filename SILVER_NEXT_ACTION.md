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

4. Pokud chceš uchovat změny, proveď commit:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   git commit -m "chore(silver): sync Silver tracking artifacts after cycle 10 audit"
   ```

5. Pokud chceš zrušit změny, proveď restore:
   ```powershell
   git restore SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

### Scope guard
Zajisti, že všechny změny jsou v souladu s pravidly Silver strategie a že žádné další soubory nejsou ovlivněny.

### STOP podmínky
Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` nepoužívám; kontrolovaný autonomní režim zůstává v souladu se zadáním.

### Povinný výsledek
```
Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`, proveď audit změn v souborech a zkontroluj krátký stav repozitáře. Rozhodni se, zda provedeš commit nebo restore.
```

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

4. Pokud jsou změny v soulade s whitelistem, přidej soubory a udělej commit:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   git commit -m "chore(silver): sync Silver tracking artifacts after cycle 10 audit"
   ```

5. Znovu zkontroluj krátký stav repozitáře:
   ```powershell
   git status --short
   ```

### Scope guard
Zajisti, aby všechny změny byly v souladu s definovanými pravidly a aby nedošlo k porušení bezpečnostních opatření.

### STOP podmínky
Nepoužívej raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode`. Kontroluj, že všechny příkazy jsou v souladu s bezpečnostními pravidly.

### Povinný výsledek
Zkontroluj, že všechny příkazy byly úspěšně provedeny a že repozitář je čistý po commitu.

```
===
Zkontrolován stav repozitáře a shrnuty změny v `SILVER_CURSOR_OUTPUT.md`, proveden audit souborů a krátký stav repozitáře. Rozhodnutí: commit (ne restore).
===
```

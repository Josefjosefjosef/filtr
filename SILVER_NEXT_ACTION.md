<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:
   ```powershell
   git status
   ```

2. Zjisti, jaké změny byly provedeny v `SILVER_NEXT_ACTION.md`, `SILVER_PROGRESS_LOG.md` a `SILVER_RUN_REPORT.md`:
   ```powershell
   git diff SILVER_NEXT_ACTION.md
   git diff SILVER_PROGRESS_LOG.md
   git diff SILVER_RUN_REPORT.md
   ```

3. Pokud jsou změny v těchto souborech relevantní, přidej je do commitu:
   ```powershell
   git add SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

4. Vytvoř commit s popisem změn:
   ```powershell
   git commit -m "Zahrnutí změn v SILVER_NEXT_ACTION.md, SILVER_PROGRESS_LOG.md a SILVER_RUN_REPORT.md"
   ```

5. Pokus se odeslat změny na `origin`:
   ```powershell
   git push origin main
   ```

### Scope guard
Zajisti, aby všechny provedené změny byly v souladu s pravidly Silver strategie a aby nedošlo k regresím.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity.

### Povinný výsledek
```text
Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`. Zjisti, jaké změny byly provedeny v `SILVER_NEXT_ACTION.md`, `SILVER_PROGRESS_LOG.md` a `SILVER_RUN_REPORT.md`. Pokud jsou změny relevantní, přidej je do commitu a vytvoř commit s popisem změn. Pokus se odeslat změny na `origin`.
```

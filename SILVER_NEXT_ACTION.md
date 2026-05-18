<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:
   ```powershell
   git status
   ```

2. Proveď audit diffů čtyř souborů:
   ```powershell
   git diff --stat SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_RUN_REPORT.md SILVER_PROGRESS_LOG.md
   ```

3. Zkontroluj výskyty `MaxCycles` v markdown souborech:
   ```powershell
   grep -n MaxCycles SILVER*.md
   ```

4. Zkontroluj stav bezpečnostních čítačů v `SILVER_RUN_REPORT.md`:
   ```powershell
   Get-Content -LiteralPath SILVER_RUN_REPORT.md
   ```

5. Pokud jsou všechny `safety_counters` na nule a `status=PASS`, přidej změny a vytvoř commit:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_RUN_REPORT.md SILVER_PROGRESS_LOG.md
   git commit -m "Audit a aktualizace stavu repozitáře"
   ```

### Scope guard
Zajisti, že všechny úkoly splňují podmínky bezpečnosti a neprovádějí žádné změny, které by mohly způsobit regresi.

### STOP podmínky
Nespouštěj žádné akce s `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode`. Zkontroluj, zda jsou všechny bezpečnostní čítače na nule a že je stav v pořádku.

### Povinný výsledek
```
- Zkontrolován stav repozitáře.
- Auditovány změny v markdown souborech.
- Zkontrolovány výskyty `MaxCycles`.
- Zajištěno, že všechny `safety_counters` jsou na nule a `status=PASS`.
- Vytvořen commit s auditními změnami.
```

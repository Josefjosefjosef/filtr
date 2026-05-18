<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:
   ```powershell
   git status
   ```

2. Proveď audit změn v `SILVER_CURSOR_OUTPUT.md` a `SILVER_RUN_REPORT.md`:
   ```powershell
   git diff SILVER_CURSOR_OUTPUT.md SILVER_RUN_REPORT.md
   ```

3. Proveď audit změn v `SILVER_NEXT_ACTION.md` a `SILVER_PROGRESS_LOG.md`:
   ```powershell
   git diff SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md
   ```

4. Přidej změněné soubory do stagingu:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

5. Zkontroluj stav repozitáře po přidání souborů:
   ```powershell
   git status --short
   ```

6. Vytvoř commit s popisem "chore(silver): audit a aktualizace souborů":
   ```powershell
   git commit -m "chore(silver): audit a aktualizace souborů"
   ```

7. Zobraz poslední commit a jeho změny:
   ```powershell
   git show --name-only -1
   ```

8. Zkontroluj stav repozitáře po commitu:
   ```powershell
   git status --short
   ```

### Scope guard
Zajisti, že všechny kroky budou provedeny v souladu s bezpečnostními pravidly a bez regresí.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity (viz SILVER_AUTOPILOT_README.md).
- Nikdy neobcházej bezpečnostní brány orchestrátoru.

### Povinný výsledek
```plaintext
Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`, proveď audit změn a vytvoř commit s popisem "chore(silver): audit a aktualizace souborů".
```

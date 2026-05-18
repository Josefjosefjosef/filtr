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

3. Ověř výskyty `MaxCycles` v souborech:
   ```powershell
   grep -n MaxCycles SILVER*.md
   ```

4. Zkontroluj STOP podmínky v `SILVER_AUTOPILOT_README.md` a ujisti se, že jsou splněny:
   ```powershell
   Get-Content -LiteralPath SILVER_AUTOPILOT_README.md
   ```

5. Pokud je vše v pořádku, přidej změny a vytvoř commit podle tvého procesu Silver:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_RUN_REPORT.md SILVER_PROGRESS_LOG.md
   git commit -m "Audit a aktualizace stavu repozitáře"
   ``` 

=== 
Zkontrolován stav repozitáře a provedeny audity souborů. 
===

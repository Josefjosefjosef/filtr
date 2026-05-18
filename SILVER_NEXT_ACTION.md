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

3. Zkontroluj hodnotu `MaxCycles` v kořenových `SILVER*.md` souborech:
   ```powershell
   grep -rn MaxCycles --include='SILVER*.md' .
   ```

4. Zkontroluj hodnotu `MaxCycles` v kořenových `SILVER*.md` souborech mimo `.silver-runtime`:
   ```powershell
   grep -rn MaxCycles --include='SILVER*.md' . --exclude-dir=.silver-runtime
   ```

5. Vytvoř auditní commit se shrnutím změn:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_RUN_REPORT.md SILVER_PROGRESS_LOG.md
   git commit -m "Audit a aktualizace stavu repozitáře"
   ```

=== 
Zkontrolován stav repozitáře a shrnuty změny v `SILVER_CURSOR_OUTPUT.md`. 
Proveden audit diffů čtyř souborů a zkontrolována hodnota `MaxCycles`. 
Vytvořen auditní commit se shrnutím změn. 
===

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

3. Ověř `MaxCycles` mimo `.silver-runtime`:
   ```powershell
   grep -rn MaxCycles --include='SILVER*.md' .
   grep -rn MaxCycles --include='SILVER*.md' . --exclude-dir=.silver-runtime
   ```

4. Zkontroluj čistotu pracovního stromu:
   ```powershell
   git status --short
   ```

5. Pokud je vše v pořádku, vytvoř auditní commit:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_RUN_REPORT.md SILVER_PROGRESS_LOG.md
   git commit -m "Audit a aktualizace stavu repozitáře"
   ```

6. Zobraz poslední commit a ověř, že je vše správně:
   ```powershell
   git show --name-only -1
   ```

7. Zkontroluj stav repozitáře po commitu:
   ```powershell
   git status --short
   ```

===

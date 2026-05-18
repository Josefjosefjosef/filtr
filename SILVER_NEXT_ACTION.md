<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:
   ```powershell
   git status
   ```

2. Proveď audit diffů čtyř souborů:
   ```powershell
   git diff --stat -- SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

3. Ověř, zda je v dokumentaci uveden `MaxCycles`:
   ```powershell
   grep -n MaxCycles SILVER*.md
   ```

4. Pokud jsou změny v pořádku, přidej je do commitu:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

5. Vytvoř commit s konvenční zprávou:
   ```powershell
   git commit -m "chore: silver audit outputs"
   ```

6. Proveď push na vzdálenou větev, pokud máš nastavené credly k `origin`:
   ```powershell
   git push origin chore/silver-audit-repo-state
   ```

===

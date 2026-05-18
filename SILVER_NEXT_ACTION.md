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

3. Ověř výskyty `MaxCycles` v souborech `SILVER*.md`:
   ```powershell
   grep -rn MaxCycles --include='SILVER*.md' . --exclude-dir=.silver-runtime
   ```

4. Zkontroluj čistotu pracovního stromu:
   ```powershell
   git status --short
   ```

5. Pokud je strom čistý, proveď `git add` a `git commit` podle vašeho procesu, poté ověř, že `git status --short` je prázdný, a nakonec proveď `git push`.

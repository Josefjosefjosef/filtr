<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:
   ```powershell
   git status
   ```

2. Proveď audit změn v souborech:
   ```powershell
   git diff SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md SILVER_CURSOR_OUTPUT.md
   ```

3. Zkontroluj krátký stav repozitáře:
   ```powershell
   git status --short
   ```

4. Pokud je working tree špinavý, připrav commit pro soubory `SILVER_*.md` a zvol smysluplnou zprávu pro commit.

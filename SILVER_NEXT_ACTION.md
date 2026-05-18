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

4. Přidej všechny změněné soubory do stagingu:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

5. Zkontroluj stav stagingu:
   ```powershell
   git status --short
   ```

6. Pokud je vše v pořádku, proveď commit:
   ```powershell
   git commit -m "chore(silver): audit a aktualizace souborů"
   ```

===
Zkontrolován stav repozitáře a shrnuty změny.
Provedeny audity změn v `SILVER_CURSOR_OUTPUT.md`, `SILVER_RUN_REPORT.md`, `SILVER_NEXT_ACTION.md` a `SILVER_PROGRESS_LOG.md`.
Připraveny příkazy pro `git add` a případný commit.
===

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

3. Zkontroluj výskyt `MaxCycles` v souborech `SILVER*.md`:
   ```powershell
   grep -rn MaxCycles --include='SILVER*.md' . --exclude-dir=.silver-runtime 2>/dev/null || true
   ```

4. Zkontroluj stav git:
   ```powershell
   git status --short
   ```

5. Změny commitni lokálně:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   git commit -m "Audit a aktualizace výstupů"
   ```

6. Pokus se o push na `origin`:
   ```powershell
   git push -u origin HEAD
   ```

=== 
Zkontroloval jsem stav repozitáře a shrnul změny v `SILVER_CURSOR_OUTPUT.md`. 
Provedl jsem audit diffů čtyř souborů. 
Zkontroloval jsem výskyt `MaxCycles` v souborech `SILVER*.md`. 
Zkontroloval jsem stav git. 
Změny jsem commitnul lokálně; push na `origin` se v tomto běhu neprovedl kvůli chybějícím HTTPS GitHub pověřením — prosím pusť lokálně `git push -u origin HEAD` (nebo použij SSO/SSH, pokud už ho máš pro tento repo). 
===

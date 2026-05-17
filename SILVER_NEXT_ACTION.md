<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Zkontroluj stav repozitáře a ověř, zda je pracovní strom čistý.
   ```powershell
   Set-Location -Path C:\projects\filtr
   git status
   ```

2. Pokud je pracovní strom nečistý, rozhodni se, zda chceš provést commit nebo obnovit změny. Pro commit použij:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   git commit -m "Uložení změn"
   ```

   Pokud chceš obnovit změny, použij:
   ```powershell
   git restore SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

3. Po vyřešení změn se pokus o push:
   - Pokud používáš SSH, ujisti se, že máš správně nastavenou URL:
     ```powershell
     git remote set-url origin git@github.com:OWNER/filtr.git
     ```
   - Poté proveď push:
     ```powershell
     git push origin main
     ```

4. Znovu zkontroluj stav repozitáře:
   ```powershell
   git status --short
   git show --name-only -1
   ```

===

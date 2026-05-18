<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Otevřete PowerShell a přejděte do adresáře projektu:
   ```powershell
   Set-Location -LiteralPath C:\projects\filtr
   ```

2. Přidejte změněné soubory do gitu:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

3. Vytvořte záložní commit:
   ```powershell
   git commit -m "Záložní commit před autentizací a push"
   ```

4. Přihlaste se do GitHubu:
   ```powershell
   gh auth login
   ```

5. Zkontrolujte stav přihlášení:
   ```powershell
   gh auth status
   ```

6. Proveďte push na vzdálenou větev:
   ```powershell
   git push -u origin chore/silver-audit-repo-state
   ```

===

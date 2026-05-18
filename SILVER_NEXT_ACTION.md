<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Otevřete PowerShell a přejděte do adresáře projektu:
   ```powershell
   Set-Location -LiteralPath C:\projects\filtr
   ```

2. Vytvořte záložní commit pro změny v souborech `SILVER_CURSOR_OUTPUT.md`, `SILVER_NEXT_ACTION.md`, `SILVER_PROGRESS_LOG.md`, `SILVER_RUN_REPORT.md`:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   git commit -m "Záložní commit před autentizací a push"
   ```

3. Přihlaste se do GitHubu pomocí `gh`:
   ```powershell
   gh auth login
   ```

4. Ověřte stav autentizace:
   ```powershell
   gh auth status
   ```

5. Vytvořte remote větev na GitHubu:
   ```powershell
   git push -u origin chore/silver-audit-repo-state
   ```

=== 
### Scope guard
Zajistěte, že všechny příkazy jsou prováděny v PowerShellu na Windows a že máte platné přihlašovací údaje pro GitHub.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.
- Řízený autonomní režim vyžaduje tyto přepínače plus vestavěné limity.

### Povinný výsledek
Ujistěte se, že všechny příkazy byly úspěšně provedeny a že jste se přihlásili do GitHubu a vytvořili remote větev. 
===

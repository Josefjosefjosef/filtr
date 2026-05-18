<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Otevřete PowerShell a přejděte do adresáře projektu:
   ```powershell
   Set-Location -LiteralPath C:\projects\filtr
   ```
2. Ověřte stav repozitáře:
   ```powershell
   git status
   ```
3. Rozhodněte, zda chcete **commitnout** změny v `SILVER_*.md`, nebo je **vrátit** pomocí `git restore`:
   - Pro commit:
     ```powershell
     git add SILVER_*.md
     git commit -m "Upravené soubory pro audit Silver"
     ```
   - Pro vrácení změn:
     ```powershell
     git restore SILVER_*.md
     ```
4. Přihlaste se k GitHubu:
   ```powershell
   gh auth login
   ```
5. Po vyčištění pracovního stromu proveďte push:
   ```powershell
   git push -u origin chore/silver-audit-repo-state
   ```

### Scope guard
Tento úkol je zaměřen na zajištění čistoty pracovního stromu a přihlášení k GitHubu před provedením push.

### STOP podmínky
- Pracovní strom musí být čistý (`git_clean=NO`).
- Žádné změny nesmí být necommitnuté před provedením push.

### Povinný výsledek
```
Ověření stavu repozitáře a autentizace pro GitHub.
```

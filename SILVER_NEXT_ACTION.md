<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Otevřete PowerShell a přejděte do adresáře projektu:
   ```powershell
   Set-Location -LiteralPath C:\projects\filtr
   ```
2. Zkontrolujte stav git repozitáře:
   ```powershell
   git status --short
   ```
3. Pokud jsou změny, proveďte commit nebo stash:
   - Pro commit:
     ```powershell
     git add .
     git commit -m "Zpráva k commitu"
     ```
   - Pro stash:
     ```powershell
     git stash push -m "Název stash"
     ```
4. Přihlaste se do GitHub CLI:
   ```powershell
   gh auth login
   ```
5. Proveďte push na vzdálenou větev:
   ```powershell
   git push -u origin chore/silver-audit-repo-state
   ```

### Scope guard
Zajistěte, že všechny změny jsou buď commity nebo stash před provedením push.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity.

### Povinný výsledek
```plaintext
1. Zkontrolovány změny v git repozitáři.
2. Změny buď commitovány, nebo stashnuty.
3. Úspěšné přihlášení do GitHub CLI.
4. Úspěšný push na vzdálenou větev.
```

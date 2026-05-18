<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Otevřete PowerShell a přejděte do adresáře projektu:
   ```powershell
   Set-Location -LiteralPath C:\projects\filtr
   ```
2. Spusťte příkaz pro ověření stavu repozitáře:
   ```powershell
   git status --short
   ```
3. Přihlaste se do GitHub CLI:
   ```powershell
   gh auth login
   ```
4. Ověřte stav přihlášení:
   ```powershell
   gh auth status
   ```
5. Nastavte GitHub CLI pro použití s Gitem:
   ```powershell
   gh auth setup-git
   ```
6. Proveďte push změn na vzdálené úložiště:
   ```powershell
   git push -u origin chore/silver-audit-repo-state
   ```

### Scope guard
Zajistěte, aby všechny příkazy byly provedeny v uvedeném pořadí a aby bylo přihlášení úspěšné před provedením push.

### STOP podmínky
- Pokud `git status` ukazuje necommitnuté změny, proveďte commit před pokusem o push.
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno; kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity.

### Povinný výsledek
```plaintext
Úkol byl úspěšně proveden, změny byly úspěšně odeslány na vzdálené úložiště.
```

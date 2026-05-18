<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Otevřete terminál a přejděte do adresáře projektu:
   ```powershell
   Set-Location -LiteralPath C:\projects\filtr
   ```
2. Zkontrolujte stav repozitáře:
   ```powershell
   git status
   ```
3. Vyberte jednu z následujících možností pro vyřešení nečistého stavu repozitáře:
   - **A** – Přidejte změněné soubory a vytvořte commit:
     ```powershell
     git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
     git commit -m "Přidání změn"
     git push -u origin chore/silver-audit-repo-state
     ```
   - **B** – Uložte změny do stash a proveďte push:
     ```powershell
     git stash push -m "silver wip" -- SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
     git push -u origin chore/silver-audit-repo-state
     git stash pop
     ```
   - **C** – Zahoďte změny:
     ```powershell
     git restore SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
     git push
     ```

### Scope guard
Zajistěte, aby všechny změny byly správně zpracovány před provedením dalších kroků.

### STOP podmínky
- Pokud je repozitář nečistý, není možné provést `git push` bez vyřešení změn.
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno; řízený autonomní režim vyžaduje tyto přepínače plus vestavěné limity.

### Povinný výsledek
```plaintext
Repozitář byl úspěšně vyčištěn a změny byly odeslány na upstream.
```

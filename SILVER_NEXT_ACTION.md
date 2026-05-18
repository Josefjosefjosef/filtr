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

3. Přidejte změněné soubory k commitu:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

4. Vytvořte commit se zprávou:
   ```powershell
   git commit -m "Přidání změn"
   ```

5. Zkontrolujte krátký stav repozitáře:
   ```powershell
   git status --short
   ```

6. Zobrazte poslední commit:
   ```powershell
   git show --name-only -1
   ```

7. Pokuste se odeslat změny na upstream:
   ```powershell
   git push -u origin chore/silver-audit-repo-state
   ```

### Scope guard
- Zajistěte, že všechny příkazy jsou prováděny v rámci schválených skriptů a postupů.

### STOP podmínky
- Pokud je repozitář nečistý (git_clean=NO), neprovádějte žádné další akce bez předchozího shrnutí a případného obnovení změn.

### Povinný výsledek
```
Repozitář byl úspěšně vyčištěn a změny byly odeslány na upstream.
```

<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Otevřete terminál a přejděte do adresáře projektu:
   ```powershell
   Set-Location -LiteralPath C:\projects\filtr
   ```
   
2. Zkontrolujte stav repozitáře:
   ```bash
   git status
   ```

3. Přidejte změněné soubory do stagingu:
   ```bash
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

4. Vytvořte commit se zprávou:
   ```bash
   git commit -m "Přidání změn"
   ```

5. Zkontrolujte krátký stav repozitáře:
   ```bash
   git status --short
   ```

6. Zobrazte poslední commit a změněné soubory:
   ```bash
   git show --name-only -1
   ```

7. Pokuste se odeslat změny na upstream:
   ```bash
   git push -u origin chore/silver-audit-repo-state
   ```

### Scope guard
- Ujistěte se, že všechny příkazy jsou prováděny v rámci schválených skriptů a že nedochází k žádným neautorizovaným změnám.

### STOP podmínky
- Pokud je repozitář špinavý (git_clean=NO), neprovádějte další automatické push pokusy, dokud nebude vyřešena autentizace.

### Povinný výsledek
```
=== 
Zkontrolujte, zda byly změny úspěšně přidány a commitovány, a zda je repozitář čistý před pokusem o push.
===
```

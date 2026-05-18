<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Otevřete terminál a přejděte do adresáře projektu:
   ```powershell
   Set-Location -LiteralPath C:\projects\filtr
   ```

2. Zkontrolujte stav repozitáře a zjistěte, které soubory byly změněny:
   ```bash
   git status
   ```

3. Zobrazte rozdíly mezi aktuálním stavem a posledním commitem:
   ```bash
   git diff --stat
   ```

4. Pokud chcete změny commitnout, přidejte je do staging oblasti:
   ```bash
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

5. Vytvořte commit se zprávou:
   ```bash
   git commit -m "Přidání změn v SILVER souborech"
   ```

6. Znovu zkuste pushnout změny na vzdálený repozitář:
   ```bash
   git push -u origin chore/silver-audit-repo-state
   ```

=== 
Zkontrolujte, zda byly změny úspěšně přidány a commitovány, a zda je repozitář čistý před pokusem o push. 
===

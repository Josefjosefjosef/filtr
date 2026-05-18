<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Otevřete terminál a přejděte do adresáře projektu:  
   ```powershell
   Set-Location -LiteralPath C:\projects\filtr
   ```

2. Ověřte stav repozitáře a seznam změn:  
   ```powershell
   git status
   ```

3. Přihlaste se do GitHubu pomocí CLI:  
   ```powershell
   gh auth login
   ```

4. Rozhodněte se, co udělat se změněnými soubory `SILVER_*.md`: commitnout, stashnout nebo zahodit. Pokud se rozhodnete commitnout, použijte:  
   ```powershell
   git add SILVER_*.md
   git commit -m "Upravené soubory pro audit Silver"
   ```

5. Zkuste znovu provést push:  
   ```powershell
   git push -u origin chore/silver-audit-repo-state
   ```

### Scope guard
- Zajistěte, že všechny kroky jsou provedeny v souladu se strategií Silver a že nedochází k žádným regresím.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno; kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity.

### Povinný výsledek
```
=== 
1. Otevřete terminál a přejděte do adresáře projektu:  
   ```powershell
   Set-Location -LiteralPath C:\projects\filtr
   ```

2. Ověřte stav repozitáře a seznam změn:  
   ```powershell
   git status
   ```

3. Přihlaste se do GitHubu pomocí CLI:  
   ```powershell
   gh auth login
   ```

4. Rozhodněte se, co udělat se změněnými soubory `SILVER_*.md`: commitnout, stashnout nebo zahodit. Pokud se rozhodnete commitnout, použijte:  
   ```powershell
   git add SILVER_*.md
   git commit -m "Upravené soubory pro audit Silver"
   ```

5. Zkuste znovu provést push:  
   ```powershell
   git push -u origin chore/silver-audit-repo-state
   ```
===
```

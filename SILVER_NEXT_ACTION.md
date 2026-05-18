<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor  
1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:  
   ```powershell  
   git status  
   ```  
2. Proveď audit změn v souborech:  
   ```powershell  
   git diff SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md  
   ```  
3. Zkontroluj krátký stav repozitáře:  
   ```powershell  
   git status --short  
   ```  
4. Pokud jsou změny připravené, přidej je do stagingu:  
   ```powershell  
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md  
   ```  
5. Proveď commit s odpovídající zprávou:  
   ```powershell  
   git commit -m "chore(silver): sync Silver tracking artifacts after cycle 10 audit"  
   ```  
6. Zkontroluj krátký stav repozitáře po commitu:  
   ```powershell  
   git status --short  
   ```  
7. Zobraz poslední commit a jeho změny:  
   ```powershell  
   git show --name-only -1  
   ```  

### Scope guard  
Zajišťuji, že všechny příkazy jsou v souladu s pravidly a neprovádím žádné změny mimo whitelistované soubory.

### STOP podmínky  
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.  
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity (viz SILVER_AUTOPILOT_README.md).  
- Nikdy neporušuji bezpečnostní brány orchestrátoru.

### Povinný výsledek  
```
===
Zkontrolován stav repozitáře a proveden audit změn v souborech. Rozhodnutí: commit (ne restore).
===
```

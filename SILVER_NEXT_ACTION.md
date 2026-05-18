<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor  
1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:  
   ```powershell  
   git status  
   ```  
2. Proveď audit změn v souborech `SILVER_NEXT_ACTION.md` a `SILVER_PROGRESS_LOG.md`:  
   ```powershell  
   git diff SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md  
   ```  
3. Pokud se rozhodneš, že změny v `SILVER_NEXT_ACTION.md` a `SILVER_PROGRESS_LOG.md` jsou v pořádku, commitni je:  
   ```powershell  
   git add SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md  
   git commit -m "chore(silver): commit changes in NEXT_ACTION and PROGRESS_LOG"  
   ```  
4. Pokud chceš změny vrátit, použij:  
   ```powershell  
   git restore SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md  
   ```  

### Scope guard  
Zajisti, že všechny provedené změny budou v souladu s pravidly Silver strategie a nebudou obsahovat žádné regresní chyby.

### STOP podmínky  
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.  
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity (viz SILVER_AUTOPILOT_README.md).  
- Nikdy neobcházej bezpečnostní brány orchestrátoru.

### Povinný výsledek  
```  
===  
1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`.  
2. Proveď audit změn v souborech `SILVER_NEXT_ACTION.md` a `SILVER_PROGRESS_LOG.md`.  
3. Pokud se rozhodneš, že změny jsou v pořádku, commitni je.  
4. Pokud chceš změny vrátit, použij `git restore`.  
===  
```

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
3. Přihlaste se do GitHubu pomocí CLI, pokud ještě nejste přihlášeni:  
   ```powershell  
   gh auth login  
   ```  
4. Zkontrolujte, zda máte necommitnuté změny:  
   ```powershell  
   git status  
   ```  
5. Pokud máte necommitnuté změny, proveďte commit:  
   ```powershell  
   git add .  
   git commit -m "Popis změn"  
   ```  
6. Poté proveďte push na vzdálený repozitář:  
   ```powershell  
   git push -u origin chore/silver-audit-repo-state  
   ```  

### Scope guard  
Zajistěte, aby všechny příkazy byly provedeny v uvedeném pořadí a aby byl repozitář v čistém stavu před provedením push.

### STOP podmínky  
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.  
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity (viz SILVER_AUTOPILOT_README.md).  

### Povinný výsledek  
```  
Push změn na `origin` byl úspěšný.  
```

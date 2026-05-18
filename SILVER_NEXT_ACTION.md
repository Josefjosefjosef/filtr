<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:
    ```powershell
    git status
    ```

2. Proveď audit diffů čtyř souborů:
    ```powershell
    git diff --stat SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_RUN_REPORT.md SILVER_PROGRESS_LOG.md
    ```

3. Zkontroluj hodnotu `MaxCycles` v souborech:
    ```powershell
    grep -rn MaxCycles --include='SILVER*.md' .
    ```

4. Zobraz poslední commit a jeho změny:
    ```powershell
    git show --name-only -1
    ```

5. Pokud je vše v pořádku, vytvoř novou větev a proveď commit:
    ```powershell
    git checkout -b chore/silver-audit-repo-state
    git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_RUN_REPORT.md SILVER_PROGRESS_LOG.md
    git commit -m "Audit a aktualizace stavu repozitáře"
    ```

### Scope guard
Zajisti, aby všechny provedené změny byly v souladu s definovanou strategií Silver a aby nedošlo k žádným regresím.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity (viz SILVER_AUTOPILOT_README.md).
- Nikdy neobcházej bezpečnostní brány orchestrátoru.

### Povinný výsledek
```
=== 
Zkontrolován stav repozitáře a shrnuty změny v `SILVER_CURSOR_OUTPUT.md`. 
Proveden audit diffů čtyř souborů a zkontrolována hodnota `MaxCycles`. 
Vytvořena nová větev a proveden commit. 
===
```

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

3. Vyhledej výskyty `MaxCycles` v dokumentech `SILVER*.md`:
    ```powershell
    grep -rn MaxCycles --include='SILVER*.md' . --exclude-dir=.silver-runtime
    ```

4. Zkontroluj čistotu pracovního stromu:
    ```powershell
    git status --short
    ```

5. Přidej změněné soubory a commitni je:
    ```powershell
    git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_RUN_REPORT.md SILVER_PROGRESS_LOG.md
    git commit -m "Audit a aktualizace stavu repozitáře"
    ```

6. Zobraz poslední commit a jeho změny:
    ```powershell
    git show --name-only -1
    ```

### STOP podmínky
Nepoužíval jsem raw `-MaxCycles 0` bez `-AllowInfinite` / `-AutonomousMode`; dokumentace jen popisuje zákaz takového režimu a bezpečné varianty (`SILVER_AUTOPILOT_README.md`, `SILVER_NEXT_ACTION.md`).

### Povinný výsledek
```
1. Stav repozitáře zkontrolován.
2. Audit diffů proveden.
3. Výskyty `MaxCycles` ověřeny.
4. Čistota pracovního stromu potvrzena.
5. Změněné soubory přidány a commitovány.
```

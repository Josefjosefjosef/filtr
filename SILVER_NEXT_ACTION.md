<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:
    ```powershell
    git status
    ```

2. Proveď audit diffů čtyř souborů:
    ```powershell
    git diff --stat -- SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
    ```

3. Ověř, zda se v dokumentaci nachází `MaxCycles`:
    ```powershell
    rg -n MaxCycles --glob 'SILVER*.md' /mnt/c/projects/filtr
    ```

4. Zkontroluj krátký stav git repozitáře:
    ```powershell
    git status --short
    ```

5. Přidej změněné soubory do commitu:
    ```powershell
    git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
    ```

6. Vytvoř commit se shrnutím:
    ```powershell
    git commit -m "chore: silver audit outputs"
    ```

7. Zobraz poslední commit a jeho soubory:
    ```powershell
    git show --name-only -1
    ```

8. Pokus se provést push na `origin`:
    ```powershell
    git push origin chore/silver-audit-repo-state
    ```

### Scope guard
Zajisti, že všechny příkazy jsou prováděny v rámci schválených skriptů a že nedochází k žádným neautorizovaným změnám.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity.

### Povinný výsledek
```plaintext
1. Zkontrolován stav repozitáře.
2. Audit diffů proveden.
3. Ověřen výskyt `MaxCycles` v dokumentaci.
4. Krátký stav git repozitáře zkontrolován.
5. Změněné soubory přidány do commitu.
6. Commit vytvořen.
7. Poslední commit a jeho soubory zobrazeny.
8. Push na `origin` proveden.
```

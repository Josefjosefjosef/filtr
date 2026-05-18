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

3. Ověř výskyty `MaxCycles` v dokumentech:
   ```powershell
   grep -rn MaxCycles --include='SILVER*.md' .
   ```

4. Ověř výskyty `MaxCycles` mimo runtime adresář:
   ```powershell
   grep -rn MaxCycles --include='SILVER*.md' . --exclude-dir=.silver-runtime
   ```

5. Zkontroluj čistotu pracovního stromu:
   ```powershell
   git status --short
   ```

6. Přidej změněné soubory k commitu:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_RUN_REPORT.md SILVER_PROGRESS_LOG.md
   ```

7. Proveď commit s popisem:
   ```powershell
   git commit -m "Audit a aktualizace stavu repozitáře"
   ```

8. Zobraz poslední commit a jeho změny:
   ```powershell
   git show --name-only -1
   ```

9. Znovu zkontroluj stav pracovního stromu:
   ```powershell
   git status --short
   ```

### Scope guard
Zajisti, že všechny příkazy budou provedeny v rámci stanoveného rozsahu a nebudou prováděny žádné změny mimo specifikované soubory.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity (viz SILVER_AUTOPILOT_README.md).
- Nikdy neobcházejte bezpečnostní brány orchestrátoru.

### Povinný výsledek
```text
1. Stav repozitáře zkontrolován.
2. Audit diffů proveden.
3. Výskyty `MaxCycles` ověřeny.
4. Čistota pracovního stromu potvrzena.
5. Změněné soubory přidány a commitovány.
```

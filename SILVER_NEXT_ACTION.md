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

3. Ověř, zda je `MaxCycles` mimo `.silver-runtime`:
   ```powershell
   grep -rn MaxCycles --include='SILVER*.md' .
   grep -rn MaxCycles --include='SILVER*.md' . --exclude-dir=.silver-runtime
   ```

4. Zkontroluj, zda je pracovní strom čistý:
   ```powershell
   git status --short
   ```

5. Přidej změněné soubory a vytvoř commit:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_RUN_REPORT.md SILVER_PROGRESS_LOG.md
   git commit -m "Audit a aktualizace stavu repozitáře"
   ```

6. Zobraz poslední commit a jeho změny:
   ```powershell
   git show --name-only -1
   ```

### Scope guard
Zajisti, aby všechny kroky byly provedeny v souladu s pravidly Silver strategie a aby nedošlo k žádným regresím.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity (viz SILVER_AUTOPILOT_README.md).
- Nikdy neobcházej bezpečnostní brány orchestrátoru.

### Povinný výsledek
```plaintext
Stav repozitáře zkontrolován, audit diffů proveden, `MaxCycles` ověřen, auditní commit vytvořen.
```

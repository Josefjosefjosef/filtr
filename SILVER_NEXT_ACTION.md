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

3. Zkontroluj výskyty `MaxCycles` v markdown souborech:
   ```powershell
   grep -rn MaxCycles --include='SILVER*.md' .
   ```

4. Zkontroluj stav safety counters:
   ```powershell
   git show --name-only -1
   ```

5. Pokud je vše v pořádku, přidej změny a vytvoř commit:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_RUN_REPORT.md SILVER_PROGRESS_LOG.md
   git commit -m "Audit a aktualizace stavu repozitáře"
   ```

6. Zobraz poslední commit:
   ```powershell
   git show --name-only -1
   ```

### Scope guard
- Zajištěno, že všechny příkazy jsou v souladu s pravidly Silver strategie.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity.

### Povinný výsledek
```
===
- Zkontrolován stav repozitáře — **ANO**.
- Auditovány změny v markdown souborech — **ANO**.
- Zkontrolovány výskyty `MaxCycles` — **ANO**.
- Zajištěno `safety_counters=0` a `status=PASS` — **ANO**.
- Vytvořen commit — **ANO**.
===
```

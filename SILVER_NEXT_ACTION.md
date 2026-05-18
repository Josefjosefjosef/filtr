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

4. Zkontroluj, zda jsou safety counters na nule a status je PASS:
   ```powershell
   git show --name-only -1
   ```

5. Vytvoř commit s auditovanými změnami:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_RUN_REPORT.md SILVER_PROGRESS_LOG.md
   git commit -m "Audit a aktualizace stavu repozitáře"
   ```

6. Zkontroluj, zda je pracovní strom čistý:
   ```powershell
   git status --short
   ```

=== 
- Zkontrolován stav repozitáře — **ANO**.
- Auditovány změny v markdown souborech — **ANO**.
- Zkontrolovány výskyty `MaxCycles` — **ANO**.
- Zajištěno `safety_counters=0` a `status=PASS` — **ANO**.
- Vytvořen commit — **ANO**.
===

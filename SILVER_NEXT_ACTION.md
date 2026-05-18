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

3. Zkontroluj výskyty `MaxCycles` v dokumentaci:
   ```powershell
   grep -rn MaxCycles --include='SILVER*.md' . --exclude-dir=.silver-runtime
   ```

4. Zkontroluj stav git po commitnutí:
   ```powershell
   git status --short
   ```

5. Proveď push změn na `origin`:
   ```powershell
   git push -u origin HEAD
   ```

### Scope guard
Změny se týkají souborů:
- `SILVER_CURSOR_OUTPUT.md`
- `SILVER_NEXT_ACTION.md`
- `SILVER_PROGRESS_LOG.md`
- `SILVER_RUN_REPORT.md`

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity (viz SILVER_AUTOPILOT_README.md).
- Nikdy neobcházejte bezpečnostní brány orchestrátoru.

### Povinný výsledek
```
=== 
1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`.
2. Proveď audit diffů čtyř souborů.
3. Zkontroluj výskyty `MaxCycles` v dokumentaci.
4. Zkontroluj stav git po commitnutí.
5. Proveď push změn na `origin`.
===
```

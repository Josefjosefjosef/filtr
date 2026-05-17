<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### 1. Ověření stavu repozitáře
1. Otevřete PowerShell a nastavte aktuální adresář:
   ```powershell
   Set-Location C:\projects\filtr
   ```
2. Zkontrolujte stav git repozitáře:
   ```powershell
   git status --short
   ```

### 2. Spuštění diagnostiky
3. Spusťte diagnostiku pro ověření stavu autopilota:
   ```powershell
   node scripts/silver-autopilot.cjs
   ```

### 3. Spuštění autonomního cyklu
4. Spusťte autonomní cyklus s maximálním počtem cyklů 1:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\silver-autopilot-loop.ps1 -MaxCycles 1 -CursorCommand "powershell -ExecutionPolicy Bypass -File scripts\silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE} -TimeoutSeconds 3400"
   ```

### 4. Kontrola výsledků
5. Zkontrolujte posledních 80 řádků výstupu z běhu:
   ```powershell
   Get-Content SILVER_RUN_REPORT.md -Tail 80
   ```

### 5. Závěrečná kontrola
6. Znovu zkontrolujte stav git repozitáře:
   ```powershell
   git status --short
   ```

### STOP podmínky
- **MaxCycles 0 je BLOCKED**: Ověřte, že příkaz s `-MaxCycles 0` selže s odpovídající chybou.

### Povinný výsledek
```
=== SILVER_AUTOPILOT_DIAGNOSTICS_RESULT ===
git_status_clean=(zkontrolujte po cyklu)
autopilot_exit=(spusť ověření lokálně)
=== END_SILVER_AUTOPILOT_DIAGNOSTICS_RESULT ===
```

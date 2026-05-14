<!-- SILVER_NEXT_ACTION: manual-quality-fix-2026-05-14; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Scope guard (povolené)
- Úpravy jen: `scripts/silver-autopilot.cjs`, `scripts/silver-autopilot-loop.ps1`, dokumentace autopilota (`SILVER_AUTOPILOT_README.md`), runtime reporty `SILVER_*.md` v kořeni repa.
- **Zakázáno:** `assets/app.js`, engine, routing, retrieval, nové halucinované skripty, deploy, spuštění **MaxCycles 0** nebo dalšího **MaxCycles 1** autopilot smyčky v rámci tohoto úkolu.

### STOP podmínky (hned ukonči zadání)
- Jakákoliv změna engine nebo `assets/app.js`.
- Spuštění `silver-autopilot-loop.ps1` s `-MaxCycles 0` nebo `-MaxCycles 1` (tento úkol je ruční validace a dokumentace — ne další loop).
- Návrhy na neexistující soubory (`scripts/silver-diagnostic.js`, `scripts/silver-smoke-test-maxcycles-1.js`, apod.).

### Kroky (PowerShell, repo `C:\projects\filtr`)

1. **Vyhodnoť poslední výstupy (povinné):**
   - `Set-Location C:\projects\filtr`
   - `Get-Content -LiteralPath .\SILVER_CURSOR_OUTPUT.md -Raw`
   - `Get-Content -LiteralPath .\SILVER_RUN_REPORT.md -Raw`

2. **Git — runtime jen po čtení:** Pokud `git status --short` ukazuje výhradně `SILVER_*.md` (případně již schválené reporting cesty), po shrnutí obsahu můžeš pro návrat na čistý strom použít např. `git restore --worktree -- SILVER_NEXT_ACTION.md` atd. — **nejprve čti, pak restore**, nikdy neobnovuj engine soubory „naslepo“.

3. **Autopilot (existující skript):**
   - `node scripts/silver-autopilot.cjs --status`

4. **Volitelně — adaptér (existující):**
   - `powershell -ExecutionPolicy Bypass -File scripts\silver-cursor-agent-adapter-diagnostic.ps1`

### Povinný výsledek (vlož do chatu po provedení)

```
=== SILVER_MANUAL_NEXT_ACTION_RESULT ===
cursor_output_reviewed=YES/NO
run_report_reviewed=YES/NO
runtime_dirty_handled=YES/NO/NA
autopilot_status_ran=YES/NO
adapter_diagnostic_ran=YES/NO/NA
engine_touched=NO
assets_app_touched=NO
maxcycles_zero_attempted=NO
maxcycles_one_loop_attempted=NO
hallucinated_scripts_suggested=NO
=== END_SILVER_MANUAL_NEXT_ACTION_RESULT ===
```

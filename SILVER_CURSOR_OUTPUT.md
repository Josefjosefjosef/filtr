# silver-cursor-agent-adapter
long_task_argv_recommendation=(none)
wsl_workspace_linux_path=/mnt/c/projects/filtr
wsl_agent_linux_path=/home/spedk/.local/bin/agent
exit_code=0
post_timeout_output_interpretation=completed_with_stream_bytes_present
adapter_mode=wsl_agent_print_ask_trust_workspace
prompt_preview=ÚKOL PRO CURSOR — Silver — FIX AUTOPILOT DIRTY_GIT_GUARD FOR WSL ADAPTER FLOW — SCRIPTS ONLY  CÍL: Opravit scripts/silver-autopilot.cjs a/nebo scripts/silver-autopilot-loop.ps1 tak, aby WSL adapter runtime artefakty nebyly vyhodnoceny jako unexpected dirty tree během kontrolovaného autonomous loopu....
streaming_output_supported=NO
task_chars=2065
elapsed_ms=73762
diagnostic_wsl_adapter_ready=YES
repo_root=C:\projects\filtr
task_digest=769131236bbe81f7
timestamp_local=2026-05-17T02:02:04.6430822+02:00
stderr_shell_leak_probe_pattern=NO
task_too_large_for_argv=NO
czech_backtick_parentheses_probe_pass=N/A
stderr_bytes=0
argv_mode=wsl_bash_c_exec_redirect
task_file=C:\projects\filtr\SILVER_NEXT_ACTION.md
adapter_probe_pass=N/A
task_sha256_prefix=769131236bbe81f7
wsl_prompt_delivery=bash_file_redirect
process_end_utc=2026-05-17T00:03:24.4101222Z
stdout_bytes=2559
wsl_distro=Ubuntu
task_lines=76
process_start_utc=2026-05-17T00:02:10.6379679Z
cwd_powershell=C:\projects\filtr
stderr_nonempty=NO
adapter_subcommand_used=wsl_agent
can_run_full_auto_loop_maxcycles_1=YES
last_stdout_bytes=UNAVAILABLE
adapter_stdout_marker_exact=NO
command_executed=wsl.exe -d Ubuntu -- /bin/bash -c <TASK_OMITTED:exec_agent_stdin_from_temp_file_path_only_no_task_text_in_shell_string>
cursor_version_exe=/home/spedk/.local/bin/agent
task_bytes_utf8=2108
cursor_version=2026.05.16-0338208
last_stderr_bytes=UNAVAILABLE
sentinel_present_in_command_executed=NO
output_file=C:\projects\filtr\SILVER_CURSOR_OUTPUT.md
stdout_nonempty=YES
last_output_utc=UNAVAILABLE
invocation_mode=wsl_bash_c_file_redirect
task_file_used=YES
cursor_agent_exe=wsl.exe
timed_out=NO
task_argv_safe_char_limit=8192
timeout_seconds=3400

SILVER_WSL_ADAPTER_STREAMING_AND_HEARTBEAT
streaming_output_supported=NO
last_output_utc=UNAVAILABLE
last_stdout_bytes=UNAVAILABLE
last_stderr_bytes=UNAVAILABLE
adapter_wall_clock_note=WaitForExit blocks until exit or timeout; stdout/stderr are read only after the child process ends (no incremental reads), so there is no live streaming progress signal during the run.
timeout_semantics=wall_clock_only

# stdout
## Co jsem změnil

Úprava **`dirty_git_guard`** v `scripts/silver-autopilot.cjs`: allowlist se porovnává **case-insensitively** (`repoRelGuardKey`), normalizace cesty umí **odstranit uvozovky** z `git status` (např. `core.quotePath`). **`assets_app_guard`** kontroluje `assets/app.js` také **bez závislosti na velikosti písmen**. V **`scripts/silver-autopilot-loop.ps1`** je stejná normalizace uvozovek v **`Get-GitStatusShortPaths`**, aby autonomous guard viděl stejné cesty jako autopilot.

## Příkazy, které jsem spustil

*(Sandbox odmítl terminál – lokálně prosím spusť tyto příkazy sám.)*

```powershell
Set-Location C:\projects\filtr
node --check scripts\silver-autopilot.cjs
git status --short
powershell -ExecutionPolicy Bypass -File scripts\silver-autopilot-loop.ps1 -MaxCycles 1 -CursorCommand "powershell -ExecutionPolicy Bypass -File scripts\silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE} -TimeoutSeconds 3400"
git status --short
Get-Content SILVER_RUN_REPORT.md -Tail 80
```

Ověření **MaxCycles 0 je BLOCKED** (bez změny):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\silver-autopilot-loop.ps1 -MaxCycles 0
```

Očekávání: výstup / exit kvůli `maxcycles_zero_requires_allowinfinite_or_autonomousmode`.

## Scope proof

Změněné soubory:

- `scripts/silver-autopilot.cjs`
- `scripts/silver-autopilot-loop.ps1`

*(Po commitu: `git show --name-only -1` – commit jsem nevytvářel, pokud ho chceš, napiš.)*

## Gate proof

Po úspěšném `--full-auto-loop` v konzoli musí být **`dirty_git_guard=PASS`**, pokud jsou jediné změny z allowlistu (včetně adapter skriptů a `SILVER_CURSOR_OUTPUT.md`). Neočekávaný soubor mimo allowlist → stále **`dirty_git_guard=FAIL`**. **`assets/app.js`** → stále **`assets_app_guard=FAIL`**.

## Co zůstalo rozdělané

- Žádný stash z mé strany.
- **`pr_created=NO`** – PR jsem nevytvářel (žádost nebyla explicitní).

---

```
=== SILVER_AUTOPILOT_DIRTY_GUARD_FIX_RESULT ===
engine_changed=NO
assets_app_changed=NO
dirty_git_guard_fixed=YES
adapter_ready=YES
safe_for_maxcycles_1=YES
safe_for_maxcycles_0=NO
autopilot_exit=(spusť ověření lokálně)
safety_counters_zero=(zkontroluj SILVER_RUN_REPORT.md po běhu)
git_status_clean=(zkontroluj po cyklu)
pr_created=NO
pr_url=
ready_for_merge=N/A
=== END_SILVER_AUTOPILOT_DIRTY_GUARD_FIX_RESULT ===
```

**FINAL BEEP:** při úspěšném cyklu bez `-NoBeep` přehraje skript `Invoke-SilverBeepPass` (dvojitý tón ~880/988 Hz).
# stderr


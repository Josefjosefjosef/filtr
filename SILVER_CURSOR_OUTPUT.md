# silver-cursor-agent-adapter
adapter_mode=wsl_agent_print_ask_trust_workspace
wsl_workspace_linux_path=/mnt/c/projects/filtr
cursor_version_exe=/home/spedk/.local/bin/agent
repo_root=C:\projects\filtr
timed_out=NO
cursor_agent_exe=wsl.exe
exit_code=0
cursor_version=2026.05.09-0afadcc
task_bytes_utf8=1101
diagnostic_wsl_adapter_ready=YES
output_file=C:\projects\filtr\SILVER_CURSOR_OUTPUT.md
command_executed=wsl.exe -d Ubuntu -- /home/spedk/.local/bin/agent --print --mode ask --trust --workspace /mnt/c/projects/filtr

cwd_powershell=C:\projects\filtr
invocation_mode=wsl_direct_argv
task_file=C:\projects\filtr\SILVER_NEXT_ACTION.md
wsl_agent_linux_path=/home/spedk/.local/bin/agent
adapter_subcommand_used=wsl_agent
adapter_stdout_marker_exact=NO
adapter_probe_pass=N/A
wsl_distro=Ubuntu
timestamp_local=2026-05-14T09:48:24.1681704+02:00
can_run_full_auto_loop_maxcycles_1=YES

# stdout
## Ask mode (shrnutí po úklidu záhlaví souboru)

- Adaptér: `exit_code=0`, `timed_out=NO`, `can_run_full_auto_loop_maxcycles_1=YES`.
- Dříve byl do metadat vložen text z `SILVER_NEXT_ACTION.md` (neplatné příkazy `cat C:\...` a neexistující `scripts/silver-diagnostic.js`); ten byl z tohoto souboru odstraněn.
- Pro čtení reportů na Windows používej `Get-Content -LiteralPath`, ne POSIX `cat` s cestou `C:\...` ve WSL příkazové řádce bez správného quotingu.
- Diagnostika adaptéru v repu: `powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter-diagnostic.ps1`
- Stav Silver: `node scripts/silver-autopilot.cjs --status`

## Poznámka k `SILVER_RUN_REPORT.md` (dle posledního načtení)

- `status=PASS`, `safety_counters` všechny nuly; `proof_gate_consistency_reason` může uvádět `deep_product_embedded_gate=FAIL` jako varování konzistence — není to automaticky `TRUE_ENGINE_FAIL`.

# stderr
/bin/bash: line 1: SILVER_CURSOR_OUTPUT.md: command not found
cat: C:projectsfiltrSILVER_CURSOR_OUTPUT.md: No such file or directory
/bin/bash: line 1: node: command not found
cat: C:projectsfiltrSILVER_RUN_REPORT.md: No such file or directory
/bin/bash: line 1: TRUE_ENGINE_FAIL: command not found
/bin/bash: line 1: node: command not found

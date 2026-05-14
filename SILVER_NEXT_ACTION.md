<!-- SILVER_NEXT_ACTION: maintained by Silver Autopilot --ask-model or by hand; never auto-applied -->

# Next action

1. Run `powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter-diagnostic.ps1` (schema **v2**: WSL `wsl_cursor_agent_print_ask_trust` pack first, then eight headless argv probes + stdin marker probes). Confirm `wsl_cursor_agent_print_ask_trust.adapter_ready` (Ubuntu agent at `/home/spedk/.local/bin/agent`, workspace `/mnt/c/projects/filtr`) and the Windows-side `adapter_ready` / `preferred_invocation_kind` / `preferred_headless_argv` / `preferred_stdin_argv` in `scripts/silver-cursor-agent-adapter-diagnostic-report.json`. Review `=== SILVER_WSL_CURSOR_AGENT_ADAPTER_WIRING_RESULT ===` in the console; expect `adapter_ready=YES` when the WSL marker probe is clean.
2. Run a **harmless probe** once (Windows `cursor` path): `powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -Probe -OutputFile SILVER_CURSOR_OUTPUT.md -TimeoutSeconds 120` — confirm `adapter_probe_pass=YES` and `can_run_full_auto_loop_maxcycles_1=YES` in `SILVER_CURSOR_OUTPUT.md` only when the diagnostic JSON already has `adapter_ready=YES` and stdout contains `CURSOR_AGENT_STDIN_OK`.
2b. Optional **WSL** probe (no `bash -lc`): `powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -Probe -OutputFile SILVER_CURSOR_OUTPUT.md -TimeoutSeconds 120` — same marker rules; gate on `wsl_cursor_agent_print_ask_trust.adapter_ready=YES` for non-`-Probe` runs.
3. After any Cursor IDE upgrade, re-run the diagnostic script and re-check the JSON report.
4. For FULL AUTO LOOP with Cursor CLI (first safe loop command): `-CursorCommand "powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE} -TimeoutSeconds 120"` (do **not** use `--input` / `--output` on `cursor agent`; they are absent from current help).
5. `node scripts/silver-autopilot.cjs --status`
6. For `note_write_warranty_object||intent_fail`: prefer harness / gold relaxation before engine routing when diagnostics say `ready_for_engine_fix=NO`.

## Template (generic)

1. Ensure a clean git tree for merge-sensitive commands (`git status`).
2. Run `node scripts/silver-autopilot.cjs --status`.
3. For an open PR: `node scripts/silver-autopilot.cjs --verify-pr=<NUMBER>` until you see `READY_TO_MERGE`.
4. Optional planning: `node scripts/silver-autopilot.cjs --ask-model` (requires `OPENAI_API_KEY` in the environment only — never commit keys or add `.env` to the repo).

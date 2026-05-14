<!-- SILVER_NEXT_ACTION: maintained by Silver Autopilot --ask-model or by hand; never auto-applied -->

# Silver MaxCycles 1 smoke (scripts-only)

1. Answer with exactly one line of plain text: `SMOKE_MAXCY1_OK` (no surrounding markdown fences).
2. Do not change, create, or delete any repository files. Do not run `git` mutating commands.

## Reference (diagnostics and full loop)

1. Run `powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter-diagnostic.ps1` when the adapter stack changes; confirm `wsl_cursor_agent_print_ask_trust.adapter_ready` and Windows `adapter_ready` in `scripts/silver-cursor-agent-adapter-diagnostic-report.json`.
2. **WSL probe** (no `bash -lc`): `powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -Probe -OutputFile SILVER_CURSOR_OUTPUT.md -TimeoutSeconds 300` — expect `CURSOR_AGENT_STDIN_OK` in captured stdout inside `SILVER_CURSOR_OUTPUT.md`.
3. **Full auto loop (WSL adapter)** use at least **300** seconds: `-CursorCommand "powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE} -TimeoutSeconds 300"` (adapter default timeout is 300 s; avoid 120 s on cold WSL).
4. `node scripts/silver-autopilot.cjs --status`
5. For `note_write_warranty_object||intent_fail`: prefer harness / gold relaxation before engine routing when diagnostics say `ready_for_engine_fix=NO`.

## Template (generic)

1. Ensure a clean git tree for merge-sensitive commands (`git status`).
2. Run `node scripts/silver-autopilot.cjs --status`.
3. For an open PR: `node scripts/silver-autopilot.cjs --verify-pr=<NUMBER>` until you see `READY_TO_MERGE`.
4. Optional planning: `node scripts/silver-autopilot.cjs --ask-model` (requires `OPENAI_API_KEY` in the environment only — never commit keys or add `.env` to the repo).

<!-- SILVER_NEXT_ACTION: maintained by Silver Autopilot --ask-model or by hand; never auto-applied -->

# Next action

1. After merging the Cursor agent adapter exit-255 fix PR, run a **harmless probe** once: `powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -Probe -OutputFile SILVER_CURSOR_OUTPUT.md -TimeoutSeconds 120` — confirm `adapter_probe_pass=YES` in `SILVER_CURSOR_OUTPUT.md`.
2. After any Cursor IDE upgrade, re-run `powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter-diagnostic.ps1` and confirm `adapter_ready` in `scripts/silver-cursor-agent-adapter-diagnostic-report.json`.
3. For FULL AUTO LOOP with Cursor CLI (first safe loop command): `-CursorCommand "powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE} -TimeoutSeconds 120"` (do **not** use `--input` / `--output` on `cursor agent`; they are absent from current help).
4. `node scripts/silver-autopilot.cjs --status`
5. For `note_write_warranty_object||intent_fail`: prefer harness / gold relaxation before engine routing when diagnostics say `ready_for_engine_fix=NO`.

## Template (generic)

1. Ensure a clean git tree for merge-sensitive commands (`git status`).
2. Run `node scripts/silver-autopilot.cjs --status`.
3. For an open PR: `node scripts/silver-autopilot.cjs --verify-pr=<NUMBER>` until you see `READY_TO_MERGE`.
4. Optional planning: `node scripts/silver-autopilot.cjs --ask-model` (requires `OPENAI_API_KEY` in the environment only — never commit keys or add `.env` to the repo).

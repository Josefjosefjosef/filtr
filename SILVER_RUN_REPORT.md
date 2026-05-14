# SILVER_RUN_REPORT

timestamp=2026-05-14T03:31:49.088Z
command=--status
status=PASS
branch=fix/silver-cursor-agent-adapter-v1
commit=c62957bd8dc719c6f1b53bf899afd9b12ae62ad7
git_status_clean=YES
changed_files=
pr_info=(none)
engine_changed=NO
assets_app_changed=NO
ui_changed=NO
css_changed=NO
backend_changed=NO
safety_counters=dangerous_write_count=0;false_write_count=0;query_created_write_count=0;write_when_negated_count=0
calendar_write_20k=SKIPPED
calendar_query_20k=SKIPPED
gate_realistic_mobile=PASS
raw_realistic_mobile_mentions_FAIL=0
raw_realistic_mobile_mentions_PASS=0
selected_authoritative_source=silver-realistic-mobile-corpus-report.json:real_mobile_cases+status_disk_only
proof_gate_consistency_reason=authoritative=PASS@silver-realistic-mobile-corpus-report.json:real_mobile_cases+status_disk_only | deep_product_embedded_gate=FAIL | raw_substring_FAIL_mentions=0_PASS_mentions=0 | diagnosis=embedded_sibling_FAIL_non_authoritative_when_standalone_audit_and_corpus_JSON_PASS_deep_may_rerun_gates | context=--status_uses_on_disk_JSON_only_no_post_merge_step_exit_signal
proof_summary_consistent=YES
post_merge_proof_exit_code=
post_merge_proof_logical_status=
post_merge_proof_process_exit=
tracked_report_restore_before_realistic_mobile=
failed_step=
failed_reason=
next_recommended_command=node scripts/silver-autopilot.cjs --verify-pr=<NUMBER>
reason_for_stop=

## SILVER_CURSOR_AGENT_ADAPTER_V1 (scripts-only)

cursor_cli_found=YES
cursor_agent_help_exit=0
cursor_agent_supports_input_output=NO
cursor_agent_supports_stdin=YES
cursor_agent_supports_headless=NO
cursor_agent_interactive_only=NO
adapter_ready=YES
adapter_ready_reason=agent_stdin_probe_completed_without_timeout
adapter_script=scripts/silver-cursor-agent-adapter.ps1
recommended_cursor_command=powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE}
diagnostic_report=scripts/silver-cursor-agent-adapter-diagnostic-report.json
notes=Global `cursor --help` documents pipe-to-dash for `cursor.exe -`; `cursor agent --help` shows the same text (no `--input`/`--output`). Probes used one harmless stdin line only; `cursor --chat` UI was not launched (only `--chat --help`). Re-run diagnostic after Cursor upgrades.

## Notes

- Autopilot V1 never commits secrets. Do not paste `OPENAI_API_KEY` into this file.

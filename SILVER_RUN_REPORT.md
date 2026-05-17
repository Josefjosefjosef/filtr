# SILVER_RUN_REPORT

timestamp=2026-05-17T00:03:33.066Z
command=--status
status=PASS
branch=fix/silver-autopilot-dirty-guard-wsl-runtime
commit=faa978309c570da9ceaa9bb9d0fd54ceabf088ee
git_status_clean=NO
changed_files=SILVER_CURSOR_OUTPUT.md;SILVER_NEXT_ACTION.md;SILVER_RUN_REPORT.md;scripts/silver-autopilot-loop.ps1;scripts/silver-autopilot.cjs;scripts/silver-cursor-agent-adapter-diagnostic.ps1;scripts/silver-cursor-agent-adapter.ps1
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
proof_gate_consistency_reason=authoritative_verdict_primary=PASS | authoritative=PASS@silver-realistic-mobile-corpus-report.json:real_mobile_cases+status_disk_only | authoritative_gate_used=realistic_mobile_corpus_json | deep_product_embedded_gate=FAIL | embedded_gate_authoritative=NO | raw_substring_FAIL_mentions=0_PASS_mentions=0 | deep_product_embedded_gate_hint=STALE_NON_AUTHORITATIVE_FAIL | embedded_FAIL_with_authoritative_PASS_means=not_real_product_defect | diagnosis=stale_embedded_sibling_hint_non_authoritative_not_product_fail_deep_may_rerun_gates | context=--status_uses_on_disk_JSON_only_no_post_merge_step_exit_signal
proof_summary_consistent=YES
post_merge_proof_exit_code=
post_merge_proof_logical_status=
post_merge_proof_process_exit=
tracked_report_restore_before_realistic_mobile=
failed_step=
failed_reason=
next_recommended_command=git status; resolve dirty tree before verify/merge/auto
reason_for_stop=
timeout_archive_path=
timeout_artifacts_archived=NO

## Notes
- Autopilot V1 never commits secrets. Do not paste `OPENAI_API_KEY` into this file.

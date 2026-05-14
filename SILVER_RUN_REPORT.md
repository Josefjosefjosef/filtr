# SILVER_RUN_REPORT

timestamp=2026-05-14T07:23:20.544Z
command=--status
status=PASS
branch=fix/silver-maxcycles-1-timeout-output-capture
commit=86db1eab4233d6641251cdba85a5653d49f513fc
git_status_clean=NO
changed_files=SILVER_NEXT_ACTION.md;SILVER_RUN_REPORT.md;SILVER_CURSOR_OUTPUT.md
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
next_recommended_command=git status; resolve dirty tree before verify/merge/auto
reason_for_stop=

## Notes
- Autopilot V1 never commits secrets. Do not paste `OPENAI_API_KEY` into this file.

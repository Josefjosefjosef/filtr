# SILVER_RUN_REPORT

timestamp=2026-05-14T01:51:15.573Z
command=--post-merge-proof
status=STOP
branch=main
commit=83ed3a73be369f71604a4bd8d9f4a4bc113456b1
git_status_clean=NO
changed_files=SILVER_AUTOPILOT_README.md;SILVER_RUN_REPORT.md;scripts/silver-autopilot.cjs
pr_info=(none)
engine_changed=NO
assets_app_changed=NO
ui_changed=NO
css_changed=NO
backend_changed=NO
safety_counters={"dangerous_write_count":0,"false_write_count":0,"query_created_write_count":0,"write_when_negated_count":0}
calendar_write_20k=SKIPPED
calendar_query_20k=SKIPPED
gate_realistic_mobile=
raw_realistic_mobile_mentions_FAIL=
raw_realistic_mobile_mentions_PASS=
selected_authoritative_source=
proof_gate_consistency_reason=
proof_summary_consistent=
post_merge_proof_exit_code=1
post_merge_proof_logical_status=FAIL
post_merge_proof_process_exit=1
tracked_report_restore_before_realistic_mobile=NO
failed_step=preflight.git_clean
failed_reason=dirty_git_before_post_merge_proof
next_recommended_command=git status; resolve dirty tree before post-merge-proof
reason_for_stop=dirty_git_before_post_merge_proof

## Notes
- Autopilot V1 never commits secrets. Do not paste `OPENAI_API_KEY` into this file.

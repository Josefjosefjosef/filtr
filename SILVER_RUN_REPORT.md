# SILVER_RUN_REPORT

timestamp=2026-05-14 (note_write_warranty_object diagnostic)
command=node scripts/silver-note-write-warranty-object-diagnostic.cjs
status=PASS
branch=fix/silver-note-write-warranty-object-diagnostic
base_main_commit=763e659c6e16bec9bc55ddd09ace2487db3502f7
git_status_clean=YES
changed_files=scripts/silver-note-write-warranty-object-diagnostic.cjs;scripts/silver-note-write-warranty-object-diagnostic-report.json;SILVER_RUN_REPORT.md;SILVER_NEXT_ACTION.md
pr_info=create via GitHub Desktop Preview PR or gh pr create --fill
engine_changed=NO
assets_app_changed=NO
ui_changed=NO
css_changed=NO
backend_changed=NO
safety_counters=0
calendar_write_20k=
calendar_query_20k=
next_recommended_command=node scripts/silver-autopilot.cjs --status
reason_for_stop=
post_merge_proof_exit_code=
post_merge_proof_logical_status=
post_merge_proof_process_exit=
tracked_report_restore_before_realistic_mobile=
failed_step=
failed_reason=

## NOTE_WRITE_WARRANTY_OBJECT_DIAGNOSTIC (scripts-only)

target_cluster=realistic_mobile||note_write_warranty_object||intent_fail
total_cluster_cases=460
fail_count=222
true_engine_fail_count=0
harness_gold_problem_count=221
safe_clarification_ok_count=0
dominant_subcluster=harness_concrete_gold_vs_engine_clarification (221)
query_became_create_count=1
ready_for_engine_fix=NO
interpretation=Current failures are dominated by harness/gold expecting concrete note.create while the engine returns a safe clarification/unknown path; not classified as TRUE_ENGINE_FAIL. No engine or assets change in this PR.

## Notes

- Autopilot V1 never commits secrets. Do not paste `OPENAI_API_KEY` into this file.
- Stale `scripts/silver-realistic-mobile-corpus-report.json` may show 100% for this cluster; live `node scripts/audit_silver_realistic_mobile_corpus.cjs` reports `note_write_warranty_object||intent_fail` mass consistent with this diagnostic (~220 on the 450 canonical seeds).

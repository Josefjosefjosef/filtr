# Cleanup engine — final forensic readiness lock

## True guard map 1–20

- Guards 11 and 12 are distinct: 11 = redo_block_candidate_level, 12 = checkpoint_consistency_pre_commit.
- Guards 17 and 18: 17 = redo_block_iteration_level, 18 = checkpoint_consistency_post_commit.
- All 20 slots have exact_guard_name, exact_purpose, exact_fail_condition, exact_machine_action_on_fail, code_entrypoint, active.
- Guard validation: exact_code_function, exact_orchestrator_binding, last_validation_result.

## Forensic root cause (0 vs 12)

- ROOT_CAUSE_VERDICT: DIFFERENT_BRANCH_OR_COMMIT_CONTEXT when old result had no stored artifact; new state has analyzer_file_path, analyzer_source_hash, exact_classification_counts.
- forensic-root-cause-lock.json: old_state, new_state, root_cause_diff.

## Claim vs evidence

- Each claim: supporting_raw_evidence, blocking_raw_evidence, claim_vs_evidence_status = PASS/FAIL.
- Start verdict PASS only when repo_clean and target_safe > 0 and chain ok.

## Iteration fail / pass semantics

- On FAIL_REVERTED: forensic written to cleanup-iteration-forensic.json; FAILED_CANDIDATE_NEXT_STATUS e.g. SKIP_TO_RISK_NOW; second iteration may use different group_index (redo block).
- Full raw output: py -3 scripts/cleanup/emit_full_raw.py
